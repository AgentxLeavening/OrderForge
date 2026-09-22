-- Marketplaces charge a percentage AND a flat amount per order (eBay's is
-- around $0.40). A percentage-only model is fine on a $60 commission and badly
-- wrong on a $1 card: 13.25% is 13 cents, the flat fee is 40 cents, so the
-- flat part is the larger cost on exactly the orders this seller has most of.
alter table profiles
  add column if not exists fee_fixed_etsy numeric(8, 2) check (fee_fixed_etsy is null or fee_fixed_etsy >= 0),
  add column if not exists fee_fixed_ebay numeric(8, 2) check (fee_fixed_ebay is null or fee_fixed_ebay >= 0),
  add column if not exists fee_fixed_shopify numeric(8, 2) check (fee_fixed_shopify is null or fee_fixed_shopify >= 0),
  add column if not exists default_fee_fixed numeric(8, 2) check (default_fee_fixed is null or default_fee_fixed >= 0);

-- Stamped per order like fee_pct, so a later settings change never rewrites
-- the economics of orders already reported on.
alter table orders
  add column if not exists fee_fixed numeric(8, 2) check (fee_fixed is null or fee_fixed >= 0);
