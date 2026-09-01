-- Create inventory_items to track material stock
create table if not exists inventory_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  sku text,
  quantity numeric default 0,
  unit_cost numeric default 0,
  created_at timestamptz default now()
);

-- Optional: an inventory transactions table for audit (not required now)
-- create table if not exists inventory_transactions (
--   id uuid default gen_random_uuid() primary key,
--   inventory_item_id uuid not null references inventory_items(id) on delete cascade,
--   change numeric not null,
--   reason text,
--   created_at timestamptz default now()
-- );
psql "https://qpbvvkgxlctnthlzusml.supabase.co" -f db/migrations/002_add_suggested_price_to_orders.sql
psql "https://qpbvvkgxlctnthlzusml.supabase.co" -f db/migrations/003_create_inventory_items.sql