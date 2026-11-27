import { CityHubImpression } from './city-actions'
import { CityBreadcrumb, type CityIdentity } from './city-page'
import { CityHeroBlock } from '@/components/site-blocks/sections/city-hero-block'
import { CityHostBandBlock } from '@/components/site-blocks/sections/city-host-band-block'
import { CityWeekendBlock } from '@/components/site-blocks/sections/city-weekend-block'
import { SitePage } from '@/components/site/site-page'
import type { CityWeekendModel } from '@/lib/city-weekend'

// #4339 — the automatic page of a live Mingla city that has no hand-made guide
// yet (Abuja, Ibadan, Kaduna, Kano, and any city switched on later). It is the
// guide page's own pieces without the registry content: the hero (the city's
// clip, or a brand-colour card), "This weekend" from the live readers (admin
// strips, the week's listings or, in a quiet week, real places), and the Host
// band. No FAQs, sources or catalogue: those need a written guide. The page is
// noindex and is not in the sitemap until the city has a registry record.
// #4636: the hero, weekend and host band are the registry's city blocks.

export function LiveCityPage({ city, weekend }: { readonly city: CityIdentity; readonly weekend: CityWeekendModel }) {
  const params = { city: city.slug }
  return (
    <div className="page-system-root city-hub-root city-page-v2 city-page-v3">
      <CityHubImpression citySlug={city.slug} countryCode={city.countryCode} />
      <SitePage surface="explorer" current="cities">
        <CityHeroBlock content={params} identity={city} blockId="city-hub-title" />
        <CityBreadcrumb record={city} />
        <CityWeekendBlock content={params} identity={city} model={weekend} blockId="city-weekend-title" />
        <CityHostBandBlock content={params} identity={city} blockId="city-host-title" />
      </SitePage>
    </div>
  )
}
