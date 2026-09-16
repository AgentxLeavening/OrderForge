-- Deposit asked for on a quote ("50% to book"), the most common term in
-- commission work. Also lives inside quotes.snapshot as part of the terms the
-- customer agreed to; this column exists so deposits can be queried without
-- digging through jsonb.
--
-- Null means no deposit was asked for, including on every quote sent before
-- this existed.
alter table quotes
  add column if not exists deposit_amount numeric(12, 2) check (deposit_amount is null or deposit_amount > 0);
