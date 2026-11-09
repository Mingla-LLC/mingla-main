// #4339 round B (SEO audit 18) — structured data for the Host landing pages
// and the free tools, built from their own route contracts (title,
// description, canonical), so the markup can never say something the page
// does not.
//
//   /host/<icp>   WebPage + BreadcrumbList (Home › Mingla Host › <ICP>)
//   /tools/<x>    WebApplication (free, runs in the browser) + BreadcrumbList
//                 (Home › Free tools › <tool>)

import { canonicalMarketingUrl, SITE_ORIGIN } from '@/lib/site'
import { requireRouteContract, type SearchReadyRouteContract } from '@/lib/search/route-registry'

function contract(pathname: string): SearchReadyRouteContract {
  return requireRouteContract(pathname, 'search_ready') as SearchReadyRouteContract
}

function breadcrumb(id: string, trail: readonly (readonly [string, string])[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${id}-breadcrumb`,
    itemListElement: trail.map(([name, path], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: canonicalMarketingUrl(path),
    })),
  }
}

/** A Host landing page: WebPage about Mingla Host, plus its breadcrumb. */
export function hostLandingStructuredData(pathname: string, name: string): Record<string, unknown> {
  const route = contract(pathname)
  const url = canonicalMarketingUrl(pathname)
  const id = `${url}#page`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': id,
        url,
        name: route.title,
        description: route.description,
        inLanguage: 'en',
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
        about: { '@id': `${SITE_ORIGIN}/#mingla-host-app` },
      },
      breadcrumb(id, [['Home', '/'], ['Mingla Host', '/host'], [name, pathname]]),
    ],
  }
}

/** A free tool: WebApplication (free, in the browser), plus its breadcrumb. */
export function toolStructuredData(pathname: string, name: string): Record<string, unknown> {
  const route = contract(pathname)
  const url = canonicalMarketingUrl(pathname)
  const id = `${url}#app`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': id,
        name,
        url,
        description: route.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires JavaScript.',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      },
      breadcrumb(id, [['Home', '/'], ['Free tools', '/tools'], [name, pathname]]),
    ],
  }
}

export function serializeStructuredData(value: Record<string, unknown>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
