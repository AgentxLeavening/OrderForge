import type { NextRequest } from 'next/server'
import { handleConnect } from '@/lib/integrations/routeHelpers'
import { tiktokProvider } from '@/lib/integrations/tiktok'

export async function GET(request: NextRequest) {
  return handleConnect(tiktokProvider, request)
}
