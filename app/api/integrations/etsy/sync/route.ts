import { handleSync } from '@/lib/integrations/routeHelpers'
import { etsyProvider } from '@/lib/integrations/etsy'

export async function POST() {
  return handleSync(etsyProvider)
}
