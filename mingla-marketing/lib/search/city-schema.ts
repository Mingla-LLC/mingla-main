import { canonicalMarketingUrl } from '@/lib/site'
import { cityHubEffectiveLifecycle, cityHubPath, type CityHubRecord } from '@/content/cities/registry'

export function cityHubStructuredData(record: CityHubRecord): Record<string, unknown> | null {
  if (cityHubEffectiveLifecycle(record) !== 'search_ready') return null
  const url = canonicalMarketingUrl(cityHubPath(record))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: `Things to do in ${record.city}`,
        description: record.directAnswer,
        about: { '@id': `${url}#place` },
      },
      {
        '@type': record.placeSchemaType,
        '@id': `${url}#place`,
        name: record.scopeLabel,
        address: { '@type': 'PostalAddress', addressCountry: record.countryCode },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalMarketingUrl('/') },
          // #4339 round B: the Cities level the visible breadcrumb shows.
          { '@type': 'ListItem', position: 2, name: 'Cities', item: canonicalMarketingUrl('/cities') },
          { '@type': 'ListItem', position: 3, name: record.city, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: record.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  }
}

export function serializeCityHubStructuredData(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
