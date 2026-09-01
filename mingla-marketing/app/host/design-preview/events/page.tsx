import type { Metadata } from 'next'
import { AlertTriangle, ArrowRight } from 'lucide-react'
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
import { HostWorkflowLab } from '@/components/design-preview/host/host-workflow-lab'
import { HostSellThroughChart } from '@/components/design-preview/host/host-sellthrough-chart'
import { HOST_LIMITS, HOST_WORKFLOW } from '@/lib/design-preview/host-truth'

// #2902 DESIGN PREVIEW — Host / event organisers and promoters. Review-only.
// Never indexed, never linked from the live site, and it does not replace
// `/host`.

export const metadata: Metadata = {
  title: 'Host · Event organisers — #2902 design preview',
  description:
    'Review-only coded prototype of the Mingla Host landing system for event organisers and promoters.',
  robots: { index: false, follow: false },
}

const EDUCATION = [
  {
    title: 'Announce before you are ready',
    body: 'The announce spike is the biggest single day of most sales, and it happens whether or not the flyer is finished. A date, a room and a price will out-sell a perfect asset released a week later.',
  },
  {
    title: 'Price the tier, not the ticket',
    body: 'One price gives a buyer one decision: yes or no. Three tiers give them a different question — which one — and the cheapest tier selling out is itself a reason for the next person to move.',
  },
  {
    title: 'Do not discount the flat middle',
    body: 'The dead fortnight between announce and the final week is normal, not a signal. Cutting price there mostly refunds the people who already decided to come.',
  },
  {
    title: 'Own the list, not the followers',
    body: 'A platform decides who sees your post. Nobody decides who receives your email. The single most valuable output of a night is the list of people who actually came to it.',
  },
  {
    title: 'Make the door boring',
    body: 'A queue forms when one person is the list. Give scanning to more than one person, and give them scanner access only — nobody working the door needs your payouts.',
  },
  {
    title: 'Close the loop the next morning',
    body: 'Who bought, who came, and which tier carried the week are three different numbers. Write them down while you remember the room, then run the next one against them.',
  },
] as const

const FAQ = [
  {
    q: 'What does Mingla do for an event organiser?',
    a: 'It gives you one place to build an event page, sell tickets at an all-in price, reach your own contact list by email, check people in at the door, and export who actually came. It is a way to run the event, not just a listing where it appears.',
  },
  {
    q: 'What does it cost?',
    a: 'Pricing is not stated on this prototype because it is a design review, not a commercial page. The production version must carry real, current pricing or it should not carry a pricing claim at all.',
  },
  {
    q: 'Can I use my own venue and my own branding?',
    a: 'Yes — the event page is yours, with your cover, your copy and your tiers. What Mingla does not give you is a hosted website on your own domain; that is a different product decision.',
  },
  {
    q: 'Will Mingla promote my event for me?',
    a: 'Publishing makes your event eligible to be matched to Explorers browsing by vibe, place and timing. That is eligibility, not a guaranteed placement, and we will not describe it as one.',
  },
  {
    q: 'Can I send text blasts?',
    a: 'Email campaigns run in every market. SMS is live in our US and UK markets and is not yet enabled in Nigeria, so Lagos organisers use email and the in-app guest list for now.',
  },
  {
    q: 'What happens to my guest list?',
    a: 'It stays yours. The list exports to CSV, so a night produces a contactable audience you keep rather than a metric on a dashboard you rent.',
  },
] as const

export default function HostEventsPreviewPage() {
  return (
    <>
      <LandingHero
        polarity="parchment"
        media={
          <video
            aria-hidden="true"
            tabIndex={-1}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/marketing/host-hero/world-hosts-create-poster.jpg"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
          >
            <source
              src="/marketing/host-hero/world-hosts-create-preview.mp4"
              type="video/mp4"
            />
          </video>
        }
        eyebrow="For event organisers and promoters"
        headline={
          <>
            Sell the night. <span className="text-warm-ink">Then run it.</span>
          </>
        }
        lede="Build the page, price the tiers, email the people who came last time, work the door, and finish the night with a guest list you keep. One product, from announce to doors."
        actions={
          <>
            <ActionLink href="#workflow" variant="primary">
              See it run
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ActionLink>
            <ActionLink href="#limits" variant="glass">
              What it does not do
            </ActionLink>
          </>
        }
        footnote={
          <>
            <ProvenanceChip kind="product-capability" />
            <span>
              Every capability on this page names the file in Mingla’s source that proves it ships.
            </span>
          </>
        }
      />

      <AnswerBlock
        id="answer"
        question="How do I sell tickets and run the door for my own event?"
        answer="You need four things in one place: a page a buyer can open, a checkout that shows the real total, a way to reach people who already came, and a door that does not depend on one person with a printed list. Mingla is those four things."
        detail={[
          'Most organisers assemble this out of five products — a link-in-bio, a ticketing site, a design tool, a mailing list and a spreadsheet. It works, and it costs a weekend of admin per event plus a service fee your buyer meets at the worst possible moment.',
          'Mingla Host collapses that into one flow: describe the night, publish the page, sell at an all-in price, import the contacts you already have, scan people in, and export who came. The section below is that flow running, step by step.',
          'Where a figure in this page is invented for the sake of the demonstration, it says so in the panel. Where a capability is claimed, the file that implements it is printed underneath.',
        ]}
        aside={
          <div className="rounded-2xl bg-white/70 p-6 ring-1 ring-inset ring-black/[0.06]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              On this page
            </p>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-text-secondary">
              <li>
                <a href="#workflow" className="font-semibold text-warm-ink hover:underline focus-ring">
                  Build, promote, run
                </a>{' '}
                — the three steps, with the real event page.
              </li>
              <li>
                <a href="#sale" className="font-semibold text-warm-ink hover:underline focus-ring">
                  How a ticketed sale moves
                </a>{' '}
                — and why the flat middle is normal.
              </li>
              <li>
                <a href="#limits" className="font-semibold text-warm-ink hover:underline focus-ring">
                  What Mingla does not do
                </a>{' '}
                — the three limits you would hit in week one.
              </li>
            </ul>
          </div>
        }
      />

      <PreviewSection polarity="night" id="workflow" aria-label="How an event runs on Mingla">
        <div className="max-w-2xl">
          <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
            The product, running
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-white md:text-[2.75rem]">
              Announce on Monday. Work the door on Saturday.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-5 text-base leading-relaxed text-white/70 md:text-lg">
              Three steps, each one a thing you actually have to do. Pick a step — nothing advances
              on its own.
            </p>
          </Reveal>
        </div>
        <div className="mt-12">
          <HostWorkflowLab />
        </div>
      </PreviewSection>

      <PreviewSection polarity="light" id="sale" aria-label="How a ticketed sale moves">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
          <div className="max-w-xl">
            <Reveal
              as="span"
              className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink"
            >
              Reading a sale
            </Reveal>
            <Reveal>
              <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-text-primary md:text-[2.5rem]">
                Your sale is not dying. It is doing what sales do.
              </h2>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-text-secondary md:text-[1.0625rem]">
                <p>
                  Tickets sell in two bursts — the announce, and the last few days — with a long,
                  quiet middle that every organiser reads as failure. It is the single most common
                  reason a good night gets discounted for no reason.
                </p>
                <p>
                  The panel is an illustration, not a benchmark: the numbers are invented and
                  labelled as such. What it demonstrates is the shape, and which tier is carrying
                  the final week — the thing worth knowing before you touch a price.
                </p>
              </div>
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            <HostSellThroughChart />
          </Reveal>
        </div>
      </PreviewSection>

      <PreviewSection polarity="light" aria-label="Running an event, before and after Mingla">
        <div className="max-w-2xl">
          <Reveal
            as="span"
            className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink"
          >
            Before / after
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-text-primary md:text-[2.5rem]">
              The same event, run two ways.
            </h2>
          </Reveal>
        </div>
        <div className="mt-12">
          <BeforeAfter
            polarity="light"
            caption="Running a ticketed event, before and after Mingla"
            beforeLabel="The five-product stack"
            afterLabel="On Mingla"
            rows={HOST_WORKFLOW}
          />
        </div>
      </PreviewSection>

      <PreviewSection polarity="light" id="limits" compact aria-label="What Mingla does not do">
        <div className="rounded-2xl border border-black/[0.08] bg-white/60 p-7 md:p-10">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-1 h-5 w-5 shrink-0 text-[var(--color-warning)]"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-display text-2xl leading-tight tracking-[-0.015em] text-text-primary md:text-3xl">
                Three things Mingla does not do.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
                You would find each of these in your first week. Better here than there.
              </p>
            </div>
          </div>
          <dl className="mt-8 grid gap-8 md:grid-cols-3">
            {HOST_LIMITS.map((limit) => (
              <div key={limit.title}>
                <dt className="font-display text-lg leading-tight text-text-primary">
                  {limit.title}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-text-secondary">{limit.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PreviewSection>

      <PreviewSection polarity="night" aria-label="How to sell out an event">
        <EducationBlock
          polarity="night"
          eyebrow="Useful either way"
          heading="Six things that decide whether a night sells."
          lede="None of this requires Mingla. It is what separates the organisers whose second event outsells their first."
          items={EDUCATION}
        />
      </PreviewSection>

      <PreviewSection polarity="light" aria-label="Questions from organisers">
        <FAQBlock polarity="light" heading="What organisers ask first." items={FAQ} />
      </PreviewSection>

      <ConversionBand
        heading={
          <>
            Put your next night <span className="text-warm">on Mingla.</span>
          </>
        }
        lede="Build the page, set the tiers, and have something a buyer can open — before you finish the flyer."
        action={
          <ActionLink href="/host" variant="primary">
            Start with Mingla Host
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ActionLink>
        }
        afterClick="In this prototype the button returns to the live Host page. In production it resolves to the Download / Use-on-web choice the Host nav already presents."
      />
    </>
  )
}
