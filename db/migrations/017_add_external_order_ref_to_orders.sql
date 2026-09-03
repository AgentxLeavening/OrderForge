-- Tracks which orders came from a marketplace import, and their source
-- platform's own order id, so re-syncing never creates duplicates.
alter table orders
  add column if not exists external_source text,
  add column if not exists external_order_id text;

create unique index if not exists orders_external_order_unique
  on orders(user_id, external_source, external_order_id)
  where external_order_id is not null;
