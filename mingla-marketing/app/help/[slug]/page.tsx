import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock } from 'lucide-react'
import { helpVideoMetadata } from '@/lib/search/metadata'
import {
  BreadcrumbSchema,
  CutoutFooter,
  CutoutNav,
  CutoutSection,
  CutoutShell,
} from '@/components/cutout'
import { HelpPlayer } from '@/components/help/help-player'
import { HelpVideoSchema } from '@/components/help/help-schema'
import {
  HELP_CHAPTERS,
  HELP_VIDEOS,
  bambooHlsUrl,
  bambooPosterUrl,
  helpCaptionsUrl,
  helpVideoForSlug,
  helpVideoPath,
} from '@/content/help/registry'

// One page per video, which is what makes each one shareable and indexable.
//
// The written steps are not a transcript — they are the same instructions in a
// form you can follow without pressing play, and they are in the HTML, so the
// page answers the question even to a reader that never loads the video.

interface HelpVideoPageProps {
  readonly params: Promise<{ slug: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return HELP_VIDEOS.map((v) => ({ slug: v.slug }))
}

export async function generateMetadata({ params }: HelpVideoPageProps): Promise<Metadata> {
  const { slug } = await params
  const record = helpVideoForSlug(slug)
  if (!record) return {}
  return helpVideoMetadata(record)
}

export default async function HelpVideoPage({ params }: HelpVideoPageProps) {
  const { slug } = await params
  const video = helpVideoForSlug(slug)
  if (!video) notFound()

  const chapter = HELP_CHAPTERS.find((c) => c.id === video.chapter)
  const captions = helpCaptionsUrl(video)
  const next = HELP_VIDEOS.filter((v) => v.episode > video.episode).sort(
    (a, b) => a.episode - b.episode,
  )[0]

  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/host" />
      <HelpVideoSchema video={video} />
      <BreadcrumbSchema
        crumbs={[
          { name: 'Mingla', path: '/' },
          { name: 'Help centre', path: '/help' },
          { name: video.title, path: helpVideoPath(video.slug) },
        ]}
      />

      <CutoutSection aria-label={video.title}>
        <Link
          href="/help"
          className="inline-flex items-center gap-2 text-[0.875rem] font-semibold text-[var(--cut-accent-ink)] hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Help centre
        </Link>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            {video.bambooEntryId ? (
              <HelpPlayer
                hlsUrl={bambooHlsUrl(video.bambooEntryId)}
                poster={bambooPosterUrl(video.bambooEntryId, 1280)}
                title={video.title}
                captionsUrl={captions ?? undefined}
              />
            ) : (
              <div className="cut-media flex aspect-video w-full items-center justify-center bg-black/5">
                <p className="text-[0.9375rem] text-[var(--cut-body)]">
                  This one is being recorded. The steps below are complete.
                </p>
              </div>
            )}

            <h1 className="font-display cut-display-2 mt-8 text-[var(--cut-ink)]">{video.title}</h1>
            <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)]">
              {video.blurb}
            </p>
            <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-[var(--cut-body)]">
              <span className="inline-flex items-center gap-1.5">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                {video.duration}
              </span>
              <span aria-hidden="true">·</span>
              <span>Shown on {video.surfaces.join(', ')}</span>
              {chapter ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{chapter.label}</span>
                </>
              ) : null}
            </p>
          </div>

          {/* steps */}
          <div>
            <h2 className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-accent-ink)]">
              What happens in this video
            </h2>
            <ol className="mt-6 space-y-6">
              {video.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-bold text-white"
                    /* --cut-accent-ink, not --cut-accent: white on the raw
                       accent is 2.90:1 and fails AA. See help-browser.tsx. */
                    style={{ background: 'var(--cut-accent-ink)' }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-[1rem] font-bold leading-snug text-[var(--cut-ink)]">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {next ? (
              <div className="mt-10 border-t border-black/10 pt-8">
                <p className="text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-body)]">
                  Up next
                </p>
                <Link
                  href={helpVideoPath(next.slug)}
                  className="font-display mt-2 block text-[1.0625rem] font-bold leading-snug text-[var(--cut-ink)] hover:underline"
                >
                  {next.title}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </CutoutSection>

      <CutoutFooter surface="host" />
    </CutoutShell>
  )
}
