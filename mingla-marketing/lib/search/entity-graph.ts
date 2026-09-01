import {
  APP_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  PLAY_STORE_URL,
} from '@/lib/store-links'
import { canonicalMarketingUrl, SITE_ORIGIN } from '@/lib/site'

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`
const WEBSITE_ID = `${SITE_ORIGIN}/#website`
const LOGO_URL = canonicalMarketingUrl('/brand/mingla-logo-white-on-orange.png')

export const MINGLA_ENTITY_GRAPH = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'Mingla',
      legalName: 'MINGLA LLC',
      url: canonicalMarketingUrl('/'),
      email: 'support@usemingla.com',
      logo: {
        '@type': 'ImageObject',
        '@id': `${SITE_ORIGIN}/#logo`,
        url: LOGO_URL,
        contentUrl: LOGO_URL,
        width: 768,
        height: 768,
      },
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      name: 'Mingla',
      url: canonicalMarketingUrl('/'),
      inLanguage: 'en',
      publisher: { '@id': ORGANIZATION_ID },
    },
    {
      '@type': 'MobileApplication',
      '@id': `${SITE_ORIGIN}/#mingla-app`,
      name: 'Mingla',
      url: canonicalMarketingUrl('/'),
      applicationCategory: 'LifestyleApplication',
      operatingSystem: ['iOS', 'Android'],
      downloadUrl: [APP_STORE_URL, PLAY_STORE_URL],
      publisher: { '@id': ORGANIZATION_ID },
      image: LOGO_URL,
    },
    {
      '@type': 'MobileApplication',
      '@id': `${SITE_ORIGIN}/#mingla-host-app`,
      name: 'Mingla Host',
      url: canonicalMarketingUrl('/host'),
      applicationCategory: 'BusinessApplication',
      operatingSystem: ['iOS', 'Android'],
      downloadUrl: [BUSINESS_APP_STORE_URL, BUSINESS_PLAY_STORE_URL],
      publisher: { '@id': ORGANIZATION_ID },
      image: canonicalMarketingUrl('/brand/mingla-business-logo.png'),
    },
  ],
} as const

export function minglaEntityGraphJson(): string {
  return JSON.stringify(MINGLA_ENTITY_GRAPH).replace(/</g, '\\u003c')
}
