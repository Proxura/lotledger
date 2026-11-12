/** Schema steps applied by the app itself, so a column can ship with the code that needs it.
 *
 * `wrangler d1 migrations apply` still works for a fresh database (migrations/ holds the same
 * statements), but production is deployed from git with no wrangler login on the build machine,
 * so each request path that needs a newer column calls ensureSchema() first. It is idempotent:
 * the version is read from app_meta, and each step checks the actual table before altering it. */

type Step = { version: number; apply: (db: D1Database) => Promise<void> };

async function hasColumn(db: D1Database, table: string, col: string): Promise<boolean> {
  const { results } = await db.prepare(`pragma table_info(${table})`).all<{ name: string }>();
  return results.some((r) => r.name === col);
}

const STEPS: Step[] = [
  {
    version: 2, // migrations/0002_pack.sql
    apply: async (db) => {
      for (const col of ['packed text', 'packed_at text', 'carrier text']) {
        const name = col.split(' ')[0];
        if (!(await hasColumn(db, 'orders', name))) await db.prepare(`alter table orders add column ${col}`).run();
      }
    },
  },
  {
    version: 3, // migrations/0003_sample.sql
    apply: async (db) => {
      for (const t of ['products', 'lots', 'orders']) {
        if (!(await hasColumn(db, t, 'sample'))) await db.prepare(`alter table ${t} add column sample integer not null default 0`).run();
      }
    },
  },
  {
    version: 4, // migrations/0004_kits.sql
    apply: async (db) => {
      if (!(await hasColumn(db, 'products', 'components'))) await db.prepare('alter table products add column components text').run();
    },
  },
  {
    version: 5, // migrations/0005_wiring.sql
    apply: async (db) => {
      for (const [t, col] of [['accounts', 'inbound_token text'], ['accounts', 'public_token text'], ['accounts', 'public_line text'], ['accounts', 'stripe_read_key text'], ['products', 'storefront_id text'], ['products', 'next_batch_at text'], ['orders', 'raw text'], ['orders', 'notes text']]) {
        if (!(await hasColumn(db, t, col.split(' ')[0]))) await db.prepare(`alter table ${t} add column ${col}`).run();
      }
      // Every existing account gets its tokens so the URLs exist the first time someone looks.
      const { results } = await db.prepare('select id from accounts where inbound_token is null or public_token is null').all<{ id: string }>();
      for (const r of results) {
        await db.prepare('update accounts set inbound_token = coalesce(inbound_token, ?1), public_token = coalesce(public_token, ?2) where id = ?3').bind(token(), token(), r.id).run();
      }
    },
  },
];

/** 32 hex chars from the platform RNG. */
export function token(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const LATEST = STEPS[STEPS.length - 1].version;
let known = 0; // per-isolate cache; the row in app_meta is the truth

export async function ensureSchema(db: D1Database): Promise<void> {
  if (known >= LATEST) return;
  const row = await db.prepare("select value from app_meta where key = 'schema_version'").first<{ value: string }>();
  let v = row ? Number(row.value) || 1 : 1;
  for (const s of STEPS) {
    if (s.version <= v) continue;
    await s.apply(db);
    await db.prepare("insert into app_meta (key, value) values ('schema_version', ?1) on conflict(key) do update set value = excluded.value").bind(String(s.version)).run();
    v = s.version;
  }
  known = v;
}
