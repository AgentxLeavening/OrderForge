import { createBrowserClient } from '@supabase/ssr'

// Browser client. Uses @supabase/ssr so the session lives in cookies (not
// just localStorage) — needed so server-side Route Handlers (e.g. the Etsy/
// eBay OAuth callbacks) can identify the signed-in user via lib/supabase/server.
// Drop-in compatible with the plain @supabase/supabase-js client: same
// .auth.*/.from() API, so no other file needs to change.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
