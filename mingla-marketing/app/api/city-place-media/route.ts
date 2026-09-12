import { NextRequest, NextResponse } from 'next/server'

const CACHE_SECONDS = 60 * 60 * 24 * 7
const PLACE_ID = /^[A-Za-z0-9_-]{8,256}$/

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

async function resolveCurrentPlaceMedia(placeId: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const detailResponse = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      Accept: 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'photos,googleMapsUri',
    },
    cache: 'no-store',
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
  })
  if (!mediaResponse.ok) return noPhoto(`photo_refresh_${mediaResponse.status}`)
  const media = await mediaResponse.json() as { photoUri?: string }
  if (!media.photoUri?.startsWith('https://')) return noPhoto('current_photo_uri_unavailable')

  return {
    status: 'current' as const,
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CACHE_SECONDS * 1000).toISOString(),
    photoUri: media.photoUri,
    googleMapsUri: place.googleMapsUri,
    author: {
      displayName: author.displayName,
      uri: author.uri,
      photoUri: author.photoUri ?? null,
    },
  }
}

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get('placeId') ?? ''
  if (!PLACE_ID.test(placeId)) return NextResponse.json({ error: 'invalid_place_id' }, { status: 400 })
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(noPhoto('provider_not_configured'), {
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  }
  const result = await resolveCurrentPlaceMedia(placeId)
  return NextResponse.json(result, {
    headers: {
      // Successful provider receipts may be reused for seven days. Provider,
      // attribution, and transport failures must be retried instead of being
      // frozen into a multi-day "no photo" result.
      'Cache-Control': result.status === 'current'
        ? `public, max-age=3600, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
        : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
