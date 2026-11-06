import { handle, json, requireSession, bad, str } from '../../lib/core.ts';

/**
 * Exact lookup of one lot by its printed code. Used by the scanner and the
 * type-a-code box. A QR on a LotLedger label carries either the bare code
 * ("FW-104") or a label URL ("https://host/app/#lot=FW-104"); both resolve
 * here. Matching is exact and case-insensitive, never a substring, because a
 * substring match on "100" would return every lot with 100 in it.
 */
export const onRequestGet = handle(async (ctx) => {
  const s = await requireSession(ctx);
  const url = new URL(ctx.request.url);
  const code = normalizeScanned(str(url.searchParams.get('code'), 200));
  if (!code) return bad('Give a lot code.');
  const lot = await ctx.env.DB.prepare(
    `select l.*, p.name as product_name, p.unit_label, (l.units_made - l.units_out) as units_left
       from lots l join products p on p.id = l.product_id
      where l.account_id = ?1 and upper(l.code) = ?2`,
  ).bind(s.account_id, code).first();
  if (!lot) return json({ found: false, code });
  return json({ found: true, lot });
});

/** Pull a lot code out of whatever a scanner handed back. */
export function normalizeScanned(raw: string): string {
  let t = raw.trim();
  const m = t.match(/[#?&]lot=([^&#\s]+)/i);
  if (m) t = decodeURIComponent(m[1]);
  return t.trim().toUpperCase();
}
