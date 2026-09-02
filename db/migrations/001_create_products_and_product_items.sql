-- Migration: Create products and product_items tables for templates/BOM
-- Run this in Supabase SQL editor or via psql

create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  suggested_price numeric,
  est_time numeric,
  created_at timestamptz default now()
);

create table if not exists product_items (
  id uuid default gen_random_uuid() primary key,
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  sku text,
  quantity numeric default 1,
  unit_cost numeric default 0,
  created_at timestamptz default now()
);

-- Example insert (replace <USER_UUID> with your profile id)
-- insert into products (user_id, name, suggested_price, est_time) values ('<USER_UUID>', 'Resin Trinket Tray', 25.00, 1.5);
-- insert into product_items (product_id, name, quantity, unit_cost) values ('<PRODUCT_UUID>', 'Resin (g)', 30, 0.05);
