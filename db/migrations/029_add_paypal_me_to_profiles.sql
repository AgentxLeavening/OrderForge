-- The seller's PayPal.Me name, for the "Pay with PayPal" button on the public
-- quote page. Same reasoning as venmo_username (migration 028): shown to
-- customers on purpose, stored bare (lib/paypal.ts normalises pasted links),
-- and checked loosely so a valid name is never rejected here.
alter table profiles
  add column if not exists paypal_me_name text
    check (paypal_me_name is null or paypal_me_name ~ '^[A-Za-z0-9._-]{1,64}$');
