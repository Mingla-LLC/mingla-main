import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, Clock } from 'lucide-react'
import { helpVideoMetadata } from '@/lib/search/metadata'
import { BreadcrumbSchema } from '@/components/cutout'
import { SitePage } from '@/components/site/site-page'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'
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
//
// #4339 phase 2c — moved onto the redesigned frame: the site nav (Host
// surface, Help current), the canonical footer and the brand type, with the
// same content and behaviour (the player, the title and blurb, the meta line,
// the written steps with their outbound links, and Up next).
// app/help/layout.tsx keeps the <main id="main"> that carries the #3431 copy
// opt-in, so the shell adds no second <main>.

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
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="host" current="help" layoutMain>
        <HelpVideoSchema video={video} />
        <BreadcrumbSchema
          crumbs={[
            { name: 'Mingla', path: '/' },
            { name: 'Help centre', path: '/help' },
            { name: video.title, path: helpVideoPath(video.slug) },
          ]}
        />

        <section className="art-sec" aria-label={video.title}>
          <div className="wrap">
            <Link href="/help" className="art-back">
              <ArrowLeft aria-hidden="true" />
              Help centre
            </Link>

            <div className="art-grid">
              <div>
                {video.bambooEntryId ? (
                  <HelpPlayer
                    hlsUrl={bambooHlsUrl(video.bambooEntryId)}
                    poster={bambooPosterUrl(video.bambooEntryId, 1280)}
                    title={video.title}
                    captionsUrl={captions ?? undefined}
                  />
                ) : (
                  <div className="art-soon">
                    <p>This one is being recorded. The steps below are complete.</p>
                  </div>
                )}

                <h1 className="art-title">{video.title}</h1>
                <p className="lead">{video.blurb}</p>
                <p className="art-meta">
                  <span>
                    <Clock aria-hidden="true" />
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
                <h2 className="art-h6">What happens in this video</h2>
                <ol className="art-steps">
                  {video.steps.map((step, i) => (
                    <li key={step.title}>
                      <span aria-hidden="true" className="n">
                        {i + 1}
                      </span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.body}</p>
                        {step.links?.length ? (
                          <ul className="art-links">
                            {step.links.map((link) => (
                              <li key={link.href}>
                                <a
                                  href={link.href}
                                  /* Every one of these leaves Mingla, so it opens in
                                     a new tab and carries noopener. */
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {link.label}
                                  <ArrowUpRight aria-hidden="true" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>

                {next ? (
                  <div className="art-next">
                    <p className="art-h6">Up next</p>
                    <Link href={helpVideoPath(next.slug)}>{next.title}</Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
