// #4636 live block `cityHostBand` — "Run a place in <City>?" with ONE host
// button, See Mingla Host → /host (round 1, point 8: we don't know their ICP
// yet). Moved as-is (R1) from components/cities/city-page.tsx, which
// re-exports CityHostBand. The editor sets only the city (R7).
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CityTrackedLink } from '@/components/cities/city-actions'
import { cityIdentity, type CityIdentity, type CityParams } from './city-data'
import type { BlockProps } from './shared'

export function CityHostBand({ record }: { readonly record: CityIdentity }) {
  return (
    <section className="sec" aria-labelledby="city-host-title">
      <div className="wrap">
        <div className="split split-center reveal">
          <h2 className="h2" id="city-host-title">
            Run a place <em>in {record.city}?</em>
          </h2>
          <div className="row">
            <CityTrackedLink citySlug={record.slug} countryCode={record.countryCode} event="city_hub_host_action" destinationType="host_web">
              <Link className="btn ink" href="/host">
                See Mingla Host <ArrowRight aria-hidden="true" />
              </Link>
            </CityTrackedLink>
          </div>
        </div>
      </div>
    </section>
  )
}

export type CityHostBandContent = CityParams

export async function CityHostBandBlock({ content, identity }: BlockProps<CityHostBandContent> & { identity?: CityIdentity }) {
  const record = identity ?? (await cityIdentity(content.city))
  if (!record) {
    console.error(`[site-blocks] cityHostBand: unknown city "${content.city}"`)
    return null
  }
  return <CityHostBand record={record} />
}
