import { handle, json, getSession } from '../lib/core.ts';

export const onRequestGet = handle(async ({ request, env }) => {
  const s = await getSession(env, request);
  if (!s) return json({ signedIn: false });
  const acct = await env.DB.prepare('select id, name, plan, trial_ends_at, lot_prefix, lot_next, lot_step from accounts where id = ?1')
    .bind(s.account_id).first();
  return json({ signedIn: true, email: s.email, account: acct });
});
