import { ensureSchema } from '../../lib/migrate.ts';

/** The page a customer lands on when they scan the QR on a jar: /l/<public_token>/<lot code>.
 *  Product, when it was made, best-by, what went in, who made it. No counts, no prices, no
 *  internal notes, no hold reasons. A lot on hold or retired says so plainly, because the point
 *  of the page is that the maker is not hiding anything about the batch. */
type Env = { DB: D1Database };
type Ctx = { request: Request; env: Env; params: { token: string; code: string } };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const date = (d: string | null) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '');

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { token, code } = ctx.params;
  const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/app/app.css"><style>main{max-width:560px;margin:0 auto;padding:1.2rem}.lot h1{font-size:1.5rem;margin:.2rem 0 .2rem}.k{color:var(--muted);font-size:.85rem;margin-top:1rem}.v{font-size:1.05rem}.state{display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.85rem;margin-top:.6rem}.ok{background:#15402f;color:#9fe8c9}.warn{background:#4a3a12;color:#f5d58a}footer{color:var(--muted);font-size:.8rem;margin-top:2rem}</style></head><body><main class="lot">${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' } });

  if (!/^[a-f0-9]{32}$/.test(token)) return page('Not found', '<h1>No such batch</h1><p class="muted">Check the code on the label.</p>', 404);
  await ensureSchema(ctx.env.DB);
  const acct = await ctx.env.DB.prepare('select id, name, public_line from accounts where public_token = ?1').bind(token).first<{ id: string; name: string; public_line: string | null }>();
  if (!acct) return page('Not found', '<h1>No such batch</h1><p class="muted">Check the code on the label.</p>', 404);
  const lot = await ctx.env.DB.prepare(
    `select l.code, l.made_at, l.best_by, l.unit_size, l.inputs, l.status, p.name as product_name
     from lots l join products p on p.id = l.product_id where l.account_id = ?1 and lower(l.code) = lower(?2)`,
  ).bind(acct.id, decodeURIComponent(code)).first<{ code: string; made_at: string; best_by: string | null; unit_size: string | null; inputs: string | null; status: string; product_name: string }>();
  if (!lot) return page('Not found', `<h1>No such batch</h1><p class="muted">${esc(acct.name)} has no batch with that code. Check the label and try again.</p>`, 404);

  const today = new Date().toISOString().slice(0, 10);
  const past = lot.best_by && lot.best_by < today;
  const state = lot.status === 'hold' ? ['warn', 'This batch is on hold. Contact the maker before using it.']
    : lot.status === 'retired' ? ['warn', 'This batch has been withdrawn. Contact the maker.']
    : past ? ['warn', 'Past its best-by date.']
    : ['ok', 'Good to use.'];
  const body = `
<p class="muted" style="margin:0">${esc(acct.name)}</p>
<h1>${esc(lot.product_name)}</h1>
<div class="muted">Batch ${esc(lot.code)}${lot.unit_size ? ' · ' + esc(lot.unit_size) : ''}</div>
<span class="state ${state[0]}">${state[1]}</span>
<div class="k">Made</div><div class="v">${date(lot.made_at)}</div>
${lot.best_by ? `<div class="k">Best by</div><div class="v">${date(lot.best_by)}</div>` : ''}
${lot.inputs ? `<div class="k">What went in</div><div class="v">${esc(lot.inputs)}</div>` : ''}
${acct.public_line ? `<div class="k">Made by</div><div class="v">${esc(acct.public_line)}</div>` : ''}
<footer>Batch record kept with <a href="/">LotLedger</a>.</footer>`;
  return page(`${lot.product_name}, batch ${lot.code}`, body);
}
