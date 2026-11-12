import { handle, json, requireSession, assertCanWrite, readJson, str, bad } from '../../lib/core.ts';
import { ensureSchema } from '../../lib/migrate.ts';
import { packOrder, unpackOrder, type OrderRow } from '../../lib/packOrder.ts';

/** POST { id } packs an order from its items line, oldest lot first. POST { id, undo: true } puts the units back. */
export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<Record<string, unknown>>(ctx.request);
  const oid = str(body.id, 64);
  if (!oid) return bad('Which order?');
  const order = await ctx.env.DB.prepare('select id, order_ref, items, packed, status from orders where id = ?1 and account_id = ?2').bind(oid, s.account_id).first<OrderRow>();
  if (!order) return bad('Order not found.', 404);
  if (body.undo === true) {
    const r = await unpackOrder(ctx.env.DB, s.account_id, order);
    return r.ok ? json({ ok: true, unpacked: r.packed }) : json({ error: r.error }, r.status);
  }
  const itemsText = typeof body.items === 'string' ? str(body.items, 500) : (order.items || '');
  const r = await packOrder(ctx.env.DB, s.account_id, order, itemsText);
  return r.ok ? json({ ok: true, packed: r.packed }) : json({ error: r.error, unmatched: r.unmatched, short: r.short }, r.status);
});
