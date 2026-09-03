import { canonicalMarketingUrl } from '@/lib/site'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { isCityHubSearchReady } from '@/content/cities/registry'

export function cityHubStructuredData(record: CityHubRecord): Record<string, unknown> | null {
  if (!isCityHubSearchReady(record)) return null
  const url = canonicalMarketingUrl(cityHubPath(record))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#page`,
        url,
        name: `Find the right plan in ${record.city}.`,
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
          { '@type': 'ListItem', position: 2, name: record.city, item: url },
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
