import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PreviewSection } from '@/components/design-preview/system/section'

export const metadata: Metadata = {
  title: '#2902 design preview',
  description: 'Review-only index of the #2902 coded landing-page prototypes.',
  robots: { index: false, follow: false },
}

const SURFACES = [
  {
    href: '/design-preview/explorer-lagos',
    eyebrow: 'Explorer',
    title: 'Finding events and weekend plans in Lagos',
    body: 'Built on ten real Lagos venues from Mingla’s own place pool, using the real consumer place and plan cards.',
  },
  {
    href: '/host/design-preview/events',
    eyebrow: 'Host',
    title: 'Event organisers and promoters',
    body: 'Build, promote and run an event. Every capability names the file in Mingla’s source that proves it ships.',
  },
] as const

export default function DesignPreviewIndexPage() {
  return (
    <PreviewSection polarity="night" className="min-h-[100svh] pt-40" aria-label="Design preview index">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">Issue #2902</p>
      <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
        Coded landing-page prototypes.
      </h1>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 md:text-lg">
        Two matched surfaces on one landing system. Review-only: neither route replaces the live
        page, both are noindex, and nothing here is deployed.
      </p>
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-2xl bg-white/[0.05] p-8 ring-1 ring-inset ring-white/10 transition-colors duration-200 ease-out-quart hover:bg-white/[0.09] focus-ring"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
              {s.eyebrow}
            </span>
            <h2 className="mt-3 font-display text-2xl leading-tight tracking-[-0.015em] text-white">
              {s.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/60">{s.body}</p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-warm">
              Open
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </div>
    </PreviewSection>
  )
}
