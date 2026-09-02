-- Track a reorder threshold per inventory item so the app can warn when stock
-- runs low (e.g. "Black PLA is down to 40 g"). NULL means "no alert" and is the
-- default, so existing rows opt out until a threshold is set.
ALTER TABLE IF EXISTS inventory_items
  ADD COLUMN IF NOT EXISTS reorder_threshold numeric;
