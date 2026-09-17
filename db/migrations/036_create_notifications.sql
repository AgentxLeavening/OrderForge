-- In-app notifications: the bell tells a seller what happened while they
-- weren't looking.
--
-- Written by TRIGGERS rather than app code on purpose. The same events arrive
-- through four different doors — the scheduled sync, marketplace webhooks, the
-- Stripe webhook, and the public quote page — and app-side writes would have to
-- be repeated in each, staying in step forever. A trigger sees them all.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('order_new', 'order_status', 'payment', 'quote_response')),
  title text not null,
  body text,

  order_id uuid references orders(id) on delete cascade,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
-- The bell's unread count asks exactly this question on every poll.
create index if not exists notifications_unread_idx on notifications(user_id) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "Users manage own notifications" on notifications;
create policy "Users manage own notifications" on notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Inserted by SECURITY DEFINER trigger functions, which bypass the policy
-- above — the triggers run as the table owner, not as the seller.
create or replace function notify_user(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_order_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, kind, title, body, order_id)
  values (p_user_id, p_kind, p_title, p_body, p_order_id);
end;
$$;

-- "Did the seller do this themselves?" — auth.uid() is the signed-in user for
-- anything done in the dashboard, and NULL for service-role work (the sync,
-- the webhooks, the public quote page). Only the latter is worth a
-- notification: telling someone what they just clicked is noise.
create or replace function actor_is_owner(p_user_id uuid) returns boolean
language sql
stable
as $$ select auth.uid() is not null and auth.uid() = p_user_id $$;

-- New order arriving on its own: a marketplace import.
create or replace function notify_order_inserted() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.external_source is not null and not actor_is_owner(new.user_id) then
    perform notify_user(
      new.user_id, 'order_new',
      initcap(new.external_source) || ' order: ' || coalesce(new.title, new.order_number),
      case when new.buyer_name is not null then 'From ' || new.buyer_name else null end,
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_order_inserted on orders;
create trigger notify_order_inserted after insert on orders
  for each row execute function notify_order_inserted();

-- Status moving without the seller touching it: a sync marking something
-- shipped, an Etsy delivery completing an order, an accepted quote starting
-- work.
create or replace function notify_order_status() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not actor_is_owner(new.user_id) then
    perform notify_user(
      new.user_id, 'order_status',
      coalesce(new.title, new.order_number) || ' → ' || replace(initcap(replace(new.status, '_', ' ')), ' ', ' '),
      'Was ' || replace(old.status, '_', ' '),
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_order_status on orders;
create trigger notify_order_status after update of status on orders
  for each row execute function notify_order_status();

-- Money arriving without the seller recording it: a Stripe card payment.
create or replace function notify_payment() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if not actor_is_owner(new.user_id) then
    select coalesce(o.title, o.order_number) into v_title from orders o where o.id = new.order_id;
    perform notify_user(
      new.user_id,
      'payment',
      case when new.kind = 'refund' then 'Refund of $' else 'Payment received: $' end || to_char(new.amount, 'FM999999990.00'),
      coalesce(v_title, 'Order') || ' · ' || replace(new.method, '_', ' '),
      new.order_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_payment on order_payments;
create trigger notify_payment after insert on order_payments
  for each row execute function notify_payment();

-- The customer answering a quote — always someone else's action, by
-- definition, since the quote page is public and unauthenticated.
create or replace function notify_quote_response() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    select coalesce(o.title, o.order_number) into v_title from orders o where o.id = new.order_id;
    perform notify_user(
      new.user_id, 'quote_response',
      'Quote ' || new.status || ': ' || coalesce(v_title, 'order'),
      new.response_note,
      new.order_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_quote_response on quotes;
create trigger notify_quote_response after update of status on quotes
  for each row execute function notify_quote_response();
