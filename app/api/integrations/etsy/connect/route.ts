import { handleConnect } from '@/lib/integrations/routeHelpers'
import { etsyProvider } from '@/lib/integrations/etsy'

export async function GET() {
  return handleConnect(etsyProvider)
}
