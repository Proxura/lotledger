import { handle, requireSession, assertCanWrite, csv, csvResponse, dateOnly, nowIso, json } from '../../lib/core.ts';

// The thirteen columns Pirate Ship's spreadsheet import accepts, in order.
export const PIRATE_COLUMNS = ['Order', 'Name', 'Address 1', 'Address 2', 'City', 'State', 'Zip', 'Country', 'Email', 'Weight (oz)', 'Length', 'Width', 'Height'];

type Order = { id: string; order_ref: string; customer_name: string; email: string | null; line1: string; line2: string | null; city: string; state: string; zip: string; country: string; weight_oz: number | null; length_in: number | null; width_in: number | null; height_in: number | null };

export function buildPirateRows(orders: Order[]): { rows: unknown[][]; left: { order_ref: string; problem: string }[] } {
  const rows: unknown[][] = [];
  const left: { order_ref: string; problem: string }[] = [];
  for (const o of orders) {
    if (!o.zip || !o.zip.trim()) { left.push({ order_ref: o.order_ref, problem: 'no ZIP' }); continue; }
    if (!o.line1 || !o.line1.trim()) { left.push({ order_ref: o.order_ref, problem: 'no street address' }); continue; }
    if ((o.country || 'US').toUpperCase() !== 'US') { left.push({ order_ref: o.order_ref, problem: 'US only in this export' }); continue; }
    if (!o.weight_oz) { left.push({ order_ref: o.order_ref, problem: 'no weight' }); continue; }
    rows.push([o.order_ref, o.customer_name, o.line1, o.line2 || '', o.city, o.state, o.zip, 'US', o.email || '',
      String(o.weight_oz), o.length_in ?? '', o.width_in ?? '', o.height_in ?? '']);
  }
  return { rows, left };
}

/** GET: download every open order as a Pirate Ship CSV and mark them exported. ?dry=1 to preview without marking. */
export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const url = new URL(ctx.request.url);
  const dry = url.searchParams.get('dry') === '1';
  const { results } = await ctx.env.DB.prepare('select * from orders where account_id = ?1 and status = ?2 order by created_at').bind(s.account_id, 'open').all();
  const { rows, left } = buildPirateRows(results as unknown as Order[]);
  if (dry) return json({ ready: rows.length, left });
  if (!rows.length) return json({ error: 'No open orders are ready to ship.', left }, 400);
  assertCanWrite(s);
  const refs = rows.map((r) => r[0] as string);
  await ctx.env.DB.prepare(`update orders set status = 'exported' where account_id = ?1 and status = 'open' and order_ref in (${refs.map((_, i) => `?${i + 2}`).join(',')})`)
    .bind(s.account_id, ...refs).run();
  return csvResponse(`pirateship-${dateOnly()}-${nowIso().slice(11, 16).replace(':', '')}.csv`, csv([PIRATE_COLUMNS, ...rows]));
});
