// #4334 — places-coordinate-refresh run (spec v2 §6.8 tests 2–9, 13 and A1/A2
// alert rows). SQL-side rows (selection, guarded writes, expiry, trip JSON,
// idempotency, CHECKs) are in
// supabase/migrations/__tests__/issue_4334_google_places.implementor.pg17.test.sql.
//
// Fake fetch + fake clock; no network, no database.
//
// Fails-on-revert (each proven by deleting the named line):
//   T-2  DETAILS_FIELD_MASK changed from "id,location"            → red
//   T-3  `distance > MOVE_THRESHOLD_M` dropped (always move)      → red
//   T-7  the `summary.stopped ??= result.code` line deleted       → red (more fetches)
//   T-8  same line, 403 case                                      → red
//   T-9  the timeout catch returning "failing"                    → red
//   T-11 the alert block after alertSummary deleted               → red
//   T-12 isAnchor routing deleted (anchors sent to Place Details) → red
//   T-13 the authorize check in index.ts deleted                  → red

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AlertSummary,
  DETAILS_FIELD_MASK,
  type DuePin,
  haversineMeters,
  type RecordArgs,
  type RefreshDeps,
  runRefresh,
} from "../refresh.ts";

const LAGOS = { lat: 6.4325387, lng: 3.4236889 };

function pin(over: Partial<DuePin> = {}): DuePin {
  return {
    pin_kind: "event_location",
    row_id: "00000000-0000-0000-0000-000000000001",
    place_id: "ChIJfixture_6_name",
    lat: LAGOS.lat,
    lng: LAGOS.lng,
    refreshed_at: null,
    refresh_state: "ok",
    ...over,
  };
}

interface Harness {
  deps: RefreshDeps;
  fetches: Array<{ url: string; init: RequestInit }>;
  records: RecordArgs[];
  captures: Array<{ message: string; context: Record<string, unknown> }>;
  apiCalls: Array<{ ok: boolean; status?: number; code?: string }>;
  expireCalls: number;
}

function harness(
  pins: DuePin[],
  respond: (url: string, init: RequestInit) => Promise<Response> | Response,
  alert: AlertSummary = { stale_in_scope: 0, stale_ids: [], place_gone: 0, failing: 0 },
  recordResult = true,
): Harness {
  let clock = 1_000_000;
  const h: Harness = {
    fetches: [],
    records: [],
    captures: [],
    apiCalls: [],
    expireCalls: 0,
    deps: undefined as unknown as RefreshDeps,
  };
  h.deps = {
    apiKey: "test-key-not-real",
    fetch: async (url, init) => {
      h.fetches.push({ url, init });
      return await respond(url, init);
    },
    duePins: () => Promise.resolve(pins),
    record: (args) => {
      h.records.push(args);
      return Promise.resolve(recordResult);
    },
    expirePast: () => {
      h.expireCalls += 1;
      return Promise.resolve(0);
    },
    alertSummary: () => Promise.resolve(alert),
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    captureException: (error, context) => h.captures.push({ message: error.message, context }),
    recordApiCall: (ok, _ms, status, err) => h.apiCalls.push({ ok, status, code: err?.code }),
  };
  return h;
}

const details = (id: string, lat: number, lng: number) =>
  new Response(JSON.stringify({ id, location: { latitude: lat, longitude: lng } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

Deno.test("T-2 Place Details is called with the Essentials mask id,location, no session token", async () => {
  const h = harness([pin()], () => details("ChIJfixture_6_name", LAGOS.lat, LAGOS.lng));
  await runRefresh(h.deps);
  assertEquals(DETAILS_FIELD_MASK, "id,location");
  const headers = h.fetches[0].init.headers as Record<string, string>;
  assertEquals(headers["X-Goog-FieldMask"], "id,location");
  assert(h.fetches[0].url.startsWith("https://places.googleapis.com/v1/places/ChIJfixture_6_name"));
  assert(!h.fetches[0].url.includes("sessionToken"));
  assert(h.fetches[0].url.includes("languageCode=en"));
});

Deno.test("T-3 unchanged location → timestamp only (no coordinates written)", async () => {
  const h = harness([pin()], () => details("ChIJfixture_6_name", LAGOS.lat + 0.000001, LAGOS.lng));
  const s = await runRefresh(h.deps);
  assertEquals(h.records.length, 1);
  assertEquals(h.records[0].p_result, "ok");
  assertEquals(h.records[0].p_lat, null);
  assertEquals(h.records[0].p_lng, null);
  assertEquals(h.records[0].p_new_place_id, null);
  assertEquals(s.unchanged, 1);
});

Deno.test("T-4 moved more than 1 m → new coordinates; more than 200 m → drift warning", async () => {
  const h = harness([pin()], () => details("ChIJfixture_6_name", LAGOS.lat + 0.01, LAGOS.lng));
  const s = await runRefresh(h.deps);
  assertEquals(h.records[0].p_lat, LAGOS.lat + 0.01);
  assertEquals(h.records[0].p_lng, LAGOS.lng);
  assertEquals(s.moved, 1);
  assert(h.captures.some((c) => c.message.includes("drifted")));
  // The run never sends text: RecordArgs has no text field at all (D9).
  assertEquals(Object.keys(h.records[0]).sort(), [
    "p_expected_place_id", "p_kind", "p_lat", "p_lng", "p_new_place_id", "p_result", "p_row_id",
  ]);
});

Deno.test("T-5 Google re-ided the place → new id and coordinates", async () => {
  const h = harness([pin()], () => details("ChIJnew_id_after_merge", LAGOS.lat, LAGOS.lng));
  const s = await runRefresh(h.deps);
  assertEquals(h.records[0].p_new_place_id, "ChIJnew_id_after_merge");
  assertEquals(h.records[0].p_expected_place_id, "ChIJfixture_6_name");
  assertEquals(s.reided, 1);
});

Deno.test("T-6 404 → place_gone, coordinates untouched, one alert per pin", async () => {
  const notFound = () => new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 });
  const h = harness([pin(), pin({ row_id: "00000000-0000-0000-0000-000000000002", refresh_state: "place_gone" })], notFound);
  const s = await runRefresh(h.deps);
  assertEquals(h.records.map((r) => r.p_result), ["place_gone", "place_gone"]);
  assertEquals(h.records[0].p_lat, null);
  assertEquals(s.place_gone, 2);
  // Only the pin that was not already place_gone alerts.
  assertEquals(h.captures.filter((c) => c.message.includes("no longer exists")).length, 1);
});

for (const status of [429, 403]) {
  Deno.test(`T-${status === 429 ? 7 : 8} first ${status} stops the run: no further fetch, Sentry + failed observation`, async () => {
    const pins = Array.from({ length: 20 }, (_, i) =>
      pin({ row_id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}` }));
    let n = 0;
    const h = harness(pins, () => {
      n += 1;
      return new Response("{}", { status });
    });
    const s = await runRefresh(h.deps);
    assertEquals(s.stopped, status === 429 ? "provider_quota" : "provider_denied");
    // At most one request per worker was in flight when the stop landed.
    assert(n <= 5, `expected the run to stop, but it made ${n} requests`);
    assert(h.captures.some((c) => c.message.includes("stopped")));
    assert(h.apiCalls.some((a) => !a.ok && a.status === status));
    assert(h.records.every((r) => r.p_result === "failing"));
  });
}

// #4334 F-6 — a 400 API_KEY_INVALID is a denied key: the run stops at once
// instead of marking up to 500 pins failing. Fails on revert of the 400 branch.
Deno.test("T-8b 400 API_KEY_INVALID stops the run as provider_denied", async () => {
  const pins = Array.from({ length: 20 }, (_, i) =>
    pin({ row_id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}` }));
  let n = 0;
  const h = harness(pins, () => {
    n += 1;
    return new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }] } }), { status: 400 });
  });
  const s = await runRefresh(h.deps);
  assertEquals(s.stopped, "provider_denied");
  assert(n <= 5, `expected the run to stop, but it made ${n} requests`);
});

Deno.test("T-9 timeout → failing (coordinates untouched)", async () => {
  const h = harness([pin()], () => {
    throw new DOMException("timed out", "TimeoutError");
  });
  const s = await runRefresh(h.deps);
  assertEquals(h.records[0].p_result, "failing");
  assertEquals(s.failing, 1);
  assertEquals(h.apiCalls[0].code, "timeout");
});

Deno.test("T-10 a concurrent host re-pick (guarded write refused) is counted, never retried", async () => {
  const h = harness([pin()], () => details("ChIJfixture_6_name", LAGOS.lat + 0.01, LAGOS.lng), undefined, false);
  const s = await runRefresh(h.deps);
  assertEquals(s.not_written, 1);
  assertEquals(h.records.length, 1);
});

Deno.test("T-11 A1: a live pin past day 26 raises a Sentry error and a failed observation on every run", async () => {
  const alert = { stale_in_scope: 1, stale_ids: ["event_location:x"], place_gone: 0, failing: 1 };
  const h = harness([], () => details("x", 0, 0), alert);
  await runRefresh(h.deps);
  assertEquals(h.expireCalls, 1);
  assert(h.captures.some((c) => c.message.includes("needs attention")));
  assert(h.apiCalls.some((a) => !a.ok && a.code === "refresh_alert"));
});

Deno.test("T-12 A2: preference anchors refresh through the Geocoding API by place_id, never Place Details", async () => {
  const h = harness(
    [pin({ pin_kind: "pref_custom", place_id: "ChIJlekki_anchor_0001" })],
    () => new Response(JSON.stringify({
      status: "OK",
      results: [{ place_id: "ChIJlekki_anchor_0001", geometry: { location: { lat: LAGOS.lat, lng: LAGOS.lng } } }],
    }), { status: 200 }),
  );
  await runRefresh(h.deps);
  assert(h.fetches[0].url.startsWith("https://maps.googleapis.com/maps/api/geocode/json?place_id=ChIJlekki_anchor_0001"));
  assert(h.fetches[0].url.includes("language=en"));
  assertEquals(h.records[0].p_result, "ok");
});

Deno.test("T-12b A2 / R-DECK-7: an anchor whose refresh fails is marked failing, never cleared", async () => {
  const h = harness(
    [pin({ pin_kind: "pref_discover", place_id: "ChIJlagos_anchor_0001" })],
    () => new Response(JSON.stringify({ status: "UNKNOWN_ERROR" }), { status: 200 }),
  );
  await runRefresh(h.deps);
  assertEquals(h.records[0].p_result, "failing");
  assertEquals(h.records[0].p_lat, null);
  assertEquals(h.records[0].p_lng, null);
});

Deno.test("T-12c Geocoding REQUEST_DENIED inside HTTP 200 stops the run (loud, never empty)", async () => {
  const h = harness(
    [pin({ pin_kind: "pref_custom", place_id: "ChIJlekki_anchor_0001" }), pin({ pin_kind: "pref_custom", place_id: "ChIJlekki_anchor_0002" })],
    () => new Response(JSON.stringify({ status: "REQUEST_DENIED" }), { status: 200 }),
  );
  const s = await runRefresh(h.deps);
  assertEquals(s.stopped, "provider_denied");
});

Deno.test("T-14 wall clock: the run stops after 25 s and leaves the rest for tomorrow", async () => {
  const pins = Array.from({ length: 500 }, (_, i) => pin({ row_id: `id-${i}` }));
  const h = harness(pins, () => details("ChIJfixture_6_name", LAGOS.lat, LAGOS.lng));
  const s = await runRefresh(h.deps);
  assertEquals(s.stopped, "wall_clock");
  // 10 req/s for 25 s → about 250 lookups, never all 500.
  assert(s.processed < 300 && s.processed > 200, `processed ${s.processed}`);
});

Deno.test("T-15 at most 500 pins are taken from the list", async () => {
  const pins = Array.from({ length: 700 }, (_, i) => pin({ row_id: `id-${i}` }));
  const h = harness(pins, () => details("ChIJfixture_6_name", LAGOS.lat, LAGOS.lng));
  const s = await runRefresh(h.deps);
  assertEquals(s.selected, 500);
});

Deno.test("haversine sanity: Didi Museum ↔ 175 Akin Adesola ≈ 4 m", () => {
  const d = haversineMeters({ lat: 6.4325387, lng: 3.4236889 }, { lat: 6.4325428, lng: 3.4236499 });
  assert(d > 3 && d < 6, `${d}`);
});
