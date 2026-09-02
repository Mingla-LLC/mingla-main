import Link from 'next/link'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #1003 [Venue Website Grader — growth tools, test cut] — the /tools hub.
//
// Dark stage (site default). One LIVE card (the Venue Website Grader) + three
// coming-soon cards rendered subtle and non-clickable. Server component — no
// interactivity on this page.

export const metadata = searchRouteMetadata('/tools')

export default function ToolsHubPage() {
  return (
    <div className="px-6 py-16 md:px-10 md:py-24 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Free tools
        </span>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-[1.08] tracking-[-0.02em] text-white md:text-6xl">
          Free AI tools for people who run real places.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/72 md:text-lg">
          No sign-up, no sales call. Run one, get something useful in a minute —
          built by Mingla, the app that helps people find your place.
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {/* LIVE — Venue Website Grader */}
          <Link
            href="/tools/venues"
            className="group flex flex-col rounded-md glass-soft p-6 transition-all duration-200 ease-out-quart hover:-translate-y-1 hover:brightness-110 focus-ring md:p-8"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-warm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warm" />
              Live
            </span>
            <h2 className="mt-4 font-display text-2xl leading-tight text-white md:text-3xl">
              Venue Website Grader
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
              Find out what your website says to a first-timer — and exactly what
              it&rsquo;s costing you. Free report in 60 seconds.
            </p>
            <div className="mt-auto pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                Restaurants · bars · cafés · clubs
              </p>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-warm transition-transform duration-200 ease-out-quart group-hover:translate-x-1">
                Grade my website
                <span aria-hidden="true">→</span>
              </span>
            </div>
          </Link>

          {/* LIVE — Event Turnout Predictor */}
          <Link
            href="/tools/events"
            className="group flex flex-col rounded-md glass-soft p-6 transition-all duration-200 ease-out-quart hover:-translate-y-1 hover:brightness-110 focus-ring md:p-8"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-warm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warm" />
              Live
            </span>
            <h2 className="mt-4 font-display text-2xl leading-tight text-white md:text-3xl">
              Event Turnout Predictor
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
              How many people will actually show up? Get a turnout forecast — and
              see what your promo budget can buy. Free, in under a minute.
            </p>
            <div className="mt-auto pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                Event organisers · promoters
              </p>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-warm transition-transform duration-200 ease-out-quart group-hover:translate-x-1">
                Forecast my turnout
                <span aria-hidden="true">→</span>
              </span>
            </div>
          </Link>

          {/* LIVE — Quote Any Trip */}
          <Link
            href="/tools/trips"
            className="group flex flex-col rounded-md glass-soft p-6 transition-all duration-200 ease-out-quart hover:-translate-y-1 hover:brightness-110 focus-ring md:p-8"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-warm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warm" />
              Live
            </span>
            <h2 className="mt-4 font-display text-2xl leading-tight text-white md:text-3xl">
              Quote Any Trip
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
              Price a group trip in a minute — real hotels and activities, a full
              cost sheet, and exactly what to charge per person. Free.
            </p>
            <div className="mt-auto pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                Travel organisers · trip hosts
              </p>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-warm transition-transform duration-200 ease-out-quart group-hover:translate-x-1">
                Quote a trip
                <span aria-hidden="true">→</span>
              </span>
            </div>
          </Link>

          {/* LIVE — The Undercharging Audit */}
          <Link
            href="/tools/pricing"
            className="group flex flex-col rounded-md glass-soft p-6 transition-all duration-200 ease-out-quart hover:-translate-y-1 hover:brightness-110 focus-ring md:p-8"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warm/40 bg-warm/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-warm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warm" />
              Live
            </span>
            <h2 className="mt-4 font-display text-2xl leading-tight text-white md:text-3xl">
              The Undercharging Audit
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/70 md:text-base">
              Priced by guilt? See your true cost per head &mdash; including your
              own time &mdash; and the price you should actually charge. Free.
            </p>
            <div className="mt-auto pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                Experience hosts &middot; activity spaces
              </p>
              <span className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-warm transition-transform duration-200 ease-out-quart group-hover:translate-x-1">
                Audit my pricing
                <span aria-hidden="true">→</span>
              </span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
