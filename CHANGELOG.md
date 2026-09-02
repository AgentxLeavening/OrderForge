# Changelog

All notable changes to this project are documented in this file.

## Unreleased
- Add `inventory_transactions` table and related migration (audit logging for inventory changes).
- Wire inventory admin UI to insert `inventory_transactions` on create/update/delete.
- Log `order_template_deduction` transactions when creating orders from product templates.
- Add transactions viewer at `/dashboard/inventory/transactions`.
- Fix product creation flow: replace deprecated `supabase.auth.user()` with `supabase.auth.getUser()` and ensure inserts include `user_id` to satisfy RLS.
- Add RLS policies for `products` and `product_items` and migration instructions in `README.md`.

## Notes
- Run the SQL migrations in `db/migrations/` before using the inventory/product features.
