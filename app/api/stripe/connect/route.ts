import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, stripeTestMode, v2CardPaymentsActive, v2RequestOptions } from '@/lib/stripe'

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
      // Accounts v2: the seller is a `merchant` configuration asking for the
      // card_payments capability. `dashboard: 'full'` is the v1 "Standard"
      // equivalent — they keep their own Stripe dashboard, handle their own
      // disputes and payouts, and OrderForge takes no application fee.
      const account = await stripe.v2.core.accounts.create(
        {
          contact_email: user.email ?? undefined,
          configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
          dashboard: 'full',
          include: ['configuration.merchant'],
          metadata: { orderforge_user_id: user.id },
        } as never,
        v2RequestOptions
      )
      accountId = (account as { id: string }).id
      const { error: insErr } = await admin.from('stripe_accounts').insert({
        user_id: user.id,
        stripe_account_id: accountId,
        charges_enabled: v2CardPaymentsActive(account),
        details_submitted: false,
        // Derived from the configured key rather than the account object:
        // a test key can only ever create test accounts.
        livemode: !stripeTestMode(),
      })
      if (insErr) throw new Error(insErr.message)
    }

    // Account links are single-use and short-lived; `refresh_url` is where
    // Stripe sends the seller if the link goes stale, which just starts again.
    // `configurations: ['merchant']` must match what the account was created
    // with, or Stripe refuses the link.
    const link = await stripe.v2.core.accountLinks.create(
      {
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['merchant'],
            refresh_url: `${appUrl}/api/stripe/connect/refresh`,
            return_url: `${appUrl}/api/stripe/connect/return`,
          },
        },
      } as never,
      v2RequestOptions
    )

    return NextResponse.json({ url: (link as { url: string }).url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stripe] connect failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
