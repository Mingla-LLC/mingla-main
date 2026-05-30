'use client'
import {
  LayoutTemplate,
  Sparkles,
  Receipt,
  Mail,
  UserCheck,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { Reveal, RevealGroup } from '@/components/ui/reveal'

// ORCH-1010 — the concrete, all-shipped capability list ("what you actually
// get"). Back on parchment (daylight after the dark Comparison peak). Each card
// carries a real lucide chip — NO mock dashboards, NO invented charts, NO fake
// screenshots (reality-anchor). Every capability below is shipped, grade A/B.

interface Feature {
  icon: LucideIcon
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    icon: LayoutTemplate,
    title: 'a page worth sharing',
    body: 'A beautiful, on-brand page for your place, event, or experience — your colors, your photos and video, your story. The page people actually want to send to the group chat.',
  },
  {
    icon: Sparkles,
    title: 'taste-matched discovery',
    body: 'Your offer reaches people by vibe, taste, location, timing, budget, and what they’re already planning — not just who’s nearby, but who’s looking for exactly this tonight.',
  },
  {
    icon: Receipt,
    title: 'all-in checkout, built in',
    body: 'Sell tickets, tables, and packages right inside Mingla. One all-in price up front, no address typing, no checkout surprises — buyers see the full cost before they pay.',
  },
  {
    icon: Mail,
    title: 'email your real customers',
    body: 'Send campaigns to the people who actually bought from you or your events — no list to build, no extra tool to learn. They’re already there.',
  },
  {
    icon: UserCheck,
    title: 'know who showed up',
    body: 'Your dashboard shows the guest list, check-ins, and what sold — so you finally know which nights, offers, and crowds are working.',
  },
  {
    icon: Tag,
    title: 'tell your vibe in plain words',
    body: 'Name the energy people should expect — cozy, lively, romantic, late-night, family-friendly, high-energy, intimate — so the right people self-select in, and the wrong fit self-selects out.',
  },
]

export function OrganiserFeatures() {
  return (
    <section className="seam-top px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          What you get
        </Reveal>

        <Reveal>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            everything you need to turn a vibe <br className="hidden md:block" />
            into a booking — <span className="text-warm-ink">and a full room.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <RevealGroup
            items={FEATURES}
            step={0.04}
            base={0.2}
            keyFor={(f) => f.title}
          >
            {(feature) => {
              const Icon = feature.icon
              return (
                <article
                  className="glass-soft flex h-full flex-col gap-3 rounded-2xl p-6 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 md:p-8"
                  style={{ boxShadow: 'var(--elev-1)' }}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full bg-warm/10 text-warm-ink"
                  >
                    <Icon className="size-5" strokeWidth={1.8} />
                  </span>
                  <h3 className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                    {feature.title}
                  </h3>
                  <p className="text-base leading-relaxed text-text-secondary">
                    {feature.body}
                  </p>
                </article>
              )
            }}
          </RevealGroup>
        </div>
      </div>
    </section>
  )
}
