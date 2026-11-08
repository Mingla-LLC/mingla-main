import Link from 'next/link'
import { ArrowRight, Bookmark, MapPin, Plus } from 'lucide-react'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { CityMedia } from '@/components/site/city-media'
import { SitePage } from '@/components/site/site-page'
import { CityHubImpression, CityTrackedLink } from './city-actions'
import { CityLifecycleNotice, type CityHubCatalogue } from './city-hub'
import { CityWeekend } from './city-weekend'

// #4339 phase 2b — the release layout of /cities/[city] (one template for
// every city), in the approved design:
//
//   1. the photo/clip hero with the city pill, "<City>, what are we outside
//      for?" and the glass bar with Use Mingla (the Explorer hand-off, §3);
//   2. "This weekend" with the Events / Experiences / Places chips
//      (city-weekend.tsx);
//   3. the moss "More than one mode." guide band;
//   4. the city's questions (the FAQPage markup's visible answers);
//   5. "Run a place in <City>?" with ONE host button, See Mingla Host → /host
//      (round 1, point 8: we don't know their ICP yet).
//
// DATA is the page's existing source and content, unchanged: the #4137
// catalogue snapshot (ranked places, ready-made plans) and the registry
// record (guide sections, FAQs). links_page_week / links_page_strips arrive in
// phase 4. The historical #2983 layout stays in city-hub.tsx for its pinned
// build lane.

function CityHero({ record }: { readonly record: CityHubRecord }) {
  return (
    <section className="lp-hero city-lp-hero" aria-labelledby="city-hub-title">
      <CityMedia slug={record.slug} hero />
      <div className="shade" aria-hidden="true" />
      <div className="in wrap">
        <div className="row">
          <span className="pill glass">
            <MapPin aria-hidden="true" /> {record.city}, {record.country}
          </span>
        </div>
        <h1 id="city-hub-title">
          <span>{record.city}, what are we</span>
          <span>
            <em>outside for?</em>
          </span>
        </h1>
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

export function CityPage({ record, catalogue }: { readonly record: CityHubRecord; readonly catalogue: CityHubCatalogue }) {
  return (
    <div className="page-system-root city-hub-root city-page-v2 city-page-v3">
      <CityHubImpression citySlug={record.slug} countryCode={record.countryCode} />
      <SitePage surface="explorer" current="cities">
        <CityHero record={record} />
        <CityLifecycleNotice record={record} />
        <CityWeekend
          cityName={record.city}
          citySlug={record.slug}
          countryCode={record.countryCode}
          locale={record.locale}
          cityPath={cityHubPath(record)}
          places={catalogue.places}
        />
        <CityGuideBand record={record} catalogue={catalogue} />
        <CityQuestions record={record} />
        <CityHostBand record={record} />
      </SitePage>
      <div data-city-detail-host="" />
    </div>
  )
}
