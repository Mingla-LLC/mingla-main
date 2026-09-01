import type { Metadata } from 'next'
import {
  BarChart3, CalendarCheck, CreditCard, Globe, Mail, MapPin,
  Megaphone, Search, Sparkles, Users,
} from 'lucide-react'
import { Card3D, Layer } from '@/components/ui/3d-card'
import { cn } from '@/lib/cn'
import {
  CutoutCard, CutoutFaq, CutoutFooter, CutoutHeading, CutoutHero, CutoutNav,
  CutoutSection, CutoutShell, CutReveal, DeviceCta, FaqSchema,
} from '@/components/cutout'
import {
  AuroraBackground, BentoGrid, BentoGridItem,
} from '@/components/ui/aurora-bento-grid'
import { HOST_BENTO } from '@/lib/design-preview/host-bento'
import { AriCreativeCard } from '@/components/ui/ari-creative-card'
import { EventDemandCard } from '@/components/ui/event-demand-card'
import { HOST_LIMITS, HOST_SWAP } from '@/lib/design-preview/host-tools'
import { ICP_CARDS } from '@/lib/design-preview/icp-cards'
import { ExpandingCards, type CardItem } from '@/components/ui/expanding-cards'
import { ScrollVelocityRow } from '@/components/ui/scroll-velocity-text'

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


const ICP_ICONS: Record<string, React.ReactNode> = {
  'event-organizers-promoters': <Sparkles className="h-5 w-5" />,
  'restaurants-cafes': <CalendarCheck className="h-5 w-5" />,
  'bars-clubs-nightlife': <Megaphone className="h-5 w-5" />,
  'venues-activity-spaces': <MapPin className="h-5 w-5" />,
  'resorts-hotels-retreats': <Globe className="h-5 w-5" />,
  'tours-experiences-adventures': <Search className="h-5 w-5" />,
  'pop-ups-independent-creators': <Users className="h-5 w-5" />,
}


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
        line1="Everything a"
        line2={<span className="cut-gradient-brand">host needs.</span>}
        lede="One app builds your website, publishes your events, trips and stays, sells the tickets and tables, and brings the right people back."
        image="/marketing/host-hero/world-hosts-create-poster.jpg"
        video="/marketing/host-hero/world-hosts-create-preview.mp4"
        scrollTo="#tools"
        action={<DeviceCta surface="host" location="hero" variant="primary" size="lg" />}
      />

      {/* Who it is for. Expanding cards: the collapsed rail states the USP,
          the open card explains it and offers a way in. The whole tile is the
          link — the "Learn more" anchor is stretched over it. */}
      <CutoutSection aria-label="Who Mingla Host is for">
        <CutReveal>
          <CutoutHeading align="center">
            Built for the people who make a <span className="cut-gradient-brand">city worth going out in.</span>
          </CutoutHeading>
        </CutReveal>

        {/* The operators, as a marquee. It replaces a sentence that only
            counted them. `aria-hidden` because the same seven names are the
            headings of the cards below — a screen reader should hear the list
            once, not N duplicated copies of a decorative loop. */}
        <CutReveal delay={0.06} className="mt-8">
          <div aria-hidden="true" className="[mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
            <ScrollVelocityRow baseVelocity={2.4} direction={-1}>
              {ICP_CARDS.map((c) => (
                <span
                  key={c.id}
                  className="mx-5 font-display text-[1.125rem] text-[var(--cut-muted)] sm:text-[1.375rem]"
                >
                  {c.title}
                  <span className="ml-5 text-[var(--cut-accent)]">•</span>
                </span>
              ))}
            </ScrollVelocityRow>
          </div>
        </CutReveal>
        <CutReveal delay={0.12} className="mt-12">
          <ExpandingCards
            items={ICP_CARDS.map((c): CardItem => ({
              id: c.id,
              title: c.title,
              usp: c.usp,
              description: c.description,
              imgSrc: c.imgSrc,
              linkHref: c.href,
              icon: ICP_ICONS[c.id],
            }))}
          />
        </CutReveal>
      </CutoutSection>

      {/* The capability section, as a bento. It replaces BOTH the Build /
          Sell / Grow tabs and the ten-tool band that followed them — the six
          cards below cover the same ground, and two capability sections in a
          row is the duplication this page keeps being told to cut. */}
      <CutoutSection band="dark" id="tools" aria-label="What Mingla Host does" className="relative">
        <AuroraBackground />
        <div className="relative z-10">
          <CutReveal>
            <CutoutHeading align="center"
              lede="No agency, no stack, no weekend of admin.">
              Everything between an idea and a <span className="cut-gradient-brand">full room.</span>
            </CutoutHeading>
          </CutReveal>

          <BentoGrid className="mt-14">
            {HOST_BENTO.map((card) => (
              <BentoGridItem key={card.id} tone={card.tone} className={card.span}>
                <div>
                  <h3
                    className={cn(
                      'font-display leading-tight tracking-[-0.02em]',
                      card.tone === 'brand' ? 'text-[1.75rem] text-white sm:text-[2.25rem]' : 'text-[1.25rem] text-white',
                    )}
                  >
                    {card.title}
                  </h3>
                  <p
                    className={cn(
                      'mt-2.5 leading-relaxed',
                      card.tone === 'brand'
                        ? 'max-w-md text-[1.0625rem] text-white/85'
                        : 'text-[0.9375rem] text-white/62',
                    )}
                  >
                    {card.body}
                  </p>
                </div>

                {/* The brand tile runs the Ari demo instead of a static
                    figure: Ari takes the brief, then the real site it built
                    scrolls past inside the same card. */}
                {card.tone === 'brand' ? (
                  <div className="mt-6 h-[20rem] lg:h-auto lg:min-h-0 lg:flex-1">
                    <AriCreativeCard
                      siteSrc="/marketing/host-icp/gogi-site.jpg"
                      siteAlt="A restaurant website Ari built — hero, menu with prices, online ordering and a table booking form."
                    />
                  </div>
                ) : null}

                {/* Events shows the demand read itself: the weather it reacts
                    to, the price it lands on, and the shape of the night. */}
                {card.id === 'events' ? (
                  <div className="mt-5 min-h-0 flex-1">
                    <EventDemandCard />
                  </div>
                ) : null}

                {/* The brand tile's chips are gone — the demo inside it says
                    all three things better than a label row could. */}
                <div className={cn('mt-6 flex flex-wrap gap-2', card.tone === 'brand' && 'hidden')}>
                  {card.points.map((p) => (
                    <span
                      key={p}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[0.75rem] font-semibold',
                        card.tone === 'brand'
                          ? 'bg-white/20 text-white ring-1 ring-inset ring-white/25'
                          : 'bg-white/[0.07] text-white/75 ring-1 ring-inset ring-white/10',
                      )}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </BentoGridItem>
            ))}
          </BentoGrid>

          <CutReveal delay={0.2}>
            <div className="mt-14 flex justify-center">
              <DeviceCta surface="host" location="tools" variant="primary" size="lg" />
            </div>
          </CutReveal>
        </div>
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
                <Card3D intensity={5}>
                  <div className="cut-card cut-card-interactive h-full p-6 sm:p-8">
                    <Layer z={22}>
                      <h3 className="font-display text-[1.0625rem] leading-tight text-[var(--cut-ink)]">{limit.title}</h3>
                    </Layer>
                    <Layer z={12}>
                      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-[var(--cut-body)]">{limit.body}</p>
                    </Layer>
                  </div>
                </Card3D>
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
