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
];

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
