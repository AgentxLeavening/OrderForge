import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, stripeTestMode } from '@/lib/stripe'

// POST /api/stripe/status — ask Stripe for this seller's current account state
// and save it.
//
// The `account.updated` webhook normally keeps this current, but a webhook that
// isn't configured for connected accounts (or was set up after onboarding)
// silently never fires, leaving a seller who Stripe has already cleared stuck
// on "Finishing setup" with no card button and no explanation. This is the
// manual pull for that case — and a one-click way to prove whether the webhook
// or the account is the problem.
export async function POST() {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Stripe is not set up on this deployment yet.' }, { status: 503 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'No Stripe account connected yet.' }, { status: 404 })

  try {
    const account = await stripeClient().accounts.retrieve(row.stripe_account_id)
    const chargesEnabled = account.charges_enabled ?? false

    await admin
      .from('stripe_accounts')
      .update({
        charges_enabled: chargesEnabled,
        details_submitted: account.details_submitted ?? false,
        livemode: !stripeTestMode(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    // Stripe names what it's still waiting for; surfacing it beats "not ready"
    // with no way to find out why.
    const requirements = [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ]

    return NextResponse.json({
      charges_enabled: chargesEnabled,
      details_submitted: account.details_submitted ?? false,
      disabled_reason: account.requirements?.disabled_reason ?? null,
      requirements: [...new Set(requirements)].slice(0, 10),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stripe] status refresh failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
