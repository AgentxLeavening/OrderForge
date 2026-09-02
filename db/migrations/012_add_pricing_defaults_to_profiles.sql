-- Pricing defaults used to compute a suggested order price:
--   suggested = (materials + est_time*hourly_rate) * markup / (1 - fee%)
-- default_tax_rate already exists on profiles and is used on invoices.

ALTER TABLE IF EXISTS profiles
  ADD COLUMN IF NOT EXISTS hourly_rate numeric,
  ADD COLUMN IF NOT EXISTS default_markup numeric,
  ADD COLUMN IF NOT EXISTS default_fee_pct numeric;
