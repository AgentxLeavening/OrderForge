'use client'

import { useState } from 'react'

/**
 * Card payment button for an accepted quote. Asks the server for a Stripe
 * checkout URL and sends the customer there — the amount is decided server-side
 * from the quote snapshot, never passed from here.
 */
export default function PayByCard({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pay = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not start the payment.')
      window.location.href = json.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-[#635BFF] hover:bg-[#5348e8] disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl transition"
      >
        {busy ? 'Opening…' : label}
      </button>
      {error && <p className="text-red-400 text-sm mt-2 basis-full" role="alert">{error}</p>}
    </>
  )
}
