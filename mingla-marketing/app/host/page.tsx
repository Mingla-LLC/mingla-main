import {
  CalendarCheck, Globe, MapPin, Megaphone, Search, Sparkles, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { searchRouteMetadata } from '@/lib/search/metadata'
import {
  CutoutFooter, CutoutHeading, CutoutHero, CutoutNav,
  CutoutSection, CutoutShell, CutReveal, DeviceCta,
} from '@/components/cutout'
import {
  AuroraBackground, BentoGrid, BentoGridItem,
} from '@/components/ui/aurora-bento-grid'
import { HOST_BENTO } from '@/lib/design-preview/host-bento'
import { AriCreativeCard } from '@/components/ui/ari-creative-card'
import { HostFigure } from '@/components/ui/host-figures'
import { ICP_CARDS } from '@/lib/design-preview/icp-cards'
import { ExpandingCards, type CardItem } from '@/components/ui/expanding-cards'
import { ScrollVelocityRow } from '@/components/ui/scroll-velocity-text'

// #2902 — Mingla Host, on AIgocy's design, telling Seth's story:
// "Mingla gives you all the tools to be a successful host."
//
// Copy rule: succinct, clear, punchy. Design rule: intentional — every element
// earns its place. Nothing decorative was added to fill space.

export const metadata = searchRouteMetadata('/host')


const ICP_ICONS: Record<string, React.ReactNode> = {
  'event-organizers-promoters': <Sparkles className="h-5 w-5" />,
  'restaurants-cafes': <CalendarCheck className="h-5 w-5" />,
  'bars-clubs-nightlife': <Megaphone className="h-5 w-5" />,
  'venues-activity-spaces': <MapPin className="h-5 w-5" />,
  'resorts-hotels-retreats': <Globe className="h-5 w-5" />,
  'tours-experiences-adventures': <Search className="h-5 w-5" />,
  'pop-ups-independent-creators': <Users className="h-5 w-5" />,
}

export default function CutoutHostPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/host" />

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
                  <div className="mt-6 h-[24rem] lg:h-auto lg:min-h-0 lg:flex-1">
                    <AriCreativeCard
                      siteSrc="/marketing/host-icp/gogi-site.jpg"
                      siteAlt="A restaurant website Ari built — hero, menu with prices, online ordering and a table booking form."
                    />
                  </div>
                ) : null}

                {/* Each tool shows what it does rather than describing it:
                    the demand read, the instalments landing, tonight's floor,
                    who one send reaches. */}
                {card.figure ? (
                  <div className="mt-5 min-h-0 flex-1">
                    <HostFigure id={card.id} />
                  </div>
                ) : null}

                {/* The brand tile's chips are gone — the demo inside it says
                    all three things better than a label row could. */}
                <div className={cn('mt-6 flex flex-wrap gap-2', (card.tone === 'brand' || card.id === 'brain') && 'hidden')}>
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

      <CutoutFooter surface="host" />
      {/* preview-banner-clearance */}
      <div aria-hidden="true" className="h-14" />
    </CutoutShell>
  )
}
