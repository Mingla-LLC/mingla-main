/**
 * Issue #4265 — Likes → Saved search, quick chips and the Filters sheet
 * (SearchFilter.dc.html). Pure model: no React, no RN, no i18n singleton, so
 * the Deno suite exercises it for real.
 *
 * Shape of the work:
 *   1. `buildSavedFilterIndex` runs ONCE per saved-cards change. It reads every
 *      raw card a single time and stores what filtering needs: the kind, a
 *      lowercase search haystack (title + translated category + raw category +
 *      session name), the category slug, a budget bucket, travel minutes /
 *      distance, rating, saved-at time and opening hours.
 *   2. `applySavedFilters` runs per keystroke / chip tap. It only reads the
 *      index entries — never the raw card objects — so typing never re-scans
 *      or re-lowercases the saved set.
 *
 * Decisions (each mirrored by the card the user sees):
 *   - Kind: a brand-authored experience (`isBrandExperiencePayload`) is an
 *     Event; a card with stops that is not a brand experience is a Plan (the
 *     same split the grid card uses for its "Event" / "Plan · N stops" chip);
 *     everything else is a Place.
 *   - Open now hides exactly the cards whose grid card says "Closed now"
 *     (a Place with known hours that is closed at this moment) plus ended
 *     events ("This event has ended"). Unknown hours are NOT excluded — the
 *     card never claims they are closed, so the filter does not either.
 *   - Budget: Free / $ / $$ / $$$ over the existing PRICE_TIERS brackets
 *     (Chill → $, Comfy → $$, Bougie + Lavish → $$$). Places use their
 *     canonical source price converted to USD; plans use their USD totals;
 *     an exact zero price is Free in any currency. A card with no honest
 *     price has no bucket and is hidden while a Budget filter is on — never
 *     guessed (Constitution #9).
 */
// No imports on purpose: the Deno lane has no sloppy-import resolution, so the
// app's own helpers (isBrandExperiencePayload, getCategorySlug,
// extractWeekdayText, isPlaceOpenAt, isSavedEventEnded) are passed in through
// SavedFilterDeps / ApplySavedFiltersOptions. SavedTab and the tests pass the
// same real functions.

export type SavedKind = "places" | "events" | "plans";
export type SavedQuickType = "all" | SavedKind;
export type SavedSort = "recent" | "nearest" | "rating";
export type SavedBudget = "free" | "1" | "2" | "3";
/** Matches PriceTierSlug in constants/priceTiers.ts (kept local: that module boots i18n). */
export type SavedPriceTierSlug = "any" | "chill" | "comfy" | "bougie" | "lavish";

export const SAVED_QUICK_TYPES: readonly SavedQuickType[] = ["all", "places", "events", "plans"];
export const SAVED_SORTS: readonly SavedSort[] = ["recent", "nearest", "rating"];
export const SAVED_BUDGETS: readonly SavedBudget[] = ["free", "1", "2", "3"];

/** The one place Saved filter state lives (SavedTab holds a single value of this). */
export interface SavedFilterState {
  query: string;
  type: SavedQuickType;
  openNow: boolean;
  sort: SavedSort;
  categories: readonly string[];
  budgets: readonly SavedBudget[];
}

export const DEFAULT_SAVED_FILTERS: SavedFilterState = {
  query: "",
  type: "all",
  openNow: false,
  sort: "recent",
  categories: [],
  budgets: [],
};

/** What the index builder needs from the app (injected so this stays pure). */
export interface SavedFilterDeps {
  /** Translated, user-facing category name for a slug (getReadableCategoryName). */
  categoryLabel: (slug: string) => string;
  /** constants/priceTiers.ts `priceTierFromAmount`, amounts in USD. */
  priceTierFromUsd: (min: number, max: number) => SavedPriceTierSlug;
  /** Amount in `currency` → USD, or null when no rate is known. */
  toUsd: (amount: number, currency: string) => number | null;
  /** utils/isBrandExperiencePayload. */
  isBrandExperience: (card: unknown) => boolean;
  /** utils/categoryUtils `getCategorySlug`. */
  categorySlug: (category: string) => string;
  /** utils/openingHoursUtils `extractWeekdayText`. */
  weekdayText: (openingHours: never) => string[] | null | undefined;
}

export interface SavedFilterEntry<T> {
  card: T;
  id: string;
  /** Position in the input list (stable tie-break). */
  order: number;
  kind: SavedKind;
  haystack: string;
  categorySlug: string | null;
  budget: SavedBudget | null;
  minutes: number | null;
  km: number | null;
  rating: number | null;
  savedAtMs: number | null;
  weekdayText: string[] | null;
  utcOffsetMinutes: number | null;
  isEvent: boolean;
}

type Raw = Record<string, unknown>;

function asRecord(card: unknown): Raw {
  return card && typeof card === "object" ? (card as Raw) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Lowercase + strip accents, so "cafe" finds "Café". */
export function normalizeSavedSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function savedCardKind(
  card: unknown,
  isBrandExperience: (card: unknown) => boolean,
): SavedKind {
  if (isBrandExperience(card)) return "events";
  const stops = asRecord(card).stops;
  if (Array.isArray(stops) && stops.length > 0) return "plans";
  return "places";
}

/** "17 min", "1 h 5 min", "1h 20min", "2 hr" → minutes. */
export function parseTravelMinutes(value: unknown): number | null {
  const n = num(value);
  if (n !== null) return n >= 0 ? n : null;
  const s = str(value);
  if (!s) return null;
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(s);
  const mins = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(s);
  if (!hours && !mins) return null;
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

/** "2.3 km", "800 m", "1.2 mi" → kilometres. */
export function parseDistanceKm(value: unknown): number | null {
  const n = num(value);
  if (n !== null) return n >= 0 ? n : null;
  const s = str(value);
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(km|mi|m)\b/i.exec(s);
  if (!m) return null;
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "km") return amount;
  if (unit === "mi") return amount * 1.609344;
  return amount / 1000;
}

function ratingOf(raw: Raw, kind: SavedKind): number | null {
  const own = num(raw.rating);
  if (own !== null && own > 0) return own;
  if (kind === "plans" && Array.isArray(raw.stops)) {
    const rated = (raw.stops as unknown[])
      .map((s) => num(asRecord(s).rating))
      .filter((r): r is number => r !== null && r > 0);
    if (rated.length > 0) return rated.reduce((a, b) => a + b, 0) / rated.length;
  }
  return null;
}

function tierToBudget(tier: string | null): SavedBudget | null {
  if (tier === "chill") return "1";
  if (tier === "comfy") return "2";
  if (tier === "bougie" || tier === "lavish") return "3";
  return null;
}

const GOOGLE_LEVELS = [
  "PRICE_LEVEL_FREE",
  "PRICE_LEVEL_INEXPENSIVE",
  "PRICE_LEVEL_MODERATE",
  "PRICE_LEVEL_EXPENSIVE",
  "PRICE_LEVEL_VERY_EXPENSIVE",
] as const;

function googleLevelBudget(level: unknown): SavedBudget | null {
  const name = typeof level === "number" ? GOOGLE_LEVELS[level] : str(level);
  if (!name) return null;
  if (name === "PRICE_LEVEL_FREE") return "free";
  if (name === "PRICE_LEVEL_INEXPENSIVE") return "1";
  if (name === "PRICE_LEVEL_MODERATE") return "2";
  if (name === "PRICE_LEVEL_EXPENSIVE" || name === "PRICE_LEVEL_VERY_EXPENSIVE") return "3";
  return null;
}

function usdBudget(min: number, max: number, deps: SavedFilterDeps): SavedBudget | null {
  if (min === 0 && max === 0) return "free";
  return tierToBudget(deps.priceTierFromUsd(min, max));
}

/** Free / $ / $$ / $$$ for one card, or null when the price is not known. */
export function savedBudgetOf(card: unknown, kind: SavedKind, deps: SavedFilterDeps): SavedBudget | null {
  const raw = asRecord(card);

  if (kind === "plans" || kind === "events") {
    const min = num(raw.totalPriceMin);
    const max = num(raw.totalPriceMax);
    if (min !== null && max !== null && min === 0 && max === 0) return "free";
    // Curated plan totals are USD (formatCurrency converts them from USD); a
    // brand event's totals are in the seller's currency, which the saved card
    // does not carry, so only its Free is certain.
    if (kind === "plans" && min !== null && max !== null) return usdBudget(min, max, deps);
    if (kind === "plans") return tierToBudget(str(raw.priceTier));
    return null;
  }

  // Places: the server-owned canonical price first.
  if (raw.priceRangeStatus === "active") {
    const exp = num(raw.sourceMinorUnitExponent);
    const minMinor = num(raw.sourceMinMinor);
    const maxMinor = num(raw.sourceMaxMinor);
    const currency = str(raw.sourceCurrencyCode);
    if (exp !== null && minMinor !== null && currency) {
      const scale = 10 ** exp;
      const min = minMinor / scale;
      const max = maxMinor !== null ? maxMinor / scale : min;
      if (min === 0 && max === 0) return "free";
      const minUsd = deps.toUsd(min, currency);
      const maxUsd = deps.toUsd(max, currency);
      if (minUsd !== null && maxUsd !== null) return usdBudget(minUsd, maxUsd, deps);
    }
  }
  // Older saves carried a tier slug or a Google price level.
  return tierToBudget(str(raw.priceTier)) ?? googleLevelBudget(raw.priceLevel);
}

function savedAtMsOf(raw: Raw): number | null {
  const s = str(raw.dateAdded);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** A category slug worth offering as a chip, or null. */
function categorySlugOf(raw: Raw, deps: SavedFilterDeps): string | null {
  const category = str(raw.category);
  if (!category) return null;
  const slug = deps.categorySlug(category);
  // "experience" is the empty/default bucket (getCategorySlug('') and the
  // curated "Experience" fallback) — not a category anyone chose.
  if (!slug || slug === "experience") return null;
  return slug;
}

/**
 * Build the filter index. Call once per saved-cards change (and per language
 * change, since the haystack carries the translated category name).
 */
export function buildSavedFilterIndex<T>(
  cards: readonly T[],
  deps: SavedFilterDeps,
): SavedFilterEntry<T>[] {
  const labelCache = new Map<string, string>();
  const labelFor = (slug: string): string => {
    let label = labelCache.get(slug);
    if (label === undefined) {
      label = deps.categoryLabel(slug);
      labelCache.set(slug, label);
    }
    return label;
  };

  return cards.map((card, order) => {
    const raw = asRecord(card);
    const kind = savedCardKind(card, deps.isBrandExperience);
    const categorySlug = categorySlugOf(raw, deps);
    const haystack = normalizeSavedSearch(
      [
        str(raw.title),
        categorySlug ? labelFor(categorySlug) : null,
        str(raw.category),
        str(raw.sessionName),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const weekdayText =
      kind === "places"
        ? (deps.weekdayText(raw.openingHours as never) ?? null)
        : null;
    return {
      card,
      id: String(raw.id ?? order),
      order,
      kind,
      haystack,
      categorySlug,
      budget: savedBudgetOf(card, kind, deps),
      minutes: parseTravelMinutes(raw.travelTime),
      km: parseDistanceKm(raw.distance),
      rating: ratingOf(raw, kind),
      savedAtMs: savedAtMsOf(raw),
      weekdayText: weekdayText && weekdayText.length > 0 ? weekdayText : null,
      utcOffsetMinutes: num(raw.utcOffsetMinutes) ?? num(raw.utc_offset_minutes),
      isEvent: kind === "events",
    };
  });
}

/** Category chips for the sheet: only categories actually present, most saved first. */
export function savedCategoryOptions<T>(
  entries: readonly SavedFilterEntry<T>[],
  categoryLabel: (slug: string) => string,
): Array<{ slug: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.categorySlug) counts.set(e.categorySlug, (counts.get(e.categorySlug) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The orange badge on the Filters button: sheet filters that are not default. */
export function activeSheetFilterCount(state: SavedFilterState): number {
  return (
    (state.sort !== "recent" ? 1 : 0) +
    state.categories.length +
    state.budgets.length +
    (state.openNow ? 1 : 0)
  );
}

export function hasAnySavedFilter(state: SavedFilterState): boolean {
  return state.query.trim().length > 0 || state.type !== "all" || activeSheetFilterCount(state) > 0;
}

/** The sheet's "Clear": sort, category, budget and open now back to default. */
export function clearSheetFilters(state: SavedFilterState): SavedFilterState {
  return { ...state, sort: "recent", categories: [], budgets: [], openNow: false };
}

export function toggleIn<V>(list: readonly V[], value: V): V[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * True when "Open now" hides this card: a Place whose hours say it is closed
 * right now, or an ended event. Unknown hours are kept.
 */
export function savedEntryClosedNow<T>(
  entry: SavedFilterEntry<T>,
  options: Pick<ApplySavedFiltersOptions, "now" | "isOpenAt" | "isEventEnded">,
): boolean {
  if (entry.isEvent) return options.isEventEnded(entry.card, options.now.getTime());
  if (entry.kind !== "places" || !entry.weekdayText) return false;
  return options.isOpenAt(entry.weekdayText, options.now, entry.utcOffsetMinutes) === false;
}

function compareNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export interface ApplySavedFiltersOptions {
  now: Date;
  /** utils/openingHoursUtils `isPlaceOpenAt` (null = unknown). */
  isOpenAt: (weekdayText: string[], at: Date, utcOffsetMinutes: number | null) => boolean | null;
  /** savedGridModel `isSavedEventEnded`. */
  isEventEnded: (card: unknown, nowMs: number) => boolean;
  /** Cards waiting out their Undo window. */
  excludeIds?: ReadonlySet<string>;
}

/** Filter + sort. Reads only index entries; returns the cards in display order. */
export function applySavedFilters<T>(
  entries: readonly SavedFilterEntry<T>[],
  state: SavedFilterState,
  options: ApplySavedFiltersOptions,
): T[] {
  const q = normalizeSavedSearch(state.query);
  const cats = state.categories.length > 0 ? new Set(state.categories) : null;
  const budgets = state.budgets.length > 0 ? new Set(state.budgets) : null;

  const kept = entries.filter(
    (e) =>
      !(options.excludeIds?.has(e.id)) &&
      (state.type === "all" || e.kind === state.type) &&
      (q.length === 0 || e.haystack.includes(q)) &&
      (!cats || (e.categorySlug !== null && cats.has(e.categorySlug))) &&
      (!budgets || (e.budget !== null && budgets.has(e.budget))) &&
      (!state.openNow || !savedEntryClosedNow(e, options)),
  );

  kept.sort((a, b) => {
    let diff = 0;
    if (state.sort === "recent") diff = compareNullable(a.savedAtMs, b.savedAtMs, -1);
    else if (state.sort === "nearest") {
      diff = compareNullable(a.minutes, b.minutes, 1);
      if (diff === 0) diff = compareNullable(a.km, b.km, 1);
    } else diff = compareNullable(a.rating, b.rating, -1);
    return diff !== 0 ? diff : a.order - b.order;
  });

  return kept.map((e) => e.card);
}
