import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'
import {
  AnswerBlock, BreadcrumbSchema, CutoutCard, CutoutFaq, CutoutFooter, CutoutHeading,
  CutoutNav, CutoutSection, CutoutShell, CutReveal, DeviceCta,
  FaqSchema, OnThisPage, PageSchema, type Crumb,
} from '@/components/cutout'
import { CutoutAccordionSwap } from '@/components/cutout/host-sections'
import { EventPagePreview } from '@/components/design-preview/host/event-page-preview'
import { HostSellThroughChart } from '@/components/design-preview/host/host-sellthrough-chart'
import {
  HOST_BUILD, HOST_LIMITS, HOST_MEASURE, HOST_PROMOTE, HOST_WORKFLOW,
} from '@/lib/design-preview/host-truth'

// ---------------------------------------------------------------
// #2902 — SPEC page 20: `/host/event-organizers-promoters`.
//
// This is the LANDING-PAGE CONTRACT. The other thirty pages in the pilot clone
// this file's shape, so its ordering is the deliverable, not its copy:
//
//   1  hero + device-aware action        (the sales moment)
//   2  breadcrumb + ANSWER BLOCK         (the extractable payload — see below)
//   3  product proof, three steps        (SC-07: prove the workflow)
//   4  before / after                    (the commercial argument)
//   5  education                         (useful without signing up)
//   6  limits                            (why the rest is believable)
//   7  FAQ + FAQPage JSON-LD             (answer-engine surface)
//   8  one conversion action
//
// WHY THE ANSWER BLOCK SITS SECOND. Answer engines mostly do not execute
// JavaScript and quote the earliest self-contained answer they can find. A
// 100svh hero is atmosphere; it pushes meaning down the document. Placing a
// server-rendered plain-HTML answer immediately after the hero is the single
// highest-leverage structural decision on the page, and it costs nothing
// visually.
//
// Every section carries a device-aware action per Seth's requirement, all of
// them through the one shared <DeviceCta>.
// ---------------------------------------------------------------

const PATH = '/host/event-organizers-promoters'
const TITLE = 'Promote and sell out your event — Mingla Host for organisers'
const DESCRIPTION =
  'Build an event page, sell tickets at an all-in price, email the people who came last time, scan them in at the door, and export the guest list. Mingla Host for event organisers and promoters.'
/** Real review date. SPEC §7 requires the visible date and the schema to agree. */
const LAST_CHECKED = '2026-09-01'

export const metadata: Metadata = {
  title: `${TITLE} — #2902 Cutout preview`,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
}

const CRUMBS: readonly Crumb[] = [
  { name: 'Mingla', path: '/' },
  { name: 'Host', path: '/host' },
  { name: 'Event organisers & promoters', path: PATH },
]

const EDUCATION = [
  { title: 'Announce before you are ready', body: 'The announce spike is the biggest single day of most sales, and it happens whether or not the flyer is finished. A date, a room and a price out-sell a perfect asset released a week later.' },
  { title: 'Price the tier, not the ticket', body: 'One price gives a buyer one decision. Three tiers give them a better question — which one — and a cheap tier selling out is itself the reason the next person moves.' },
  { title: 'Do not discount the flat middle', body: 'The dead fortnight between announce and the final week is normal, not a signal. Cutting price there mostly refunds people who had already decided to come.' },
  { title: 'Own the list, not the followers', body: 'A platform decides who sees your post. Nobody decides who receives your email. The most valuable output of a night is the list of people who actually came to it.' },
  { title: 'Make the door boring', body: 'A queue forms when one person is the list. Give scanning to more than one person, and give them scanner access only — nobody working the door needs your payouts.' },
  { title: 'Close the loop the next morning', body: 'Who bought, who came, and which tier carried the final week are three different numbers. Write them down while you still remember the room.' },
]

const FAQ = [
  { q: 'How do I promote an event and sell tickets in one place?', a: 'Mingla Host gives you an event page, ticket tiers with their own sale windows, an all-in checkout, email campaigns to your own imported contacts, a door scanner, and a CSV export of who attended. That is the whole loop in one product rather than five.' },
  { q: 'Can I sell tickets in Nigeria?', a: 'Yes — card payments run in your market with the full price shown before purchase. SMS campaigns are not yet enabled in Nigeria, so Lagos organisers use email campaigns and the in-app guest list.' },
  { q: 'What happens if a tier has already sold?', a: 'It becomes edit-locked. A tier that has taken money cannot have its price or window changed underneath a buyer, which is a deliberate protection rather than a missing feature.' },
  { q: 'Can my door staff check people in without seeing my account?', a: 'Yes. Door staff are invited to the scanner specifically. They can check attendees in without reaching your payouts, campaigns or the rest of your Host account.' },
  { q: 'Do I keep the guest list?', a: 'Yes, and it exports to CSV. The point of running a night on Mingla is that it produces a contactable audience you own, not a number on a dashboard you rent.' },
  { q: 'Will Mingla find an audience for me?', a: 'Publishing makes your event eligible to be matched to Explorers browsing by vibe, place and timing. That is eligibility, not a guaranteed placement, and we do not sell it as one.' },
]

export default function EventOrganisersLandingPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/cutout/host" />

      {/* 1 — HERO */}
      <CutoutSection
        rhythm="hero"
        aria-label={TITLE}
        className="flex min-h-[calc(100svh-1rem)] flex-col justify-center pb-10 pt-28 sm:pt-32"
      >
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
          <div>
            <CutReveal variant="headline">
              <h1 className="max-w-[15ch] font-display text-[clamp(2.5rem,5.6vw,4.5rem)] leading-[1.0] tracking-[-0.035em] text-[var(--cut-ink)]">
                Your event deserves better than{' '}
                <span className="text-[var(--cut-accent)]">a ticket link.</span>
              </h1>
            </CutReveal>
            <CutReveal delay={0.14}>
              <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)] sm:text-lg">
                A flyer says what is happening. Mingla says why it matters, sells the night at one
                honest price, and hands you the door and the guest list when it is over.
              </p>
            </CutReveal>
            <CutReveal delay={0.22}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <DeviceCta surface="host" location="hero" variant="primary" size="lg" />
                <a
                  href="#answer"
                  className="inline-flex h-14 items-center rounded-full bg-[var(--cut-card)] px-7 font-display text-base font-medium text-[var(--cut-ink)] shadow-[var(--cut-shadow-card)] transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:shadow-[var(--cut-shadow-card-hover)] focus-ring"
                >
                  How it works
                </a>
              </div>
            </CutReveal>
          </div>
          <CutReveal variant="lift" delay={0.18}>
            {/* The replica is ~950px tall. Unconstrained it set the grid row
                height and pushed the headline into the lower half of the
                viewport, leaving a dead top third. Capped and faded, it reads
                as a page continuing past the fold, which is what it is. */}
            <div
              className="relative mx-auto hidden max-h-[34rem] justify-center overflow-hidden lg:flex"
              style={{
                maskImage: 'linear-gradient(180deg, #000 78%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(180deg, #000 78%, transparent 100%)',
              }}
            >
              <EventPagePreview />
            </div>
          </CutReveal>
        </div>
      </CutoutSection>

      {/* 2 — THE ANSWER. Server-rendered, plain HTML, second in the document. */}
      <AnswerBlock
        crumbs={CRUMBS}
        lastChecked="1 September 2026"
        question="How do I promote an event and sell tickets without five different tools?"
        answer="You need four things in one place: a page a buyer can open, a checkout that shows the real total, a way to reach people who already came, and a door that does not depend on one person holding a printed list. Mingla Host is those four things."
        detail={[
          'Most organisers assemble this out of a link-in-bio, a ticketing site, a design tool, a mailing list and a spreadsheet. It works, and it costs a weekend of admin per event plus a service fee your buyer meets at the worst possible moment — the checkout.',
          'On Mingla the same loop is one flow: describe the night, publish the page, sell at an all-in price, import the contacts you already have, scan people in, and export who came. Everything below is that flow, with the file in Mingla’s source that proves each step ships.',
        ]}
        aside={
          <OnThisPage
            links={[
              { href: '#workflow', label: 'Build, promote, run', note: 'the three steps, with the real event page.' },
              { href: '#sale', label: 'How a ticketed sale moves', note: 'and why the flat middle is normal.' },
              { href: '#limits', label: 'What Mingla does not do', note: 'the three limits you would hit in week one.' },
              { href: '#faq', label: 'Questions', note: 'tickets in Nigeria, door staff, guest lists.' },
            ]}
          />
        }
      />

      {/* 3 — PRODUCT PROOF */}
      <CutoutSection id="workflow" band="dark" aria-label="How an event runs on Mingla">
        <CutReveal>
          <CutoutHeading
            eyebrow="The product, running"
            lede="Pick a step. Nothing advances on its own."
            action={<DeviceCta surface="host" location="workflow" variant="primary" size="md" />}
          >
            Announce on Monday. <span className="text-[var(--cut-accent)]">Work the door on Saturday.</span>
          </CutoutHeading>
        </CutReveal>
        <div className="mt-14">
          <CutoutAccordionSwap
            label="How an event runs on Mingla"
            steps={[
              { id: 'build', label: 'Build it', caption: 'Describe the night in a sentence. Ari turns it into a page with tiers, and the page is what a buyer opens.', items: HOST_BUILD, panel: <div className="flex justify-center"><EventPagePreview /></div> },
              { id: 'promote', label: 'Promote it', caption: 'The people most likely to come are the ones who came last time. Bring that list with you, then reach past it.', items: HOST_PROMOTE, panel: <div className="flex justify-center"><EventPagePreview bare /></div> },
              { id: 'run', label: 'Run it', caption: 'Take the money, work the door, and finish with a list you keep rather than a number you screenshot.', items: HOST_MEASURE, panel: <HostSellThroughChart /> },
            ]}
          />
        </div>
      </CutoutSection>

      {/* 4 — BEFORE / AFTER. A real <table> so it is readable by a screen reader
             and quotable by an answer engine, restyled into paired rows. */}
      <CutoutSection id="sale" aria-label="Running an event, before and after Mingla">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Before / after"
              lede="The same event, run two ways."
              action={<DeviceCta surface="host" location="before_after" variant="quiet" size="md" />}>
              Five products, <span className="text-[var(--cut-accent)]">or one.</span>
            </CutoutHeading>
          </CutReveal>
          <CutReveal delay={0.08}>
            <CutoutCard pad="md">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Running a ticketed event, before and after Mingla</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pb-3 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">The job</th>
                    <th scope="col" className="pb-3 pl-4 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">Today</th>
                    <th scope="col" className="pb-3 pl-4 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-accent-ink)]">On Mingla</th>
                  </tr>
                </thead>
                <tbody>
                  {HOST_WORKFLOW.map((row) => (
                    <tr key={row.job} className="border-t" style={{ borderColor: 'var(--cut-hairline)' }}>
                      <th scope="row" className="w-[22%] py-4 pr-3 align-top font-display text-[0.9375rem] leading-tight text-[var(--cut-ink)]">{row.job}</th>
                      <td className="w-[39%] py-4 pl-4 align-top text-[0.875rem] leading-relaxed text-[var(--cut-muted)]">{row.before}</td>
                      <td className="w-[39%] py-4 pl-4 align-top text-[0.875rem] font-medium leading-relaxed text-[var(--cut-ink)]">{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CutoutCard>
          </CutReveal>
        </div>
      </CutoutSection>

      {/* 5 — EDUCATION. Useful whether or not anyone signs up. */}
      <CutoutSection aria-label="How to sell out an event">
        <CutReveal>
          <CutoutHeading eyebrow="Useful either way"
            lede="None of this requires Mingla. It is what separates the organisers whose second event outsells their first.">
            Six things that decide <span className="text-[var(--cut-accent)]">whether a night sells.</span>
          </CutoutHeading>
        </CutReveal>
        <ol className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {EDUCATION.map((item, i) => (
            <CutReveal key={item.title} as="li" variant="lift" delay={i * 0.07}>
              <CutoutCard pad="md" className="h-full">
                <span aria-hidden="true" className="font-display text-[1.75rem] leading-none tabular-nums text-[var(--cut-accent)] opacity-45">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 font-display text-[1.0625rem] leading-tight text-[var(--cut-ink)]">{item.title}</h3>
                <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{item.body}</p>
              </CutoutCard>
            </CutReveal>
          ))}
        </ol>
        <CutReveal delay={0.2}>
          <div className="mt-12 flex justify-center">
            <DeviceCta surface="host" location="education" variant="primary" size="lg" />
          </div>
        </CutReveal>
      </CutoutSection>

      {/* 6 — LIMITS */}
      <CutoutSection id="limits" band="dark" rhythm="tight" aria-label="What Mingla does not do">
        <CutReveal>
          <CutoutCard pad="lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-[var(--cut-accent)]" aria-hidden="true" />
              <div>
                <h2 className="font-display text-[1.5rem] leading-tight tracking-[-0.02em] text-[var(--cut-ink)] sm:text-3xl">
                  Three things Mingla does not do.
                </h2>
                <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">
                  You would find each of these in your first week. Better here than there.
                </p>
              </div>
            </div>
            <dl className="mt-8 grid gap-8 md:grid-cols-3">
              {HOST_LIMITS.map((limit) => (
                <div key={limit.title}>
                  <dt className="font-display text-[1.0625rem] leading-tight text-[var(--cut-ink)]">{limit.title}</dt>
                  <dd className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{limit.body}</dd>
                </div>
              ))}
            </dl>
          </CutoutCard>
        </CutReveal>
      </CutoutSection>

      {/* 7 — FAQ */}
      <CutoutSection id="faq" aria-label="Questions from organisers">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Questions"
              action={<DeviceCta surface="host" location="faq" variant="quiet" size="md" />}>
              What organisers ask first.
            </CutoutHeading>
          </CutReveal>
          <CutReveal delay={0.08}><CutoutFaq items={FAQ} /></CutReveal>
        </div>
      </CutoutSection>

      {/* 8 — CONVERSION */}
      <CutoutSection band="dark" aria-label="Get started with Mingla Host">
        <CutReveal variant="lift">
          <div className="flex flex-col items-center text-center">
            <CutoutHeading align="center"
              lede="Build the page, set the tiers, and have something a buyer can open — before you finish the flyer.">
              Put your next night <span className="text-[var(--cut-accent)]">on Mingla.</span>
            </CutoutHeading>
            <div className="mt-9"><DeviceCta surface="host" location="cta" variant="primary" size="lg" /></div>
          </div>
        </CutReveal>
      </CutoutSection>

      <CutoutFooter surface="host" />

      <BreadcrumbSchema crumbs={CRUMBS} />
      <FaqSchema items={FAQ} />
      <PageSchema path={PATH} name={TITLE} description={DESCRIPTION} dateModified={LAST_CHECKED} />
    </CutoutShell>
  )
}
