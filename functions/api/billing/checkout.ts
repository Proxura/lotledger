import { handle, json, requireSession, readJson, str, bad } from '../../lib/core.ts';

/**
 * Start a Stripe Checkout session for Solo lifetime ($149 one-time), Solo monthly
 * ($19) or Connected ($39 a month). The session is created in embedded mode, so the card form
 * renders inside our own Account page instead of bouncing the customer to a
 * stripe.com page. We return the client secret; the browser mounts it with
 * Stripe.js. Payment confirmation still arrives through the webhook.
 */
export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const { env } = ctx;
  if (!env.STRIPE_SECRET_KEY) return bad('Billing is not configured yet.', 503);
  const body = await readJson<{ plan?: string }>(ctx.request);
  const plan = str(body.plan, 20);
  const price = plan === 'lifetime' ? env.STRIPE_PRICE_LIFETIME : plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : plan === 'connected' ? env.STRIPE_PRICE_CONNECTED : '';
  if (!price) return bad('Pick a plan.');
  const appUrl = env.APP_URL || new URL(ctx.request.url).origin;
  const form = new URLSearchParams({
    ui_mode: 'embedded_page',
    mode: plan === 'lifetime' ? 'payment' : 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    return_url: `${appUrl}/app/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    customer_email: s.email,
    client_reference_id: s.account_id,
    'metadata[account_id]': s.account_id,
    'metadata[plan]': plan,
    allow_promotion_codes: 'true',
  });
  if (plan !== 'lifetime') { form.set('subscription_data[metadata][account_id]', s.account_id); form.set('subscription_data[metadata][plan]', plan); }
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await res.json<{ client_secret?: string; error?: { message?: string } }>();
  if (!res.ok || !data.client_secret) return bad(`Stripe: ${data.error?.message || 'could not start checkout'}`, 502);
  return json({ clientSecret: data.client_secret });
});
