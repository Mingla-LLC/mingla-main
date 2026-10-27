import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { BlogPostView } from '@/components/blog/blog-post-view'
import { getBlogPreview } from '@/lib/blog/data'

// #4137 — staff preview of a draft by a one-hour token. Never indexed, never
// cached; a wrong or expired token 404s.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: { absolute: 'Preview · Mingla blog' },
  robots: { index: false, follow: false },
}

export default async function BlogPreviewPage({ params }: { readonly params: Promise<{ token: string }> }) {
  await headers()
  const preview = await getBlogPreview((await params).token)
  if (!preview) notFound()
  return <BlogPostView post={preview} embeds={preview.embeds} preview />
}
