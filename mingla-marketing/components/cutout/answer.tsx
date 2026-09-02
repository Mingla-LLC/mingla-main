import { type ReactNode } from 'react'
import { CutoutCard, CutoutEyebrow, CutoutSection } from './primitives'
import { CutReveal } from './motion'
import type { Crumb } from './schema'

// ---------------------------------------------------------------
// #2902 — the answer block, and why it is the second thing on every page.
//
// Answer engines largely do not execute JavaScript, and they quote the earliest
// self-contained answer they can find. A 100svh hero is a sales device; it puts
// atmosphere at the top of the document and pushes meaning down. So every page
// in this system places a server-rendered, plain-HTML direct answer IMMEDIATELY
// after the hero — first `<h2>`, first paragraph, no client gating, no
// animation on the text itself that could hide it from extraction.
//
// The `answer` must stand alone out of context. If it only makes sense after
// reading the hero, it is not an answer, it is a subheading.
// ---------------------------------------------------------------

interface AnswerBlockProps {
  /** Phrased as the question a person actually types or asks aloud. */
  question: string
  /** The direct answer. One or two sentences that survive being quoted alone. */
  answer: string
  /** Supporting paragraphs, each independently true. */
  detail?: readonly string[]
  /** Visible breadcrumb. Mirrors BreadcrumbSchema exactly. */
  crumbs?: readonly Crumb[]
  /** Jump links / summary card rendered beside the answer on desktop. */
  aside?: ReactNode
  /** Real last-reviewed date, shown so the freshness claim is auditable. */
  lastChecked?: string
  id?: string
}

export function AnswerBlock({
  question,
  answer,
  detail = [],
  crumbs,
  aside,
  lastChecked,
  id = 'answer',
}: AnswerBlockProps) {
  return (
    <CutoutSection id={id} aria-label={question}>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-[var(--cut-muted)]">
            {crumbs.map((c, i) => (
              <li key={c.path} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {i === crumbs.length - 1 ? (
                  <span aria-current="page" className="text-[var(--cut-body)]">
                    {c.name}
                  </span>
                ) : (
                  <a href={c.path} className="hover:text-[var(--cut-ink)] focus-ring">
                    {c.name}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
        <div className="max-w-2xl">
          <CutoutEyebrow className="mb-5">The short answer</CutoutEyebrow>
          {/* No reveal wrapper on the question or the answer: these two nodes
              are the extractable payload and must be visible at first paint. */}
          <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[1.08] tracking-[-0.025em] text-[var(--cut-ink)]">
            {question}
          </h2>
          <p className="mt-6 text-[1.0625rem] font-semibold leading-relaxed text-[var(--cut-ink)] sm:text-xl">
            {answer}
          </p>
          {detail.length > 0 ? (
            <div className="mt-5 space-y-4 text-base leading-relaxed text-[var(--cut-body)] sm:text-[1.0625rem]">
              {detail.map((p) => (
                <p key={p.slice(0, 48)}>{p}</p>
              ))}
            </div>
          ) : null}
          {lastChecked ? (
            <p className="mt-6 text-[0.8125rem] text-[var(--cut-muted)]">
              Reviewed by the Mingla team on {lastChecked}.
            </p>
          ) : null}
        </div>

        {aside ? (
          <CutReveal delay={0.08} className="lg:pt-12">
            <CutoutCard pad="md">{aside}</CutoutCard>
          </CutReveal>
        ) : null}
      </div>
    </CutoutSection>
  )
}

/** The standard "on this page" aside — real internal linking, not decoration. */
export function OnThisPage({ links }: { links: readonly { href: string; label: string; note: string }[] }) {
  return (
    <>
      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-[var(--cut-muted)]">
        On this page
      </p>
      <ul className="mt-4 space-y-3.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="font-semibold text-[var(--cut-accent-ink)] underline-offset-2 hover:underline focus-ring"
            >
              {l.label}
            </a>{' '}
            — {l.note}
          </li>
        ))}
      </ul>
    </>
  )
}
