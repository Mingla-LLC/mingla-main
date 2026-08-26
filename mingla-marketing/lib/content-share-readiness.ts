import { proxySharedCard } from './shared-card-proxy'
import { readinessVerdict } from './content-share-readiness-verdict'

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

/**
 * #2589 — readiness is MONOTONIC, not an identity check.
 *
 * WHAT IT USED TO DO, and why it could never converge. It asserted that the
 * served page advertised EXACTLY the version the client was holding. But the
 * page fetch two lines above re-derives the offering and can mint version N+1
 * on its way past. So "is v1 ready?" fetched the page, the fetch minted v2, the
 * comparison of v1 against v2 failed, it slept 200 ms, ran the byte-identical
 * comparison, failed identically, and returned a transient error that greys out
 * the Share button. Deterministic, never converging, never timing out.
 * Reproduced live in a single call on 2026-08-25 with a before/after row
 * snapshot: `current_version` moved 1 -> 2 half a second before that same call
 * declared v1 unready.
 *
 * WHAT IT DOES NOW. A share is ready when the page advertises version M and
 * M >= N. Moving forward is the normal, healthy state of a live offering; it is
 * not a failure. The response carries M so the caller can adopt it. Only
 * M < N — a page BEHIND the version the client holds, which is genuinely
 * mid-write — remains transient.
 *
 * AND IT NO LONGER RETRIES ITSELF INTO A WALL. A 502 here is a settled verdict
 * about a comparison that cannot change between two attempts 200 ms apart, and
 * the retry's own page fetch could push the version further away. Retry is now
 * reserved for 503 and for a thrown/timed-out attempt, which are the only
 * results a second attempt can actually improve.
 */
async function verify(request: Request, code: string, version: string): Promise<Response> {
  const requested = Number(version)
  const attempt = async () => {
    const [pageResponse, imageResponse] = await timeout(Promise.all([
      proxySharedCard(request, code, 'content-page'),
      proxySharedCard(request, code, 'content-image', fetch, version),
    ]), 4_000)
    const html = pageResponse.status === 200 ? await pageResponse.text() : ''
    const verdict = readinessVerdict({
      code, requested, pageStatus: pageResponse.status, imageStatus: imageResponse.status, html,
    })
    if (verdict.state === 'ready') await imageResponse.arrayBuffer()
    return {
      verdict,
      response: json(
        verdict.version === null ? { state: verdict.state } : { state: verdict.state, version: verdict.version },
        verdict.status,
      ),
    }
  }
  const started = Date.now()
  let result: Response
  try {
    let attempted = await attempt()
    // #2589 — retry ONLY what a second attempt can change. The old code retried
    // its own settled comparison, which doubled the wall clock of a verdict
    // already decided and whose retry could push the version further away.
    if (attempted.verdict.retryable) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      attempted = await attempt()
    }
    result = attempted.response
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
