import { handle, json, requireSession, assertCanWrite, readJson, str, int, id, bad, isDate, addDaysDate, dateOnly, nowIso } from '../../lib/core.ts';
import { ensureSchema } from '../../lib/migrate.ts';

export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const url = new URL(ctx.request.url);
  const status = url.searchParams.get('status') || 'active';
  const where = status === 'all' ? '' : ' and l.status = ?2';
  const stmt = ctx.env.DB.prepare(
    `select l.*, p.name as product_name, p.unit_label, (l.units_made - l.units_out) as units_left
       from lots l join products p on p.id = l.product_id
      where l.account_id = ?1${where}
      order by case when l.best_by is null then 1 else 0 end, l.best_by, l.made_at desc`,
  );
  const { results } = await (status === 'all' ? stmt.bind(s.account_id) : stmt.bind(s.account_id, status)).all();
  const today = dateOnly();
  const soon = addDaysDate(today, 30);
  const rows = (results as Record<string, unknown>[]).map((r) => ({
    ...r,
    sell_soon: !!r.best_by && (r.best_by as string) <= soon && (r.best_by as string) >= today,
    expired: !!r.best_by && (r.best_by as string) < today,
  }));
  return json({ lots: rows, today });
});

export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const productId = str(body.product_id, 64);
  const product = await ctx.env.DB.prepare('select id, shelf_life_days, components from products where id = ?1 and account_id = ?2')
    .bind(productId, s.account_id).first<{ id: string; shelf_life_days: number | null; components: string | null }>();
  if (!product) return bad('Pick a product.');
  if (product.components) return bad('That product is a kit. Log batches of its parts instead.');
  const madeAt = str(body.made_at, 10) || dateOnly();
  if (!isDate(madeAt)) return bad('Made date must be YYYY-MM-DD.');
  let bestBy = str(body.best_by, 10);
  if (bestBy && !isDate(bestBy)) return bad('Best-by date must be YYYY-MM-DD.');
  if (!bestBy && product.shelf_life_days) bestBy = addDaysDate(madeAt, product.shelf_life_days);
  const unitsMade = int(body.units_made);
  if (unitsMade === null || unitsMade < 0) return bad('Units made must be a whole number.');

  // Lot code: supplied, or the account's sequential prefix+number.
  let code = str(body.code, 40).toUpperCase();
  const acct = await ctx.env.DB.prepare('select lot_prefix, lot_next, lot_step from accounts where id = ?1')
    .bind(s.account_id).first<{ lot_prefix: string; lot_next: number; lot_step: number }>();
  if (!acct) return bad('Account missing.', 500);
  let bump = false;
  if (!code) { code = `${acct.lot_prefix}${acct.lot_next}`; bump = true; }

  const lotId = id();
  const stmts = [
    ctx.env.DB.prepare(
      `insert into lots (id, account_id, product_id, code, made_at, best_by, units_made, unit_size, supplier, inputs, notes)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(lotId, s.account_id, productId, code, madeAt, bestBy || null, unitsMade, str(body.unit_size, 40) || null,
      str(body.supplier, 200) || null, str(body.inputs, 2000) || null, str(body.notes, 2000) || null),
  ];
  if (bump) stmts.push(ctx.env.DB.prepare('update accounts set lot_next = lot_next + lot_step where id = ?1').bind(s.account_id));
  try { await ctx.env.DB.batch(stmts); }
  catch (e) {
    if (String(e).includes('UNIQUE')) return bad(`Lot code ${code} already exists. Use another.`, 409);
    throw e;
  }
  return json({ ok: true, id: lotId, code, best_by: bestBy || null, created_at: nowIso() }, 201);
});
