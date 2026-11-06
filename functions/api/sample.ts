import { handle, json, requireSession, assertCanWrite, id, addDaysDate, dateOnly, nowIso } from '../lib/core.ts';
import { ensureSchema } from '../lib/migrate.ts';

/** POST loads a small set of sample products, lots, movements and orders, all marked sample=1.
 *  DELETE removes exactly those rows and nothing else. Both are safe to run more than once. */

const PRODUCTS = [
  { key: 'soap', name: 'Lavender Bar Soap', unit_label: 'bar', shelf_life_days: 365 },
  { key: 'candle', name: 'Soy Candle, 8 oz', unit_label: 'jar', shelf_life_days: null },
  { key: 'jam', name: 'Strawberry Jam', unit_label: 'jar', shelf_life_days: 365 },
];

export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const already = await ctx.env.DB.prepare('select count(*) as n from products where account_id = ?1 and sample = 1').bind(s.account_id).first<{ n: number }>();
  if (already && already.n > 0) return json({ ok: true, loaded: false });

  const acct = await ctx.env.DB.prepare('select lot_prefix, lot_next, lot_step from accounts where id = ?1').bind(s.account_id).first<{ lot_prefix: string; lot_next: number; lot_step: number }>();
  if (!acct) return json({ error: 'Account not found.' }, 404);
  let next = acct.lot_next;
  const code = () => { const c = `${acct.lot_prefix}${next}`; next += acct.lot_step; return c; };
  const today = dateOnly();
  const ago = (d: number) => addDaysDate(today, -d);
  const pid: Record<string, string> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const p of PRODUCTS) {
    pid[p.key] = id();
    stmts.push(ctx.env.DB.prepare('insert into products (id, account_id, name, unit_label, shelf_life_days, sample) values (?1, ?2, ?3, ?4, ?5, 1)')
      .bind(pid[p.key], s.account_id, p.name, p.unit_label, p.shelf_life_days));
  }
  type L = { key: string; made: number; units: number; size: string; supplier: string; inputs: string; out: { kind: string; units: number; note: string }[] };
  const LOTS: L[] = [
    { key: 'soap', made: 75, units: 40, size: '4.5 oz', supplier: 'Bramble Berry', inputs: 'olive oil, coconut oil, lye, lavender EO lot L-311', out: [{ kind: 'sale', units: 18, note: '#1021' }, { kind: 'market', units: 12, note: 'Saturday market' }] },
    { key: 'soap', made: 12, units: 40, size: '4.5 oz', supplier: 'Bramble Berry', inputs: 'olive oil, coconut oil, lye, lavender EO lot L-340', out: [] },
    { key: 'candle', made: 30, units: 24, size: '8 oz', supplier: 'CandleScience', inputs: 'soy wax 464 lot 2251, cotton wick CD-12', out: [{ kind: 'sale', units: 9, note: '#1024' }] },
    { key: 'jam', made: 50, units: 30, size: '8 oz', supplier: 'Hill Farm berries', inputs: '12 lb strawberries, cane sugar, pectin', out: [{ kind: 'sale', units: 14, note: '#1019' }, { kind: 'sample', units: 2, note: 'tasting' }] },
  ];
  const lotIds: string[] = [];
  for (const l of LOTS) {
    const lid = id(); lotIds.push(lid);
    const made = ago(l.made);
    const prod = PRODUCTS.find((p) => p.key === l.key)!;
    const outUnits = l.out.reduce((n, o) => n + o.units, 0);
    stmts.push(ctx.env.DB.prepare('insert into lots (id, account_id, product_id, code, made_at, best_by, units_made, units_out, unit_size, supplier, inputs, sample) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)')
      .bind(lid, s.account_id, pid[l.key], code(), made, prod.shelf_life_days ? addDaysDate(made, prod.shelf_life_days) : null, l.units, outUnits, l.size, l.supplier, l.inputs));
    for (const o of l.out) {
      stmts.push(ctx.env.DB.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(id(), s.account_id, lid, o.kind, o.units, o.note, o.note.startsWith('#') ? o.note : null));
    }
  }
  stmts.push(ctx.env.DB.prepare('update accounts set lot_next = ?1 where id = ?2').bind(next, s.account_id));
  const ORDERS = [
    { ref: '#1031', name: 'Dana Whitfield', line1: '118 Oak St', city: 'Mount Pleasant', state: 'MI', zip: '48858', items: '2 x Lavender Bar Soap; 1 x Strawberry Jam', w: 22 },
    { ref: '#1032', name: 'Marcus Lee', line1: '907 Birch Ave', line2: 'Apt 2', city: 'Grand Rapids', state: 'MI', zip: '49503', items: '1 x Soy Candle, 8 oz', w: 14 },
    { ref: '#1033', name: 'Priya Natarajan', line1: '41 Lakeshore Dr', city: 'Traverse City', state: 'MI', zip: '49684', items: '3 x Lavender Bar Soap', w: null },
  ];
  for (const o of ORDERS) {
    stmts.push(ctx.env.DB.prepare('insert into orders (id, account_id, order_ref, customer_name, line1, line2, city, state, zip, items, weight_oz, source, sample) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1)')
      .bind(id(), s.account_id, o.ref, o.name, o.line1, (o as { line2?: string }).line2 || null, o.city, o.state, o.zip, o.items, o.w, 'sample'));
  }
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, loaded: true, products: PRODUCTS.length, lots: LOTS.length, orders: ORDERS.length, at: nowIso() }, 201);
});

export const onRequestDelete = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const res = await ctx.env.DB.batch([
    ctx.env.DB.prepare('delete from lot_moves where account_id = ?1 and lot_id in (select id from lots where account_id = ?1 and sample = 1)').bind(s.account_id),
    ctx.env.DB.prepare('delete from lots where account_id = ?1 and sample = 1').bind(s.account_id),
    ctx.env.DB.prepare('delete from orders where account_id = ?1 and sample = 1').bind(s.account_id),
    ctx.env.DB.prepare('delete from products where account_id = ?1 and sample = 1').bind(s.account_id),
  ]);
  return json({ ok: true, removed: { moves: res[0].meta.changes, lots: res[1].meta.changes, orders: res[2].meta.changes, products: res[3].meta.changes } });
});
