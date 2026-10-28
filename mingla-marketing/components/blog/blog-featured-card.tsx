import Image from 'next/image'
import Link from 'next/link'
import type { BlogCard } from '@/lib/blog/data'
import { blogPostPath, formatBlogDate, readTime } from './format'

// #4137 — the big card at the top of /blog (or the newest story on a
// category page). The cover is the page's LCP image, so it loads with priority.
export function BlogFeaturedCard({ card, coverSrc, headingLevel = 2 }: {
  readonly card: BlogCard
  readonly coverSrc: string | null
  readonly headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Link href={blogPostPath(card.slug)} className="blog-featured focus-ring" data-blog-featured={card.slug}>
      <div className="blog-zoom blog-ratio-16-10">
        {coverSrc && card.cover ? (
          <Image
            src={coverSrc}
            alt={card.cover.alt}
            width={card.cover.width}
            height={card.cover.height}
            priority
            sizes="(min-width: 900px) 56vw, 100vw"
          />
        ) : null}
      </div>
      <div className="blog-featured-body">
        <div className="blog-byline">
          <span className="blog-pill">{card.category.label}</span>
          <span className="blog-meta-muted">{readTime(card.read_minutes)}</span>
        </div>
        <Heading className="blog-display">{card.title}</Heading>
        {card.summary ? <p>{card.summary}</p> : null}
        <div className="blog-byline">
          <span className="blog-avatar" aria-hidden="true">{card.author.display_name.slice(0, 1).toUpperCase()}</span>
          <span>{card.author.display_name} · {formatBlogDate(card.publish_at)}</span>
        </div>
      </div>
    </Link>
  )
}
