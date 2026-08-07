import { proxySharedCard } from '@/lib/shared-card-proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await context.params
  return proxySharedCard(request, shareId, 'snippet')
}
