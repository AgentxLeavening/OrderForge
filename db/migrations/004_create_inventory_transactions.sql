-- Create inventory_transactions for audit logging
create table if not exists inventory_transactions (
  id uuid default gen_random_uuid() primary key,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  change numeric not null,
  previous_quantity numeric,
  new_quantity numeric,
  reason text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists inventory_transactions_inventory_item_id_idx on inventory_transactions(inventory_item_id);
create index if not exists inventory_transactions_user_id_idx on inventory_transactions(user_id);
create index if not exists inventory_transactions_order_id_idx on inventory_transactions(order_id);
