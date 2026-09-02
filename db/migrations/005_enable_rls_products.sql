-- Enable RLS and add policies for products and product_items
-- This allows authenticated users to manage their own templates

alter table products enable row level security;
drop policy if exists "Products owners can manage their rows" on products;
create policy "Products owners can manage their rows" on products
  for all
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

alter table product_items enable row level security;
drop policy if exists "Product items owner via product" on product_items;
create policy "Product items owner via product" on product_items
  for all
  using (
    exists (
      select 1 from products p where p.id = product_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from products p where p.id = product_id and p.user_id = auth.uid()
    )
  );
