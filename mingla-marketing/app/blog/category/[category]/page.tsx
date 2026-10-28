import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BlogIndexView, blogPageFrom } from '@/components/blog/blog-index'
import { BLOG_CATEGORIES, blogCategoryForSlug, blogCategoryPath, type BlogCategorySlug } from '@/content/blog/categories'
import { getBlogIndex } from '@/lib/blog/data'
import { canonicalUrlForSearchRoute } from '@/lib/search/route-registry'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #4137 — /blog/category/<slug> for the four categories; anything else 404s.
export const dynamic = 'force-dynamic'
export const dynamicParams = false

export function generateStaticParams() {
  return BLOG_CATEGORIES.map((category) => ({ category: category.slug }))
}

type Props = {
  readonly params: Promise<{ category: string }>
  readonly searchParams: Promise<{ page?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const category = blogCategoryForSlug((await params).category)
  if (!category) return {}
  const path = blogCategoryPath(category.slug as BlogCategorySlug)
  const metadata = searchRouteMetadata(path)
  if (blogPageFrom((await searchParams).page) > 1) {
    return { ...metadata, robots: { index: false, follow: true }, alternates: { canonical: canonicalUrlForSearchRoute(path) } }
  }
  return metadata
}

export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const category = blogCategoryForSlug((await params).category)
  if (!category) notFound()
  const page = blogPageFrom((await searchParams).page)
  const index = await getBlogIndex(category.slug, page)
  return (
    <BlogIndexView
      index={index}
      page={page}
      category={{ slug: category.slug, label: category.label }}
      heading={category.label}
      lede={category.description}
      basePath={blogCategoryPath(category.slug as BlogCategorySlug)}
    />
  )
}
