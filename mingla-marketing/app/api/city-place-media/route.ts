import { NextRequest, NextResponse } from 'next/server'
import { listedGooglePlaceIds } from '@/lib/page-system/city-catalogue.server'

// #4137 — Google Places policy: "You must not pre-fetch, cache, or store Places
// API content beyond the allowed exceptions." A successful answer is therefore
// cached only privately in the visitor's browser for 15 minutes: no `s-maxage`,
// no `stale-while-revalidate`, no shared CDN copy of Google content.
// Failures are never cached, so a provider hiccup is retried.
//
// {"invariant":"I-4137-CITY-PLACE-MEDIA-LISTED-NO-SHARED-CACHE","enforced_by":["scripts/issue-4137-city-place-media.implementor.happy.test.mjs"]}
const BROWSER_CACHE_SECONDS = 60 * 15
const PROVIDER_TIMEOUT_MS = 5_000
const PLACE_ID = /^[A-Za-z0-9_-]{8,256}$/
const LISTED_PLACE_IDS = listedGooglePlaceIds()

interface GooglePhoto {
  readonly name?: string
  readonly authorAttributions?: readonly Readonly<{
    displayName?: string
    uri?: string
    photoUri?: string
  }>[]
}

interface GooglePlaceMediaResponse {
  readonly photos?: readonly GooglePhoto[]
  readonly googleMapsUri?: string
}

function noPhoto(reason: string) {
  return { status: 'no_photo' as const, checkedAt: new Date().toISOString(), reason }
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

async function resolveCurrentPlaceMedia(placeId: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const detailResponse = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      Accept: 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'photos,googleMapsUri',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!detailResponse.ok) return noPhoto(`place_refresh_${detailResponse.status}`)
  const place = await detailResponse.json() as GooglePlaceMediaResponse
  const photo = place.photos?.find((candidate) => {
    const author = candidate.authorAttributions?.[0]
    return Boolean(candidate.name && author?.displayName && author?.uri)
  })
  const author = photo?.authorAttributions?.[0]
  if (!photo?.name || !author?.displayName || !author.uri?.startsWith('https://') || !place.googleMapsUri?.startsWith('https://')) {
    return noPhoto('current_attribution_unavailable')
  }

  const mediaResponse = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1200&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })
  if (!mediaResponse.ok) return noPhoto(`photo_refresh_${mediaResponse.status}`)
  const media = await mediaResponse.json() as { photoUri?: string }
  if (!media.photoUri?.startsWith('https://')) return noPhoto('current_photo_uri_unavailable')

  return {
    status: 'current' as const,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + BROWSER_CACHE_SECONDS * 1000).toISOString(),
    photoUri: media.photoUri,
    googleMapsUri: place.googleMapsUri,
    author: {
      displayName: author.displayName,
      uri: author.uri,
      photoUri: author.photoUri ?? null,
    },
  }
}

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get('placeId') ?? ''
  if (!PLACE_ID.test(placeId)) return NextResponse.json({ error: 'invalid_place_id' }, { status: 400, headers: NO_STORE })
  // Listed places only, checked before any Google call.
  if (!LISTED_PLACE_IDS.has(placeId)) return NextResponse.json({ error: 'unlisted_place' }, { status: 404, headers: NO_STORE })
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(noPhoto('provider_not_configured'), { headers: NO_STORE })
  }
  let result
  try {
    result = await resolveCurrentPlaceMedia(placeId)
  } catch (error) {
    if (!isTimeout(error)) throw error
    result = noPhoto('provider_timeout')
  }
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': result.status === 'current' ? `private, max-age=${BROWSER_CACHE_SECONDS}` : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
