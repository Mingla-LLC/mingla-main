'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { FilterChips } from '@/components/site/filter-row'
import type { HelpIntent, HelpVideoRecord } from '@/content/help/registry'

/**
 * Search and intent filtering over the video list.
 *
 * The cards are server HTML (help-video-grid.tsx), passed in as `children`, so
 * the titles and blurbs are in the delivered HTML and nothing is filtered
 * before a visitor asks. Filtering only ever hides what is already there.
 *
 * #4339 phase 2b — restyled in the approved design: the round search field,
 * the intent chips as one row that swipes on a phone (pages.css .tabs), and
 * the video cards (poster, play mark, duration).
 *
 * #4339 speed fix — this island no longer receives the registry as a prop
 * (that shipped every step twice, ahead of the first thumbnail). The chips
 * (HELP_INTENTS, handed in by the page: the registry module is never a static
 * import here, or the whole registry would ship with the page) read each
 * card's `data-help-intents`. Search still covers the steps: the
 * step text loads with the first search (a separate chunk), and until it
 * arrives the search covers what the card shows.
 */
const EVERYTHING = 'All'

// Steps are searched too: people describe the thing they are stuck on
// ("scan tickets at the door"), not the title of the video it lives in.
function haystackFor(v: HelpVideoRecord): string {
  return [
    v.title,
    v.blurb,
    ...v.intents,
    ...v.steps.map((s) => `${s.title} ${s.body}`),
  ]
    .join(' ')
    .toLowerCase()
}

type SearchIndex = { state: 'idle' | 'loading' } | { state: 'ready'; bySlug: ReadonlyMap<string, string> } | { state: 'failed' }

export function HelpBrowser({ intents, children }: { intents: readonly HelpIntent[]; children: ReactNode }) {
  const [query, setQuery] = useState('')
  const [intent, setIntent] = useState<HelpIntent | null>(null)
  const [index, setIndex] = useState<SearchIndex>({ state: 'idle' })
  const [matchCount, setMatchCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const showingAll = !q && !intent

  // The step text arrives with the first search, not with the page.
  useEffect(() => {
    if (!q || index.state !== 'idle') return
    setIndex({ state: 'loading' })
    import('@/content/help/registry').then(
      (registry) => setIndex({ state: 'ready', bySlug: new Map(registry.HELP_VIDEOS.map((v) => [v.slug, haystackFor(v)])) }),
      (error: unknown) => {
        // Search keeps working on what the cards show; the note says so.
        console.error('help search: the step text did not load', error)
        setIndex({ state: 'failed' })
      },
    )
  }, [q, index.state])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let count = 0
    for (const card of list.querySelectorAll<HTMLElement>('[data-help-slug]')) {
      const slug = card.dataset.helpSlug ?? ''
      const intents = (card.dataset.helpIntents ?? '').split('|')
      const haystack = index.state === 'ready' ? index.bySlug.get(slug) ?? '' : (card.textContent ?? '').toLowerCase()
      const match = (!intent || intents.includes(intent)) && (!q || haystack.includes(q))
      card.hidden = !match
      if (match) count += 1
    }
    for (const chapter of list.querySelectorAll<HTMLElement>('[data-help-chapter]')) {
      chapter.hidden = !chapter.querySelector('[data-help-slug]:not([hidden])')
    }
    setMatchCount(count)
  }, [q, intent, index])

  return (
    <div>
      {/* search */}
      <div className="search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guides, e.g. “payouts”"
          aria-label="Search the help centre"
        />
      </div>

      {/* intent chips */}
      <div className="tabs-wrap">
        <FilterChips
          label="Filter help videos"
          options={[EVERYTHING, ...intents]}
          value={intent ?? EVERYTHING}
          onChange={(next) => setIntent(next === EVERYTHING ? null : (next as HelpIntent))}
        />
      </div>

      {/* results */}
      {showingAll ? null : (
        <div className="mt-40">
          <p className="filter-note" aria-live="polite">
            {matchCount === 0
              ? 'Nothing matches that yet.'
              : `${matchCount} ${matchCount === 1 ? 'video' : 'videos'}`}
            {q && index.state === 'failed' ? ' (searching titles only)' : null}
          </p>
          {matchCount === 0 ? (
            <p className="lead">
              More videos are being recorded. If you cannot find what you need,{' '}
              <a href="mailto:support@usemingla.com">email support@usemingla.com</a> and we will walk you through it.
            </p>
          ) : null}
        </div>
      )}
      <div ref={listRef} className={showingAll ? 'mt-56' : 'mt-24'} data-help-filtering={showingAll ? undefined : ''}>
        {children}
      </div>
    </div>
  )
}
