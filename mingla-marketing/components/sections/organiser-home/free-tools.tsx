'use client'
import Link from 'next/link'
import { Reveal } from '@/components/ui/reveal'
import { buttonClasses } from '@/components/ui/button'

// #1003 [Venue Website Grader — growth tools, test cut] — compact funnel
// section on /business pointing at the /tools hub. Deliberately small: one
// eyebrow, one heading, one line, one CTA — the tools sell themselves.

export function OrganiserFreeTools() {
  return (
    <section
      aria-label="Free AI tools for your business"
      className="seam-top px-6 py-20 md:px-10 md:py-24 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 md:flex-row md:items-center md:justify-between md:gap-12">
        <div className="max-w-xl">
          <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
            Free tools
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.06] tracking-[-0.02em] text-text-primary md:text-4xl">
              Free AI tools for <span className="text-warm-ink">your business.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 text-base leading-relaxed text-text-secondary md:text-lg">
              Grade your website, predict your turnout, price your experience — free.
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.12} className="shrink-0">
          <Link href="/tools" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
            Try the free tools
          </Link>
        </Reveal>
      </div>
    </section>
  )
}
