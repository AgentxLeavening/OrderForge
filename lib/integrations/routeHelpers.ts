import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generatePkcePair, generateState } from './pkce'
import { syncProviderOrders } from './sync'
import type { MarketplaceProvider } from './types'

// Shared implementation behind every app/api/integrations/<provider>/* route
// — only the provider module (etsy.ts / ebay.ts) differs per platform.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const stateCookie = (id: string) => `${id}_oauth_state`
const verifierCookie = (id: string) => `${id}_oauth_verifier`
const shopCookie = (id: string) => `${id}_oauth_shop`

async function requireUser() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET /api/integrations/<provider>/connect — redirects to the provider's
// authorize page. Etsy uses the PKCE pair; other providers' modules just
// ignore codeChallenge/codeVerifier, so generating them unconditionally
// here keeps this one code path shared. Shopify additionally needs a shop
// domain up front (?shop=<store>.myshopify.com on this route, from a text
// input on the Settings page) — every other provider ignores it.
export async function handleConnect(provider: MarketplaceProvider, request: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.redirect(new URL('/login', appUrl()))

  const shopDomain = new URL(request.url).searchParams.get('shop') || undefined

  const state = generateState()
  const { codeVerifier, codeChallenge } = generatePkcePair()

  let authorizeUrl: string
  try {
    authorizeUrl = provider.buildAuthorizeUrl({ state, codeChallenge, shopDomain })
  } catch (e) {
    console.warn(`${provider.id} connect failed`, e)
    return NextResponse.redirect(new URL(`/dashboard/settings?${provider.id}=not_configured`, appUrl()))
  }

  const res = NextResponse.redirect(authorizeUrl)
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' }
  res.cookies.set(stateCookie(provider.id), state, cookieOpts)
  res.cookies.set(verifierCookie(provider.id), codeVerifier, cookieOpts)
  if (shopDomain) res.cookies.set(shopCookie(provider.id), shopDomain, cookieOpts)
  return res
}

// GET /api/integrations/<provider>/callback — the provider redirects here
// after the user approves access.
export async function handleCallback(provider: MarketplaceProvider, request: NextRequest) {
  const settingsUrl = (status: string) => new URL(`/dashboard/settings?${provider.id}=${status}`, appUrl())

  const user = await requireUser()
  if (!user) return NextResponse.redirect(new URL('/login', appUrl()))

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expectedState = request.cookies.get(stateCookie(provider.id))?.value
  const codeVerifier = request.cookies.get(verifierCookie(provider.id))?.value
  const shopDomain = request.cookies.get(shopCookie(provider.id))?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(settingsUrl('error'))
  }

  try {
    const tokens = await provider.exchangeCodeForToken({ code, codeVerifier, shopDomain })
    const admin = createSupabaseAdminClient()
    const { error } = await admin.from('marketplace_connections').upsert(
      {
        user_id: user.id,
        provider: provider.id,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt,
        scope: tokens.scope ?? null,
        // Providers that already know their shop identity at token-exchange
        // time (Shopify) populate these directly, skipping sync.ts's lazy
        // fetchShopInfo resolution on first sync.
        ...(tokens.shopId ? { external_shop_id: tokens.shopId, external_shop_name: tokens.shopName ?? null } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )
    if (error) throw error

    const res = NextResponse.redirect(settingsUrl('connected'))
    res.cookies.delete(stateCookie(provider.id))
    res.cookies.delete(verifierCookie(provider.id))
    res.cookies.delete(shopCookie(provider.id))
    return res
  } catch (e) {
    console.warn(`${provider.id} OAuth callback failed`, e)
    return NextResponse.redirect(settingsUrl('error'))
  }
}

// POST /api/integrations/<provider>/sync — pull new orders now.
export async function handleSync(provider: MarketplaceProvider) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  try {
    const result = await syncProviderOrders(provider, user.id)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/integrations/<provider>/disconnect
export async function handleDisconnect(provider: MarketplaceProvider) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('marketplace_connections')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', provider.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
