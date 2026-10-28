import { canonicalMarketingUrl, SITE_ORIGIN } from '@/lib/site'
import { blogPostCanonicalUrl } from '@/lib/search/route-registry'

// #4137 — structured data. Rendered in the server HTML, so crawlers and
// browsers get the same JSON-LD. The publisher points at the site-wide
// Organization entity (lib/search/entity-graph.ts) by @id.
const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`

function JsonLd({ value }: { readonly value: unknown }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output with `<` escaped cannot close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(value).replace(/</g, '\\u003c') }}
    />
  )
}

export function BlogArticleSchema({ slug, headline, description, imageUrl, datePublished, dateModified, authorName, categoryLabel, categoryPath }: {
  readonly slug: string
  readonly headline: string
  readonly description: string
  readonly imageUrl: string | null
  readonly datePublished: string | null
  readonly dateModified: string
  readonly authorName: string
  readonly categoryLabel: string
  readonly categoryPath: string
}) {
  const url = blogPostCanonicalUrl(slug)
  return (
    <JsonLd value={{
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          headline,
          description,
          ...(imageUrl ? { image: [imageUrl] } : {}),
          ...(datePublished ? { datePublished } : {}),
          dateModified,
          author: authorName === 'Mingla Editorial'
            ? { '@type': 'Organization', name: 'Mingla', '@id': ORGANIZATION_ID }
            : { '@type': 'Person', name: authorName },
          publisher: { '@id': ORGANIZATION_ID },
          mainEntityOfPage: { '@type': 'WebPage', '@id': url },
          articleSection: categoryLabel,
          url,
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Blog', item: canonicalMarketingUrl('/blog') },
            { '@type': 'ListItem', position: 2, name: categoryLabel, item: canonicalMarketingUrl(categoryPath) },
            { '@type': 'ListItem', position: 3, name: headline, item: url },
          ],
        },
      ],
    }} />
  )
}

export function BlogCollectionSchema({ path, name, description, slugs }: {
  readonly path: string
  readonly name: string
  readonly description: string
  readonly slugs: readonly string[]
}) {
  return (
    <JsonLd value={{
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      description,
      url: canonicalMarketingUrl(path),
      publisher: { '@id': ORGANIZATION_ID },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: slugs.slice(0, 12).map((slug, index) => ({ '@type': 'ListItem', position: index + 1, url: blogPostCanonicalUrl(slug) })),
      },
    }} />
  )
}
