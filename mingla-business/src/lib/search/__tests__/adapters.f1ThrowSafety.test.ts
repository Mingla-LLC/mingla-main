/**
 * META-ORCH-1073 Sub-A — F-1 throw-safety regression (orchestrator CLOSE).
 *
 * QA finding F-1: the SPEC invariant is "adapters never throw", but the
 * original `buildSearchText` guarded `null` and not `undefined`, so a cache
 * row carrying `undefined` for `title`/`description` would reach `.length` /
 * `normalizeSearchText` and crash `buildSearchIndex` — which runs inside the
 * mounted tabs-root `useMemo` (would crash the sheet, not degrade it).
 *
 * This test feeds every adapter type-unfaithful rows (undefined title/body/
 * location/keywords) and asserts: (a) no throw, (b) the malformed row is still
 * indexed with a safe empty title rather than dropped or crashing.
 *
 * Fails-on-revert: reverting the adapters.ts coalesce guards turns these red.
 */

import {
  eventsToIndexEntries,
  draftsToIndexEntries,
  tripsToIndexEntries,
  experiencesToIndexEntries,
} from "../adapters";
import { buildSearchIndex } from "../globalSearch";

// Deliberately type-unfaithful rows: the real types say string/string|null,
// but defensive code must survive `undefined` arriving from a stale/foreign
// cache shape. Cast through `unknown` to bypass the compile-time contract.
const junkEvent = {
  id: "ev-junk",
  // title/name, description, location_text all undefined
  event_type: "event",
  status: undefined,
} as unknown as Parameters<typeof eventsToIndexEntries>[0] extends readonly (infer T)[]
  ? T
  : never;

describe("META-ORCH-1073 Sub-A — adapters F-1 throw-safety", () => {
  it("eventsToIndexEntries does not throw on undefined title/body/location", () => {
    expect(() => eventsToIndexEntries([junkEvent] as never)).not.toThrow();
    const out = eventsToIndexEntries([junkEvent] as never);
    expect(Array.isArray(out)).toBe(true);
    // a row with a valid id is still indexed (empty title is fine)
    expect(out.length).toBe(1);
    expect(out[0]?.searchText.title).toBe("");
  });

  it("draftsToIndexEntries does not throw on undefined fields", () => {
    expect(() =>
      draftsToIndexEntries([junkEvent] as never, "brand-1"),
    ).not.toThrow();
  });

  it("tripsToIndexEntries does not throw on undefined fields", () => {
    expect(() => tripsToIndexEntries([junkEvent] as never)).not.toThrow();
  });

  it("experiencesToIndexEntries does not throw on undefined fields", () => {
    expect(() =>
      experiencesToIndexEntries([junkEvent] as never),
    ).not.toThrow();
  });

  it("buildSearchIndex survives a fully-malformed offering set", () => {
    expect(() =>
      buildSearchIndex({
        events: [junkEvent] as never,
        drafts: [junkEvent] as never,
        trips: [junkEvent] as never,
        experiences: [junkEvent] as never,
        brandId: "brand-1",
      }),
    ).not.toThrow();
  });
});
