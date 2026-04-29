/**
 * brandList — stub Brand data for Cycle 1.
 *
 * [TRANSITIONAL] stub data — replaces real backend. Removed in B1 backend
 * cycle when brand CRUD endpoints land. All consumers (Home hero, brand
 * switcher) read from currentBrandStore which is seeded from this list via
 * the dev "Seed 4 stub brands" button on Account.
 *
 * Only Sunday Languor has a `currentLiveEvent` (matches Cycle 1 dispatch
 * AC#3 hero figure: "Slow Burn vol. 4 — Live tonight £8,420 / £12,000").
 */

import type { Brand } from "./currentBrandStore";

export const STUB_BRANDS: Brand[] = [
  {
    id: "lm",
    displayName: "Lonely Moth",
    slug: "lonelymoth",
    role: "owner",
    stats: { events: 3, followers: 2418, rev: 24180 },
    currentLiveEvent: null,
  },
  {
    id: "tll",
    displayName: "The Long Lunch",
    slug: "thelonglunch",
    role: "owner",
    stats: { events: 1, followers: 412, rev: 1860 },
    currentLiveEvent: null,
  },
  {
    id: "sl",
    displayName: "Sunday Languor",
    slug: "sundaylanguor",
    role: "owner",
    stats: { events: 6, followers: 1124, rev: 8420 },
    currentLiveEvent: {
      name: "Slow Burn vol. 4",
      soldGbp: 8420,
      goalGbp: 12000,
    },
  },
  {
    id: "hr",
    displayName: "Hidden Rooms",
    slug: "hiddenrooms",
    role: "owner",
    stats: { events: 2, followers: 824, rev: 3120 },
    currentLiveEvent: null,
  },
];

/**
 * The brand the dev-seed button activates. Sunday Languor is chosen so the
 * hero KPI in AC#3 ("Slow Burn vol. 4 — Live tonight £8,420 / £12,000")
 * appears immediately after seeding without manual brand-switching.
 */
export const STUB_DEFAULT_BRAND_ID = "sl";
