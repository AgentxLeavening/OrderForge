# Changelog

All notable changes to this project are documented in this file.

## Unreleased
- Add `inventory_transactions` table and related migration (audit logging for inventory changes).
- Wire inventory admin UI to insert `inventory_transactions` on create/update/delete.
- Log `order_template_deduction` transactions when creating orders from product templates.
- Add transactions viewer at `/dashboard/inventory/transactions`.
- Fix product creation flow: replace deprecated `supabase.auth.user()` with `supabase.auth.getUser()` and ensure inserts include `user_id` to satisfy RLS.
- Add RLS policies for `products` and `product_items` and migration instructions in `README.md`.
- Add RLS policies for `inventory_items` and `inventory_transactions` so each user only sees their own rows (migration 006).
- Deduct inventory atomically via the `deduct_inventory_for_order` DB function (row-locked) instead of a client-side read/modify/write, preventing lost updates under concurrent orders (migration 007).
- Fix new inventory item creation to include the required `user_id`.
- Fix inventory deletion audit logging: `inventory_transactions.inventory_item_id` is now nullable with `ON DELETE SET NULL` (migration 008), so `manual_delete` rows persist instead of failing the FK / cascading away. The transactions viewer falls back to `metadata` name/sku for deleted items.

## Notes
- Run the SQL migrations in `db/migrations/` before using the inventory/product features.
