'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeVenmoUsername } from '@/lib/venmo'
import { normalizePaypalMeName } from '@/lib/paypal'
import StripeConnection from '@/app/components/StripeConnection'

type ProviderId = 'etsy' | 'ebay' | 'shopify' | 'tiktok' | 'facebook'

type Connection = {
  provider: ProviderId
  external_shop_name: string | null
  last_synced_at: string | null
  last_sync_error: string | null
}

const ALL_PROVIDERS: ProviderId[] = ['etsy', 'ebay', 'shopify', 'tiktok', 'facebook']
// Only providers a real seller can actually connect and sync today.
// TikTok Shop and Facebook & Instagram Shop are unverified scaffolding —
// kept out of the connections list so a tester isn't invited to connect
// something that won't work. Flip a provider back in here once it's
// actually ready.
// eBay went in 2026-09-09: production keyset and Marketplace Account
// Deletion compliance are both done, but its order field mapping in
// lib/integrations/ebay.ts `fetchOrdersSince` is still being confirmed
// against a real order — see the checklist in PROJECT_NOTES.md.
const VISIBLE_PROVIDERS: ProviderId[] = ['etsy', 'ebay', 'shopify']
const PROVIDER_LABELS: Record<string, string> = {
  etsy: 'Etsy',
  ebay: 'eBay',
  shopify: 'Shopify',
  tiktok: 'TikTok Shop',
  facebook: 'Facebook & Instagram Shop',
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [markup, setMarkup] = useState('')
  const [feePct, setFeePct] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [venmoUsername, setVenmoUsername] = useState('')
  const [venmoError, setVenmoError] = useState('')
  const [feeEtsy, setFeeEtsy] = useState('')
  const [feeEbay, setFeeEbay] = useState('')
  const [feeShopify, setFeeShopify] = useState('')
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState('')
  const [paypalName, setPaypalName] = useState('')
  const [paypalError, setPaypalError] = useState('')

  const [connections, setConnections] = useState<Connection[]>([])
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null)
  const [connectNotice, setConnectNotice] = useState<{ provider: string; status: string } | null>(null)
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [stripeNotice, setStripeNotice] = useState<string | null>(null)

  const loadConnections = async () => {
    setConnectionsLoading(true)
    try {
      const res = await fetch('/api/integrations/status')
      if (res.ok) {
        const json = await res.json()
        setConnections(json.connections || [])
      }
    } catch (e) {
      console.warn('Failed loading connection status', e)
    }
    setConnectionsLoading(false)
  }

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('profiles')
        .select('business_name, hourly_rate, default_markup, default_fee_pct, default_tax_rate, venmo_username, paypal_me_name, fee_pct_etsy, fee_pct_ebay, fee_pct_shopify')
        .eq('id', user.id)
        .single()
      if (data) {
        setFeeEtsy(data.fee_pct_etsy ?? '')
        setFeeEbay(data.fee_pct_ebay ?? '')
        setFeeShopify(data.fee_pct_shopify ?? '')
        setVenmoUsername(data.venmo_username || '')
        setPaypalName(data.paypal_me_name || '')
        setBusinessName(data.business_name || '')
        setHourlyRate(data.hourly_rate ?? '')
        setMarkup(data.default_markup ?? '')
        setFeePct(data.default_fee_pct ?? '')
        setTaxRate(data.default_tax_rate ?? '')
      }
      setLoading(false)
    }
    load()
    loadConnections()

    // Marketplace OAuth redirects back here with ?etsy=connected or ?ebay=error etc.
    const params = new URLSearchParams(window.location.search)
    // Stripe onboarding returns with ?stripe=connected|pending|expired|error
    const stripeParam = params.get('stripe')
    if (stripeParam) {
      setStripeNotice(stripeParam)
      window.history.replaceState(null, '', '/dashboard/settings')
    }
    for (const provider of ALL_PROVIDERS) {
      const status = params.get(provider)
      if (status) {
        setConnectNotice({ provider, status })
        window.history.replaceState(null, '', '/dashboard/settings')
        break
      }
    }
  }, [])

  const syncNow = async (provider: string) => {
    setSyncingProvider(provider)
    try {
      const res = await fetch(`/api/integrations/${provider}/sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sync failed')
      setConnectNotice({ provider, status: `synced:${json.imported}:${json.updated ?? 0}` })
    } catch (e) {
      console.warn(`Failed syncing ${provider}`, e)
      setConnectNotice({ provider, status: 'sync_error' })
    }
    setSyncingProvider(null)
    await loadConnections()
  }

  const disconnect = async (provider: string) => {
    if (!confirm(`Disconnect ${PROVIDER_LABELS[provider]}? You can reconnect any time.`)) return
    try {
      await fetch(`/api/integrations/${provider}/disconnect`, { method: 'POST' })
    } catch (e) {
      console.warn(`Failed disconnecting ${provider}`, e)
    }
    await loadConnections()
  }

  // Fills the channel fee into imported orders that have none. Deliberately
  // never overwrites an existing fee: an order already reported on shouldn't
  // have its economics rewritten by a settings change.
  const backfillFees = async () => {
    setBackfilling(true)
    setBackfillResult('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setBackfilling(false); return }

    const fees: Record<string, string> = { etsy: String(feeEtsy), ebay: String(feeEbay), shopify: String(feeShopify) }
    let updated = 0
    for (const [channel, value] of Object.entries(fees)) {
      const pct = value.trim() === '' ? null : Number(value)
      if (pct == null || !Number.isFinite(pct)) continue
      const { data, error } = await supabase
        .from('orders')
        .update({ fee_pct: pct })
        .eq('user_id', user.id)
        .eq('external_source', channel)
        .is('fee_pct', null)
        .select('id')
      if (error) { setBackfillResult(error.message); setBackfilling(false); return }
      updated += (data || []).length
    }
    setBackfillResult(updated === 0 ? 'Nothing to update — every imported order already has a fee.' : `Updated ${updated} order${updated === 1 ? '' : 's'}.`)
    setBackfilling(false)
  }

  const save = async () => {
    // Validate before saving anything, so a typo'd handle can't silently blank
    // the pay button on every quote.
    const venmo = normalizeVenmoUsername(venmoUsername)
    const paypal = normalizePaypalMeName(paypalName)
    const badVenmo = !!venmoUsername.trim() && !venmo
    const badPaypal = !!paypalName.trim() && !paypal
    setVenmoError(badVenmo ? 'That doesn’t look like a Venmo username — letters, numbers, hyphens and underscores only.' : '')
    setPaypalError(badPaypal ? 'That doesn’t look like a PayPal.Me name — paste your paypal.me link or just the name after it.' : '')
    if (badVenmo || badPaypal) return
    setVenmoUsername(venmo || '')
    setPaypalName(paypal || '')

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const num = (v: string) => v === '' || v == null ? null : Number(v)
    const { error } = await supabase
      .from('profiles')
      .update({
        business_name: businessName || null,
        hourly_rate: num(hourlyRate),
        default_markup: num(markup),
        default_fee_pct: num(feePct),
        default_tax_rate: num(taxRate),
        venmo_username: venmo,
        paypal_me_name: paypal,
        fee_pct_etsy: num(String(feeEtsy)),
        fee_pct_ebay: num(String(feeEbay)),
        fee_pct_shopify: num(String(feeShopify)),
      })
      .eq('id', user.id)
    if (error) console.warn('Failed saving settings', error)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500'
  const labelClass = 'text-sm text-gray-400 mb-1 block'

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
            <div>
              <label className={labelClass}>Business name</label>
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} className={inputClass} placeholder="My Shop" />
            </div>

            <div>
              <h2 className="text-white font-semibold mb-1">Pricing defaults</h2>
              <p className="text-gray-500 text-xs mb-4">Used to suggest order prices. You can override any of these per order.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Hourly rate ($/hour)</label>
                  <input value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} type="number" step="0.01" className={inputClass} placeholder="e.g. 20" />
                </div>
                <div>
                  <label className={labelClass}>Default markup (× cost)</label>
                  <input value={markup} onChange={e => setMarkup(e.target.value)} type="number" step="0.05" className={inputClass} placeholder="e.g. 1.5" />
                </div>
                <div>
                  <label className={labelClass}>Marketplace fee (%) <span className="text-gray-600">default</span></label>
                  <input value={feePct} onChange={e => setFeePct(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 8" />
                </div>
                <div>
                  <label className={labelClass}>Sales tax rate (%)</label>
                  <input value={taxRate} onChange={e => setTaxRate(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 7" />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-white font-semibold mb-1">Marketplace fees</h2>
              <p className="text-gray-500 text-xs mb-4">
                Each marketplace takes a different cut, so profit on an imported order is only right once these are set.
                Applied to new imports automatically. Leave blank to use the default above.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Etsy (%)</label>
                  <input value={feeEtsy} onChange={e => setFeeEtsy(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 6.5" />
                </div>
                <div>
                  <label className={labelClass}>eBay (%)</label>
                  <input value={feeEbay} onChange={e => setFeeEbay(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 13.25" />
                </div>
                <div>
                  <label className={labelClass}>Shopify (%)</label>
                  <input value={feeShopify} onChange={e => setFeeShopify(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 2.9" />
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2">
                Check your own statements — fees vary by category, store subscription and country. These are only starting points.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button
                  onClick={backfillFees}
                  disabled={backfilling}
                  className="text-sm bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
                >
                  {backfilling ? 'Applying…' : 'Apply to existing imported orders'}
                </button>
                {backfillResult && <span className="text-gray-400 text-xs">{backfillResult}</span>}
              </div>
              <p className="text-gray-600 text-xs mt-1">
                Only fills in orders that have no fee recorded — it never overwrites one you&apos;ve set.
              </p>
            </div>

            <div>
              <h2 className="text-white font-semibold mb-1">Getting paid</h2>
              <p className="text-gray-500 text-xs mb-4">Adds “Pay with Venmo” and “Pay with PayPal” buttons to quotes once a customer accepts, with the total filled in.</p>
              <label className={labelClass}>Venmo username</label>
              <div className="flex items-center">
                <span className="bg-gray-800 border border-r-0 border-gray-700 rounded-l px-3 py-2 text-gray-500">@</span>
                <input
                  value={venmoUsername}
                  onChange={e => { setVenmoUsername(e.target.value); setVenmoError('') }}
                  className={`${inputClass} rounded-l-none`}
                  placeholder="your-venmo-name"
                />
              </div>
              {venmoError
                ? <p className="text-red-400 text-xs mt-1">{venmoError}</p>
                : <p className="text-gray-600 text-xs mt-1">Shown to customers on quotes. You can paste your Venmo profile link too. Leave blank to hide the button.</p>}

              <label className={`${labelClass} mt-4`}>PayPal.Me name</label>
              <div className="flex items-center">
                <span className="bg-gray-800 border border-r-0 border-gray-700 rounded-l px-3 py-2 text-gray-500">paypal.me/</span>
                <input
                  value={paypalName}
                  onChange={e => { setPaypalName(e.target.value); setPaypalError('') }}
                  className={`${inputClass} rounded-l-none`}
                  placeholder="YourName"
                />
              </div>
              {paypalError
                ? <p className="text-red-400 text-xs mt-1">{paypalError}</p>
                : <p className="text-gray-600 text-xs mt-1">Your PayPal.Me link — find or create it at paypal.me. Leave blank to hide the button.</p>}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        <StripeConnection notice={stripeNotice} />

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mt-6">
          <h2 className="text-white font-semibold mb-1">Marketplace connections</h2>
          <p className="text-gray-500 text-xs mb-4">Connect a shop to pull its sales in as orders automatically.</p>

          {connectNotice && (
            <div className={`text-sm px-4 py-2.5 rounded-lg mb-4 ${connectNotice.status.startsWith('sync') && !connectNotice.status.includes('error') ? 'bg-green-500/10 border border-green-500/20 text-green-400' : connectNotice.status === 'connected' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
              {connectNotice.status === 'connected' && `${PROVIDER_LABELS[connectNotice.provider]} connected.`}
              {connectNotice.status === 'not_configured' && `${PROVIDER_LABELS[connectNotice.provider]} isn't set up yet — missing API credentials.`}
              {connectNotice.status === 'error' && `Couldn't connect ${PROVIDER_LABELS[connectNotice.provider]}. Try again.`}
              {connectNotice.status === 'sync_error' && `Sync failed for ${PROVIDER_LABELS[connectNotice.provider]}.`}
              {connectNotice.status.startsWith('synced:') && (() => {
                const [, imported, updated] = connectNotice.status.split(':')
                const parts = [`${imported} new order(s)`]
                if (Number(updated) > 0) parts.push(`${updated} updated`)
                return `${parts.join(', ')} from ${PROVIDER_LABELS[connectNotice.provider]}.`
              })()}
            </div>
          )}

          {connectionsLoading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : (
            <div className="space-y-3">
              {VISIBLE_PROVIDERS.map(provider => {
                const conn = connections.find(c => c.provider === provider)
                const isShopify = provider === 'shopify'

                // Shopify has no single global authorize URL — it needs a
                // shop domain up front, so its "not connected" row gets an
                // extra input instead of a plain Connect button.
                if (isShopify && !conn) {
                  return (
                    <div key={provider} className="bg-gray-800 rounded-lg px-4 py-3">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <span className="text-white font-medium">{PROVIDER_LABELS[provider]}</span>
                          <p className="text-gray-500 text-xs mt-0.5">Not connected</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            value={shopifyDomain}
                            onChange={e => setShopifyDomain(e.target.value)}
                            placeholder="your-store.myshopify.com"
                            className="text-sm bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-56"
                          />
                          <a
                            href={shopifyDomain.trim() ? `/api/integrations/shopify/connect?shop=${encodeURIComponent(shopifyDomain.trim())}` : undefined}
                            className={`text-sm px-3 py-1.5 rounded ${shopifyDomain.trim() ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed pointer-events-none'}`}
                          >
                            Connect Shopify
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={provider} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                    <div>
                      <span className="text-white font-medium">{PROVIDER_LABELS[provider]}</span>
                      {conn ? (
                        <p className="text-gray-500 text-xs mt-0.5">
                          {conn.external_shop_name ? `${conn.external_shop_name} · ` : ''}
                          {conn.last_synced_at ? `Last synced ${new Date(conn.last_synced_at).toLocaleString()}` : 'Never synced'}
                          {conn.last_sync_error ? <span className="text-red-400"> · last sync failed</span> : null}
                        </p>
                      ) : (
                        <p className="text-gray-500 text-xs mt-0.5">Not connected</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {conn ? (
                        <>
                          <button
                            onClick={() => syncNow(provider)}
                            disabled={syncingProvider === provider}
                            className="text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
                          >
                            {syncingProvider === provider ? 'Syncing…' : 'Sync now'}
                          </button>
                          <button onClick={() => disconnect(provider)} className="text-sm text-red-500 hover:text-red-400 px-2">
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <a href={`/api/integrations/${provider}/connect`} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded">
                          Connect {PROVIDER_LABELS[provider]}
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
