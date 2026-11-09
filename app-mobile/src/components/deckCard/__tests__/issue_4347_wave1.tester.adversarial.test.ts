/**
 * #4347 wave 1 — TESTER ADVERSARIAL for the collapsed Explorer deck card.
 *
 * The implementor's suites run the pure producers on daytime hours, check the
 * tap zones as geometry, and check the claimed-venue chunking once. This suite
 * attacks the seams between them:
 *
 *   L  the gesture lease: the REAL `requestTapPhoto` body is transplanted out of
 *      useDeckSwipeController.ts and executed against the REAL admission
 *      predicate for every (phase, panActivated) cell. A photo flip may run
 *      only where an expand tap may, after the press is released, and never
 *      alongside a swipe or an expand. Every flip in SwipeableCards goes
 *      through it.
 *   T  the smart chip in the venue's OWN time zone, and across midnight.
 *   V  the claimed-venue read: chunk keys stay put while the deck is swiped
 *      or paged, so a swipe never re-reads, and malformed rows never route.
 *   H  the one-time hint flag is cleared by the private logout sweep.
 *   I  the deck.* keys and the stop-count plural forms in all 29 locales.
 *   K  the kicker's 4.5:1 floor at the large-text sizes the spec supports.
 *
 * KNOWN DEFECTS are pinned with `test.failing` (they pass while the defect is
 * present and turn RED once fixed — then flip them to `test`):
 *   T-3  "Closed when you arrive" fires on a bar that is open until 2am when
 *        the arrival crosses midnight into a day listed "Closed".
 *   K-2  the kicker drops below 4.5:1 at 1.3x text on a white photo.
 *
 * FAILS-ON-REVERT (verified by the tester, see #4347):
 *   - requestTapPhoto without its admission gate, or gated by
 *     canAdmitDeckInput instead of canAdmitDeckTapExpand -> L-1 fails;
 *   - requestTapPhoto calling flip() before releaseUnactivatedPress -> L-1 fails;
 *   - placeSmartChip ignoring utcOffsetMinutes -> T-1 fails;
 *   - useClaimedVenues fed `availableRecommendations` (re-keys every swipe) -> V-2 fails;
 *   - removing ru `expanded.stop_count_few` -> I-2 fails.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import * as fs from "fs";
import * as path from "path";

import { placeSmartChip, curatedSmartChip } from "../deckCardModel";
import { getOpenStatusAt } from "../../../utils/openingHoursUtils";
import { claimedVenueChunks, claimedVenueKeys, toClaimedVenue } from "../../../hooks/useClaimedVenues";
import {
  canAdmitDeckInput,
  canAdmitDeckTapExpand,
  DECK_SWIPE_PHASES,
} from "../../swipeDeck/deckSwipeLifecycle";

const CI = require("../../../../../packages/card-identity/index.js");

const SRC = path.resolve(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The body of `const name = useCallback((...) => { BODY }, [...])`. */
function callbackBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) throw new Error(`${name} is gone`);
  const open = src.indexOf("{", src.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`${name} has no closing brace`);
}

// ─────────────────────────────────────────────────────────────────────────────
// L — the gesture lease
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv L — a photo flip rides the expand tap's lease, never a swipe's", () => {
  const controller = stripComments(read("components/swipeDeck/useDeckSwipeController.ts"));
  const body = callbackBody(controller, "requestTapPhoto");

  function run(phase: string, panActivated: boolean, activeCardId: string | null) {
    const log: string[] = [];
    const ctx = {
      phaseRef: { current: phase },
      panActivatedRef: { current: panActivated },
      activeCardIdRef: { current: activeCardId },
      canAdmitDeckTapExpand,
      canAdmitDeckInput,
      rejectInput: () => log.push("reject"),
      releaseUnactivatedPress: () => {
        log.push("release");
        // The real release returns an unactivated DRAGGING press to IDLE.
        if (ctx.phaseRef.current === "DRAGGING" && !ctx.panActivatedRef.current) ctx.phaseRef.current = "IDLE";
      },
      optionsRef: { current: { onExpandRequested: () => log.push("EXPAND") } },
      beginExit: () => log.push("SWIPE"),
      setPhase: (p: string) => log.push(`setPhase:${p}`),
    };
    const flip = () => log.push(`flip@${ctx.phaseRef.current}`);
    const fn = new Function(...Object.keys(ctx), "flip", body);
    const result = fn(...Object.values(ctx), flip);
    return { result, log };
  }

  test("L-1 every (phase, panActivated) cell: flip iff an expand tap would be admitted", () => {
    for (const phase of DECK_SWIPE_PHASES) {
      for (const panActivated of [false, true]) {
        const admitted = canAdmitDeckTapExpand(phase, panActivated);
        const { result, log } = run(phase, panActivated, "card-1");
        const label = `${phase}/${panActivated ? "activated" : "unactivated"}`;
        expect({ label, result }).toEqual({ label, result: admitted });
        if (admitted) {
          // Released FIRST, then flipped on an IDLE deck — the press can never
          // strand the pan's lease and the next swipe starts clean.
          expect({ label, log }).toEqual({ label, log: ["release", "flip@IDLE"] });
        } else {
          expect({ label, log }).toEqual({ label, log: ["reject"] });
        }
        expect(log).not.toContain("SWIPE");
        expect(log).not.toContain("EXPAND");
      }
    }
  });

  test("L-1b a mid-swipe tap (pan activated) never flips; no card on top never flips", () => {
    expect(run("DRAGGING", true, "card-1").log).toEqual(["reject"]);
    for (const phase of DECK_SWIPE_PHASES) {
      expect(run(phase, false, null).log).toEqual(["reject"]);
    }
  });

  test("L-2 every photo flip in the deck goes through requestTapPhoto", () => {
    const deck = stripComments(read("components/SwipeableCards.tsx"));
    const calls = [...deck.matchAll(/flipCurrentPhoto\(/g)].map((m) => m.index as number);
    const declaration = deck.indexOf("const flipCurrentPhoto = ");
    expect(declaration).toBeGreaterThan(-1);
    const uses = calls.filter((i) => i !== declaration + "const ".length);
    expect(uses.length).toBeGreaterThanOrEqual(2); // the tap path and the VoiceOver actions
    for (const index of uses) {
      const before = deck.slice(Math.max(0, index - 40), index);
      expect(before).toMatch(/requestTapPhoto\(\(\) =>\s*$/);
    }
    // The tap path decides the zone, and only the 'open' zone expands.
    expect(deck).toMatch(/if \(zone === 'open'\) \{\s*deckSwipe\.requestTapExpand\(\);\s*return;\s*\}\s*deckSwipe\.requestTapPhoto\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T — the smart chip in the venue's own time and across midnight
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv T — 'Closed when you arrive' is judged in venue time", () => {
  const LAGOS = 60;
  const DAILY_TO_11 = [
    "Monday: 12:00 PM – 11:00 PM",
    "Tuesday: 12:00 PM – 11:00 PM",
    "Wednesday: 12:00 PM – 11:00 PM",
    "Thursday: 12:00 PM – 11:00 PM",
    "Friday: 12:00 PM – 11:00 PM",
    "Saturday: 12:00 PM – 11:00 PM",
    "Sunday: 12:00 PM – 11:00 PM",
  ];

  test("T-1 a Lagos venue closing at 11pm, viewed at 22:30 Lagos with 45 min travel, warns", () => {
    // 21:30Z = 22:30 in Lagos. In UTC (or New York) the place still looks open
    // at arrival, so a chip computed in device time would stay silent.
    const now = new Date("2026-11-09T21:30:00Z");
    expect(placeSmartChip({ openingHours: DAILY_TO_11, utcOffsetMinutes: LAGOS, travelTime: "45 min" }, now)).toEqual({
      kind: "closedAtArrival",
      tone: "warn",
    });
    // Same instant, 20 min away: arrives 22:50, open. No chip.
    expect(placeSmartChip({ openingHours: DAILY_TO_11, utcOffsetMinutes: LAGOS, travelTime: "20 min" }, now)).toBeNull();
  });

  test("T-2 unreadable travel, zero travel, or unknown hours never warn", () => {
    const now = new Date("2026-11-09T21:30:00Z");
    for (const travelTime of [null, "", "soon", "0 min", "-5 min"]) {
      expect(placeSmartChip({ openingHours: DAILY_TO_11, utcOffsetMinutes: LAGOS, travelTime }, now)).toBeNull();
    }
    expect(placeSmartChip({ openingHours: null, utcOffsetMinutes: LAGOS, travelTime: "45 min" }, now)).toBeNull();
    expect(curatedSmartChip([{ openingHours: null, travelTimeFromUserMin: 600 }], now)).toBeNull();
  });

  const BAR = [
    "Monday: Closed",
    "Tuesday: Closed",
    "Wednesday: Closed",
    "Thursday: Closed",
    "Friday: 6:00 PM – 2:00 AM",
    "Saturday: 6:00 PM – 2:00 AM",
    "Sunday: Closed",
  ];
  // Saturday 7 Nov 2026, 23:30 in Lagos = 22:30Z. The bar is open until 2am.
  const SAT_2330 = new Date("2026-11-07T22:30:00Z");

  test("T-0 the status line itself reads the overnight range correctly", () => {
    expect(getOpenStatusAt(BAR, SAT_2330, LAGOS)).toEqual({ kind: "open", closesAtMinute: 120, minutesLeft: 150 });
    // 00:15 Sunday at the venue: still Saturday night's range.
    const arrival = new Date(SAT_2330.getTime() + 45 * 60_000);
    expect(getOpenStatusAt(BAR, arrival, LAGOS)).toEqual({ kind: "open", closesAtMinute: 120, minutesLeft: 105 });
  });

  // KNOWN DEFECT (P1 on #4347): placeSmartChip asks isPlaceOpenAt, which reads
  // only the ARRIVAL day's own line ("Sunday: Closed") and ignores Saturday's
  // range running past midnight. The card then reads "Open until 2am" AND
  // "Closed when you arrive". Fix: decide arrival with getOpenStatusAt (the
  // status line's own parser). Flip to `test` when fixed.
  test.failing("T-3 KNOWN DEFECT: no 'Closed when you arrive' on a bar open until 2am, arriving 00:15", () => {
    expect(placeSmartChip({ openingHours: BAR, utcOffsetMinutes: LAGOS, travelTime: "45 min" }, SAT_2330)).toBeNull();
  });

  test.failing("T-3b KNOWN DEFECT: the same for a curated stop reached after midnight", () => {
    expect(
      curatedSmartChip([{ openingHours: BAR, utcOffsetMinutes: LAGOS, travelTimeFromUserMin: 45 }], SAT_2330),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V — the claimed-venue read
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv V — claimed venues: a handful of reads per deck, never per card or per swipe", () => {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

  test("V-1 paging the deck (ids appended) keeps every earlier full chunk's query key", () => {
    const first = claimedVenueChunks(Array.from({ length: 100 }, (_, i) => id(i)));
    const paged = claimedVenueChunks(Array.from({ length: 130 }, (_, i) => id(i)));
    expect(first.length).toBe(2);
    expect(paged.length).toBe(3);
    expect(claimedVenueKeys.chunk(paged[0])).toEqual(claimedVenueKeys.chunk(first[0]));
    expect(claimedVenueKeys.chunk(paged[1])).toEqual(claimedVenueKeys.chunk(first[1]));
    // Curated / experience cards (null), duplicates and junk add no reads.
    const noisy = claimedVenueChunks([...Array.from({ length: 50 }, (_, i) => id(i)), null, undefined, id(3), "DROP TABLE", ""]);
    expect(noisy.length).toBe(1);
  });

  test("V-2 the deck feeds the WHOLE loaded deck, so a swipe never re-keys the chunks", () => {
    const deck = stripComments(read("components/SwipeableCards.tsx"));
    const call = deck.slice(deck.indexOf("useClaimedVenues("), deck.indexOf("useClaimedVenues(") + 300);
    expect(call).toMatch(/\(recommendations \|\| \[\]\)\.map/);
    expect(call).not.toMatch(/availableRecommendations/);
    // And the hook caches each chunk for 10 minutes.
    const hook = stripComments(read("hooks/useClaimedVenues.ts"));
    expect(hook).toMatch(/staleTime:\s*10 \* 60 \* 1000/);
    expect(hook).toMatch(/\.from\("venue_public_view"\)/);
    expect(hook).toMatch(/\.in\("place_pool_id", ids/);
  });

  test("V-3 a row that cannot build both slugs never routes", () => {
    for (const row of [
      { place_pool_id: "p", slug: "   ", brand_slug: "b", brand_name: "B" },
      { place_pool_id: "p", slug: "v", brand_slug: "  ", brand_name: "B" },
      { place_pool_id: "p", slug: null, brand_slug: "b", brand_name: "B" },
      { place_pool_id: "p", slug: "v", brand_slug: null, brand_name: "B" },
      { place_pool_id: 42 as unknown as string, slug: "v", brand_slug: "b", brand_name: "B" },
    ]) {
      expect(toClaimedVenue(row)).toBeNull();
    }
    // Padding is trimmed so the route never carries spaces.
    expect(toClaimedVenue({ place_pool_id: "p", slug: " v ", brand_slug: " b ", brand_name: " B " })).toEqual({
      placePoolId: "p",
      brandSlug: "b",
      venueSlug: "v",
      brandName: "B",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H — the one-time hint and logout
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv H — the hint flag is swept by the private logout cleanup", () => {
  test("H-1 the hint's AsyncStorage key carries a prefix authCleanup removes", () => {
    const hooks = read("components/deckCard/deckCardHooks.ts");
    const key = /PHOTO_HINT_STORAGE_KEY = '([^']+)'/.exec(hooks)?.[1];
    expect(key).toBeTruthy();
    const cleanup = read("utils/authCleanup.ts");
    const prefixes = [...cleanup.matchAll(/key\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(prefixes.some((prefix) => (key as string).startsWith(prefix))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I — the deck keys and plural forms in every locale
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv I — 29 locales", () => {
  const dir = path.join(SRC, "i18n/locales");
  const locales = fs.readdirSync(dir).filter((l) => fs.existsSync(path.join(dir, l, "cards.json")));
  const load = (l: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(dir, l, "cards.json"), "utf8"));
  const en = load("en");
  const placeholders = (v: string) => (v.match(/{{[^}]+}}/g) ?? []).sort().join(",");

  test("I-1 every deck.* key exists, is non-empty and keeps English's placeholders", () => {
    expect(locales.length).toBe(29);
    const keys = Object.keys(en).filter((k) => k.startsWith("deck."));
    expect(keys.length).toBeGreaterThanOrEqual(19);
    const problems: string[] = [];
    for (const l of locales) {
      const p = load(l);
      for (const k of keys) {
        if (typeof p[k] !== "string" || p[k].trim() === "") problems.push(`${l} missing ${k}`);
        else if (placeholders(p[k]) !== placeholders(en[k])) problems.push(`${l} ${k}: ${p[k]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("I-2 '{{count}} stops' has every plural form a real stop count (0–20) can select", () => {
    const problems: string[] = [];
    for (const l of locales) {
      const p = load(l);
      let rules: Intl.PluralRules;
      try {
        rules = new Intl.PluralRules(l);
      } catch {
        rules = new Intl.PluralRules("en");
      }
      for (let n = 0; n <= 20; n += 1) {
        const key = `expanded.stop_count_${rules.select(n)}`;
        const value = p[key] ?? p["expanded.stop_count"];
        if (typeof value !== "string" || value.trim() === "") problems.push(`${l} n=${n} needs ${key}`);
        else if (n > 2 && !value.includes("{{count}}")) problems.push(`${l} ${key} drops the count: ${value}`);
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K — the kicker's contrast floor
// ─────────────────────────────────────────────────────────────────────────────

describe("#4347 adv K — the kicker over a white photo", () => {
  const S1 = CI.SURFACES.s1Single;
  const H = CI.surfaceScrimHeight("s1Single");
  const alphaAt = (t: number): number => {
    const L = CI.RAMP.bottom.locations as number[];
    const A = CI.RAMP.bottom.alphas as number[];
    if (t <= L[0]) return A[0];
    for (let i = 1; i < L.length; i += 1) if (t <= L[i]) return A[i - 1] + ((t - L[i - 1]) / (L[i] - L[i - 1])) * (A[i] - A[i - 1]);
    return A[A.length - 1];
  };
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  /** White text over a pure-white photo under the bottom ramp, at `depth` pt up from the card's bottom. */
  const contrastAtDepth = (depth: number) => 1.05 / (lin(255 * (1 - alphaAt(1 - depth / H))) + 0.05);
  /** The kicker's top edge when the title (2 lines) and kicker are scaled by `scale` (RN scales lineHeight too). */
  const kickerDepth = (titleScale: number, kickerScale: number) =>
    CI.kickerTopDepthForLines("s1Single", S1.metaLines) +
    S1.titleLines * S1.titleLH * (titleScale - 1) +
    CI.KICKER.lineHeight * (kickerScale - 1);

  test("K-1 at default text size the kicker clears 4.5:1 with the deck's own scrim", () => {
    expect(contrastAtDepth(kickerDepth(1, 1))).toBeGreaterThanOrEqual(4.5);
  });

  // KNOWN DEFECT (P2 on #4347): the clause is solved at 1.0x only. The spec
  // supports large text up to 1.3x; a two-line title at 1.3x lifts the kicker
  // ~26pt into thinner scrim (≈3.9:1), and the title cap is 1.4x (≈3.6:1).
  // The kicker has no text shadow. Fix: solve K_KICKER at the max scale, or
  // give the kicker the title's shadow. Flip to `test` when fixed.
  test.failing("K-2 KNOWN DEFECT: at 1.3x text the kicker still clears 4.5:1", () => {
    expect(contrastAtDepth(kickerDepth(1.3, 1.3))).toBeGreaterThanOrEqual(4.5);
  });
});
