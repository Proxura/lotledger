import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCsv } from '../functions/api/orders.ts';
import { buildPirateRows, PIRATE_COLUMNS } from '../functions/api/export/pirateship.ts';
import { csv, parseCsv } from '../functions/lib/core.ts';

test('Shopify export maps and merges line items per order', () => {
  const text = [
    'Name,Email,Financial Status,Lineitem name,Lineitem grams,Shipping Name,Shipping Address1,Shipping Address2,Shipping City,Shipping Province Code,Shipping Zip,Shipping Country Code',
    '#1001,kent@example.com,paid,Beard Oil,30,Kent Smith,12 Main St,,Alma,MI,48801,US',
    '#1001,kent@example.com,paid,Beard Balm,57,Kent Smith,12 Main St,,Alma,MI,48801,US',
    '#1002,jo@example.com,paid,Skin Cream,120,"Jo ""JJ"" Lee",5 Oak Ave,Apt 4,Mt Pleasant,MI,48858,US',
  ].join('\n');
  const rows = mapCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].order_ref, '#1001');
  assert.equal(rows[0].items, 'Beard Oil; Beard Balm');
  assert.equal(rows[0].source, 'shopify');
  assert.equal(rows[0].weight_oz, 1.1); // 30 g -> 1.1 oz (first line only; weights are set per package)
  assert.equal(rows[1].customer_name, 'Jo "JJ" Lee');
  assert.equal(rows[1].line2, 'Apt 4');
});

test('Pirate Ship rows: thirteen columns, bad rows named', () => {
  const orders = [
    { id: '1', order_ref: 'FW-900021', customer_name: 'Kent', email: 'k@x.com', line1: '12 Main', line2: null, city: 'Alma', state: 'MI', zip: '48801', country: 'US', weight_oz: 4.2, length_in: 8, width_in: 4, height_in: 1 },
    { id: '2', order_ref: 'NOZIP', customer_name: 'A', email: null, line1: '1 St', line2: null, city: 'X', state: 'MI', zip: '', country: 'US', weight_oz: 4, length_in: null, width_in: null, height_in: null },
    { id: '3', order_ref: 'CANADA', customer_name: 'B', email: null, line1: '1 St', line2: 'Apt 4', city: 'X', state: 'ON', zip: 'M5V', country: 'CA', weight_oz: 4, length_in: null, width_in: null, height_in: null },
    { id: '4', order_ref: 'NOWEIGHT', customer_name: 'C', email: null, line1: '1 St', line2: null, city: 'X', state: 'MI', zip: '48801', country: 'US', weight_oz: null, length_in: null, width_in: null, height_in: null },
  ];
  const { rows, left } = buildPirateRows(orders);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 13);
  assert.equal(PIRATE_COLUMNS.join(','), 'Order,Name,Address 1,Address 2,City,State,Zip,Country,Email,Weight (oz),Length,Width,Height');
  assert.equal(rows[0][3], '');
  assert.equal(rows[0][9], '4.2');
  assert.deepEqual(left.map((l) => l.problem), ['no ZIP', 'US only in this export', 'no weight']);
  const file = csv([PIRATE_COLUMNS, ...rows]);
  assert.equal(parseCsv(file)[1][0], 'FW-900021');
  assert.ok(file.startsWith('Order,Name,Address 1,Address 2,City,State,Zip,Country,Email,Weight (oz),Length,Width,Height\r\n'));
});

test('csv round-trips quotes, commas and newlines', () => {
  const rows = [['a,b', 'say "hi"', 'line1\nline2'], ['', null, 3]];
  const back = parseCsv(csv(rows));
  assert.deepEqual(back, [['a,b', 'say "hi"', 'line1\nline2'], ['', '', '3']]);
});
