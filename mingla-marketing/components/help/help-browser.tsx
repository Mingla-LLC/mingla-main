'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  HELP_CHAPTERS,
  HELP_INTENTS,
  bambooPosterUrl,
  helpVideoPath,
  type HelpIntent,
  type HelpVideoRecord,
} from '@/content/help/registry'

/**
 * Search and intent filtering over the video list.
 *
 * This is a client component, but it is handed the full list as a prop and
 * renders all of it on the server first — so the titles, blurbs and steps are
 * in the delivered HTML. Filtering only ever hides what is already there.
 * Nothing here fetches.
 */
export function HelpBrowser({ videos }: { videos: readonly HelpVideoRecord[] }) {
  const [query, setQuery] = useState('')
  const [intent, setIntent] = useState<HelpIntent | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return videos.filter((v) => {
      if (intent && !v.intents.includes(intent)) return false
      if (!q) return true
      // Steps are searched too: people describe the thing they are stuck on
      // ("scan tickets at the door"), not the title of the video it lives in.
      const haystack = [
        v.title,
        v.blurb,
        ...v.intents,
        ...v.steps.map((s) => `${s.title} ${s.body}`),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [videos, query, intent])

  const showingAll = !query.trim() && !intent

  return (
    <div>
      {/* search */}
      <div className="relative mx-auto max-w-2xl">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--cut-body)] opacity-60"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What are you trying to do?"
          aria-label="Search the help centre"
          className={cn(
            'cut-card w-full rounded-full py-4 pl-14 pr-6',
            'text-[1.0625rem] text-[var(--cut-ink)] placeholder:text-[var(--cut-body)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-[var(--cut-accent-ink)]',
          )}
        />
      </div>

      {/* intent chips */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Chip active={intent === null} onClick={() => setIntent(null)}>
          Everything
        </Chip>
        {HELP_INTENTS.map((i) => (
          <Chip key={i} active={intent === i} onClick={() => setIntent(intent === i ? null : i)}>
            {i}
          </Chip>
        ))}
      </div>

      {/* results */}
      {showingAll ? (
        <div className="mt-16 space-y-16">
          {HELP_CHAPTERS.map((chapter) => {
            const inChapter = videos
              .filter((v) => v.chapter === chapter.id)
              .sort((a, b) => a.episode - b.episode)
            if (!inChapter.length) return null
            return (
              <section key={chapter.id} aria-label={chapter.label}>
                <h2 className="font-display cut-display-2 text-[var(--cut-ink)]">
                  {chapter.label}
                </h2>
                <p className="mt-3 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)]">
                  {chapter.blurb}
                </p>
                <VideoGrid videos={inChapter} className="mt-8" />
              </section>
            )
          })}
        </div>
      ) : (
        <div className="mt-14">
          <p className="mb-8 text-center text-[0.9375rem] text-[var(--cut-body)]">
            {matches.length === 0
              ? 'Nothing matches that yet.'
              : `${matches.length} ${matches.length === 1 ? 'video' : 'videos'}`}
          </p>
          {matches.length === 0 ? (
            <p className="mx-auto max-w-md text-center text-[1.0625rem] leading-relaxed text-[var(--cut-body)]">
              More videos are being recorded. If you cannot find what you need,{' '}
              <a className="underline" href="mailto:support@usemingla.com">
                email support@usemingla.com
              </a>{' '}
              and we will walk you through it.
            </p>
          ) : (
            <VideoGrid videos={matches} />
          )}
        </div>
      )}
    </div>
  )
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-4 py-2 text-[0.8125rem] font-semibold transition-colors',
        active
          ? 'text-white'
          : 'cut-btn-light text-[var(--cut-accent-ink)] hover:opacity-80',
      )}
      /* White on --cut-accent is 2.90:1 — it fails AA for text AND the 3:1
         threshold for UI. --cut-accent-ink (#a8450e) is the kit's accessible
         accent and gives 5.96:1, so filled accent surfaces use it. */
      style={active ? { background: 'var(--cut-accent-ink)' } : undefined}
    >
      {children}
    </button>
  )
}

function VideoGrid({
  videos,
  className,
}: {
  videos: readonly HelpVideoRecord[]
  className?: string
}) {
  return (
    <ul className={cn('grid gap-6 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {videos.map((v) => (
        <li key={v.slug}>
          <Link href={helpVideoPath(v.slug)} className="group block h-full">
            <article className="cut-card cut-card-interactive flex h-full flex-col p-0">
              <div className="cut-media relative aspect-video w-full overflow-hidden bg-black/5">
                {v.bambooEntryId ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={bambooPosterUrl(v.bambooEntryId, 640)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-body)]">
                      Coming soon
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h3 className="font-display text-[1.125rem] font-bold leading-snug text-[var(--cut-ink)]">
                  {v.title}
                </h3>
                <p className="mt-2 flex-1 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
                  {v.blurb}
                </p>
                <p className="mt-4 flex items-center gap-1.5 text-[0.8125rem] text-[var(--cut-body)]">
                  <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                  {v.duration}
                  <span aria-hidden="true">·</span>
                  {v.surfaces.join(', ')}
                </p>
              </div>
            </article>
          </Link>
        </li>
      ))}
    </ul>
  )
}
