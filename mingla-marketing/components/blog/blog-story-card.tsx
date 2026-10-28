import Image from 'next/image'
import Link from 'next/link'
import type { BlogCard } from '@/lib/blog/data'
import { blogPostPath, readTime } from './format'

// #4137 — one story card (index grid, category grid, More stories, Load more).
// No server-only imports: Load more renders the same card on the client.
export function BlogStoryCard({ card, coverSrc, headingLevel = 3 }: {
  readonly card: BlogCard
  /** Public blog-media URL of the cover, resolved by the caller. */
  readonly coverSrc: string | null
  readonly headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Link href={blogPostPath(card.slug)} className="blog-card focus-ring" data-blog-card={card.slug}>
      <div className="blog-zoom blog-ratio-4-3">
        {coverSrc && card.cover ? (
          <Image
            src={coverSrc}
            alt={card.cover.alt}
            width={card.cover.width}
            height={card.cover.height}
            sizes="(min-width: 900px) 30vw, 100vw"
          />
        ) : null}
      </div>
      <div className="blog-card-meta">
        <span className="blog-cat">{card.category.label}</span>
        <span className="blog-mins">· {readTime(card.read_minutes)}</span>
      </div>
      <Heading className="blog-display">{card.title}</Heading>
    </Link>
  )
}
