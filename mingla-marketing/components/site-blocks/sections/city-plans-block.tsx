// #4636 live block `cityPlans` — the moss "More than one mode." guide band:
// the city's ready-made plans (each with a Save hand-off), or its utility
// sections when it has none. Moved as-is (R1) from components/cities/city-page.tsx
// (CityGuideBand). The plans stay the #4137 catalogue snapshot (R7); the
// editor sets the city and the heading. Needs the city wrapper.
import { Bookmark } from 'lucide-react'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import type { CityHubCatalogue } from '@/components/cities/city-lifecycle'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { getCityCatalogueSnapshot } from '@/lib/page-system/city-catalogue.server'
import { guideCity, type CityParams } from './city-data'
import { Em, secClass, type BlockProps } from './shared'

export interface CityPlansContent extends CityParams {
  heading: string
}

export function CityPlansBlock({
  content,
  colour,
  blockId,
  record,
  catalogue,
}: BlockProps<CityPlansContent> & { record?: CityHubRecord; catalogue?: Pick<CityHubCatalogue, 'plans'> }) {
  const guide = record ?? guideCity(content.city)
  if (!guide) {
    console.error(`[site-blocks] cityPlans: "${content.city}" has no city guide`)
    return null
  }
  const plans = (catalogue ?? getCityCatalogueSnapshot(guide.slug, cityHubPath(guide))).plans
  return (
    <section className={secClass(colour, 'moss')} aria-labelledby={blockId}>
      <div className="wrap">
        <div className="split reveal">
          <h2 className="h2" id={blockId}>
            <Em text={content.heading} />
          </h2>
          <p className="lead">{plans.length ? `Ready-made plans for ${guide.city}, to send to the group.` : guide.utilityHeading}</p>
        </div>
        <ul className="list mt-40">
          {plans.length
            ? plans.map((plan, index) => (
                <li key={plan.generatedCardId} className="list-item" data-city-plan-card="">
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{plan.title}</h3>
                    <p>{`${plan.itineraryLabel} · ${plan.stops.length} stops`}</p>
                  </div>
                  <ExplorerHandoffButton location="city_plan_save" className="btn sm">
                    Save <Bookmark aria-hidden="true" />
                  </ExplorerHandoffButton>
                </li>
              ))
            : guide.utilitySections.map((utility, index) => (
                <li key={utility.title} className="list-item">
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{utility.title}</h3>
                    <p>{utility.answer}</p>
                  </div>
                </li>
              ))}
        </ul>
      </div>
    </section>
  )
}
