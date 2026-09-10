import type { CorePageRecord } from '@/content/core-pages'
import { allCityHubsSearchReady, CITY_HUBS, cityHubPath } from '@/content/cities/registry'
import { canonicalMarketingUrl, SITE_ORIGIN } from '@/lib/site'

export function corePageStructuredData(record: CorePageRecord): Record<string, unknown> | null {
  if (record.lifecycle !== 'search_ready') return null
  const pageId = `${canonicalMarketingUrl(record.pathname)}#page`
  const pageType = record.slug === 'about' ? 'AboutPage' : record.slug === 'cities' ? 'CollectionPage' : 'WebPage'
  const page: Record<string, unknown> = {
    '@type': pageType, '@id': pageId, url: canonicalMarketingUrl(record.pathname),
    name: record.title, description: record.description, inLanguage: 'en',
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` }, publisher: { '@id': `${SITE_ORIGIN}/#organization` },
  }
  if (record.slug === 'explorer') page.mainEntity = { '@id': `${SITE_ORIGIN}/#mingla-app` }
  if (record.slug === 'cities' && allCityHubsSearchReady()) {
    page.mainEntity = {
      '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderAscending', numberOfItems: 10,
      itemListElement: CITY_HUBS.map((city, index) => ({ '@type': 'ListItem', position: index + 1, name: city.city, url: canonicalMarketingUrl(cityHubPath(city)) })),
    }
  }
  return {
    '@context': 'https://schema.org', '@graph': [page, {
      '@type': 'BreadcrumbList', '@id': `${pageId}-breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalMarketingUrl('/') },
        { '@type': 'ListItem', position: 2, name: record.eyebrow, item: canonicalMarketingUrl(record.pathname) },
      ],
    }],
  }
}

export function serializeCorePageStructuredData(data: Record<string, unknown>): string { return JSON.stringify(data).replace(/</g, '\\u003c') }
