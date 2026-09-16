import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { stripeClient, stripeConfigured, stripeTestMode } from '@/lib/stripe'

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
    const account = await stripeClient().accounts.retrieve(row.stripe_account_id)
    await admin
      .from('stripe_accounts')
      .update({
        charges_enabled: account.charges_enabled ?? false,
        details_submitted: account.details_submitted ?? false,
        livemode: !stripeTestMode(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    return settings(account.charges_enabled ? 'connected' : 'pending')
  } catch (e) {
    console.error('[stripe] return failed', e instanceof Error ? e.message : e)
    return settings('error')
  }
}
