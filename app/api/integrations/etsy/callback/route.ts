import type { NextRequest } from 'next/server'
import { handleCallback } from '@/lib/integrations/routeHelpers'
import { etsyProvider } from '@/lib/integrations/etsy'

export async function GET(request: NextRequest) {
  return handleCallback(etsyProvider, request)
}
