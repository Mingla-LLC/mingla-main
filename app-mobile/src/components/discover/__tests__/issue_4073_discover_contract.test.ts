// @ts-nocheck — Node strip-types suite; app-mobile's tsc sweep does not enable
// allowImportingTsExtensions, while the registered test command executes it directly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("#4073 restores watch deep links and records privacy-safe filter and viewability analytics", () => {
  const screen = readFileSync(fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)), "utf8");
  const store = readFileSync(fileURLToPath(new URL("../../../store/appStore.ts", import.meta.url)), "utf8");

  assert.match(store, /discoverPendingWatchCity: string \| null/);
  assert.match(screen, /deepLinkParams\?\.watchCity/);
  assert.match(screen, /discoverCityWatchService\.status\(pendingWatchCity\)/);
  assert.match(screen, /setPendingWatchCity\(null\)/);
  assert.match(screen, /visibleHeight \/ layout\.height < 0\.5/);
  assert.match(screen, /setTimeout\(evaluateViewability, 1_050\)/);
  assert.match(screen, /discover_card_viewed/);
  assert.match(screen, /"app_impression"/);
  assert.match(screen, /discover_card_opened/);
  assert.match(screen, /discover_filter_applied/);
  assert.match(screen, /option_count: discoverFilterSelectionCount/);
  assert.doesNotMatch(screen, /discover_filter_applied[\s\S]{0,240}(?:title|label):/);
});

test("#4073 headings describe only the inventory that actually renders", () => {
  const screen = readFileSync(fileURLToPath(new URL("../../DiscoverScreen.tsx", import.meta.url)), "utf8");
  assert.match(screen, /items\.some\(\(card\) => card\.source === "mingla"\)/);
  assert.match(screen, /firstTicketmaster = card\.source === "ticketmaster"/);
  assert.match(screen, /firstTicketmaster \? <View style=\{hasMingla \? styles\.divider : styles\.tmHeading\}>/);
});
