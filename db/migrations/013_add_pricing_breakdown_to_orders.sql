-- Persist the cost basis behind an order's suggested price so the order detail
-- (and future reporting) can show margin. suggested_price already exists.
--   profit ≈ suggested_price − (material_cost + labor_cost) − fees
ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS material_cost numeric,
  ADD COLUMN IF NOT EXISTS labor_cost numeric,
  ADD COLUMN IF NOT EXISTS markup numeric,
  ADD COLUMN IF NOT EXISTS fee_pct numeric;
