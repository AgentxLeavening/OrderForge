-- Support one-off marketplace sales (Etsy/eBay/etc.) that don't have a
-- persistent client record. Buyers are captured as freeform text on the order,
-- and sales_channel lets analytics attribute revenue even when client_id is null.

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS sales_channel text,
  ADD COLUMN IF NOT EXISTS buyer_name text;

-- Index the channel for the dashboard breakdowns.
CREATE INDEX IF NOT EXISTS orders_sales_channel_idx ON orders(sales_channel);
