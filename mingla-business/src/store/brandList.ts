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
 *
 * Cycle 13a (DEC-092): J-A9 `members[]` + `pendingInvitations[]` stub seeds
 * REMOVED. Brand-team state authority is now `src/store/brandTeamStore.ts`
 * which starts EMPTY (per Const #9 — no fabricated data) and accumulates real
 * invitations via the operator's invite-flow UI. Solo-operator default is
 * synthesized at read sites by `useCurrentBrandRole` (account_owner fallback).
 *
 * Cycle 2 J-A10/J-A11 (schema v8): each brand carries stripeStatus + payouts
 * + refunds + balances + lastPayoutAt to drive the payments dashboard's 4
 * banner states + 3 KPI tiles + recent payouts/refunds lists. Coverage
 * spread:
 *   - Lonely Moth: not_connected (drives J-A7 Connect banner; £0/£0/—)
 *   - The Long Lunch: onboarding (Verifying banner; £0/£0/—)
 *   - Sunday Languor: active (no banner; populated KPIs + 4 payouts + 2 refunds)
 *   - Hidden Rooms: restricted (red Action Required banner; £0/£0/£88; 1 historical payout)
 * Real Stripe data lands in B2 (real Stripe webhooks); these stub values
 * are deliberately TRANSITIONAL.
 */

import type { Brand } from "./currentBrandStore";

export const STUB_BRANDS: Brand[] = [
  {
    id: "lm",
    displayName: "Lonely Moth",
    slug: "lonelymoth",
    kind: "physical",
    address: "East London",
    coverHue: 25,
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
    stripeStatus: "not_connected",
    availableBalanceGbp: 0,
    pendingBalanceGbp: 0,
    payouts: [],
    refunds: [],
    events: [],
  },
  {
    id: "tll",
    displayName: "The Long Lunch",
    slug: "thelonglunch",
    kind: "physical",
    address: "Hackney, London",
    coverHue: 320,
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
    stripeStatus: "onboarding",
    availableBalanceGbp: 0,
    pendingBalanceGbp: 0,
    payouts: [],
    refunds: [],
    events: [],
  },
  {
    id: "sl",
    displayName: "Sunday Languor",
    slug: "sundaylanguor",
    kind: "popup",
    address: null,
    coverHue: 220,
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
    stripeStatus: "active",
    availableBalanceGbp: 156.20,
    pendingBalanceGbp: 45.60,
    lastPayoutAt: "2026-04-27T10:00:00Z",
    payouts: [
      { id: "p_sl_4", amountGbp: 156.20, currency: "GBP", status: "in_transit", arrivedAt: "2026-05-01T10:00:00Z" },
      { id: "p_sl_3", amountGbp: 482.50, currency: "GBP", status: "paid", arrivedAt: "2026-04-27T10:00:00Z" },
      { id: "p_sl_2", amountGbp: 312.80, currency: "GBP", status: "paid", arrivedAt: "2026-04-20T10:00:00Z" },
      { id: "p_sl_1", amountGbp: 198.40, currency: "GBP", status: "paid", arrivedAt: "2026-04-13T10:00:00Z" },
    ],
    refunds: [
      { id: "r_sl_2", amountGbp: 24.00, currency: "GBP", eventTitle: "Slow Burn vol. 4", refundedAt: "2026-04-25T15:30:00Z", reason: "Couldn't make it" },
      { id: "r_sl_1", amountGbp: 48.00, currency: "GBP", eventTitle: "Slow Burn vol. 3", refundedAt: "2026-04-22T11:00:00Z" },
    ],
    events: [
      {
        id: "e_sl_4",
        title: "Slow Burn vol. 4",
        revenueGbp: 8420,
        soldCount: 284,
        status: "ended",
        heldAt: "2026-04-26T20:00:00Z",
        contextLabel: "in person",
      },
      {
        id: "e_sl_brunches",
        title: "Sunday Languor — March brunches",
        revenueGbp: 5420,
        soldCount: 248,
        status: "ended",
        heldAt: "2026-03-30T11:30:00Z",
        contextLabel: "brunch series",
      },
      {
        id: "e_sl_sitdown",
        title: "A Long Sit-Down",
        revenueGbp: 1920,
        soldCount: 32,
        status: "upcoming",
        heldAt: "2026-05-15T19:00:00Z",
      },
      {
        id: "e_sl_3",
        title: "Slow Burn vol. 3",
        revenueGbp: 2960,
        soldCount: 392,
        status: "ended",
        heldAt: "2026-03-15T20:00:00Z",
      },
    ],
  },
  {
    id: "hr",
    displayName: "Hidden Rooms",
    slug: "hiddenrooms",
    kind: "popup",
    address: null,
    coverHue: 290,
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
    stripeStatus: "restricted",
    availableBalanceGbp: 0,
    pendingBalanceGbp: 0,
    lastPayoutAt: "2026-04-09T10:00:00Z",
    payouts: [
      { id: "p_hr_1", amountGbp: 88.00, currency: "GBP", status: "paid", arrivedAt: "2026-04-09T10:00:00Z" },
    ],
    refunds: [],
    events: [
      {
        id: "e_hr_studio",
        title: "Hidden Rooms — Studio",
        revenueGbp: 88,
        soldCount: 50,
        status: "ended",
        heldAt: "2026-04-09T20:00:00Z",
      },
    ],
  },
];

/**
 * The brand the dev-seed button activates. Sunday Languor is chosen so the
 * hero KPI in AC#3 ("Slow Burn vol. 4 — Live tonight £8,420 / £12,000")
 * appears immediately after seeding without manual brand-switching.
 */
export const STUB_DEFAULT_BRAND_ID = "sl";
