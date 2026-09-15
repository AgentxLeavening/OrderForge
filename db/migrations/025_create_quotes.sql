-- Customer-facing quotes: the document a commission seller sends *before* the
-- work, and the thing the customer accepts. Until now the invoice PDF stood in
-- for this — the tell was that generating an invoice set the order status to
-- 'quoted'.
--
-- The important design decision is the snapshot. A quote stores its own copy
-- of the line items and totals as they were when it was sent, rather than
-- reading live order data. Without that, editing an order later would
-- retroactively change what the customer already agreed to, and there would be
-- no record of the agreed price. Revisions then fall out naturally: a second
-- quote row on the same order, rather than mutating the first.
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,

  -- The public URL is /quote/<token>. Unguessable, because it is the only
  -- thing protecting the quote: the page is deliberately unauthenticated so a
  -- customer can open it without an account.
  token text not null unique,

  -- draft is unused for now (quotes are created already sent) but kept so a
  -- "prepare, then send" flow doesn't need a constraint change later.
  status text not null default 'sent'
    check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),

  valid_until date,

  -- Line items and totals as sent. Shape:
  --   { items: [{ description, quantity, unit_price, item_type, buyer_covered }],
  --     subtotal, tax_rate, tax_amount, total,
  --     business_name, client_name, order_title, order_number }
  snapshot jsonb not null,

  -- Free text from the seller: what's included, lead time, deposit terms.
  message text,

  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  -- Optional note the customer leaves when accepting or declining.
  response_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotes_order_idx on quotes(order_id);
create index if not exists quotes_user_idx on quotes(user_id);
-- The public page looks a quote up by token on every view, so this one matters.
create unique index if not exists quotes_token_idx on quotes(token);

alter table quotes enable row level security;

-- Sellers manage their own quotes through their normal session.
--
-- There is deliberately NO policy granting anonymous access by token. The
-- public quote page reads and updates through the service-role client instead
-- (lib/supabase/admin.ts), filtered by token on the server. A policy permissive
-- enough for an anonymous reader to fetch "the row matching this token" is also
-- permissive enough to enumerate every row, since the filter would be supplied
-- by the caller rather than enforced by the policy.
drop policy if exists "Users manage own quotes" on quotes;
create policy "Users manage own quotes" on quotes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
