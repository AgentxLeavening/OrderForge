'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [markup, setMarkup] = useState('')
  const [feePct, setFeePct] = useState('')
  const [taxRate, setTaxRate] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('profiles')
        .select('business_name, hourly_rate, default_markup, default_fee_pct, default_tax_rate')
        .eq('id', user.id)
        .single()
      if (data) {
        setBusinessName(data.business_name || '')
        setHourlyRate(data.hourly_rate ?? '')
        setMarkup(data.default_markup ?? '')
        setFeePct(data.default_fee_pct ?? '')
        setTaxRate(data.default_tax_rate ?? '')
      }
      setLoading(false)
    }
    load()
  }, [])

  const save = async () => {
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
                  <label className={labelClass}>Marketplace fee (%)</label>
                  <input value={feePct} onChange={e => setFeePct(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 8" />
                </div>
                <div>
                  <label className={labelClass}>Sales tax rate (%)</label>
                  <input value={taxRate} onChange={e => setTaxRate(e.target.value)} type="number" step="0.1" className={inputClass} placeholder="e.g. 7" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
