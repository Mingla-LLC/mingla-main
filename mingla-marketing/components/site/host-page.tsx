import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { SiteFooter } from '@/components/marketing/footer'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import { LandingRoot } from '@/components/landing/landing-root'
import { Wordmark } from './wordmark'
import { ICP_LANDINGS, ICP_SLUGS, icpLandingPath, type LandingMediaRef } from '@/content/host-landing/icps'
import { ReelHero } from './reel-hero'
import type { ReelCard } from './reel-stage'
import { SiteNav } from './site-nav'
import { SitePromptDemo } from './site-prompt-demo'
import '@/components/landing/landing.css'
import './site.css'

// #4339 phase 2a — Mingla Host (/host), in the approved design's order:
//   dark Reelmark hero ("Everything / a host needs.", Use Mingla Web) → the
//   seven host-type tiles (each opens its /host/<icp> landing page) plus Free
//   tools → "Prompt your website into existence" (visual demo, §5) → the Ari
//   cards (Owned, Shared, Earned, Paid) on video with the text-card wash →
//   the toolkit list → the closing band with "Book a call" (/schedule).
//
// "Use Mingla Web" is the Host hand-off (§3) everywhere, including the two
// toolkit rows that point at host web (Marketing, Ari AI).

export const HOST_REEL: readonly ReelCard[] = [
  { media: 'v:amapiano', caption: 'Events' },
  { media: 'v:sailing', caption: 'Trips' },
  { media: 'v:pottery', caption: 'Experiences' },
  { media: 'v:cafe', caption: 'Cafés' },
  { media: 'v:beach', caption: 'Resorts' },
  { media: 'v:hc-gallery', caption: 'Galleries' },
  { media: 'v:nightlife', caption: 'Play spaces' },
  { media: 'v:hostess', caption: 'Restaurants' },
  { media: 'v:salsa', caption: 'Dance socials' },
  { media: 'v:hc-bowling', caption: 'Play spaces' },
]

const ARI_CARDS: readonly { media: LandingMediaRef; title: string; line: string }[] = [
  { media: 'v:cafe', title: 'Owned', line: 'Your site, listings, email and SMS.' },
  { media: 'v:crowd', title: 'Shared', line: 'The posts and links people pass on.' },
  { media: 'v:salsa', title: 'Earned', line: 'Reviews, creators and word of mouth.' },
  { media: 'v:nightlife', title: 'Paid', line: 'Ads that point to pages that convert.' },
]

const TOOLKIT: readonly { title: string; line: string; href: string | null }[] = [
  { title: 'Events', line: 'Ticketing, guest lists, door scanning and an AI demand forecast.', href: icpLandingPath('events') },
  { title: 'Trips', line: 'Group chat, instalments and itineraries.', href: icpLandingPath('trips') },
  {
    title: 'Venue management',
    line: 'Reservations, table ordering, menu intelligence and a demand forecast.',
    href: icpLandingPath('restaurants'),
  },
  // null: host web, through the Host hand-off.
  { title: 'Marketing', line: 'Email, SMS and CRM nurturing that brings people back.', href: null },
  { title: 'Ari AI', line: 'Owned, shared, earned and paid, in one assistant.', href: null },
]

function ToolkitRow({ index, title, line }: { index: number; title: string; line: string }) {
  return (
    <>
      <span className="n" aria-hidden="true">
        0{index + 1}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{line}</p>
      </div>
      <span className="btn soft go" aria-hidden="true">
        Explore <ArrowRight />
      </span>
    </>
  )
}

export function HostPage() {
  return (
    <LandingRoot>
      <SiteNav surface="host" current="host" />
      <ReelHero
        dark
        title={
          <>
            <span>Everything</span>
            <span>
              <em>a host needs.</em>
            </span>
          </>
        }
        sub="The growth and operating system for places with soul: get found by people looking for something to do, then run the night, the trip or the room."
        cta={<HostHandoffButton location="hero" className="btn cta" withArrow />}
        cards={HOST_REEL}
      />

      {/* Host types */}
      <section className="sec" aria-labelledby="host-kinds">
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id="host-kinds">
              Built for <em>every kind</em> of host.
            </h2>
            <p className="lead">Pick yours.</p>
          </div>
          <div className="grid4 mt-56">
            {ICP_SLUGS.map((slug) => {
              const d = ICP_LANDINGS[slug]
              return (
                <Link className="tile reveal" href={icpLandingPath(slug)} key={slug}>
                  <div className="ph scrim">
                    <LandingMedia media={d.hero} />
                  </div>
                  <div className="ov">
                    <h3>{d.short}</h3>
                    <p>
                      {d.l1} {d.l2}
                    </p>
                  </div>
                  <span className="go" aria-hidden="true">
                    <ArrowUpRight />
                  </span>
                </Link>
              )
            })}
            <Link className="tile tools reveal" href="/tools">
              <div className="ph">
                <span className="pill glass">4 free tools</span>
              </div>
              <div className="ov">
                <h3>Free tools</h3>
                <p>No sign-up, no sales call.</p>
              </div>
              <span className="go" aria-hidden="true">
                <ArrowUpRight />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Prompt your website into existence (visual demo, §5) */}
      <section className="sec sandbg" id="site" aria-labelledby="host-site">
        <div className="wrap split split-center">
          <div className="reveal">
            <h2 className="h2" id="host-site">
              Prompt your website <em>into existence.</em>
            </h2>
            <p className="lead">
              Describe your place and get a free site in seconds, connected to your listings, tickets and bookings.
            </p>
            <div className="row" style={{ marginTop: 28 }}>
              <button className="btn ink" type="button" data-focus-gen="">
                Make my site <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
          <SitePromptDemo />
        </div>
      </section>

      {/* Ari: video text cards with the wash */}
      <section className="sec dark" aria-labelledby="host-ari">
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id="host-ari">
              Marketing that <em>doesn’t sleep.</em>
            </h2>
            <p className="lead">
              Ari works across every channel you have: the ones you own, the ones people share, the ones you earn and
              the ones you pay for.
            </p>
          </div>
          <div className="grid4 mt-56">
            {ARI_CARDS.map((c, i) => (
              <article className="vcard ari-card reveal" key={c.title}>
                <LandingMedia media={c.media} />
                <div className="vc-top">
                  <Wordmark height={18} title={null} />
                  <span className="pill glass">0{i + 1}</span>
                </div>
                <h3>{c.title}</h3>
                <p>{c.line}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Toolkit */}
      <section className="sec" aria-labelledby="host-kit">
        <div className="wrap">
          <h2 className="h2 reveal" id="host-kit">
            Run it <em>all</em> from one place.
          </h2>
          <ul className="list">
            {TOOLKIT.map((t, i) => (
              <li key={t.title} className="reveal">
                {t.href ? (
                  <Link className="list-item" href={t.href}>
                    <ToolkitRow index={i} title={t.title} line={t.line} />
                  </Link>
                ) : (
                  <HostHandoffButton location="toolkit" className="list-item">
                    <ToolkitRow index={i} title={t.title} line={t.line} />
                  </HostHandoffButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing band */}
      <section className="band-sec" aria-labelledby="host-end">
        <div className="wrap">
          <div className="band">
            <LandingMedia media="v:hostess" />
            <div className="in">
              <h2 id="host-end">
                Get found. <em>Get booked.</em>
              </h2>
              <div className="glassbar">
                <span className="bring">Questions first?</span>
                <Link className="btn white" href="/schedule">
                  Book a call
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter surface="host" />
    </LandingRoot>
  )
}
