import Image from 'next/image'
import Link from 'next/link'
import { blogCategoryPath, blogCategoryForSlug, type BlogCategorySlug } from '@/content/blog/categories'
import { blogCardCoverSrc, blogMediaUrl, type BlogEmbeds, type BlogPost } from '@/lib/blog/data'
import { blogPostCanonicalUrl } from '@/lib/search/route-registry'
import { BlogArticleSchema } from './blog-article-schema'
import { BlogDocumentView } from './blog-document'
import { BlogShare } from './blog-share'
import { BlogStoryCard } from './blog-story-card'
import { formatBlogDate, readTime } from './format'

// #4137 — the post page (also the staff preview, with `preview`).
export function BlogPostView({ post, embeds, preview = false }: {
  readonly post: BlogPost
  readonly embeds: BlogEmbeds
  readonly preview?: boolean
}) {
  const version = post.published_version
  const category = blogCategoryForSlug(post.category.slug)
  const categoryPath = category ? blogCategoryPath(category.slug as BlogCategorySlug) : '/blog'
  const cover = version.cover
  const coverUrl = cover ? blogMediaUrl(cover.path) : null
  const url = blogPostCanonicalUrl(post.slug)
  return (
    <article>
      {preview ? <p className="blog-preview-banner" role="status">Preview. Not public.</p> : (
        <BlogArticleSchema
          slug={post.slug}
          headline={version.title}
          description={version.seo_description?.trim() || version.summary}
          imageUrl={coverUrl}
          datePublished={post.first_published_at}
          dateModified={post.updated_at}
          authorName={post.author.display_name}
          categoryLabel={post.category.label}
          categoryPath={categoryPath}
        />
      )}
      <header className="blog-post-head blog-read" style={{ maxWidth: 900 }}>
        <nav aria-label="Breadcrumb" className="blog-crumbs">
          <Link href="/blog" className="focus-ring">Blog</Link>{' / '}
          <Link href={categoryPath} className="focus-ring">{post.category.label}</Link>
        </nav>
        <div className="blog-post-meta">
          <span className="blog-pill blog-pill-ink">{post.category.label}</span>
          <span>{[formatBlogDate(post.publish_at), readTime(version.read_minutes)].filter(Boolean).join(' · ')}</span>
        </div>
        <h1 className="blog-display">{version.title}</h1>
        {version.summary ? <p className="blog-post-dek">{version.summary}</p> : null}
        <div className="blog-byline">
          <span className="blog-avatar" aria-hidden="true">{post.author.display_name.slice(0, 1).toUpperCase()}</span>
          {post.author.display_name}
        </div>
      </header>

      {cover && coverUrl ? (
        <figure className="blog-cover">
          <div className="blog-zoom">
            <Image src={coverUrl} alt={cover.alt} width={cover.width} height={cover.height} priority sizes="(min-width: 1240px) 1176px, 100vw" />
          </div>
        </figure>
      ) : <div style={{ height: 48 }} />}

      <div className="blog-read blog-prose">
        <BlogDocumentView
          document={version.document}
          media={version.media}
          embeds={embeds}
          hidePassedEventCards={post.hide_passed_event_cards}
        />
        {preview ? null : <BlogShare url={url} title={version.title} />}
      </div>

      {post.more_stories.length > 0 ? (
        <section className="blog-more" aria-labelledby="blog-more-heading">
          <div className="blog-wrap">
            <h2 id="blog-more-heading" className="blog-display">More stories</h2>
            <ul className="blog-grid">
              {post.more_stories.map((card) => (
                <li key={card.slug}><BlogStoryCard card={card} coverSrc={blogCardCoverSrc(card)} /></li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </article>
  )
}
