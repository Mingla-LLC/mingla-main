import type { CataloguePlace } from '@/content/page-system/shared'
import { DeviceCta } from '@/components/cutout'
import { LAGOS_EDITORIAL_SECTIONS, LAGOS_QUICK_FACTS } from '@/content/page-system/lagos-editorial'
import { ExplorerCatalogueCard } from './explorer-catalogue-card'

const CITY_PATH = '/internal/page-system/city-lagos'

function sectionPicks(places: readonly CataloguePlace[]): readonly { section: (typeof LAGOS_EDITORIAL_SECTIONS)[number]; places: readonly CataloguePlace[] }[] {
  const used = new Set<string>()
  return LAGOS_EDITORIAL_SECTIONS.map((section) => {
    const picks: CataloguePlace[] = []
    for (const category of section.categorySlugs) {
      if (picks.length === 3) break
      const match = places.find((place) => place.categorySlug === category && !used.has(place.placePoolId))
      if (!match) continue
      used.add(match.placePoolId)
      picks.push(match)
    }
    return { section, places: picks }
  })
}

export function CityEditorialGuide({ places }: { readonly places: readonly CataloguePlace[] }) {
  const sections = sectionPicks(places)
  const hero = places[0]

  return (
    <>
      <header className="ps-guide-hero">
        <div className="ps-guide-hero-copy">
          <p className="ps-eyebrow">Mingla Explorer · Lagos guide</p>
          <h1>Things to do in Lagos for parties, dates, hangouts and culture</h1>
          <p>Four moods, real Lagos picks, and a few useful local facts. Open a place or plan when one feels like your kind of day.</p>
          <a href="#party" className="ps-primary-action">Start with a mood</a>
        </div>
        {hero ? (
          <figure className="ps-guide-hero-photo">
            <img src={hero.photoUrls[0]} alt={`${hero.name} in Lagos`} width="960" height="720" fetchPriority="high" />
            <figcaption><span>{hero.categoryLabel}</span><strong>{hero.name}</strong></figcaption>
          </figure>
        ) : null}
      </header>

      <div className="ps-guide-body">
        {sections.map(({ section, places: picks }) => (
          <section key={section.id} id={section.id} className="ps-editorial-section" aria-labelledby={`${section.id}-heading`}>
            <header>
              <p className="ps-eyebrow">{section.eyebrow}</p>
              <h2 id={`${section.id}-heading`}>{section.title}</h2>
              <p>{section.intro}</p>
            </header>
            <div className="ps-editorial-picks">
              {picks.map((place, index) => (
                <ExplorerCatalogueCard
                  key={place.placePoolId}
                  item={place}
                  featured={index === 0}
                  href={`${CITY_PATH}?type=places&detail=place:${place.placePoolId}`}
                  appCtaLocation="page_system_explorer_guide_place_card"
                />
              ))}
            </div>
          </section>
        ))}

        <section className="ps-quick-facts" aria-labelledby="quick-facts-heading">
          <header><p className="ps-eyebrow">A little city context</p><h2 id="quick-facts-heading">Lagos in three quick facts</h2></header>
          <div>
            {LAGOS_QUICK_FACTS.map((fact) => (
              <article key={fact.href}>
                <p>{fact.fact}</p>
                <a href={fact.href} target="_blank" rel="noreferrer">{fact.source}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="ps-guide-conversion" aria-labelledby="guide-conversion-heading">
          <p className="ps-eyebrow">Keep exploring</p>
          <h2 id="guide-conversion-heading">Explore more of Lagos</h2>
          <p>Find more places, build a plan and bring the group together in Mingla.</p>
          <DeviceCta
            surface="explorer"
            location="page_system_explorer_guide_conversion"
            label="Download the Explorer app"
            variant="quiet"
            className="ps-guide-conversion-cta"
          />
        </section>
      </div>
    </>
  )
}
