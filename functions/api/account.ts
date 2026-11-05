import { handle, json, requireSession, readJson, str, int, bad } from '../lib/core.ts';

export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const body = await readJson<{ name?: string; lot_prefix?: string; lot_next?: number; lot_step?: number }>(ctx.request);
  const name = str(body.name, 120);
  const prefix = str(body.lot_prefix, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const next = int(body.lot_next);
  const step = int(body.lot_step);
  if (step !== null && (step < 1 || step > 1000)) return bad('Lot step must be between 1 and 1000.');
  await ctx.env.DB.prepare(
    'update accounts set name = coalesce(nullif(?1, \'\'), name), lot_prefix = coalesce(nullif(?2, \'\'), lot_prefix), lot_next = coalesce(?3, lot_next), lot_step = coalesce(?4, lot_step) where id = ?5',
  ).bind(name, prefix, next, step, s.account_id).run();
  const acct = await ctx.env.DB.prepare('select id, name, plan, trial_ends_at, lot_prefix, lot_next, lot_step from accounts where id = ?1').bind(s.account_id).first();
  return json({ ok: true, account: acct });
});
