'use client'

import { useEffect, useRef, useState } from 'react'
import type { BlogCard } from '@/lib/blog/data'
import { BlogStoryCard } from './blog-story-card'

// #4137 — "Load more stories". With JavaScript it fetches the next 12 cards
// and appends them, moves focus to the first new card and announces how many
// arrived. Without JavaScript it is a plain link to the next page.

export interface LoadMoreItem { readonly card: BlogCard; readonly coverSrc: string | null }

export function BlogLoadMore({ category, shown, total, nextPageHref }: {
  readonly category: string | null
  readonly shown: number
  readonly total: number
  readonly nextPageHref: string
}) {
  const [items, setItems] = useState<readonly LoadMoreItem[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [announcement, setAnnouncement] = useState('')
  const firstNew = useRef<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const count = shown + items.length

  useEffect(() => {
    if (firstNew.current === null) return
    const target = listRef.current?.querySelectorAll<HTMLAnchorElement>('a.blog-card')[firstNew.current]
    target?.focus()
    firstNew.current = null
  }, [items])

  async function loadMore() {
    setState('loading')
    try {
      const params = new URLSearchParams({ offset: String(count) })
      if (category) params.set('category', category)
      const response = await fetch(`/api/blog/posts?${params.toString()}`)
      if (!response.ok) throw new Error(`blog_load_more_failed:${response.status}`)
      const body = (await response.json()) as { items: LoadMoreItem[] }
      firstNew.current = items.length
      setItems((current) => [...current, ...body.items])
      setAnnouncement(`${body.items.length} more ${body.items.length === 1 ? 'story' : 'stories'}`)
      setState('idle')
    } catch (error) {
      console.error('[blog] load more failed', error)
      setState('error')
      setAnnouncement('More stories didn’t load. Try again.')
    }
  }

  return (
    <>
      {items.length > 0 ? (
        <ul ref={listRef} className="blog-grid" style={{ marginTop: 40 }}>
          {items.map((item) => (
            <li key={item.card.slug}><BlogStoryCard card={item.card} coverSrc={item.coverSrc} /></li>
          ))}
        </ul>
      ) : null}
      <p className="sr-live" aria-live="polite">{announcement}</p>
      {count < total ? (
        <div className="blog-more-row">
          <a
            href={nextPageHref}
            className="cut-btn cut-btn-light h-[3.25rem] px-7 text-base focus-ring"
            aria-disabled={state === 'loading' ? 'true' : undefined}
            onClick={(event) => {
              event.preventDefault()
              if (state !== 'loading') void loadMore()
            }}
          >
            {state === 'loading' ? 'Loading…' : state === 'error' ? 'Try again' : 'Load more stories'}
          </a>
        </div>
      ) : null}
    </>
  )
}
