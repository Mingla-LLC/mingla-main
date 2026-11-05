// Issue #4276 T2, T3, T4, T5, T8: the geometry of covering a city with searches.
//
// Pure functions only, so the coverage claims can be property-tested. A Nearby
// Search covers a circle; a tile "owns" a square cell of side 1.4 x its radius,
// centred on it. The cell's corners are 0.99 of the radius away, so a grid of cells
// that fills a box leaves no point outside a circle.
//
// A capped search splits into 4 searches at half the radius, centred on the 4
// quarters of its cell. Each quarter is again a cell of side 1.4 x the child radius,
// so the same 0.99 holds all the way down.

export const METERS_PER_DEGREE_LAT = 111320;
export const GRID_SPACING_FACTOR = 1.4;
/** D5 in the spec: below this a capped search splits by place type instead. */
export const MIN_SPLIT_RADIUS_M = 150;
/** Gaps narrower than this aren't worth a search, and floats can't resolve less. */
export const COVERAGE_TOLERANCE_M = 1;
/** Google's result cap for one Nearby Search. */
export const SEARCH_RESULT_CAP = 20;
export const COST_PER_NEARBY_SEARCH = 0.032;
export const COST_PER_PHOTO = 0.007;
/** One Google Geocoding request at list price ($5 per 1,000). Planning a box is one;
 * applying it geocodes again, so a box step is two. */
export const COST_PER_GEOCODE = 0.005;
export const EXPECTED_UNIQUE_PLACES_PER_TILE = 10;
export const PHOTOS_PER_PLACE = 5;
/** Above this a person confirms before anything is spent. */
export const HIGH_COST_USD = 500;

export interface Box {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface GridTile {
  tile_index: number;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  row_idx: number;
  col_idx: number;
}

export interface Circle {
  center_lat: number;
  center_lng: number;
  radius_m: number;
}

export function metersPerDegreeLng(lat: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Great-circle distance in metres, on the same sphere as METERS_PER_DEGREE_LAT. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = (METERS_PER_DEGREE_LAT * 180) / Math.PI;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isInsideBox(lat: number, lng: number, box: Box): boolean {
  return lat >= box.swLat && lat <= box.neLat && lng >= box.swLng && lng <= box.neLng;
}

function axis(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  // Count from an integer so float drift can't add or lose a row.
  const steps = Math.floor((end - start) / step + 1e-9);
  for (let i = 0; i <= steps; i++) out.push(start + i * step);
  // T2: the final row and column sit on the box edge, however the spacing falls.
  if (end - out[out.length - 1] > 1e-9) out.push(end);
  return out;
}

/**
 * T2. Longitude spacing uses the latitude in the box nearest the equator, where a
 * degree is widest in metres. Spacing from the box's middle would stretch past 1.4
 * radii on its equator side, which matters on large boxes at high latitude.
 */
export function generateTileGrid(box: Box, tileRadiusM: number): GridTile[] {
  const spacingM = tileRadiusM * GRID_SPACING_FACTOR;
  const widestLat = box.swLat <= 0 && box.neLat >= 0
    ? 0
    : Math.min(Math.abs(box.swLat), Math.abs(box.neLat));
  const lats = axis(box.swLat, box.neLat, spacingM / METERS_PER_DEGREE_LAT);
  const lngs = axis(box.swLng, box.neLng, spacingM / metersPerDegreeLng(widestLat));
  const tiles: GridTile[] = [];
  lats.forEach((lat, row) => {
    lngs.forEach((lng, col) => {
      tiles.push({
        tile_index: tiles.length,
        center_lat: lat,
        center_lng: lng,
        radius_m: tileRadiusM,
        row_idx: row,
        col_idx: col,
      });
    });
  });
  return tiles;
}

export function countGridTiles(box: Box, tileRadiusM: number): number {
  return generateTileGrid(box, tileRadiusM).length;
}

/** The same estimate preview_cost and create_run give for a seed. */
export function estimateSeedCostUsd(tileCount: number, configCount: number): number {
  const search = tileCount * configCount * COST_PER_NEARBY_SEARCH;
  const photo = tileCount * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
  return Math.round((search + photo) * 100) / 100;
}

export interface SplitChild {
  center_lat: number;
  center_lng: number;
  radius_m: number;
  row_idx: number;
  col_idx: number;
}

/**
 * T4. The 4 children of a capped search, or null when it is already at the minimum.
 * Radii round up (the column is an integer) and never go below the minimum, so a
 * child's circle can only be larger than the half the coverage proof needs.
 */
export function splitChildren(parent: Circle & { row_idx: number; col_idx: number }): SplitChild[] | null {
  if (parent.radius_m <= MIN_SPLIT_RADIUS_M) return null;
  const childRadius = Math.max(MIN_SPLIT_RADIUS_M, Math.ceil(parent.radius_m / 2));
  const offsetM = (parent.radius_m * GRID_SPACING_FACTOR) / 4;
  const dLat = offsetM / METERS_PER_DEGREE_LAT;
  const dLng = offsetM / metersPerDegreeLng(parent.center_lat);
  const children: SplitChild[] = [];
  for (const i of [0, 1]) {
    for (const j of [0, 1]) {
      children.push({
        center_lat: parent.center_lat + (i === 0 ? -dLat : dLat),
        center_lng: parent.center_lng + (j === 0 ? -dLng : dLng),
        radius_m: childRadius,
        row_idx: parent.row_idx * 2 + i,
        col_idx: parent.col_idx * 2 + j,
      });
    }
  }
  return children;
}

export type SplitDecision =
  | { kind: "spatial" }
  | { kind: "types"; groups: [string[], string[]] }
  | { kind: "unresolved" };

/** T5. Space first, down to the minimum radius; then type; then say so out loud. */
export function decideSplit(radiusM: number, types: readonly string[]): SplitDecision {
  if (radiusM > MIN_SPLIT_RADIUS_M) return { kind: "spatial" };
  if (types.length > 1) {
    const mid = Math.ceil(types.length / 2);
    return { kind: "types", groups: [types.slice(0, mid), types.slice(mid)] };
  }
  return { kind: "unresolved" };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Disc {
  x: number;
  y: number;
  r: number;
}

/**
 * Exact: a rectangle is covered by discs unless one of its corners, or a point where
 * a disc's edge crosses the rectangle's edge or another disc's edge, lies outside
 * every other disc. Any uncovered region has one of these on its boundary, so unlike
 * sampling this can't miss a sliver between two sample points.
 */
function isRectCovered(rect: Rect, discsIn: Disc[]): boolean {
  const tol = COVERAGE_TOLERANCE_M;
  const seen = new Set<string>();
  const discs = discsIn.filter((d) => {
    const key = `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.r}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const inside = (x: number, y: number, skipA = -1, skipB = -1) =>
    discs.some((d, i) => i !== skipA && i !== skipB && Math.hypot(x - d.x, y - d.y) <= d.r + tol);
  const inRect = (x: number, y: number) =>
    x >= rect.x0 - 1e-6 && x <= rect.x1 + 1e-6 && y >= rect.y0 - 1e-6 && y <= rect.y1 + 1e-6;

  for (const [x, y] of [[rect.x0, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y0], [rect.x1, rect.y1]]) {
    if (!inside(x, y)) return false;
  }
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i];
    for (const x of [rect.x0, rect.x1]) {
      const h = d.r * d.r - (x - d.x) ** 2;
      if (h < 0) continue;
      for (const y of [d.y - Math.sqrt(h), d.y + Math.sqrt(h)]) {
        if (inRect(x, y) && !inside(x, y, i)) return false;
      }
    }
    for (const y of [rect.y0, rect.y1]) {
      const h = d.r * d.r - (y - d.y) ** 2;
      if (h < 0) continue;
      for (const x of [d.x - Math.sqrt(h), d.x + Math.sqrt(h)]) {
        if (inRect(x, y) && !inside(x, y, i)) return false;
      }
    }
    for (let j = i + 1; j < discs.length; j++) {
      const e = discs[j];
      const dist = Math.hypot(e.x - d.x, e.y - d.y);
      if (dist === 0 || dist > d.r + e.r || dist < Math.abs(d.r - e.r)) continue;
      const a = (d.r * d.r - e.r * e.r + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, d.r * d.r - a * a));
      const mx = d.x + (a * (e.x - d.x)) / dist;
      const my = d.y + (a * (e.y - d.y)) / dist;
      for (const sign of [1, -1]) {
        const x = mx + (sign * h * (e.y - d.y)) / dist;
        const y = my - (sign * h * (e.x - d.x)) / dist;
        if (inRect(x, y) && !inside(x, y, i, j)) return false;
      }
    }
  }
  return true;
}

/** True when every point of the box lies inside one of the circles. */
export function isBoxCovered(box: Box, circles: readonly Circle[], tileRadiusM: number): boolean {
  return findUncoveredGridTiles(box, circles, tileRadiusM).length === 0;
}

/**
 * T3. The tiles of the ideal grid whose cell (clipped to the box) the given circles
 * don't fully reach. Adding exactly these makes the box covered, and a city whose
 * tiles already cover it gets none, even when its grid sits differently.
 */
export function findUncoveredGridTiles(
  box: Box,
  circles: readonly Circle[],
  tileRadiusM: number,
): GridTile[] {
  const half = (tileRadiusM * GRID_SPACING_FACTOR) / 2;
  const out: GridTile[] = [];
  for (const tile of generateTileGrid(box, tileRadiusM)) {
    const perLng = metersPerDegreeLng(tile.center_lat);
    // Local plane around this cell, in metres. Good to well under the tolerance at
    // this scale.
    const rect: Rect = {
      x0: Math.max(-half, (box.swLng - tile.center_lng) * perLng),
      x1: Math.min(half, (box.neLng - tile.center_lng) * perLng),
      y0: Math.max(-half, (box.swLat - tile.center_lat) * METERS_PER_DEGREE_LAT),
      y1: Math.min(half, (box.neLat - tile.center_lat) * METERS_PER_DEGREE_LAT),
    };
    const discs: Disc[] = [];
    for (const c of circles) {
      const x = (c.center_lng - tile.center_lng) * perLng;
      const y = (c.center_lat - tile.center_lat) * METERS_PER_DEGREE_LAT;
      if (Math.hypot(x, y) <= c.radius_m + half * Math.SQRT2 + 1) {
        discs.push({ x, y, r: c.radius_m });
      }
    }
    if (!isRectCovered(rect, discs)) out.push(tile);
  }
  return out;
}

/** T8. Evenly random points in the box. rng is injected so tests are repeatable. */
export function randomPointsInBox(
  box: Box,
  count: number,
  rng: () => number = Math.random,
): Array<{ lat: number; lng: number }> {
  return Array.from({ length: count }, () => ({
    lat: box.swLat + rng() * (box.neLat - box.swLat),
    lng: box.swLng + rng() * (box.neLng - box.swLng),
  }));
}

export interface BoxSizeKm {
  widthKm: number;
  heightKm: number;
}

export function boxSizeKm(box: Box): BoxSizeKm {
  const midLat = (box.swLat + box.neLat) / 2;
  return {
    widthKm: ((box.neLng - box.swLng) * metersPerDegreeLng(midLat)) / 1000,
    heightKm: ((box.neLat - box.swLat) * METERS_PER_DEGREE_LAT) / 1000,
  };
}
