-- Payments recorded against an order: deposits, final payments and refunds,
-- however they were taken (cash at a craft fair, Venmo, PayPal, card...).
-- Tracking only — no money moves through OrderForge. A later Stripe
-- integration would insert rows here too, with method 'card' and a
-- provider reference.
--
-- One row per payment rather than a paid/unpaid flag on the order, because
-- commission work is routinely paid in parts (deposit up front, balance on
-- delivery) and the seller needs to see both, with dates.
create table if not exists order_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  -- Always positive; `kind` says which way the money went, so a refund can
  -- never be entered as a confusing negative payment.
  amount numeric(12, 2) not null check (amount > 0),
  kind text not null default 'payment' check (kind in ('payment', 'refund')),

  method text not null default 'other'
    check (method in ('cash', 'venmo', 'paypal', 'cash_app', 'zelle', 'card', 'check', 'bank_transfer', 'other')),

  -- When the money changed hands, which isn't necessarily when it was logged
  -- (a weekend fair entered on Monday).
  paid_at date not null default current_date,
  note text,

  -- For a future payment processor (e.g. a Stripe payment intent id). Unused
  -- for manual entries.
  external_reference text,

  created_at timestamptz not null default now()
);

create index if not exists order_payments_order_idx on order_payments(order_id);
create index if not exists order_payments_user_idx on order_payments(user_id);

alter table order_payments enable row level security;

-- Sellers manage payments on their own orders. The order check stops a row
-- being attached to someone else's order id even with the seller's own
-- user_id on it.
drop policy if exists "Users manage own order payments" on order_payments;
create policy "Users manage own order payments" on order_payments
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );
