-- A kit is a product sold as one line but packed from other products' lots.
alter table products add column components text;   -- JSON: [{product_id, units}] or null
