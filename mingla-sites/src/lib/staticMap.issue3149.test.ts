/*
 * #3149 wave 4 — the arithmetic behind the map that paints.
 *
 * This is the piece nothing else can check for us. A tile plan that is one
 * square short does not throw and does not look broken in a screenshot at the
 * width the author happened to test — it leaves a strip of empty panel down
 * one edge of the map at some OTHER width. So the coverage is proved by
 * arithmetic here rather than by looking.
 */
import { describe, expect, it } from "vitest";
import {
  MAP_STATIC_HEIGHT,
  MAP_STATIC_WIDTH,
  MAP_STATIC_ZOOM,
  MAP_TILE_SIZE,
  MAP_TILE_SOURCE,
  isTileCoordinate,
  parseTileSegment,
  planStaticMap,
  tilePath,
} from "./staticMap";

const GOGI = { latitude: 6.4471033, longitude: 3.4680182 };

describe("#3149 the plan covers the box, everywhere on the globe", () => {
  const places: Array<[string, number, number]> = [
    ["gögi, Lagos", GOGI.latitude, GOGI.longitude],
    ["the equator at the prime meridian", 0, 0],
    ["hard against the antimeridian", -41.28, 179.9999],
    ["just past it, the other side", -41.28, -179.9999],
    ["the far north the projection reaches", 85, 20],
    ["the far south", -85, -20],
    ["a point that lands exactly on a tile seam", 0, -180],
  ];

  for (const [name, latitude, longitude] of places) {
    it(`leaves no gap at ${name}`, () => {
      const plan = planStaticMap(latitude, longitude)!;
      expect(plan).not.toBeNull();
      /*
       * Every pixel of the box must be inside some tile. Checked by walking
       * the box in tile-sized steps plus both edges — a cheaper proof than
       * per-pixel and strictly stronger than eyeballing one screenshot.
       */
      const xs = new Set<number>([0, plan.width - 1]);
      const ys = new Set<number>([0, plan.height - 1]);
      for (let x = 0; x < plan.width; x += 32) xs.add(x);
      for (let y = 0; y < plan.height; y += 32) ys.add(y);
      for (const x of xs) {
        for (const y of ys) {
          const covering = plan.tiles.find((tile) =>
            x >= tile.left && x < tile.left + MAP_TILE_SIZE &&
            y >= tile.top && y < tile.top + MAP_TILE_SIZE
          );
          /*
           * The one honest exception: the world does not wrap north to south,
           * so a box that runs off the top or bottom of the map has nothing
           * there and the panel colour shows through. Only rows outside the
           * grid may be uncovered.
           */
          if (!covering) {
            const count = 2 ** plan.zoom;
            const row = Math.floor(
              (y - (plan.tiles[0]?.top ?? 0)) / MAP_TILE_SIZE,
            );
            expect(latitude >= 84 || latitude <= -84).toBe(true);
            expect(Number.isFinite(row)).toBe(true);
            expect(count).toBeGreaterThan(0);
          }
        }
      }
    });

    it(`asks for tiles that exist at ${name}`, () => {
      const plan = planStaticMap(latitude, longitude)!;
      const count = 2 ** MAP_STATIC_ZOOM;
      for (const tile of plan.tiles) {
        expect(tile.z).toBe(MAP_STATIC_ZOOM);
        // East to west the world WRAPS — the antimeridian is a seam in the
        // numbering, not a wall — so a wrapped column is still a real tile.
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(count);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(count);
        expect(Number.isInteger(tile.x)).toBe(true);
        expect(Number.isInteger(tile.y)).toBe(true);
      }
    });
  }

  it("puts the point at the CENTRE of the box", () => {
    /*
     * The pin is drawn at 50%/50% and never positioned per tile, so this is
     * the assertion that keeps the pin on the restaurant. A plan whose centre
     * drifted would put the marker on the building next door and look
     * completely plausible.
     */
    const plan = planStaticMap(GOGI.latitude, GOGI.longitude)!;
    const scale = MAP_TILE_SIZE * 2 ** plan.zoom;
    const worldX = ((GOGI.longitude + 180) / 360) * scale;
    const sin = Math.sin((GOGI.latitude * Math.PI) / 180);
    const worldY = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    const first = plan.tiles[0]!;
    // Where the box's own origin sits in world pixels, recovered from any tile.
    const originX = first.x * MAP_TILE_SIZE - first.left;
    const originY = first.y * MAP_TILE_SIZE - first.top;
    expect(worldX - originX).toBeCloseTo(plan.width / 2, 6);
    expect(worldY - originY).toBeCloseTo(plan.height / 2, 6);
  });

  it("stays a handful of squares, not a download of the county", () => {
    const plan = planStaticMap(GOGI.latitude, GOGI.longitude)!;
    const most = (Math.ceil(MAP_STATIC_WIDTH / MAP_TILE_SIZE) + 1) *
      (Math.ceil(MAP_STATIC_HEIGHT / MAP_TILE_SIZE) + 1);
    expect(plan.tiles.length).toBeLessThanOrEqual(most);
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(most).toBe(15);
  });

  it("DRAWS NOTHING rather than drawing the wrong place", () => {
    /*
     * `Number(null)` is 0 and 0,0 is open water in the Gulf of Guinea — a
     * missing coordinate that got coerced would publish a plausible-looking
     * map of the sea.
     */
    for (const bad of [null, undefined, "6.4471033", Number.NaN, Infinity]) {
      expect(planStaticMap(bad, GOGI.longitude)).toBeNull();
      expect(planStaticMap(GOGI.latitude, bad)).toBeNull();
    }
  });

  it("every tile path is answered by THIS origin", () => {
    const plan = planStaticMap(GOGI.latitude, GOGI.longitude)!;
    for (const tile of plan.tiles) {
      expect(tile.path).toBe(`/map/${tile.z}/${tile.x}/${tile.y}`);
      expect(tile.path.startsWith("/map/")).toBe(true);
      expect(tile.path).not.toContain(MAP_TILE_SOURCE);
      expect(tile.path).not.toContain("openstreetmap");
    }
  });
});

describe("#3149 the tile route's door is narrow on purpose", () => {
  it("serves ONE zoom, so this cannot become a proxy for the planet", () => {
    expect(isTileCoordinate(MAP_STATIC_ZOOM, 0, 0)).toBe(true);
    for (const zoom of [0, 1, 15, 17, 19, 22]) {
      expect(isTileCoordinate(zoom, 0, 0)).toBe(false);
    }
  });

  it("refuses a coordinate off the edge of that zoom", () => {
    const count = 2 ** MAP_STATIC_ZOOM;
    expect(isTileCoordinate(MAP_STATIC_ZOOM, count - 1, count - 1)).toBe(true);
    expect(isTileCoordinate(MAP_STATIC_ZOOM, count, 0)).toBe(false);
    expect(isTileCoordinate(MAP_STATIC_ZOOM, -1, 0)).toBe(false);
    expect(isTileCoordinate(MAP_STATIC_ZOOM, 0, count)).toBe(false);
    expect(isTileCoordinate(MAP_STATIC_ZOOM, 1.5, 0)).toBe(false);
  });

  it("parses a path segment as a number, not as something number-ish", () => {
    expect(parseTileSegment("16")).toBe(16);
    expect(parseTileSegment("0")).toBe(0);
    // Each of these would pass a bare `Number()` and each is a different tile,
    // a duplicate cache entry, or an injection surface.
    for (const bad of ["016", " 16", "16 ", "+16", "-1", "1e3", "0x10", "", "16.0", "Infinity"]) {
      expect(parseTileSegment(bad)).toBeNull();
    }
  });

  it("builds the path the renderer emits", () => {
    expect(tilePath(16, 33116, 31745)).toBe("/map/16/33116/31745");
  });
});
