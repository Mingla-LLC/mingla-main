/**
 * brandList — stub Brand data for Cycle 1 + Cycle 2.
 *
 * [TRANSITIONAL] stub data — replaces real backend. Removed in B1 backend
 * cycle when brand CRUD endpoints land. All consumers (Home hero, brand
 * switcher, J-A7 brand profile, J-A8 brand edit) read from currentBrandStore
 * which is seeded from this list via the dev "Seed 4 stub brands" button on
 * Account.
 *
 * Cycle 1: Sunday Languor has a `currentLiveEvent` (matches dispatch AC#3
 * hero figure: "Slow Burn vol. 4 — Live tonight £8,420 / £12,000").
 *
 * Cycle 2 J-A7 (schema v3): each brand now carries bio, tagline, contact,
 * links, and stats.attendees so the brand profile screen renders meaningful
 * content immediately after seeding. Bio uses 3 sentences min per brand.
 *
 * Cycle 2 J-A8 (schema v4): each brand carries `displayAttendeeCount: true`
 * explicit so the edit screen's Display toggle renders ON by default.
 *
 * Cycle 2 J-A8 polish (schema v5): brands gain mixed coverage across the 6
 * new social platforms (tiktok, x, facebook, youtube, linkedin, threads) so
 * smoke tests hit different chip counts on the J-A7 profile hero — Lonely
 * Moth (all 8 platforms), Sunday Languor (6), The Long Lunch (3), Hidden
 * Rooms (2 = website + instagram only).
 *
 * Cycle 2 J-A8 polish URL fix: social fields now store full HTTPS URLs (not
 * @-handles or bare slugs) so the public profile (Cycle 3+) can call
 * `Linking.openURL` directly with zero per-platform URL reconstruction.
 */

import type { Brand } from "./currentBrandStore";

export const STUB_BRANDS: Brand[] = [
  {
    id: "lm",
    displayName: "Lonely Moth",
    slug: "lonelymoth",
    role: "owner",
    stats: { events: 3, followers: 2418, rev: 24180, attendees: 728 },
    currentLiveEvent: null,
    bio: "A six-year-running curatorial project from Sara Marlowe. Limited capacity, generous time. Slow-burn evenings in East London where the room and the music share equal billing.",
    tagline: "One room. One sound system. Slow-burn evenings.",
    contact: {
      email: "hello@lonelymoth.events",
      phone: "+44 7700 900 312",
      phoneCountryIso: "GB",
    },
    links: {
      website: "https://lonelymoth.events",
      instagram: "https://instagram.com/lonely.moth.events",
      tiktok: "https://tiktok.com/@lonelymoth",
      x: "https://x.com/lonelymothldn",
      facebook: "https://facebook.com/lonelymothldn",
      youtube: "https://youtube.com/@lonelymoth",
      linkedin: "https://linkedin.com/company/lonely-moth",
      threads: "https://threads.net/@lonely.moth.events",
      custom: [],
    },
    displayAttendeeCount: true,
  },
  {
    id: "tll",
    displayName: "The Long Lunch",
    slug: "thelonglunch",
    role: "owner",
    stats: { events: 1, followers: 412, rev: 1860, attendees: 124 },
    currentLiveEvent: null,
    bio: "A weekly long-lunch series in Hackney. Twelve seats, four courses, no rush. Run by chef Ada Kwame and producer Liam Reeves since 2024.",
    tagline: "Twelve seats. Four courses. No rush.",
    contact: {
      email: "table@thelonglunch.co.uk",
    },
    links: {
      website: "https://thelonglunch.co.uk",
      instagram: "https://instagram.com/thelonglunch",
      tiktok: "https://tiktok.com/@thelonglunch",
      custom: [],
    },
    displayAttendeeCount: true,
  },
  {
    id: "sl",
    displayName: "Sunday Languor",
    slug: "sundaylanguor",
    role: "owner",
    stats: { events: 6, followers: 1124, rev: 8420, attendees: 1860 },
    currentLiveEvent: {
      name: "Slow Burn vol. 4",
      soldGbp: 8420,
      goalGbp: 12000,
    },
    bio: "Brunch parties for the long-walk-home crowd. Resident DJs spin downtempo and Italo from 11am. South London since 2023.",
    tagline: "Brunch, but later.",
    contact: {
      email: "hi@sundaylanguor.com",
      phone: "+44 7700 900 781",
      phoneCountryIso: "GB",
    },
    links: {
      website: "https://sundaylanguor.com",
      instagram: "https://instagram.com/sundaylanguor",
      tiktok: "https://tiktok.com/@sundaylanguor",
      x: "https://x.com/sundaylanguor",
      youtube: "https://youtube.com/@sundaylanguor",
      threads: "https://threads.net/@sundaylanguor",
      custom: [],
    },
    displayAttendeeCount: true,
  },
  {
    id: "hr",
    displayName: "Hidden Rooms",
    slug: "hiddenrooms",
    role: "owner",
    stats: { events: 2, followers: 824, rev: 3120, attendees: 256 },
    currentLiveEvent: null,
    bio: "Pop-up listening sessions in unconventional spaces — laundrettes, art studios, basements. Founded by sound designer Maya Okonkwo. Locations announced 24 hours before.",
    tagline: "Listening sessions in unexpected places.",
    contact: {
      email: "rooms@hidden-rooms.co.uk",
    },
    links: {
      website: "https://hidden-rooms.co.uk",
      instagram: "https://instagram.com/hidden.rooms",
      custom: [],
    },
    displayAttendeeCount: true,
  },
];

/**
 * The brand the dev-seed button activates. Sunday Languor is chosen so the
 * hero KPI in AC#3 ("Slow Burn vol. 4 — Live tonight £8,420 / £12,000")
 * appears immediately after seeding without manual brand-switching.
 */
export const STUB_DEFAULT_BRAND_ID = "sl";
