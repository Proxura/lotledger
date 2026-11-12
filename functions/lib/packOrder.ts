import { id, nowIso } from './core.ts';
import { parseItems, matchProduct, allocateFifo, expandKits, type Product, type LotRow, type Alloc } from './pack.ts';

export type OrderRow = { id: string; order_ref: string; items: string | null; packed: string | null; status: string };
export type PackResult =
  | { ok: true; packed: Alloc[] }
  | { ok: false; status: number; error: string; unmatched?: string[]; short?: { product_name: string; need: number; have: number }[] };

/** Pack an order from its items line, oldest active lot first. Used by the Pack button and by
 *  inbound webhooks. Writes nothing unless every line can be filled. */
export async function packOrder(db: D1Database, accountId: string, order: OrderRow, itemsText: string): Promise<PackResult> {
  if (order.packed) return { ok: false, status: 400, error: 'Already packed. Unpack it first to change the lots.' };
  if (!itemsText.trim()) return { ok: false, status: 400, error: 'This order has no items line. Add one like "2 x Fresh Milled Flour".' };
  const { results: products } = await db.prepare('select id, name, unit_label, components from products where account_id = ?1 and active = 1').bind(accountId).all<Product>();
  const parsed = parseItems(itemsText);
  for (const l of parsed) l.product = matchProduct(l.text, products);
  const lines = expandKits(parsed, products);
  const unmatched = lines.filter((l) => !l.product).map((l) => l.text);
  if (unmatched.length) return { ok: false, status: 409, error: `No product called ${unmatched.map((u) => `"${u}"`).join(', ')}. Fix the items line or add the product.`, unmatched };
  const { results: lots } = await db.prepare('select id, code, product_id, made_at, units_made, units_out, status from lots where account_id = ?1').bind(accountId).all<LotRow>();
  const r = allocateFifo(lines, lots);
  if (!r.ok) return { ok: false, status: 409, error: r.short.map((x) => `${x.product_name}: need ${x.need}, only ${x.have} on hand`).join('. ') + '.', short: r.short };

  const stmts: D1PreparedStatement[] = [];
  const moveIds: string[] = [];
  for (const a of r.allocs) {
    const mid = id(); moveIds.push(mid);
    stmts.push(db.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(mid, accountId, a.lot_id, 'sale', a.units, `Packed ${order.order_ref}`, order.order_ref));
    stmts.push(db.prepare("update lots set units_out = units_out + ?1, updated_at = ?2, status = case when units_out + ?1 >= units_made and status = 'active' then 'sold_out' else status end where id = ?3 and account_id = ?4 and status = 'active' and units_out + ?1 <= units_made")
      .bind(a.units, nowIso(), a.lot_id, accountId));
  }
  stmts.push(db.prepare('update orders set packed = ?1, packed_at = ?2, items = ?3 where id = ?4').bind(JSON.stringify(r.allocs), nowIso(), itemsText, order.id));
  const res = await db.batch(stmts);
  // Each lot update carries a guard. A guard that matched nothing means the lot moved between the read and the
  // write, so put back exactly what this call wrote and report it, rather than leave a half-packed order.
  const failed = r.allocs.filter((_, i) => !res[i * 2 + 1].meta.changes);
  if (failed.length) {
    const undo: D1PreparedStatement[] = [];
    r.allocs.forEach((a, i) => {
      if (res[i * 2 + 1].meta.changes) undo.push(db.prepare("update lots set units_out = units_out - ?1, status = case when status = 'sold_out' and units_out - ?1 < units_made then 'active' else status end where id = ?2").bind(a.units, a.lot_id));
    });
    undo.push(db.prepare(`delete from lot_moves where id in (${moveIds.map((_, i) => `?${i + 1}`).join(',')})`).bind(...moveIds));
    undo.push(db.prepare('update orders set packed = null, packed_at = null where id = ?1').bind(order.id));
    await db.batch(undo);
    return { ok: false, status: 409, error: `${failed.map((a) => a.lot_code).join(', ')} changed while packing. Reload and try again.` };
  }
  return { ok: true, packed: r.allocs };
}

/** Put a packed order's units back on their lots. */
export async function unpackOrder(db: D1Database, accountId: string, order: OrderRow): Promise<PackResult> {
  if (!order.packed) return { ok: false, status: 400, error: 'This order is not packed.' };
  const allocs = JSON.parse(order.packed) as Alloc[];
  const stmts: D1PreparedStatement[] = [];
  for (const a of allocs) {
    stmts.push(db.prepare('insert into lot_moves (id, account_id, lot_id, kind, units, note, order_ref) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(id(), accountId, a.lot_id, 'return', -a.units, `Unpacked ${order.order_ref}`, order.order_ref));
    stmts.push(db.prepare("update lots set units_out = max(0, units_out - ?1), updated_at = ?2, status = case when status = 'sold_out' then 'active' else status end where id = ?3 and account_id = ?4")
      .bind(a.units, nowIso(), a.lot_id, accountId));
  }
  stmts.push(db.prepare('update orders set packed = null, packed_at = null where id = ?1').bind(order.id));
  await db.batch(stmts);
  return { ok: true, packed: allocs };
}
