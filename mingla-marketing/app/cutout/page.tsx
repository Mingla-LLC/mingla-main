import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CutoutCard, CutoutHeading, CutoutSection, CutoutShell } from '@/components/cutout'

export const metadata: Metadata = {
  title: 'Cutout design foundation — #2902',
  description: 'Review-only index of the #2902 Cutout design foundation.',
  robots: { index: false, follow: false },
}

const PAGES = [
  { href: '/cutout/explorer', eyebrow: 'Explorer home', title: 'One viewport, re-skinned', body: 'Current structure kept exactly as it is; only the styling and motion change. Real Lagos places in cut-out media windows.' },
  { href: '/cutout/host', eyebrow: 'Host home', title: "AIgocy's full narrative arc", body: 'Hero, ICP strip, accordion-swap workflow, feature hub, limits, FAQ, conversion. Truthful substitutes where the template needs content Mingla cannot supply.' },
  { href: '/cutout/host/event-organizers-promoters', eyebrow: 'Landing page', title: 'The contract the other 30 clone', body: 'SPEC page 20. Hero, answer block second in the document, product proof, before/after, education, limits, FAQ with schema, one action.' },
]

export default function CutoutIndexPage() {
  return (
    <CutoutShell>
      <CutoutSection className="min-h-[100svh] pt-24">
        <CutoutHeading as="h1" eyebrow="Issue #2902" lede="AIgocy's layout language rendered in Mingla's brand. Framer Motion only, no GSAP. Review-only — none of these replace a live page and none are indexed.">
          The Cutout <span className="text-[var(--cut-accent)]">design foundation.</span>
        </CutoutHeading>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href} className="group focus-ring rounded-[var(--cut-r-card)]">
              <CutoutCard pad="lg" interactive className="h-full">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-[var(--cut-accent-ink)]">{p.eyebrow}</span>
                <h2 className="mt-3 font-display text-[1.25rem] leading-tight tracking-[-0.02em] text-[var(--cut-ink)]">{p.title}</h2>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{p.body}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-[0.875rem] font-semibold text-[var(--cut-accent-ink)]">
                  Open <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </CutoutCard>
            </Link>
          ))}
        </div>
      </CutoutSection>
    </CutoutShell>
  )
}
