-- LotLedger schema. One account per maker; every row carries account_id.
-- Derived from the Four Waters shared D1 design (lots, inputs, holds, label
-- versions, public lookup) and reduced to what a small maker needs on day one.

create table if not exists accounts (
  id            text primary key,
  name          text not null,
  plan          text not null default 'trial',       -- trial | lifetime | monthly | free
  trial_ends_at text not null,
  stripe_customer_id text,
  lot_prefix    text not null default 'LOT',
  lot_next      integer not null default 1000,        -- next sequential number
  lot_step      integer not null default 10,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists users (
  id            text primary key,
  account_id    text not null references accounts(id),
  email         text not null unique,
  pw_hash       text not null,                        -- pbkdf2:iterations:salt:hash (base64)
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists sessions (
  id            text primary key,
  user_id       text not null references users(id),
  account_id    text not null references accounts(id),
  expires_at    text not null,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists sessions_expires on sessions(expires_at);

create table if not exists products (
  id            text primary key,
  account_id    text not null references accounts(id),
  name          text not null,
  unit_label    text not null default 'unit',         -- bag, jar, tube, bottle, loaf
  shelf_life_days integer,                            -- best-by = made + days, when set
  active        integer not null default 1,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists products_account on products(account_id);

create table if not exists lots (
  id            text primary key,
  account_id    text not null references accounts(id),
  product_id    text not null references products(id),
  code          text not null,
  made_at       text not null,                        -- YYYY-MM-DD
  best_by       text,                                 -- YYYY-MM-DD
  units_made    integer not null check (units_made >= 0),
  units_out     integer not null default 0 check (units_out >= 0),
  unit_size     text,                                 -- "2 lb", "4 oz"
  supplier      text,
  inputs        text,                                 -- free text: what went in, who supplied it
  notes         text,
  status        text not null default 'active',       -- active | sold_out | hold | retired
  hold_reason   text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (account_id, code)
);
create index if not exists lots_account on lots(account_id, status);

-- Every change to units is a row here, so the ledger is auditable.
create table if not exists lot_moves (
  id            text primary key,
  account_id    text not null references accounts(id),
  lot_id        text not null references lots(id),
  kind          text not null,                        -- sale | market | sample | shrink | recount | return
  units         integer not null,                     -- positive = out, negative = back in
  note          text,
  order_ref     text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists lot_moves_lot on lot_moves(lot_id);

-- Orders imported from a store export (Shopify, Etsy, Square, Stripe CSV) or typed in.
create table if not exists orders (
  id            text primary key,
  account_id    text not null references accounts(id),
  order_ref     text not null,
  customer_name text not null,
  email         text,
  line1         text not null,
  line2         text,
  city          text not null,
  state         text not null,
  zip           text not null,
  country       text not null default 'US',
  items         text,                                 -- free text summary
  weight_oz     real,
  length_in     real,
  width_in      real,
  height_in     real,
  status        text not null default 'open',         -- open | exported | shipped
  tracking      text,
  source        text,                                 -- shopify | etsy | square | stripe | manual
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  shipped_at    text,
  unique (account_id, order_ref)
);
create index if not exists orders_account on orders(account_id, status);

create table if not exists app_meta (
  key text primary key,
  value text not null
);
insert or ignore into app_meta (key, value) values ('schema_version', '1');
