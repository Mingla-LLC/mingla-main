import { proxyContentShareAnalytics } from '@/lib/content-share-analytics-proxy'

export async function POST(request: Request) {
  return proxyContentShareAnalytics(request)
}

export const dynamic = 'force-dynamic'
