// ORCH-1263 [claim-adoption] Leg C — T-C3: approve ordering + fail-close.
// Invariant: I-PROPOSED-1263-NO-LIVE-PLACE-MUTATION-PRE-APPROVE (the approve
// handler is the ONLY writer of authored content + ownership onto the live
// place) — SPEC §A5 ordering: authored application runs AFTER the review RPC,
// BEFORE runApproveGoLive; application failure → structured error, go-live
// NOT attempted (no servable flip, no scorer invokes).
//
// MUST FAIL when the D-A change is reverted:
//   * remove applyAuthoredContentOnApprove from the approve path (or run
//     go-live first) → the ordering assertion fails (go-live writes precede /
//     replace the authored patch);
//   * swallow an application failure and go-live anyway → the fail-close
//     assertions fail (invoke count / is_servable write present).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  applyAuthoredContentOnApprove,
  approveGoLiveWithAuthoredApply,
} from "../index.ts";

interface CapturedWrite {
  table: string;
  op: "update" | "insert" | "upsert";
  payload: unknown;
}

function makeFakeAdmin(config: {
  rows?: Record<string, Record<string, unknown> | null>;
  lists?: Record<string, unknown[]>;
  failTables?: Set<string>;
}) {
  const writes: CapturedWrite[] = [];
  const invokes: Array<{ name: string; body: unknown }> = [];
  const rows = config.rows ?? {};
  const lists = config.lists ?? {};
  const failTables = config.failTables ?? new Set<string>();

  function makeQuery(table: string) {
    let op: "select" | "update" | "insert" | "upsert" = "select";
    const q = {
      select(_c?: string) {
        return q;
      },
      eq(_k: string, _v: unknown) {
        return q;
      },
      order(_k: string, _o?: unknown) {
        return q;
      },
      maybeSingle() {
        if (failTables.has(table)) {
          return Promise.resolve({ data: null, error: { message: `${table}_read_boom` } });
        }
        return Promise.resolve({ data: rows[table] ?? null, error: null });
      },
      update(payload: unknown) {
        op = "update";
        writes.push({ table, op: "update", payload });
        return q;
      },
      insert(payload: unknown) {
        op = "insert";
        writes.push({ table, op: "insert", payload });
        return q;
      },
      // deno-lint-ignore no-explicit-any
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown): any {
        const value = op === "select"
          ? { data: lists[table] ?? [], error: null }
          : { data: null, error: null };
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return q;
  }

  return {
    admin: {
      from: (table: string) => makeQuery(table),
      functions: {
        invoke(name: string, opts: { body?: unknown }) {
          invokes.push({ name, body: opts?.body });
          return Promise.resolve({ data: {}, error: null });
        },
      },
    },
    writes,
    invokes,
  };
}

const VENUE_ID = "5b000000-0000-4000-8000-000000000002";
const PLACE_ID = "3c7ebebf-7249-45a2-8b0b-c6b5ec319ec0";

const HAPPY_ROWS = {
  venue_listings: {
    id: VENUE_ID,
    brand_id: "9a000000-0000-4000-8000-000000000001",
    place_pool_id: PLACE_ID,
    cover_media_url: "https://cdn/cover.jpg",
    cover_media_type: "image",
  },
  brands: {
    id: "9a000000-0000-4000-8000-000000000001",
    account_id: "7a000000-0000-4000-8000-000000000009",
  },
  // Servable place shape so the go-live re-bounce passes.
  place_pool: {
    id: PLACE_ID,
    google_place_id: "gp-lantern",
    name: "The Lantern Room",
    lat: 38.9,
    lng: -77.0,
    types: ["restaurant", "food", "point_of_interest"],
    business_status: "OPERATIONAL",
    website: "https://lantern.example",
    opening_hours: { periods: [] },
    photos: [{ ref: "x" }],
    stored_photo_urls: ["https://cdn/p1.jpg"],
    fetched_via: "nearby_search",
    review_count: 100,
    rating: 4.4,
    business_gallery_urls: ["https://cdn/g1.jpg"],
    business_authoring_inputs: {
      tier1: { description: "Operator pitch long enough to stand in." },
      tier2: { website: "https://lantern.example", price_tiers: ["comfy"] },
    },
    raw_google_data: {},
  },
};

const HAPPY_LISTS = {
  brand_hours: [
    { weekday: 0, open_time: "09:00:00", close_time: "17:00:00", is_closed: false },
    { weekday: 4, open_time: "22:00:00", close_time: "02:00:00", is_closed: false },
  ],
  signal_definitions: [{ id: "date_night" }],
};

Deno.test("T-C3a: apply failure → structured error; runApproveGoLive NOT invoked (no servable flip, no scorer calls)", async () => {
  // The place read inside applyAuthoredContentOnApprove blows up.
  const { admin, writes, invokes } = makeFakeAdmin({
    rows: { ...HAPPY_ROWS, place_pool: null },
    lists: HAPPY_LISTS,
    failTables: new Set(["place_pool"]),
  });
  // deno-lint-ignore no-explicit-any
  const result = await approveGoLiveWithAuthoredApply(admin as any, VENUE_ID, PLACE_ID, null);
  assertEquals(result.ok, false);
  assert(
    !result.ok && result.error.includes("authored_apply_place_read"),
    "structured error names the failing stage",
  );
  // Fail-close: go-live never ran — no place writes at all, no scorer invokes.
  assertEquals(writes.filter((w) => w.table === "place_pool").length, 0);
  assertEquals(invokes.length, 0);
  const servableWrite = writes.find((w) =>
    w.table === "place_pool" &&
    (w.payload as Record<string, unknown>)?.is_servable === true
  );
  assertEquals(servableWrite, undefined, "servable flip must not happen on apply failure");
});

Deno.test("T-C3b: happy approve — authored patch lands FIRST (with ownership + archive), THEN go-live re-bounce/scoring", async () => {
  const { admin, writes, invokes } = makeFakeAdmin({
    rows: HAPPY_ROWS,
    lists: HAPPY_LISTS,
  });
  // deno-lint-ignore no-explicit-any
  const result = await approveGoLiveWithAuthoredApply(admin as any, VENUE_ID, PLACE_ID, null);
  assert(result.ok, `expected ok, got ${JSON.stringify(result)}`);

  const placeWrites = writes.filter((w) => w.table === "place_pool");
  assert(placeWrites.length >= 2, "authored patch + go-live flip expected");

  // ORDERING (binding §A5): write[0] is the authored application — ownership
  // + authored content; the servable flip comes strictly AFTER it.
  const first = placeWrites[0].payload as Record<string, unknown>;
  assertEquals(first.is_claimed, true);
  assertEquals(first.claimed_by, "7a000000-0000-4000-8000-000000000009");
  assert("opening_hours" in first, "authored hours applied at approve");
  assert("stored_photo_urls" in first, "authored photos applied at approve");
  assert(!("is_servable" in first), "the authored patch never flips servable itself");

  const flipIndex = placeWrites.findIndex((w) =>
    (w.payload as Record<string, unknown>).is_servable === true
  );
  assert(flipIndex > 0, "servable flip must come AFTER the authored application");

  // Scoring ran over authored content (invoked once per active signal).
  assertEquals(invokes.length, 1);
  assertEquals(invokes[0].name, "run-signal-scorer");

  if (result.ok) {
    assert(result.applied_keys.includes("claimed_by"));
    assert(result.goLive.rebounced);
  }
});

Deno.test("T-C3c: applyAuthoredContentOnApprove alone is idempotent-shaped (single place UPDATE, keys reported)", async () => {
  const { admin, writes } = makeFakeAdmin({ rows: HAPPY_ROWS, lists: HAPPY_LISTS });
  // deno-lint-ignore no-explicit-any
  const applied = await applyAuthoredContentOnApprove(admin as any, VENUE_ID);
  assertEquals(applied.place_pool_id, PLACE_ID);
  assertEquals(writes.filter((w) => w.table === "place_pool" && w.op === "update").length, 1);
  for (const k of ["opening_hours", "stored_photo_urls", "generative_summary", "website", "is_claimed", "claimed_by"]) {
    assert(applied.applied_keys.includes(k), `applied_keys missing ${k}`);
  }
});
