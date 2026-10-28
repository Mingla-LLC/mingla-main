import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BlogPostView } from '@/components/blog/blog-post-view'
import { blogMediaUrl, getBlogPost, getBlogPostEmbeds } from '@/lib/blog/data'
import { blogPostMetadata } from '@/lib/search/metadata'

// #4137 — one published story. Drafts, scheduled, unpublished and taken-down
// posts are not public, so the RPC returns null and this 404s.
export const dynamic = 'force-dynamic'

type Props = { readonly params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getBlogPost((await params).slug)
  if (!post) return { title: { absolute: 'Story not found · Mingla blog' }, robots: { index: false, follow: true } }
  const version = post.published_version
  return blogPostMetadata({
    slug: post.slug,
    title: version.title,
    summary: version.summary,
    seoTitle: version.seo_title,
    seoDescription: version.seo_description,
    socialTitle: version.social_title,
    socialDescription: version.social_description,
    categoryLabel: post.category.label,
    firstPublishedAt: post.first_published_at,
    modifiedAt: post.updated_at,
    cover: version.cover ? { url: blogMediaUrl(version.cover.path), width: version.cover.width, height: version.cover.height, alt: version.cover.alt } : null,
  })
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const [post, embeds] = await Promise.all([getBlogPost(slug), getBlogPostEmbeds(slug)])
  if (!post) notFound()
  return <BlogPostView post={post} embeds={embeds} />
}
