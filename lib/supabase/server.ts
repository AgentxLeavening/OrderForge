import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server-side Supabase client for Route Handlers and Server Components —
// reads the user's session from request cookies (set by the browser client
// in lib/supabase.ts) so server code can act *as that user* and respect RLS,
// exactly like the browser client does. Use this to find out who's calling
// an API route; use lib/supabase/admin.ts only for tables the user's own
// session must never read (e.g. marketplace OAuth tokens).
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a context that can't set cookies (e.g. a Server
            // Component render) — fine as long as middleware.ts is also
            // refreshing the session, per the standard @supabase/ssr pattern.
          }
        },
      },
    }
  )
}
