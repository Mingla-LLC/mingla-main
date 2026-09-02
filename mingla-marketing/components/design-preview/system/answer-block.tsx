import { type ReactNode } from 'react'
import { Reveal } from '@/components/ui/reveal'
import { PreviewSection } from './section'

// #2902 — the search-answer band. This is the part of the page an answer engine
// can quote: the question as a heading, a direct answer in the first sentence,
// then the supporting detail. No hero copy, no adjectives doing the work.

interface AnswerBlockProps {
  /** Phrased as the question a person actually types or asks. */
  question: string
  /** The direct answer. One or two sentences. Must stand alone out of context. */
  answer: string
  /** Supporting paragraphs, each independently true. */
  detail: readonly string[]
  /** Optional aside rendered beside the answer on desktop. */
  aside?: ReactNode
  polarity?: 'light' | 'night'
  id?: string
}

export function AnswerBlock({
  question,
  answer,
  detail,
  aside,
  polarity = 'light',
  id,
}: AnswerBlockProps) {
  return (
    <PreviewSection polarity={polarity} id={id} aria-label={question}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
        <div className="max-w-2xl">
          <Reveal
            as="span"
            className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink"
          >
            The short answer
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-text-primary md:text-[2.75rem]">
              {question}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-6 text-lg font-semibold leading-relaxed text-text-primary md:text-xl">
              {answer}
            </p>
          </Reveal>
          <Reveal delay={0.14}>
            <div className="mt-5 space-y-4 text-base leading-relaxed text-text-secondary md:text-[1.0625rem]">
              {detail.map((p) => (
                <p key={p.slice(0, 42)}>{p}</p>
              ))}
            </div>
          </Reveal>
        </div>
        {aside ? (
          <Reveal delay={0.1} className="lg:pt-14">
            {aside}
          </Reveal>
        ) : null}
      </div>
    </PreviewSection>
  )
}
