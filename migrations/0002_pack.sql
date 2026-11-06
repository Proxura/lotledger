-- Packing an order allocates units from lots, oldest lot first.
alter table orders add column packed text;        -- JSON: [{product_id, product_name, lot_id, lot_code, units}]
alter table orders add column packed_at text;
alter table orders add column carrier text;       -- usps | ups | fedex | other, read from the tracking number's shape
