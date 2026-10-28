import type { CityHubRecord } from '@/content/cities/registry'
import type { CataloguePlan } from '@/content/page-system/shared'
import { storedThumbFromPhotoUrl } from '@/lib/city-place-photo'
import { CityDeviceAction } from './city-actions'

// #4137 wave 2 — ready-made plans. Rendered only where real curated plans exist
// (Lagos today). One interactive element per card: the "Open in Mingla" CTA,
// whose ::after covers the card so the whole card opens the Explorer app (phone)
// or the QR dialog (computer), both from the wave 1 seam. Tiles use the stored
// place-pool thumbnails (Seth, 27 Oct 2026; hold #1643), never the originals.
export function CityPlans({ record, plans }: { readonly record: CityHubRecord; readonly plans: readonly CataloguePlan[] }) {
  return (
    <section className="city-v2-plans" aria-labelledby="plans">
      <span className="city-v2-pill city-v2-pill-soft">Ready-made plans</span>
      <h2 id="plans">Pick a plan, send it to the group.</h2>
      <ul className="city-v2-plan-grid">
        {plans.map((plan, index) => {
          const tiles = plan.stops
            .map((stop) => ({ id: stop.id, src: storedThumbFromPhotoUrl(stop.photoUrl) }))
            .filter((tile): tile is { id: string; src: string } => Boolean(tile.src))
            .slice(0, index % 2 === 0 ? 3 : 2)
          return (
            <li key={plan.generatedCardId}>
              <article className="city-v2-plan" data-city-plan-card data-tone={index % 2 === 0 ? 'light' : 'dark'}>
                {tiles.length ? (
                  <div className="city-v2-plan-tiles" data-count={tiles.length}>
                    {tiles.map((tile) => <img key={tile.id} src={tile.src} alt="" width="384" height="384" loading="lazy" decoding="async" />)}
                  </div>
                ) : null}
                <div className="city-v2-plan-copy">
                  <div>
                    <h3>{plan.title}</h3>
                    <p>{`${plan.itineraryLabel} · ${plan.stops.length} stops`}</p>
                  </div>
                  <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="explorer" label="Open in Mingla" location="city_hub_plan_open" variant="primary" className="city-v2-plan-open" />
                </div>
              </article>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
