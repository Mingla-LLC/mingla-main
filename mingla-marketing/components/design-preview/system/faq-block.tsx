import { Reveal } from '@/components/ui/reveal'
import { FAQAccordion, type FAQItem } from '@/components/ui/faq-accordion'
import { cn } from '@/lib/cn'

// #2902 — FAQ band. Emits FAQPage JSON-LD alongside the accordion, because the
// answer-engine half of this issue needs the answers to exist in a machine
// form, not only behind a click. The visible text and the structured data come
// from the SAME array, so they can never drift.

interface FAQBlockProps {
  heading: string
  items: readonly FAQItem[]
  polarity: 'light' | 'night'
}

export function FAQBlock({ heading, items, polarity }: FAQBlockProps) {
  const night = polarity === 'night'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
      <div>
        <Reveal
          as="span"
          className={cn(
            'block text-xs font-semibold uppercase tracking-[0.2em]',
            night ? 'text-warm' : 'text-warm-ink',
          )}
        >
          Questions
        </Reveal>
        <Reveal>
          <h2
            className={cn(
              'mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] md:text-[2.5rem]',
              night ? 'text-white' : 'text-text-primary',
            )}
          >
            {heading}
          </h2>
        </Reveal>
      </div>
      <div>
        <FAQAccordion items={items as FAQItem[]} />
      </div>
      <script
        type="application/ld+json"
        // The content is authored in this repo, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  )
}
