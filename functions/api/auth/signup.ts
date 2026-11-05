import { handle, readJson, bad, json, id, hashPassword, createSession, sessionCookie, addDays, nowIso, TRIAL_DAYS, SESSION_DAYS, str } from '../../lib/core.ts';

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson<{ email?: string; password?: string; business?: string }>(request);
  const email = str(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const business = str(body.business, 120) || 'My shop';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('Enter a valid email address.');
  if (password.length < 10) return bad('Use a password of at least 10 characters.');
  const existing = await env.DB.prepare('select id from users where email = ?1').bind(email).first();
  if (existing) return bad('That email already has an account. Sign in instead.', 409);

  const accountId = id();
  const userId = id();
  const prefix = business.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'LOT';
  await env.DB.batch([
    env.DB.prepare('insert into accounts (id, name, plan, trial_ends_at, lot_prefix) values (?1, ?2, ?3, ?4, ?5)')
      .bind(accountId, business, 'trial', addDays(nowIso(), TRIAL_DAYS), prefix),
    env.DB.prepare('insert into users (id, account_id, email, pw_hash) values (?1, ?2, ?3, ?4)')
      .bind(userId, accountId, email, await hashPassword(password)),
  ]);
  const sid = await createSession(env, userId, accountId);
  return json({ ok: true, account: { id: accountId, name: business, plan: 'trial' } }, 201, { 'set-cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
});
