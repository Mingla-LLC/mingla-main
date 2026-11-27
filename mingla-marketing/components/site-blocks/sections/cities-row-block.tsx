// #4636 live block `citiesRow` — every live Mingla city as a clip tile, A to Z,
// moved as-is (R1) from Home ("Your city, but better.") and /cities. The list
// stays live (lib/live-cities.ts, R7): the editor sets the heading and button.
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { CityMedia } from '@/components/site/city-media'
import type { CityTile } from '@/lib/cities-page'
import { getCityTiles } from '@/lib/live-cities'
import { Em, secClass, type BlockAction, type BlockProps } from './shared'

export interface CitiesRowContent {
  variant: 'home' | 'index'
  heading?: string
  action?: BlockAction
}

export async function CitiesRowBlock({ content, colour, blockId, tiles: given }: BlockProps<CitiesRowContent> & { tiles?: readonly CityTile[] }) {
  const tiles = given ?? (await getCityTiles()).tiles
  if (content.variant === 'index') {
    return (
      <section className="pb-100" aria-label="Mingla cities">
        <div className="wrap">
          <ul className="cityrow city-tiles">
            {tiles.map((city) => (
              <li key={city.slug}>
                <Link href={`/cities/${city.slug}`} className="reveal">
                  <div className="ph scrim">
                    <CityMedia slug={city.slug} />
                  </div>
                  <div className="ov">
                    <h2>{city.name}</h2>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }
  return (
    <section className={secClass(colour)} aria-labelledby={blockId}>
      <div className="wrap">
        <div className="split reveal">
          <h2 className="h2" id={blockId}>
            <Em text={content.heading ?? ''} />
          </h2>
          <div>
            {content.action ? (
              <Link className="btn soft" href={content.action.to}>
                {content.action.label} <ArrowRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
        <div className="cityrow">
          {tiles.map((city) => (
            <Link href={`/cities/${city.slug}`} className="reveal" key={city.slug}>
              <div className="ph scrim">
                <CityMedia slug={city.slug} />
              </div>
              <div className="ov">
                <h3>{city.name}</h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
