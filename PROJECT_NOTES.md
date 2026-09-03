# OrderForge — Project Notes

Context for picking up work on any machine. Safe to commit (no secrets).

## What this is
Order, inventory, and pricing management for makers / small shops — target users are
Etsy/eBay sellers & crafters (3D printing, resin, cards). Dashboard-first web app.

## Stack
- **Next.js 16.3.4** (App Router, Turbopack) — note: this Next version has breaking
  changes vs. older docs. See `AGENTS.md`; read `node_modules/next/dist/docs/` before
  writing framework code. Typed routes are enforced (e.g. layouts use `LayoutProps<"/route">`).
- **React 19**, **Tailwind v4**, **TypeScript**
- **Supabase** — auth + Postgres + Row Level Security (RLS)
- `pdf-lib` (invoice PDFs), `@hello-pangea/dnd` (kanban / widget drag-and-drop)

## Local setup
1. `npm install`
2. Create `.env.local` in the repo root (gitignored — copy it over securely, e.g. Bitwarden):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (app needs only these)
   - `SUPABASE_DB_HOST/PORT/USER/PASSWORD` (only for running migrations)
3. `npm run dev`
The Supabase DB is remote and shared across machines — no seeding needed.

## Database & migrations
- SQL lives in `db/migrations/` (`001`…`014`+), all written idempotently.
- Apply with **`npm run migrate`** (a `pg`-based Node runner; no `psql` needed).
- Connection gotchas: `psql` isn't installed locally; the direct `db.<ref>.supabase.co`
  host is IPv6-only and won't resolve — use the **session pooler** host
  `aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`. Prefer the discrete
  `SUPABASE_DB_*` vars (passwords often have special chars that break URL parsing).
- Alternative: paste SQL into the Supabase SQL Editor.
- Symptom of an unrun migration: `Could not find the '<column>' column ... in the schema cache`.

## Architecture notes
- `app/page.tsx` redirects `/` → `/dashboard`; `/dashboard/*` pages client-side guard auth
  via `supabase.auth.getUser()` and redirect to `/login`. There is **no server middleware**
  auth guard (client-side only; RLS protects the data).
- Nav + Sign out live in `app/components/DashboardNav.tsx`, rendered by
  `app/dashboard/layout.tsx` so they only appear on dashboard routes.
- `lib/supabase.ts` = browser client (anon key). `lib/inventory.ts` = shared taxonomy +
  `isLowStock`. `lib/generateInvoicePdf.ts` = invoice PDF.

## Domain model (key tables)
- `orders` — includes `suggested_price`, `material_cost`, `labor_cost`, `markup`, `fee_pct`.
- `order_items` — `description`, `quantity`, `unit_price`. **There is no `name` column.**
- `products` + `product_items` — templates and their BOM.
- `inventory_items` — `category`, `unit`, `quantity`, `unit_cost`, `reorder_threshold`.
- `inventory_transactions` — audit log; `order_id` is `ON DELETE SET NULL`.
- `invoices`, `profiles` (pricing defaults: hourly rate, markup, fee %, tax rate).

### Pricing / billing rules (important)
- Suggested price = (materials + labor) × markup, grossed up to cover the fee %.
  Materials/labor scale by order quantity; a template `suggested_price` override is per-unit.
- Orders created from a template or a direct finished-good sale insert **one** billing
  line at the sale price (`description`, qty, per-unit `unit_price`) — NOT the BOM at cost.
- Inventory is deducted per BOM item at creation via the `deduct_inventory_for_order` RPC
  (transactions logged with `reason = 'order_template_deduction'`).
- Deleting an order restocks those materials (reverses the logged deductions,
  logs `reason = 'order_deleted_restock'`), then removes the invoice + line items.

## Current state (as of this session)
Shipped to `main` and building/deployable:
- Profit/margin on the dashboard (sourced from the persisted price breakdown).
- Low-stock alerts (reorder thresholds + dashboard banner; migration 014).
- Correct sale-price billing + order/line-item quantities.
- Order deletion with automatic material restock.
- Launch polish: entry redirect, branded metadata, dashboard-only nav + sign-out.
`npm run build` passes; `npx tsc --noEmit` is clean.

## Known debt / follow-ups
- Pre-existing ESLint errors (`no-explicit-any`, some react-hooks rules) — **non-blocking**,
  the Turbopack build does not fail on them.
- No server-side auth middleware (client-side redirects only).
- One historical order `ORD-880512` has a `suggested_price` ($15) but no line item —
  add it by hand on the order page if you want its revenue/invoice to reflect $15.
- Candidate next features: CSV / tax export; a "Cancelled" order status (complements delete).
