import type { Metadata } from 'next'
import {
  NOINDEX_LIFECYCLES,
  canonicalUrlForSearchRoute,
  requireRouteContract,
  type SearchReadyRouteContract,
} from '@/lib/search/route-registry'

export interface PublicNoindexMetadataInput {
  readonly title: string
  readonly description?: string
  readonly follow?: boolean
}

export function searchRouteMetadata(pathname: string): Metadata {
  const contract = requireRouteContract(pathname, 'search_ready') as SearchReadyRouteContract
  const canonical = canonicalUrlForSearchRoute(pathname)
  return {
    title: contract.title,
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
    title: input.title,
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
