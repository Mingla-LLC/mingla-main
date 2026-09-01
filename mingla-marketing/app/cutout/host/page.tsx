import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BarChart3, CalendarCheck, CreditCard, Globe, Mail, MapPin,
  Megaphone, Search, Sparkles, Users,
} from 'lucide-react'
import {
  CutoutCard, CutoutFaq, CutoutFooter, CutoutHeading, CutoutHero, CutoutNav,
  CutoutSection, CutoutShell, CutReveal, DeviceCta, FaqSchema,
  STEP_CHARTS, StepSwitcher, ToolCard,
} from '@/components/cutout'
import {
  ALL_TOOLS, HOST_LIMITS, HOST_STEPS, HOST_SWAP,
} from '@/lib/design-preview/host-tools'

// #2902 — Mingla Host, on AIgocy's design, telling Seth's story:
// "Mingla gives you all the tools to be a successful host."
//
// Copy rule: succinct, clear, punchy. Design rule: intentional — every element
// earns its place. Nothing decorative was added to fill space.

export const metadata: Metadata = {
  title: 'Mingla Host — #2902 Cutout preview',
  description: 'Review-only Cutout skin of the Mingla Host home page.',
  robots: { index: false, follow: false },
}

const ICONS: Record<string, React.ReactNode> = {
  site: <Globe className="h-5 w-5" />,
  host: <Sparkles className="h-5 w-5" />,
  venue: <MapPin className="h-5 w-5" />,
  orders: <CreditCard className="h-5 w-5" />,
  reservations: <CalendarCheck className="h-5 w-5" />,
  discovery: <Search className="h-5 w-5" />,
  email: <Mail className="h-5 w-5" />,
  sms: <Megaphone className="h-5 w-5" />,
  ads: <BarChart3 className="h-5 w-5" />,
  crm: <Users className="h-5 w-5" />,
}

const ICPS = [
  { slug: 'event-organizers-promoters', label: 'Events & promoters' },
  { slug: 'restaurants-cafes', label: 'Restaurants & cafés' },
  { slug: 'bars-clubs-nightlife', label: 'Bars & nightlife' },
  { slug: 'venues-activity-spaces', label: 'Venues & spaces' },
  { slug: 'resorts-hotels-retreats', label: 'Resorts & hotels' },
  { slug: 'tours-experiences-adventures', label: 'Tours & experiences' },
  { slug: 'pop-ups-independent-creators', label: 'Pop-ups & creators' },
]

const FAQ = [
  { q: 'What is Mingla Host?', a: 'Every tool you need to run a hospitality business: a website, listings for events, trips, experiences and stays, orders and reservations, and the marketing to fill them.' },
  { q: 'How fast is the website?', a: 'Seconds. Describe your business to Ari and it writes, designs and publishes the site.' },
  { q: 'What can I sell?', a: 'Tickets, tables, bookings, deposits and stays — all at one all-in price, so buyers see the real total before they pay.' },
  { q: 'How do people find me?', a: 'Explorers browse by vibe, place and timing. Publishing makes you eligible to be matched to them, not just found by name.' },
  { q: 'Which marketing is included?', a: 'Email, SMS, paid advertising and a CRM that turns guests into contacts you own. SMS is live in the US and UK.' },
  { q: 'What does it cost?', a: 'Not published on this prototype. The production page carries real pricing or none at all.' },
]

export default function CutoutHostPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/cutout/host" />

      <CutoutHero
        eyebrow="Mingla Host"
        line1="Everything a"
        line2={<span className="cut-gradient-brand">host needs.</span>}
        lede="A website in seconds. Bookings that fill. Marketing that brings them back."
        image="/marketing/host-hero/world-hosts-create-poster.jpg"
        video="/marketing/host-hero/world-hosts-create-preview.mp4"
        scrollTo="#tools"
        action={<DeviceCta surface="host" location="hero" variant="primary" size="lg" />}
      />

      {/* Who it is for. One line of chips — real links, no decoration. */}
      <CutoutSection rhythm="tight" aria-label="Who Mingla Host is for">
        <CutReveal>
          <p className="text-center text-[0.9375rem] font-semibold text-[var(--cut-muted)]">
            Built for the people who make a city worth going out in
          </p>
        </CutReveal>
        <ul className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {ICPS.map((icp, i) => (
            <CutReveal key={icp.slug} as="li" delay={i * 0.04}>
              <Link
                href={`/cutout/host/${icp.slug}`}
                className="cut-btn-light inline-flex rounded-full px-5 py-2.5 text-[0.875rem] font-semibold text-[var(--cut-body)] transition-colors hover:text-[var(--cut-ink)] focus-ring"
              >
                {icp.label}
              </Link>
            </CutReveal>
          ))}
        </ul>
      </CutoutSection>

      {/* The story: build, sell, grow. */}
      <CutoutSection id="tools" aria-label="Build, sell and grow with Mingla">
        <CutReveal>
          <CutoutHeading align="center" eyebrow="Build. Sell. Grow."
            lede="Ten tools. One app. No agency, no stack, no weekend of admin.">
            Everything between an idea and a <span className="cut-gradient-brand">full room.</span>
          </CutoutHeading>
        </CutReveal>
        <div className="mt-14">
          <StepSwitcher steps={HOST_STEPS} icons={ICONS} charts={STEP_CHARTS} label="Build, sell or grow" />
        </div>
      </CutoutSection>

      {/* The whole set at once. */}
      <CutoutSection band="dark" aria-label="Every Mingla Host tool">
        <CutReveal>
          <CutoutHeading align="center" eyebrow="All of it"
            lede="Nothing here is a separate subscription.">
            Ten tools, <span className="cut-gradient-brand">one app.</span>
          </CutoutHeading>
        </CutReveal>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {ALL_TOOLS.map((tool, i) => (
            <CutReveal key={tool.id} variant="lift" delay={(i % 5) * 0.06}>
              <ToolCard tool={tool} icon={ICONS[tool.id]} />
            </CutReveal>
          ))}
        </div>
        <CutReveal delay={0.2}>
          <div className="mt-14 flex justify-center">
            <DeviceCta surface="host" location="tools" variant="primary" size="lg" />
          </div>
        </CutReveal>
      </CutoutSection>

      {/* Before / after. Short both sides. */}
      <CutoutSection aria-label="Hosting before and after Mingla">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Before / after"
              lede="Same business. Fewer tabs.">
              Five products, <span className="cut-gradient-brand">or one.</span>
            </CutoutHeading>
          </CutReveal>
          <CutReveal delay={0.08}>
            <CutoutCard pad="md">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Hosting before and after Mingla</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pb-3 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">Job</th>
                    <th scope="col" className="pb-3 pl-4 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-muted)]">Today</th>
                    <th scope="col" className="pb-3 pl-4 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-accent-ink)]">On Mingla</th>
                  </tr>
                </thead>
                <tbody>
                  {HOST_SWAP.map((row) => (
                    <tr key={row.job} className="border-t" style={{ borderColor: 'var(--cut-hairline)' }}>
                      <th scope="row" className="w-[22%] py-4 pr-3 align-top font-display text-[0.9375rem] leading-tight text-[var(--cut-ink)]">{row.job}</th>
                      <td className="w-[36%] py-4 pl-4 align-top text-[0.875rem] text-[var(--cut-muted)]">{row.before}</td>
                      <td className="w-[42%] py-4 pl-4 align-top text-[0.875rem] font-medium text-[var(--cut-ink)]">{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CutoutCard>
          </CutReveal>
        </div>
      </CutoutSection>

      {/* Straight answers. */}
      <CutoutSection rhythm="tight" aria-label="Straight answers">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Straight answers">
              What Mingla <span className="cut-gradient-brand">does not do.</span>
            </CutoutHeading>
          </CutReveal>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOST_LIMITS.map((limit, i) => (
              <CutReveal key={limit.title} variant="lift" delay={i * 0.07}>
                <CutoutCard pad="md" className="h-full">
                  <h3 className="font-display text-[1.0625rem] leading-tight text-[var(--cut-ink)]">{limit.title}</h3>
                  <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{limit.body}</p>
                </CutoutCard>
              </CutReveal>
            ))}
          </div>
        </div>
      </CutoutSection>

      <CutoutSection aria-label="Questions">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-16">
          <CutReveal>
            <CutoutHeading eyebrow="Questions">Asked first.</CutoutHeading>
          </CutReveal>
          <CutReveal delay={0.08}><CutoutFaq items={FAQ} /></CutReveal>
        </div>
        <FaqSchema items={FAQ} />
      </CutoutSection>

      <CutoutSection band="dark" aria-label="Get started">
        <CutReveal variant="lift">
          <div className="flex flex-col items-center text-center">
            <CutoutHeading align="center" lede="Your site is a sentence away.">
              Start hosting <span className="cut-gradient-brand">properly.</span>
            </CutoutHeading>
            <div className="mt-10"><DeviceCta surface="host" location="cta" variant="primary" size="lg" /></div>
          </div>
        </CutReveal>
      </CutoutSection>

      <CutoutFooter surface="host" />
      {/* preview-banner-clearance */}
      <div aria-hidden="true" className="h-14" />
    </CutoutShell>
  )
}
