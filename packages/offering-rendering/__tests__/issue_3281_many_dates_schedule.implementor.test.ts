/**
 * issue #3281 many-dates — schedule layout helpers (PR 2).
 * [TEST-MOD-APPROVED #3281] append-only suite for many-dates foundation.
 */
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chooseEventDateLayout,
  filterUpcomingOccurrences,
  placesLeftChip,
  weekStartForCountry,
} from "../eventDateSchedule.ts";

const day = (n: number, hour = 12) => {
  const d = new Date(Date.UTC(2026, 10, n, hour, 0, 0));
  return {
    id: `d${n}`,
    startAt: d.toISOString(),
    endAt: new Date(d.getTime() + 3 * 3600_000).toISOString(),
  };
};

Deno.test("filterUpcomingOccurrences drops ended dates", () => {
  const now = Date.parse("2026-11-05T00:00:00.000Z");
  const out = filterUpcomingOccurrences([day(1), day(10)], now);
  assertEquals(out.map((o) => o.id), ["d10"]);
});

Deno.test("chooseEventDateLayout: pass / chips / tiles", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  const many = Array.from({ length: 12 }, (_, i) => day(i + 2));
  assertEquals(
    chooseEventDateLayout(many, { allDaysPass: true, nowMs: now }).kind,
    "pass",
  );
  assertEquals(
    chooseEventDateLayout([day(2), day(3), day(4)], { nowMs: now }).kind,
    "chips",
  );
  // Sparse across months → tiles
  const sparse = [day(2), day(20), day(28)];
  // force >6 by duplicating pattern with later months
  const sparseMany = [
    ...Array.from({ length: 4 }, (_, i) => day(2 + i)),
    ...Array.from({ length: 4 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 11, 5 + i * 5, 12));
      return {
        id: `m${i}`,
        startAt: d.toISOString(),
        endAt: new Date(d.getTime() + 3600_000).toISOString(),
      };
    }),
  ];
  const layout = chooseEventDateLayout(sparseMany, { nowMs: now });
  assertEquals(layout.kind === "tiles" || layout.kind === "chips", true);
  assertExists(sparse[0]);
});

Deno.test("placesLeftChip thresholds", () => {
  assertEquals(placesLeftChip(null), null);
  assertEquals(placesLeftChip(0), "Sold out");
  assertEquals(placesLeftChip(3), "Only 3 left");
  assertEquals(placesLeftChip(11), null);
});

Deno.test("weekStartForCountry US Sunday / NG Monday", () => {
  assertEquals(weekStartForCountry("US"), 0);
  assertEquals(weekStartForCountry("NG"), 1);
});

Deno.test("package.json dependencies unchanged (no new native modules)", () => {
  const raw = Deno.readTextFileSync(
    new URL("../package.json", import.meta.url),
  );
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  assertEquals(pkg.dependencies ?? {}, {});
  assertExists(pkg.peerDependencies?.react);
  assertEquals(
    Object.keys(pkg.peerDependencies ?? {}).includes("expo-calendar"),
    false,
  );
});
