import { proxySharedCard } from './shared-card-proxy'

const INTERNAL_PROXY_HEADER = 'x-mingla-internal-share-route'
const CODE = /^[0-9A-Za-z]{16}$/
const VERSION = /^[1-9][0-9]*$/
const flights = new Map<string, Promise<Response>>()

const json = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store, max-age=0',
    'cdn-cache-control': 'no-store',
    'vercel-cdn-cache-control': 'no-store',
    'access-control-allow-origin': '*',
  },
})

async function constantTimeEqual(provided: string, expected: string) {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(leftHash); const right = new Uint8Array(rightHash)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

async function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('readiness_timeout')), milliseconds)),
  ])
}

async function verify(request: Request, code: string, version: string): Promise<Response> {
  const canonical = new URL(`/s/${code}`, 'https://usemingla.com').toString()
  const image = new URL(`/og/s/${code}/v${version}-r2.jpg`, 'https://usemingla.com').toString()
  const attempt = async () => {
    const [pageResponse, imageResponse] = await timeout(Promise.all([
      proxySharedCard(request, code, 'content-page'),
      proxySharedCard(request, code, 'content-image', fetch, version),
    ]), 4_000)
    if (pageResponse.status === 410 || imageResponse.status === 410) return json({ state: 'terminal' }, 410)
    if (pageResponse.status === 404 || imageResponse.status === 404) return json({ state: 'absent' }, 404)
    if (pageResponse.status !== 200 || imageResponse.status !== 200) return json({ state: 'transient' }, 503)
    const html = await pageResponse.text()
    const exactIdentity = html.includes(`<link rel="canonical" href="${canonical}" />`)
      && html.includes(`<meta property="og:image" content="${image}" />`)
      && html.includes(`<meta property="og:image:secure_url" content="${image}" />`)
    if (!exactIdentity) return json({ state: 'transient' }, 502)
    await imageResponse.arrayBuffer()
    return json({ state: 'ready' }, 200)
  }
  const started = Date.now()
  let result: Response
  try {
    result = await attempt()
    if (result.status === 502 || result.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      result = await attempt()
    }
  } catch {
    result = json({ state: 'transient' }, 503)
  }
  console.info('[content-share-readiness]', { statusClass: result.status === 200 ? 'ready' : result.status === 410 ? 'terminal' : result.status === 404 ? 'absent' : 'transient', durationMs: Date.now() - started })
  return result
}

export async function contentShareReadiness(request: Request, code: string, version: string): Promise<Response> {
  const expected = process.env.SHARED_CARD_PROXY_SECRET || ''
  const provided = request.headers.get(INTERNAL_PROXY_HEADER) || ''
  if (!expected || !provided || !(await constantTimeEqual(provided, expected)) || !CODE.test(code) || !VERSION.test(version)) {
    return json({ state: 'absent' }, 404)
  }
  const key = `${code}:${version}`
  const existing = flights.get(key)
  if (existing) return existing.then((response) => response.clone())
  const flight = verify(request, code, version).finally(() => flights.delete(key))
  flights.set(key, flight)
  return flight
}
