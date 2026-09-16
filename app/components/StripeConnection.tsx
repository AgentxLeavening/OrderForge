'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Account = {
  stripe_account_id: string
  charges_enabled: boolean
  details_submitted: boolean
  livemode: boolean
}

/**
 * Stripe Connect status + connect button for Settings.
 *
 * Deliberately honest about the three states Stripe actually has: not
 * connected, connected but not yet able to charge (identity/bank checks still
 * running), and ready. Treating "account exists" as "can take money" is the
 * classic Connect bug — the customer gets a broken checkout.
 */
export default function StripeConnection({ notice }: { notice: string | null }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data } = await supabase
      .from('stripe_accounts')
      .select('stripe_account_id, charges_enabled, details_submitted, livemode')
      .eq('user_id', user.id)
      .maybeSingle()
    setAccount((data as Account) || null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, notice])

  const connect = async () => {
    setStarting(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/connect', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not start Stripe onboarding.')
      window.location.href = json.url
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStarting(false)
    }
  }

  const ready = account?.charges_enabled
  const pending = account && !account.charges_enabled

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-semibold mb-1">Card payments (Stripe)</h2>
          <p className="text-gray-500 text-xs">
            Lets customers pay by card from a quote, and records the payment on the order automatically — the only method that confirms itself.
          </p>
        </div>
        {ready ? (
          <span className="text-xs bg-green-500/15 text-green-400 px-3 py-1 rounded-full">Connected</span>
        ) : pending ? (
          <span className="text-xs bg-amber-500/15 text-amber-400 px-3 py-1 rounded-full">Finishing setup</span>
        ) : null}
      </div>

      {notice === 'connected' && (
        <p className="text-green-400 text-sm mt-3">Stripe connected — card payments are live on your quotes.</p>
      )}
      {notice === 'pending' && (
        <p className="text-amber-300 text-sm mt-3">Stripe has your details and is still checking them. The card button appears once they clear.</p>
      )}
      {notice === 'expired' && (
        <p className="text-amber-300 text-sm mt-3">That setup link expired. Start again below — nothing was lost.</p>
      )}
      {notice === 'not_configured' && (
        <p className="text-red-400 text-sm mt-3">Card payments aren&apos;t set up on this deployment yet.</p>
      )}
      {notice === 'error' && (
        <p className="text-red-400 text-sm mt-3">Something went wrong talking to Stripe. Try again.</p>
      )}

      {!loading && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={connect}
            disabled={starting}
            className="bg-[#635BFF] hover:bg-[#5348e8] text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            {starting ? 'Opening Stripe…' : account ? 'Continue Stripe setup' : 'Connect Stripe'}
          </button>
          {ready && (
            <a
              href={account.livemode ? 'https://dashboard.stripe.com/payments' : 'https://dashboard.stripe.com/test/payments'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              Open Stripe dashboard →
            </a>
          )}
          {account && !account.livemode && (
            <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-1 rounded-full">
              Test mode — only Stripe test cards work, no real money moves
            </span>
          )}
        </div>
      )}

      {ready && (
        <p className="text-gray-600 text-xs mt-3">
          Stripe charges its usual per-payment fee and pays out to your bank. OrderForge takes nothing and never holds your money.
        </p>
      )}
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </div>
  )
}
