'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import ProductEditor from '@/app/components/ProductEditor'
import ProductCard from '@/app/components/ProductCard'
import Link from 'next/link'
import HelpTour, { HelpButton } from '@/app/components/tour/HelpTour'
import { productTour } from '@/app/components/tour/productTour'

export default function ProductsPage() {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<any | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  // The cards show each template's bill of materials and material cost, so the
  // materials come back with the products (as `items`, which is what the card
  // and the editor both read).
  const load = async () => {
    const { data } = await supabase
      .from('products')
      .select('*, product_items(*)')
      .order('created_at', { ascending: false })
    setProducts((data || []).map(({ product_items, ...p }: any) => ({ ...p, items: product_items || [] })))
  }

  useEffect(() => {
    load().then(() => setLoading(false))
    // get current user id for product creation
    ;(async () => {
      try {
        const { data: ud } = await supabase.auth.getUser()
        setUserId((ud as any)?.user?.id || null)
      } catch (e) {
        console.warn('Failed to get user', e)
      }
    })()
  }, [])

  const refresh = load

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Product Templates</h1>
          <div className="flex items-center gap-3">
            <HelpButton onClick={() => setShowHelp(true)} />
            <button
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded"
              onClick={() => setEditing({})}
              disabled={userId === null}
              title={userId === null ? 'Sign in to create templates' : ''}
            >
              + New Template
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-4">
            {products.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                onEdit={() => setEditing(p)}
                onDelete={async () => {
                  await supabase.from('products').delete().eq('id', p.id)
                  await supabase.from('product_items').delete().eq('product_id', p.id)
                  refresh()
                }}
              />
            ))}
          </div>
        )}

        {/* Under the list rather than in the header, where the arrow read as
            pointing at the Help button beside it. */}
        {!loading && (
          <div className="mt-4 flex justify-end">
            <Link href="/dashboard/products/profitability" className="text-sm text-indigo-400 hover:text-indigo-300">
              Cross-Channel Profitability →
            </Link>
          </div>
        )}

        {showHelp && <HelpTour tour={productTour} onClose={() => setShowHelp(false)} />}

        {editing && (
          <div className="mt-6">
            <ProductEditor
              userId={userId}
              product={editing}
              onSaved={async () => { setEditing(null); await refresh() }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
