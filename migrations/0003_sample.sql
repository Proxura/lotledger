-- Sample data is marked so it can be removed in one tap without touching real records.
alter table products add column sample integer not null default 0;
alter table lots add column sample integer not null default 0;
alter table orders add column sample integer not null default 0;
