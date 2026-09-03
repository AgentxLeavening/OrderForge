-- Per-order estimated shipping cost + who covers it, feeding the Pricing &
-- Margin calc (order detail page and the dashboard profit/margin widget):
-- buyer-covered shipping is billed revenue (and pays the marketplace fee
-- like the rest of the sale); seller-covered shipping is a cost that comes
-- straight out of profit. Defaults to buyer-covered — the common case.
alter table orders
  add column if not exists estimated_shipping numeric,
  add column if not exists shipping_buyer_covered boolean not null default true;
