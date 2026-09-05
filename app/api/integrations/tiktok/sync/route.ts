import { handleSync } from '@/lib/integrations/routeHelpers'
import { tiktokProvider } from '@/lib/integrations/tiktok'

export async function POST() {
  return handleSync(tiktokProvider)
}
