import type { NextRequest } from 'next/server'
import { handleConnect } from '@/lib/integrations/routeHelpers'
import { facebookProvider } from '@/lib/integrations/facebook'

export async function GET(request: NextRequest) {
  return handleConnect(facebookProvider, request)
}
