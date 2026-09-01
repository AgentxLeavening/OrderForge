-- Add suggested_price to orders so selected/template pricing can be persisted
ALTER TABLE IF EXISTS orders
ADD COLUMN IF NOT EXISTS suggested_price numeric(10,2);

-- Backfill: set suggested_price from invoices totals when possible (best-effort)
-- (optional: keep commented out to avoid unexpected updates)
-- UPDATE orders o
-- SET suggested_price = i.total
-- FROM invoices i
-- WHERE i.order_id = o.id AND o.suggested_price IS NULL;
