// #4636 live block `cityHero` — the city page hero (the city clip, "Things to
// do in <City>" as the pill h1, the brand line and the Explorer hand-off),
// moved as-is (R1) from components/cities/city-page.tsx, which re-exports
// CityHero. The editor sets only the city (R7). Needs the city wrapper.
import { MapPin } from 'lucide-react'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { CityMedia } from '@/components/site/city-media'
import { cityIdentity, type CityIdentity, type CityParams } from './city-data'
import type { BlockProps } from './shared'

export function CityHero({ record }: { readonly record: CityIdentity }) {
  // #4339 round B (SEO audit, ship-blocker 1): the H1 is the search phrase
  // "Things to do in <City>", set as the small pill; the brand line keeps the
  // big serif look but is not a heading.
  return (
    <section className="lp-hero city-lp-hero" aria-labelledby="city-hub-title">
      <CityMedia slug={record.slug} hero />
      <div className="shade" aria-hidden="true" />
      <div className="in wrap">
        <div className="row">
          <h1 className="pill glass city-h1" id="city-hub-title">
            <MapPin aria-hidden="true" /> Things to do in {record.city}
          </h1>
        </div>
        <p className="city-brand-line">
          <span>{record.city}, what are we</span>
          <span>
            <em>outside for?</em>
          </span>
        </p>
        <div className="bottom">
          <p>Places, plans and side quests in {record.city}, on Mingla. Save the ones you like and pick a date.</p>
          <div className="glassbar">
            <span className="bring">Plan it in the app.</span>
            <ExplorerHandoffButton location="city_hero" className="btn white" />
          </div>
        </div>
      </div>
    </section>
  )
}

export type CityHeroContent = CityParams

export async function CityHeroBlock({ content, identity }: BlockProps<CityHeroContent> & { identity?: CityIdentity }) {
  const record = identity ?? (await cityIdentity(content.city))
  if (!record) {
    console.error(`[site-blocks] cityHero: unknown city "${content.city}"`)
    return null
  }
  return <CityHero record={record} />
}
