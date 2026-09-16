'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  compareToEstimate,
  effectiveHourlyRate,
  formatDuration,
  isRunning,
  totalMinutes,
  type TimeEntry,
} from '@/lib/time'

type Entry = TimeEntry & {
  id: string
  entry_date: string
  note: string | null
}

const todayLocal = () => new Date().toLocaleDateString('en-CA')

/**
 * Time tracking for an order: a timer, manual entries, and the estimate the
 * price was built from. `economics` comes from the order page so the effective
 * hourly rate uses the same numbers as the Pricing card.
 */
export default function OrderTime({
  orderId,
  estimatedHours,
  onEstimateSaved,
  economics,
  hourlyRate,
}: {
  orderId: string
  estimatedHours: number | null
  onEstimateSaved: (hours: number | null) => void
  economics: { revenue: number; material: number; shipping: number; feeAmt: number } | null
  hourlyRate: number | null
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Ticks once a minute so a running timer's total doesn't sit frozen.
  const [now, setNow] = useState(() => Date.now())

  const [estimateInput, setEstimateInput] = useState(estimatedHours == null ? '' : String(estimatedHours))
  const [manualHours, setManualHours] = useState('')
  const [manualDate, setManualDate] = useState(todayLocal())
  const [manualNote, setManualNote] = useState('')

  const load = useCallback(async () => {
    const { data, error: loadErr } = await supabase
      .from('order_time_entries')
      .select('id, minutes, started_at, ended_at, entry_date, note')
      .eq('order_id', orderId)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true })
    if (loadErr) setError(loadErr.message)
    setEntries((data || []) as Entry[])
    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load])

  const running = entries.find(isRunning)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [running])

  const minutes = totalMinutes(entries, now)
  const comparison = compareToEstimate(minutes, estimatedHours)
  const rate = economics ? effectiveHourlyRate({ ...economics, actualHours: comparison.actualHours }) : null

  const withUser = async (fn: (userId: string) => Promise<{ error: { message: string } | null }>) => {
    setBusy(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in.'); setBusy(false); return }
    const { error: opErr } = await fn(user.id)
    if (opErr) setError(opErr.message)
    else await load()
    setBusy(false)
  }

  const startTimer = () => withUser(async userId => {
    const { error } = await supabase.from('order_time_entries')
      .insert({ user_id: userId, order_id: orderId, started_at: new Date().toISOString(), entry_date: todayLocal() })
    return { error }
  })

  const stopTimer = () => withUser(async () => {
    if (!running) return { error: null }
    const startedAt = new Date(running.started_at as string).getTime()
    const elapsed = Math.max(0, Math.round(((Date.now() - startedAt) / 60000) * 100) / 100)
    const { error } = await supabase.from('order_time_entries')
      .update({ ended_at: new Date().toISOString(), minutes: elapsed })
      .eq('id', running.id)
    return { error }
  })

  const addManual = () => {
    const hours = Number(manualHours)
    if (!(hours > 0)) { setError('Enter how many hours to log.'); return }
    return withUser(async userId => {
      const { error } = await supabase.from('order_time_entries').insert({
        user_id: userId,
        order_id: orderId,
        minutes: Math.round(hours * 60 * 100) / 100,
        entry_date: manualDate || todayLocal(),
        note: manualNote.trim() || null,
      })
      if (!error) { setManualHours(''); setManualNote('') }
      return { error }
    })
  }

  const removeEntry = (entry: Entry) => withUser(async () => {
    const { error } = await supabase.from('order_time_entries').delete().eq('id', entry.id)
    return { error }
  })

  const saveEstimate = async () => {
    const raw = estimateInput.trim()
    const hours = raw === '' ? null : Number(raw)
    if (hours != null && (!Number.isFinite(hours) || hours < 0)) { setError('Estimated hours must be a positive number.'); return }
    setBusy(true)
    const { error: updErr } = await supabase.from('orders').update({ estimated_hours: hours }).eq('id', orderId)
    if (updErr) setError(updErr.message)
    else onEstimateSaved(hours)
    setBusy(false)
  }

  const inputClass = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500'

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold">Time</h2>
        {running ? (
          <button onClick={stopTimer} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
            ■ Stop timer
          </button>
        ) : (
          <button onClick={startTimer} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
            ▶ Start timer
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Time spent</p>
          <p className="text-white font-semibold">{formatDuration(minutes)}</p>
          {running && <p className="text-indigo-400 text-[11px] mt-0.5">timer running</p>}
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Estimated</p>
          <p className="text-white font-semibold">{estimatedHours == null ? '—' : `${estimatedHours}h`}</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">vs estimate</p>
          {comparison.overBy == null ? (
            <p className="text-gray-500 font-semibold">—</p>
          ) : (
            <p className={comparison.overBy > 0 ? 'text-amber-300 font-semibold' : 'text-green-400 font-semibold'}>
              {comparison.overBy > 0 ? '+' : ''}{comparison.overBy}h
              <span className="text-gray-500 text-xs font-normal"> ({comparison.percentOfEstimate}%)</span>
            </p>
          )}
        </div>
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-500 text-xs">Earning per hour</p>
          {rate == null ? (
            <p className="text-gray-500 font-semibold">—</p>
          ) : (
            <p className={hourlyRate && rate < hourlyRate ? 'text-amber-300 font-semibold' : 'text-green-400 font-semibold'}>
              ${rate.toFixed(2)}
              {hourlyRate ? <span className="text-gray-500 text-xs font-normal"> vs ${hourlyRate}</span> : null}
            </p>
          )}
        </div>
      </div>

      {rate != null && hourlyRate != null && (
        <p className="text-gray-500 text-xs -mt-3 mb-4">
          What&apos;s left after materials, shipping and fees, divided by the hours actually worked —
          {rate < hourlyRate ? ' below' : ' at or above'} your {`$${hourlyRate}`}/hour rate.
        </p>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : entries.length > 0 && (
        <div className="space-y-2 mb-4">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-2.5 text-sm">
              <span className="text-gray-400 w-24 shrink-0">{new Date(`${e.entry_date}T00:00:00`).toLocaleDateString()}</span>
              <span className="text-gray-500 flex-1 truncate">{e.note}</span>
              <span className={isRunning(e) ? 'text-indigo-400' : 'text-white'}>
                {isRunning(e) ? 'running…' : formatDuration(Number(e.minutes) || 0)}
              </span>
              <button onClick={() => removeEntry(e)} className="text-gray-600 hover:text-red-400 transition text-lg leading-none" aria-label="Remove time entry">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-800 pt-4 grid grid-cols-2 md:grid-cols-12 gap-2">
        <input value={manualHours} onChange={e => setManualHours(e.target.value)} type="number" min="0" step="0.25" placeholder="Hours" className={`${inputClass} md:col-span-2 text-right`} />
        <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className={`${inputClass} md:col-span-3`} />
        <input value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="What you did (optional)" className={`${inputClass} md:col-span-5`} />
        <button onClick={addManual} disabled={busy} className="md:col-span-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2.5 rounded-lg transition text-sm disabled:opacity-50">
          + Log time
        </button>
      </div>

      <div className="border-t border-gray-800 mt-4 pt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-sm text-gray-400 mb-1 block">Estimated hours</label>
          <input value={estimateInput} onChange={e => setEstimateInput(e.target.value)} type="number" min="0" step="0.25" placeholder="e.g. 3" className={`${inputClass} w-32`} />
        </div>
        <button onClick={saveEstimate} disabled={busy} className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2.5 rounded-lg transition disabled:opacity-50">
          Save estimate
        </button>
        <p className="text-gray-600 text-xs flex-1 min-w-[200px]">
          Set from the product template when the order was created. Changing it here doesn&apos;t re-price the order.
        </p>
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
    </div>
  )
}
