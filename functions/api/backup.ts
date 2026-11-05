import { handle, json, requireSession, assertCanWrite, readJson, str, int, id, bad, isDate, nowIso } from '../lib/core.ts';

/** GET: full JSON backup of the account. */
export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const [products, lots, moves, orders] = await Promise.all([
    ctx.env.DB.prepare('select * from products where account_id = ?1').bind(s.account_id).all(),
    ctx.env.DB.prepare('select * from lots where account_id = ?1').bind(s.account_id).all(),
    ctx.env.DB.prepare('select * from lot_moves where account_id = ?1').bind(s.account_id).all(),
    ctx.env.DB.prepare('select * from orders where account_id = ?1').bind(s.account_id).all(),
  ]);
  return new Response(JSON.stringify({ lotledger: 1, exported_at: nowIso(), products: products.results, lots: lots.results, moves: moves.results, orders: orders.results }, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="lotledger-backup-${nowIso().slice(0, 10)}.json"` },
  });
});

/** POST: import lots from a LotLedger backup, or from the old Four Waters tracker's JSON export
 *  (products by name are created as needed; existing lot codes are skipped). */
export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const incoming = normalise(body);
  if (!incoming.length) return bad('No lots found in that file.');
  const { results: existing } = await ctx.env.DB.prepare('select id, name from products where account_id = ?1').bind(s.account_id).all<{ id: string; name: string }>();
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));
  const stmts: D1PreparedStatement[] = [];
  let created = 0;
  for (const l of incoming) {
    let pid = byName.get(l.product.toLowerCase());
    if (!pid) { pid = id(); byName.set(l.product.toLowerCase(), pid); stmts.push(ctx.env.DB.prepare('insert into products (id, account_id, name) values (?1, ?2, ?3)').bind(pid, s.account_id, l.product)); created++; }
    stmts.push(ctx.env.DB.prepare(
      `insert or ignore into lots (id, account_id, product_id, code, made_at, best_by, units_made, units_out, unit_size, supplier, inputs, notes, status)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(id(), s.account_id, pid, l.code, l.made_at, l.best_by, l.units_made, l.units_out, l.unit_size, l.supplier, l.inputs, l.notes, l.status));
  }
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, lots_seen: incoming.length, products_created: created });
});

type Lot = { product: string; code: string; made_at: string; best_by: string | null; units_made: number; units_out: number; unit_size: string | null; supplier: string | null; inputs: string | null; notes: string | null; status: string };

function normalise(body: Record<string, unknown>): Lot[] {
  const out: Lot[] = [];
  const list: unknown[] = Array.isArray(body.lots) ? body.lots : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    // LotLedger backup rows carry product_id; old tracker rows carry product/grainType/productType names.
    const product = str(r.product_name || r.product || r.productType || r.grainType || r.product_id, 120);
    const code = str(r.code || r.lotNumber || r.lot, 40).toUpperCase();
    const made = str(r.made_at || r.madeDate || r.millDate || r.date, 10);
    if (!product || !code || !isDate(made)) continue;
    const bestRaw = str(r.best_by || r.bestBy || r.bestByDate, 10);
    const made_units = int(r.units_made ?? r.unitsMade ?? r.bags ?? r.numberOfBags ?? r.units) ?? 0;
    const out_units = int(r.units_out ?? r.unitsOut ?? r.sold) ?? 0;
    out.push({
      product, code, made_at: made, best_by: isDate(bestRaw) ? bestRaw : null,
      units_made: Math.max(0, made_units), units_out: Math.min(Math.max(0, out_units), Math.max(0, made_units)),
      unit_size: str(r.unit_size || r.bagSize || r.size, 40) || null,
      supplier: str(r.supplier || r.source || r.grainSupplier, 200) || null,
      inputs: str(r.inputs || (Array.isArray(r.ingredients) ? r.ingredients.join(', ') : ''), 2000) || null,
      notes: str(r.notes || r.batchNotes, 2000) || null,
      status: ['active', 'sold_out', 'hold', 'retired'].includes(String(r.status)) ? String(r.status) : (made_units > 0 && out_units >= made_units ? 'sold_out' : 'active'),
    });
  }
  return out;
}
