import { handleConnect } from '@/lib/integrations/routeHelpers'
import { ebayProvider } from '@/lib/integrations/ebay'

export async function GET() {
  return handleConnect(ebayProvider)
}
