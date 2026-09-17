'use client'

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * Attach / view / remove a receipt photo on one expense.
 *
 * Files live in a private bucket under `<user_id>/…`, which is what the storage
 * policies check — so a path the browser proposes can never reach another
 * seller's folder. Viewing mints a short-lived signed URL rather than a public
 * link: a receipt carries a name, an address and sometimes a card's last four,
 * and a public URL would keep working forever for anyone who ever saw it.
 */
export default function ExpenseReceipt({
  expenseId,
  receiptPath,
  onChange,
}: {
  expenseId: string
  receiptPath: string | null
  onChange: (path: string | null) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setError('That file is over 10 MB — try a photo rather than a scan.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')

      // Keep the extension so the browser knows what it's opening later.
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 5)
      const path = `${user.id}/${expenseId}-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })
      if (upErr) throw upErr

      const { error: rowErr } = await supabase.from('expenses').update({ receipt_path: path }).eq('id', expenseId)
      if (rowErr) throw rowErr

      // Replacing: drop the old file rather than leaving it orphaned in the
      // bucket, where nothing would ever reference or clean it up.
      if (receiptPath) await supabase.storage.from('receipts').remove([receiptPath])

      onChange(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const view = async () => {
    if (!receiptPath) return
    setBusy(true)
    setError('')
    const { data, error: signErr } = await supabase.storage.from('receipts').createSignedUrl(receiptPath, 300)
    setBusy(false)
    if (signErr || !data?.signedUrl) { setError('Could not open that receipt.'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const remove = async () => {
    if (!receiptPath || !confirm('Remove this receipt?')) return
    setBusy(true)
    setError('')
    const { error: rowErr } = await supabase.from('expenses').update({ receipt_path: null }).eq('id', expenseId)
    if (rowErr) { setError(rowErr.message); setBusy(false); return }
    await supabase.storage.from('receipts').remove([receiptPath])
    onChange(null)
    setBusy(false)
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <input
        ref={fileInput}
        type="file"
        // `capture` opens the camera straight away on a phone, which is the
        // moment this feature is actually used — standing at a market stall.
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
      />
      {receiptPath ? (
        <>
          <button onClick={view} disabled={busy} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
            {busy ? '…' : '🧾 Receipt'}
          </button>
          <button onClick={() => fileInput.current?.click()} disabled={busy} className="text-gray-600 hover:text-gray-300">Replace</button>
          <button onClick={remove} disabled={busy} className="text-gray-600 hover:text-red-400">Remove</button>
        </>
      ) : (
        <button onClick={() => fileInput.current?.click()} disabled={busy} className="text-gray-600 hover:text-indigo-300 disabled:opacity-50">
          {busy ? 'Uploading…' : '+ Receipt'}
        </button>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </span>
  )
}
