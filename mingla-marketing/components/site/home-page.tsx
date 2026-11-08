import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Bookmark, Calendar } from 'lucide-react'
import { SiteFooter } from '@/components/marketing/footer'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import { LandingRoot } from '@/components/landing/landing-root'
import { cityHubForSlug, cityHubPath } from '@/content/cities/registry'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { ReelHero } from './reel-hero'
import type { ReelCard } from './reel-stage'
import { RotatingPhrase } from './rotating-phrase'
import { SiteNav } from './site-nav'
import '@/components/landing/landing.css'
import './site.css'

// #4339 phase 2a — the Explorer home, in the approved design's order:
//   Reelmark hero → How it works (Discover, Save, Schedule) → the dark "Not a
//   dating app. A plans app." section with four audience tiles → the cities
//   row → the marquee → the "Run a place with soul?" video band → footer.
//
// Copy is the design's, word for word. Every "Use Mingla" is the Explorer
// hand-off (§3); "See Mingla Host" goes to /host; tiles go to Going out and the
// city pages. No badge, notes, icon strip or label pills around the hero.

/** The headline's middle line, in the design's order. */
export const HOME_PHRASES = ['romantic plans', 'weekend plans', 'side quests', 'group plans', 'solo plans'] as const

export const HOME_REEL: readonly ReelCard[] = [
  { media: 'v:amapiano', caption: 'Amapiano night' },
  { media: 'v:h-boat', caption: 'Boat day' },
  { media: 'v:salsa', caption: 'Salsa social' },
  { media: 'v:h-arcade', caption: 'Arcade night' },
  { media: 'v:cozy', caption: 'Movie under the stars' },
  { media: 'v:h-garden', caption: 'Garden walk' },
  { media: 'v:grandplace', caption: 'Old-town evening' },
  { media: 'v:h-pottery', caption: 'Pottery class' },
  { media: 'v:beach', caption: 'Beach day' },
  { media: 'v:h-music', caption: 'Live music' },
]

const AUDIENCES: readonly { media: LandingMediaRef; title: string; line: string }[] = [
  { media: 'v:bachata', title: 'Couples', line: 'Date nights that aren’t dinner again.' },
  { media: 'p:weekend-lagos-boat', title: 'Friends', line: 'The plan the whole chat agrees on.' },
  { media: 'v:a-family', title: 'Family', line: 'Something for every age.' },
  { media: 'v:a-solo', title: 'Solo', line: 'Some of the best plans only need you.' },
]

/** City tiles: registry slugs, so a renamed hub fails the build, not a click. */
const CITY_TILES: readonly { slug: string; media: LandingMediaRef }[] = [
  { slug: 'lagos', media: 'p:weekend-lagos-cover' },
  { slug: 'raleigh-nc', media: 'v:raleigh' },
  { slug: 'durham-nc', media: 'p:weekend-durham-cover' },
  { slug: 'cary-nc', media: 'p:cary-fountain' },
  { slug: 'brussels', media: 'v:grandplace' },
]

const MARQUEE = ['Date night', 'Side quests', 'Live music', 'Brunch', 'Boat day', 'Gallery hop', 'Game night', 'Solo Saturday']

function cityTile(slug: string) {
  const record = cityHubForSlug(slug)
  if (!record) throw new Error(`#4339 home: city hub "${slug}" is not in the registry`)
  return { href: cityHubPath(record), name: record.city }
}

export function HomePage() {
  return (
    <LandingRoot>
      <SiteNav surface="explorer" current="home" />
      <ReelHero
        srTitle="Find plans that fit the vibe."
        title={
          <>
            <span>Find</span>
            <span className="rot">
              <RotatingPhrase phrases={HOME_PHRASES} />
            </span>
            <span>that fit the vibe.</span>
          </>
        }
        sub="Mingla is the app for what to do. Real places, events and experiences, picked for the mood you’re in, in the city you’re in."
        cta={
          <ExplorerHandoffButton location="hero" className="btn cta" withArrow>
            Use Mingla
          </ExplorerHandoffButton>
        }
        cards={HOME_REEL}
      />

      {/* 1. How it works */}
      <section className="sec" aria-labelledby="home-how">
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id="home-how">
              From <em>“what should we do?”</em> to a date in the calendar.
            </h2>
            <p className="lead">
              Discover places, events, trips and experiences, compare the details that change the decision, and save
              the good ones together.
            </p>
          </div>
          <div className="grid3 mt-56">
            <div className="step reveal">
              <span className="n">01</span>
              <h3>
                Pick a <em>vibe.</em>
              </h3>
              <p className="muted">Tell Mingla the mood. It shows real plans nearby, not a wall of map pins.</p>
              <div className="vis" aria-hidden="true">
                <span className="pill ink">Chill</span>
                <span className="pill paper">Romantic</span>
                <span className="pill paper">Adventurous</span>
              </div>
            </div>
            <div className="step reveal">
              <span className="n">02</span>
              <h3>
                Keep the <em>good ones.</em>
              </h3>
              <p className="muted">Everything you like goes to your Saved tab, ready when the group chat wakes up.</p>
              <div className="vis" aria-hidden="true">
                <div className="mini">
                  <Bookmark /> Saved · 12 plans
                </div>
              </div>
            </div>
            <div className="step reveal">
              <span className="n">03</span>
              <h3>
                Pick a <em>date.</em>
              </h3>
              <p className="muted">Tap Schedule and it’s on your Calendar. The date is the plan.</p>
              <div className="vis" aria-hidden="true">
                <div className="mini">
                  <Calendar /> Sat · Scheduled
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Not a dating app */}
      <section className="sec dark" aria-labelledby="home-plans">
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id="home-plans">
              Not a dating app. <em>A plans app.</em>
            </h2>
            <p className="lead">
              Mingla doesn’t match strangers. It finds the plan for the people you already have, or for just you.
            </p>
          </div>
          <div className="grid4 mt-56">
            {AUDIENCES.map((a) => (
              <Link className="tile reveal" href="/going-out" key={a.title}>
                <div className="ph scrim">
                  <LandingMedia media={a.media} />
                </div>
                <div className="ov">
                  <h3>{a.title}</h3>
                  <p>{a.line}</p>
                </div>
                <span className="go" aria-hidden="true">
                  <ArrowUpRight />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Cities */}
      <section className="sec" aria-labelledby="home-cities">
        <div className="wrap">
          <div className="split reveal">
            <h2 className="h2" id="home-cities">
              Your city, <em>but better.</em>
            </h2>
            <div>
              <Link className="btn soft" href="/cities">
                All cities <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="cityrow">
            {CITY_TILES.map(({ slug, media }) => {
              const city = cityTile(slug)
              return (
                <Link href={city.href} className="reveal" key={slug}>
                  <div className="ph scrim">
                    <LandingMedia media={media} />
                  </div>
                  <div className="ov">
                    <h3>{city.name}</h3>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* 4. Marquee (decorative: the same words are not content) */}
      <section className="marq-sec" aria-hidden="true">
        <div className="marq">
          {[0, 1].flatMap((copy) => MARQUEE.map((word) => <span key={`${copy}-${word}`}>{word}</span>))}
        </div>
      </section>

      {/* 5. Run a place with soul? */}
      <section className="band-sec" aria-labelledby="home-host">
        <div className="wrap">
          <div className="band">
            <LandingMedia media="v:crowd" />
            <div className="in">
              <div className="band-copy">
                <h2 id="home-host">
                  Run a place <em>with soul?</em>
                </h2>
                <p>Mingla Host is the growth and operating system that helps the right people find and book you.</p>
              </div>
              <Link className="btn cta" href="/host">
                See Mingla Host <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter surface="explorer" />
    </LandingRoot>
  )
}
