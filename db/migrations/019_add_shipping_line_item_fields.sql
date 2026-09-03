-- Marketplace-imported orders (Etsy confirmed live; eBay's shape is
-- similar) have a real gap between the order total and the sum of item
-- prices: shipping + tax + VAT + gift wrap − discounts. Rather than fold
-- that into suggested_price invisibly, imports add it as its own line item
-- so line items always sum to the order total, and buyer_covered lets the
-- seller mark whether that amount was actually charged to the buyer (true,
-- matching what the marketplace reports) or should be excluded from
-- billing/revenue (e.g. the seller ate the cost) — default true since a
-- marketplace-reported total, by construction, was what the buyer paid.
alter table order_items
  add column if not exists item_type text not null default 'product',
  add column if not exists buyer_covered boolean not null default true;

alter table order_items
  drop constraint if exists order_items_item_type_check;
alter table order_items
  add constraint order_items_item_type_check check (item_type in ('product', 'shipping'));
