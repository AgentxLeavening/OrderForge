-- Stripe Connect: each seller links their OWN Stripe account, so card money
-- goes straight to them and OrderForge never holds funds. Same shape as the
-- marketplace connections — an external account id we act on behalf of.
--
-- Only the account id and its readiness flags live here. No keys, no tokens:
-- with Connect Onboarding (Standard accounts) the platform's own secret key
-- plus the `Stripe-Account` header is the whole authentication story, which is
-- one less secret per seller to store and leak.
create table if not exists stripe_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique,

  -- Mirrored from Stripe on connect and on return from onboarding. An account
  -- can exist long before it can take money (identity checks pending), so the
  -- pay button keys off charges_enabled, never mere existence.
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  -- false while the platform is in test mode: real cards are refused, test
  -- card numbers work. Surfaced in the UI so nobody mistakes one for the other.
  livemode boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table stripe_accounts enable row level security;

-- Sellers can see their own connection status; all writes happen server-side
-- through the service-role client (the routes under app/api/stripe), since an
-- account id the browser could write is an account id the browser could point
-- at someone else's Stripe account.
drop policy if exists "Users read own stripe account" on stripe_accounts;
create policy "Users read own stripe account" on stripe_accounts
  for select using (auth.uid() = user_id);
