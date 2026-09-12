import type { Metadata } from 'next'
import {
  NOINDEX_LIFECYCLES,
  canonicalUrlForSearchRoute,
  requireRouteContract,
  type SearchReadyRouteContract,
} from '@/lib/search/route-registry'
import type { CityHubRecord } from '@/content/cities/registry'
import { cityHubEffectiveLifecycle, cityHubPath } from '@/content/cities/registry'
import { canonicalMarketingUrl } from '@/lib/site'
import type { CorePageRecord } from '@/content/core-pages'
import type { HelpVideoRecord } from '@/content/help/registry'
import { bambooPosterUrl, helpVideoPath } from '@/content/help/registry'

export interface PublicNoindexMetadataInput {
  readonly title: string
  readonly description?: string
  readonly follow?: boolean
}

export function searchRouteMetadata(pathname: string): Metadata {
  const contract = requireRouteContract(pathname, 'search_ready') as SearchReadyRouteContract
  const canonical = canonicalUrlForSearchRoute(pathname)
  return {
    title: { absolute: contract.title },
    description: contract.description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: 'Mingla',
      title: contract.title,
      description: contract.description,
      url: canonical,
    },
    twitter: {
      card: 'summary',
      title: contract.title,
      description: contract.description,
    },
  }
}

export function publicNoindexMetadata(
  pathname: string,
  input: PublicNoindexMetadataInput,
): Metadata {
  const contract = requireRouteContract(pathname)
  if (!NOINDEX_LIFECYCLES.has(contract.lifecycle)) {
    throw new Error(`${pathname} must be registered in a noindex lifecycle`)
  }
  return {
    title: { absolute: input.title },
    ...(input.description ? { description: input.description } : {}),
    robots: { index: false, follow: input.follow ?? false },
    openGraph: {
      type: 'website',
      siteName: 'Mingla',
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
    },
  }
}

export function cityHubMetadata(record: CityHubRecord): Metadata {
  const pathname = cityHubPath(record)
  const title = `Things to do in ${record.city} — Mingla city guide`
  const lifecycle = cityHubEffectiveLifecycle(record)
  if (lifecycle === 'search_ready') return searchRouteMetadata(pathname)

  const metadata = publicNoindexMetadata(pathname, {
    title,
    description: record.directAnswer,
    follow: true,
  })
  if (
    (lifecycle === 'stale' || lifecycle === 'expired_archived') &&
    record.wasSearchReady
  ) {
    const canonical = canonicalMarketingUrl(pathname)
    return {
      ...metadata,
      alternates: { canonical: canonical },
      openGraph: { ...metadata.openGraph, url: canonical },
    }
  }
  return metadata
}

export function corePageMetadata(record: CorePageRecord): Metadata {
  return record.lifecycle === 'search_ready'
    ? searchRouteMetadata(record.pathname)
    : publicNoindexMetadata(record.pathname, { title: record.title, description: record.description, follow: true })
}

/**
 * Per-video metadata for a help page.
 *
 * The `/help/` route contract is a prefix, so it carries one title for the
 * whole branch. That is right for the contract and wrong for search: each video
 * answers a different question. This keeps the contract's canonical and robots
 * handling and replaces only the parts that are per-video — including an
 * og:image, since the poster is the reason these preview well when shared.
 */
export function helpVideoMetadata(record: HelpVideoRecord): Metadata {
  const pathname = helpVideoPath(record.slug)
  const base = searchRouteMetadata(pathname)
  const title = `${record.title} — Mingla help`
  const poster = record.bambooEntryId ? bambooPosterUrl(record.bambooEntryId, 1280) : null

  return {
    ...base,
    title: { absolute: title },
    description: record.blurb,
    openGraph: {
      ...base.openGraph,
      type: 'video.other',
      title,
      description: record.blurb,
      ...(poster ? { images: [{ url: poster, width: 1280, height: 720 }] } : {}),
    },
    twitter: {
      card: poster ? 'summary_large_image' : 'summary',
      title,
      description: record.blurb,
      ...(poster ? { images: [poster] } : {}),
    },
  }
}
