import Link from 'next/link'
import { ArrowUpRight, Compass, MapPinned, Store } from 'lucide-react'
import {
  CITY_HUBS,
  allCityHubsSearchReady,
  cityHubPath,
  isCityHubSearchReady,
  type CityHubRecord,
  type CityUtilityRecord,
} from '@/content/cities/registry'
import { CutoutCard, CutoutFooter, CutoutSection, CutoutShell } from '@/components/cutout'
import { PageSystemNav } from '@/components/page-system/page-system-nav'
import { CityHostAcquisitionBar } from '@/components/page-system/city-host-acquisition-bar'
import { CityDeviceAction, CityHostCreationLinks, CityHubImpression, CityTrackedLink } from './city-actions'

function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function EvidenceLinks({
  record,
  evidenceIds,
}: {
  readonly record: CityHubRecord
  readonly evidenceIds: readonly string[]
}) {
  const sources = evidenceIds
    .map((id) => {
      const sourceIndex = record.sources.findIndex((entry) => entry.id === id)
      return sourceIndex < 0 ? null : { entry: record.sources[sourceIndex], sourceIndex }
    })
    .filter((item): item is { entry: CityHubRecord['sources'][number]; sourceIndex: number } => Boolean(item))
  return (
    <p className="city-claim-sources">
      <span>Sources:</span>{' '}
      {sources.map(({ entry, sourceIndex }, index) => (
        <span key={sourceIndex}>
          {index > 0 ? ', ' : null}
          <a href={`#city-source-${sourceIndex + 1}`}>{entry.publisher}</a>
        </span>
      ))}
    </p>
  )
}

function CityLifecycleNotice({ record }: { readonly record: CityHubRecord }) {
  if (record.lifecycle === 'search_ready') return null
  const content = record.lifecycle === 'public_noindex'
    ? ['City guide in review', 'Local details are being verified; some sections may be withheld.']
    : record.lifecycle === 'stale'
      ? ['This city guide is being refreshed.', 'Current details are being checked before this guide returns to search.']
      : ['This city guide is no longer actively updated.', 'Current events and availability are not shown.']
  return (
    <div className="city-lifecycle-notice" role="status">
      <strong>{content[0]}</strong><span>{content[1]}</span>
    </div>
  )
}

function CityHero({ record }: { readonly record: CityHubRecord }) {
  const reviewed = formatDate(record.sourcesCheckedAt, record.locale)
  return (
    <section className="city-hero" aria-labelledby="city-hub-title">
      <nav aria-label="Breadcrumb" className="city-breadcrumbs">
        <ol><li><Link href="/">Home</Link></li><li aria-hidden="true">/</li><li aria-current="page">{record.city}</li></ol>
      </nav>
      <p className="city-eyebrow">Mingla in {record.city}, {record.country}</p>
      <h1 id="city-hub-title">Find the right plan in {record.city}.</h1>
      <p className="city-direct-answer">{record.directAnswer}</p>
      <p className="city-coverage">
        Coverage: {record.scopeLabel} <span aria-hidden="true">·</span> Last reviewed{' '}
        <time dateTime={record.sourcesCheckedAt}>{reviewed}</time>
      </p>
      <div className="city-hero-actions">
        <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="explorer" label={`Explore ${record.city}`} location="city_hub_hero_explorer" variant="primary" />
        <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_hero_host" variant="ink" />
      </div>
    </section>
  )
}

function CityAudienceFork({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection aria-label={`Choose your Mingla path in ${record.city}`} className="city-section city-audience-section">
      <div className="city-section-heading">
        <p className="city-eyebrow">Two ways into the city</p>
        <h2>Choose your Mingla path in {record.city}.</h2>
      </div>
      <div className="city-audience-grid">
        <CutoutCard as="article" className="city-audience-card">
          <Compass aria-hidden="true" />
          <p className="city-card-kicker">Explorer</p>
          <h3>Make a plan in {record.city}</h3>
          <strong>{record.explorer.title}</strong>
          <p>{record.explorer.body}</p>
          <ul className="city-intent-list">
            {record.utilitySections.map((utility, index) => <li key={utility.title}><a href={`#city-utility-${index + 1}`}>{utility.title}</a></li>)}
          </ul>
          <EvidenceLinks record={record} evidenceIds={record.explorer.evidenceIds} />
          <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="explorer" label={`Explore ${record.city}`} location="city_hub_fork_explorer" variant="primary" className="city-card-action" />
        </CutoutCard>
        <CutoutCard as="article" className="city-audience-card city-audience-host">
          <Store aria-hidden="true" />
          <p className="city-card-kicker">Mingla Host</p>
          <h3>Bring people together in {record.city}</h3>
          <strong>{record.host.title}</strong>
          <p>{record.host.body}</p>
          <CityHostCreationLinks citySlug={record.slug} countryCode={record.countryCode} />
          <EvidenceLinks record={record} evidenceIds={record.host.evidenceIds} />
          <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_fork_host" variant="ink" className="city-card-action" />
        </CutoutCard>
      </div>
    </CutoutSection>
  )
}

function CityUtilityGrid({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection className="city-section city-utility-section" aria-label={`${record.city} planning guide`}>
      <div className="city-section-heading">
        <p className="city-eyebrow">For Explorers</p>
        <h2>{record.utilityHeading}</h2>
      </div>
      <div className="city-utility-grid">
        {record.utilitySections.map((utility: CityUtilityRecord, index) => (
          <CutoutCard as="article" key={utility.title} className="city-utility-card">
            <span className="city-card-number" aria-hidden="true">0{index + 1}</span>
            <h3 id={`city-utility-${index + 1}`}>{utility.title}</h3>
            <p>{utility.answer}</p>
            <EvidenceLinks record={record} evidenceIds={utility.evidenceIds} />
          </CutoutCard>
        ))}
      </div>
    </CutoutSection>
  )
}

function CityHostUtility({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection band="dark" className="city-section city-host-utility" aria-label={`Host in ${record.city}`}>
      <div className="city-section-heading">
        <p className="city-eyebrow">For Hosts</p>
        <h2>Make the {record.city} invitation easier to act on.</h2>
      </div>
      <div className="city-host-utility-grid">
        {record.hostUtilities.map((utility) => (
          <CutoutCard as="article" key={utility.title} className="city-host-utility-card">
            <h3>{utility.title}</h3>
            <p>{utility.body}</p>
            <EvidenceLinks record={record} evidenceIds={utility.evidenceIds} />
          </CutoutCard>
        ))}
      </div>
      <div className="city-section-action">
        <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_host_utility" variant="primary" />
      </div>
    </CutoutSection>
  )
}

function CityFaq({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection className="city-section city-faq-section" aria-label={`${record.city} questions`}>
      <div className="city-section-heading"><p className="city-eyebrow">Useful before you go</p><h2>{record.city} questions, answered.</h2></div>
      <div className="city-faq-list">
        {record.faqs.map((faq) => (
          <details key={faq.question} className="city-faq-item">
            <summary>{faq.question}</summary>
            <div><p>{faq.answer}</p><EvidenceLinks record={record} evidenceIds={faq.evidenceIds} /></div>
          </details>
        ))}
      </div>
    </CutoutSection>
  )
}

function CityEvidencePanel({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection className="city-section city-evidence-section" aria-label={`How this ${record.city} guide is checked`}>
      <aside className="city-evidence-panel">
        <div className="city-section-heading">
          <p className="city-eyebrow">Evidence before promotion</p>
          <h2>How this {record.city} guide is checked.</h2>
          <p>{record.jurisdictionScope}</p>
        </div>
        <dl className="city-review-facts">
          <div><dt>Sources checked</dt><dd><time dateTime={record.sourcesCheckedAt}>{formatDate(record.sourcesCheckedAt, record.locale)}</time></dd></div>
          <div>
            <dt>Local review</dt>
            <dd>
              {record.localReview.status === 'pending' ? (
                'Pending — this page is not yet in search'
              ) : (
                <>Reviewed by {record.localReview.name}, {record.localReview.relationship} on <time dateTime={record.localReview.reviewedAt}>{formatDate(record.localReview.reviewedAt, record.locale)}</time></>
              )}
            </dd>
          </div>
          <div><dt>Next evergreen review</dt><dd><time dateTime={record.nextReviewAt}>{formatDate(record.nextReviewAt, record.locale)}</time></dd></div>
        </dl>
        <p className="city-review-note">Event, transport, price and availability details are checked separately at the source before they are shown.</p>
        <ol className="city-source-list">
          {record.sources.map((entry, index) => (
            <li key={index} id={`city-source-${index + 1}`}>
              <div><strong>{entry.publisher}</strong><span>{entry.title}</span></div>
              <p>{entry.supports}</p>
              <p>Last checked <time dateTime={entry.checkedAt}>{formatDate(entry.checkedAt, record.locale)}</time></p>
              <a href={entry.href} target="_blank" rel="noopener noreferrer">
                Open source <ArrowUpRight aria-hidden="true" size={15} /><span className="sr-only">, opens in new tab</span>
              </a>
            </li>
          ))}
        </ol>
      </aside>
    </CutoutSection>
  )
}

function CityNavigator({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection className="city-section city-navigator-section">
      <nav aria-label="Explore another Mingla city">
        <div className="city-section-heading"><p className="city-eyebrow">Ten independent city guides</p><h2>Explore another Mingla city.</h2></div>
        <ul className="city-grid">
          {CITY_HUBS.map((city) => {
            const current = city.slug === record.slug
            if (current) return <li key={city.slug}><span aria-current="page">{city.city}</span></li>
            if (!isCityHubSearchReady(city)) return <li key={city.slug}><span>{city.city}</span></li>
            return (
              <li key={city.slug}>
                <CityTrackedLink citySlug={record.slug} countryCode={record.countryCode} event="city_hub_switch_city" destinationType="city_hub">
                  <Link href={cityHubPath(city)}>{city.city}</Link>
                </CityTrackedLink>
              </li>
            )
          })}
        </ul>
      </nav>
    </CutoutSection>
  )
}

function CityFinalActions({ record }: { readonly record: CityHubRecord }) {
  return (
    <CutoutSection band="dark" className="city-section city-final-actions" aria-label={`${record.city} Mingla actions`}>
      <MapPinned aria-hidden="true" />
      <div><p className="city-eyebrow">One decision-ready plan</p><h2>Make {record.city} easier to choose.</h2></div>
      <div className="city-final-action-buttons">
        <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="explorer" label={`Explore ${record.city}`} location="city_hub_final_explorer" variant="primary" />
        <CityDeviceAction citySlug={record.slug} countryCode={record.countryCode} surface="host" label={`Host in ${record.city}`} location="city_hub_final_host" variant="quiet" />
      </div>
    </CutoutSection>
  )
}

export function RootCityGrid({ surface }: { readonly surface: 'explorer' | 'host' }) {
  if (!allCityHubsSearchReady()) return null
  return (
    <CutoutSection className="city-root-module" aria-label={surface === 'explorer' ? 'Explore your city' : 'Host your city'}>
      <div className="city-section-heading">
        <p className="city-eyebrow">Mingla city guides</p>
        <h2>{surface === 'explorer' ? 'Explore your city' : 'Host your city'}</h2>
        <p>{surface === 'explorer' ? 'Choose a city and turn what to do into one useful plan.' : 'Choose your city and show people exactly why and how to join you.'}</p>
      </div>
      <ul className="city-grid">
        {CITY_HUBS.map((city) => <li key={city.slug}><Link href={cityHubPath(city)}>{city.city}</Link></li>)}
      </ul>
    </CutoutSection>
  )
}

export function CityHub({ record }: { readonly record: CityHubRecord }) {
  return (
    <div className="page-system-root city-hub-root" data-host-acquisition="true">
      <CutoutShell>
        <CityHubImpression citySlug={record.slug} countryCode={record.countryCode} />
        <CityHostAcquisitionBar city={record.city} citySlug={record.slug} countryCode={record.countryCode} />
        <PageSystemNav surface="explorer" />
        <CityLifecycleNotice record={record} />
        <main id="main">
          <CityHero record={record} />
          <CityAudienceFork record={record} />
          <CityUtilityGrid record={record} />
          <CityHostUtility record={record} />
          <CityFaq record={record} />
          <CityEvidencePanel record={record} />
          <CityNavigator record={record} />
          <CityFinalActions record={record} />
        </main>
        <CutoutFooter surface="explorer" />
      </CutoutShell>
    </div>
  )
}
