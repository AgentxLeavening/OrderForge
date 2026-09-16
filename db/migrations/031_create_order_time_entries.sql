-- Time actually spent on an order, against the estimate its price was built
-- from. For commission work labour is the real cost, so this is the maker's
-- equivalent of a materials-based COGS: it answers "am I actually earning my
-- hourly rate on this kind of job?".
--
-- orders.estimated_hours records the estimate as it stood when the order was
-- created (from the product's est_time × quantity, see NewOrderModal), rather
-- than deriving it from labor_cost ÷ hourly_rate later — the rate can change,
-- and an order priced last year should still be compared with the hours it was
-- actually priced for.
alter table orders
  add column if not exists estimated_hours numeric(8, 2) check (estimated_hours is null or estimated_hours >= 0);

-- One row per work session. A running timer is the row with ended_at null;
-- a finished session carries minutes. Manual entries ("2h on Tuesday") are
-- written straight in with minutes and no timer.
create table if not exists order_time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  -- Null only while a timer is running; set when it stops or on a manual entry.
  minutes numeric(8, 2) check (minutes is null or minutes >= 0),
  started_at timestamptz,
  ended_at timestamptz,

  entry_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),

  -- Either a running timer (started_at, no minutes) or a recorded session
  -- (minutes). Never neither.
  constraint order_time_entries_shape check (minutes is not null or started_at is not null)
);

create index if not exists order_time_entries_order_idx on order_time_entries(order_id);
create index if not exists order_time_entries_user_idx on order_time_entries(user_id);
-- At most one timer running per order, so a forgotten timer can't be stacked.
create unique index if not exists order_time_entries_one_running_idx
  on order_time_entries(order_id) where ended_at is null and minutes is null;

alter table order_time_entries enable row level security;

drop policy if exists "Users manage own time entries" on order_time_entries;
create policy "Users manage own time entries" on order_time_entries
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );
