import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { channelFeeFixed, channelFeePct } from '@/lib/pricing'
import type { MarketplaceProvider, NormalizedOrder } from './types'

// Deducts a product's BOM for one auto-matched marketplace order — mirrors
// NewOrderModal's template-order deduction (same inventory-item resolution
// order: direct link, then SKU, then name), but via the service-role-only
// deduct_inventory_for_order_admin RPC (migration 024), since this runs with
// no user session/JWT to supply auth.uid() from. Best-effort: logs and
// continues past any one BOM line that can't be resolved, same as the
// client-side version.
async function deductInventoryForMatchedProduct(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  orderId: string,
  productId: string,
  quantityMultiplier: number
) {
  const { data: bomItems } = await admin
    .from('product_items')
    .select('name, sku, quantity, inventory_item_id')
    .eq('product_id', productId)

  for (const it of bomItems || []) {
    const needed = (Number(it.quantity) || 0) * quantityMultiplier
    if (!needed) continue

    const match = it.inventory_item_id
      ? { id: it.inventory_item_id }
      : it.sku
        ? { sku: it.sku }
        : { name: it.name }

    const { data: invRows } = await admin
      .from('inventory_items')
      .select('id')
      .eq('user_id', userId)
      .match(match)

    const row = (invRows || [])[0]
    if (!row) { console.warn('No inventory item found for BOM line', it.name || it.sku); continue }

    const { error: rpcErr } = await admin.rpc('deduct_inventory_for_order_admin', {
      p_user_id: userId,
      p_order_id: orderId,
      p_inventory_item_id: row.id,
      p_quantity: needed,
      p_metadata: { product_id: productId, bom_item_name: it.name || null, auto_matched: true },
    })
    if (rpcErr) console.warn('Failed deducting inventory for', it.name, rpcErr)
  }
}

// Never let a re-sync move status backward. 'complete' is only ever emitted
// from a real delivery signal (Etsy's order.delivered webhook) — marketplaces
// polled on a schedule tell us up through 'shipped', and without this guard an
// order already at Complete (by the seller or by that webhook) would bounce
// straight back to Shipped on the very next poll. 'cancelled' ranks above
// 'complete' so nothing can pull an order back out of it.
const STATUS_RANK: Record<string, number> = { inquiry: 0, quoted: 1, in_progress: 2, shipped: 3, complete: 4, cancelled: 5 }

type Admin = ReturnType<typeof createSupabaseAdminClient>

// Loads the connection and makes it usable: refreshes a token that's expired
// or about to (60s buffer) and resolves the shop id on first use.
async function openConnection(admin: Admin, provider: MarketplaceProvider, userId: string) {
  const { data: connection, error: connErr } = await admin
    .from('marketplace_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider.id)
    .single()

  if (connErr || !connection) throw new Error(`No ${provider.id} connection found for this user.`)

  let accessToken = connection.access_token as string
  let shopId = connection.external_shop_id as string | null

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0
  if (connection.refresh_token && expiresAt && expiresAt - Date.now() < 60_000) {
    const refreshed = await provider.refreshAccessToken(connection.refresh_token)
    accessToken = refreshed.accessToken
    await admin
      .from('marketplace_connections')
      .update({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken ?? connection.refresh_token,
        expires_at: refreshed.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id)
  }

  if (!shopId) {
    const shop = await provider.fetchShopInfo(accessToken)
    shopId = shop.externalShopId
    await admin
      .from('marketplace_connections')
      .update({ external_shop_id: shop.externalShopId, external_shop_name: shop.externalShopName })
      .eq('id', connection.id)
  }

  return { connection, accessToken, shopId }
}

// Shared pull-and-import logic for any provider conforming to
// MarketplaceProvider. Always operates via the service-role client, always
// scoped to the given userId — callers must have already verified the caller
// IS that user (see the Route Handlers, which derive userId from the
// session cookie before calling this).
export async function syncProviderOrders(provider: MarketplaceProvider, userId: string) {
  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('marketplace_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', provider.id)
    .maybeSingle()
  if (!row) throw new Error(`No ${provider.id} connection found for this user.`)

  try {
    const { connection, accessToken, shopId } = await openConnection(admin, provider, userId)

    const normalizedOrders = await provider.fetchOrdersSince({
      accessToken,
      shopId,
      sinceISO: connection.last_synced_at,
    })

    const result = await importOrders(admin, provider, userId, { accessToken, shopId }, normalizedOrders)

    await admin
      .from('marketplace_connections')
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq('id', connection.id)

    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await admin.from('marketplace_connections').update({ last_sync_error: message }).eq('id', row.id)
    throw e
  }
}

/**
 * Imports or updates one order the marketplace just told us about (webhook
 * path), through exactly the same logic as a full sync — status guard,
 * never-clobber rules, inventory deduction and restock all included.
 *
 * `statusFloor` lifts the order to at least that status when the notification
 * itself carries information the order payload doesn't: Etsy's receipt has no
 * delivery field, so order.delivered passes 'complete' here. The forward-only
 * guard still applies, so a floor can never move an order backward.
 *
 * Deliberately leaves last_synced_at / last_sync_error alone: those describe
 * the scheduled poll, and one webhook succeeding says nothing about whether the
 * poll is healthy.
 */
export async function syncSingleOrder(
  provider: MarketplaceProvider,
  userId: string,
  externalOrderId: string,
  opts: { statusFloor?: NormalizedOrder['status'] } = {}
) {
  if (!provider.fetchOrder) throw new Error(`${provider.id} does not support single-order sync.`)
  const admin = createSupabaseAdminClient()
  const { accessToken, shopId } = await openConnection(admin, provider, userId)

  const order = await provider.fetchOrder({ accessToken, shopId, externalOrderId })
  if (!order) return { imported: 0, updated: 0, checked: 0, found: false }

  const floor = opts.statusFloor
  if (floor && STATUS_RANK[floor] > STATUS_RANK[order.status]) order.status = floor

  const result = await importOrders(admin, provider, userId, { accessToken, shopId }, [order])
  if (result.failed) throw new Error(`Failed writing ${provider.id} order ${externalOrderId} (see logs).`)
  return { imported: result.imported, updated: result.updated, checked: result.checked, found: true }
}

async function importOrders(
  admin: Admin,
  provider: MarketplaceProvider,
  userId: string,
  { accessToken, shopId }: { accessToken: string; shopId: string },
  normalizedOrders: NormalizedOrder[]
) {
    // Auto-match new imports to a product template by exact title (case/
    // whitespace-insensitive) — a starting point the seller can always
    // override on the order detail page, never touched again after insert
    // (see the update path below, which deliberately leaves product_id alone).
    // The seller's fee for THIS channel, stamped on each import so profit
    // isn't just the sale price. Read once per sync, applied only at insert —
    // a later change to the default must not silently rewrite the economics of
    // orders already imported and reported on.
    const { data: feeProfile } = await admin
      .from('profiles')
      .select('fee_pct_etsy, fee_pct_ebay, fee_pct_shopify, default_fee_pct, fee_fixed_etsy, fee_fixed_ebay, fee_fixed_shopify, default_fee_fixed')
      .eq('id', userId)
      .maybeSingle()
    const feePct = channelFeePct(feeProfile, provider.id)
    const feeFixed = channelFeeFixed(feeProfile, provider.id)

    const { data: products } = await admin.from('products').select('id, name').eq('user_id', userId)
    const productIdByName = new Map((products || []).map(p => [String(p.name).trim().toLowerCase(), p.id]))

    let imported = 0
    let updated = 0
    // Orders that couldn't be written. A poll just tries them again next run;
    // syncSingleOrder turns any into an error so the webhook is retried.
    let failed = 0
    // Returned in the sync result so "found nothing" and "the lookup broke"
    // are distinguishable from the client, without server-log access.
    const tracking = {
      shipped: 0,        // orders the marketplace reports as shipped
      alreadyStored: 0,  // already had a tracking number on the order
      fromPayload: 0,    // came free in the orders response (Etsy/Shopify)
      lookups: 0,        // extra per-order calls made (eBay)
      fromLookup: 0,     // of those, ones that returned a number
      lookupErrors: 0,
      firstError: null as string | null,
      written: 0,
    }
    for (const o of normalizedOrders) {
      const orderNumber = `${provider.id.toUpperCase()}-${o.externalOrderId}`.slice(0, 32)
      const productItems = o.items.filter(it => it.itemType !== 'shipping')
      const primaryItemDesc = productItems[0]?.description
      const matchedProductId = primaryItemDesc ? productIdByName.get(primaryItemDesc.trim().toLowerCase()) ?? null : null

      // Title the order after what was actually sold, so the dashboard card
      // reads "Resin dice set" rather than "eBay order 12-34567-89012" — the
      // order number is still shown underneath it on the card. Falls back to
      // the old provider+id form only when an order somehow has no product
      // line items (that fallback string is also what the backfill below
      // recognises as "never renamed by the seller", so keep the two in sync).
      const fallbackTitle = `${provider.label} order ${o.externalOrderId}`
      const extraItemCount = productItems.length - 1
      const importedTitle = !primaryItemDesc?.trim()
        ? fallbackTitle
        : extraItemCount > 0
          ? `${primaryItemDesc.trim()} +${extraItemCount} more`
          : primaryItemDesc.trim()

      const { data: existing } = await admin
        .from('orders')
        .select('id, title, status, suggested_price, estimated_shipping, tracking_number')
        .eq('user_id', userId)
        .eq('external_source', provider.id)
        .eq('external_order_id', o.externalOrderId)
        .maybeSingle()

      // Tracking is only ever filled in, never overwritten — the seller can
      // type one by hand on the order page, and a re-sync must not clobber
      // that (same rule the line items and the title backfill follow).
      const storedTracking = (existing?.tracking_number || '').trim()
      let trackingNumber = storedTracking || (o.trackingNumber || '').trim() || null

      // Providers that don't ship tracking in the orders payload (eBay) expose
      // it behind an extra per-order call. Only worth spending when the order
      // looks shipped and we still have nothing — see fetchTrackingNumber's
      // comment in ebay.ts on why this isn't done for every order every sync.
      // Delivered orders have shipped too — an eBay order can now arrive
      // straight at 'complete' and must still get its tracking filled in.
      const hasShipped = o.status === 'shipped' || o.status === 'complete'
      if (hasShipped) tracking.shipped++
      if (storedTracking) tracking.alreadyStored++
      if (o.trackingNumber) tracking.fromPayload++

      if (!trackingNumber && hasShipped && provider.fetchTrackingNumber) {
        tracking.lookups++
        try {
          trackingNumber = await provider.fetchTrackingNumber({
            accessToken,
            shopId,
            externalOrderId: o.externalOrderId,
          })
          if (trackingNumber) tracking.fromLookup++
        } catch (e) {
          // One failed lookup must not fail the import — record why and move
          // on. The first message is returned in the sync result so a failure
          // is visible without digging through server logs.
          tracking.lookupErrors++
          const message = e instanceof Error ? e.message : String(e)
          if (!tracking.firstError) tracking.firstError = message
          console.warn(`${provider.id} tracking lookup failed`, message)
        }
      }

      if (!existing) {
        const { data: inserted, error: insErr } = await admin
          .from('orders')
          .insert({
            user_id: userId,
            title: importedTitle,
            type: 'other',
            status: o.status,
            order_number: orderNumber,
            sales_channel: provider.id,
            buyer_name: o.buyerName,
            suggested_price: o.itemsSubtotal,
            estimated_shipping: o.shippingAndTax,
            shipping_buyer_covered: o.buyerCoversShipping,
            external_source: provider.id,
            external_order_id: o.externalOrderId,
            created_at: o.createdAt,
            product_id: matchedProductId,
            tracking_number: trackingNumber,
            fee_pct: feePct,
            fee_fixed: feeFixed,
          })
          .select('id')
          .single()

        if (insErr || !inserted) { console.warn(`Failed importing ${provider.id} order ${o.externalOrderId}`, insErr); failed++; continue }
        imported++
        if (trackingNumber) tracking.written++

        if (o.items.length) {
          await admin.from('order_items').insert(
            o.items.map(it => ({
              order_id: inserted.id,
              description: it.description,
              quantity: it.quantity,
              unit_price: it.unitPrice,
              item_type: it.itemType ?? 'product',
              buyer_covered: it.buyerCovered ?? true,
            }))
          )
        }

        // Only deducts on an auto-matched product at import time — a product
        // linked manually later never retroactively deducts, since by then
        // the seller may have already accounted for the sale themselves.
        // An order that arrives already cancelled never consumed anything.
        if (matchedProductId && o.status !== 'cancelled') {
          const primaryQty = o.items.find(it => it.itemType !== 'shipping')?.quantity || 1
          try {
            await deductInventoryForMatchedProduct(admin, userId, inserted.id, matchedProductId, primaryQty)
          } catch (e) {
            console.warn(`Inventory deduction failed for ${provider.id} order ${o.externalOrderId}`, e)
          }
        }
        continue
      }

      // Already imported — only touch order-level fields the marketplace
      // actually owns, and only if something changed. Line items are deliberately
      // left alone here: they can be manually edited on any order (the
      // quantity editor), and blindly replacing them on every re-sync would
      // risk silently wiping a manual edit.
      const existingTotal = (Number(existing.suggested_price) || 0) + (Number(existing.estimated_shipping) || 0)
      const newTotal = o.itemsSubtotal + o.shippingAndTax
      const totalChanged = Math.abs(existingTotal - newTotal) > 0.005

      // Forward-only — see STATUS_RANK.
      const nextStatus = STATUS_RANK[o.status] >= (STATUS_RANK[existing.status] ?? 0) ? o.status : existing.status
      const statusChanged = existing.status !== nextStatus

      // One-time backfill for orders imported before titles used the item
      // name. Only rewrites a title that is still character-for-character the
      // old auto-generated "<Provider> order <id>" — anything else means the
      // seller renamed it, and a re-sync must never clobber a manual edit
      // (same rule the line items follow above).
      const titleChanged = existing.title === fallbackTitle && importedTitle !== fallbackTitle

      // Tracking typically shows up after the order was first imported — it's
      // the sync where the order goes shipped that finally has one. Only counts
      // as a change when the stored value was blank; storedTracking winning
      // above means a hand-typed number can never be replaced.
      const trackingChanged = !storedTracking && !!trackingNumber

      if (!totalChanged && !statusChanged && !titleChanged && !trackingChanged) continue

      // The marketplace cancelled it: return whatever the import deducted,
      // same as cancelling by hand. Done BEFORE the status write on purpose —
      // if the restock fails, the order stays un-cancelled, so the webhook
      // retry or the next poll tries again. The other order would leave it
      // marked Cancelled with the stock never returned, and nothing would
      // ever retry. The RPC is idempotent, so retries can't double-credit.
      if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
        const { error: restockErr } = await admin.rpc('restock_inventory_for_order_admin', {
          p_user_id: userId,
          p_order_id: existing.id,
          p_reason: 'order_cancelled_restock',
        })
        if (restockErr) {
          console.warn(`Restock failed for ${provider.id} order ${o.externalOrderId}`, restockErr)
          failed++
          continue
        }
      }

      const { error: updErr } = await admin
        .from('orders')
        .update({
          status: nextStatus,
          suggested_price: o.itemsSubtotal,
          estimated_shipping: o.shippingAndTax,
          shipping_buyer_covered: o.buyerCoversShipping,
          buyer_name: o.buyerName,
          updated_at: new Date().toISOString(),
          ...(titleChanged ? { title: importedTitle } : {}),
          ...(trackingChanged ? { tracking_number: trackingNumber } : {}),
        })
        .eq('id', existing.id)

      if (updErr) { console.warn(`Failed updating ${provider.id} order ${o.externalOrderId}`, updErr); failed++; continue }
      updated++
      if (trackingChanged) tracking.written++
    }

    return { imported, updated, failed, checked: normalizedOrders.length, tracking }
}
