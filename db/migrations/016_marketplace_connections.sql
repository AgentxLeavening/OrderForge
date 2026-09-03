-- Per-user Etsy/eBay OAuth connections. Holds access/refresh tokens, so this
-- table is intentionally locked to the service role only: RLS is enabled but
-- NO policies are created, meaning PostgREST (anon/authenticated roles) can
-- never select/insert/update/delete here, even for a user's own row. Only
-- server code using the service-role key (lib/supabase/admin.ts) touches it,
-- and it must always filter by an explicitly-verified user_id.
create table if not exists marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('etsy', 'ebay')),
  external_shop_id text,
  external_shop_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table marketplace_connections enable row level security;

create index if not exists marketplace_connections_user_idx on marketplace_connections(user_id);
