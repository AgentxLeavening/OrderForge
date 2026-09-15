'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { normalizeVenmoUsername } from '@/lib/venmo'
import { normalizePaypalMeName } from '@/lib/paypal'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [venmoUsername, setVenmoUsername] = useState('')
  const [paypalName, setPaypalName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignup = async () => {
    // Check the optional handles before creating the account — a typo here
    // would otherwise cost the seller a silently missing pay button later.
    const venmo = normalizeVenmoUsername(venmoUsername)
    const paypal = normalizePaypalMeName(paypalName)
    if (venmoUsername.trim() && !venmo) {
      setError('That Venmo username doesn’t look right — letters, numbers, hyphens and underscores only. You can also leave it blank and add it later.')
      return
    }
    if (paypalName.trim() && !paypal) {
      setError('That PayPal.Me name doesn’t look right — paste your paypal.me link, or leave it blank and add it later.')
      return
    }

    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    if (data.user) {
      await supabase
        .from('profiles')
        .update({ name, business_name: businessName, venmo_username: venmo, paypal_me_name: paypal })
        .eq('id', data.user.id)
    }

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 p-8 rounded-2xl w-full max-w-md border border-gray-800">
        <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
        <p className="text-gray-400 mb-6">Start managing your orders with OrderForge</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="Tyler"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Business / Shop Name</label>
            <input
              type="text"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="Tyler's Prints"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="••••••••"
            />
          </div>

          {/* Optional, and said so — a seller without these should not feel
              blocked at signup. They power the pay buttons on quotes. */}
          <div className="border-t border-gray-800 pt-4">
            <p className="text-sm text-gray-300 font-medium">Getting paid <span className="text-gray-500 font-normal">(optional)</span></p>
            <p className="text-gray-500 text-xs mt-0.5 mb-3">
              Lets customers pay straight from a quote. You can add or change these later in Settings.
            </p>
            <div className="space-y-3">
              <div className="flex items-center">
                <span className="bg-gray-800 border border-r-0 border-gray-700 rounded-l-lg px-3 py-3 text-gray-500 text-sm">@</span>
                <input
                  type="text"
                  value={venmoUsername}
                  onChange={e => setVenmoUsername(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-r-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="Venmo username"
                />
              </div>
              <div className="flex items-center">
                <span className="bg-gray-800 border border-r-0 border-gray-700 rounded-l-lg px-3 py-3 text-gray-500 text-sm">paypal.me/</span>
                <input
                  type="text"
                  value={paypalName}
                  onChange={e => setPaypalName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-r-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="PayPal.Me name"
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </div>

        <p className="text-gray-500 text-sm mt-6 text-center">
          Already have an account?{' '}
          <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}