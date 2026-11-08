import type { ReactNode } from 'react'
import Link from 'next/link'
import { blogCardCoverSrc, BLOG_PAGE_SIZE, type BlogIndex } from '@/lib/blog/data'
import { BlogCategoryTabs } from './blog-category-tabs'
import { BlogFeaturedCard } from './blog-featured-card'
import { BlogLoadMore } from './blog-load-more'
import { BlogStoryCard } from './blog-story-card'
import { BlogCollectionSchema } from './blog-article-schema'

// #4137 — the blog front page and the four category pages share this layout.
// No newsletter or sign-up box and no city filter (Seth: blogs are not city
// guides). Missing data is never faked: an empty blog says so and points to
// the city pages.
//
// #4339 phase 2b — restyled in the approved design (the page renders it inside
// components/site/site-page.tsx): the serif headline and lead, the category
// chips in one row that swipes on a phone (each one a real category page, so
// a chip filters the posts and stays indexable), then the featured story and
// the grid. The posts, categories, paging and Load more are unchanged.

const coverSrcFor = blogCardCoverSrc

export function BlogIndexView({ index, page, category, heading, title, lede, basePath }: {
  readonly index: BlogIndex
  readonly page: number
  /** null on /blog; the category on a category page. */
  readonly category: { readonly slug: string; readonly label: string } | null
  readonly heading: string
  /** The h1 as shown (its italic half as <em>); defaults to `heading`. */
  readonly title?: ReactNode
  readonly lede: string
  readonly basePath: string
}) {
  // On a category page the newest story takes the big card.
  const lead = category ? (page === 1 ? index.posts[0] ?? null : null) : page === 1 ? index.featured : null
  const grid = category && page === 1 ? index.posts.slice(1) : index.posts
  const shown = (page - 1) * BLOG_PAGE_SIZE + index.posts.length
  const empty = !lead && grid.length === 0
  const slugs = [...(lead ? [lead.slug] : []), ...grid.map((card) => card.slug)]

  return (
    <>
      <BlogCollectionSchema path={basePath} name={heading} description={lede} slugs={slugs} />
      <section className="page-hero blog-head" aria-labelledby="blog-heading">
        <div className="wrap">
          <h1 id="blog-heading">{title ?? heading}</h1>
          <p className="lead">{lede}</p>
          <div className="tabs-wrap">
            <BlogCategoryTabs active={category?.slug ?? null} />
          </div>
        </div>
      </section>

      <section className="pb-100 blog-list" aria-label={category ? `${category.label} stories` : 'Latest stories'}>
        <div className="wrap">
          {lead ? <BlogFeaturedCard card={lead} coverSrc={coverSrcFor(lead)} /> : null}
          {empty ? (
            <p className="blog-empty">
              {category
                ? <>No {category.label} stories yet. <Link href="/blog">See every story on the blog</Link>.</>
                : <>New stories are on the way. In the meantime, see what’s happening in your city on <Link href="/cities">Mingla’s city pages</Link>.</>}
            </p>
          ) : (
            <>
              <ul className="blog-grid">
                {grid.map((card) => (
                  <li key={card.slug}><BlogStoryCard card={card} coverSrc={coverSrcFor(card)} /></li>
                ))}
              </ul>
              <BlogLoadMore
                category={category?.slug ?? null}
                shown={shown}
                total={index.total}
                nextPageHref={`${basePath}?page=${page + 1}`}
              />
            </>
          )}
        </div>
      </section>
    </>
  )
}

/** `?page=N` → N (1 when missing or invalid). */
export function blogPageFrom(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const page = raw && /^[0-9]{1,4}$/.test(raw) ? Number(raw) : 1
  return Math.min(Math.max(page, 1), 834)
}
