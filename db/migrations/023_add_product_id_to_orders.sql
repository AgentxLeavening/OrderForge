-- Links an order back to a product template — needed for the cross-channel
-- profitability report (group orders by product, then by sales_channel).
-- Template-created orders set this directly (the template was already
-- chosen); marketplace-imported orders get an exact-title auto-match
-- attempt (see lib/integrations/sync.ts) with a manual override always
-- available on the order detail page.
alter table orders
  add column if not exists product_id uuid references products(id) on delete set null;

create index if not exists orders_product_id_idx on orders(product_id);
