import { handle, json, getSession } from '../lib/core.ts';
import { ensureSchema } from '../lib/migrate.ts';

export const onRequestGet = handle(async ({ request, env }) => {
  const s = await getSession(env, request);
  if (!s) return json({ signedIn: false });
  await ensureSchema(env.DB);
  const acct = await env.DB.prepare("select id, name, plan, trial_ends_at, lot_prefix, lot_next, lot_step, inbound_token, public_token, public_line, (stripe_read_key is not null) as has_stripe_read_key from accounts where id = ?1")
    .bind(s.account_id).first();
  return json({ signedIn: true, email: s.email, account: acct });
});
