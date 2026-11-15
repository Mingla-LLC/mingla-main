import { CityHubImpression } from './city-actions'
import { CityBreadcrumb, CityHero, CityHostBand, type CityIdentity } from './city-page'
import { CityThisWeekend } from './city-this-weekend'
import { SitePage } from '@/components/site/site-page'
import type { CityWeekendModel } from '@/lib/city-weekend'

// #4339 — the automatic page of a live Mingla city that has no hand-made guide
// yet (Abuja, Ibadan, Kaduna, Kano, and any city switched on later). It is the
// guide page's own pieces without the registry content: the hero (the city's
// clip, or a brand-colour card), "This weekend" from the live readers (admin
// strips, the week's listings or, in a quiet week, real places), and the Host
// band. No FAQs, sources or catalogue: those need a written guide. The page is
// noindex and is not in the sitemap until the city has a registry record.

export function LiveCityPage({ city, weekend }: { readonly city: CityIdentity; readonly weekend: CityWeekendModel }) {
  return (
    <div className="page-system-root city-hub-root city-page-v2 city-page-v3">
      <CityHubImpression citySlug={city.slug} countryCode={city.countryCode} />
      <SitePage surface="explorer" current="cities">
        <CityHero record={city} />
        <CityBreadcrumb record={city} />
        <CityThisWeekend cityName={city.city} citySlug={city.slug} countryCode={city.countryCode} model={weekend} />
        <CityHostBand record={city} />
      </SitePage>
    </div>
  )
}
