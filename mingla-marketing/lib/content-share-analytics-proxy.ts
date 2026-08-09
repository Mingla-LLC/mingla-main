const BUSINESS_ORIGIN = process.env.NODE_ENV === 'development' && process.env.SHARED_CARD_BUSINESS_ORIGIN
  ? process.env.SHARED_CARD_BUSINESS_ORIGIN.replace(/\/+$/, '')
  : 'https://business.usemingla.com'

const response = (status: number) => new Response(null, {
  status,
  headers: {
    'cache-control': 'private, no-store, max-age=0',
    'cdn-cache-control': 'no-store',
    'vercel-cdn-cache-control': 'no-store',
  },
})

export async function proxyContentShareAnalytics(request: Request, fetchImpl: typeof fetch = fetch) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType && !contentType.toLowerCase().startsWith('application/json') && !contentType.toLowerCase().startsWith('text/plain')) return response(400)
  const body = await request.text().catch(() => '')
  if (body.length === 0 || body.length > 512) return response(400)
  try {
    const upstream = await fetchImpl(`${BUSINESS_ORIGIN}/api/content-share-analytics`, {
      method: 'POST', cache: 'no-store', redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: 'https://usemingla.com' }, body,
    })
    return response(upstream.status === 204 ? 204 : upstream.status === 400 ? 400 : 502)
  } catch { return response(502) }
}
