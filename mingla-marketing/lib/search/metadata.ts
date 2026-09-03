import type { Metadata } from 'next'
import {
  NOINDEX_LIFECYCLES,
  canonicalUrlForSearchRoute,
  requireRouteContract,
  type SearchReadyRouteContract,
} from '@/lib/search/route-registry'
import type { CityHubRecord } from '@/content/cities/registry'
import { cityHubPath } from '@/content/cities/registry'
import { canonicalMarketingUrl } from '@/lib/site'

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
  if (record.lifecycle === 'search_ready') return searchRouteMetadata(pathname)

  const metadata = publicNoindexMetadata(pathname, {
    title,
    description: record.directAnswer,
    follow: true,
  })
  if (
    (record.lifecycle === 'stale' || record.lifecycle === 'expired_archived') &&
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
