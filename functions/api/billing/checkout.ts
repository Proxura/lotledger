import { handle, json, requireSession, readJson, str, bad } from '../../lib/core.ts';

/** Start a Stripe Checkout session for the lifetime ($149 one-time) or monthly ($19) plan. */
export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const { env } = ctx;
  if (!env.STRIPE_SECRET_KEY) return bad('Billing is not configured yet.', 503);
  const body = await readJson<{ plan?: string }>(ctx.request);
  const plan = str(body.plan, 20);
  const price = plan === 'lifetime' ? env.STRIPE_PRICE_LIFETIME : plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : '';
  if (!price) return bad('Pick lifetime or monthly.');
  const appUrl = env.APP_URL || new URL(ctx.request.url).origin;
  const form = new URLSearchParams({
    mode: plan === 'lifetime' ? 'payment' : 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/app/?paid=1`,
    cancel_url: `${appUrl}/app/?paid=0`,
    customer_email: s.email,
    client_reference_id: s.account_id,
    'metadata[account_id]': s.account_id,
    'metadata[plan]': plan,
    allow_promotion_codes: 'true',
  });
  if (plan === 'monthly') form.set('subscription_data[metadata][account_id]', s.account_id);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await res.json<{ url?: string; error?: { message?: string } }>();
  if (!res.ok || !data.url) return bad(`Stripe: ${data.error?.message || 'could not start checkout'}`, 502);
  return json({ url: data.url });
});
