-- Wiring to the outside: inbound order webhooks, public availability, public lot pages.
alter table accounts add column inbound_token text;      -- secret in the webhook URL merchants paste into Stripe/Shopify
alter table accounts add column public_token text;       -- read-only token in public URLs (availability, lot pages)
alter table accounts add column public_line text;        -- one line shown on public lot pages, e.g. "Made by Four Waters in Saint Louis, Michigan"
alter table accounts add column stripe_read_key text;    -- optional merchant-supplied restricted key, used only to read checkout line items
alter table products add column storefront_id text;      -- the id the storefront uses for this product, e.g. "lotion"
alter table products add column next_batch_at text;      -- YYYY-MM-DD shown when sold out
alter table orders add column raw text;                  -- the inbound payload, for support
alter table orders add column notes text;                -- why an inbound order was not packed, and anything else worth saying
