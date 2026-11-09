/**
 * #4334 (Seth decision D2) — one-off automatic re-pin of the rows that still
 * need a pin onto Google, spec v2 §7.
 *
 *   deno run --allow-env --allow-net --allow-write scripts/issue-4334/repin-to-google.ts            # dry run (default)
 *   deno run --allow-env --allow-net --allow-write scripts/issue-4334/repin-to-google.ts --apply [--review-csv review.csv]
 *   deno run --allow-env --allow-net --allow-read scripts/issue-4334/repin-to-google.ts --restore applied.json
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY. The key is
 * never printed. Operator-run only, after deploy and before the first refresh.
 *
 * Per pin: Places Text Search (New) with the stored host text (" · " → ", "),
 * biased 50 km around the old pin, in the stored country, English, one result.
 * The country must match (when one is stored). Then the SAFETY GUARD (#4334
 * retest 3, R3-2 — the production dry run moved exact pins 1.5–38 km onto
 * same-name places elsewhere):
 *   - a row whose current precision is "exact" moves only if the move is
 *     ≤150 m (EXACT_MAX_MOVE_M);
 *   - any other row (approximate, unknown, or the Lagos centroid) moves only if
 *     the move is ≤25 km (APPROX_MAX_MOVE_M) AND Google's result is in a city /
 *     locality named in the host's own text.
 * A row that fails the guard is NOT moved: it goes to the REVIEW list, written
 * as CSV (`--review-csv <path>`, default `repin-review.csv`: id, kind, host
 * text, old and new coordinates, distance, reason) for a person to check.
 * Accepted rows go through `places_repin_apply`, which keeps the old pin in the
 * audit columns and NEVER writes host text (D9). Rejected rows (no result,
 * country mismatch, HTTP error) keep their old pin and are listed too.
 * 5 requests/s, 6 s timeout, stops at the first 403 or 429.
 */

import {
  type FeatureType,
  featureTypeFromGoogleTypes,
  featureTypeToPrecision,
} from "../../supabase/functions/mapbox-geocode/googleNormalize.ts";

export const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
export const TEXT_SEARCH_MASK =
  "places.id,places.location,places.types,places.formattedAddress,places.addressComponents";
/** The search bias radius around the old pin (not an acceptance bound). */
export const MAX_DISTANCE_M = 50_000;
/** R3-2: an exact pin may be nudged onto Google's pin, never moved elsewhere. */
export const EXACT_MAX_MOVE_M = 150;
/** R3-2: an approximate / centroid pin may move at most this far. */
export const APPROX_MAX_MOVE_M = 25_000;
/** Address-component types that name a city or locality. */
export const LOCALITY_TYPES = [
  "locality",
  "postal_town",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
] as const;
export const REQUESTS_PER_SECOND = 5;
export const TIMEOUT_MS = 6000;

export interface RepinCandidate {
  pin_kind: string;
  row_id: string;
  label: string | null;
  lat: number;
  lng: number;
  country_code: string | null;
  coordinate_precision: string | null;
}

export interface RepinDecision {
  kind: string;
  rowId: string;
  query: string;
  old: { lat: number; lng: number };
  /** accept → moved; review → NOT moved, listed for a person; reject → no usable result. */
  outcome: "accept" | "review" | "reject";
  reason: string | null;
  /** The host's text exactly as stored (for the review list; never written). */
  label?: string | null;
  /** The current precision the guard read ("exact" or anything else). */
  oldPrecision?: string | null;
  /** City / locality names from Google's result. */
  localities?: string[];
  placeId: string | null;
  new: { lat: number; lng: number } | null;
  distanceM: number | null;
  precision: "exact" | "approximate" | null;
  featureType: FeatureType | null;
}

export interface RepinDeps {
  apiKey: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const fold = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** City / locality names (long and short) in a Places address-component list. */
export function localityNames(
  components: Array<{ longText?: string; shortText?: string; types?: string[] }> | undefined,
): string[] {
  const names = new Set<string>();
  for (const c of components ?? []) {
    if (!(c.types ?? []).some((t) => (LOCALITY_TYPES as readonly string[]).includes(t))) continue;
    for (const n of [c.longText, c.shortText]) {
      const f = fold(n ?? "");
      if (f.length >= 3) names.add(f);
    }
  }
  return [...names];
}

/** True when the host's text names one of the result's cities / localities (whole words). */
export function hostTextNamesLocality(label: string | null, localities: string[]): boolean {
  const text = ` ${fold(label ?? "")} `;
  return localities.some((name) => text.includes(` ${name} `));
}

/**
 * R3-2 — the move guard. Returns null when the move may be applied, else the
 * review reason. `exact` is the row's CURRENT precision.
 */
export function moveGuard(input: {
  currentPrecision: string | null;
  distanceM: number;
  label: string | null;
  localities: string[];
}): string | null {
  if (input.currentPrecision === "exact") {
    return input.distanceM <= EXACT_MAX_MOVE_M ? null : "exact_pin_moved_over_150m";
  }
  if (input.distanceM > APPROX_MAX_MOVE_M) return "approximate_pin_moved_over_25km";
  if (input.localities.length === 0) return "result_locality_unknown";
  if (!hostTextNamesLocality(input.label, input.localities)) return "result_locality_not_in_host_text";
  return null;
}

/** One CSV line per review row: id, kind, host text, old/new lat/lng, distance, reason. */
export function reviewCsv(decisions: RepinDecision[]): string {
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "id,kind,host_text,old_lat,old_lng,new_lat,new_lng,distance_m,reason";
  const rows = decisions
    .filter((d) => d.outcome === "review")
    .map((d) =>
      [d.rowId, d.kind, d.label ?? d.query, d.old.lat, d.old.lng, d.new?.lat, d.new?.lng, d.distanceM, d.reason]
        .map(cell)
        .join(",")
    );
  return [header, ...rows].join("\n") + "\n";
}

/** The host's text as the search query. Read only — never written back. */
export function queryFor(label: string | null): string {
  return (label ?? "").replace(/ · /g, ", ").trim();
}

export class StopRun extends Error {
  constructor(readonly status: number) {
    super(`google refused with ${status}; stopping (do not burn quota)`);
  }
}

export async function decide(candidate: RepinCandidate, deps: RepinDeps): Promise<RepinDecision> {
  const query = queryFor(candidate.label);
  const base: RepinDecision = {
    kind: candidate.pin_kind,
    rowId: candidate.row_id,
    query,
    old: { lat: candidate.lat, lng: candidate.lng },
    outcome: "reject",
    reason: null,
    placeId: null,
    new: null,
    distanceM: null,
    precision: null,
    featureType: null,
    label: candidate.label,
    oldPrecision: candidate.coordinate_precision,
  };
  if (query.length === 0) return { ...base, reason: "no_text" };
  const country = candidate.country_code?.trim().toUpperCase() || null;
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "en",
    maxResultCount: 1,
    locationBias: {
      circle: { center: { latitude: candidate.lat, longitude: candidate.lng }, radius: MAX_DISTANCE_M },
    },
  };
  if (country) body.regionCode = country.toLowerCase();

  const res = await deps.fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": deps.apiKey,
      "X-Goog-FieldMask": TEXT_SEARCH_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403 || res.status === 429) throw new StopRun(res.status);
  if (!res.ok) {
    await res.body?.cancel();
    return { ...base, reason: `http_${res.status}` };
  }
  const data = await res.json().catch(() => null) as {
    places?: Array<{
      id?: string;
      location?: { latitude?: number; longitude?: number };
      types?: string[];
      addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
    }>;
  } | null;
  const place = data?.places?.[0];
  const lat = place?.location?.latitude;
  const lng = place?.location?.longitude;
  if (!place?.id || typeof lat !== "number" || typeof lng !== "number") {
    return { ...base, reason: "no_result" };
  }
  const resultCountry = place.addressComponents
    ?.find((c) => (c.types ?? []).includes("country"))?.shortText?.toUpperCase() ?? null;
  const distanceM = haversineMeters(candidate, { lat, lng });
  const featureType = featureTypeFromGoogleTypes(place.types ?? []);
  const localities = localityNames(place.addressComponents);
  const decided = {
    ...base,
    placeId: place.id,
    new: { lat, lng },
    distanceM: Math.round(distanceM),
    featureType,
    precision: featureTypeToPrecision(featureType),
    localities,
  };
  if (country && resultCountry !== country) return { ...decided, reason: `country_mismatch:${resultCountry}` };
  const guard = moveGuard({
    currentPrecision: candidate.coordinate_precision,
    distanceM,
    label: candidate.label,
    localities,
  });
  if (guard !== null) return { ...decided, outcome: "review", reason: guard };
  return { ...decided, outcome: "accept", reason: null };
}

/** Decide every candidate at ≤5 req/s; a 403/429 stops the run. */
export async function planRepin(
  candidates: RepinCandidate[],
  deps: RepinDeps,
): Promise<{ decisions: RepinDecision[]; stoppedAt: number | null }> {
  const decisions: RepinDecision[] = [];
  for (const [i, candidate] of candidates.entries()) {
    if (i > 0) await deps.sleep(1000 / REQUESTS_PER_SECOND);
    try {
      decisions.push(await decide(candidate, deps));
    } catch (e) {
      if (e instanceof StopRun) return { decisions, stoppedAt: e.status };
      decisions.push({
        kind: candidate.pin_kind,
        rowId: candidate.row_id,
        query: queryFor(candidate.label),
        old: { lat: candidate.lat, lng: candidate.lng },
        outcome: "reject",
        reason: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network",
        placeId: null,
        new: null,
        distanceM: null,
        precision: null,
        featureType: null,
      });
    }
  }
  return { decisions, stoppedAt: null };
}

/** The RPC arguments for an accepted decision. Host text is not a field. */
export function applyArgs(d: RepinDecision): Record<string, unknown> {
  if (d.outcome !== "accept" || !d.placeId || !d.new) throw new Error("not an accepted decision");
  return {
    p_kind: d.kind,
    p_row_id: d.rowId,
    p_place_id: d.placeId,
    p_lat: d.new.lat,
    p_lng: d.new.lng,
    p_precision: d.precision,
  };
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export async function run(argv: string[], deps: RepinDeps & {
  rpc: Rpc;
  log: (s: string) => void;
  readText?: (p: string) => Promise<string>;
  writeText?: (p: string, text: string) => Promise<void>;
}): Promise<number> {
  const mode = argv.includes("--restore") ? "restore" : argv.includes("--apply") ? "apply" : "dry-run";
  if (mode === "restore") {
    const file = argv[argv.indexOf("--restore") + 1];
    if (!file || !deps.readText) {
      deps.log("usage: --restore <applied.json>");
      return 2;
    }
    const applied = JSON.parse(await deps.readText(file)) as { applied: Array<{ kind: string; rowId: string }> };
    let restored = 0;
    for (const row of applied.applied ?? []) {
      if (await deps.rpc("places_repin_restore", { p_kind: row.kind, p_row_id: row.rowId })) restored += 1;
    }
    deps.log(JSON.stringify({ mode, restored }));
    return 0;
  }
  const candidates = await deps.rpc("places_repin_candidates", {}) as RepinCandidate[];
  const { decisions, stoppedAt } = await planRepin(candidates ?? [], deps);
  const accepted = decisions.filter((d) => d.outcome === "accept");
  const review = decisions.filter((d) => d.outcome === "review");
  const rejected = decisions.filter((d) => d.outcome === "reject");
  const reviewPath = argv.includes("--review-csv") ? argv[argv.indexOf("--review-csv") + 1] : "repin-review.csv";
  if (deps.writeText && reviewPath) await deps.writeText(reviewPath, reviewCsv(decisions));
  const applied: Array<{ kind: string; rowId: string }> = [];
  if (mode === "apply" && stoppedAt === null) {
    for (const d of accepted) {
      if (await deps.rpc("places_repin_apply", applyArgs(d))) applied.push({ kind: d.kind, rowId: d.rowId });
    }
  }
  deps.log(JSON.stringify({
    mode,
    candidates: candidates?.length ?? 0,
    accepted: accepted.length,
    review: review.length,
    reviewCsv: deps.writeText ? reviewPath : null,
    rejected: rejected.length,
    stoppedAt,
    applied,
    decisions,
  }, null, 2));
  return stoppedAt === null ? 0 : 1;
}

if (import.meta.main) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  if (!url || !service || !apiKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GOOGLE_MAPS_API_KEY are required");
    Deno.exit(2);
  }
  const rpc: Rpc = async (fn, args) => {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`${fn}: http ${res.status} ${await res.text()}`);
    return await res.json();
  };
  Deno.exit(await run(Deno.args, {
    apiKey,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    rpc,
    log: (s) => console.log(s),
    readText: (p) => Deno.readTextFile(p),
    writeText: (p, text) => Deno.writeTextFile(p, text),
  }));
}
