-- 017's unique index was WHERE external_order_id is not null (a partial
-- index). PostgREST's upsert(..., { onConflict, ignoreDuplicates: true })
-- can only target a real (non-partial) unique constraint/index — a partial
-- one isn't inferable through it, so ON CONFLICT would fail at import time.
-- A plain unique constraint works fine here anyway: Postgres treats each
-- NULL as distinct, so existing manually-created orders (external_source
-- and external_order_id both null) never collide with each other or with
-- imported ones.
drop index if exists orders_external_order_unique;

alter table orders
  drop constraint if exists orders_external_order_unique;

alter table orders
  add constraint orders_external_order_unique unique (user_id, external_source, external_order_id);
