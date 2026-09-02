# Changelog

All notable changes to this project are documented in this file.

## Unreleased
- Pricing now uses **live inventory cost** for linked BOM lines: when a template is selected, material cost comes from the current `inventory_items.unit_cost` (via the BOM link) instead of the value snapshotted onto the template, so quotes reflect today's prices. The breakdown flags this with a "* material costs reflect current inventory prices" note.
- **Pricing overhaul**: suggested order price is now `(materials + labor) × markup ÷ (1 − fee%)`, where labor = template `est_time` × hourly rate. Added a **Settings page** (`/dashboard/settings`, nav link) to save hourly rate, default markup, marketplace fee %, and sales tax rate (profiles columns via migration 012). The new-order pricing panel shows a full breakdown (materials, labor, markup, fee) and pre-fills the defaults while allowing per-order overrides. `est_time` is no longer unused.
- Template bill-of-materials lines can now **link to an actual inventory item** (migration 011): the product editor's BOM rows are an inventory picker (or "Custom item…") that inherits the item's name/SKU/unit/cost, and order creation deducts by `inventory_item_id` when linked (falling back to SKU/name). Also fixed a bug where editing a template loaded an empty BOM and wiped it on save — the editor now loads its own items.
- Inventory items now have a **category** (material / finished good / component / packaging) and a **unit of measure** (each / g / kg / ml / l) — migration 010. The inventory form adds Category + Unit dropdowns (category defaults the unit) with unit-aware labels ("Quantity on hand (g)", "Cost per g ($)"), and the list shows the category and unit. Existing rows default to component/each.
- Clearer labeled inventory & product-template forms; added the missing "Estimated time (hours)" field to the product editor.
- Add `npm run migrate`: a `pg`-based Node runner (`scripts/migrate.mjs`) that applies pending `db/migrations/` files in order and tracks them in a `schema_migrations` table (no `psql` required). Reads `SUPABASE_DB_URL` from env/`.env.local`. Made migrations 005/006 idempotent (`drop policy if exists`) so re-runs are safe.
- Support one-off marketplace sales: add `sales_channel` and freeform `buyer_name` to orders (migration 009), surfaced in the new-order and order-detail forms so a sale doesn't require a client record. Invoices fall back to the buyer name when no client is set, and the dashboard adds a "Sales by Channel" breakdown that includes one-off/no-client orders.
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
