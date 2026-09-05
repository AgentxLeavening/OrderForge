-- Tracking number for shipping. Filling it in (going from empty to set)
-- auto-advances the order to the "Shipped" status in the app, not enforced
-- here since orders.status has no DB-level check constraint.
alter table orders
  add column if not exists tracking_number text;
