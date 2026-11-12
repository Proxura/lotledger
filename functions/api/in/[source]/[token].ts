import { json, id, str } from '../../../lib/core.ts';
import { ensureSchema } from '../../../lib/migrate.ts';
import { packOrder } from '../../../lib/packOrder.ts';

/** Inbound orders. The merchant pastes
 *    https://<host>/api/in/stripe/<inbound_token>   into Stripe  → Developers → Webhooks (checkout.session.completed)
 *    https://<host>/api/in/shopify/<inbound_token>  into Shopify → Settings → Notifications → Webhooks (Order payment)
 *  The token is the credential: 128 random bits in a URL only the merchant and the platform see. A paid order is
 *  inserted (once; the source's own order id is the dedupe key) and packed from the oldest lots if every line
 *  can be filled. Anything that cannot be packed stays open with the reason in the notes so a person sees it. */

type Env = { DB: D1Database };
type Ctx = { request: Request; env: Env; params: { source: string; token: string } };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env, params } = ctx;
  const source = params.source;
  if (source !== 'stripe' && source !== 'shopify') return json({ error: 'Unknown source.' }, 404);
  if (!/^[a-f0-9]{32}$/.test(params.token)) return json({ error: 'Not found.' }, 404);
  await ensureSchema(env.DB);
  const acct = await env.DB.prepare('select id, stripe_read_key from accounts where inbound_token = ?1').bind(params.token).first<{ id: string; stripe_read_key: string | null }>();
  if (!acct) return json({ error: 'Not found.' }, 404);
  const rawText = await request.text();
  let payload: any;
  try { payload = JSON.parse(rawText); } catch { return json({ error: 'Body is not JSON.' }, 400); }

  const order = source === 'stripe' ? await fromStripe(payload, acct.stripe_read_key) : fromShopify(payload);
  if (!order) return json({ received: true, ignored: true });            // an event we do not act on; 200 so the sender does not retry

  const oid = id();
  const ins = await env.DB.prepare(
    `insert or ignore into orders (id, account_id, order_ref, customer_name, email, line1, line2, city, state, zip, country, items, source, raw)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(oid, acct.id, order.ref, order.name, order.email, order.line1, order.line2, order.city, order.state, order.zip, order.country, order.items, source, rawText.slice(0, 20000)).run();
  if (!ins.meta.changes) return json({ received: true, duplicate: true });

  let packed: string | null = null; let note: string | null = null;
  if (order.items) {
    const r = await packOrder(env.DB, acct.id, { id: oid, order_ref: order.ref, items: order.items, packed: null, status: 'open' }, order.items);
    if (r.ok) packed = r.packed.map((a) => `${a.lot_code} x${a.units}`).join(', ');
    else note = `Not packed automatically: ${r.error}`;
  } else {
    note = 'Not packed automatically: the order arrived without line items.';
  }
  if (note) await env.DB.prepare('update orders set notes = ?1 where id = ?2').bind(note, oid).run();
  return json({ received: true, order_ref: order.ref, packed, note });
}

type Inbound = { ref: string; name: string; email: string | null; line1: string; line2: string | null; city: string; state: string; zip: string; country: string; items: string | null };

async function fromStripe(ev: any, readKey: string | null): Promise<Inbound | null> {
  if (ev?.type !== 'checkout.session.completed') return null;
  const s = ev.data?.object; if (!s || s.payment_status !== 'paid') return null;
  const ship = s.shipping_details?.address || s.collected_information?.shipping_details?.address || s.customer_details?.address || {};
  const name = s.shipping_details?.name || s.collected_information?.shipping_details?.name || s.customer_details?.name || 'Customer';
  let items: string | null = null;
  // Line items are not in the event. With a merchant-supplied read key we fetch them; otherwise metadata may carry them.
  if (typeof s.metadata?.items === 'string' && s.metadata.items.trim()) items = str(s.metadata.items, 500);
  else if (readKey) {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${s.id}/line_items?limit=100`, { headers: { authorization: `Bearer ${readKey}` } });
    if (r.ok) {
      const li = (await r.json()) as { data: { quantity: number; description: string }[] };
      items = li.data.map((x) => `${x.quantity} x ${x.description}`).join('; ').slice(0, 500) || null;
    }
  }
  return {
    ref: s.metadata?.order_ref || (s.payment_intent ? `#${String(s.payment_intent).slice(-6).toUpperCase()}` : `#${String(s.id).slice(-6).toUpperCase()}`),
    name: str(name, 120) || 'Customer', email: str(s.customer_details?.email, 200) || null,
    line1: str(ship.line1, 200) || '(no address)', line2: str(ship.line2, 200) || null,
    city: str(ship.city, 80) || '', state: str(ship.state, 40) || '', zip: str(ship.postal_code, 20) || '', country: (str(ship.country, 2) || 'US').toUpperCase(),
    items,
  };
}

function fromShopify(o: any): Inbound | null {
  if (!o || !o.id || !Array.isArray(o.line_items)) return null;
  if (o.financial_status && !['paid', 'partially_refunded'].includes(o.financial_status)) return null;
  const a = o.shipping_address || o.billing_address || {};
  const items = o.line_items.map((li: any) => `${li.quantity} x ${li.title}${li.variant_title && li.variant_title !== 'Default Title' ? ' - ' + li.variant_title : ''}`).join('; ').slice(0, 500);
  return {
    ref: str(o.name, 80) || `#${o.order_number || o.id}`,
    name: str(a.name || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' '), 120) || 'Customer',
    email: str(o.email || o.contact_email, 200) || null,
    line1: str(a.address1, 200) || '(no address)', line2: str(a.address2, 200) || null,
    city: str(a.city, 80) || '', state: str(a.province_code || a.province, 40) || '', zip: str(a.zip, 20) || '', country: (str(a.country_code, 2) || 'US').toUpperCase(),
    items: items || null,
  };
}
