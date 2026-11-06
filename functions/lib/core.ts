// Shared helpers for every Pages Function: env typing, JSON, ids, auth, CSV.

export interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_LIFETIME?: string;   // one-time $149
  STRIPE_PRICE_MONTHLY?: string;    // $19/mo
  STRIPE_PUBLISHABLE_KEY?: string;  // pk_..., public, mounts embedded Checkout
  APP_URL?: string;                 // https://lotledger.pages.dev or the custom domain
}

export type Ctx = EventContext<Env, string, Record<string, unknown>>;

export const TRIAL_DAYS = 30;
export const SESSION_DAYS = 30;
const COOKIE = 'll_session';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const bad = (message: string, status = 400) => json({ error: message }, status);

export const id = () => crypto.randomUUID();

export const nowIso = () => new Date().toISOString();

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function dateOnly(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysDate(yyyymmdd: string, days: number): string {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError('Body must be JSON', 400); }
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function handle(fn: (ctx: Ctx) => Promise<Response>): (ctx: Ctx) => Promise<Response> {
  return async (ctx) => {
    try { return await fn(ctx); }
    catch (e) {
      if (e instanceof HttpError) return bad(e.message, e.status);
      console.error(e);
      return bad('Something went wrong on our side. It has been logged.', 500);
    }
  };
}

/* ---------- passwords ---------- */

const ITER = 210_000;
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  return `pbkdf2:${ITER}:${b64(salt)}:${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'pbkdf2') return false;
  const hash = new Uint8Array(await pbkdf2(password, unb64(saltB64), Number(iterStr)));
  const expected = unb64(hashB64);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

/* ---------- sessions ---------- */

export interface Session { id: string; user_id: string; account_id: string; email: string; plan: string; trial_ends_at: string; account_name: string }

export function sessionCookie(sessionId: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(req: Request, name = COOKIE): string | null {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function createSession(env: Env, userId: string, accountId: string): Promise<string> {
  const sid = id();
  await env.DB.prepare('insert into sessions (id, user_id, account_id, expires_at) values (?1, ?2, ?3, ?4)')
    .bind(sid, userId, accountId, addDays(nowIso(), SESSION_DAYS)).run();
  return sid;
}

export async function getSession(env: Env, req: Request): Promise<Session | null> {
  const sid = readCookie(req);
  if (!sid) return null;
  const row = await env.DB.prepare(
    `select s.id, s.user_id, s.account_id, u.email, a.plan, a.trial_ends_at, a.name as account_name
       from sessions s join users u on u.id = s.user_id join accounts a on a.id = s.account_id
      where s.id = ?1 and s.expires_at > ?2`,
  ).bind(sid, nowIso()).first<Session>();
  return row || null;
}

export async function requireSession(ctx: Ctx): Promise<Session> {
  const s = await getSession(ctx.env, ctx.request);
  if (!s) throw new HttpError('Sign in required', 401);
  return s;
}

/** Trial expired and not on a paid plan: reads still work, writes are refused. */
export function assertCanWrite(s: Session): void {
  if (s.plan === 'trial' && s.trial_ends_at < nowIso()) {
    throw new HttpError('Your free trial has ended. Choose a plan under Account to keep adding records. Everything you entered is still here and still exports.', 402);
  }
}

/* ---------- CSV ---------- */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' },
  });
}

export const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const int = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) ? n : null; };
export const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
