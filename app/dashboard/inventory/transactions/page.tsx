'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Tx = {
  id: string
  inventory_item_id: string
  change: number
  previous_quantity: number | null
  new_quantity: number | null
  reason: string | null
  metadata: any
  created_at: string
  inventory_items?: { id: string; name?: string; sku?: string } | null
  orders?: { id: string; order_number?: string } | null
}

export default function InventoryTransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(100)

  const fetch = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('inventory_transactions')
      .select('*, inventory_items(id,name,sku), orders(id,order_number)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('Failed fetching inventory transactions', error)
      setTxs([])
    } else {
      setTxs((data || []) as Tx[])
    }
    setLoading(false)
  }

  useEffect(() => { fetch() }, [limit])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Inventory Transactions</h1>
          <div className="flex items-center gap-2">
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="bg-gray-800 text-white rounded px-3 py-2">
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button onClick={fetch} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded">Refresh</button>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="grid grid-cols-12 gap-2 text-gray-400 text-xs uppercase tracking-wide px-2 mb-2">
            <div className="col-span-2">When</div>
            <div className="col-span-3">Item</div>
            <div className="col-span-2 text-center">Change</div>
            <div className="col-span-2 text-center">Prev → New</div>
            <div className="col-span-2">Reason</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {loading ? <p className="text-gray-400 px-2">Loading…</p> : txs.length === 0 ? <p className="text-gray-400 px-2">No transactions yet.</p> : txs.map(tx => (
              <div key={tx.id} className="grid grid-cols-12 gap-2 items-center bg-gray-800 rounded-lg px-4 py-3">
                <div className="col-span-2 text-gray-300">{new Date(tx.created_at).toLocaleString()}</div>
                <div className="col-span-3 text-white">{tx.inventory_items?.name || tx.metadata?.name || 'Unknown' } <span className="text-gray-400">{(tx.inventory_items?.sku || tx.metadata?.sku) ? `(${tx.inventory_items?.sku || tx.metadata?.sku})` : ''}</span></div>
                <div className={`col-span-2 text-center ${tx.change < 0 ? 'text-red-400' : 'text-green-400'}`}>{tx.change > 0 ? `+${tx.change}` : tx.change}</div>
                <div className="col-span-2 text-center text-white">{tx.previous_quantity ?? '—'} → {tx.new_quantity ?? '—'}</div>
                <div className="col-span-2 text-gray-300">{tx.reason || tx.metadata?.reason || '—'}</div>
                <div className="col-span-1 text-right">
                  {tx.orders?.id ? (
                    <Link href={`/dashboard/orders/${tx.orders.id}`} className="text-indigo-400 hover:underline">Order</Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
