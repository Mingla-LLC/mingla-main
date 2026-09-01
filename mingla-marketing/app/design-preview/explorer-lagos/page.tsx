import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { ActionLink } from '@/components/design-preview/system/action-link'
import { Reveal } from '@/components/ui/reveal'
import { LandingHero } from '@/components/design-preview/system/landing-hero'
import { PreviewSection } from '@/components/design-preview/system/section'
import { AnswerBlock } from '@/components/design-preview/system/answer-block'
import {
  BeforeAfter,
  EducationBlock,
} from '@/components/design-preview/system/before-after'
import { FAQBlock } from '@/components/design-preview/system/faq-block'
import { ConversionBand } from '@/components/design-preview/system/conversion-band'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'
import { LagosHeroMosaic } from '@/components/design-preview/explorer/lagos-hero-mosaic'
import { LagosPlanLab } from '@/components/design-preview/explorer/lagos-plan-lab'
import { LagosVenueChart } from '@/components/design-preview/explorer/lagos-venue-chart'
import { LAGOS_VENUES } from '@/lib/design-preview/lagos-truth'

// #2902 DESIGN PREVIEW — Explorer / Lagos. Review-only. Never indexed, never
// linked from the live site, and it does not replace `/`.

export const metadata: Metadata = {
  title: 'Explorer · Lagos — #2902 design preview',
  description:
    'Review-only coded prototype of the Mingla Explorer landing system, built on real Lagos place-pool records.',
  robots: { index: false, follow: false },
}

const WORKFLOW = [
  {
    job: 'Deciding where to go',
    before: 'Fifteen tabs, a maps list, and three saved Instagram posts that never become a night.',
    after: 'One question — what kind of evening is this — answered with a route you can follow.',
  },
  {
    job: 'Agreeing as a group',
    before: 'A thread that fills with maybes and quietly dies on Thursday.',
    after: 'One shared plan everyone opens, reacts to, and locks in the same place.',
  },
  {
    job: 'Knowing roughly what it costs',
    before: 'You find out at the table.',
    after: 'Each venue carries its own price band on the card, before you leave the house.',
  },
  {
    job: 'Finding somewhere new',
    before: 'The same four places, because searching for new ones is work.',
    after: 'Categories you would not have typed — a gallery, a conservation walk, a theme park.',
  },
  {
    job: 'Keeping it',
    before: 'A screenshot you will never find again.',
    after: 'A saved plan you can re-run next month or send to someone else.',
  },
] as const

const EDUCATION = [
  {
    title: 'Start with the evening, not the map',
    body: 'Deciding “somewhere in Lekki” gives you two hundred options and no answer. Deciding “a slow first date” gives you three. Lagos is big enough that the constraint is what makes the choice possible.',
  },
  {
    title: 'Budget the whole night, not the dinner',
    body: 'A Lagos evening is usually a sequence — bites, then something to do, then a drink. Price the sequence. The single most common way a plan collapses is a first stop that eats the whole budget.',
  },
  {
    title: 'Build around traffic, not distance',
    body: 'Victoria Island to Lekki is short on a map and long at 7pm. Group stops that share a corridor, and put the thing you would most hate to miss first.',
  },
  {
    title: 'Give the group one decision',
    body: 'Groups do not fail to choose because they disagree. They fail because there are too many open questions at once. Send one plan and ask one thing: does this work.',
  },
  {
    title: 'Leave one stop unbooked',
    body: 'The best part of a night out is usually the part that was not scheduled. Lock the anchor, keep the last hour loose.',
  },
  {
    title: 'Check the day, not just the place',
    body: 'A lounge on a Tuesday and the same lounge on a Saturday are different venues. When you save somewhere, save the night you would go back on.',
  },
] as const

const FAQ = [
  {
    q: 'What is Mingla?',
    a: 'Mingla is an app for deciding what to actually do — a night out, a date, a weekend plan — and for getting a group to agree on it. It turns a kind of evening into a route through real places, and lets you send that route to the people coming with you.',
  },
  {
    q: 'Does Mingla work in Lagos?',
    a: 'Yes. Lagos is one of Mingla’s live markets, alongside London and US cities. The Lagos venues shown on this page are real records from Mingla’s place pool.',
  },
  {
    q: 'Do the venues on this page have events on them?',
    a: 'No. This page shows real Lagos venues — their names, categories, ratings and photos. It deliberately makes no claim about what is happening at any of them, what it costs on a given night, or whether a table is available. Those claims only appear on Mingla when a host has actually published them.',
  },
  {
    q: 'Are the prices real?',
    a: 'The per-venue price bands come from each place’s own record. Any whole-plan total shown in the interactive demo is an illustrative example, labelled as such, and is not a quote or a booking.',
  },
  {
    q: 'Do I need the app?',
    a: 'The full experience — saving plans, sharing them with a group and voting inside them — is in the Mingla app. Public plan and venue links open in a browser so someone can see what you sent them before they install anything.',
  },
  {
    q: 'How does Mingla pick places?',
    a: 'Mingla matches by the kind of evening you described — vibe, occasion, group size and timing — rather than by proximity alone. That is why a plan can include a gallery or a park, not only restaurants.',
  },
] as const

export default function ExplorerLagosPreviewPage() {
  return (
    <>
      <LandingHero
        polarity="night"
        media={<LagosHeroMosaic />}
        eyebrow="Lagos"
        headline={
          <>
            Stop asking the group chat <span className="text-warm">where.</span>
          </>
        }
        lede="Tell Mingla what kind of evening it is. Get back a route through real Lagos places — one link the whole group can open, argue with, and finally agree on."
        actions={
          <>
            <ActionLink href="#plan-lab" variant="primary">
              See how a plan is built
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ActionLink>
            <ActionLink href="#lagos-places" variant="glass">
              Browse the Lagos places
            </ActionLink>
          </>
        }
        footnote={
          <>
            <ProvenanceChip kind="first-party" />
            <span>
              Every photo above is one of {LAGOS_VENUES.length} real Lagos venues in Mingla’s place
              pool. Nothing here is stock or generated.
            </span>
          </>
        }
      />

      <AnswerBlock
        id="answer"
        question="What is there to do in Lagos this weekend?"
        answer="More than the four places you already go to — the problem is not supply, it is that choosing is work and agreeing as a group is harder."
        detail={[
          'Lagos does not have a shortage of places. It has a shortage of decisions. A weekend plan dies somewhere between “we should do something” and “where, though”, and the part that kills it is usually the group chat rather than the city.',
          'Mingla starts one step earlier than a listings site. Instead of asking where you want to go, it asks what kind of evening this is — a slow first date, a group night, a cheap Sunday — and answers with a route: where to start, what to do next, and how it ends.',
          'Below is that system running on real Lagos venues. Names, categories, ratings, review counts and photographs are Mingla’s own records. Anything invented for the sake of the demonstration is labelled where it appears.',
        ]}
        aside={
          <div className="rounded-2xl bg-white/70 p-6 ring-1 ring-inset ring-black/[0.06]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              On this page
            </p>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-text-secondary">
              <li>
                <a href="#plan-lab" className="font-semibold text-warm-ink hover:underline focus-ring">
                  How a Lagos plan is built
                </a>{' '}
                — the real Mingla cards, in three steps.
              </li>
              <li>
                <a
                  href="#lagos-places"
                  className="font-semibold text-warm-ink hover:underline focus-ring"
                >
                  Ten Lagos places
                </a>{' '}
                — sorted by rating and review volume.
              </li>
              <li>
                <a
                  href="#planning"
                  className="font-semibold text-warm-ink hover:underline focus-ring"
                >
                  Six rules for a Lagos night
                </a>{' '}
                — useful whether or not you install anything.
              </li>
            </ul>
          </div>
        }
      />

      <PreviewSection
        polarity="night"
        id="plan-lab"
        aria-label="How a Lagos plan comes together"
      >
        <div className="max-w-2xl">
          <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
            The product, running
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-white md:text-[2.75rem]">
              Three steps, and the night is decided.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-5 text-base leading-relaxed text-white/70 md:text-lg">
              These are the actual Mingla cards, not pictures of them. Change the intent and
              everything downstream changes with it.
            </p>
          </Reveal>
        </div>
        <div className="mt-12">
          <LagosPlanLab />
        </div>
      </PreviewSection>

      <PreviewSection polarity="light" id="lagos-places" aria-label="Lagos places on Mingla">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
          <div className="max-w-xl">
            <Reveal
              as="span"
              className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink"
            >
              Local research
            </Reveal>
            <Reveal>
              <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-text-primary md:text-[2.5rem]">
                One venue per category, and what Lagos thinks of it.
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-text-secondary md:text-[1.0625rem]">
                <p>
                  Mingla organises Lagos by what you can do there, not by cuisine tags. This is the
                  top place in each of ten Mingla categories — nature, icebreakers, drinks, brunch,
                  casual, fine dining, film, theatre, art and play.
                </p>
                <p>
                  Review volume is a blunt instrument, but it answers a real question: which of
                  these does the city already know about, and which is the one your group has not
                  been to. Sort by rating and the answer changes.
                </p>
              </div>
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            <LagosVenueChart />
          </Reveal>
        </div>
      </PreviewSection>

      <PreviewSection polarity="light" aria-label="Planning a night out, before and after Mingla">
        <div className="max-w-2xl">
          <Reveal
            as="span"
            className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink"
          >
            Before / after
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-text-primary md:text-[2.5rem]">
              The same night, planned two ways.
            </h2>
          </Reveal>
        </div>
        <div className="mt-12">
          <BeforeAfter
            polarity="light"
            caption="Planning a night out in Lagos, before and after Mingla"
            beforeLabel="How it goes now"
            afterLabel="With Mingla"
            rows={WORKFLOW}
          />
        </div>
      </PreviewSection>

      <PreviewSection polarity="night" id="planning" aria-label="How to plan a Lagos night out">
        <EducationBlock
          polarity="night"
          eyebrow="Useful either way"
          heading="Six rules for a Lagos night that actually happens."
          lede="None of this requires Mingla. It is how the people whose plans survive contact with a Saturday tend to do it."
          items={EDUCATION}
        />
      </PreviewSection>

      <PreviewSection polarity="light" aria-label="Questions about Mingla in Lagos">
        <FAQBlock
          polarity="light"
          heading="What people ask before they install it."
          items={FAQ}
        />
      </PreviewSection>

      <ConversionBand
        heading={
          <>
            Pick the evening. <span className="text-warm">We’ll handle the where.</span>
          </>
        }
        lede="Get Mingla, describe the kind of night you want, and send the plan to the people you want there."
        action={
          <ActionLink href="/" variant="primary">
            Get the app
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ActionLink>
        }
        afterClick="In this prototype the button returns to the live Explorer page. In production it resolves to the App Store, Play, or a QR panel on desktop — the same device-aware action the site already uses."
      />
    </>
  )
}
