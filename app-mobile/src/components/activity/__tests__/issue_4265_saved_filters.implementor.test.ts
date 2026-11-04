// @ts-nocheck — Deno-runtime suite (deno2-discovered lane); app-mobile's tsc sweep has no Deno globals.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
/**
 * Issue #4265 — Likes → Saved search + filters and the small Saved | Calendar
 * switcher (SearchFilter.dc.html, Main.dc.html). Implementor happy-path suite.
 *
 *   deno test --allow-read --no-check \
 *     app-mobile/src/components/activity/__tests__/issue_4265_saved_filters.implementor.test.ts
 *
 * The filter/sort model runs for real against the app's own helpers
 * (isBrandExperiencePayload, getCategorySlug, extractWeekdayText,
 * isPlaceOpenAt, isSavedEventEnded). RN wiring that cannot mount here is
 * pinned as source structure, like the #1636 / #4265 grid suites beside it.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  DEFAULT_SAVED_FILTERS,
  activeSheetFilterCount,
  applySavedFilters,
  buildSavedFilterIndex,
  clearSheetFilters,
  hasAnySavedFilter,
  parseDistanceKm,
  parseTravelMinutes,
  savedBudgetOf,
  savedCardKind,
  savedCategoryOptions,
  toggleIn,
} from "../savedFiltersModel.ts";
import { isSavedEventEnded } from "../savedGridModel.ts";
import { isBrandExperiencePayload } from "../../../utils/isBrandExperiencePayload.ts";
import { getCategorySlug } from "../../../utils/categoryUtils.ts";
import { extractWeekdayText, isPlaceOpenAt } from "../../../utils/openingHoursUtils.ts";

const appRoot = new URL("../../../../", import.meta.url);
const read = (rel: string): Promise<string> => Deno.readTextFile(new URL(rel, appRoot));
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LOCALES = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"] as const;

// ── Fixtures ───────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  casual_food: "Comida informal",
  upscale_fine_dining: "Alta cocina",
  drinks_and_music: "Bebidas y música",
  romantic: "Romántico",
};
let labelCalls = 0;
// Mirrors constants/priceTiers.ts priceTierFromAmount (that module boots i18n,
// so it cannot load here); SavedTab wires the real one — pinned below.
const priceTierFromUsd = (min: number, max: number) => {
  const amount = max > 0 ? max : min;
  if (amount <= 50) return "chill";
  if (amount <= 150) return "comfy";
  if (amount <= 300) return "bougie";
  return "lavish";
};
const RATES: Record<string, number> = { NGN: 1500 };
const DEPS = {
  categoryLabel: (slug: string) => {
    labelCalls += 1;
    return LABELS[slug] ?? slug;
  },
  priceTierFromUsd,
  toUsd: (amount: number, currency: string) =>
    currency === "USD" ? amount : RATES[currency] ? amount / RATES[currency] : null,
  isBrandExperience: isBrandExperiencePayload,
  categorySlug: getCategorySlug,
  weekdayText: extractWeekdayText,
};
const HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
  (d) => `${d}: 9:00 AM – 5:00 PM`,
);
// Monday 2 Nov 2026, venue offset 0.
const NOON = new Date("2026-11-02T12:00:00Z");
const EVENING = new Date("2026-11-02T20:00:00Z");
const OPTS = (now: Date, excludeIds?: Set<string>) => ({
  now,
  excludeIds,
  isOpenAt: isPlaceOpenAt,
  isEventEnded: isSavedEventEnded,
});
const usdPrice = (major: number) => ({
  priceRangeStatus: "active",
  sourceMinMinor: major * 100,
  sourceMaxMinor: major * 100,
  sourceCurrencyCode: "USD",
  sourceMinorUnitExponent: 2,
});

const placeOpenCheap = {
  id: "p1", title: "Mama Cass", category: "casual_food", openingHours: HOURS, utcOffsetMinutes: 0,
  rating: 4.2, travelTime: "17 min", dateAdded: "2026-10-01T10:00:00Z", ...usdPrice(20),
};
const placeFineNgn = {
  id: "p2", title: "Naos Hellenic", category: "Fine Dining", openingHours: HOURS, utcOffsetMinutes: 0,
  rating: 4.8, travelTime: "9 min", dateAdded: "2026-10-05T10:00:00Z",
  priceRangeStatus: "active", sourceMinMinor: 15000000, sourceMaxMinor: 15000000,
  sourceCurrencyCode: "NGN", sourceMinorUnitExponent: 2,
};
const placeNoHours = {
  id: "p3", title: "Rooftop Bar", category: "Drinks & Music", distance: "1.2 km",
  dateAdded: "2026-10-20T10:00:00Z",
};
const plan = {
  id: "c1", title: "Sunset walk and dinner", cardType: "curated", category: "Romantic",
  stops: [{ rating: 4 }, { rating: 5 }], totalPriceMin: 0, totalPriceMax: 0,
  travelTime: "25 min", dateAdded: "2026-10-10T10:00:00Z",
};
const endedEvent = {
  id: "e1", title: "Comedy night", cardType: "experience", brandId: "b", eventId: "ev",
  stops: [{ placeName: "Terra" }], masterDateUtc: "2026-09-01T19:00:00Z", masterEndAtUtc: "2026-09-01T22:00:00Z",
  totalPriceMin: 10, totalPriceMax: 20, dateAdded: "2026-08-01T10:00:00Z",
};
const sessionCard = {
  id: "p4", title: "Café Neo", category: "", source: "collaboration", sessionName: "Lagos crew",
  dateAdded: "2026-10-15T10:00:00Z", priceTier: "lavish",
};
const CARDS = [placeOpenCheap, placeFineNgn, placeNoHours, plan, endedEvent, sessionCard];
const ids = (cards: Array<{ id: string }>) => cards.map((c) => c.id);
const index = () => buildSavedFilterIndex(CARDS, DEPS);
const run = (patch: Partial<typeof DEFAULT_SAVED_FILTERS>, now = NOON) =>
  ids(applySavedFilters(index(), { ...DEFAULT_SAVED_FILTERS, ...patch }, OPTS(now)));

// ── 1. Kind mapping ────────────────────────────────────────────────────────

Deno.test("#4265 quick types: brand experiences are Events, curated stops are Plans, the rest Places", () => {
  assertEquals(savedCardKind(endedEvent, isBrandExperiencePayload), "events");
  assertEquals(savedCardKind(plan, isBrandExperiencePayload), "plans");
  assertEquals(savedCardKind(placeOpenCheap, isBrandExperiencePayload), "places");
  // A brand event that lost its tag is still an event (structural recovery).
  assertEquals(savedCardKind({ brandId: "b", eventId: "e", stops: [] }, isBrandExperiencePayload), "events");
  assertEquals(run({ type: "places" }), ["p3", "p4", "p2", "p1"]);
  assertEquals(run({ type: "plans" }), ["c1"]);
  assertEquals(run({ type: "events" }), ["e1"]);
});

// ── 2. Search index ────────────────────────────────────────────────────────

Deno.test("#4265 search matches title, translated category and session name, accent- and case-blind", () => {
  assertEquals(run({ query: "naos" }), ["p2"]);
  assertEquals(run({ query: "  ALTA cocina " }), ["p2"], "translated category label");
  assertEquals(run({ query: "fine dining" }), ["p2"], "raw category too");
  assertEquals(run({ query: "lagos" }), ["p4"], "session name");
  assertEquals(run({ query: "cafe" }), ["p4"], "accent-insensitive");
  assertEquals(run({ query: "zzz" }), []);
});

Deno.test("#4265 typing never re-reads raw cards or rebuilds the index", async () => {
  let reads = 0;
  const watched = CARDS.map((c) => new Proxy(c, { get: (t, k) => { reads += 1; return t[k]; } }));
  labelCalls = 0;
  const built = buildSavedFilterIndex(watched, DEPS);
  assert(reads > 0 && labelCalls > 0, "the builder reads each card once");
  const labelsAtBuild = labelCalls;
  reads = 0;
  for (const query of ["n", "na", "nao", "naos", "nao", "", "lagos", "alta", "romántico"]) {
    applySavedFilters(built, { ...DEFAULT_SAVED_FILTERS, query, type: "places", sort: "rating" }, OPTS(NOON));
  }
  assertEquals(reads, 0, "a keystroke must only read index entries");
  assertEquals(labelCalls, labelsAtBuild, "category labels are resolved once, at build time");

  // SavedTab builds the index from the saved cards (+ language) only, and the
  // grid filters on the deferred query.
  {
    const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
    assert(/const filterIndex = useMemo\(\s*\(\) => buildSavedFilterIndex\(savedCards, SAVED_FILTER_DEPS\),\s*\[savedCards, i18n\.language\],/.test(tab));
    assert(/const deferredQuery = useDeferredValue\(filters\.query\)/.test(tab));
    assert(/applySavedFilters\(\s*filterIndex,\s*\{ \.\.\.filters, query: deferredQuery \}/.test(tab));
    assert(!/toLowerCase\(\)/.test(tab), "SavedTab must not lowercase cards per render");
  }
});

// ── 3. Category chips come from the data ──────────────────────────────────

Deno.test("#4265 category chips are the categories actually saved, most-saved first", () => {
  const options = savedCategoryOptions(
    buildSavedFilterIndex([...CARDS, { id: "p5", title: "Bukka", category: "Casual Eats" }], DEPS),
    (slug) => LABELS[slug] ?? slug,
  );
  assertEquals(options.map((o) => o.slug), ["casual_food", "upscale_fine_dining", "drinks_and_music", "romantic"]);
  assertEquals(options[0], { slug: "casual_food", label: "Comida informal", count: 2 });
  // Empty / "Experience" defaults are not offered.
  const empty = savedCategoryOptions(buildSavedFilterIndex([{ id: "x", category: "Experience" }, { id: "y" }], DEPS), (s) => s);
  assertEquals(empty, []);
  assertEquals(run({ categories: ["drinks_and_music", "romantic"] }), ["p3", "c1"]);
});

// ── 4. Budget ──────────────────────────────────────────────────────────────

Deno.test("#4265 budget buckets places, plans and free events honestly", () => {
  assertEquals(savedBudgetOf(placeOpenCheap, "places", DEPS), "1", "USD 20 → Chill → $");
  assertEquals(savedBudgetOf(placeFineNgn, "places", DEPS), "2", "₦150,000 ≈ $100 → Comfy → $$");
  assertEquals(savedBudgetOf({ ...placeFineNgn, sourceCurrencyCode: "XYZ" }, "places", DEPS), null, "no rate → no bucket");
  assertEquals(savedBudgetOf({ ...usdPrice(0) }, "places", DEPS), "free");
  assertEquals(savedBudgetOf(placeNoHours, "places", DEPS), null, "no price is never guessed");
  assertEquals(savedBudgetOf(sessionCard, "places", DEPS), "3", "legacy tier slug lavish → $$$");
  assertEquals(savedBudgetOf({ priceLevel: "PRICE_LEVEL_FREE" }, "places", DEPS), "free");
  assertEquals(savedBudgetOf({ priceLevel: 2 }, "places", DEPS), "2");
  assertEquals(savedBudgetOf(plan, "plans", DEPS), "free");
  assertEquals(savedBudgetOf({ totalPriceMin: 60, totalPriceMax: 120 }, "plans", DEPS), "2");
  assertEquals(savedBudgetOf(endedEvent, "events", DEPS), null, "seller currency unknown");
  assertEquals(savedBudgetOf({ ...endedEvent, totalPriceMin: 0, totalPriceMax: 0 }, "events", DEPS), "free");
  assertEquals(run({ budgets: ["free"] }), ["c1"]);
  assertEquals(run({ budgets: ["1", "3"] }), ["p4", "p1"]);
});

// ── 5. Open now ────────────────────────────────────────────────────────────

Deno.test("#4265 open now hides exactly what the card calls closed (and ended events)", () => {
  assertEquals(run({ openNow: true }, NOON), ["p3", "p4", "c1", "p2", "p1"], "ended event hidden at noon");
  assertEquals(run({ openNow: true }, EVENING), ["p3", "p4", "c1"], "closed places hidden; unknown hours kept");
  // Same rule as the grid card's "Closed now": isPlaceOpenNow(...) === false.
  assertEquals(isPlaceOpenAt(HOURS, EVENING, 0), false);
  assertEquals(isPlaceOpenAt(null, EVENING, 0), null);
});

// ── 6. Sorting ─────────────────────────────────────────────────────────────

Deno.test("#4265 sort: recently saved, nearest, top rated — unknowns last", () => {
  assertEquals(run({}), ["p3", "p4", "c1", "p2", "p1", "e1"], "recently saved (newest first)");
  assertEquals(run({ sort: "nearest" }), ["p2", "p1", "c1", "p3", "e1", "p4"], "minutes, then km, unknown last");
  assertEquals(run({ sort: "rating" }), ["p2", "c1", "p1", "p3", "e1", "p4"], "plan uses its stops' average 4.5");
  assertEquals(parseTravelMinutes("1 h 5 min"), 65);
  assertEquals(parseTravelMinutes("1h 20min"), 80);
  assertEquals(parseTravelMinutes(null), null);
  assertEquals(parseDistanceKm("800 m"), 0.8);
  assertEquals(Math.round(parseDistanceKm("1 mi") * 1000), 1609);
});

// ── 7. Counts and clearing ─────────────────────────────────────────────────

Deno.test("#4265 badge count, live 'Show N likes' count and both clears", () => {
  const state = { ...DEFAULT_SAVED_FILTERS, query: "a", type: "places", sort: "rating", categories: ["casual_food"], budgets: ["1", "2"], openNow: true };
  assertEquals(activeSheetFilterCount(DEFAULT_SAVED_FILTERS), 0);
  assertEquals(activeSheetFilterCount(state), 6, "type + sort + 1 category + 2 budgets + open now");
  // Type lives in the sheet now: any Type other than All lights the badge.
  assertEquals(DEFAULT_SAVED_FILTERS.type, "all", "All is the default type");
  assertEquals(activeSheetFilterCount({ ...DEFAULT_SAVED_FILTERS, type: "events" }), 1, "Type ≠ All counts");
  assertEquals(activeSheetFilterCount({ ...DEFAULT_SAVED_FILTERS, type: "all" }), 0);
  assert(hasAnySavedFilter({ ...DEFAULT_SAVED_FILTERS, query: "x" }));
  assert(!hasAnySavedFilter(DEFAULT_SAVED_FILTERS));
  const cleared = clearSheetFilters(state);
  assertEquals({ ...cleared }, { ...DEFAULT_SAVED_FILTERS, query: "a" }, "sheet Clear resets Type too; keeps search");
  assertEquals(toggleIn(["a"], "b"), ["a", "b"]);
  assertEquals(toggleIn(["a", "b"], "a"), ["b"]);
  // The live count equals the grid's result count, net of Undo-pending cards.
  const live = applySavedFilters(index(), { ...DEFAULT_SAVED_FILTERS, type: "places" }, OPTS(NOON, new Set(["p3"])));
  assertEquals(ids(live), ["p4", "p2", "p1"]);
});

// ── 8. SavedTab wiring ─────────────────────────────────────────────────────

Deno.test("#4265 Saved uses the dark search header + Filters sheet; the When filter and light greys are gone", async () => {
  const tab = stripComments(await read("src/components/activity/SavedTab.tsx"));
  assert(!/CardFilterBar|WhenFilter|selectedWhen|setSelectedWhen/.test(tab), "the broken When filter is gone");
  assert(/useState<SavedFilterState>\(DEFAULT_SAVED_FILTERS\)/.test(tab), "one owner of filter state");
  assert(/<SavedSearchHeader/.test(tab));
  assert(/ListHeaderComponent=\{listHeader\}/.test(tab));
  assert(/const listHeader = useMemo\(/.test(tab), "header is memoised");
  assert(/<SavedFiltersSheet/.test(tab));
  assert(/resultCount=\{filteredCards\.length\}/.test(tab), "Show N likes is the real count");
  assert(/data=\{filteredCards\}/.test(tab));
  assert(/priceTierFromUsd: priceTierFromAmount/.test(tab), "budget uses the PRICE_TIERS brackets");
  assert(/savedFilters\.noMatchTitle/.test(tab) && /savedFilters\.clearAll/.test(tab), "no-results state per design");
  assert(/onPress=\{\(\) => \{\s*HapticFeedback\.light\(\);\s*handleClearAll\(\);/.test(tab));

  const header = stripComments(await read("src/components/activity/SavedSearchHeader.tsx"));
  const sheet = stripComments(await read("src/components/activity/SavedFiltersSheet.tsx"));
  for (const [name, src] of [["header", header], ["sheet", sheet]] as const) {
    assert(!/#[0-9a-fA-F]{3,8}\b|rgba\(/.test(src), `${name}: colours come from designSystem tokens`);
  }
  assert(/export const SavedSearchHeader = React\.memo\(/.test(header));
  assert(/accessibilityRole="switch"/.test(sheet) && /accessibilityState=\{\{ checked: openNow \}\}/.test(sheet));
  assert(/<BaseBottomSheet/.test(sheet) && /stickyFooter=\{footer\}/.test(sheet));
  assert(/savedFilters\.a11yFiltersOn/.test(header), "Filters, N on");
  // No quick-chip row in the Saved header any more (Seth, #4265): just the
  // search field + Filters button.
  assert(!/<ScrollView|horizontal|SAVED_QUICK_TYPES|savedFilters\.chip|savedFilters\.openNow|onTypeChange|onToggleOpenNow/.test(header),
    "the All / Places / Events / Plans / Open now chip row is back in the header");
  assert(!/onTypeChange=\{handleTypeChange\}\s*\n\s*openNow=/.test(tab));
  // Type is the first section of the sheet, single-select over All/Places/Events/Plans.
  assert(/savedFilters\.type"\)[\s\S]*SAVED_QUICK_TYPES\.map\(\(id\) => pill\(id, t\(TYPE_KEY\[id\]\), type === id, \(\) => onTypeChange\(id\)\)\)[\s\S]*savedFilters\.sortBy/.test(sheet),
    "Type section sits above Sort by in the sheet");
  assert(/type=\{filters\.type\}/.test(tab) && /onTypeChange=\{handleTypeChange\}/.test(tab), "sheet is wired to the one filter state");

  const tokens = await read("src/constants/designSystem.ts");
  assert(/fieldHeight: 44,\s*fieldRadius: 14,/.test(tokens));
  assert(/fieldBorder: 'rgba\(255, 255, 255, 0\.12\)'/.test(tokens));
  assert(/chipHeight: 34,/.test(tokens));
});

// ── 9. The small tab switcher ──────────────────────────────────────────────

Deno.test("#4265 the small left-aligned pill switcher replaces the full-width orange bar", async () => {
  const page = stripComments(await read("src/components/LikesPage.tsx"));
  // Old bar gone.
  assert(!/pillBarCapsule|styles\.spotlight\b|glass\.chrome\.active\.tint|bookmark-outline/.test(page), "orange segmented bar is back");
  // New switcher.
  assert(/const S = glass\.likes\.switcher;/.test(page));
  assert(/accessibilityRole="tablist"/.test(page));
  assert(/accessibilityRole="tab"/.test(page) && /accessibilityState=\{\{ selected: active \}\}/.test(page));
  assert(/alignItems: 'flex-start'/.test(page), "left-aligned, not full width");
  assert(/backgroundColor: isAndroidPreBlur \? S\.fillOpaque : S\.fill/.test(page), "Android opaque fallback");
  assert(/withTiming\(targetX, timing\)/.test(page) && /duration: glass\.likes\.switcher\.moveMs/.test(page));
  assert(/if \(reduceMotion \|\| !pillPlacedRef\.current\)/.test(page), "no glide under reduce motion");
  // Behaviour kept.
  assert(/Haptics\.impactAsync/.test(page));
  assert(/mixpanelService\.trackTabViewed\(/.test(page));
  assert(/setLikesActiveTabRegistry\(activeTab\)/.test(page));
  assert(/navigationData\.activeTab/.test(page) && /deepLinkParams\?\.tab === 'calendar'/.test(page));
  // Header height unchanged → Calendar's content padding unchanged.
  assert(/const PILL_BAR_HEIGHT = 52;/.test(page));
  assert(/const HEADER_PANEL_HEIGHT = PILL_BAR_TOP \+ PILL_BAR_HEIGHT \+ 4;/.test(page));
  assert(/paddingTop: HEADER_PANEL_HEIGHT \+ 8/.test(page));

  const tokens = await read("src/constants/designSystem.ts");
  const block = /the small Saved \| Calendar switcher[^\n]*\n\s*switcher: \{([\s\S]*?)\n {4}\},/.exec(tokens)?.[1] ?? "";
  assert(/padding: 4,/.test(block) && /pillHeight: 32,/.test(block) && /pillPaddingH: 16,/.test(block));
  assert(/fill: 'rgba\(255, 255, 255, 0\.06\)'/.test(block));
  assert(/selectedBg: '#ffffff'/.test(block) && /selectedText: '#0c0e12'/.test(block));
  assert(/text: 'rgba\(255, 255, 255, 0\.72\)'/.test(block) && /fontSize: 14,/.test(block) && /moveMs: 150,/.test(block));
});

// ── 10. Strings ────────────────────────────────────────────────────────────

Deno.test("#4265 Saved filter strings are complete in all 29 locales", async () => {
  const en = JSON.parse(await read("src/i18n/locales/en/activity.json")).savedFilters;
  const singular = Object.keys(en).filter((k) => !k.startsWith("show_"));
  const ph = (v: string) => [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join("|");
  for (const locale of LOCALES) {
    const file = JSON.parse(await read(`src/i18n/locales/${locale}/activity.json`));
    const f = file.savedFilters;
    let localized = 0;
    for (const key of singular) {
      assert(typeof f[key] === "string" && f[key].trim().length > 0, `${locale} savedFilters.${key} missing`);
      assertEquals(ph(f[key]), ph(en[key]), `${locale} savedFilters.${key} placeholders`);
      if (locale !== "en" && f[key] !== en[key]) localized += 1;
    }
    // Same plural categories as the locale's existing "N saved" string.
    const cats = Object.keys(file.savedTab).filter((k) => k.startsWith("countSaved_")).map((k) => k.slice(11)).sort();
    const shows = Object.keys(f).filter((k) => k.startsWith("show_")).map((k) => k.slice(5)).sort();
    assertEquals(shows, cats, `${locale} show_* plural categories`);
    for (const c of shows) assert(f[`show_${c}`].includes("{{count}}"), `${locale} show_${c} shows the count`);
    if (locale !== "en") assert(localized >= 12, `${locale} looks untranslated (${localized})`);
  }
});
