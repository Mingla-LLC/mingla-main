import Image from 'next/image'
import Link from 'next/link'
import { Play } from 'lucide-react'
import {
  HELP_CHAPTERS,
  bambooPosterUrl,
  helpVideoPath,
  type HelpVideoRecord,
} from '@/content/help/registry'

// #4339 speed fix — the help centre's video cards, rendered on the server.
//
// Before, the whole registry (every video's steps) was handed to the client
// filter as a prop, so it travelled twice: once as HTML and again as JSON in
// the page's payload, ahead of the first thumbnail. Now the cards are plain
// server HTML, each tagged with what the filter needs (`data-help-slug`,
// `data-help-intents`); help-browser.tsx only shows and hides them, and loads
// the step text for search on the first search.
//
// The thumbnails go through next/image (same origin, sized AVIF/WebP for the
// card's width) instead of Bamboo's 480 px JPEG. The first card of the first
// chapter is the page's largest paint, so it is preloaded at high priority;
// every other thumbnail is lazy.

const CARD_SIZES = '(min-width: 1024px) 360px, (min-width: 640px) 50vw, calc(100vw - 48px)'

function VideoCard({ video, chapterLabel, lcp }: { video: HelpVideoRecord; chapterLabel: string; lcp: boolean }) {
  return (
    <li data-help-slug={video.slug} data-help-intents={video.intents.join('|')}>
      <Link href={helpVideoPath(video.slug)} className="vid">
        <div className="ph">
          {video.bambooEntryId ? (
            <>
              {/* #4339 speed fix: sized (no shift); the first card is the LCP. */}
              <Image
                src={bambooPosterUrl(video.bambooEntryId, 960)}
                alt=""
                width={480}
                height={270}
                sizes={CARD_SIZES}
                priority={lcp}
                loading={lcp ? undefined : 'lazy'}
              />
              <span className="play" aria-hidden="true">
                <i>
                  <Play fill="currentColor" />
                </i>
              </span>
              <span className="dur">{video.duration}</span>
            </>
          ) : (
            <span className="soon">Coming soon</span>
          )}
        </div>
        <div className="meta">
          <small>
            {chapterLabel} · {video.surfaces.join(', ')}
          </small>
          <h3>{video.title}</h3>
          <p>{video.blurb}</p>
        </div>
      </Link>
    </li>
  )
}

/** Every chapter with its videos, in episode order. */
export function HelpChapters({ videos }: { videos: readonly HelpVideoRecord[] }) {
  let lcpPending = true
  return (
    <>
      {HELP_CHAPTERS.map((chapter) => {
        const inChapter = videos.filter((v) => v.chapter === chapter.id).sort((a, b) => a.episode - b.episode)
        if (!inChapter.length) return null
        return (
          <section key={chapter.id} aria-label={chapter.label} className="help-chapter" data-help-chapter="">
            <h2 className="h3">{chapter.label}</h2>
            <p className="lead">{chapter.blurb}</p>
            <ul className="grid3 vid-grid mt-24">
              {inChapter.map((v) => {
                const lcp = lcpPending && Boolean(v.bambooEntryId)
                if (lcp) lcpPending = false
                return <VideoCard key={v.slug} video={v} chapterLabel={chapter.label} lcp={lcp} />
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}
