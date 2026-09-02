-- Enable RLS and add owner policies for inventory tables so each
-- authenticated user can only see/manage their own rows.

alter table inventory_items enable row level security;
drop policy if exists "Inventory owners can manage their rows" on inventory_items;
create policy "Inventory owners can manage their rows" on inventory_items
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

alter table inventory_transactions enable row level security;
drop policy if exists "Inventory transaction owners can manage their rows" on inventory_transactions;
create policy "Inventory transaction owners can manage their rows" on inventory_transactions
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );
