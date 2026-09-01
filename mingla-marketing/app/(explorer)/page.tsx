import { headers } from 'next/headers'
import { ExplorerHero } from '@/components/sections/explorer-home/hero'
import { MinglaEntityGraph } from '@/components/marketing/entity-graph'
import { resolveCityKey } from '@/lib/city-decks'
import { searchRouteMetadata } from '@/lib/search/metadata'

export const metadata = searchRouteMetadata('/')

// ORCH-1007 location-aware hero: resolve the marketing city SERVER-SIDE from
// Vercel geo headers (or a ?city= override for local testing on :3008), then
// pass the resolved cityKey down to the client hero. No backend / edge function.
//
// Vercel geo headers (https://vercel.com/docs/edge-network/headers):
//   x-vercel-ip-latitude / x-vercel-ip-longitude → nearest seeded city
//   x-vercel-ip-country  → 'NG' maps to Lagos when precise coords are absent
// In local dev these headers are absent → resolveCityKey falls back to DC,
// unless a ?city=dc|raleigh|lagos override is supplied.
//
// Reads headers()/searchParams → this page renders dynamically per request
// (geo + query vary the output), which is correct for a geo-personalized hero.

interface ExplorerHomePageProps {
  searchParams: Promise<{ city?: string | string[] }>
}

export default async function ExplorerHomePage({
  searchParams,
}: ExplorerHomePageProps) {
  const [headerList, params] = await Promise.all([headers(), searchParams])

  const cityParam = params.city
  const override = Array.isArray(cityParam) ? cityParam[0] : cityParam

  const cityKey = resolveCityKey({
    override,
    latitude: headerList.get('x-vercel-ip-latitude'),
    longitude: headerList.get('x-vercel-ip-longitude'),
    country: headerList.get('x-vercel-ip-country'),
  })

  return (
    <>
      <MinglaEntityGraph />
      <ExplorerHero cityKey={cityKey} />
    </>
  )
}
