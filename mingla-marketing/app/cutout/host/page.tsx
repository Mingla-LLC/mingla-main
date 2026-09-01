import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BadgeCheck, CalendarCheck, CreditCard, Megaphone, QrCode, Users,
} from 'lucide-react'
import {
  CutoutCard, CutoutEyebrow, CutoutFaq, CutoutFooter, CutoutHeading, CutoutMedia,
  CutoutNav, CutoutSection, CutoutShell, CutoutTile, CutReveal,
  DeviceCta, FaqSchema,
} from '@/components/cutout'
import { CutoutAccordionSwap, CutoutFeatureHub } from '@/components/cutout/host-sections'
import { EventPagePreview } from '@/components/design-preview/host/event-page-preview'
import { HostSellThroughChart } from '@/components/design-preview/host/host-sellthrough-chart'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'
import {
  HOST_BUILD, HOST_LIMITS, HOST_MEASURE, HOST_PROMOTE,
} from '@/lib/design-preview/host-truth'

// #2902 — HOST home on AIgocy's narrative arc.
//
// Seth's ruling: the Host site takes AIgocy's STRUCTURE and STORY NARRATION;
// the copy and media stay Mingla's. Where AIgocy's arc needs content Mingla
// cannot honestly supply, the slot keeps its rhythm and changes its content
// type — his "substitute truthful equivalents" ruling. Each substitution is
// annotated below so the mapping is auditable rather than silent.

export const metadata: Metadata = {
  title: 'Mingla Host — #2902 Cutout preview',
  description: 'Review-only Cutout skin of the Mingla Host home page.',
  robots: { index: false, follow: false },
}

/** AIgocy §partner-logos → the seven ICPs we actually serve. No fake clients. */
const ICPS = [
  { slug: 'event-organizers-promoters', label: 'Event organisers & promoters' },
  { slug: 'restaurants-cafes', label: 'Restaurants & cafés' },
  { slug: 'bars-clubs-nightlife', label: 'Bars, clubs & nightlife' },
  { slug: 'venues-activity-spaces', label: 'Venues & activity spaces' },
  { slug: 'resorts-hotels-retreats', label: 'Resorts, hotels & retreats' },
  { slug: 'tours-experiences-adventures', label: 'Tours & experiences' },
  { slug: 'pop-ups-independent-creators', label: 'Pop-ups & creators' },
] as const

/** AIgocy §about-counter → facts that are verifiable, not invented metrics. */
const FACTS = [
  { value: 'Lagos, London, US', label: 'Markets Mingla is live in today' },
  { value: 'iOS + Android', label: 'Both Host apps published on both stores' },
  { value: 'Card + transfer', label: 'Payments in your market, all-in at checkout' },
] as const

const FEATURES = [
  { title: 'Build with Ari', body: 'Describe the night in a sentence; Ari turns it into a page with tiers and the marketing around it.', icon: <BadgeCheck className="h-5 w-5" /> },
  { title: 'Sell at one price', body: 'Buyers see a single fees-and-tax line and the real total before they pay.', icon: <CreditCard className="h-5 w-5" /> },
  { title: 'Bring your own list', body: 'Import contacts from CSV or your phone book and reach the people who already came.', icon: <Users className="h-5 w-5" /> },
  { title: 'Campaigns that track', body: 'Email sends from Mingla with per-recipient click tracking and a working unsubscribe.', icon: <Megaphone className="h-5 w-5" /> },
  { title: 'Run the door', body: 'Invite door staff to a scanner only — they check people in without reaching your account.', icon: <QrCode className="h-5 w-5" /> },
  { title: 'Keep the guest list', body: 'Export who actually came to CSV. The night produces a list you own, not a screenshot.', icon: <CalendarCheck className="h-5 w-5" /> },
]

const FAQ = [
  { q: 'What does Mingla Host actually do?', a: 'It is one place to build an experience page, sell tickets or take bookings at an all-in price, reach your own contact list by email, check people in at the door, and export who came. It is a way to run the thing, not only a listing where it appears.' },
  { q: 'What does it cost?', a: 'Pricing is not published on this prototype because it is a design review rather than a commercial page. The production version carries real current pricing or it carries no pricing claim at all.' },
  { q: 'Will Mingla promote my event for me?', a: 'Publishing makes your experience eligible to be matched to Explorers browsing by vibe, place and timing. That is eligibility, not a guaranteed placement, and we will not describe it as one.' },
  { q: 'Can I use my own branding?', a: 'Yes — the page is yours, with your cover, your copy and your tiers. What Mingla does not give you is a hosted website on your own domain; that is a separate product decision.' },
  { q: 'Which markets is this live in?', a: 'Lagos, London and US cities. SMS campaigns run in the US and UK only; Nigerian Hosts use email campaigns and the in-app guest list until the local SMS route is enabled.' },
  { q: 'What happens to my guest list?', a: 'It stays yours and exports to CSV, so a night produces a contactable audience you keep rather than a metric on a dashboard you rent.' },
]

export default function CutoutHostPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/cutout/host" />

      {/* 1 — HERO. AIgocy §section-hero. */}
      <CutoutSection
        rhythm="hero"
        aria-label="Mingla Host"
        className="flex min-h-[calc(100svh-1rem)] flex-col justify-center pb-10 pt-28 sm:pt-32"
      >
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
          <div>
            <CutReveal><CutoutEyebrow>Mingla Host</CutoutEyebrow></CutReveal>
            <CutReveal variant="headline" delay={0.06}>
              <h1 className="mt-5 max-w-[14ch] font-display text-[clamp(2.75rem,6vw,4.75rem)] leading-[1.0] tracking-[-0.035em] text-[var(--cut-ink)]">
                Sell the night. <span className="text-[var(--cut-accent)]">Then run it.</span>
              </h1>
            </CutReveal>
            <CutReveal delay={0.16}>
              <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--cut-body)] sm:text-lg">
                Build the page, price the tiers, email the people who came last time, work the
                door, and finish with a guest list you keep. One product, from announce to doors.
              </p>
            </CutReveal>
            <CutReveal delay={0.24}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <DeviceCta surface="host" location="hero" variant="primary" size="lg" />
                <a
                  href="#workflow"
                  className="inline-flex h-14 items-center rounded-full bg-[var(--cut-card)] px-7 font-display text-base font-medium text-[var(--cut-ink)] shadow-[var(--cut-shadow-card)] transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:shadow-[var(--cut-shadow-card-hover)] focus-ring"
                >
                  See it run
                </a>
              </div>
            </CutReveal>
            <CutReveal delay={0.32}>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <ProvenanceChip kind="product-capability" />
                <span className="text-[0.8125rem] text-[var(--cut-muted)]">
                  Every capability names the file in Mingla’s source that proves it ships.
                </span>
              </div>
            </CutReveal>
          </div>

          <CutReveal variant="lift" delay={0.2}>
            <CutoutCard pad="sm" className="mx-auto max-w-[26rem]">
              <CutoutMedia ratio="wide">
                <video
                  aria-hidden="true" tabIndex={-1} autoPlay muted loop playsInline
                  preload="metadata"
                  poster="/marketing/host-hero/world-hosts-create-poster.jpg"
                  className="absolute inset-0 h-full w-full object-cover"
                >
                  <source src="/marketing/host-hero/world-hosts-create-preview.mp4" type="video/mp4" />
                </video>
              </CutoutMedia>
              <div className="grid grid-cols-3 gap-2 px-1 pb-1 pt-4">
                {FACTS.map((f) => (
                  <div key={f.label}>
                    <p className="font-display text-[0.9375rem] leading-tight text-[var(--cut-ink)]">{f.value}</p>
                    <p className="mt-1 text-[0.6875rem] leading-snug text-[var(--cut-muted)]">{f.label}</p>
                  </div>
                ))}
              </div>
            </CutoutCard>
          </CutReveal>
        </div>
      </CutoutSection>

      {/* 2 — ICP STRIP. AIgocy §section-partner (client logos) → the operators we
             serve. Fake customer logos are forbidden; these are real internal
             links and they build the crawl graph the 31-page pilot needs. */}
      <CutoutSection rhythm="tight" aria-label="Who Mingla Host is for">
        <CutReveal>
          <p className="text-center text-[0.8125rem] font-semibold text-[var(--cut-muted)]">
            Built for the people who make a city worth going out in
          </p>
        </CutReveal>
        <ul className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {ICPS.map((icp, i) => (
            <CutReveal key={icp.slug} as="li" variant="rise" delay={i * 0.05}>
              <Link
                href={`/cutout/host/${icp.slug}`}
                className="inline-flex rounded-full bg-[var(--cut-card)] px-4 py-2.5 text-[0.875rem] font-medium text-[var(--cut-body)] shadow-[var(--cut-shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:text-[var(--cut-ink)] hover:shadow-[var(--cut-shadow-card-hover)] focus-ring"
              >
                {icp.label}
              </Link>
            </CutReveal>
          ))}
        </ul>
      </CutoutSection>

      {/* 3 — SERVICES ACCORDION + SWAPPING PANEL. AIgocy §section-services. */}
      <CutoutSection id="workflow" aria-label="How an event runs on Mingla">
        <CutReveal>
          <CutoutHeading
            eyebrow="The product, running"
            lede="Three steps, each one a thing you actually have to do. Pick a step — nothing advances on its own."
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
              { id: 'run', label: 'Run it', caption: 'Take the money, work the door, and finish the night with a list you keep rather than a number you screenshot.', items: HOST_MEASURE, panel: <HostSellThroughChart /> },
            ]}
          />
        </div>
      </CutoutSection>

      {/* 4 — FEATURE HUB. AIgocy §section-features, its signature layout. */}
      <CutoutSection band="dark" aria-label="What you get">
        <CutReveal>
          <CutoutHeading align="center" eyebrow="All of it in one place"
            lede="Six things an organiser otherwise assembles out of five different products.">
            Everything between <span className="text-[var(--cut-accent)]">an idea and a full room.</span>
          </CutoutHeading>
        </CutReveal>
        <div className="mt-16">
          <CutoutFeatureHub centreLabel="Mingla Host" features={FEATURES} />
        </div>
      </CutoutSection>

      {/* 5 — LIMITS. AIgocy §section-awards / §statistic (a 99% claim) → the
             honest inverse. We cannot substantiate an award or a headline
             percentage; we can substantiate what the product does not do. */}
      <CutoutSection aria-label="What Mingla does not do">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Straight answers"
              lede="You would find each of these in your first week. Better here than there.">
              Three things Mingla <span className="text-[var(--cut-accent)]">does not do.</span>
            </CutoutHeading>
          </CutReveal>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {HOST_LIMITS.map((limit, i) => (
              <CutReveal key={limit.title} variant="lift" delay={i * 0.08}>
                <CutoutCard pad="md" className="h-full">
                  <h3 className="font-display text-[1.0625rem] leading-tight text-[var(--cut-ink)]">{limit.title}</h3>
                  <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{limit.body}</p>
                </CutoutCard>
              </CutReveal>
            ))}
          </div>
        </div>
      </CutoutSection>

      {/* 6 — FAQ. AIgocy §section-faqs. */}
      <CutoutSection aria-label="Questions from organisers">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Questions">What organisers ask first.</CutoutHeading>
          </CutReveal>
          <CutReveal delay={0.08}><CutoutFaq items={FAQ} /></CutReveal>
        </div>
        <FaqSchema items={FAQ} />
      </CutoutSection>

      {/* 7 — CONVERSION. AIgocy §"Let's Build Intelligent Things". */}
      <CutoutSection band="dark" aria-label="Get started with Mingla Host">
        <CutReveal variant="lift">
          <div className="flex flex-col items-center text-center">
            <CutoutHeading align="center" as="h2"
              lede="Build the page, set the tiers, and have something a buyer can open — before you finish the flyer.">
              Put your next night <span className="text-[var(--cut-accent)]">on Mingla.</span>
            </CutoutHeading>
            <div className="mt-9"><DeviceCta surface="host" location="cta" variant="primary" size="lg" /></div>
          </div>
        </CutReveal>
      </CutoutSection>

      <CutoutFooter surface="host" />
    </CutoutShell>
  )
}
