import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS entirely. Server-only; SUPABASE_SERVICE_ROLE_KEY
// must never be exposed to the browser (no NEXT_PUBLIC_ prefix, never imported from
// a 'use client' file). Reserved for tables the user's own session must never read,
// like marketplace_connections (OAuth tokens) — always filter queries by an explicit,
// already-verified user_id in the calling code; RLS isn't there to catch mistakes here.
export function createSupabaseAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — required for marketplace integrations.')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
