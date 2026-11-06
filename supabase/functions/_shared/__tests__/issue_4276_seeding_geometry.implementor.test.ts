// Issue #4276 T2, T3, T4, T5, T10: what makes "every area was searched" a provable claim.
//
// MINGLA-INVARIANT: I-4276-TILE-GRID-COVERS-BOX | issue #4276 | Every point in a city's box lies inside a tile circle, including the north and east edges
// MINGLA-INVARIANT: I-4276-SPLIT-CHILDREN-COVER-CELL | issue #4276 | The 4 children of a capped search cover the parent's whole grid cell
// MINGLA-INVARIANT: I-4276-CONFIG-TYPE-LIMIT | issue #4276 | No search config has more than Google's limit of 50 types
//
// FAILS-ON-REVERT: drop the final-row clamp in axis() and the box property fails on the
// north and east edges. Halve the offset in splitChildren and the child property fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type Box,
  type Circle,
  decideSplit,
  distanceM,
  findUncoveredGridTiles,
  generateTileGrid,
  GRID_SPACING_FACTOR,
  isBoxCovered,
  isInsideBox,
  METERS_PER_DEGREE_LAT,
  metersPerDegreeLng,
  MIN_SPLIT_RADIUS_M,
  randomPointsInBox,
  splitChildren,
} from "../seedingGeometry.ts";
import { SEEDING_CATEGORIES } from "../seedingCategories.ts";

/** Small, fast, repeatable. The seed is in the failure message. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBox(r: () => number): Box {
  // Everywhere from Lagos to high-latitude Europe, across the equator and the prime
  // meridian, from a neighbourhood to a whole state.
  const lat = -60 + r() * 125;
  const lng = -170 + r() * 340;
  const heightKm = 1 + r() * 250;
  const widthKm = 1 + r() * 250;
  return {
    swLat: lat,
    swLng: lng,
    neLat: lat + (heightKm * 1000) / METERS_PER_DEGREE_LAT,
    neLng: lng + (widthKm * 1000) / metersPerDegreeLng(lat),
  };
}

const inAnyCircle = (lat: number, lng: number, circles: readonly Circle[], slackM = 0.5) =>
  circles.some((c) => distanceM(lat, lng, c.center_lat, c.center_lng) <= c.radius_m + slackM);

Deno.test("T2 property: every point in a random box lies inside a tile circle", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = prng(seed);
    const box = randomBox(r);
    const radius = [1500, 2000, 2500, 5000][Math.floor(r() * 4)];
    const tiles = generateTileGrid(box, radius);
    const points = randomPointsInBox(box, 400, r);
    // The corners and edge midpoints are where the old grid left its gaps.
    const midLat = (box.swLat + box.neLat) / 2;
    const midLng = (box.swLng + box.neLng) / 2;
    points.push(
      { lat: box.neLat, lng: box.neLng }, { lat: box.neLat, lng: box.swLng },
      { lat: box.swLat, lng: box.neLng }, { lat: box.neLat, lng: midLng }, { lat: midLat, lng: box.neLng },
    );
    for (const p of points) {
      assert(inAnyCircle(p.lat, p.lng, tiles), `seed ${seed}: ${p.lat},${p.lng} is uncovered`);
    }
  }
});

Deno.test("T2: the last row and column sit on the north and east edges", () => {
  const box = { swLat: 35.7, swLng: -78.8, neLat: 35.97, neLng: -78.5 };
  const tiles = generateTileGrid(box, 1500);
  assertEquals(Math.max(...tiles.map((t) => t.center_lat)), box.neLat);
  assertEquals(Math.max(...tiles.map((t) => t.center_lng)), box.neLng);
  assertEquals(Math.min(...tiles.map((t) => t.center_lat)), box.swLat);
  for (const t of tiles) assert(isInsideBox(t.center_lat, t.center_lng, box));
  assertEquals(tiles.map((t) => t.tile_index), tiles.map((_, i) => i));
});

Deno.test("T2: spacing is measured where a degree of longitude is widest", () => {
  // A 400 km box at 60 N. Spacing from its middle would stretch past 1.4 radii in the
  // south, and the far corner of a cell past the radius.
  const box = { swLat: 58, swLng: 10, neLat: 62, neLng: 16 };
  const tiles = generateTileGrid(box, 2000);
  for (const p of randomPointsInBox(box, 3000, prng(7))) {
    assert(inAnyCircle(p.lat, p.lng, tiles), `${p.lat},${p.lng} is uncovered`);
  }
  const bottom = tiles.filter((t) => t.row_idx === 0).sort((a, b) => a.col_idx - b.col_idx);
  const gap = distanceM(bottom[0].center_lat, bottom[0].center_lng, bottom[1].center_lat, bottom[1].center_lng);
  assert(gap <= 2000 * GRID_SPACING_FACTOR + 1, `bottom row spacing ${gap}`);
});

Deno.test("T4 property: child tiles cover the parent's whole cell, at every depth", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const r = prng(seed);
    let parent = {
      center_lat: -60 + r() * 125,
      center_lng: -170 + r() * 340,
      radius_m: [1500, 2500, 2000, 777][Math.floor(r() * 4)],
      row_idx: 3,
      col_idx: 4,
    };
    for (let depth = 0; depth < 6; depth++) {
      const children = splitChildren(parent);
      if (!children) {
        assert(parent.radius_m <= MIN_SPLIT_RADIUS_M);
        break;
      }
      assertEquals(children.length, 4);
      const half = (parent.radius_m * GRID_SPACING_FACTOR) / 2;
      for (let i = 0; i < 400; i++) {
        // A point in the parent's cell, edges included.
        const edgeX = i % 5 === 0 ? (r() < 0.5 ? -1 : 1) : r() * 2 - 1;
        const edgeY = i % 7 === 0 ? (r() < 0.5 ? -1 : 1) : r() * 2 - 1;
        const lat = parent.center_lat + (edgeY * half) / METERS_PER_DEGREE_LAT;
        const lng = parent.center_lng + (edgeX * half) / metersPerDegreeLng(parent.center_lat);
        assert(inAnyCircle(lat, lng, children), `seed ${seed} depth ${depth}: ${lat},${lng} uncovered`);
      }
      for (const c of children) {
        assert(c.radius_m >= parent.radius_m / 2, "a child can't be smaller than half");
        assert(c.radius_m >= MIN_SPLIT_RADIUS_M, "a child can't go under the minimum");
        assert(Number.isInteger(c.radius_m), "the column is an integer");
      }
      parent = children[Math.floor(r() * 4)];
    }
  }
});

Deno.test("T4: neighbouring cells cover what the children leave of the parent's circle", () => {
  // Only the cell is the children's job. The rest of the parent's circle belongs to the
  // neighbouring cells, so a whole grid split everywhere still covers the whole box.
  const box = { swLat: 51.4, swLng: -0.2, neLat: 51.5, neLng: 0 };
  const grid = generateTileGrid(box, 1500);
  const children = grid.flatMap((t) => splitChildren(t)!);
  for (const p of randomPointsInBox(box, 3000, prng(11))) {
    assert(inAnyCircle(p.lat, p.lng, children), `${p.lat},${p.lng} uncovered after a full split`);
  }
});

Deno.test("T5: splits by space to 150 m, then by type, then says it can't", () => {
  assertEquals(decideSplit(151, ["a", "b"]).kind, "spatial");
  assertEquals(decideSplit(1500, ["a"]).kind, "spatial");
  assertEquals(decideSplit(150, ["a", "b", "c"]), { kind: "types", groups: [["a", "b"], ["c"]] });
  assertEquals(decideSplit(150, ["a"]), { kind: "unresolved" });
  // Every starting radius in use reaches exactly 150, never a value below it.
  for (const start of [1500, 2000, 2500]) {
    let tile = { center_lat: 1, center_lng: 1, radius_m: start, row_idx: 0, col_idx: 0 };
    const seen: number[] = [start];
    while (true) {
      const next = splitChildren(tile);
      if (!next) break;
      tile = next[0];
      seen.push(tile.radius_m);
    }
    assertEquals(seen[seen.length - 1], MIN_SPLIT_RADIUS_M, `from ${start}: ${seen}`);
  }
  assertEquals(splitChildren({ center_lat: 1, center_lng: 1, radius_m: 150, row_idx: 0, col_idx: 0 }), null);
});

Deno.test("T3: an intact grid needs no fill, wherever it sits", () => {
  const box = { swLat: 32.6, swLng: -96.9, neLat: 32.8, neLng: -96.7 };
  assertEquals(findUncoveredGridTiles(box, generateTileGrid(box, 1500), 1500), []);
  // Offset by half a cell: different tiles, same coverage, extended past the box.
  const shifted = generateTileGrid(
    { swLat: box.swLat - 0.01, swLng: box.swLng - 0.01, neLat: box.neLat + 0.01, neLng: box.neLng + 0.01 },
    1500,
  );
  assertEquals(findUncoveredGridTiles(box, shifted, 1500), []);
  assert(isBoxCovered(box, shifted, 1500));
});

Deno.test("T3 property: fill finds the gaps, and fill closes them", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = prng(seed * 31);
    const box = randomBox(r);
    box.neLat = box.swLat + (box.neLat - box.swLat) / 6;
    box.neLng = box.swLng + (box.neLng - box.swLng) / 6;
    const radius = 2000;
    // Remove a third of the grid at random, like the starter pattern did.
    const existing = generateTileGrid(box, radius).filter(() => r() > 0.33);
    const fill = findUncoveredGridTiles(box, existing, radius);
    const after = [...existing, ...fill];
    for (const p of randomPointsInBox(box, 600, r)) {
      assert(inAnyCircle(p.lat, p.lng, after, 1.5), `seed ${seed}: ${p.lat},${p.lng} uncovered after fill`);
    }
    assertEquals(findUncoveredGridTiles(box, after, radius), [], `seed ${seed}: fill wasn't final`);
  }
});

Deno.test("T3: the old unclamped grid's edge gap is found, with only the edge tiles added", () => {
  // Raleigh's shape: the grid stops 1.67 km short of the north edge, past what the
  // last row's circles reach between columns (0.714 of the radius).
  const spacingLat = (1500 * GRID_SPACING_FACTOR) / METERS_PER_DEGREE_LAT;
  const box = { swLat: 35.7, swLng: -78.8, neLat: 35.7 + spacingLat * 5 + 0.015, neLng: -78.7 };
  const full = generateTileGrid(box, 1500);
  const stopsShort = full.filter((t) => t.center_lat !== box.neLat);
  const fill = findUncoveredGridTiles(box, stopsShort, 1500);
  assert(fill.length > 0, "the gap must be seen");
  assert(fill.length < full.length / 2, `only the edge should need tiles, got ${fill.length} of ${full.length}`);
});

Deno.test("T10: no search config has more than 50 types", () => {
  const over = SEEDING_CATEGORIES.flatMap((c) =>
    ([["includedTypes", c.includedTypes], ["excludedPrimaryTypes", c.excludedPrimaryTypes]] as const)
      .filter(([, list]) => list.length > 50)
      .map(([field, list]) => `${c.id}.${field} has ${list.length}`)
  );
  assertEquals(over, []);
  assertEquals(SEEDING_CATEGORIES.length, 14);
});

Deno.test("the migration's frozen config order matches SEEDING_CATEGORIES", () => {
  const sql = Deno.readTextFileSync(
    new URL("../../../migrations/20280410024276_issue_4276_tile_completeness.sql", import.meta.url),
  );
  const pairs = [...sql.matchAll(/\('([a-z_]+)', '([a-z_]+)', (\d)\)/g)]
    .map((m) => ({ slug: m[1], id: m[2], ord: Number(m[3]) }));
  const expected: typeof pairs = [];
  const seen = new Map<string, number>();
  for (const c of SEEDING_CATEGORIES) {
    const ord = (seen.get(c.appCategorySlug) ?? 0) + 1;
    seen.set(c.appCategorySlug, ord);
    expected.push({ slug: c.appCategorySlug, id: c.id, ord });
  }
  const key = (p: { slug: string; id: string; ord: number }) => `${p.slug}/${p.id}/${p.ord}`;
  assertEquals(pairs.map(key).sort(), expected.map(key).sort());
});
