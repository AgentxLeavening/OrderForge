import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

// GET /api/integrations/status — connection status for the signed-in user,
// deliberately excluding tokens (this response reaches the browser).
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('marketplace_connections')
    .select('provider, external_shop_name, last_synced_at, last_sync_error, created_at')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ connections: data || [] })
}
