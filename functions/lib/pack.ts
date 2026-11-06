/** Order packing: read the items line, match products, allocate oldest lot first.
 *
 * The rules come from the Four Waters tracker this replaces:
 *  - oldest lot first (by made_at, then code), spilling into the next lot when one runs dry
 *  - an order is filled whole or not at all: if any line is short, nothing is written
 *  - a refund puts the units back on the lot they came from (unpack), which the old tracker never did
 */

export type Product = { id: string; name: string; unit_label: string };
export type LotRow = { id: string; code: string; product_id: string; made_at: string; units_made: number; units_out: number; status: string };
export type Line = { qty: number; text: string; product?: Product };
export type Alloc = { product_id: string; product_name: string; lot_id: string; lot_code: string; units: number };

/** "2 x Fresh Milled Flour; Pure Vanilla Extract x 1, 3 TaloVera Lip Balm" -> lines. */
export function parseItems(items: string): Line[] {
  const out: Line[] = [];
  for (const raw of items.split(/[;,\n]/)) {
    let t = raw.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    let qty = 1;
    let m = t.match(/^(\d+)\s*[x×]?\s+(.+)$/i);            // "2 x Name" / "2 Name"
    if (m) { qty = Number(m[1]); t = m[2]; }
    else if ((m = t.match(/^(.+?)\s*[x×]\s*(\d+)$/i))) { t = m[1]; qty = Number(m[2]); }   // "Name x 2"
    else if ((m = t.match(/^(.+?)\s*[(×x]\s*(\d+)\)?$/i))) { t = m[1]; qty = Number(m[2]); } // "Name (2)"
    else if ((m = t.match(/^(.+?)\s*[-:]\s*(\d+)$/))) { t = m[1]; qty = Number(m[2]); }    // "Name - 2"
    t = t.replace(/\s*[-:]\s*[^-:]*$/, (s) => (/\d/.test(s) ? '' : s)).trim();            // drop "- 2 lb" style variant tails that carry a number
    if (!t || !Number.isInteger(qty) || qty < 1) continue;
    out.push({ qty, text: t });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Match a line to a product: exact name, then the product name contained in the line, then the longest shared prefix of words. */
export function matchProduct(text: string, products: Product[]): Product | undefined {
  const t = norm(text);
  const exact = products.find((p) => norm(p.name) === t);
  if (exact) return exact;
  const contains = products.filter((p) => t.includes(norm(p.name)) || norm(p.name).includes(t));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1) return contains.sort((a, b) => b.name.length - a.name.length)[0];
  const words = new Set(t.split(' '));
  let best: Product | undefined; let bestScore = 0;
  for (const p of products) {
    const pw = norm(p.name).split(' ');
    const score = pw.filter((w) => words.has(w)).length / pw.length;
    if (score > bestScore && score >= 0.6) { best = p; bestScore = score; }
  }
  return best;
}

/** Allocate every line from the oldest active lots. Returns allocations, or the shortfall that stopped it. */
export function allocateFifo(lines: Line[], lots: LotRow[]): { ok: true; allocs: Alloc[] } | { ok: false; short: { product_name: string; need: number; have: number }[] } {
  const left = new Map(lots.map((l) => [l.id, l.units_made - l.units_out]));
  const allocs: Alloc[] = []; const short: { product_name: string; need: number; have: number }[] = [];
  for (const line of lines) {
    if (!line.product) continue;
    const pool = lots.filter((l) => l.product_id === line.product!.id && l.status === 'active' && (left.get(l.id) || 0) > 0)
      .sort((a, b) => a.made_at.localeCompare(b.made_at) || a.code.localeCompare(b.code, undefined, { numeric: true }));
    let need = line.qty;
    const have = pool.reduce((n, l) => n + (left.get(l.id) || 0), 0);
    if (have < need) { short.push({ product_name: line.product.name, need, have }); continue; }
    for (const l of pool) {
      if (need <= 0) break;
      const take = Math.min(need, left.get(l.id) || 0);
      if (take <= 0) continue;
      left.set(l.id, (left.get(l.id) || 0) - take); need -= take;
      const prev = allocs.find((a) => a.lot_id === l.id);
      if (prev) prev.units += take; else allocs.push({ product_id: l.product_id, product_name: line.product.name, lot_id: l.id, lot_code: l.code, units: take });
    }
  }
  return short.length ? { ok: false, short } : { ok: true, allocs };
}

/** Carrier from the shape of a tracking number. The tracker read Pirate Ship's label file the same way. */
export function carrierFor(tracking: string): string | null {
  const t = tracking.replace(/\s+/g, '').toUpperCase();
  if (!t) return null;
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return 'ups';
  if (/^(9[2-5]\d{18,24}|\d{20,22})$/.test(t)) return 'usps';
  if (/^(\d{12}|\d{15}|\d{20})$/.test(t)) return 'fedex';
  if (/^[A-Z]{2}\d{9}US$/.test(t)) return 'usps';
  return 'other';
}
