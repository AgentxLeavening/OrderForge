-- The seller's Venmo username, for the "Pay with Venmo" button on the public
-- quote page. Stored without the leading @ (lib/venmo.ts normalises input).
--
-- Shown publicly on purpose: it's what a customer needs to pay, and it's the
-- same handle a seller would put on a card at a craft fair.
--
-- Venmo usernames are letters, numbers, hyphens and underscores. The check is
-- kept a little looser than Venmo's own length rules so a valid handle is never
-- rejected here because Venmo changed them.
alter table profiles
  add column if not exists venmo_username text
    check (venmo_username is null or venmo_username ~ '^[A-Za-z0-9_-]{1,64}$');
