import { json, canConnect } from '../../../lib/core.ts';
import { ensureSchema } from '../../../lib/migrate.ts';

/** Public, read-only. A storefront reads this to show available / sold out / next batch per product.
 *    GET /api/public/<public_token>/availability
 *  Returns the three states and nothing else: no unit counts leave this endpoint, ever. The
 *  storefront_id is the id the shop uses for the product (set on the product in LotLedger), so a
 *  site can match rows without knowing LotLedger's ids. */
type Env = { DB: D1Database };
type Ctx = { request: Request; env: Env; params: { token: string } };

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'public, max-age=60' };

export async function onRequestOptions(): Promise<Response> { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  if (!/^[a-f0-9]{32}$/.test(ctx.params.token)) return json({ error: 'Not found.' }, 404, CORS);
  await ensureSchema(ctx.env.DB);
  const acct = await ctx.env.DB.prepare('select id, name, plan, trial_ends_at from accounts where public_token = ?1').bind(ctx.params.token).first<{ id: string; name: string; plan: string; trial_ends_at: string }>();
  if (!acct) return json({ error: 'Not found.' }, 404, CORS);
  if (!canConnect(acct.plan, acct.trial_ends_at)) return json({ error: 'The availability feed is part of the Connected plan.' }, 402, CORS);
  const { results } = await ctx.env.DB.prepare(
    `select p.id, p.name, p.storefront_id, p.next_batch_at,
            (select count(*) from lots l where l.product_id = p.id and l.status = 'active' and l.units_out < l.units_made) as live_lots
     from products p where p.account_id = ?1 and p.active = 1 and p.components is null order by p.name`,
  ).bind(acct.id).all<{ id: string; name: string; storefront_id: string | null; next_batch_at: string | null; live_lots: number }>();
  const products = results.map((p) => ({
    id: p.storefront_id || p.id,
    name: p.name,
    state: p.live_lots > 0 ? 'available' : 'sold_out',
    next_batch: p.live_lots > 0 ? null : (p.next_batch_at || null),
  }));
  return json({ maker: acct.name, published_at: new Date().toISOString(), products }, 200, CORS);
}
