import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readAccountStatus, stripeConfigured, stripeTestMode } from '@/lib/stripe'

// POST /api/stripe/status — ask Stripe for this seller's current account state
// and save it.
//
// Stripe's own events keep our copy current only when the webhook is actually
// configured for connected accounts. When it isn't, a seller Stripe has already
// cleared sits on "Finishing setup" with no card button and no way to find out
// why — which is exactly what happened during test-mode setup. This is both the
// manual pull for that case and a one-click way to tell whether the account or
// the webhook is the problem.
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
    const status = await readAccountStatus(row.stripe_account_id)

    await admin
      .from('stripe_accounts')
      .update({
        charges_enabled: status.chargesEnabled,
        details_submitted: status.detailsSubmitted,
        livemode: !stripeTestMode(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    return NextResponse.json({
      charges_enabled: status.chargesEnabled,
      details_submitted: status.detailsSubmitted,
      disabled_reason: status.disabledReason,
      requirements: status.requirements,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stripe] status refresh failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
