/**
 * META-ORCH-1073 Sub-A — TESTER adversarial regression (mingla-tester+claude).
 *
 * Distinct angle from the implementor's happy-path + adversarial suites. The
 * implementor's adversarial test (globalSearch.adversarial.test.ts) covered:
 * role-gate via `searchIndex`, min-length, zero-result count, throw-safety
 * against a directly-faked `{searchText:null}` entry, and the no-fetch
 * static-import scan. This suite attacks angles the implementor did NOT:
 *
 *   A. Role-gate LEAK across ALL THREE result-producing paths, not just
 *      `searchIndex`. A scanner (rank 10) must never see an owner-only
 *      destination through the empty-state `jumpToSuggestions` OR the
 *      zero-result `nearestSuggestions` rescue paths either, AND the
 *      rank===minRank boundary must be visible (>=, not >). (SC-9 /
 *      I-SEARCH-ROLE-GATED — defense in depth.)
 *   B. Adapter behavior on TYPE-FAITHFUL malformed offering rows fed through
 *      the REAL adapters (not a hand-faked index entry). Real React-Query
 *      caches deliver `description: string|null` and required `name/title`
 *      (per the LiveEvent/Trip/VenueExperience mappers); adapters must skip
 *      rows with a non-string id, keep valid rows, and emit only real
 *      `/`-prefixed, non-`:brandId` routes. (SPEC §3.3; Constitution #1.)
 *      NOTE: a separate QA finding (F-1) documents that the adapters DO throw
 *      on `description:undefined`/`name:undefined` (not null) — a latent gap
 *      that cannot fire with type-faithful cache data; this suite deliberately
 *      uses type-faithful rows so it locks in the supported contract and stays
 *      green, while F-1 is tracked in the QA report.
 *   C. Per-group caps for `goto` + `settings` + the documented total cap of 20
 *      (implementor only asserted the offerings cap of 8). Overflow dropped.
 *   D. Diacritic / case-fold beyond the implementor's "cafe"/"Café": a query
 *      bearing diacritics matching a plain registry SYNONYM, and a multi-mark
 *      title folded both directions + uppercase. (SC-10.)
 *
 * Pure-service only (the mingla-business jest harness is node-env with no
 * @testing-library/react-native). Imports NO data-fetching dependency.
 */

import { describe, expect, test } from "@jest/globals";

import {
  buildSearchIndex,
  filterIndexByRank,
  searchIndex,
  jumpToSuggestions,
  nearestSuggestions,
  GROUP_CAPS,
} from "../globalSearch";
import {
  eventsToIndexEntries,
  tripsToIndexEntries,
  experiencesToIndexEntries,
} from "../adapters";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { Trip } from "../../../services/tripsService";
import type { VenueExperience } from "../../../services/experiencesService";
import type { SearchIndexEntry } from "../types";

const BRAND_ID = "brand_adv";

// Type-faithful event factory: description is ALWAYS string (real LiveEvent
// mapper does `row.description ?? ""`); name is required. Other fields default
// to the empty/null shape the real caches deliver.
function ev(over: { id: string; name: string } & Partial<LiveEvent>): LiveEvent {
  return {
    id: over.id,
    name: over.name,
    description: over.description ?? "",
    status: over.status ?? "live",
    event_type: over.event_type ?? "event",
    venueName: over.venueName ?? null,
    address: over.address ?? null,
    partyTypes: over.partyTypes ?? [],
    vibeTags: over.vibeTags ?? [],
    musicGenres: over.musicGenres ?? [],
    publishedAt: over.publishedAt ?? "2026-06-01T00:00:00.000Z",
  } as unknown as LiveEvent;
}

const registryIndexAtRank = (rank: number): SearchIndexEntry[] =>
  filterIndexByRank(
    buildSearchIndex({
      events: [],
      drafts: [],
      trips: [],
      experiences: [],
      brandId: BRAND_ID,
    }),
    rank,
  );

const fullIndexAtRank = (
  rank: number,
  events: LiveEvent[] = [],
  trips: Trip[] = [],
  exps: VenueExperience[] = [],
): SearchIndexEntry[] =>
  filterIndexByRank(
    buildSearchIndex({
      events,
      drafts: [],
      trips,
      experiences: exps,
      brandId: BRAND_ID,
    }),
    rank,
  );

// The owner-only destinations a scanner (rank 10) must NEVER reach by any path.
const OWNER_ONLY_IDS = [
  "brand-team", // minRank 50
  "brand-audit-log", // 50
  "pricing-defaults", // 50
  "account-delete", // 60
];

// ---------------------------------------------------------------------------
// A. Role-gate leak across ALL result-producing paths (not just searchIndex)
// ---------------------------------------------------------------------------
describe("tester-adversarial A — scanner role gate holds on every path", () => {
  const scannerIndex = registryIndexAtRank(10);

  test("the role-filtered index itself contains zero owner-only entries", () => {
    const present = scannerIndex.map((e) => e.id);
    for (const leaked of OWNER_ONLY_IDS) {
      expect(present).not.toContain(leaked);
    }
  });

  test("jumpToSuggestions (empty-state) never surfaces an owner-only row", () => {
    const ids = jumpToSuggestions(scannerIndex).map((r) => r.id);
    for (const leaked of OWNER_ONLY_IDS) {
      expect(ids).not.toContain(leaked);
    }
  });

  test("nearestSuggestions (zero-result rescue) never surfaces an owner-only row", () => {
    // Queries that fuzzily resemble the owner-only destinations. If the rescue
    // path operated on an unfiltered index, these would leak.
    for (const q of ["team", "audit", "pricing", "delete account", "tax"]) {
      const ids = nearestSuggestions(q, scannerIndex).map((r) => r.id);
      for (const leaked of OWNER_ONLY_IDS) {
        expect(ids).not.toContain(leaked);
      }
    }
  });

  test("exact boundary: rank === minRank is VISIBLE (>=, not >)", () => {
    // finance_manager rank 30 must SEE payments (minRank 30) — off-by-one guard.
    const financeIndex = registryIndexAtRank(30);
    expect(financeIndex.some((e) => e.id === "payments")).toBe(true);
    // but must NOT see pricing-defaults (minRank 50).
    expect(financeIndex.some((e) => e.id === "pricing-defaults")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. Adapter behavior on type-faithful malformed offering rows
// ---------------------------------------------------------------------------
describe("tester-adversarial B — adapters skip junk ids + emit only safe routes", () => {
  test("eventsToIndexEntries keeps valid rows, skips bad ids, emits safe routes", () => {
    const rows = [
      null,
      undefined,
      {}, // no id
      { id: 42, name: "WrongTypedId", description: "" }, // non-string id
      ev({ id: "ok_event", name: "Real Event" }), // valid
      ev({ id: "null_desc", name: "Edge", description: null as never }), // description null is supported
    ] as never;
    let out: SearchIndexEntry[] = [];
    expect(() => {
      out = eventsToIndexEntries(rows);
    }).not.toThrow();
    const ids = out.map((e) => e.id);
    expect(ids).toContain("ok_event");
    expect(ids).toContain("null_desc");
    expect(ids).not.toContain(42 as never);
    for (const e of out) {
      expect(e.route.length).toBeGreaterThan(0);
      expect(e.route.startsWith("/")).toBe(true);
      expect(e.route.includes(":brandId")).toBe(false);
    }
  });

  test("trips / experiences skip non-string ids and emit safe routes", () => {
    const tripRows = [
      null,
      { id: 7, title: "BadId" },
      { id: "t_ok", title: "Aurora Trip", description: null, status: "live" },
    ] as never;
    const expRows = [
      undefined,
      { id: 9, title: "BadId" },
      { id: "x_ok", title: "Wine Flight", description: null, status: "live" },
    ] as never;
    let trips: SearchIndexEntry[] = [];
    let exps: SearchIndexEntry[] = [];
    expect(() => {
      trips = tripsToIndexEntries(tripRows);
      exps = experiencesToIndexEntries(expRows);
    }).not.toThrow();
    expect(trips.map((e) => e.id)).toContain("t_ok");
    expect(exps.map((e) => e.id)).toContain("x_ok");
    for (const e of [...trips, ...exps]) {
      expect(e.route.startsWith("/")).toBe(true);
    }
    // experiences resolve to their real dashboard route `/experience/{id}`
    // via routeForEventRow (META-ORCH-1059 landed the experience dashboard;
    // the old coming-soon stub is retired) — still no dead tap.
    expect(exps.every((e) => e.route === `/experience/${e.id}`)).toBe(true);
  });

  test("a full build over type-faithful offerings still searches the registry", () => {
    const idx = fullIndexAtRank(60, [ev({ id: "good", name: "Disco Night" })]);
    expect(idx.some((e) => e.id === "good")).toBe(true);
    expect(searchIndex("disco", idx).some((r) => r.id === "good")).toBe(true);
    expect(searchIndex("payments", idx).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C. Per-group cap enforcement for goto + settings + total cap
// ---------------------------------------------------------------------------
describe("tester-adversarial C — per-group caps for goto/settings + total cap", () => {
  test("goto group never exceeds its cap of 6", () => {
    const index = registryIndexAtRank(60);
    const goto = searchIndex("ss", index).filter((r) => r.group === "goto");
    expect(goto.length).toBeLessThanOrEqual(GROUP_CAPS.goto);
  });

  test("settings group never exceeds its cap of 6", () => {
    const index = registryIndexAtRank(60);
    const settings = searchIndex("ss", index).filter(
      (r) => r.group === "settings",
    );
    expect(settings.length).toBeLessThanOrEqual(GROUP_CAPS.settings);
  });

  test("total results never exceed the documented cap of 20; offerings cap = 8", () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      ev({ id: `e_${i}`, name: `Sunset Session ${i}` }),
    );
    const index = fullIndexAtRank(60, events);
    const all = searchIndex("session", index);
    expect(all.length).toBeLessThanOrEqual(
      GROUP_CAPS.offerings + GROUP_CAPS.goto + GROUP_CAPS.settings,
    );
    expect(GROUP_CAPS.offerings + GROUP_CAPS.goto + GROUP_CAPS.settings).toBe(20);
    expect(all.filter((r) => r.group === "offerings").length).toBe(
      GROUP_CAPS.offerings,
    );
  });
});

// ---------------------------------------------------------------------------
// D. Diacritic / case-fold beyond the implementor's "cafe"/"Café"
// ---------------------------------------------------------------------------
describe("tester-adversarial D — diacritic / case fold on synonyms + titles", () => {
  test("a diacritic-bearing query matches a plain registry synonym", () => {
    const index = registryIndexAtRank(60);
    // Registry synonym "currency" → pricing-defaults. Query with an accent on
    // a normally-plain letter must still fold to the same destination.
    const ids = searchIndex("cürrency", index).map((r) => r.id);
    expect(ids).toContain("pricing-defaults");
  });

  test("multi-mark accented title folds both directions + uppercase", () => {
    const index = fullIndexAtRank(60, [
      ev({ id: "e_pinata", name: "Piñata Über Fête" }),
    ]);
    // plain query → accented content
    expect(searchIndex("pinata", index).some((r) => r.id === "e_pinata")).toBe(
      true,
    );
    // accented query → same content
    expect(searchIndex("piñata", index).some((r) => r.id === "e_pinata")).toBe(
      true,
    );
    // uppercase plain query → accented mixed-case content
    expect(searchIndex("UBER", index).some((r) => r.id === "e_pinata")).toBe(
      true,
    );
  });
});
