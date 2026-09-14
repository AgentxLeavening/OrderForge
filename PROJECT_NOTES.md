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
- On `main`: everything through PR #10 — cancelled order status + shared restock RPC, forgot/
  reset password, auth architecture (cookie-based sessions), Etsy/Shopify/eBay/TikTok/Facebook
  marketplace integrations, order workflow automation (Shipped status, tracking numbers,
  invoice-auto-quotes), and the Reports feature (cross-channel profitability, tax export),
  plus everything from before (profit/margin, low-stock alerts, sale-price billing, launch polish).
- **Etsy, Shopify, and eBay all confirmed working end-to-end on the live production site**
  (not just local dev) — connect + sync verified for all three with real Vercel credentials
  (2026-09-03 Etsy, 2026-09-05 Shopify + eBay). TikTok Shop/Facebook remain untested (no
  credentials for either).
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

## Marketplace integrations (Etsy/eBay/Shopify/TikTok Shop/Facebook)
Goal: pull a seller's marketplace orders in automatically. Per-provider code in
`lib/integrations/{etsy,ebay,shopify,tiktok,facebook}.ts` implementing a shared
`MarketplaceProvider` interface (`lib/integrations/types.ts` — `id`, `label`,
plus the OAuth/fetch methods); OAuth + sync Route Handlers live at
`app/api/integrations/<provider>/{connect,callback,sync,disconnect}` (thin
wrappers around `lib/integrations/routeHelpers.ts`); shared import/update
logic in `lib/integrations/sync.ts`; UI in the Settings page ("Marketplace
connections" section) — `marketplace_connections.provider` check constraint
(migration 021) allows all five.

**Shopify is architecturally different from the others**: there's no single
global authorize URL — every OAuth request is scoped to a specific
`<store>.myshopify.com` domain, which the seller has to type into a box in
Settings *before* clicking Connect (`?shop=` on the connect route, threaded
through a short-lived cookie to the callback, same as the PKCE state/verifier
cookies). `MarketplaceProvider.buildAuthorizeUrl`/`exchangeCodeForToken` take
an optional `shopDomain` for this; every other provider ignores it. Shopify's
offline access tokens don't expire and have no refresh flow.

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

**eBay: LIVE ON PRODUCTION 2026-09-09** — connected with a real seller
account and real orders importing; see the production launch checklist below
for how it was set up and what's still worth confirming. Field mapping
(`pricingSummary`, `lineItemCost`, `orderFulfillmentStatus`) has since been
checked against the Fulfillment API schema and is correct. The rest of this
section is the earlier Sandbox history, kept because its findings still hold.

**eBay: connect + sync structurally verified 2026-09-04** (Sandbox credentials,
shop "like-gravy" seller test user) — OAuth connect/callback, token exchange,
and the account-lookup + orders-fetch API calls all confirmed working
end-to-end. Order field mapping was unverified at that point — blocked on a real
Sandbox test order created (hit an eBay-side Sandbox listing issue, a
"Shipping method" dropdown with no values, seemingly a Sandbox outage rather
than our config — parked, pick back up later). Real findings from what *did*
get tested live, corrected from initial guesses:
- **eBay hard-requires HTTPS for the redirect URI — no exception for
  localhost**, unlike Etsy/Shopify which both allow plain `http://localhost`.
  Its RuName "Accepted URL" field won't even save a value without `https://`
  (auto-re-adds the `s` if you try to remove it). For local dev testing
  against eBay specifically, run `npx next dev --experimental-https`
  (Next.js's built-in self-signed-cert dev server — first run downloads
  `mkcert` and generates a cert into `certificates/`, gitignored) instead of
  the normal `npm run dev`, and temporarily point `NEXT_PUBLIC_APP_URL` +
  `EBAY_REDIRECT_URI`'s registered Accepted URL at `https://localhost:3000`.
  Switch back to plain `npm run dev` afterward — Etsy/Shopify's registered
  redirect URIs are still the `http://` versions and would break under the
  https-only dev server.
- The account-lookup call (`GET /sell/account/v1/privilege`, originally added
  as a token sanity-check + placeholder identity) 403s — needs a `sell.account`
  scope we don't request and don't otherwise need. Removed entirely rather
  than requesting a scope just for this; `fetchShopInfo` now returns a static
  placeholder with no API call, matching how little eBay's Fulfillment API
  actually has a "shop" concept to look up in the first place.
- eBay's own OAuth consent screen won't re-prompt once you've approved a
  given RuName+account combo before (e.g. via eBay's own "Get a Token" testing
  tool) — expected OAuth behavior, not a bug, if "Connect eBay" completes
  without showing a consent screen.

**Shopify: connect verified live 2026-09-03** (dev store
`like-gravy-dev.myshopify.com`) — OAuth connect/callback and token exchange
confirmed working. **Order sync blocked** on a Shopify policy wall: orders
contain customer PII, and REST endpoints reject requests until the app
selects its protected-customer-data fields in the Partner Dashboard (Apps →
app → **API access requests** → **Protected customer data access** → Request
access → select fields, e.g. Customer name). For a development store this is
immediate, no review wait — just needs doing once. Shop name currently stores
as the raw domain rather than a friendly display name (cosmetic; skipped the
extra lookup call since the domain's already known at connect time).
- **TikTok Shop**: HEAVILY unverified — every API call needs a request
  signature (HMAC-SHA256 over the app secret; see `lib/integrations/tiktok.ts`
  `signRequest`), not just OAuth. The exact canonicalization, endpoint
  versions, and even the authorize/token URLs are a best-effort
  reconstruction, more likely to need real correction than anything else here.
- **Facebook & Instagram Shop**: HEAVILY unverified — two independent risks.
  The commerce permissions this needs typically require a formal Meta App
  Review before they work for anyone but the app's own admins/testers
  (separate from whether the code is right), and there's no single "shop ID"
  handed back after OAuth — `fetchShopInfo` has to discover a Commerce
  Account through Business Manager, which is a real simplification
  (first business, first commerce account) for anyone with more than one.

- `marketplace_connections` (migration 016, provider list widened in 021)
  holds OAuth tokens — RLS enabled with **no policies**, so it's reachable
  only via the service-role client, never the user's own session.
- `orders.external_source`/`external_order_id` (migrations 017+018) make
  imports idempotent — re-syncing never duplicates an order. 018 fixes 017's
  unique index (had to be a real constraint, not a partial one, for
  PostgREST's `upsert(..., { onConflict, ignoreDuplicates: true })` to target it).
- Re-sync **does** pick up status/price changes on already-imported orders
  (compares stored vs. fetched, updates order-level fields only) but
  deliberately never touches line items on an update — those can be manually
  edited (the quantity editor), so a re-sync must not risk clobbering that.
- **Tracking numbers import too** (2026-09-14, **verified live on production**
  — a real eBay sync filled 81 of 83 orders; the 2 without simply have no
  tracking on eBay) — `orders.tracking_number` is
  filled from the marketplace where one exists. Etsy (receipt `shipments[]`
  → `tracking_code`) and Shopify (order `fulfillments[]` →
  `tracking_number`) both include it in the orders payload, so it's free.
  **eBay does not**: tracking lives on
  `/order/{orderId}/shipping_fulfillment`, one extra API call per order. So
  the provider interface has an optional `fetchTrackingNumber` hook that
  `sync.ts` calls **lazily** — only when an order is `shipped` AND has no
  tracking stored — making it one extra call per order once, rather than one
  per order per sync against eBay's shared daily quota. Don't "simplify" this
  into fetching tracking for every order in `fetchOrdersSince`; that's the
  version that burns the rate limit.
  Tracking is only ever *filled in*, never overwritten — a number typed by
  hand on the order page survives every re-sync (same rule as line items and
  the title backfill). Note an Etsy receipt often has an empty `shipments`
  array even when shipped, since a seller can mark shipped without tracking;
  that's "no tracking", not an error.
  The sync response carries a `tracking` breakdown (shipped / alreadyStored /
  fromPayload / lookups / fromLookup / lookupErrors / firstError / written),
  readable in the browser's network response for the sync POST. It exists
  because a silent `null` made "lookup broke" and "nothing to find"
  indistinguishable; it immediately showed the opposite of the suspected bug
  (`alreadyStored: 81` — the import had already worked). Keep it.
- **Imported orders are titled after what sold**, not the order number
  (2026-09-09) — the first product line item's description, plus
  `+N more` when there are several. The dashboard kanban card shows that
  title with the order number underneath, so a glance says "Resin dice set"
  rather than "eBay order 12-34567-89012". Applies to all providers.
  A re-sync **backfills** orders imported before this, but only where the
  stored title is still character-for-character the old auto-generated
  `<Provider> order <id>` — a renamed order is left alone, same
  never-clobber-a-manual-edit rule the line items follow. Backfill only
  reaches orders inside each provider's fetch window (eBay: 90 days;
  Etsy: most recent 100 receipts), so anything older keeps its old title.
- New env vars documented inline in `.env.local`: `ETSY_CLIENT_ID`,
  `ETSY_REDIRECT_URI`, `ETSY_SHARED_SECRET`, `EBAY_CLIENT_ID`,
  `EBAY_CLIENT_SECRET`, `EBAY_REDIRECT_URI`, `EBAY_ENV`,
  `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_REDIRECT_URI`,
  `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI`,
  `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_REDIRECT_URI`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`. **Every Vercel env var
  needs its actual value double-checked individually when wiring a new
  provider up there** — see the "All Vercel env vars must be set explicitly"
  note above; this bit Etsy's rollout on five separate variables.

## Order workflow automation (2026-09-04/05)
- **Shipped status** added between In Progress and Complete (`orders.status`
  is free text, no DB constraint, so this needed no migration) — kanban
  board widened to `xl:grid-cols-6` so all six statuses fit on one row.
  Marketplace imports map a shipped/fulfilled signal to `'shipped'`, not
  `'complete'` — none of the providers actually tell us a transaction is
  fully closed out, only that it shipped.
- **Generate Invoice auto-sets status to Quoted** (sending a price *is* the
  quote) — but the button is only enabled while status is Inquiry or Quoted,
  otherwise it would keep dragging a further-along order backward every time
  someone re-generates an invoice.
- **Tracking Number field** (`orders.tracking_number`, migration 022) —
  filling it in for the first time auto-advances status to Shipped, but only
  forward and only from an earlier stage (never touches an order already
  Shipped/Complete/Cancelled), so re-saving other fields later can't drag a
  finished order backward either.

## Reports (`/dashboard/reports`, 2026-09-05)
Roadmap of 4 differentiator features (things no single marketplace's own
dashboard could show, since they only know about their own channel): built
the first two, planned the other two.

- **Cross-Channel Profitability** (`/dashboard/products/profitability`, also
  linked from Products) — groups every priced order by product then by
  channel, showing revenue/profit/margin per pair (e.g. "this decal earns
  41% margin on Shopify but only 19% on Etsy"). Needed `orders.product_id`
  (migration 023, nullable FK to `products`) since orders previously had no
  formal link to a template at all:
  - Template-created orders set it directly at creation (`NewOrderModal`).
  - Marketplace imports auto-match by exact title against the user's product
    names (case/whitespace-insensitive), done once at insert time in
    `sync.ts` — re-syncing an existing order never touches `product_id`
    again, so a manual correction always survives.
  - Every order also gets a manual "Product" dropdown on its detail page to
    link or override at any time — this was a deliberate design choice
    (user: "a mix of both") over relying on auto-match alone, since listing
    titles often differ slightly across channels for "the same" item.
- **Tax Season Export** (`/dashboard/reports/tax-export`) — date range →
  one CSV (order number, date, channel, buyer, revenue, materials, labor,
  shipping, marketplace fee, profit) across every channel, cancelled orders
  excluded. Plain client-side CSV building (no library) with minimal
  comma/quote/newline escaping.
- **lib/pricing.ts** — extracted the order-economics formula (shipping
  always cost, only sometimes also revenue, etc.) out of the order detail
  page and dashboard widget into one shared function, now also used by both
  reports above. Was previously duplicated in two places, which is exactly
  what let the 2026-09-03 shipping-as-pure-profit bug happen — do not
  reintroduce a third inline copy of this formula anywhere.
- **Not yet built**: a unified reorder/purchase list (low-stock items →
  real shopping list with estimated cost, timed to actual cross-channel
  consumption velocity), and estimated-vs-actual time tracking per order
  (a timer compared against the `est_time` used in pricing).

## Marketplace orders now deduct inventory (2026-09-06)
Auto-matched marketplace imports (see `product_id` above) now deduct that
product's BOM at import time, same as template-created orders — previously
`product_id` was purely informational for the profitability report and never
touched inventory at all, so a sale on Etsy/Shopify/eBay didn't reduce stock
even when correctly linked to a product with a full bill of materials.
- **Needed a new service-role-only RPC** (`deduct_inventory_for_order_admin`,
  migration 024) rather than extending the existing `deduct_inventory_for_order`
  (migration 007): that original function reads `auth.uid()` internally and is
  directly callable by any signed-in client via `supabase.rpc(...)`, so adding
  a `p_user_id` override parameter to it would let any authenticated user pass
  someone else's user_id and deduct/corrupt their inventory. The admin version
  takes `p_user_id` explicitly and is revoked from `public` (covers anon/
  authenticated too) — unreachable from any client-side call regardless of
  parameters, only usable via the service-role client in `lib/integrations/sync.ts`.
- Only deducts on an **auto-matched product at import time** — linking a
  product manually later on the order detail page never retroactively
  deducts, since the seller may have already accounted for that sale by hand.
- **Verified locally** (2026-09-06): confirmed correct end-to-end against a
  real re-imported Etsy order — inventory dropped exactly as expected (930g
  → 920g White PLA for two 5g-BOM test orders), transactions logged with
  `reason = 'order_template_deduction'` so they're picked up by the existing
  cancel/delete restock logic too. **Not yet verified on production** — this
  is uncommitted/unpushed as of this note; commit, push, merge, then redo the
  same live-order test against `https://orderforge-eight.vercel.app` before
  considering it done.

## eBay production launch checklist (started 2026-09-08)
Goal: get eBay working for real users, not just Sandbox. `ebay` is pulled out
of Settings' `VISIBLE_PROVIDERS` so no one can connect it until this is done.
Steps, in order:

1. **DONE (code, 2026-09-08)**: `app/api/integrations/ebay/deletion/route.ts` —
   eBay requires a working Marketplace Account Deletion/Closure notification
   endpoint before it'll keep a **Production** keyset active for any OAuth
   scope that reads user data (ours: `sell.fulfillment`). Not needed for
   Sandbox, which is why nothing broke before now. GET does the
   challenge/response handshake eBay validates live when you save the
   portal config; POST just acknowledges (we don't retain buyer PII beyond
   a username today — see the file's comments).
2. **DONE (portal, 2026-09-09)**: Production keyset created on the existing
   app, separate from the Sandbox one still in `.env.local`. Production
   Client ID is `TylerLea-OrderFor-PRD-c82b86fbd-5d34dc68`; the Cert ID
   lives only in Vercel. Verified live via a `client_credentials` grant
   against `https://api.ebay.com/identity/v1/oauth2/token` — HTTP 200,
   Application Access Token issued, so the pair is correct and the keyset
   is active (eBay disables non-compliant production keysets, so a 200
   here is also a compliance signal). **That check only exercises the
   basic `api_scope`** — it proves nothing about `sell.fulfillment`
   consent or the RuName, both of which need a real OAuth round trip.
   Handy as a first triage step if eBay breaks later: if
   `client_credentials` still 200s, the keyset is fine and the problem is
   scope/RuName/token-storage, not credentials.
3. **DONE (Vercel, 2026-09-09)**: `EBAY_DELETION_ENDPOINT_URL` and
   `EBAY_DELETION_VERIFICATION_TOKEN` set on Production and redeployed.
   Verified by computing sha256(challenge + token + endpointUrl) locally
   and diffing it against what the live endpoint returned for a fresh
   challenge code — exact match, HTTP 200. POST also confirmed returning
   200 for both a well-formed notification body and an empty body (a 500
   on the empty case would make eBay retry forever).
4. **DONE (portal, 2026-09-09)**: Endpoint URL + verification token entered
   under Alerts & Notifications → Marketplace Account Deletion; eBay's live
   verification passed and the config saved.
5. **DONE (Vercel, 2026-09-09)**: Production `EBAY_CLIENT_ID` /
   `EBAY_CLIENT_SECRET` / `EBAY_REDIRECT_URI` set and `EBAY_ENV` cleared.
   The RuName is an identifier — NOT the callback URL, which goes in that
   RuName's "Accepted URL" field in the portal, pointing at
   `https://orderforge-eight.vercel.app/api/integrations/ebay/callback`.
   `.env.local` deliberately stays on Sandbox for local dev.
   Took three attempts; see the gotchas above — each var was wrong in turn
   (`EBAY_CLIENT_ID` still Sandbox, then no production RuName existed at
   all), and each fix needed its own redeploy.
6. **DONE (live test, 2026-09-09)**: `ebay` is in `VISIBLE_PROVIDERS`,
   connect succeeded with a real seller account on the production site, and
   real orders import — arriving as **Shipped**, which is expected: the
   90-day lookback window mostly contains already-fulfilled orders and
   `FULFILLED` maps to `'shipped'` by design.
   - **Money spot-checked 2026-09-09**: a handful of imported orders were
     compared against eBay's own figures and the amounts looked right —
     items subtotal plus the synthetic "Shipping & tax" line reconciling to
     what the buyer paid. Not an exhaustive audit, so if a margin ever looks
     too good on an eBay order, check that line first: a `0.00` shipping/tax
     value on an order that definitely had shipping means
     `pricingSummary.total` isn't resolving and the gap is being swallowed
     as pure profit — the exact bug that hit Etsy.
   - **Watch out for a stale Sandbox connection row.** If eBay was ever
     connected from the production site under Sandbox credentials, the
     `marketplace_connections` row still holds that Sandbox token; after the
     env flip Settings will show "Connected" while every sync 401s against
     the production API. Disconnect and reconnect rather than debugging the
     sync path.
7. **DONE**: `ebay` left in `VISIBLE_PROVIDERS` and committed.
8. **TODO (cleanup)**: Regenerate the production Cert ID in the
   portal and update it on Vercel — the original was pasted into a Claude
   Code session transcript during setup.

### Gotchas hit during this rollout (2026-09-09)
- **Vercel bakes env vars at build time.** Saving a variable does nothing to
  the running deployment — every env change needs a fresh redeploy. Cost a
  round trip here.
- **eBay's OAuth errors are misleading, but they do localise the fault**, and
  the same two errors mean different things depending on which host you land
  on (check the hostname on the `auth2.*.ebay.com/oauth2/errorOauth` page):
  - `unauthorized_client` / "The OAuth client was not found" = the client ID
    doesn't exist on that eBay environment, i.e. `EBAY_CLIENT_ID` and
    `EBAY_ENV` disagree. Landing on `auth2.ebay.com` means the ID is still
    the Sandbox one; `auth2.sandbox.ebay.com` means `EBAY_ENV` is still
    `sandbox`.
  - `temporarily_unavailable` / "authorization server is currently unable to
    handle the request" = **not an outage**. With a valid client ID it means
    the `redirect_uri` isn't a RuName belonging to that keyset (verified: a
    Sandbox RuName, a raw callback URL, and a bogus string all produce it).
  - Useful trick: probing `https://auth.ebay.com/oauth2/authorize?...` with
    `curl -sL` and reading the final `errorOauth?errorId=` URL diagnoses
    these from the terminal without a deploy cycle.
- **A production keyset does not inherit the Sandbox RuName** — it has to be
  created separately under Application Keys → Production → User tokens →
  "Get a Token from eBay via Your Application". Its form requires a **privacy
  policy URL**, which is why `app/privacy/page.tsx` exists.

## Known debt / follow-ups
- **eBay account deletion notifications are acknowledged but not acted on —
  blocker for onboarding any user other than the developer.**
  `app/api/integrations/ebay/deletion/route.ts` returns 200 and logs, without
  scrubbing anything. That is currently defensible only because the sole user
  is the app's owner and the only third-party PII stored is a buyer display
  name (`lib/integrations/ebay.ts` maps `o.buyer?.username` → `buyerName` on
  imported orders). Once real sellers connect, those usernames belong to
  strangers across many accounts, and eBay's Marketplace Account Deletion
  policy requires actually deleting them on notification. Before a second
  user is onboarded: implement real deletion keyed off
  `notification.data.username` / `userId`, and re-check whether
  `app/privacy/page.tsx` still describes what is stored.
- Pre-existing ESLint errors (`no-explicit-any`, some react-hooks rules) — **non-blocking**,
  the Turbopack build does not fail on them.
- One historical order `ORD-880512` has a `suggested_price` ($15) but no line item —
  add it by hand on the order page if you want its revenue/invoice to reflect $15.
- **Shopify: fully verified 2026-09-05** — protected-customer-data step done,
  a real test order synced cleanly with correct field mapping (subtotal,
  line items, buyer). Consider this provider done.
- eBay: connect + sync verified live on **production** 2026-09-09 with a real
  seller account — real orders import. Field names in `fetchOrdersSince` were
  also checked against the Fulfillment API schema and are correct:
  `pricingSummary.total` and `lineItems[].lineItemCost` are both `Amount`
  objects with a `value`, alongside `title`, `quantity`, `buyer.username`,
  and `creationDate`.
- ~~eBay `PARTIALLY_FULFILLED` dead branch~~ — **fixed 2026-09-09.**
  `orderFulfillmentStatus` only ever returns `NOT_STARTED` | `IN_PROGRESS` |
  `FULFILLED`, so the guessed `PARTIALLY_FULFILLED` never matched; the check
  is now `=== 'FULFILLED'`. No behaviour change (a partly-shipped order still
  falls through to `'in_progress'`, which is correct).
- **Auto-completing orders on delivery: carrier tracking lookup is the way
  to do it.** Decided 2026-09-09 to leave imported orders terminating at
  Shipped for now. No marketplace tells us an order was *delivered* —
  eBay's `orderFulfillmentStatus` stops at `FULFILLED`, and its
  `ShippingFulfillment` resource carries only `shipmentTrackingNumber`,
  `shippedDate`, and `shippingCarrierCode`, with no delivery confirmation
  anywhere. The rejected alternative was a time-based heuristic (mark
  Complete N days after shipping), which guesses at status and cuts against
  the rule this codebase already follows everywhere else — never advance an
  order's status on assumption (cf. the tracking-number and invoice-quote
  rules). A wrong "Complete" is worse than an accurate "Shipped", not least
  because Reports reads off these statuses.
  The better future option: feed `shipmentTrackingNumber` +
  `shippingCarrierCode` to a carrier API or an aggregator (EasyPost,
  Shippo, etc.) and advance to Complete on a real delivered event. That
  gives actual delivery data rather than a guess, and because
  `orders.tracking_number` already exists and Etsy/Shopify also expose
  tracking, it would work across all three providers rather than being an
  eBay-only feature.
- TikTok Shop/Facebook: fully unverified, no credentials tested at all yet.
- Marketplace sync is manual ("Sync now" button) — no scheduled/background sync yet.
