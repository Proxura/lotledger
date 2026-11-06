import { handle, json, requireSession, assertCanWrite, readJson, str, num, id, bad, parseCsv, nowIso } from '../lib/core.ts';
import { carrierFor } from '../lib/pack.ts';
import { ensureSchema } from '../lib/migrate.ts';

export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  await ensureSchema(ctx.env.DB);
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status') || 'open';
  const stmt = status === 'all'
    ? ctx.env.DB.prepare('select * from orders where account_id = ?1 order by created_at desc limit 500').bind(s.account_id)
    : ctx.env.DB.prepare('select * from orders where account_id = ?1 and status = ?2 order by created_at desc limit 500').bind(s.account_id, status);
  const { results } = await stmt.all();
  return json({ orders: results });
});

/** POST one order (JSON) or many (CSV text in body.csv from Shopify, Etsy, Square or Stripe). */
export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const rows: Record<string, unknown>[] = [];
  if (typeof body.csv === 'string') rows.push(...mapCsv(body.csv));
  else rows.push(body);
  let inserted = 0; const skipped: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const ref = str(r.order_ref, 80); const name = str(r.customer_name, 120); const line1 = str(r.line1, 200);
    const city = str(r.city, 80); const state = str(r.state, 40); const zip = str(r.zip, 20);
    if (!ref || !name || !line1 || !city || !state || !zip) { skipped.push(ref || '(no order ref)'); continue; }
    stmts.push(ctx.env.DB.prepare(
      `insert or ignore into orders (id, account_id, order_ref, customer_name, email, line1, line2, city, state, zip, country, items, weight_oz, length_in, width_in, height_in, source)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    ).bind(id(), s.account_id, ref, name, str(r.email, 200) || null, line1, str(r.line2, 200) || null, city, state, zip,
      (str(r.country, 2) || 'US').toUpperCase(), str(r.items, 500) || null, num(r.weight_oz), num(r.length_in), num(r.width_in), num(r.height_in), str(r.source, 20) || 'manual'));
    inserted++;
  }
  if (stmts.length) await ctx.env.DB.batch(stmts);
  return json({ ok: true, inserted, skipped }, 201);
});

/** PATCH: mark shipped (with tracking) or back to open, or set weight/dims. */
export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const oid = str(body.id, 64);
  if (!oid) return bad('Which order?');
  const sets: string[] = []; const vals: unknown[] = [];
  const setIf = (k: string, v: unknown) => { sets.push(`${k} = ?${vals.length + 1}`); vals.push(v); };
  if (typeof body.status === 'string') {
    const st = str(body.status, 20);
    if (!['open', 'exported', 'shipped'].includes(st)) return bad('Bad status.');
    setIf('status', st);
    if (st === 'shipped') setIf('shipped_at', nowIso());
  }
  if (typeof body.tracking === 'string') { const tr = str(body.tracking, 80); setIf('tracking', tr || null); setIf('carrier', tr ? carrierFor(tr) : null); }
  if (typeof body.items === 'string') setIf('items', str(body.items, 500) || null);
  for (const k of ['weight_oz', 'length_in', 'width_in', 'height_in']) if (body[k] !== undefined) setIf(k, num(body[k]));
  if (!sets.length) return bad('Nothing to change.');
  vals.push(oid, s.account_id);
  const res = await ctx.env.DB.prepare(`update orders set ${sets.join(', ')} where id = ?${vals.length - 1} and account_id = ?${vals.length}`).bind(...vals).run();
  if (!res.meta.changes) return bad('Order not found.', 404);
  return json({ ok: true });
});

/** Recognise the common store exports by their headers and map to our fields. */
export function mapCsv(text: string): Record<string, unknown>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const c = {
    ref: col('name', 'order number', 'order id', 'order #', 'order', 'sale id', 'id'),
    name: col('shipping name', 'ship name', 'recipient', 'name', 'customer', 'full name', 'buyer'),
    email: col('email', 'buyer email', 'customer email'),
    line1: col('shipping address1', 'shipping address 1', 'ship address1', 'ship address 1', 'address 1', 'street 1', 'address line 1', 'shipping street'),
    line2: col('shipping address2', 'shipping address 2', 'ship address2', 'ship address 2', 'address 2', 'street 2', 'address line 2'),
    city: col('shipping city', 'ship city', 'city'),
    state: col('shipping province', 'shipping province code', 'ship state', 'state', 'province'),
    zip: col('shipping zip', 'ship zipcode', 'ship zip', 'zip', 'postal code', 'zipcode'),
    country: col('shipping country', 'shipping country code', 'ship country', 'country'),
    items: col('lineitem name', 'item name', 'items', 'description'),
    weight: col('total weight', 'weight (oz)', 'weight', 'lineitem grams'),
  };
  const source = header.includes('lineitem name') ? 'shopify' : header.includes('sale id') ? 'etsy' : 'csv';
  const byRef = new Map<string, Record<string, unknown>>();
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] || '').trim() : '');
    const ref = get(c.ref);
    if (!ref) continue;
    const existing = byRef.get(ref);
    if (existing) { // Shopify repeats the order per line item: merge items
      const prev = String(existing.items || '');
      const it = get(c.items);
      if (it && !prev.includes(it)) existing.items = prev ? `${prev}; ${it}` : it;
      continue;
    }
    let weight: number | null = null;
    const w = get(c.weight);
    if (w) { weight = Number(w); if (header[c.weight] === 'lineitem grams') weight = Math.round((weight / 28.3495) * 10) / 10; if (!Number.isFinite(weight) || weight <= 0) weight = null; }
    byRef.set(ref, {
      order_ref: ref, customer_name: get(c.name), email: get(c.email), line1: get(c.line1), line2: get(c.line2),
      city: get(c.city), state: get(c.state), zip: get(c.zip), country: get(c.country) || 'US', items: get(c.items), weight_oz: weight, source,
    });
  }
  return [...byRef.values()];
}
