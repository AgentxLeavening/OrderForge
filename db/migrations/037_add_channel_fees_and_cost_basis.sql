-- Making profit mean something on imported orders.
--
-- Until now an imported order carried a sale price and nothing else: no
-- marketplace fee, no cost of goods. Profit therefore came out as roughly the
-- full sale price, which is what a first outside tester immediately spotted as
-- wrong. Two causes, two fixes.

-- 1. Marketplace fees differ per channel (eBay's cut is roughly double
--    Shopify's), so one default can't serve all three. The existing
--    profiles.default_fee_pct stays as the fallback for manual orders.
alter table profiles
  add column if not exists fee_pct_etsy numeric check (fee_pct_etsy is null or (fee_pct_etsy >= 0 and fee_pct_etsy < 100)),
  add column if not exists fee_pct_ebay numeric check (fee_pct_ebay is null or (fee_pct_ebay >= 0 and fee_pct_ebay < 100)),
  add column if not exists fee_pct_shopify numeric check (fee_pct_shopify is null or (fee_pct_shopify >= 0 and fee_pct_shopify < 100));

-- 2. Cost of goods has three states, not two, and the difference matters for
--    honesty: a NULL material_cost means "nobody recorded what this cost",
--    which is not the same claim as "this cost nothing".
--
--      material_cost set        -> recorded
--      material_cost null       -> unknown: counted as full profit (the
--                                  tax-safe direction, since an undocumented
--                                  cost can't be deducted anyway) but flagged
--                                  so the seller can see how much of their
--                                  profit figure is unverified
--      no_cost_basis = true     -> deliberately free (gifted, found, already
--                                  owned); counted as full profit, no flag
alter table orders
  add column if not exists no_cost_basis boolean not null default false;

comment on column orders.no_cost_basis is
  'True when the seller confirms the goods genuinely cost nothing. Distinguishes a deliberate zero from an unrecorded cost (material_cost null).';
