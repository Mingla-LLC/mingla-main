import Image from 'next/image'
import Link from 'next/link'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { CutoutFooter, CutoutShell } from '@/components/cutout'
import { PageSystemNav } from '@/components/page-system/page-system-nav'
import { CITY_HERO_IMAGE } from '@/lib/city-hero-images'
import { CityDeviceAction, CityHubImpression } from './city-actions'
import { CityFaq, CityLifecycleNotice, type CityHubCatalogue } from './city-hub'
import { CityPlans } from './city-plans'
import { CityTopPlaces } from './city-top-places'

// #4137 wave 2 — the release layout of /cities/[city]: dark photo hero, the top
// 50 places with category chips, ready-made plans where real ones exist (Lagos
// today), a host band and the questions the page's FAQPage markup promises.
// The historical #2983 layout stays in city-hub.tsx for its pinned build lane.

function CityPageHero({ record, placeCount, hasPlans }: { readonly record: CityHubRecord; readonly placeCount: number; readonly hasPlans: boolean }) {
  const hero = CITY_HERO_IMAGE[record.slug]
  return (
    <section className="city-v2-hero" aria-labelledby="city-hub-title">
      <Image src={hero.src} alt="" fill priority sizes="100vw" className="city-v2-hero-photo" />
      <div className="city-v2-hero-veil" aria-hidden="true" />
      <div className="city-v2-hero-inner">
        <nav aria-label="Breadcrumb" className="city-breadcrumbs">
          <ol><li><Link href="/">Home</Link></li><li aria-hidden="true">/</li><li aria-current="page">{record.city}</li></ol>
        </nav>
        <h1 id="city-hub-title">Things to do in {record.city}.</h1>
        <p className="city-v2-hero-lede">
          {`The top ${placeCount} places in ${record.city}, ranked by Mingla, not by who paid.`}
          {hasPlans ? ' Plus ready-made plans to send to the group.' : null}
        </p>
        <div className="city-v2-hero-actions">
          <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="explorer" label={`Explore ${record.city}`} location="city_hub_hero_explorer" variant="primary" />
          <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_hero_host" variant="quiet" className="city-v2-hero-host" />
        </div>
      </div>
    </section>
  )
}

function CityHostBand({ record }: { readonly record: CityHubRecord }) {
  return (
    <section className="city-v2-host" aria-labelledby="city-host-title">
      <div className="city-v2-host-copy">
        <span className="city-v2-pill city-v2-pill-accent">{record.city} hosts</span>
        <h2 id="city-host-title">Run a venue, event or trip in {record.city}?</h2>
        <p>Get in front of the people planning their weekend in {record.city}.</p>
      </div>
      <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_host_band" variant="primary" />
    </section>
  )
}

export function CityPage({ record, catalogue }: { readonly record: CityHubRecord; readonly catalogue: CityHubCatalogue }) {
  return (
    <div className="page-system-root city-hub-root city-page-v2">
      <CutoutShell>
        <CityHubImpression citySlug={record.slug} countryCode={record.countryCode} />
        <PageSystemNav surface="explorer" />
        <CityLifecycleNotice record={record} />
        <main id="main" className="page-system-printable">
          <CityPageHero record={record} placeCount={catalogue.places.length} hasPlans={catalogue.plans.length > 0} />
          <CityTopPlaces
            cityName={record.city}
            citySlug={record.slug}
            countryCode={record.countryCode}
            locale={record.locale}
            cityPath={cityHubPath(record)}
            places={catalogue.places}
          />
          {catalogue.plans.length ? <CityPlans record={record} plans={catalogue.plans} /> : null}
          <CityHostBand record={record} />
          <CityFaq record={record} />
        </main>
        <CutoutFooter surface="explorer" />
      </CutoutShell>
    </div>
  )
}
