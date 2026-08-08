const INTERNAL_PROXY_HEADER = 'x-mingla-internal-share-route'
const DOWNSTREAM_PROXY_HEADER = 'x-mingla-shared-card-proxy'
const BUSINESS_ORIGIN = process.env.NODE_ENV === 'development' && process.env.SHARED_CARD_BUSINESS_ORIGIN
  ? process.env.SHARED_CARD_BUSINESS_ORIGIN.replace(/\/+$/, '')
  : 'https://business.usemingla.com'
const SHARE_ID = /^[a-f0-9]{36}$/
const SHARE_CODE = /^[0-9A-Za-z]{16}$/
const SHARE_VERSION = /^[1-9][0-9]*$/
const MAX_CONTENT_SHARE_JPEG_BYTES = 200_000
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
const ALLOWED_STATUSES = new Set([200, 304, 404, 410, 429, 500, 502, 503])

async function constantTimeEqual(provided: string, expected: string) {
  const encoder = new TextEncoder()
  const [leftBuffer, rightBuffer] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(leftBuffer)
  const right = new Uint8Array(rightBuffer)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export type SharedCardProxySurface = 'page' | 'snippet' | 'og' | 'data' | 'content-page' | 'content-data' | 'content-image'

const expectedContentType = (surface: SharedCardProxySurface) =>
  surface === 'page' || surface === 'content-page'
    ? 'text/html; charset=utf-8'
    : surface === 'data' || surface === 'content-data'
      ? 'application/json; charset=utf-8'
      : surface === 'content-image' ? 'image/jpeg' : 'image/png'

const upstreamPath = (surface: SharedCardProxySurface, shareId: string, version?: string) => {
  const encoded = encodeURIComponent(shareId)
  if (surface === 'content-page') return `/api/content-share?code=${encoded}`
  if (surface === 'content-data') return `/api/content-share-data?code=${encoded}`
  if (surface === 'content-image') return `/api/content-share-image?code=${encoded}&version=${encodeURIComponent(version || '')}`
  if (surface === 'page') return `/api/shared-card?shareId=${encoded}`
  if (surface === 'data') return `/api/shared-card-data?shareId=${encoded}`
  return `/api/shared-card-image?shareId=${encoded}&surface=${surface === 'snippet' ? 's4' : 's5'}`
}

const privateResponse = (body: BodyInit | null, status: number, contentType: string, etag = '', revalidate = false) => new Response(body, {
  status,
  headers: {
    ...(status === 304 ? {} : { 'content-type': contentType }),
    'cache-control': revalidate ? 'private, max-age=0, must-revalidate' : 'private, no-store, max-age=0',
    'cdn-cache-control': 'no-store',
    'vercel-cdn-cache-control': 'no-store',
    ...(etag ? { etag } : {}),
  },
})

const immutableJpegResponse = (body: BodyInit | null, status: 200 | 304, etag: string) => new Response(body, {
  status,
  headers: {
    'content-type': 'image/jpeg',
    etag,
    'cache-control': IMMUTABLE_CACHE,
    'cdn-cache-control': IMMUTABLE_CACHE,
    'vercel-cdn-cache-control': IMMUTABLE_CACHE,
  },
})

const isBoundedJpeg = (bytes: Uint8Array) => bytes.length > 3
  && bytes.length <= MAX_CONTENT_SHARE_JPEG_BYTES
  && bytes[0] === 0xff && bytes[1] === 0xd8
  && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9

export async function proxySharedCard(
  request: Request,
  shareId: string,
  surface: SharedCardProxySurface,
  fetchImpl: typeof fetch = fetch,
  version?: string,
) {
  const contentType = expectedContentType(surface)
  const secret = process.env.SHARED_CARD_PROXY_SECRET
  if (typeof secret !== 'string' || secret.length === 0) {
    return privateResponse(null, 503, contentType)
  }
  const internalMarker = request.headers.get(INTERNAL_PROXY_HEADER) || ''
  const isContent = surface.startsWith('content-')
  const validIdentifier = isContent ? SHARE_CODE.test(shareId) : SHARE_ID.test(shareId)
  const validVersion = surface !== 'content-image' || (typeof version === 'string' && SHARE_VERSION.test(version))
  if (!internalMarker || !(await constantTimeEqual(internalMarker, secret)) || !validIdentifier || !validVersion) {
    return privateResponse(null, 404, contentType)
  }

  let upstream: Response
  const expectedEtag = surface === 'content-image' ? `"content-share-${shareId}-v${version}-r2-jpeg"` : ''
  const requestEtag = request.headers.get('if-none-match') === expectedEtag ? expectedEtag : ''
  try {
    const fetchOptions: RequestInit = {
      method: 'GET',
      redirect: 'manual',
      headers: { [DOWNSTREAM_PROXY_HEADER]: secret, ...(requestEtag ? { 'if-none-match': requestEtag } : {}) },
    }
    if (surface !== 'content-image') fetchOptions.cache = 'no-store'
    upstream = await fetchImpl(`${BUSINESS_ORIGIN}${upstreamPath(surface, shareId, version)}`, fetchOptions)
  } catch {
    return privateResponse(null, 502, contentType)
  }
  const status = ALLOWED_STATUSES.has(upstream.status) ? upstream.status : 502
  const upstreamEtag = upstream.headers.get('etag') === expectedEtag ? expectedEtag : ''
  if (status === 304) return surface === 'content-image' && upstreamEtag ? immutableJpegResponse(null, 304, upstreamEtag) : privateResponse(null,502,contentType)
  if (status !== 200) return privateResponse(null, status, contentType)

  const receivedType = upstream.headers.get('content-type')?.toLowerCase() || ''
  const requiredType = contentType.split(';')[0]
  if (surface === 'content-image' ? receivedType !== requiredType : !receivedType.startsWith(requiredType)) return privateResponse(null, 502, contentType)
  try {
    if (surface === 'content-image') {
      if (!upstreamEtag) return privateResponse(null,502,contentType)
      const declaredSize = Number(upstream.headers.get('content-length') || '0')
      if (declaredSize > MAX_CONTENT_SHARE_JPEG_BYTES) return privateResponse(null,502,contentType)
      const bytes = new Uint8Array(await upstream.arrayBuffer())
      return isBoundedJpeg(bytes) ? immutableJpegResponse(bytes, 200, upstreamEtag) : privateResponse(null,502,contentType)
    }
    return privateResponse(await upstream.arrayBuffer(), 200, contentType)
  } catch {
    return privateResponse(null, 502, contentType)
  }
}

export { INTERNAL_PROXY_HEADER }
