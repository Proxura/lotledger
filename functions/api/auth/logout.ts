import { handle, json, readCookie, sessionCookie } from '../../lib/core.ts';

export const onRequestPost = handle(async ({ request, env }) => {
  const sid = readCookie(request);
  if (sid) await env.DB.prepare('delete from sessions where id = ?1').bind(sid).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
});
