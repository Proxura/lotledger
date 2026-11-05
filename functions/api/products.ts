import { handle, json, requireSession, assertCanWrite, readJson, str, int, id, bad } from '../lib/core.ts';

export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const { results } = await ctx.env.DB.prepare(
    `select p.id, p.name, p.unit_label, p.shelf_life_days, p.active,
            (select count(*) from lots l where l.product_id = p.id and l.status = 'active') as active_lots,
            (select coalesce(sum(l.units_made - l.units_out), 0) from lots l where l.product_id = p.id and l.status = 'active') as units_on_hand
       from products p where p.account_id = ?1 order by p.active desc, p.name`,
  ).bind(s.account_id).all();
  return json({ products: results });
});

export const onRequestPost = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  const body = await readJson<{ name?: string; unit_label?: string; shelf_life_days?: number }>(ctx.request);
  const name = str(body.name, 120);
  if (!name) return bad('Give the product a name.');
  const unit = str(body.unit_label, 40) || 'unit';
  const shelf = body.shelf_life_days === undefined || body.shelf_life_days === null || body.shelf_life_days === ('' as unknown) ? null : int(body.shelf_life_days);
  if (shelf !== null && (shelf < 1 || shelf > 3650)) return bad('Shelf life must be 1 to 3650 days.');
  const pid = id();
  await ctx.env.DB.prepare('insert into products (id, account_id, name, unit_label, shelf_life_days) values (?1, ?2, ?3, ?4, ?5)')
    .bind(pid, s.account_id, name, unit, shelf).run();
  return json({ ok: true, id: pid }, 201);
});

export const onRequestPatch = handle(async (ctx) => {
  const s = await requireSession(ctx);
  assertCanWrite(s);
  const body = await readJson<{ id?: string; name?: string; unit_label?: string; shelf_life_days?: number | null; active?: boolean }>(ctx.request);
  const pid = str(body.id, 64);
  if (!pid) return bad('Which product?');
  const name = str(body.name, 120);
  const unit = str(body.unit_label, 40);
  const shelf = body.shelf_life_days === undefined ? undefined : (body.shelf_life_days === null ? null : int(body.shelf_life_days));
  const active = typeof body.active === 'boolean' ? (body.active ? 1 : 0) : null;
  const res = await ctx.env.DB.prepare(
    `update products set name = coalesce(nullif(?1,''), name), unit_label = coalesce(nullif(?2,''), unit_label),
       shelf_life_days = case when ?3 = 1 then ?4 else shelf_life_days end, active = coalesce(?5, active)
     where id = ?6 and account_id = ?7`,
  ).bind(name, unit, shelf === undefined ? 0 : 1, shelf ?? null, active, pid, s.account_id).run();
  if (!res.meta.changes) return bad('Product not found.', 404);
  return json({ ok: true });
});
