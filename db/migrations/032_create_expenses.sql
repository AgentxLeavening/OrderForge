-- Business expenses: the deduction side of the books, and the biggest gap
-- against Craftybase. Orders already capture what came in; nothing captured
-- filament orders, packaging, booth fees, tools or software going out.
--
-- Deliberately standalone rather than hung off inventory: most expenses aren't
-- stock (a booth fee, a software subscription), and a seller shouldn't have to
-- model something as inventory to record having paid for it. `order_id` links
-- the ones that belong to a single job (a courier run, a custom part bought
-- for one commission).
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  incurred_on date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null default 'other'
    check (category in (
      'materials', 'packaging', 'postage', 'marketplace_fees', 'equipment',
      'software', 'booth_fees', 'marketing', 'mileage', 'other'
    )),
  vendor text,
  note text,

  -- Optional: an expense incurred for one specific order. Kept when the order
  -- is deleted (set null) — the money was still spent, and it still belongs in
  -- the year's deductions.
  order_id uuid references orders(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on expenses(user_id, incurred_on desc);
create index if not exists expenses_order_idx on expenses(order_id);

alter table expenses enable row level security;

drop policy if exists "Users manage own expenses" on expenses;
create policy "Users manage own expenses" on expenses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
