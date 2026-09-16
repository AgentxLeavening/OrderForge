import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, stripeTestMode } from '@/lib/stripe'

// POST /api/stripe/connect — start or resume Stripe onboarding for the signed-in
// seller, returning the hosted onboarding URL to send them to.
//
// Creating the account and minting the link both happen server-side: an account
// id the browser could supply is an account id the browser could point at
// someone else's Stripe account.
export async function POST() {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not set up on this deployment yet.' }, { status: 503 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const stripe = stripeClient()
  const admin = createSupabaseAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    const { data: existing } = await admin
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let accountId = existing?.stripe_account_id

    if (!accountId) {
      // Standard: the seller keeps their own Stripe dashboard, handles their
      // own disputes and payouts, and OrderForge takes no application fee.
      const account = await stripe.accounts.create({
        type: 'standard',
        email: user.email ?? undefined,
        metadata: { orderforge_user_id: user.id },
      })
      accountId = account.id
      const { error: insErr } = await admin.from('stripe_accounts').insert({
        user_id: user.id,
        stripe_account_id: account.id,
        charges_enabled: account.charges_enabled ?? false,
        details_submitted: account.details_submitted ?? false,
        // Derived from the configured key rather than the Account object:
        // a test key can only ever create test accounts, and Stripe's types
        // don't surface livemode here.
        livemode: !stripeTestMode(),
      })
      if (insErr) throw new Error(insErr.message)
    }

    // Account links are single-use and short-lived; `refresh_url` is where
    // Stripe sends the seller if the link goes stale, which just starts again.
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/api/stripe/connect/refresh`,
      return_url: `${appUrl}/api/stripe/connect/return`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ url: link.url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stripe] connect failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
