import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { readAccountStatus, stripeConfigured, stripeTestMode } from '@/lib/stripe'

// GET /api/stripe/connect/return — where Stripe sends the seller after hosted
// onboarding. Returning here means "they finished the form", NOT "they can take
// money": Stripe may still be verifying identity or bank details, so the real
// state is read back from the account itself rather than assumed.
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const settings = (status: string) => NextResponse.redirect(`${appUrl}/dashboard/settings?stripe=${status}`)

  if (!stripeConfigured()) return settings('not_configured')

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return settings('error')

  const admin = createSupabaseAdminClient()
  const { data: row } = await admin
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) return settings('error')

  try {
    // Returning here means the seller finished the form, NOT that they can take
    // money: Stripe may still be verifying. Read the real state back.
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

    return settings(status.chargesEnabled ? 'connected' : 'pending')
  } catch (e) {
    console.error('[stripe] return failed', e instanceof Error ? e.message : e)
    return settings('error')
  }
}
