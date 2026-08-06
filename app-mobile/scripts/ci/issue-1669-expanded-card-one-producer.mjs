#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * #1669 [expanded-card-one-producer] — producer-registry gate for ExpandedCardModal.
 *
 * THE BUG THIS GUARDS
 * -------------------
 * Every consumer surface opens the SAME `ExpandedCardModal`, but ELEVEN
 * different producers built the data it received — eight hand-written object
 * literals duplicated across files, three named adapters — and they disagreed
 * about which fields survived. The same place therefore showed different facts
 * depending on which screen you opened it from:
 *
 *   D1 the price pill was absent from the deck, Discover and chat, because
 *      `CardInfoSection` renders it ONLY from `canonicalDiscoveryPriceDetail`
 *      and four producers never spread `canonicalDiscoveryPriceFields`;
 *   D2 Open now / Closed was computed against the VIEWER's clock on five of six
 *      surfaces, because only SavedTab passed `utcOffsetMinutes` and
 *      `isPlaceOpenAt` silently falls back to device-local time;
 *   D3 both deck literals substituted the VIEWER's own GPS for a card with no
 *      coordinates, then rendered the viewer's weather and busyness under the
 *      venue's name;
 *   D4 curated plans were rebuilt field-by-field on three surfaces;
 *   D5 three producers fabricated `rating: … || 4.5` (Constitution #9).
 *
 * A one-time cleanup would come straight back — ORCH-1054 fixed exactly this
 * on two surfaces in 2026 and the same three defects stayed live on three
 * others for months, because nothing stopped the next producer being written.
 * That is what this gate is for.
 *
 * WHAT IT ENFORCES
 * ----------------
 * R1 MOUNT TOTALITY      — the set of files rendering <ExpandedCardModal is
 *                          EXACTLY the registry. A new mount fails until it is
 *                          registered with a named producer.
 * R2 POOL MOUNTS ROUTE   — every pool-card mount imports a sanctioned producer.
 * R3 MINT TOTALITY       — the set of files that MINT the expanded-card shape
 *                          (the `categoryIcon` + `fullDescription` +
 *                          `matchFactors` + `socialStats` signature) is EXACTLY
 *                          the registry, and each is capped at its declared
 *                          number of mint sites.
 * R4 PRODUCER DELEGATION — the set of exported `*ToExpandedCardData` functions
 *                          is EXACTLY the registry, and every one of them
 *                          except the canonical mapper delegates to it.
 * R5 NO FABRICATED RATING— nowhere in app-mobile may a `rating:` field fall
 *                          back to a non-zero number (the D5 fabrication).
 * R6 NO VIEWER-GPS SWAP  — no producer may substitute the viewer's location for
 *                          a card's missing coordinates (the D3 fabrication).
 * R7 CANONICAL CONTENT   — the canonical mapper still carries the four fields
 *                          the divergences were actually about.
 *
 * R5 and R6 run against COMMENT-STRIPPED source: a gate that matches its own
 * explanatory comment is a gate that passes on a revert (#1633).
 *
 * Run:       node ./scripts/ci/issue-1669-expanded-card-one-producer.mjs
 * Self-test: node ./scripts/ci/issue-1669-expanded-card-one-producer.mjs --self-test
 *            (injects a synthetic NEW bypassing producer and proves R1/R3/R4 fire)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const appMobile = path.join(repoRoot, "app-mobile");

const CANONICAL_MAPPER =
  "app-mobile/src/components/utils/savedCardToExpandedCardData.ts";

/**
 * Symbols a surface may legitimately call to obtain an ExpandedCardData.
 * `savedCardToExpandedCardData` is the canonical producer; the other three are
 * NORMALISERS that rename a foreign source shape and then delegate to it (R4
 * proves the delegation is real).
 */
const SANCTIONED_PRODUCER_SYMBOLS = [
  "savedCardToExpandedCardData",
  "recommendationToExpandedCardData",
  "holidayCardToExpandedCardData",
  "fallbackCardToExpandedCardData",
  "cardPayloadToExpandedCardData",
];

/** Files allowed to render <ExpandedCardModal>, and how each one gets its data. */
const MOUNTS = [
  {
    file: "app-mobile/src/components/SwipeableCards.tsx",
    poolCards: true,
    note: "Explorer deck — tap, swipe-up and the dismissed-card review sheet.",
  },
  {
    file: "app-mobile/src/components/DiscoverScreen.tsx",
    poolCards: false,
    note:
      "Discover opens a TICKETMASTER event (NightOutCardData → nightOutData), " +
      "not a place-pool card. It carries no priceRangeStatus, no openingHours " +
      "and no utcOffsetMinutes because the source has none, so it cannot and " +
      "must not route through the pool-card mapper.",
  },
  {
    file: "app-mobile/src/components/activity/SavedTab.tsx",
    poolCards: true,
    note: "Likes.",
  },
  {
    file: "app-mobile/src/components/activity/CalendarTab.tsx",
    poolCards: true,
    note:
      "Calendar. Saved-card rows are pool cards and route through the mapper; " +
      "the reservation row builds a venue SHELL from a booking (see MINTS).",
  },
  {
    file: "app-mobile/src/components/MessageInterface.tsx",
    poolCards: true,
    note: "A card shared into a chat thread (via cardPayloadToExpandedCardData).",
  },
  {
    file: "app-mobile/src/components/SessionViewModal.tsx",
    poolCards: true,
    note: "Collab session view.",
  },
  {
    file: "app-mobile/src/components/chat/CollabSessionChatBanners.tsx",
    poolCards: true,
    note: "Collab Matches + Plans sheets (ORCH-1054).",
  },
  {
    file: "app-mobile/src/components/profile/ViewFriendProfileScreen.tsx",
    poolCards: true,
    note: "A friend's holiday/birthday cards and their liked cards (ORCH-0997).",
  },
];

/**
 * Files allowed to MINT the expanded-card shape, with the exact number of mint
 * sites each may contain. The cap is the point: a file may keep the one
 * non-pool literal it is sanctioned for without becoming a back door for a
 * second, pool-card one.
 */
const MINTS = [
  {
    file: CANONICAL_MAPPER,
    sites: 1,
    reason: "THE canonical producer. Every pool card is minted here and nowhere else.",
  },
  {
    file: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
    sites: 2,
    reason:
      "ORCH-0997 normalisers. HolidayCard/FallbackCard use different field NAMES " +
      "(imageUrl, googlePlaceId, stopsData); they rename and delegate (R4).",
  },
  {
    file: "app-mobile/src/components/DiscoverScreen.tsx",
    sites: 1,
    reason: "The Ticketmaster night-out event shell — not a pool card (see MOUNTS).",
  },
  {
    file: "app-mobile/src/components/activity/CalendarTab.tsx",
    sites: 1,
    reason:
      "META-ORCH-1148 reservation pass: a venue shell built from a BOOKING row " +
      "(brand_name/brand_lat/brand_address), not from the place pool.",
  },
  {
    file: "app-mobile/src/components/helpers/collabSaveCard.ts",
    sites: 1,
    reason:
      "Upstream: builds the `board_saved_cards.card_data` PAYLOAD that the " +
      "canonical mapper later reads. Not a modal producer.",
  },
  {
    file: "app-mobile/src/services/deckService.ts",
    sites: 2,
    reason:
      "Upstream: two server-row → Recommendation builders (place pool + the " +
      "category-fallback deck). Not a modal producer.",
  },
  {
    file: "app-mobile/src/utils/cardConverters.ts",
    sites: 1,
    reason:
      "Upstream: CuratedExperienceCard → Recommendation, before the deck sees it. " +
      "Not a modal producer.",
  },
  {
    file: "app-mobile/src/hooks/useMapCards.ts",
    sites: 1,
    reason: "Upstream card shape; the hook has zero importers today (dead code).",
  },
  {
    file: "app-mobile/src/hooks/usePairedMapSavedCards.ts",
    sites: 1,
    reason: "Upstream card shape; the hook has zero importers today (dead code).",
  },
  {
    file: "app-mobile/src/types/expandedCardTypes.ts",
    sites: 1,
    reason: "The type declaration itself.",
  },
  {
    file: "app-mobile/src/types/recommendation.ts",
    sites: 1,
    reason: "The Recommendation type declaration.",
  },
];

/** Every module allowed to export a `*ToExpandedCardData` producer. */
const PRODUCERS = [
  { file: CANONICAL_MAPPER, canonical: true },
  {
    file: "app-mobile/src/components/utils/recommendationToExpandedCardData.ts",
    canonical: false,
  },
  {
    file: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
    canonical: false,
  },
  { file: "app-mobile/src/services/cardPayloadAdapter.ts", canonical: false },
];

// ── source access ───────────────────────────────────────────────────────────

const readFile = (abs) => fs.readFileSync(abs, "utf8");

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(abs);
  }
  return out;
}

/**
 * Strip line and block comments so a rule can never be satisfied — or violated —
 * by prose. String literals are left alone; none of the rules below match inside
 * one. (#1633: a grep that hits your own comment passes on a revert.)
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Build the scanned corpus: repo-relative path → source. */
function collectSources() {
  const map = new Map();
  for (const root of [path.join(appMobile, "src"), path.join(appMobile, "app")]) {
    for (const abs of walk(root)) {
      map.set(path.relative(repoRoot, abs).split(path.sep).join("/"), readFile(abs));
    }
  }
  return map;
}

// ── detectors ───────────────────────────────────────────────────────────────

const MOUNT_RE = /<ExpandedCardModal[\s/>]/;

/**
 * A mint site is an object literal carrying the expanded-card REQUIRED-field
 * signature. All four keys are mandatory on ExpandedCardData, and nothing else
 * in app-mobile assigns the four together, so the quartet identifies a mint
 * without depending on how the value happens to be typed — which is what makes
 * an UNTYPED literal (the PersonHolidayView fallback, producer #8) detectable.
 */
const MINT_KEYS = [
  /\bcategoryIcon\s*:/,
  /\bfullDescription\s*:/,
  /\bmatchFactors\s*:/,
  /\bsocialStats\s*:/,
];

function isMintFile(stripped) {
  return MINT_KEYS.every((re) => re.test(stripped));
}

/**
 * Count mint SITES within a mint file: occurrences of `matchFactors:` that are
 * assigning a value (a literal, a call, or an identifier) rather than declaring
 * a type member (`matchFactors?: {` / `matchFactors: {` inside an interface is
 * counted too, which is why the type files declare a budget of 1).
 */
function countMintSites(stripped) {
  const matches = stripped.match(/\bmatchFactors\s*\??\s*:/g);
  return matches ? matches.length : 0;
}

const PRODUCER_EXPORT_RE = /export\s+function\s+(\w*[Tt]oExpandedCardData)\s*\(/g;

/** `rating:` falling back to a NON-ZERO number — the D5 fabrication. */
const FABRICATED_RATING_RE = /\brating\s*:[^,;\n]*(?:\|\||\?\?)\s*(?!0\b)\d/;

/** A card's location falling back to the VIEWER's position — the D3 fabrication. */
const VIEWER_GPS_SWAP_RE = /:\s*\n?\s*userLocation\s*\n?\s*\?\s*\{\s*lat:\s*userLocation/;

// ── rules ───────────────────────────────────────────────────────────────────

function runChecks(sources) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });
  const stripped = new Map(
    [...sources].map(([file, src]) => [file, stripComments(src)]),
  );

  // ── R1 · mount totality ───────────────────────────────────────────────────
  const registeredMounts = new Set(MOUNTS.map((m) => m.file));
  const actualMounts = new Set(
    [...stripped].filter(([, src]) => MOUNT_RE.test(src)).map(([file]) => file),
  );
  const unregisteredMounts = [...actualMounts].filter((f) => !registeredMounts.has(f));
  const vanishedMounts = [...registeredMounts].filter((f) => !actualMounts.has(f));
  check(
    "R1 [FAILS-ON-REVERT] every <ExpandedCardModal> mount is registered with a named producer",
    unregisteredMounts.length === 0 && vanishedMounts.length === 0,
    unregisteredMounts.length
      ? `UNREGISTERED mount(s): ${unregisteredMounts.join(", ")}. A new surface may not open the expanded card until its producer is declared in MOUNTS — that is how eleven of them accumulated.`
      : `Registered mount(s) no longer render <ExpandedCardModal>: ${vanishedMounts.join(", ")}. Remove the stale registry row (and say why) rather than leaving the gate asserting nothing.`,
  );

  // ── R2 · pool mounts route through a sanctioned producer ──────────────────
  const unroutedMounts = MOUNTS.filter((m) => m.poolCards).filter((m) => {
    const src = stripped.get(m.file) ?? "";
    return !SANCTIONED_PRODUCER_SYMBOLS.some((sym) =>
      new RegExp(`import[\\s\\S]{0,200}?\\b${sym}\\b[\\s\\S]{0,120}?from`).test(src),
    );
  });
  check(
    "R2 [FAILS-ON-REVERT] every pool-card mount imports a sanctioned producer",
    unroutedMounts.length === 0,
    `Pool-card surface(s) with no producer import: ${unroutedMounts
      .map((m) => m.file)
      .join(", ")}. Call savedCardToExpandedCardData (or a normaliser that delegates to it) — do not hand-write the object.`,
  );

  // ── R3 · mint totality + per-file budget ─────────────────────────────────
  const mintBudgets = new Map(MINTS.map((m) => [m.file, m.sites]));
  const actualMintFiles = [...stripped]
    .filter(([, src]) => isMintFile(src))
    .map(([file]) => file);
  const unregisteredMints = actualMintFiles.filter((f) => !mintBudgets.has(f));
  const overBudget = actualMintFiles
    .filter((f) => mintBudgets.has(f))
    .map((f) => ({ file: f, found: countMintSites(stripped.get(f)), allowed: mintBudgets.get(f) }))
    .filter((r) => r.found > r.allowed);
  const missingMints = [...mintBudgets.keys()].filter(
    (f) => !actualMintFiles.includes(f),
  );
  check(
    "R3 [FAILS-ON-REVERT] the expanded-card shape is minted only at registered sites, within budget",
    unregisteredMints.length === 0 && overBudget.length === 0 && missingMints.length === 0,
    [
      unregisteredMints.length
        ? `NEW mint site(s): ${unregisteredMints.join(", ")}. This is a twelfth producer. Route the surface through savedCardToExpandedCardData; if the shape genuinely is not a pool card, register it in MINTS with the reason.`
        : "",
      overBudget.length
        ? `Over budget: ${overBudget
            .map((r) => `${r.file} (${r.found} > ${r.allowed})`)
            .join(", ")}. A sanctioned non-pool literal is not a licence for a second one in the same file.`
        : "",
      missingMints.length
        ? `Registered mint file(s) no longer mint: ${missingMints.join(", ")}. Drop the stale row so the budget keeps meaning something.`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );

  // ── R4 · producer totality + delegation ──────────────────────────────────
  const registeredProducers = new Map(PRODUCERS.map((p) => [p.file, p]));
  const actualProducerFiles = [];
  for (const [file, src] of stripped) {
    PRODUCER_EXPORT_RE.lastIndex = 0;
    if (PRODUCER_EXPORT_RE.test(src)) actualProducerFiles.push(file);
  }
  const unregisteredProducers = actualProducerFiles.filter(
    (f) => !registeredProducers.has(f),
  );
  const nonDelegating = PRODUCERS.filter((p) => !p.canonical).filter((p) => {
    const src = stripped.get(p.file) ?? "";
    return !(
      /import\s*\{[^}]*savedCardToExpandedCardData[^}]*\}\s*from/.test(src) &&
      /savedCardToExpandedCardData\s*\(/.test(src)
    );
  });
  const missingProducers = [...registeredProducers.keys()].filter(
    (f) => !actualProducerFiles.includes(f),
  );
  check(
    "R4 [FAILS-ON-REVERT] every *ToExpandedCardData producer is registered AND delegates to the canonical mapper",
    unregisteredProducers.length === 0 &&
      nonDelegating.length === 0 &&
      missingProducers.length === 0,
    [
      unregisteredProducers.length
        ? `UNREGISTERED producer module(s): ${unregisteredProducers.join(", ")}. A new named mapper is the same defect as a new inline literal.`
        : "",
      nonDelegating.length
        ? `Producer(s) that FORK instead of delegating: ${nonDelegating
            .map((p) => p.file)
            .join(", ")}. A normaliser may rename fields; it may not decide which fields survive.`
        : "",
      missingProducers.length
        ? `Registered producer module(s) that export nothing: ${missingProducers.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );

  // ── R5 · no fabricated rating (comment-stripped) ─────────────────────────
  const fabricatedRating = [...stripped]
    .filter(([, src]) => FABRICATED_RATING_RE.test(src))
    .map(([file]) => file);
  check(
    "R5 [FAILS-ON-REVERT] no producer fabricates a rating for an unrated place",
    fabricatedRating.length === 0,
    `\`rating: … || <non-zero>\` found in: ${fabricatedRating.join(", ")}. Constitution #9 — missing data is HIDDEN (rating 0 hides the chip), never invented. A place with no rating showed 4.5 stars from Likes and no chip from the deck.`,
  );

  // ── R6 · no viewer-GPS substitution (comment-stripped) ───────────────────
  const viewerGpsSwap = [...stripped]
    .filter(([, src]) => VIEWER_GPS_SWAP_RE.test(src))
    .map(([file]) => file);
  check(
    "R6 [FAILS-ON-REVERT] no producer substitutes the viewer's GPS for a card's missing coordinates",
    viewerGpsSwap.length === 0,
    `Viewer-location fallback found in: ${viewerGpsSwap.join(", ")}. The modal fetches weather, busyness and booking from card.location — substituting the viewer's position renders THEIR weather under the VENUE's name.`,
  );

  // ── R7 · the canonical mapper still carries the contested fields ─────────
  const mapper = stripped.get(CANONICAL_MAPPER) ?? "";
  const carries = {
    price: /\.\.\.canonicalDiscoveryPriceFields\(c\)/.test(mapper),
    utcOffset:
      /utcOffsetMinutes:\s*\n?\s*num\(c\.utcOffsetMinutes\)\s*\?\?\s*num\(c\.utc_offset_minutes\)\s*\?\?\s*null/
        .test(mapper),
    honestRating: /rating:\s*num\(c\.rating\)\s*\?\?\s*0/.test(mapper),
    honestLocation:
      /location:\s*\n?\s*savedLocation\s*\?\?\s*\n?\s*\(lat != null && lng != null \? \{ lat, lng \} : undefined\)/
        .test(mapper),
    selectedDateTime:
      /selectedDateTime:\s*options\?\.selectedDateTime\s*\?\?\s*date\(c\.selectedDateTime\)/.test(
        mapper,
      ),
  };
  const missingFields = Object.entries(carries)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  check(
    "R7 [FAILS-ON-REVERT] the canonical mapper carries price, utcOffset, honest rating, honest location and selectedDateTime",
    missingFields.length === 0,
    `The canonical mapper stopped carrying: ${missingFields.join(", ")}. Collapsing every surface onto one mapper only helps while the mapper still carries the fields the surfaces disagreed about.`,
  );

  return checks;
}

function report(checks, label) {
  console.log(`\n[#1669 expanded-card-one-producer]${label ? ` ${label}` : ""}`);
  const failures = [];
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
    if (!c.pass) {
      failures.push(c);
      console.log(`  ${c.detail}`);
    }
  }
  return failures;
}

// ── entry ───────────────────────────────────────────────────────────────────

const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  // A NEW surface that opens the expanded card from its own hand-written
  // literal and its own named mapper — i.e. exactly the twelfth producer this
  // gate exists to stop. It must trip R1 (unregistered mount), R3
  // (unregistered mint site) and R4 (unregistered, non-delegating producer).
  const sources = collectSources();
  sources.set(
    "app-mobile/src/components/BrandNewSurface.tsx",
    `
import ExpandedCardModal from "./ExpandedCardModal";
import type { ExpandedCardData } from "../types/expandedCardTypes";

export function newSurfaceToExpandedCardData(card: any): ExpandedCardData {
  return {
    id: card.id,
    title: card.title,
    category: card.category,
    categoryIcon: card.categoryIcon,
    description: card.description,
    fullDescription: card.description,
    image: card.image,
    images: [card.image],
    rating: card.rating || 4.5,
    reviewCount: 0,
    distance: null,
    address: card.address,
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
  };
}

export default function BrandNewSurface({ card }: any) {
  return <ExpandedCardModal visible target={{ kind: "nightOut", data: newSurfaceToExpandedCardData(card) }} />;
}
`,
  );

  const checks = runChecks(sources);
  const failures = report(checks, "self-test (synthetic bypassing producer)");
  const failed = new Set(failures.map((f) => f.name.slice(0, 2)));
  const expected = ["R1", "R3", "R4", "R5"];
  const missed = expected.filter((r) => !failed.has(r));
  if (missed.length) {
    console.error(
      `\n#1669 self-test ERROR: a brand-new bypassing producer did NOT trip ${missed.join(", ")}. ` +
        "The gate would let the twelfth producer land — which is the entire failure mode it was written for.",
    );
    process.exit(1);
  }
  console.log(
    `\n#1669 self-test passed: a new bypassing producer trips ${expected.join(", ")}.`,
  );
  process.exit(0);
}

const failures = report(runChecks(collectSources()));
if (failures.length > 0) {
  console.error(
    `\n#1669 expanded-card-one-producer gate FAILED: ${failures.length} rule(s). ` +
      "The same place must not show different facts depending on which screen opened it.",
  );
  process.exit(1);
}
console.log(
  "\n#1669 expanded-card-one-producer gate PASS — one producer, one set of facts.",
);
