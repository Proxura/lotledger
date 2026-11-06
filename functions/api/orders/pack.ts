import { handle, json, requireSession, assertCanWrite, readJson, str, id, bad, nowIso } from '../../lib/core.ts';
import { ensureSchema } from '../../lib/migrate.ts';
import { parseItems, matchProduct, allocateFifo, type Product, type LotRow, type Alloc } from '../../lib/pack.ts';

type OrderRow = { id: string; order_ref: string; items: string | null; packed: string | null; status: string };

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
    if (!order.packed) return bad('This order is not packed.');
    const allocs = JSON.parse(order.packed) as Alloc[];
    const stmts: D1PreparedStatement[] = [];
    for (const a of allocs) {
      stmts.push(ctx.env.DB.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(id(), s.account_id, a.lot_id, 'return', -a.units, `Unpacked ${order.order_ref}`, order.order_ref));
      stmts.push(ctx.env.DB.prepare("update lots set units_out = max(0, units_out - ?1), updated_at = ?2, status = case when status = 'sold_out' then 'active' else status end where id = ?3 and account_id = ?4")
        .bind(a.units, nowIso(), a.lot_id, s.account_id));
    }
    stmts.push(ctx.env.DB.prepare('update orders set packed = null, packed_at = null where id = ?1').bind(order.id));
    await ctx.env.DB.batch(stmts);
    return json({ ok: true, unpacked: allocs });
  }

  if (order.packed) return bad('Already packed. Unpack it first to change the lots.');
  const itemsText = typeof body.items === 'string' ? str(body.items, 500) : (order.items || '');
  if (!itemsText.trim()) return bad('This order has no items line. Add one like "2 x Fresh Milled Flour".');
  const { results: products } = await ctx.env.DB.prepare('select id, name, unit_label from products where account_id = ?1 and active = 1').bind(s.account_id).all<Product>();
  const lines = parseItems(itemsText);
  for (const l of lines) l.product = matchProduct(l.text, products);
  const unmatched = lines.filter((l) => !l.product).map((l) => l.text);
  if (unmatched.length) return json({ error: `No product called ${unmatched.map((u) => `"${u}"`).join(', ')}. Fix the items line or add the product.`, unmatched }, 409);
  const { results: lots } = await ctx.env.DB.prepare('select id, code, product_id, made_at, units_made, units_out, status from lots where account_id = ?1').bind(s.account_id).all<LotRow>();
  const r = allocateFifo(lines, lots);
  if (!r.ok) return json({ error: r.short.map((x) => `${x.product_name}: need ${x.need}, only ${x.have} on hand`).join('. ') + '.', short: r.short }, 409);

  const stmts: D1PreparedStatement[] = [];
  const moveIds: string[] = [];
  for (const a of r.allocs) {
    const mid = id(); moveIds.push(mid);
    stmts.push(ctx.env.DB.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(mid, s.account_id, a.lot_id, 'sale', a.units, `Packed ${order.order_ref}`, order.order_ref));
    stmts.push(ctx.env.DB.prepare("update lots set units_out = units_out + ?1, updated_at = ?2, status = case when units_out + ?1 >= units_made and status = 'active' then 'sold_out' else status end where id = ?3 and account_id = ?4 and status = 'active' and units_out + ?1 <= units_made")
      .bind(a.units, nowIso(), a.lot_id, s.account_id));
  }
  stmts.push(ctx.env.DB.prepare('update orders set packed = ?1, packed_at = ?2, items = ?3 where id = ?4').bind(JSON.stringify(r.allocs), nowIso(), itemsText, order.id));
  const res = await ctx.env.DB.batch(stmts);
  // Each lot update carries a guard. A guard that matched nothing means the lot moved between the read and the
  // write, so put back exactly what this call wrote and report it, rather than leave a half-packed order.
  const failed = r.allocs.filter((_, i) => !res[i * 2 + 1].meta.changes);
  if (failed.length) {
    const undo: D1PreparedStatement[] = [];
    r.allocs.forEach((a, i) => {
      if (res[i * 2 + 1].meta.changes) undo.push(ctx.env.DB.prepare("update lots set units_out = units_out - ?1, status = case when status = 'sold_out' and units_out - ?1 < units_made then 'active' else status end where id = ?2").bind(a.units, a.lot_id));
    });
    undo.push(ctx.env.DB.prepare(`delete from lot_moves where id in (${moveIds.map((_, i) => `?${i + 1}`).join(',')})`).bind(...moveIds));
    undo.push(ctx.env.DB.prepare('update orders set packed = null, packed_at = null where id = ?1').bind(order.id));
    await ctx.env.DB.batch(undo);
    return bad(`${failed.map((a) => a.lot_code).join(', ')} changed while packing. Reload and try again.`, 409);
  }
  return json({ ok: true, packed: r.allocs });
});
