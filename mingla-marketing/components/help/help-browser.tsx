'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Play, Search } from 'lucide-react'
import { FilterChips } from '@/components/site/filter-row'
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
 *
 * #4339 phase 2b — restyled in the approved design: the round search field,
 * the intent chips as one row that swipes on a phone (pages.css .tabs), and
 * the video cards (poster, play mark, duration). The registry, the search over
 * titles, blurbs, intents and steps, and the player pages are unchanged.
 */
const EVERYTHING = 'All'

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
          options={[EVERYTHING, ...HELP_INTENTS]}
          value={intent ?? EVERYTHING}
          onChange={(next) => setIntent(next === EVERYTHING ? null : (next as HelpIntent))}
        />
      </div>

      {/* results */}
      {showingAll ? (
        <div className="mt-56">
          {HELP_CHAPTERS.map((chapter) => {
            const inChapter = videos
              .filter((v) => v.chapter === chapter.id)
              .sort((a, b) => a.episode - b.episode)
            if (!inChapter.length) return null
            return (
              <section key={chapter.id} aria-label={chapter.label} className="help-chapter">
                <h2 className="h3">{chapter.label}</h2>
                <p className="lead">{chapter.blurb}</p>
                <VideoGrid videos={inChapter} chapterLabel={chapter.label} />
              </section>
            )
          })}
        </div>
      ) : (
        <div className="mt-40">
          <p className="filter-note" aria-live="polite">
            {matches.length === 0
              ? 'Nothing matches that yet.'
              : `${matches.length} ${matches.length === 1 ? 'video' : 'videos'}`}
          </p>
          {matches.length === 0 ? (
            <p className="lead">
              More videos are being recorded. If you cannot find what you need,{' '}
              <a href="mailto:support@usemingla.com">email support@usemingla.com</a> and we will walk you through it.
            </p>
          ) : (
            <VideoGrid videos={matches} />
          )}
        </div>
      )}
    </div>
  )
}

function chapterLabelFor(video: HelpVideoRecord): string {
  return HELP_CHAPTERS.find((chapter) => chapter.id === video.chapter)?.label ?? ''
}

function VideoGrid({ videos, chapterLabel }: { videos: readonly HelpVideoRecord[]; chapterLabel?: string }) {
  return (
    <ul className="grid3 vid-grid mt-24">
      {videos.map((v) => (
        <li key={v.slug}>
          <Link href={helpVideoPath(v.slug)} className="vid">
            <div className="ph">
              {v.bambooEntryId ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bambooPosterUrl(v.bambooEntryId, 640)} alt="" loading="lazy" decoding="async" />
                  <span className="play" aria-hidden="true">
                    <i>
                      <Play fill="currentColor" />
                    </i>
                  </span>
                  <span className="dur">{v.duration}</span>
                </>
              ) : (
                <span className="soon">Coming soon</span>
              )}
            </div>
            <div className="meta">
              <small>
                {chapterLabel ?? chapterLabelFor(v)} · {v.surfaces.join(', ')}
              </small>
              <h3>{v.title}</h3>
              <p>{v.blurb}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
