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
- Deleting **or cancelling** an order restocks those materials — same idempotent
  `restock_inventory_for_order` RPC (migration 015) either way, so cancel-then-delete
  never double-credits. Cancelling keeps the order on record; delete removes it.
- **Shipping is always a cost, only sometimes also revenue.** `orders.estimated_shipping`
  + `orders.shipping_buyer_covered` (migration 020) feed the Pricing & Margin calc
  (order detail page and the dashboard profit widget — kept in sync, same formula in both):
  `cost = materials + labor + shipping` (always); `revenue = suggested_price +
  (buyer covers it ? shipping : 0)`. So buyer-covered shipping is revenue-neutral (collected,
  then spent on postage — a wash aside from the marketplace fee still applying to that
  portion); seller-covered shipping comes straight out of profit. Get this wrong (e.g. add
  shipping to revenue without also costing it) and imported orders' shipping/tax silently
  reads as pure profit — a real bug hit and fixed this session.
- `order_items.item_type` ('product'|'shipping') + `buyer_covered` (migration 019) — a
  marketplace-imported order gets a synthetic "Shipping & tax" line so line items sum to
  what was actually charged; unchecking "Buyer covered this" on that line excludes it from
  the order detail page's billed total (`billableAmount()` helper).

## Current state (as of this session)
Live and deployed:
- Deployed to Vercel: **https://orderforge-eight.vercel.app** (auto-redeploys on push/merge
  to `main`).
- On `main`: everything through PR #9 — cancelled order status + shared restock RPC, forgot/
  reset password, auth architecture (cookie-based sessions), and the full Etsy marketplace
  integration (eBay side still unverified — see below), plus everything from before
  (profit/margin, low-stock alerts, sale-price billing, launch polish).
- **Etsy connection confirmed working end-to-end on the live production site**, not just
  local dev (2026-09-03) — shop "LikeGravyArts" connected, synced, no errors.
- **Supabase Site URL / Redirect URLs must include the Vercel domain** (Authentication →
  URL Configuration) or password-reset emails link back to `localhost` instead — hit this
  live, fixed by adding `https://orderforge-eight.vercel.app/**` alongside `localhost:3000/**`.
- **All Vercel env vars must be set explicitly, per var** — adding some and assuming others
  "must be fine" doesn't hold: `NEXT_PUBLIC_APP_URL`, `ETSY_CLIENT_ID`, `ETSY_REDIRECT_URI`,
  `SUPABASE_SERVICE_ROLE_KEY`, and `ETSY_SHARED_SECRET` all silently ended up blank at one
  point or another on Vercel during setup (some via a name mixup — `ETSY_CLIENT_SECRET` got
  created instead of `ETSY_SHARED_SECRET`), each producing a different confusing downstream
  symptom (redirects to localhost, "missing API credentials," "couldn't connect," Settings
  silently showing "not connected" with no error). **Vercel also masks variable values in the
  list view** — a value that looks blank at a glance may just need the reveal/eye icon
  clicked to confirm. If Etsy/eBay integration breaks again after an env var change, check
  every relevant var's actual value individually rather than assuming "I added it" was enough.
`npm run build` passes; `npx tsc --noEmit` is clean.

## Auth architecture (changed this session)
Switched from a plain `@supabase/supabase-js` browser client (session in
localStorage only) to `@supabase/ssr`: `lib/supabase.ts` now uses
`createBrowserClient` (session in cookies), `lib/supabase/server.ts` has a
cookie-reading server client for Route Handlers/Server Components, and
`proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts` — see AGENTS.md)
refreshes the session cookie on `/dashboard/*` and `/api/integrations/*`.
This was required so server-side OAuth callback routes can identify the
signed-in user. **One-time consequence: existing logged-in sessions don't
carry over** — everyone (including you) has to log in again once.
`lib/supabase/admin.ts` adds a service-role client for tables the user's own
session must never read (see marketplace_connections below);
`SUPABASE_SERVICE_ROLE_KEY` must be set for it to work.

## Marketplace integrations (Etsy/eBay)
Goal: pull a seller's Etsy/eBay orders in automatically. Per-provider code in
`lib/integrations/{etsy,ebay}.ts` implementing a shared `MarketplaceProvider`
interface (`lib/integrations/types.ts`); OAuth + sync Route Handlers live at
`app/api/integrations/<provider>/{connect,callback,sync,disconnect}` (thin
wrappers around `lib/integrations/routeHelpers.ts`); shared import/update
logic in `lib/integrations/sync.ts`; UI in the Settings page ("Marketplace
connections" section).

**Etsy: fully live-tested end-to-end against a real approved app** (2026-09-03)
— connect, token exchange, shop lookup, order import, shipping/tax
reconciliation, idempotent re-sync, and change-detection updates all
confirmed working against real data. Corrections made from what live testing
actually showed (training knowledge was wrong on these specifics):
- Every `v3/application/*` call needs `x-api-key: <keystring>:<shared_secret>`
  (colon-joined) — plain Keystring alone 403s. `ETSY_SHARED_SECRET` required.
- Etsy's receipts endpoint filters by **creation** date, not last-modified —
  so `fetchOrdersSince` deliberately ignores the sync cursor and re-checks the
  most recent 100 receipts every time; `sync.ts` skips anything unchanged, so
  this costs an extra API call, not writes.
- Real receipt money fields (confirmed against a live receipt): `subtotal`
  (item revenue only) + `total_shipping_cost` + `total_tax_cost` +
  `total_vat_cost` + `gift_wrap_price` − `discount_amt` = `grandtotal`,
  exactly. Import writes `subtotal` to `suggested_price` and the rest to
  `estimated_shipping` — **not** the combined grandtotal (that was the bug
  described above; got it wrong on the first pass, fixed after real numbers
  showed shipping reading as pure profit).

**eBay: still unverified** — same shape/pattern as Etsy but no eBay
credentials tested yet. Field names (`pricingSummary`, `lineItemCost`,
`orderFulfillmentStatus`) and the `x-api-key`-style quirk possibly not
applying are all flagged inline as needing a live check once credentials exist.

- `marketplace_connections` (migration 016) holds OAuth tokens — RLS enabled
  with **no policies**, so it's reachable only via the service-role client,
  never the user's own session.
- `orders.external_source`/`external_order_id` (migrations 017+018) make
  imports idempotent — re-syncing never duplicates an order. 018 fixes 017's
  unique index (had to be a real constraint, not a partial one, for
  PostgREST's `upsert(..., { onConflict, ignoreDuplicates: true })` to target it).
- Re-sync **does** pick up status/price changes on already-imported orders
  (compares stored vs. fetched, updates order-level fields only) but
  deliberately never touches line items on an update — those can be manually
  edited (the quantity editor), so a re-sync must not risk clobbering that.
- New env vars documented inline in `.env.local`: `ETSY_CLIENT_ID`,
  `ETSY_REDIRECT_URI`, `ETSY_SHARED_SECRET`, `EBAY_CLIENT_ID`,
  `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`, `EBAY_ENV`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.

## Known debt / follow-ups
- Pre-existing ESLint errors (`no-explicit-any`, some react-hooks rules) — **non-blocking**,
  the Turbopack build does not fail on them.
- One historical order `ORD-880512` has a `suggested_price` ($15) but no line item —
  add it by hand on the order page if you want its revenue/invoice to reflect $15.
- eBay side of the marketplace integration is unverified (see above) — needs a
  registered eBay app + live test pass before relying on it.
- Marketplace sync is manual ("Sync now" button) — no scheduled/background sync yet.
