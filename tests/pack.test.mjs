import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, matchProduct, allocateFifo, carrierFor } from '../functions/lib/pack.ts';

const products = [
  { id: 'p1', name: 'Fresh Milled Flour', unit_label: 'bag' },
  { id: 'p2', name: 'TaloVera Skin Cream', unit_label: 'jar' },
  { id: 'p3', name: 'TaloVera Lip Balm', unit_label: 'tube' },
  { id: 'p4', name: 'Pure Vanilla Extract', unit_label: 'jar' },
];

test('items line parses the shapes stores and people write', () => {
  const lines = parseItems('2 x Fresh Milled Flour; TaloVera Lip Balm x 3, Pure Vanilla Extract (1); TaloVera Skin Cream');
  assert.deepEqual(lines.map((l) => [l.qty, l.text]), [
    [2, 'Fresh Milled Flour'], [3, 'TaloVera Lip Balm'], [1, 'Pure Vanilla Extract'], [1, 'TaloVera Skin Cream'],
  ]);
  assert.deepEqual(parseItems('3 Fresh Milled Flour - 2 lb').map((l) => [l.qty, l.text]), [[3, 'Fresh Milled Flour']]);
});

test('product matching: exact, contained, and the balm never matches the cream', () => {
  assert.equal(matchProduct('fresh milled flour', products).id, 'p1');
  assert.equal(matchProduct('Fresh Milled Flour 2 lb bag', products).id, 'p1');
  assert.equal(matchProduct('TaloVera Lip Balm', products).id, 'p3');
  assert.equal(matchProduct('TaloVera Skin Cream', products).id, 'p2');
  assert.equal(matchProduct('Lip Balm', products).id, 'p3');
  assert.equal(matchProduct('Beard Oil', products), undefined);
});

const lots = [
  { id: 'a', code: 'FW-103', product_id: 'p1', made_at: '2026-10-20', units_made: 24, units_out: 22, status: 'active' },
  { id: 'b', code: 'FW-101', product_id: 'p1', made_at: '2026-09-01', units_made: 24, units_out: 23, status: 'active' },
  { id: 'c', code: 'FW-104', product_id: 'p1', made_at: '2026-11-01', units_made: 24, units_out: 0, status: 'active' },
  { id: 'h', code: 'FW-100', product_id: 'p1', made_at: '2026-08-01', units_made: 24, units_out: 0, status: 'hold' },
  { id: 'd', code: 'FW-102', product_id: 'p2', made_at: '2026-09-27', units_made: 30, units_out: 29, status: 'active' },
];

test('FIFO: oldest active lot first, spills into the next, held lots are skipped', () => {
  const r = allocateFifo([{ qty: 4, text: 'flour', product: products[0] }], lots);
  assert.equal(r.ok, true);
  assert.deepEqual(r.allocs.map((a) => [a.lot_code, a.units]), [['FW-101', 1], ['FW-103', 2], ['FW-104', 1]]);
});

test('FIFO: a short line refuses the whole order and names the gap', () => {
  const r = allocateFifo([
    { qty: 1, text: 'flour', product: products[0] },
    { qty: 2, text: 'cream', product: products[1] },
  ], lots);
  assert.equal(r.ok, false);
  assert.deepEqual(r.short, [{ product_name: 'TaloVera Skin Cream', need: 2, have: 1 }]);
});

test('carrier from the tracking number shape', () => {
  assert.equal(carrierFor('1Z999AA10123456784'), 'ups');
  assert.equal(carrierFor('9400 1000 0000 0000 0000 00'), 'usps');
  assert.equal(carrierFor('794644790138'), 'fedex');
  assert.equal(carrierFor('ABC'), 'other');
  assert.equal(carrierFor(''), null);
});

import { expandKits } from '../functions/lib/pack.ts';
test('kits expand into their parts and merge with plain lines', () => {
  const ps = [...products, { id: 'k1', name: 'Gift Box', unit_label: 'box', components: JSON.stringify([{ product_id: 'p1', units: 2 }, { product_id: 'p4', units: 1 }]) }];
  const lines = parseItems('2 x Gift Box; 1 x Fresh Milled Flour');
  for (const l of lines) l.product = matchProduct(l.text, ps);
  const out = expandKits(lines, ps);
  assert.deepEqual(out.map((l) => [l.product.id, l.qty]), [['p1', 5], ['p4', 2]]);
});
