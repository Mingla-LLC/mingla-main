// #4636 block `filterGrid` — Going out's filter row (one row that swipes on a
// phone; each chip filters the guides below), the wide tile and the guide
// tiles. Moved as-is (R1) from app/(core)/going-out/page.tsx. A guide has no
// page of its own yet, so each tile opens its city page, or /cities when it
// spans cities (#4339 §8).
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { LandingMedia } from '@/components/landing/landing-media'
import { FilterGrid, type FilterItem } from '@/components/site/filter-row'
import { cityHubForSlug, cityHubPath } from '@/content/cities/registry'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { Em, type BlockAction, type BlockProps } from './shared'

export interface Guide {
  media: LandingMediaRef
  title: string
  line: string
  tags: readonly string[]
  /** A city hub slug, or null / absent for /cities. */
  city?: string | null
}

export interface FilterGridContent {
  chips: readonly string[]
  wideMedia: LandingMediaRef
  wideTitle: string
  wideLine: string
  wideAction: BlockAction
  empty?: string
  items: readonly Guide[]
}

export function guideHref(city: string | null | undefined): string {
  if (city === null || city === undefined) return '/cities'
  const hub = cityHubForSlug(city)
  if (!hub) throw new Error(`#4339 going-out: city hub "${city}" is not in the registry`)
  return cityHubPath(hub)
}

function GuideTile({ guide }: { guide: Guide }) {
  return (
    <Link className="tile" href={guideHref(guide.city)}>
      <div className="ph scrim">
        {/* #4339 round B: below the LCP tile, the posters wait for the screen. */}
        <LandingMedia media={guide.media} lazyPoster />
      </div>
      <div className="ov">
        <h3>{guide.title}</h3>
        <p>{guide.line}</p>
      </div>
      <span className="go" aria-hidden="true">
        <ArrowUpRight />
      </span>
    </Link>
  )
}

export function FilterGridBlock({ content }: BlockProps<FilterGridContent>) {
  const items: FilterItem[] = content.items.map((guide) => ({ key: guide.title, tags: guide.tags, node: <GuideTile guide={guide} /> }))
  return (
    <section className="pb-100" aria-label="Guides">
      <div className="wrap">
        <FilterGrid
          label="Filter guides"
          options={content.chips}
          items={items}
          gridClassName="grid3 mt-24"
          noun="guide"
          empty={content.empty ?? 'No guides for that yet.'}
          between={
            <Link className="tile wide mt-24" href={content.wideAction.to}>
              <div className="ph scrim">
                {/* #4339 round B: the LCP image on phones. */}
                <LandingMedia media={content.wideMedia} priority />
              </div>
              <div className="ov">
                <h3>
                  <Em text={content.wideTitle} />
                </h3>
                <p>{content.wideLine}</p>
              </div>
              <span className="go" aria-hidden="true">
                <ArrowUpRight />
              </span>
            </Link>
          }
        />
      </div>
    </section>
  )
}
