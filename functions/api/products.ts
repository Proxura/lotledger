import { handle, json, requireSession, assertCanWrite, readJson, str, int, id, bad, isDate } from '../lib/core.ts';
import { ensureSchema } from '../lib/migrate.ts';
import { parseItems, matchProduct, type Product } from '../lib/pack.ts';

/** Turn "2 x Lavender Bar Soap\n1 x Strawberry Jam" into component rows. Empty text means not a kit.
 *  Returns a JSON string for the column, or an error message. */
async function resolveKit(db: D1Database, accountId: string, selfId: string | null, text: string): Promise<{ json: string | null } | { error: string }> {
  if (!text.trim()) return { json: null };
  const { results } = await db.prepare('select id, name, unit_label, components from products where account_id = ?1 and active = 1').bind(accountId).all<Product>();
  const lines = parseItems(text);
  if (!lines.length) return { error: 'Kit contents should be lines like "2 x Lavender Bar Soap".' };
  const comps: { product_id: string; units: number }[] = [];
  for (const l of lines) {
    const p = matchProduct(l.text, results);
    if (!p) return { error: `No product called "${l.text}". Add it first, then put it in the kit.` };
    if (p.id === selfId) return { error: 'A kit cannot contain itself.' };
    if (p.components) return { error: `${p.name} is a kit. A kit cannot contain another kit; list its parts instead.` };
    const prev = comps.find((c) => c.product_id === p.id);
    if (prev) prev.units += l.qty; else comps.push({ product_id: p.id, units: l.qty });
  }
  return { json: JSON.stringify(comps) };
}

export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  await ensureSchema(ctx.env.DB);
  const { results } = await ctx.env.DB.prepare(
    `select p.id, p.name, p.unit_label, p.shelf_life_days, p.active, p.components, p.sample, p.storefront_id, p.next_batch_at,
            (select count(*) from lots l where l.product_id = p.id and l.status = 'active') as active_lots,
            (select coalesce(sum(l.units_made - l.units_out), 0) from lots l where l.product_id = p.id and l.status = 'active') as units_on_hand
       from products p where p.account_id = ?1 order by p.active desc, p.name`,
  ).bind(s.account_id).all();
  return json({ products: results });
});

export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<{ name?: string; unit_label?: string; shelf_life_days?: number; kit?: string; storefront_id?: string; next_batch_at?: string }>(ctx.request);
  const name = str(body.name, 120);
  if (!name) return bad('Give the product a name.');
  const unit = str(body.unit_label, 40) || 'unit';
  const shelf = body.shelf_life_days === undefined || body.shelf_life_days === null || body.shelf_life_days === ('' as unknown) ? null : int(body.shelf_life_days);
  if (shelf !== null && (shelf < 1 || shelf > 3650)) return bad('Shelf life must be 1 to 3650 days.');
  const kit = await resolveKit(ctx.env.DB, s.account_id, null, typeof body.kit === 'string' ? body.kit : '');
  if ('error' in kit) return bad(kit.error);
  const pid = id();
  await ctx.env.DB.prepare('insert into products (id, account_id, name, unit_label, shelf_life_days, components, storefront_id, next_batch_at) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(pid, s.account_id, name, unit, shelf, kit.json, str(body.storefront_id, 60) || null, (body.next_batch_at && isDate(body.next_batch_at)) ? body.next_batch_at : null).run();
  return json({ ok: true, id: pid }, 201);
});

export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  await ensureSchema(ctx.env.DB);
  const body = await readJson<{ id?: string; name?: string; unit_label?: string; shelf_life_days?: number | null; active?: boolean; kit?: string; storefront_id?: string; next_batch_at?: string }>(ctx.request);
  const pid = str(body.id, 64);
  if (!pid) return bad('Which product?');
  let kitJson: string | null | undefined;
  if (typeof body.kit === 'string') {
    const kit = await resolveKit(ctx.env.DB, s.account_id, pid, body.kit);
    if ('error' in kit) return bad(kit.error);
    kitJson = kit.json;
    if (kitJson) {
      const used = await ctx.env.DB.prepare("select count(*) as n from products where account_id = ?1 and components like '%' || ?2 || '%'").bind(s.account_id, pid).first<{ n: number }>();
      if (used && used.n) return bad('This product is a part of another kit, so it cannot become a kit itself.');
    }
  }
  const name = str(body.name, 120);
  const unit = str(body.unit_label, 40);
  const shelf = body.shelf_life_days === undefined ? undefined : (body.shelf_life_days === null ? null : int(body.shelf_life_days));
  const active = typeof body.active === 'boolean' ? (body.active ? 1 : 0) : null;
  const res = await ctx.env.DB.prepare(
    `update products set name = coalesce(nullif(?1,''), name), unit_label = coalesce(nullif(?2,''), unit_label),
       shelf_life_days = case when ?3 = 1 then ?4 else shelf_life_days end, active = coalesce(?5, active),
       components = case when ?8 = 1 then ?9 else components end,
       storefront_id = case when ?10 = 1 then ?11 else storefront_id end,
       next_batch_at = case when ?12 = 1 then ?13 else next_batch_at end
     where id = ?6 and account_id = ?7`,
  ).bind(name, unit, shelf === undefined ? 0 : 1, shelf ?? null, active, pid, s.account_id, kitJson === undefined ? 0 : 1, kitJson ?? null,
    typeof body.storefront_id === 'string' ? 1 : 0, str(body.storefront_id, 60) || null,
    typeof body.next_batch_at === 'string' ? 1 : 0, (body.next_batch_at && isDate(body.next_batch_at)) ? body.next_batch_at : null).run();
  if (!res.meta.changes) return bad('Product not found.', 404);
  return json({ ok: true });
});
