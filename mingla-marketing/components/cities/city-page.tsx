import Link from 'next/link'
import { ArrowRight, Bookmark, MapPin, Plus } from 'lucide-react'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { CityMedia } from '@/components/site/city-media'
import { SitePage } from '@/components/site/site-page'
import { CityHubImpression, CityTrackedLink } from './city-actions'
import { CityLifecycleNotice, type CityHubCatalogue } from './city-lifecycle'
import { CityWeekend } from './city-weekend'
import { CityThisWeekend } from './city-this-weekend'
import type { CityWeekendModel } from '@/lib/city-weekend'
import { cataloguePlaceView } from '@/content/page-system/shared'

// #4339 phase 2b — the release layout of /cities/[city] (one template for
// every city), in the approved design:
//
//   1. the photo/clip hero with the city pill, "<City>, what are we outside
//      for?" and the glass bar with Use Mingla (the Explorer hand-off, §3);
//   2. "This weekend" from the live readers (#4339 phase 4a, §4): admin
//      strips first, the city's Friday–Sunday listings, the empty-week rule,
//      and the Events / Experiences / Places chips (city-this-weekend.tsx);
//   2b. the city's ranked places with their detail sheet (city-weekend.tsx),
//      unchanged from phase 2b apart from its own heading;
//   3. the moss "More than one mode." guide band;
//   4. the city's questions (the FAQPage markup's visible answers);
//   5. "Run a place in <City>?" with ONE host button, See Mingla Host → /host
//      (round 1, point 8: we don't know their ICP yet).
//
// DATA: "This weekend" is #4318's readers (lib/city-weekend-data.ts); the rest
// is the page's existing source, unchanged: the #4137 catalogue snapshot
// (ranked places, ready-made plans) and the registry record (guide sections,
// FAQs). The historical #2983 layout stays in city-hub.tsx for its pinned
// build lane.

function CityHero({ record }: { readonly record: CityHubRecord }) {
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

/** The visible trail that matches the BreadcrumbList (Home › Cities › <City>). */
function CityBreadcrumb({ record }: { readonly record: CityHubRecord }) {
  return (
    <nav className="city-crumbs wrap" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/">Home</Link>
        </li>
        <li>
          <Link href="/cities">Cities</Link>
        </li>
        <li>
          <span aria-current="page">{record.city}</span>
        </li>
      </ol>
    </nav>
  )
}

function CityGuideBand({ record, catalogue }: { readonly record: CityHubRecord; readonly catalogue: CityHubCatalogue }) {
  const plans = catalogue.plans
  return (
    <section className="sec moss" aria-labelledby="city-guide-title">
      <div className="wrap">
        <div className="split reveal">
          <h2 className="h2" id="city-guide-title">
            More than <em>one mode.</em>
          </h2>
          <p className="lead">
            {plans.length ? `Ready-made plans for ${record.city}, to send to the group.` : record.utilityHeading}
          </p>
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
            : record.utilitySections.map((utility, index) => (
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

function CityQuestions({ record }: { readonly record: CityHubRecord }) {
  if (!record.faqs.length) return null
  return (
    <section className="sec" aria-labelledby="city-faq-title">
      <div className="wrap">
        <h2 className="h2 reveal" id="city-faq-title">
          {record.city} questions, <em>answered.</em>
        </h2>
        <div className="faq mt-40">
          {record.faqs.map((faq) => (
            <details key={faq.question}>
              <summary>
                {faq.question}
                <span className="pl" aria-hidden="true">
                  <Plus />
                </span>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function CityHostBand({ record }: { readonly record: CityHubRecord }) {
  return (
    <section className="sec" aria-labelledby="city-host-title">
      <div className="wrap">
        <div className="split split-center reveal">
          <h2 className="h2" id="city-host-title">
            Run a place <em>in {record.city}?</em>
          </h2>
          <div className="row">
            <CityTrackedLink citySlug={record.slug} countryCode={record.countryCode} event="city_hub_host_action" destinationType="host_web">
              <Link className="btn ink" href="/host">
                See Mingla Host <ArrowRight aria-hidden="true" />
              </Link>
            </CityTrackedLink>
          </div>
        </div>
      </div>
    </section>
  )
}

export function CityPage({
  record,
  catalogue,
  weekend,
}: {
  readonly record: CityHubRecord
  readonly catalogue: CityHubCatalogue
  readonly weekend: CityWeekendModel
}) {
  return (
    <div className="page-system-root city-hub-root city-page-v2 city-page-v3">
      <CityHubImpression citySlug={record.slug} countryCode={record.countryCode} />
      <SitePage surface="explorer" current="cities">
        <CityHero record={record} />
        <CityBreadcrumb record={record} />
        <CityLifecycleNotice record={record} />
        <CityThisWeekend cityName={record.city} citySlug={record.slug} countryCode={record.countryCode} model={weekend} />
        <CityWeekend
          cityName={record.city}
          citySlug={record.slug}
          countryCode={record.countryCode}
          locale={record.locale}
          cityPath={cityHubPath(record)}
          // #4339 speed fix: the card/detail view of each place, not the full
          // catalogue record (its receipts stay on the server).
          places={catalogue.places.map(cataloguePlaceView)}
        />
        <CityGuideBand record={record} catalogue={catalogue} />
        <CityQuestions record={record} />
        <CityHostBand record={record} />
      </SitePage>
      <div data-city-detail-host="" />
    </div>
  )
}
