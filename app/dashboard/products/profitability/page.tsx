'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { CHANNEL_OPTIONS } from '@/app/components/NewOrderModal'
import { computeOrderEconomics } from '@/lib/pricing'

type OrderRow = {
  id: string
  product_id: string | null
  sales_channel: string | null
  suggested_price: number | null
  material_cost: number | null
  labor_cost: number | null
  estimated_shipping: number | null
  shipping_buyer_covered: boolean
  fee_pct: number | null
  status: string
  products: { name: string }[] | { name: string } | null
}

type ChannelStat = {
  channel: string
  orders: number
  revenue: number
  profit: number
}

type ProductStat = {
  productId: string
  productName: string
  orders: number
  revenue: number
  profit: number
  channels: ChannelStat[]
}

const channelLabel = (value: string | null | undefined) =>
  CHANNEL_OPTIONS.find(o => o.value === (value || ''))?.label ?? (value || 'Not specified')

export default function ProfitabilityPage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<ProductStat[]>([])
  const [unlinkedCount, setUnlinkedCount] = useState(0)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: orders } = await supabase
        .from('orders')
        .select('id, product_id, sales_channel, suggested_price, material_cost, labor_cost, estimated_shipping, shipping_buyer_covered, fee_pct, status, products(name)')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')

      const rows = (orders || []) as OrderRow[]

      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .is('product_id', null)
      setUnlinkedCount(count || 0)

      const byProduct = new Map<string, ProductStat>()

      for (const row of rows) {
        if (!row.product_id) continue
        const productName = Array.isArray(row.products) ? row.products[0]?.name : row.products?.name
        if (!productName) continue

        const { revenue, profit } = computeOrderEconomics(row)
        const channel = channelLabel(row.sales_channel)

        if (!byProduct.has(row.product_id)) {
          byProduct.set(row.product_id, { productId: row.product_id, productName, orders: 0, revenue: 0, profit: 0, channels: [] })
        }
        const product = byProduct.get(row.product_id)!
        product.orders += 1
        product.revenue += revenue
        product.profit += profit

        let channelStat = product.channels.find(c => c.channel === channel)
        if (!channelStat) {
          channelStat = { channel, orders: 0, revenue: 0, profit: 0 }
          product.channels.push(channelStat)
        }
        channelStat.orders += 1
        channelStat.revenue += revenue
        channelStat.profit += profit
      }

      const result = Array.from(byProduct.values())
        .map(p => ({ ...p, channels: p.channels.sort((a, b) => b.profit - a.profit) }))
        .sort((a, b) => b.profit - a.profit)

      setStats(result)
      setLoading(false)
    }
    load()
  }, [])

  const marginOf = (revenue: number, profit: number) => (revenue > 0 ? (profit / revenue) * 100 : 0)

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-white">Cross-Channel Profitability</h1>
          <Link href="/dashboard/products" className="text-sm text-indigo-400 hover:text-indigo-300">← Back to Products</Link>
        </div>
        <p className="text-gray-500 text-sm mb-6">
          Which of your products actually earns the most, and on which channel — real margin (materials, labor, fees, shipping), not just revenue.
        </p>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : stats.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-gray-400 text-sm">
              No orders linked to a product yet. Orders created from a template link automatically; marketplace-imported
              orders get matched by exact title, or you can link any order manually from its detail page.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {stats.map(product => (
              <div key={product.productId} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-white font-semibold">{product.productName}</h2>
                    <p className="text-gray-500 text-xs">{product.orders} order{product.orders === 1 ? '' : 's'} · ${product.revenue.toFixed(2)} revenue</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-semibold ${product.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${product.profit.toFixed(2)}</p>
                    <p className="text-gray-500 text-xs">{marginOf(product.revenue, product.profit).toFixed(0)}% margin</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {product.channels.map(c => (
                    <div key={c.channel} className="grid grid-cols-12 gap-2 items-center bg-gray-800 rounded-lg px-3 py-2 text-sm">
                      <div className="col-span-4 text-gray-200">{c.channel}</div>
                      <div className="col-span-2 text-gray-500 text-xs">{c.orders} order{c.orders === 1 ? '' : 's'}</div>
                      <div className="col-span-3 text-right text-gray-400">${c.revenue.toFixed(2)} rev</div>
                      <div className={`col-span-3 text-right font-medium ${c.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${c.profit.toFixed(2)} ({marginOf(c.revenue, c.profit).toFixed(0)}%)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {unlinkedCount > 0 && (
          <p className="text-gray-600 text-xs mt-6">
            {unlinkedCount} order{unlinkedCount === 1 ? '' : 's'} not shown here — not yet linked to a product. Link any order to
            a product from its detail page to include it in this report.
          </p>
        )}
      </div>
    </div>
  )
}
