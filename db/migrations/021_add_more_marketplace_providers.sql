-- Widens marketplace_connections.provider to allow the newly-scaffolded
-- Shopify/TikTok Shop/Facebook & Instagram Shop providers, alongside
-- Etsy/eBay (migration 016). Same RLS posture as before: enabled, no
-- policies — service-role client only, never the user's own session.
alter table marketplace_connections
  drop constraint if exists marketplace_connections_provider_check;

alter table marketplace_connections
  add constraint marketplace_connections_provider_check
  check (provider in ('etsy', 'ebay', 'shopify', 'tiktok', 'facebook'));
