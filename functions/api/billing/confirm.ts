import { handle, json, requireSession, bad, str, planFromMeta } from '../../lib/core.ts';

/** GET ?session_id= after Checkout returns. Asks Stripe for the session with the secret key and,
 *  if it is paid and belongs to this account, flips the plan. The webhook does the same thing
 *  whenever it fires; this path makes the account paid the moment the customer lands back,
 *  and still works if the webhook is late or its secret is missing. */
export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  if (!ctx.env.STRIPE_SECRET_KEY) return bad('Billing is not configured yet.', 503);
  const sid = str(new URL(ctx.request.url).searchParams.get('session_id'), 120);
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) return bad('Bad session id.');
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, { headers: { authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` } });
  const sess = (await r.json()) as Record<string, any>;
  if (!r.ok) return bad(sess?.error?.message || 'Stripe refused.', 502);
  const owner = sess.client_reference_id || sess.metadata?.account_id;
  if (owner !== s.account_id) return bad('That payment is not for this account.', 403);
  const paid = sess.payment_status === 'paid' || (sess.mode === 'subscription' && sess.status === 'complete');
  if (!paid) return json({ ok: true, paid: false, status: sess.payment_status });
  const plan = planFromMeta(sess.metadata?.plan);
  await ctx.env.DB.prepare('update accounts set plan = ?1, stripe_customer_id = coalesce(?2, stripe_customer_id) where id = ?3')
    .bind(plan, typeof sess.customer === 'string' ? sess.customer : null, s.account_id).run();
  return json({ ok: true, paid: true, plan });
});
