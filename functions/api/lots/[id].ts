import { handle, json, requireSession, assertCanWrite, readJson, str, int, id, bad, isDate, nowIso } from '../../lib/core.ts';

const KINDS = new Set(['sale', 'market', 'sample', 'shrink', 'recount', 'return']);

export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const lotId = String(ctx.params.id);
  const lot = await ctx.env.DB.prepare(
    `select l.*, p.name as product_name, p.unit_label, (l.units_made - l.units_out) as units_left
       from lots l join products p on p.id = l.product_id where l.id = ?1 and l.account_id = ?2`,
  ).bind(lotId, s.account_id).first();
  if (!lot) return bad('Lot not found.', 404);
  const { results: moves } = await ctx.env.DB.prepare('select * from lot_moves where lot_id = ?1 order by created_at desc').bind(lotId).all();
  return json({ lot, moves });
});

/** Record units leaving (or returning to) a lot, or edit lot details, or change status. */
export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  const lotId = String(ctx.params.id);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const lot = await ctx.env.DB.prepare('select * from lots where id = ?1 and account_id = ?2').bind(lotId, s.account_id)
    .first<{ units_made: number; units_out: number; status: string }>();
  if (!lot) return bad('Lot not found.', 404);

  const stmts: D1PreparedStatement[] = [];

  // 1. A movement of units.
  if (body.move && typeof body.move === 'object') {
    const m = body.move as Record<string, unknown>;
    const kind = str(m.kind, 20);
    const units = int(m.units);
    if (!KINDS.has(kind)) return bad('Movement kind must be sale, market, sample, shrink, recount or return.');
    if (units === null || units === 0) return bad('Units must be a non-zero whole number.');
    let delta = units;
    if (kind === 'return') delta = -Math.abs(units);
    if (kind === 'recount') {
      // recount sets units_made to the new physical count plus what has gone out
      const counted = Math.abs(units);
      const newMade = counted + lot.units_out;
      stmts.push(ctx.env.DB.prepare('update lots set units_made = ?1, updated_at = ?2 where id = ?3').bind(newMade, nowIso(), lotId));
      stmts.push(ctx.env.DB.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note) values (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(id(), s.account_id, lotId, 'recount', newMade - lot.units_made, str(m.note, 500) || `Recounted: ${counted} on hand`));
    } else {
      const newOut = lot.units_out + delta;
      if (newOut < 0) return bad('That would return more units than ever left this lot.');
      if (newOut > lot.units_made) return bad(`Only ${lot.units_made - lot.units_out} left in this lot.`);
      stmts.push(ctx.env.DB.prepare('update lots set units_out = ?1, updated_at = ?2, status = case when ?1 >= units_made and status = \'active\' then \'sold_out\' else status end where id = ?3')
        .bind(newOut, nowIso(), lotId));
      stmts.push(ctx.env.DB.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(id(), s.account_id, lotId, kind, delta, str(m.note, 500) || null, str(m.order_ref, 80) || null));
    }
  }

  // 2. Field edits.
  const sets: string[] = [];
  const vals: unknown[] = [];
  const setIf = (key: string, val: unknown) => { sets.push(`${key} = ?${vals.length + 1}`); vals.push(val); };
  if (typeof body.best_by === 'string') { if (body.best_by && !isDate(body.best_by)) return bad('Best-by must be YYYY-MM-DD.'); setIf('best_by', body.best_by || null); }
  if (typeof body.made_at === 'string' && isDate(body.made_at)) setIf('made_at', body.made_at);
  for (const k of ['unit_size', 'supplier', 'inputs', 'notes']) if (typeof body[k] === 'string') setIf(k, str(body[k], 2000) || null);
  if (typeof body.status === 'string') {
    const st = str(body.status, 20);
    if (!['active', 'sold_out', 'hold', 'retired'].includes(st)) return bad('Bad status.');
    setIf('status', st);
    setIf('hold_reason', st === 'hold' ? (str(body.hold_reason, 500) || 'On hold') : null);
  }
  if (sets.length) {
    setIf('updated_at', nowIso());
    vals.push(lotId, s.account_id);
    stmts.push(ctx.env.DB.prepare(`update lots set ${sets.join(', ')} where id = ?${vals.length - 1} and account_id = ?${vals.length}`).bind(...vals));
  }
  if (!stmts.length) return bad('Nothing to change.');
  await ctx.env.DB.batch(stmts);
  const fresh = await ctx.env.DB.prepare('select *, (units_made - units_out) as units_left from lots where id = ?1').bind(lotId).first();
  return json({ ok: true, lot: fresh });
});
