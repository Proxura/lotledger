import { handle, json, bad, planFromMeta } from '../../lib/core.ts';

/** Stripe webhook: checkout.session.completed flips the account to lifetime or monthly;
 *  customer.subscription.deleted drops a monthly account back to free (read-only). */
export const onRequestPost = handle(async ({ request, env }) => {
  if (!env.STRIPE_WEBHOOK_SECRET) return bad('Webhook not configured.', 503);
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  if (!(await verify(payload, sig, env.STRIPE_WEBHOOK_SECRET))) return bad('Bad signature.', 400);
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, any> } };
  const obj = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const accountId = obj.client_reference_id || obj.metadata?.account_id;
    const plan = planFromMeta(obj.metadata?.plan);
    if (accountId) {
      await env.DB.prepare('update accounts set plan = ?1, stripe_customer_id = coalesce(?2, stripe_customer_id) where id = ?3')
        .bind(plan, typeof obj.customer === 'string' ? obj.customer : null, accountId).run();
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const accountId = obj.metadata?.account_id;
    if (accountId) await env.DB.prepare("update accounts set plan = 'free' where id = ?1 and plan in ('monthly', 'connected')").bind(accountId).run();
  }
  return json({ received: true });
});

async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t; const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
