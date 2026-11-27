import { LandingRoot } from '@/components/landing/landing-root'
import { CitiesRowBlock } from '@/components/site-blocks/sections/cities-row-block'
import { MarqueeBlock } from '@/components/site-blocks/sections/marquee-block'
import { ReelHeroBlock } from '@/components/site-blocks/sections/reel-hero-block'
import { StepsBlock } from '@/components/site-blocks/sections/steps-block'
import { TilesBlock } from '@/components/site-blocks/sections/tiles-block'
import { VideoBandBlock } from '@/components/site-blocks/sections/video-band-block'
import { AUDIENCES, HOME_BAND, HOME_CITIES, HOME_HERO, HOME_HOW, MARQUEE } from '@/content/site-blocks/home'
import { getCityTiles } from '@/lib/live-cities'
import { SiteFooterLive, SiteNavLive } from './site-chrome'
import '@/components/landing/landing.css'
import './site.css'

// #4339 phase 2a — the Explorer home, in the approved design's order:
//   Reelmark hero → How it works (Discover, Save, Schedule) → the dark "Not a
//   dating app. A plans app." section with four audience tiles → the cities
//   row → the marquee → the "Run a place with soul?" video band → footer.
//
// #4636: every section is a registry block (components/site-blocks/sections/),
// rendered here with Home's default content (content/site-blocks/home.ts).
// Copy is the design's, word for word. Every "Use Mingla" is the Explorer
// hand-off (§3); "See Mingla Host" goes to /host; tiles go to Going out and the
// city pages. No badge, notes, icon strip or label pills around the hero.

export { HOME_PHRASES, HOME_REEL } from '@/content/site-blocks/home'

/** The cities row: every live Mingla city, A to Z (lib/live-cities.ts), each with
 *  its own loop from CITY_MEDIA / LIVE_CITY_MEDIA (the same clip as its /cities
 *  tile and its page hero), or a brand-colour card when it has none yet. */
export async function HomePage() {
  const { tiles: cityTiles } = await getCityTiles()
  return (
    <LandingRoot>
      <SiteNavLive surface="explorer" current="home" />
      <ReelHeroBlock content={HOME_HERO} colour="paper" blockId="rm-title" />
      {/* 1. How it works */}
      <StepsBlock content={HOME_HOW} colour="paper" blockId="home-how" />
      {/* 2. Not a dating app */}
      <TilesBlock content={AUDIENCES} colour="night" blockId="home-plans" />
      {/* 3. Cities */}
      <CitiesRowBlock content={HOME_CITIES} colour="paper" blockId="home-cities" tiles={cityTiles} />
      {/* 4. Marquee (decorative: the same words are not content) */}
      <MarqueeBlock content={MARQUEE} blockId="home-marquee" />
      {/* 5. Run a place with soul? */}
      <VideoBandBlock content={HOME_BAND} blockId="home-host" />
      <SiteFooterLive surface="explorer" />
    </LandingRoot>
  )
}
