// #4636 live block `cityLinks` — one internal link to every live city page,
// anchored on the phrase people search for (#4339 round B SEO audit 2). Moved
// as-is (R1) from Going out. The list stays live (lib/live-cities.ts, R7).
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { CityTile } from '@/lib/cities-page'
import { getCityTiles } from '@/lib/live-cities'
import { Em, type BlockProps } from './shared'

export interface CityLinksContent {
  heading: string
  prefix: string
}

export async function CityLinksBlock({ content, blockId, tiles }: BlockProps<CityLinksContent> & { tiles?: readonly CityTile[] }) {
  const cityTiles = tiles ?? (await getCityTiles()).tiles
  return (
    <section className="sec city-links-sec" aria-labelledby={blockId}>
      <div className="wrap">
        <h2 className="h2" id={blockId}>
          <Em text={content.heading} />
        </h2>
        <ul className="city-links mt-24">
          {cityTiles.map((city) => (
            <li key={city.slug}>
              <Link href={`/cities/${city.slug}`}>
                {content.prefix} {city.name} <ArrowUpRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
