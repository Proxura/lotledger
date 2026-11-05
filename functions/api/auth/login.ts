import { handle, readJson, bad, json, verifyPassword, createSession, sessionCookie, SESSION_DAYS, str } from '../../lib/core.ts';

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson<{ email?: string; password?: string }>(request);
  const email = str(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await env.DB.prepare('select id, account_id, pw_hash from users where email = ?1').bind(email)
    .first<{ id: string; account_id: string; pw_hash: string }>();
  if (!user || !(await verifyPassword(password, user.pw_hash))) return bad('Email or password did not match.', 401);
  const sid = await createSession(env, user.id, user.account_id);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
});
