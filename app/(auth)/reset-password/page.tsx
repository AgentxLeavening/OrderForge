'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Following the emailed recovery link lands here with a token in the URL;
  // the supabase-js client parses it on load and emits PASSWORD_RECOVERY (or
  // may have already established the session before this effect subscribes,
  // hence also checking getSession() directly).
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) { setReady(true); setChecking(false) }
      else if (mounted) setChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setReady(true)
        setChecking(false)
      }
    })
    return () => { mounted = false; sub.subscription.unsubscribe() }
  }, [])

  const handleSubmit = async () => {
    setError('')
    if (password.length < 6) return setError('Password must be at least 6 characters.')
    if (password !== confirm) return setError('Passwords don\'t match.')

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (error) { setError(error.message); return }
    setDone(true)
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 p-8 rounded-2xl w-full max-w-md border border-gray-800">
        <h1 className="text-2xl font-bold text-white mb-2">Choose a new password</h1>

        {checking ? (
          <p className="text-gray-400">Checking your reset link…</p>
        ) : !ready ? (
          <>
            <p className="text-gray-400 mb-4">This reset link is invalid or has expired.</p>
            <Link href="/forgot-password" className="text-indigo-400 hover:text-indigo-300 text-sm">
              Request a new link
            </Link>
          </>
        ) : done ? (
          <div className="bg-green-500/10 border border-green-500/20 text-green-400 px-4 py-3 rounded-lg text-sm">
            Password updated — taking you to your dashboard…
          </div>
        ) : (
          <>
            <p className="text-gray-400 mb-6">Pick a new password for your account.</p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="••••••••"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Update password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
