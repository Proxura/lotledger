import { handle, requireSession, csv, csvResponse, dateOnly } from '../../lib/core.ts';

/** The compliance ledger: every lot, every movement, one CSV. */
export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const { results: lots } = await ctx.env.DB.prepare(
    `select l.code, p.name as product, l.made_at, l.best_by, l.unit_size, l.units_made, l.units_out, (l.units_made - l.units_out) as units_left,
            l.status, l.hold_reason, l.supplier, l.inputs, l.notes, l.created_at
       from lots l join products p on p.id = l.product_id where l.account_id = ?1 order by l.made_at, l.code`,
  ).bind(s.account_id).all();
  const { results: moves } = await ctx.env.DB.prepare(
    `select l.code, m.kind, m.units, m.order_ref, m.note, m.created_at
       from lot_moves m join lots l on l.id = m.lot_id where m.account_id = ?1 order by m.created_at`,
  ).bind(s.account_id).all();
  const head = [['LOTS'], ['Lot code', 'Product', 'Made', 'Best by', 'Unit size', 'Units made', 'Units out', 'Units left', 'Status', 'Hold reason', 'Supplier', 'Inputs', 'Notes', 'Logged at']];
  const lotRows = (lots as Record<string, unknown>[]).map((r) => [r.code, r.product, r.made_at, r.best_by, r.unit_size, r.units_made, r.units_out, r.units_left, r.status, r.hold_reason, r.supplier, r.inputs, r.notes, r.created_at]);
  const moveHead = [[], ['MOVEMENTS'], ['Lot code', 'Kind', 'Units (+out / -back)', 'Order ref', 'Note', 'At']];
  const moveRows = (moves as Record<string, unknown>[]).map((r) => [r.code, r.kind, r.units, r.order_ref, r.note, r.created_at]);
  return csvResponse(`lotledger-${dateOnly()}.csv`, csv([...head, ...lotRows, ...moveHead, ...moveRows]));
});
