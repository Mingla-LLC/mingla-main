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
 *                          is EXACTLY the registry — PER EXPORTED FUNCTION, not
 *                          per file — and every one of them except the canonical
 *                          mapper delegates to it inside its OWN body.
 * R5 UNRATED IS HIDDEN   — no producer fabricates a rating, the canonical mapper
 *                          carries absence as absence, and — proven by EXECUTING
 *                          the real render guard — the star chip cannot render
 *                          for a missing or zero rating.
 * R6 NO VIEWER-GPS SWAP  — no producer may substitute the viewer's location for
 *                          a card's missing coordinates (the D3 fabrication).
 * R7 CANONICAL CONTENT   — the canonical mapper still carries the fields the
 *                          divergences were actually about.
 * R8 CAST TOTALITY       — every `as ExpandedCardData` / `as unknown as
 *                          ExpandedCardData` in app-mobile is at a registered
 *                          site, within budget.
 *
 * R5, R6 and R8 run against COMMENT-STRIPPED source: a gate that matches its own
 * explanatory comment is a gate that passes on a revert (#1633).
 *
 * ── WHY R8 EXISTS: the boundary of R3, stated plainly ──
 * R3 identifies a mint by the REQUIRED-field quartet `categoryIcon` +
 * `fullDescription` + `matchFactors` + `socialStats`. That quartet is a reliable
 * signature only because TypeScript is the co-enforcer: all four are mandatory
 * on `ExpandedCardData`, so a producer CANNOT omit one and still typecheck.
 *
 * A deliberate `as unknown as ExpandedCardData` disarms that co-enforcer, and a
 * producer that then omits a single quartet key is invisible to R3 — proven by
 * the tester on PR #1682, where exactly such a module passed all seven rules.
 * The cast is the necessary step in that bypass, and R8 is the rule that closes
 * it: you may still cast, but only at a site the registry names.
 *
 * Run:       node ./scripts/ci/issue-1669-expanded-card-one-producer.mjs
 * Self-test: node ./scripts/ci/issue-1669-expanded-card-one-producer.mjs --self-test
 *            (injects TWO synthetic bypassing producers — a naive one that
 *            trips R1/R3/R4/R5, and the tester's quartet-minus-one + cast that
 *            trips R8 — and proves the gate rejects both)
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

/**
 * Every EXPORTED `*ToExpandedCardData` function, named individually.
 *
 * Per-EXPORT, not per-file (#1669 rework, tester P2-2): the first cut asked
 * "does this FILE import and call the canonical mapper?", and the tester forked
 * `fallbackCardToExpandedCardData` back into a hand-written literal while its
 * sibling export `holidayCardToExpandedCardData` in the same file kept
 * delegating — so the file-level question still answered yes and R4 passed on a
 * genuine fork. The question is now asked of each function's OWN body.
 */
const PRODUCERS = [
  {
    file: CANONICAL_MAPPER,
    fn: "savedCardToExpandedCardData",
    canonical: true,
  },
  {
    file: "app-mobile/src/components/utils/recommendationToExpandedCardData.ts",
    fn: "recommendationToExpandedCardData",
    canonical: false,
  },
  {
    file: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
    fn: "holidayCardToExpandedCardData",
    canonical: false,
  },
  {
    file: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
    fn: "fallbackCardToExpandedCardData",
    canonical: false,
  },
  {
    file: "app-mobile/src/services/cardPayloadAdapter.ts",
    fn: "cardPayloadToExpandedCardData",
    canonical: false,
  },
];

/**
 * Every site allowed to assert a value IS an `ExpandedCardData` without the
 * compiler agreeing, and how many such casts the file may contain.
 *
 * See the R8 rationale in the header: the cast is what lets a producer skip a
 * required field and stay invisible to R3. Each entry below is a curated
 * pass-through or a compiler-appeasing non-null assertion — none of them decides
 * which fields survive. Adding a row here is a visible diff that asks the
 * reviewer the right question: why does this code know better than the type?
 *
 * Indexed-access casts (`as ExpandedCardData["location"]`) are NOT counted —
 * they narrow a single field to its declared type and cannot mint a card.
 */
const EXPANDED_CARD_CASTS = [
  {
    file: CANONICAL_MAPPER,
    casts: 2,
    reason:
      "The two curated pass-throughs. A curated plan is returned VERBATIM — " +
      "rebuilding it field-by-field was the ORCH-1054 bug.",
  },
  {
    file: "app-mobile/src/components/utils/recommendationToExpandedCardData.ts",
    casts: 1,
    reason: "The deck's curated pass-through, mirroring the canonical mapper.",
  },
  {
    file: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
    casts: 1,
    reason:
      "A HolidayCard always has an id + title, so the mapper never returns " +
      "null here; the cast drops the null, it does not build a card.",
  },
  {
    file: "app-mobile/src/services/cardPayloadAdapter.ts",
    casts: 1,
    reason:
      "Same shape: a CardPayload always has an id, so the ?? branch is for the " +
      "compiler and not a reachable state.",
  },
  {
    file: "app-mobile/src/components/SwipeableCards.tsx",
    casts: 1,
    reason: "The deck mount's curated pass-through, straight to the modal.",
  },
  {
    file: "app-mobile/src/components/ExpandedCardModal.tsx",
    casts: 1,
    reason:
      "The modal handing its own local card state to a child renderer — a " +
      "consumer, downstream of every producer.",
  },
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

/**
 * Blank the CONTENTS of string and template literals while preserving every
 * offset, so brace-matching (function-body extraction) cannot be thrown off by
 * a `{` inside a string. Quotes themselves are kept; only the interior becomes
 * spaces, and newlines survive so reported positions stay meaningful.
 */
function blankStringContents(src) {
  const out = src.split("");
  let i = 0;
  while (i < out.length) {
    const quote = out[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < out.length) {
      if (out[j] === "\\") {
        out[j] = " ";
        if (j + 1 < out.length && out[j + 1] !== "\n") out[j + 1] = " ";
        j += 2;
        continue;
      }
      if (out[j] === quote) break;
      // An unterminated single/double-quoted string cannot cross a newline.
      if (quote !== "`" && out[j] === "\n") break;
      if (out[j] !== "\n") out[j] = " ";
      j++;
    }
    i = j + 1;
  }
  return out.join("");
}

/**
 * Return the source of ONE function's body, given the index at which its
 * `export function` match started. Brace-matched on string-blanked source so a
 * brace inside a literal cannot end the body early.
 *
 * This is what makes R4 per-export (tester P2-2): a fork inside one function
 * can no longer hide behind a delegating sibling in the same file.
 */
function functionBody(blanked, matchIndex) {
  const open = blanked.indexOf("{", matchIndex);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === "{") depth++;
    else if (blanked[i] === "}") {
      depth--;
      if (depth === 0) return blanked.slice(open, i + 1);
    }
  }
  return blanked.slice(open);
}

/** Every exported `*ToExpandedCardData` in a file, with its own body. */
function producerExports(stripped) {
  const blanked = blankStringContents(stripped);
  const out = [];
  const re = new RegExp(PRODUCER_EXPORT_RE.source, "g");
  let m;
  while ((m = re.exec(blanked)) !== null) {
    out.push({ fn: m[1], body: functionBody(blanked, m.index) });
  }
  return out;
}

/**
 * A whole-object assertion to `ExpandedCardData`. Deliberately does NOT match an
 * indexed access (`as ExpandedCardData["location"]`), which narrows one field
 * and cannot mint a card.
 */
const EXPANDED_CARD_CAST_RE =
  /\bas\s+(?:unknown\s+as\s+)?ExpandedCardData\b(?!\s*\[)/g;

function countExpandedCardCasts(stripped) {
  const matches = blankStringContents(stripped).match(EXPANDED_CARD_CAST_RE);
  return matches ? matches.length : 0;
}

/** `rating:` falling back to a NON-ZERO number — the D5 fabrication. */
const FABRICATED_RATING_RE = /\brating\s*:[^,;\n]*(?:\|\||\?\?)\s*(?!0\b)\d/;

/**
 * `rating:` COERCED TO ZERO — the D5 fabrication's second form, and the one the
 * first repair pass shipped. `0` is not `undefined`, so the chip still rendered
 * and an unrated place read `★ 0.0`. Checked only inside the producer modules:
 * those are the four files that decide what `ExpandedCardData.rating` is.
 */
const ZERO_COERCED_RATING_RE = /\brating\s*:[^,;\n]*(?:\|\||\?\?)\s*0\b/;

/** The canonical mapper must carry a missing rating through as absence. */
const HONEST_RATING_RE = /rating:\s*num\(c\.rating\)\s*,/;

/** A card's location falling back to the VIEWER's position — the D3 fabrication. */
const VIEWER_GPS_SWAP_RE = /:\s*\n?\s*userLocation\s*\n?\s*\?\s*\{\s*lat:\s*userLocation/;

/**
 * The file that actually decides whether the star chip appears, and the JSX
 * guard that decides it. R5 EXECUTES this guard rather than describing it.
 */
// #1605 wave 4 — RE-POINTED, deliberately, because the chip MOVED.
//
// The star is no longer a `metricPill` inside CardInfoSection: it is span 1 of
// the hero plate's meta line, produced by `singlePlaceSpans`. R5's contract is
// unchanged — EXECUTE the real guard against the values an unrated place
// actually produces — and it is now executed one layer EARLIER, at the point
// that decides whether the fact exists at all rather than at one of the places
// that renders it. That is strictly stronger: the same expression now governs
// the deck card, the sheet's plate and anything else that draws the meta line.
const RATING_RENDER_FILE =
  "app-mobile/src/components/expandedCard/expandedCardFacts.ts";
const RATING_GUARD_RE =
  /if\s*\(([^)]*\brating\b[^)]*)\)\s*\{\s*spans\.push\(\{\s*kind:\s*'rating'/;

/**
 * Pull the real guard expression out of CardInfoSection and RUN it against the
 * values an unrated place actually produces. A gate that only greps for a
 * pattern is describing the fix; this one asks the source whether the chip
 * renders, and takes the answer.
 */
function ratingGuardVerdict(ratingSourceFile) {
  const m = RATING_GUARD_RE.exec(ratingSourceFile);
  if (!m) {
    return {
      ok: false,
      why:
        `Could not find the star-chip guard in ${RATING_RENDER_FILE}. R5 proves the chip is HIDDEN by ` +
        "executing that guard, so if the JSX moved, this rule is asserting nothing and must be re-pointed.",
    };
  }
  const expr = m[1].trim();
  let compiled;
  try {
    // eslint-disable-next-line no-new-func
    compiled = new Function("rating", `return Boolean(${expr});`);
  } catch (e) {
    return { ok: false, why: `The star-chip guard \`${expr}\` is not evaluable: ${e.message}` };
  }
  // A guard that calls a helper defined elsewhere in the component THROWS here
  // rather than returning — and an uncaught throw would take the whole gate
  // down with a stack trace instead of a verdict. Report it as the rule being
  // un-evaluable, which is a real failure: R5's entire value is that it runs
  // this expression, so a guard it cannot run leaves the rule asserting nothing.
  let threw = null;
  const guard = (v) => {
    if (threw) return false;
    try {
      return compiled(v);
    } catch (e) {
      threw = e;
      return false;
    }
  };
  const mustHide = [undefined, null, 0, 0.0, -1];
  const mustShow = [4.2, 0.1, 5];
  const shown = mustHide.filter((v) => guard(v));
  const hidden = mustShow.filter((v) => !guard(v));
  if (threw) {
    return {
      ok: false,
      why:
        `The star-chip guard \`${expr}\` could not be EXECUTED: ${threw.message}. R5 proves an unrated ` +
        "place shows no chip by running this expression against undefined / null / 0, so a guard that " +
        "depends on something outside it (a helper, a hook, another prop) leaves the rule asserting " +
        "nothing. Keep the condition self-contained in `rating`, or re-point the rule deliberately.",
    };
  }
  if (shown.length) {
    return {
      ok: false,
      why:
        `The star chip RENDERS for ${shown.map((v) => String(v)).join(", ")} under the real guard \`${expr}\`. ` +
        "An unrated place therefore shows a star pill — `rating !== undefined` printed `★ 0.0`, and an " +
        "invented zero reads as a real, terrible score. Constitution #9: missing data is HIDDEN.",
    };
  }
  if (hidden.length) {
    return {
      ok: false,
      why:
        `The star chip is HIDDEN for the genuine rating(s) ${hidden.join(", ")} under \`${expr}\`. ` +
        "Hiding a real rating is the opposite failure and just as wrong.",
    };
  }
  return { ok: true, expr };
}

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

  // ── R4 · producer totality + delegation, PER EXPORTED FUNCTION ───────────
  // Keyed by `file::fn`, not by file. A file with two exports where only one
  // delegates used to pass; the tester proved it by forking
  // `fallbackCardToExpandedCardData` back into a literal while its sibling in
  // the same file kept calling the mapper (P2-2).
  const producerKey = (file, fn) => `${file}::${fn}`;
  const registeredProducers = new Map(
    PRODUCERS.map((p) => [producerKey(p.file, p.fn), p]),
  );
  const actualProducers = [];
  for (const [file, src] of stripped) {
    for (const { fn, body } of producerExports(src)) {
      actualProducers.push({ file, fn, body, key: producerKey(file, fn) });
    }
  }
  const unregisteredProducers = actualProducers
    .filter((p) => !registeredProducers.has(p.key))
    .map((p) => p.key);
  // The delegation question is asked of each function's OWN body. The file-level
  // import is still required — a body cannot call what the module never imported.
  const nonDelegating = actualProducers
    .filter((p) => registeredProducers.get(p.key)?.canonical === false)
    .filter((p) => {
      const src = stripped.get(p.file) ?? "";
      const imports =
        /import\s*\{[^}]*savedCardToExpandedCardData[^}]*\}\s*from/.test(src);
      const bodyDelegates = /savedCardToExpandedCardData\s*\(/.test(p.body);
      return !(imports && bodyDelegates);
    })
    .map((p) => p.key);
  const actualKeys = new Set(actualProducers.map((p) => p.key));
  const missingProducers = [...registeredProducers.keys()].filter(
    (k) => !actualKeys.has(k),
  );
  check(
    "R4 [FAILS-ON-REVERT] every exported *ToExpandedCardData function is registered AND delegates, per export",
    unregisteredProducers.length === 0 &&
      nonDelegating.length === 0 &&
      missingProducers.length === 0,
    [
      unregisteredProducers.length
        ? `UNREGISTERED producer export(s): ${unregisteredProducers.join(", ")}. A new named mapper is the same defect as a new inline literal.`
        : "",
      nonDelegating.length
        ? `Producer export(s) that FORK instead of delegating: ${nonDelegating.join(
            ", ",
          )}. A normaliser may rename fields; it may not decide which fields survive. This is checked inside each function's OWN body, so a delegating sibling in the same file no longer covers for a forked one.`
        : "",
      missingProducers.length
        ? `Registered producer export(s) that no longer exist: ${missingProducers.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );

  // ── R5 · an unrated place shows NO chip — verified, not described ────────
  // Three parts, because the first repair pass got the sign right and the value
  // wrong: it removed `|| 4.5` and wrote `?? 0`, and three artefacts on that
  // branch — this rule's own failure message included — then ASSERTED that the
  // modal hides the chip at 0 while it demonstrably printed `★ 0.0`.
  //   (a) no producer invents a non-zero rating   — the original D5;
  //   (b) no producer coerces a missing one to 0  — the D5 the repair shipped;
  //   (c) the REAL render guard is extracted from CardInfoSection and EXECUTED
  //       against undefined / null / 0, and must hide for all three.
  // (c) is the part that stops this rule ever again describing behaviour it has
  // not checked (the #1607/#1627/#1631/#1633 defect class).
  const fabricatedRating = [...stripped]
    .filter(([, src]) => FABRICATED_RATING_RE.test(src))
    .map(([file]) => file);
  const producerFiles = [...new Set(PRODUCERS.map((p) => p.file))];
  const zeroCoercedRating = producerFiles.filter((f) =>
    ZERO_COERCED_RATING_RE.test(stripped.get(f) ?? ""),
  );
  const mapperSrc = stripped.get(CANONICAL_MAPPER) ?? "";
  const mapperCarriesAbsence = HONEST_RATING_RE.test(mapperSrc);
  const guard = ratingGuardVerdict(stripped.get(RATING_RENDER_FILE) ?? "");
  check(
    "R5 [FAILS-ON-REVERT] an unrated place renders NO star chip (render guard executed, not described)",
    fabricatedRating.length === 0 &&
      zeroCoercedRating.length === 0 &&
      mapperCarriesAbsence &&
      guard.ok,
    [
      fabricatedRating.length
        ? `\`rating: … || <non-zero>\` found in: ${fabricatedRating.join(", ")}. A place with no rating showed 4.5 stars.`
        : "",
      zeroCoercedRating.length
        ? `\`rating: … ?? 0\` found in producer(s): ${zeroCoercedRating.join(", ")}. Coercing a missing rating to zero is not hiding it — \`0\` is a number, and the modal printed it as \`★ 0.0\`. An invented zero is worse than an invented 4.5 because it looks like a real, terrible score. Carry absence as absence.`
        : "",
      mapperCarriesAbsence
        ? ""
        : `The canonical mapper no longer carries a missing rating through as absence (expected \`rating: num(c.rating),\` in ${CANONICAL_MAPPER}). Every surface inherits this one line.`,
      guard.ok ? "" : guard.why,
    ]
      .filter(Boolean)
      .join(" | "),
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
    // The rating's HONESTY is R5's job now (it executes the render guard);
    // R7 only asserts the field is still carried at all.
    honestRating: HONEST_RATING_RE.test(mapper),
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

  // ── R8 · cast totality ───────────────────────────────────────────────────
  // R3's quartet detector works because TypeScript makes all four keys
  // mandatory. `as unknown as ExpandedCardData` is the one move that removes
  // that co-enforcement, and a producer that then omits ONE quartet key is
  // invisible to R3 — demonstrated on PR #1682, where such a module passed all
  // seven rules. Casting is still allowed; casting UNREGISTERED is not.
  const castBudgets = new Map(EXPANDED_CARD_CASTS.map((c) => [c.file, c.casts]));
  const castCounts = new Map(
    [...stripped]
      .map(([file, src]) => [file, countExpandedCardCasts(src)])
      .filter(([, n]) => n > 0),
  );
  const unregisteredCasts = [...castCounts.keys()].filter(
    (f) => !castBudgets.has(f),
  );
  const castsOverBudget = [...castCounts]
    .filter(([f]) => castBudgets.has(f))
    .filter(([f, n]) => n > castBudgets.get(f))
    .map(([f, n]) => `${f} (${n} > ${castBudgets.get(f)})`);
  const vanishedCasts = [...castBudgets.keys()].filter((f) => !castCounts.has(f));
  check(
    "R8 [FAILS-ON-REVERT] every ExpandedCardData cast is at a registered site, within budget",
    unregisteredCasts.length === 0 &&
      castsOverBudget.length === 0 &&
      vanishedCasts.length === 0,
    [
      unregisteredCasts.length
        ? `UNREGISTERED \`as ExpandedCardData\` cast(s) in: ${unregisteredCasts.join(", ")}. The cast disarms the compiler, which is what lets a producer omit a required field and stay invisible to R3's quartet detector. Route the shape through savedCardToExpandedCardData; if it genuinely must be asserted, register the site in EXPANDED_CARD_CASTS with the reason.`
        : "",
      castsOverBudget.length
        ? `Over cast budget: ${castsOverBudget.join(", ")}. A sanctioned curated pass-through is not a licence for a second, hand-built one beside it.`
        : "",
      vanishedCasts.length
        ? `Registered cast site(s) no longer cast: ${vanishedCasts.join(", ")}. Drop the stale row so the budget keeps meaning something.`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
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
  const failures = report(checks, "self-test A (naive bypassing producer)");
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
    `\n#1669 self-test A passed: a new bypassing producer trips ${expected.join(", ")}.`,
  );

  // ── self-test B · the tester's bypass (PR #1682, P2-1) ────────────────────
  // A producer that OMITS `matchFactors` and reaches the required type with
  // `as unknown as ExpandedCardData`. It does not mount the modal itself — it
  // hands the object to a mount that IS registered and DOES import a sanctioned
  // producer — so R1 and R2 stay quiet, and with only three of the four quartet
  // keys R3's detector never sees it. This passed all seven rules before R8.
  const castSources = collectSources();
  castSources.set(
    "app-mobile/src/components/utils/quietBypassProducer.ts",
    `
import type { ExpandedCardData } from "../../types/expandedCardTypes";

export function buildQuietly(card: any) {
  return {
    id: card.id,
    title: card.title,
    category: card.category,
    categoryIcon: card.categoryIcon,
    description: card.description,
    fullDescription: card.description,
    image: card.image,
    images: [card.image],
    rating: card.rating,
    reviewCount: 0,
    distance: null,
    address: card.address,
    highlights: [],
    tags: [],
    matchScore: 0,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
  } as unknown as ExpandedCardData;
}
`,
  );
  const castChecks = runChecks(castSources);
  const castFailures = report(
    castChecks,
    "self-test B (quartet-minus-one + cast — the tester's bypass)",
  );
  const castFailed = new Set(castFailures.map((f) => f.name.slice(0, 2)));
  if (!castFailed.has("R8")) {
    console.error(
      "\n#1669 self-test ERROR: a producer that omits `matchFactors` and casts " +
        "`as unknown as ExpandedCardData` did NOT trip R8. That is the exact bypass the " +
        "tester demonstrated on PR #1682 — it evades R3's quartet detector because the cast " +
        "removes TypeScript as the co-enforcer, and it evades R1/R2 because it never mounts " +
        "the modal itself. Without R8 the gate is blind to it.",
    );
    process.exit(1);
  }
  console.log(
    "\n#1669 self-test B passed: the quartet-minus-one + cast bypass trips R8.",
  );

  // ── self-test C · a forked export hiding behind a delegating sibling ──────
  // R4 used to ask its question of the FILE. The tester forked
  // `fallbackCardToExpandedCardData` into a hand-written literal and R4 still
  // passed, because `holidayCardToExpandedCardData` in the same file kept
  // delegating. Prove the per-export check catches exactly that.
  const forkSources = collectSources();
  const holidayFile =
    "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts";
  const holidaySrc = forkSources.get(holidayFile) ?? "";
  const forkedFallback = holidaySrc.replace(
    /export function fallbackCardToExpandedCardData\([\s\S]*$/,
    `export function fallbackCardToExpandedCardData(
  c: FallbackCardLike,
  opts: HolidayCardMapOpts,
): ExpandedCardData | null {
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    categoryIcon: getCategoryIcon(c.category),
    description: '',
    fullDescription: '',
    image: c.image,
    images: c.image ? [c.image] : [],
    rating: c.rating,
    reviewCount: 0,
    distance: null,
    travelTime: null,
    travelMode: opts.travelMode,
    address: c.address,
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
  };
}
`,
  );
  forkSources.set(holidayFile, forkedFallback);
  const forkChecks = runChecks(forkSources);
  const forkFailures = report(
    forkChecks,
    "self-test C (one export forked, its sibling still delegating)",
  );
  const forkFailed = new Set(forkFailures.map((f) => f.name.slice(0, 2)));
  if (!forkFailed.has("R4")) {
    console.error(
      "\n#1669 self-test ERROR: `fallbackCardToExpandedCardData` was forked back into a " +
        "hand-written literal and R4 did NOT fire. Its sibling export in the same file still " +
        "delegates, which is exactly how the file-level check passed on a genuine fork " +
        "(tester P2-2). R4 must ask the question of each exported function's own body.",
    );
    process.exit(1);
  }
  console.log(
    "\n#1669 self-test C passed: a forked export trips R4 even with a delegating sibling.",
  );

  console.log("\n#1669 self-test passed (A, B and C).");
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
