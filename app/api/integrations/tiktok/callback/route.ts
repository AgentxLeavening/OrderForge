import type { NextRequest } from 'next/server'
import { handleCallback } from '@/lib/integrations/routeHelpers'
import { tiktokProvider } from '@/lib/integrations/tiktok'

export async function GET(request: NextRequest) {
  return handleCallback(tiktokProvider, request)
}
