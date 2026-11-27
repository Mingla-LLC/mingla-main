// #4636 — each converted page's DEFAULT block list: today's coded page as
// registry blocks, in order, with the colours the coded page paints them.
// Admin's editor opens a page that has never been edited from this list
// (lib/site-blocks/page-defaults.json, written by
// scripts/issue-4636-page-defaults.mjs; `--check` fails when it is stale).
//
// The lists are built from the SAME constants the coded pages render, so they
// cannot drift from them; a test renders each block of each list through the
// registry validator.
import type { CodedHero } from '@/components/site-blocks/hero-words'
import type { IcpSlug } from '@/content/host-landing/icps'
import { ABOUT_ANSWER, ABOUT_CARDS, ABOUT_CLIP, ABOUT_HERO, ABOUT_WHY, GET_APP, GOING_OUT_ANSWER, GOING_OUT_CITIES, GOING_OUT_GUIDES, GOING_OUT_HERO } from './core'
import { AUDIENCES, HOME_BAND, HOME_CITIES, HOME_HERO, HOME_HOW, MARQUEE } from './home'
import { ARI_CARDS, HOST_BAND, HOST_HERO, HOST_KINDS, HOST_SITE, TOOLKIT } from './host'
import { icpBlocks } from './icp'
import { CREATORS_BAND, CREATORS_CLIPS, CREATORS_FINE, CREATORS_HERO, CREATORS_STEPS, LOCALS_BAND, LOCALS_FACTS, LOCALS_FINE, LOCALS_HERO, LOCALS_STEPS } from './programmes'

export interface DefaultBlock {
  type: string
  version: number
  content: unknown
  colour?: string
}

const b = (type: string, content: unknown, colour?: string): DefaultBlock => ({ type, version: 1, content, ...(colour ? { colour } : {}) })

/** The #4452 coded hero (components/site-blocks/hero-words.tsx) as the heroWords block. */
function heroWords(coded: CodedHero): unknown {
  return {
    title: coded.h1,
    em: coded.em,
    lead: coded.lead,
    primary: { label: coded.app.text, to: 'app:explorer', track: coded.app.location },
    secondary: { label: coded.call.text, to: coded.call.href },
  }
}

function icp(slug: IcpSlug): DefaultBlock[] {
  const x = icpBlocks(slug)
  return [
    b('icpHero', x.hero),
    b('litAbout', x.about, 'cream'),
    b('icpFeatures', x.features),
    b('chips', x.who, 'paper'),
    b('toolCard', x.tool, 'paper'),
    b('faq', x.faq, 'paper'),
    b('videoBand', x.band),
  ]
}

export const PAGE_DEFAULTS: Readonly<Record<string, readonly DefaultBlock[]>> = {
  home: [b('reelHero', HOME_HERO, 'paper'), b('steps', HOME_HOW, 'paper'), b('tiles', AUDIENCES, 'night'), b('citiesRow', HOME_CITIES, 'paper'), b('marquee', MARQUEE), b('videoBand', HOME_BAND)],
  host: [b('reelHero', HOST_HERO, 'night'), b('tiles', HOST_KINDS, 'paper'), b('promptDemo', HOST_SITE, 'cream'), b('vcards', ARI_CARDS, 'night'), b('toolkit', TOOLKIT, 'paper'), b('videoBand', HOST_BAND)],
  creators: [b('heroWords', heroWords(CREATORS_HERO)), b('clipGrid', CREATORS_CLIPS), b('steps', CREATORS_STEPS), b('videoBand', CREATORS_BAND), b('finePrint', CREATORS_FINE)],
  locals: [b('heroWords', heroWords(LOCALS_HERO)), b('steps', LOCALS_STEPS), b('facts', LOCALS_FACTS), b('videoBand', LOCALS_BAND), b('finePrint', LOCALS_FINE)],
  about: [b('pageHero', ABOUT_HERO), b('answer', ABOUT_ANSWER), b('wideClip', ABOUT_CLIP), b('paras', ABOUT_WHY, 'paper'), b('vcards', ABOUT_CARDS, 'cream')],
  'going-out': [b('pageHero', GOING_OUT_HERO), b('answer', GOING_OUT_ANSWER), b('filterGrid', GOING_OUT_GUIDES), b('cityLinks', GOING_OUT_CITIES)],
  download: [b('getApp', GET_APP)],
  events: icp('events'),
  trips: icp('trips'),
  experiences: icp('experiences'),
  restaurants: icp('restaurants'),
  hotels: icp('hotels'),
  art: icp('art'),
  play: icp('play'),
}
