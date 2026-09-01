import { SITE_ORIGIN } from '@/lib/site'
import {
  APP_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  PLAY_STORE_URL,
} from '@/lib/store-links'

// ---------------------------------------------------------------
// #2902 — SC-08 (machine-readable truth).
//
// Production currently emits ZERO structured data. That is the specific reason
// the AI-search half of this issue cannot work: an answer engine has nothing to
// resolve "Mingla" to, which is exactly the ambiguity SC-01 exists to remove.
//
// Two rules this module exists to enforce:
//
//  1. SCHEMA IS GENERATED FROM THE DATA THAT RENDERS. Every emitter here takes
//     the same array or object the visible component takes. Visible text and
//     structured data therefore cannot drift, which is the usual way schema
//     turns into an unsupported claim.
//  2. NOTHING IS INVENTED. `sameAs` lists only profiles that already exist in
//     this repo's shipped source. There is no aggregateRating, no review, no
//     award, no employee count — Mingla cannot substantiate any of them.
//
// Stable @id values connect the graph, per SPEC §4.
// ---------------------------------------------------------------

export const ORG_ID = `${SITE_ORIGIN}/#organization`
export const SITE_ID = `${SITE_ORIGIN}/#website`

/** Verified public profiles. Every URL below is present in shipped source. */
const SAME_AS = [
  'https://www.instagram.com/usemingla',
  'https://www.tiktok.com/@usemingla',
  'https://www.threads.com/@usemingla',
  'https://x.com/usemingla',
  'https://www.facebook.com/usemingla',
  'https://www.youtube.com/@usemingla',
  'https://www.linkedin.com/company/usemingla',
  APP_STORE_URL,
  PLAY_STORE_URL,
]

function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Authored in this repo. Never user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

/**
 * Organization + WebSite. Emitted once per page, from the root of the Cutout
 * layout, so every page in the system carries the entity graph.
 */
export function OrganizationSchema() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': ORG_ID,
            name: 'Mingla',
            url: `${SITE_ORIGIN}/`,
            logo: {
              '@type': 'ImageObject',
              url: `${SITE_ORIGIN}/brand/mingla-logo-white-on-orange.png`,
              width: 512,
              height: 512,
            },
            // SC-01: state what Mingla is, and by implication what it is not.
            description:
              'Mingla is a local discovery and experience-planning product. People use it to decide what to do — a night out, a date, a weekend plan — and to agree on it as a group. Hosts use Mingla to publish, promote and sell experiences.',
            sameAs: SAME_AS,
          },
          {
            '@type': 'WebSite',
            '@id': SITE_ID,
            url: `${SITE_ORIGIN}/`,
            name: 'Mingla',
            publisher: { '@id': ORG_ID },
            inLanguage: 'en',
          },
        ],
      }}
    />
  )
}

/**
 * The two real apps. Only fields that can be verified from store listings are
 * emitted — deliberately no ratings and no price claims.
 */
export function AppsSchema() {
  const app = (
    name: string,
    category: string,
    ios: string,
    android: string,
    description: string,
  ) => ({
    '@type': 'MobileApplication',
    name,
    applicationCategory: category,
    operatingSystem: 'iOS, Android',
    installUrl: [ios, android],
    publisher: { '@id': ORG_ID },
    description,
  })

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@graph': [
          app(
            'Mingla',
            'LifestyleApplication',
            APP_STORE_URL,
            PLAY_STORE_URL,
            'Decide what to do and agree on it as a group — plans, places and events in your city.',
          ),
          app(
            'Mingla Host',
            'BusinessApplication',
            BUSINESS_APP_STORE_URL,
            BUSINESS_PLAY_STORE_URL,
            'Publish an experience, promote it, sell tickets or take bookings, and see who showed up.',
          ),
        ],
      }}
    />
  )
}

export interface Crumb {
  name: string
  path: string
}

/** BreadcrumbList. Takes the same array the visible breadcrumb renders. */
export function BreadcrumbSchema({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          item: `${SITE_ORIGIN}${c.path}`,
        })),
      }}
    />
  )
}

export interface FaqEntry {
  q: string
  a: string
}

/** FAQPage. Takes the same array the visible accordion renders. */
export function FaqSchema({ items }: { items: readonly FaqEntry[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      }}
    />
  )
}

/**
 * WebPage for an editorial or ICP landing page. `dateModified` must be a real
 * last-reviewed date — SPEC §7 requires a visible "last checked" that matches.
 */
export function PageSchema({
  path,
  name,
  description,
  dateModified,
}: {
  path: string
  name: string
  description: string
  dateModified: string
}) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': `${SITE_ORIGIN}${path}#webpage`,
        url: `${SITE_ORIGIN}${path}`,
        name,
        description,
        isPartOf: { '@id': SITE_ID },
        publisher: { '@id': ORG_ID },
        dateModified,
        inLanguage: 'en',
      }}
    />
  )
}
