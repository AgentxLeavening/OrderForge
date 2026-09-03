import type { NextRequest } from 'next/server'
import { handleCallback } from '@/lib/integrations/routeHelpers'
import { facebookProvider } from '@/lib/integrations/facebook'

export async function GET(request: NextRequest) {
  return handleCallback(facebookProvider, request)
}
