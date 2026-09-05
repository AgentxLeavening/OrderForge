import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { MarketplaceProvider } from './types'

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
    for (const o of normalizedOrders) {
      const orderNumber = `${provider.id.toUpperCase()}-${o.externalOrderId}`.slice(0, 32)
      const primaryItemDesc = o.items.find(it => it.itemType !== 'shipping')?.description
      const matchedProductId = primaryItemDesc ? productIdByName.get(primaryItemDesc.trim().toLowerCase()) ?? null : null

      const { data: existing } = await admin
        .from('orders')
        .select('id, status, suggested_price, estimated_shipping')
        .eq('user_id', userId)
        .eq('external_source', provider.id)
        .eq('external_order_id', o.externalOrderId)
        .maybeSingle()

      if (!existing) {
        const { data: inserted, error: insErr } = await admin
          .from('orders')
          .insert({
            user_id: userId,
            title: `${provider.label} order ${o.externalOrderId}`,
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
          })
          .select('id')
          .single()

        if (insErr || !inserted) { console.warn(`Failed importing ${provider.id} order ${o.externalOrderId}`, insErr); continue }
        imported++

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
      const statusChanged = existing.status !== o.status
      if (!totalChanged && !statusChanged) continue

      const { error: updErr } = await admin
        .from('orders')
        .update({
          status: o.status,
          suggested_price: o.itemsSubtotal,
          estimated_shipping: o.shippingAndTax,
          shipping_buyer_covered: o.buyerCoversShipping,
          buyer_name: o.buyerName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updErr) { console.warn(`Failed updating ${provider.id} order ${o.externalOrderId}`, updErr); continue }
      updated++
    }

    await admin
      .from('marketplace_connections')
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq('id', connection.id)

    return { imported, updated, checked: normalizedOrders.length }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await admin.from('marketplace_connections').update({ last_sync_error: message }).eq('id', connection.id)
    throw e
  }
}
