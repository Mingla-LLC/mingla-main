/**
 * #4334 — the coordinate refresh run (spec v2 §6, amendments A1 + A2).
 *
 * Google terms (Branch B): coordinates from Places / Geocoding may be cached at
 * most 30 days; place ids may be kept. Every in-scope pin older than 20 days is
 * re-fetched by place id and its timestamp renewed, leaving a 10-day margin.
 *
 *   Pins (events, trips, experience stops, venue listings, brands, chat plans)
 *     → Place Details (New) Essentials, field mask exactly `id,location`.
 *   Preference anchors (A2) → Geocoding API by place_id (per-end-user storage
 *     terms). Never cleared, never expired.
 *
 * Outcomes (spec v2 §6.5), each written by `places_refresh_record`, guarded by
 * the place id read (a host re-pick in between wins):
 *   same place, moved ≤ 1 m  → timestamp only
 *   moved > 1 m              → new coordinates (> 200 m also a Sentry warning)
 *   Google re-ided the place → new id + coordinates
 *   404 / NOT_FOUND          → place_gone (coordinates kept; one alert per pin)
 *   403 / 429                → failing, and the run STOPS (do not burn quota)
 *   400 API_KEY_INVALID      → provider_denied, and the run STOPS (F-6)
 *   5xx / timeout / other    → failing
 * Text columns are never read or written (D9).
 *
 * After the pins: past offerings past day 29 lose their coordinates
 * (`places_refresh_expire_past`, A1), then the alert summary is checked; any
 * in-scope pin past day 26, any place_gone or failing pin raises a Sentry error
 * and a failed `google_place_refresh` observation (the api-health alert path).
 *
 * Pure of Deno globals: everything external comes in through `RefreshDeps`, so
 * the run is tested with a fake fetch and a fake clock.
 */

import { isApiKeyRejection } from "../_shared/googleKeyRejection.ts";

export const DETAILS_FIELD_MASK = "id,location";
export const MAX_PINS = 500;
export const CONCURRENCY = 5;
export const MAX_REQUESTS_PER_SECOND = 10;
export const REQUEST_TIMEOUT_MS = 6000;
export const WALL_CLOCK_BUDGET_MS = 25_000;
export const MOVE_THRESHOLD_M = 1;
export const DRIFT_WARNING_M = 200;

export type PinKind =
  | "event_location"
  | "trip_departure"
  | "trip_destination"
  | "experience_stop"
  | "venue_listing"
  | "brand"
  | "pref_custom"
  | "pref_discover"
  | "chat_plan";

export interface DuePin {
  pin_kind: PinKind;
  row_id: string;
  place_id: string;
  lat: number | null;
  lng: number | null;
  refreshed_at: string | null;
  refresh_state: string | null;
}

export interface RecordArgs {
  p_kind: PinKind;
  p_row_id: string;
  p_expected_place_id: string;
  p_result: "ok" | "failing" | "place_gone";
  p_new_place_id: string | null;
  p_lat: number | null;
  p_lng: number | null;
}

export interface AlertSummary {
  stale_in_scope: number;
  stale_ids: string[];
  place_gone: number;
  failing: number;
}

export interface RefreshDeps {
  apiKey: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  duePins: (limit: number) => Promise<DuePin[]>;
  record: (args: RecordArgs) => Promise<boolean>;
  expirePast: () => Promise<number>;
  alertSummary: () => Promise<AlertSummary>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  captureException: (error: Error, context: Record<string, unknown>) => void;
  recordApiCall: (
    ok: boolean,
    latencyMs: number,
    status?: number,
    err?: { code?: string; text?: string },
  ) => void;
}

export interface RefreshSummary {
  selected: number;
  processed: number;
  unchanged: number;
  moved: number;
  reided: number;
  place_gone: number;
  failing: number;
  not_written: number;
  stopped: string | null;
  expired: number;
  alert: AlertSummary;
}

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type LookupResult =
  | { kind: "found"; id: string; lat: number; lng: number }
  | { kind: "gone"; status: number }
  | { kind: "stop"; status: number; code: string }
  | { kind: "failing"; status: number | null; code: string };

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Place Details (New) Essentials by id. */
async function lookupPlace(deps: RefreshDeps, placeId: string): Promise<LookupResult> {
  let res: Response;
  try {
    res = await deps.fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`,
      {
        method: "GET",
        headers: { "X-Goog-Api-Key": deps.apiKey, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (e) {
    return { kind: "failing", status: null, code: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return { kind: "gone", status: 404 };
  }
  if (res.status === 403 || res.status === 429) {
    await res.body?.cancel();
    return { kind: "stop", status: res.status, code: res.status === 403 ? "provider_denied" : "provider_quota" };
  }
  if (!res.ok) {
    // #4334 F-6 — Google answers a bad or revoked key with 400 API_KEY_INVALID:
    // that is a denied key, so the run STOPS (do not burn up to 500 calls).
    const body = res.status === 400 ? await res.json().catch(() => null) : (await res.body?.cancel(), null);
    if (res.status === 400 && isApiKeyRejection(body)) {
      return { kind: "stop", status: res.status, code: "provider_denied" };
    }
    return { kind: "failing", status: res.status, code: "provider_unavailable" };
  }
  const body = await res.json().catch(() => null) as
    | { id?: unknown; location?: { latitude?: unknown; longitude?: unknown } }
    | null;
  const lat = body?.location?.latitude;
  const lng = body?.location?.longitude;
  if (!finite(lat) || !finite(lng)) {
    return { kind: "failing", status: res.status, code: "unreadable_body" };
  }
  return {
    kind: "found",
    id: typeof body?.id === "string" && body.id.length > 0 ? body.id : placeId,
    lat,
    lng,
  };
}

/** Geocoding API by place_id (preference anchors, A2). Body status is the verdict. */
async function lookupAnchor(deps: RefreshDeps, placeId: string): Promise<LookupResult> {
  let res: Response;
  try {
    res = await deps.fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}` +
        `&language=en&key=${encodeURIComponent(deps.apiKey)}`,
      { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  } catch (e) {
    return { kind: "failing", status: null, code: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (res.status === 403 || res.status === 429) {
    await res.body?.cancel();
    return { kind: "stop", status: res.status, code: res.status === 403 ? "provider_denied" : "provider_quota" };
  }
  if (!res.ok) {
    // #4334 F-6 — Google answers a bad or revoked key with 400 API_KEY_INVALID:
    // that is a denied key, so the run STOPS (do not burn up to 500 calls).
    const body = res.status === 400 ? await res.json().catch(() => null) : (await res.body?.cancel(), null);
    if (res.status === 400 && isApiKeyRejection(body)) {
      return { kind: "stop", status: res.status, code: "provider_denied" };
    }
    return { kind: "failing", status: res.status, code: "provider_unavailable" };
  }
  const body = await res.json().catch(() => null) as
    | { status?: unknown; results?: Array<{ place_id?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } } }> }
    | null;
  const status = body?.status;
  if (status === "NOT_FOUND" || status === "ZERO_RESULTS") return { kind: "gone", status: res.status };
  if (status === "REQUEST_DENIED") return { kind: "stop", status: res.status, code: "provider_denied" };
  if (status === "OVER_QUERY_LIMIT" || status === "OVER_DAILY_LIMIT") {
    return { kind: "stop", status: res.status, code: "provider_quota" };
  }
  if (status !== "OK") return { kind: "failing", status: res.status, code: String(status ?? "unreadable_body") };
  const first = body?.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;
  if (!finite(lat) || !finite(lng)) return { kind: "failing", status: res.status, code: "unreadable_body" };
  return {
    kind: "found",
    id: typeof first?.place_id === "string" && first.place_id.length > 0 ? first.place_id : placeId,
    lat,
    lng,
  };
}

export function isAnchor(kind: PinKind): boolean {
  return kind === "pref_custom" || kind === "pref_discover";
}

export async function runRefresh(deps: RefreshDeps): Promise<RefreshSummary> {
  const started = deps.now();
  const pins = (await deps.duePins(MAX_PINS)).slice(0, MAX_PINS);
  const summary: RefreshSummary = {
    selected: pins.length,
    processed: 0,
    unchanged: 0,
    moved: 0,
    reided: 0,
    place_gone: 0,
    failing: 0,
    not_written: 0,
    stopped: null,
    expired: 0,
    alert: { stale_in_scope: 0, stale_ids: [], place_gone: 0, failing: 0 },
  };

  // ≤10 requests per second: each request takes a slot 100 ms after the last.
  let nextSlot = started;
  const takeSlot = async (): Promise<void> => {
    const now = deps.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + 1000 / MAX_REQUESTS_PER_SECOND;
    if (wait > 0) await deps.sleep(wait);
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (summary.stopped !== null) return;
      if (deps.now() - started >= WALL_CLOCK_BUDGET_MS) {
        summary.stopped ??= "wall_clock";
        return;
      }
      const pin = pins[cursor++];
      if (!pin) return;
      await takeSlot();
      if (summary.stopped !== null) return;
      const t0 = deps.now();
      const result = isAnchor(pin.pin_kind)
        ? await lookupAnchor(deps, pin.place_id)
        : await lookupPlace(deps, pin.place_id);
      summary.processed += 1;
      await applyResult(deps, pin, result, deps.now() - t0, summary);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  summary.expired = await deps.expirePast();
  summary.alert = await deps.alertSummary();
  if (summary.alert.stale_in_scope > 0 || summary.alert.place_gone > 0 || summary.alert.failing > 0) {
    const text = `stale_in_scope=${summary.alert.stale_in_scope} place_gone=${summary.alert.place_gone} ` +
      `failing=${summary.alert.failing}`;
    deps.captureException(new Error(`places-coordinate-refresh needs attention: ${text}`), {
      tags: { issue: "4334", code: "refresh_alert" },
      extra: { ...summary.alert },
    });
    deps.recordApiCall(false, 0, undefined, { code: "refresh_alert", text });
  }
  return summary;
}

async function applyResult(
  deps: RefreshDeps,
  pin: DuePin,
  result: LookupResult,
  latencyMs: number,
  summary: RefreshSummary,
): Promise<void> {
  const base = {
    p_kind: pin.pin_kind,
    p_row_id: pin.row_id,
    p_expected_place_id: pin.place_id,
    p_new_place_id: null,
    p_lat: null,
    p_lng: null,
  } as const;

  if (result.kind === "found") {
    deps.recordApiCall(true, latencyMs, 200);
    const reided = result.id !== pin.place_id;
    const hasOld = finite(pin.lat) && finite(pin.lng);
    const distance = hasOld
      ? haversineMeters({ lat: pin.lat as number, lng: pin.lng as number }, result)
      : Number.POSITIVE_INFINITY;
    const move = reided || distance > MOVE_THRESHOLD_M;
    if (hasOld && distance > DRIFT_WARNING_M) {
      deps.captureException(new Error("place pin drifted more than 200 m"), {
        tags: { issue: "4334", code: "pin_drift", kind: pin.pin_kind },
        extra: { row_id: pin.row_id, distance_m: Math.round(distance) },
      });
    }
    const written = await deps.record({
      ...base,
      p_result: "ok",
      p_new_place_id: reided ? result.id : null,
      p_lat: move ? result.lat : null,
      p_lng: move ? result.lng : null,
    });
    if (!written) summary.not_written += 1;
    else if (reided) summary.reided += 1;
    else if (move) summary.moved += 1;
    else summary.unchanged += 1;
    return;
  }

  if (result.kind === "gone") {
    deps.recordApiCall(true, latencyMs, result.status);
    const written = await deps.record({ ...base, p_result: "place_gone" });
    if (!written) summary.not_written += 1;
    summary.place_gone += 1;
    if (pin.refresh_state !== "place_gone") {
      deps.captureException(new Error("a stored place no longer exists at Google"), {
        tags: { issue: "4334", code: "place_gone", kind: pin.pin_kind },
        extra: { row_id: pin.row_id },
      });
    }
    return;
  }

  deps.recordApiCall(false, latencyMs, result.status ?? undefined, {
    code: result.code,
    text: result.status !== null ? `http ${result.status}` : result.code,
  });
  const written = await deps.record({ ...base, p_result: "failing" });
  if (!written) summary.not_written += 1;
  summary.failing += 1;
  if (result.kind === "stop") {
    summary.stopped ??= result.code;
    deps.captureException(new Error(`places-coordinate-refresh stopped: ${result.code}`), {
      tags: { issue: "4334", code: result.code },
      extra: { upstream_status: result.status },
    });
  }
}
