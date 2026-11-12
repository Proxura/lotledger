import { handle, json, requireSession, readJson, str, int, bad } from '../lib/core.ts';
import { ensureSchema, token } from '../lib/migrate.ts';

export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<{ name?: string; lot_prefix?: string; lot_next?: number; lot_step?: number; public_line?: string; stripe_read_key?: string; rotate?: 'inbound' | 'public' }>(ctx.request);
  if (body.rotate === 'inbound' || body.rotate === 'public') {
    // A new token kills every URL that carried the old one. That is the point.
    await ctx.env.DB.prepare(`update accounts set ${body.rotate}_token = ?1 where id = ?2`).bind(token(), s.account_id).run();
  }
  if (typeof body.public_line === 'string') await ctx.env.DB.prepare('update accounts set public_line = ?1 where id = ?2').bind(str(body.public_line, 160) || null, s.account_id).run();
  if (typeof body.stripe_read_key === 'string') {
    const k = body.stripe_read_key.trim();
    if (k && !/^rk_(live|test)_[A-Za-z0-9]+$/.test(k)) return bad('That is not a restricted key. In Stripe make a key with read access to Checkout Sessions only; it starts with rk_.');
    await ctx.env.DB.prepare('update accounts set stripe_read_key = ?1 where id = ?2').bind(k || null, s.account_id).run();
  }
  const name = str(body.name, 120);
  const prefix = str(body.lot_prefix, 8).toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const next = int(body.lot_next);
  const step = int(body.lot_step);
  if (step !== null && (step < 1 || step > 1000)) return bad('Lot step must be between 1 and 1000.');
  await ctx.env.DB.prepare(
    'update accounts set name = coalesce(nullif(?1, \'\'), name), lot_prefix = coalesce(nullif(?2, \'\'), lot_prefix), lot_next = coalesce(?3, lot_next), lot_step = coalesce(?4, lot_step) where id = ?5',
  ).bind(name, prefix, next, step, s.account_id).run();
  const acct = await ctx.env.DB.prepare("select id, name, plan, trial_ends_at, lot_prefix, lot_next, lot_step, inbound_token, public_token, public_line, (stripe_read_key is not null) as has_stripe_read_key from accounts where id = ?1").bind(s.account_id).first();
  return json({ ok: true, account: acct });
});
