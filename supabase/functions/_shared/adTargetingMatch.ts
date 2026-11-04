/**
 * #4238 — one matcher for every surface that turns a Host's place or interest
 * into one ad app's own targeting id (Host builder, Ari, Admin builder).
 *
 * Guards I-4238-PER-APP-MATCH (declared in the test below). Each ad app is
 * matched on its own: a place or interest is looked up in that app's own list
 * and the app's best result is used. No surface requires one app's name to
 * equal another app's name (Meta "Live music" never equals TikTok "Music ›
 * Live performances"). Enforced by
 * supabase/functions/_shared/__tests__/issue_4238_mb_match.test.ts.
 *
 * Pure: no network. The search edge function runs the provider lookups and
 * hands their results here.
 */

export type MatchCandidate = {
  id: string;
  name: string;
  meta: Record<string, unknown>;
};

export type PlaceKind = "city" | "region" | "pin";

export type PlaceMatch =
  | { state: "match"; best: MatchCandidate }
  | { state: "wider"; wider: MatchCandidate }
  | { state: "none" };

export type InterestMatch =
  | { state: "match"; best: MatchCandidate }
  | { state: "none" };

/**
 * Lower-case, collapse spaces, drop TikTok's ", DMA®" suffix and a trailing
 * administrative word, so "Lagos State" and "Lagos" compare as the same name
 * when ranking. Only used to rank; the provider's own result is what is kept.
 */
export function normalizeTargetName(value: string): string {
  return value
    .replace(/,\s*DMA®?\s*$/i, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .replace(/\s+(state|region|county|province|district)$/i, "")
    .trim();
}

/** The provider's level word for a candidate (TikTok geo_type, Meta type, Google target_type). */
export function candidateLevel(candidate: MatchCandidate): string {
  const meta = candidate.meta ?? {};
  const raw = meta.level ?? meta.geo_type ?? meta.type ?? meta.target_type ??
    "";
  return String(raw).trim().toUpperCase();
}

const CITY_LEVELS = new Set([
  "CITY",
  "DISTRICT",
  "DMA",
  "SUBCITY",
  "NEIGHBORHOOD",
  "MUNICIPALITY",
  "",
]);
const REGION_LEVELS = new Set([
  "REGION",
  "PROVINCE",
  "STATE",
  "COUNTY",
  "TERRITORY",
  "PREFECTURE",
  "GEO_MARKET",
]);

/** True when a candidate sits at the level the Host asked for. */
export function candidateAtKind(
  candidate: MatchCandidate,
  kind: PlaceKind,
): boolean {
  const level = candidateLevel(candidate);
  if (kind === "region") return REGION_LEVELS.has(level);
  return CITY_LEVELS.has(level);
}

function rankByName<T extends MatchCandidate>(query: string, rows: T[]): T[] {
  const q = normalizeTargetName(query);
  const score = (row: T): number => {
    const name = normalizeTargetName(
      String(row.meta?.city ?? row.meta?.name ?? row.name ?? ""),
    );
    if (name === q) return 0;
    if (name.startsWith(q) || q.startsWith(name)) return 1;
    return 2;
  };
  // Stable: equal scores keep the provider's own order.
  return rows
    .map((row, index) => ({ row, index, score: score(row) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((item) => item.row);
}

/**
 * The app's own answer for one place. `candidates` are that app's results at
 * the requested level; `widerCandidates` (optional) are its results one level
 * up (TikTok PROVINCE for a city it only knows as a state).
 *
 * - a candidate at the requested level → `match` (best-named first, else the
 *   provider's own first result);
 * - none, but a wider candidate → `wider` (the Host must accept it);
 * - nothing → `none`.
 */
export function matchPlace(
  query: string,
  kind: PlaceKind,
  candidates: readonly MatchCandidate[],
  widerCandidates: readonly MatchCandidate[] = [],
): PlaceMatch {
  const atLevel = candidates.filter((row) => candidateAtKind(row, kind));
  if (atLevel.length > 0) {
    return { state: "match", best: rankByName(query, atLevel)[0] };
  }
  // #4238 r8 P3: only a LARGER area is "wider". A city an app returns for a
  // region the Host asked for is narrower, never offered as wider.
  const wider = [
    ...candidates.filter((row) =>
      !candidateAtKind(row, kind) &&
      !(kind === "region" && candidateLevel(row) !== "" &&
        CITY_LEVELS.has(candidateLevel(row)))
    ),
    ...widerCandidates,
  ];
  if (wider.length > 0) {
    return { state: "wider", wider: rankByName(query, wider)[0] };
  }
  return { state: "none" };
}

/**
 * The app's own answer for one interest: the same-named entry when the app
 * has one, else the app's own first (most relevant) result. A Host can swap
 * it by searching that app's list (decision a).
 */
export function matchInterest(
  query: string,
  candidates: readonly MatchCandidate[],
): InterestMatch {
  if (candidates.length === 0) return { state: "none" };
  return { state: "match", best: rankByName(query, [...candidates])[0] };
}

/**
 * The match the search function returns with `match: true`, for any kind.
 * Interests and languages take the app's best result; a pin is a point every
 * app shares; places use matchPlace (with the wider level when given).
 */
export function searchMatch(
  kind: string,
  q: string,
  out: { results: MatchCandidate[]; wider?: MatchCandidate[] },
): PlaceMatch | InterestMatch {
  if (kind === "interest" || kind === "language") {
    return matchInterest(q, out.results);
  }
  if (kind === "pin") {
    return out.results.length > 0
      ? { state: "match", best: out.results[0] }
      : { state: "none" };
  }
  return matchPlace(
    q,
    kind === "region" ? "region" : "city",
    out.results,
    out.wider ?? [],
  );
}

/** Languages a Host can pick, with each app's own code. */
export const HOST_AD_LANGUAGES: readonly {
  code: string;
  name: string;
  /** Google languageConstants id (English verified in the repo; others unverified). */
  google: string;
}[] = [
  { code: "en", name: "English", google: "1000" },
  { code: "fr", name: "French", google: "1002" },
  { code: "ar", name: "Arabic", google: "1019" },
  { code: "pt", name: "Portuguese", google: "1014" },
  { code: "es", name: "Spanish", google: "1003" },
];

export function hostAdLanguage(code: string) {
  return HOST_AD_LANGUAGES.find((row) => row.code === code) ?? null;
}
