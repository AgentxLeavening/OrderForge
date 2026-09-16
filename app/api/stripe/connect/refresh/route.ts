import { NextResponse } from 'next/server'

// GET /api/stripe/connect/refresh — Stripe sends the seller here when an
// onboarding link has expired (they're single-use and short-lived). Nothing to
// do but send them back to Settings, where the Connect button mints a fresh one.
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return NextResponse.redirect(`${appUrl}/dashboard/settings?stripe=expired`)
}
