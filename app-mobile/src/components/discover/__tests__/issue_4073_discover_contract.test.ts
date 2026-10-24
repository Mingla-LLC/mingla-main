// @ts-nocheck — Node strip-types suite; app-mobile's tsc sweep does not enable
// allowImportingTsExtensions, while the registered test command executes it directly.
import assert from "node:assert/strict";
import test from "node:test";

import { emptyDiscoverFilters, normalizeDiscoverFilters } from "../../../types/discoverFeed.ts";
import { discoverFilterSelectionCount, setDiscoverGuests, updateDiscoverFilter } from "../discoverFilterState.ts";

test("#4073 normalized filters are stable and pill switches can reset independently", () => {
  const first = normalizeDiscoverFilters({ kind: "events", f: { vibeTags: ["wild", "chill"], when: "weekend", partyTypes: ["rave"] } });
  const second = normalizeDiscoverFilters({ kind: "events", f: { partyTypes: ["rave"], when: "weekend", vibeTags: ["chill", "wild"] } });
  assert.deepEqual(first, second);
  assert.deepEqual(emptyDiscoverFilters("trips"), { kind: "trips", f: {} });
  assert.deepEqual(emptyDiscoverFilters("stays"), { kind: "stays", f: { guests: 2 } });
});

test("#4073 multi-select and single-select filters toggle instead of duplicating", () => {
  const vibe = { id: "vibe", multi: true, options: [{ id: "wild", count: 4 }] } as const;
  const when = { id: "when", multi: false, options: [{ id: "tomorrow", count: 2 }] } as const;
  let filters = updateDiscoverFilter({ kind: "events", f: {} }, vibe, "wild");
  assert.deepEqual(filters, { kind: "events", f: { vibeTags: ["wild"] } });
  filters = updateDiscoverFilter(filters, vibe, "wild");
  assert.deepEqual(filters, { kind: "events", f: {} });
  filters = updateDiscoverFilter(filters, when, "tomorrow");
  assert.equal(discoverFilterSelectionCount(filters), 1);
  filters = updateDiscoverFilter(filters, when, "tomorrow");
  assert.equal(discoverFilterSelectionCount(filters), 0);
});

test("#4073 stay guest count clamps to the contracted 1..8 range and default two is not a selection", () => {
  const defaults = emptyDiscoverFilters("stays");
  assert.equal(discoverFilterSelectionCount(defaults), 0);
  assert.deepEqual(setDiscoverGuests(defaults, 0), { kind: "stays", f: { guests: 1 } });
  assert.deepEqual(setDiscoverGuests(defaults, 99), { kind: "stays", f: { guests: 8 } });
});
