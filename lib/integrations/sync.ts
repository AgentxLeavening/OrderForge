import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { MarketplaceProvider } from './types'

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

// Shared pull-and-import logic for any provider conforming to
// MarketplaceProvider. Always operates via the service-role client, always
// scoped to the given userId — callers must have already verified the caller
// IS that user (see the Route Handlers, which derive userId from the
// session cookie before calling this).
export async function syncProviderOrders(provider: MarketplaceProvider, userId: string) {
  const admin = createSupabaseAdminClient()

  const { data: connection, error: connErr } = await admin
    .from('marketplace_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider.id)
    .single()

  if (connErr || !connection) throw new Error(`No ${provider.id} connection found for this user.`)

  let accessToken = connection.access_token as string
  let shopId = connection.external_shop_id as string | null

  try {
    // Refresh if expired or about to expire (60s buffer).
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

    const normalizedOrders = await provider.fetchOrdersSince({
      accessToken,
      shopId,
      sinceISO: connection.last_synced_at,
    })

    // Auto-match new imports to a product template by exact title (case/
    // whitespace-insensitive) — a starting point the seller can always
    // override on the order detail page, never touched again after insert
    // (see the update path below, which deliberately leaves product_id alone).
    const { data: products } = await admin.from('products').select('id, name').eq('user_id', userId)
    const productIdByName = new Map((products || []).map(p => [String(p.name).trim().toLowerCase(), p.id]))

    let imported = 0
    let updated = 0
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
      if (o.status === 'shipped') tracking.shipped++
      if (storedTracking) tracking.alreadyStored++
      if (o.trackingNumber) tracking.fromPayload++

      if (!trackingNumber && o.status === 'shipped' && provider.fetchTrackingNumber) {
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
          })
          .select('id')
          .single()

        if (insErr || !inserted) { console.warn(`Failed importing ${provider.id} order ${o.externalOrderId}`, insErr); continue }
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
        if (matchedProductId) {
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

      // Never let a re-sync move status backward. No provider's normalized
      // status ever reaches 'complete' (see the type comment in types.ts —
      // marketplaces only ever tell us up through 'shipped'; 'complete' is
      // deliberately something the seller decides in OrderForge, e.g. after
      // a return window). Without this guard, an order the seller already
      // dragged to Complete gets bounced straight back to Shipped on the
      // very next sync, since the marketplace still just reports 'shipped'.
      // 'cancelled' isn't part of this forward progression either — no
      // provider emits it today, it's manual/local-only — so it ranks above
      // 'complete' here purely so a re-sync can never pull an order back
      // out of it.
      const statusRank: Record<string, number> = { inquiry: 0, quoted: 1, in_progress: 2, shipped: 3, complete: 4, cancelled: 5 }
      const nextStatus = statusRank[o.status] >= (statusRank[existing.status] ?? 0) ? o.status : existing.status
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

      if (updErr) { console.warn(`Failed updating ${provider.id} order ${o.externalOrderId}`, updErr); continue }
      updated++
      if (trackingChanged) tracking.written++
    }

    await admin
      .from('marketplace_connections')
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq('id', connection.id)

    return { imported, updated, checked: normalizedOrders.length, tracking }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await admin.from('marketplace_connections').update({ last_sync_error: message }).eq('id', connection.id)
    throw e
  }
}
