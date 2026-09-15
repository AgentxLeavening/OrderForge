'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Accept / decline, for someone who has never seen this app before and has no
// account. Kept deliberately plain: two buttons, an optional note, and plain
// language about what each one means.
export default function QuoteResponse({ token }: { token: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState<'accepted' | 'declined' | null>(null)
  const [error, setError] = useState('')

  const respond = async (decision: 'accepted' | 'declined') => {
    if (decision === 'declined' && !confirm('Decline this quote? You can still contact the seller afterwards.')) return

    setSubmitting(decision)
    setError('')
    try {
      const res = await fetch(`/api/quotes/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.')
      // Re-render the server component so the confirmation banner is the real
      // stored state, not something this component decided locally.
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(null)
    }
  }

  return (
    <div className="mt-6 bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <label htmlFor="quote-note" className="block text-sm text-gray-300 font-medium">
        Anything you want to add? <span className="text-gray-600 font-normal">(optional)</span>
      </label>
      <textarea
        id="quote-note"
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Questions, changes, delivery details…"
        className="mt-2 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500"
      />

      {error && (
        <p className="text-red-400 text-sm mt-3" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button
          type="button"
          onClick={() => respond('accepted')}
          disabled={submitting !== null}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-xl transition"
        >
          {submitting === 'accepted' ? 'Accepting…' : 'Accept quote'}
        </button>
        <button
          type="button"
          onClick={() => respond('declined')}
          disabled={submitting !== null}
          className="text-gray-300 hover:text-white disabled:opacity-50 border border-gray-700 hover:border-gray-500 px-5 py-2.5 rounded-xl transition"
        >
          {submitting === 'declined' ? 'Declining…' : 'Decline'}
        </button>
      </div>

      <p className="text-gray-600 text-xs mt-3">
        Accepting tells the seller to start work. It isn&apos;t a payment.
      </p>
    </div>
  )
}
