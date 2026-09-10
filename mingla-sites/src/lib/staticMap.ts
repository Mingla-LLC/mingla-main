/*
 * #3149 wave 4 — THE MAP A VISITOR SEES THE MOMENT THE PAGE PAINTS, WITHOUT
 * THE PAGE CONTACTING ANYONE.
 *
 * Wave 3 put the map behind a button because loading a third party's frame on
 * page load hands them every visitor's IP and the page they are reading before
 * anyone has asked for a map. That decision is overruled — a restaurant's Visit
 * page should show where the restaurant is — but the leak is not reintroduced
 * to do it.
 *
 * So the map that paints is an ORDINARY IMAGE GRID SERVED FROM THIS ORIGIN.
 * This module does the arithmetic: which square tiles of the world cover the
 * box around a point, and where each one sits inside that box. The renderer
 * emits them as `<img src="/map/...">`, the route behind that path is the only
 * thing that ever talks to a tile server, and it caches what it fetches.
 *
 * The interactive map — pan, zoom, the third party's own frame — is still one
 * press away and still names who it contacts before it is pressed.
 *
 * The projection is Web Mercator, which is what every raster tile scheme uses:
 * the world is one square at zoom 0 and splits into four at each zoom after
 * that, so a point maps to a pixel by arithmetic alone. Nothing here is asked
 * of a network and nothing is asked of a geocoder — this takes TWO NUMBERS,
 * exactly as the block contract carries them, and never a place name.
 */

/** Where the tiles ultimately come from. Read ONLY by the server-side route. */
export const MAP_TILE_SOURCE = "https://tile.openstreetmap.org" as const;

/** The path prefix this app serves tiles from. A reserved page slug. */
export const MAP_TILE_PATH_PREFIX = "/map" as const;

export const MAP_TILE_SIZE = 256;

/*
 * ONE zoom, fixed. A brand has no way to reason about a zoom level, and the
 * route refuses every other one — which is what keeps this from being a
 * general-purpose tile proxy for the whole internet rather than the fifteen
 * squares one restaurant's frontage needs. 16 is the street scale: the road,
 * its name, and the two junctions either side of it.
 */
export const MAP_STATIC_ZOOM = 16;

/*
 * The box, in CSS pixels, that the tiles must cover. The stylesheet holds the
 * rendered map to exactly this size, so the plane never has to stretch: a
 * stretched raster tile is a blurred street name.
 */
export const MAP_STATIC_WIDTH = 1024;
export const MAP_STATIC_HEIGHT = 330;

/*
 * Web Mercator is undefined at the poles — the projection runs to about
 * 85.05°, and the logarithm below runs to infinity past it. A latitude beyond
 * that is clamped rather than refused: the block contract already accepts
 * anything from -90 to 90, and a restaurant at 89°N deserves a map of the
 * furthest north the projection can draw, not a blank box.
 */
const MERCATOR_LIMIT = 85.05112878;

export type MapTile = {
  z: number;
  x: number;
  y: number;
  /** Offset of this tile's left edge from the left edge of the box, in px. */
  left: number;
  /** Offset of this tile's top edge from the top edge of the box, in px. */
  top: number;
  path: string;
};

export type StaticMapPlan = {
  zoom: number;
  width: number;
  height: number;
  tiles: MapTile[];
};

export function tilePath(z: number, x: number, y: number): string {
  return `${MAP_TILE_PATH_PREFIX}/${z}/${x}/${y}`;
}

function worldPixel(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number } {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitude));
  const lon = Math.max(-180, Math.min(180, longitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The tiles that cover a box centred on one point, and where each one sits.
 *
 * Returns null for a coordinate that is not a number — `Number(null)` is 0 and
 * 0,0 is open water in the Gulf of Guinea, so a missing latitude must draw NO
 * map rather than a plausible-looking map of the wrong place.
 */
export function planStaticMap(
  latitude: unknown,
  longitude: unknown,
  box: { width?: number; height?: number; zoom?: number } = {},
): StaticMapPlan | null {
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) ||
    typeof longitude !== "number" || !Number.isFinite(longitude)
  ) return null;
  const zoom = box.zoom ?? MAP_STATIC_ZOOM;
  const width = box.width ?? MAP_STATIC_WIDTH;
  const height = box.height ?? MAP_STATIC_HEIGHT;
  const count = 2 ** zoom;
  const centre = worldPixel(latitude, longitude, zoom);
  const left = centre.x - width / 2;
  const top = centre.y - height / 2;
  const firstX = Math.floor(left / MAP_TILE_SIZE);
  const firstY = Math.floor(top / MAP_TILE_SIZE);
  const lastX = Math.ceil((left + width) / MAP_TILE_SIZE) - 1;
  const lastY = Math.ceil((top + height) / MAP_TILE_SIZE) - 1;
  const tiles: MapTile[] = [];
  for (let row = firstY; row <= lastY; row += 1) {
    /*
     * The world does NOT wrap north to south. A box that runs off the top of
     * the map simply has nothing there, and asking for tile -1 would 404 on
     * every provider — so the row is dropped and the box shows the sea colour
     * the stylesheet paints behind it.
     */
    if (row < 0 || row >= count) continue;
    for (let column = firstX; column <= lastX; column += 1) {
      // East to west it DOES wrap: the antimeridian is a seam in the numbering
      // and not a wall, so a venue on it still gets a whole map.
      const wrapped = ((column % count) + count) % count;
      tiles.push({
        z: zoom,
        x: wrapped,
        y: row,
        left: column * MAP_TILE_SIZE - left,
        top: row * MAP_TILE_SIZE - top,
        path: tilePath(zoom, wrapped, row),
      });
    }
  }
  return { zoom, width, height, tiles };
}

/**
 * Is this a tile coordinate at all? Shape only — whether THIS SITE is allowed
 * to ask for it is a separate question, answered by the route against the
 * published artifact's own map blocks.
 */
export function isTileCoordinate(
  z: unknown,
  x: unknown,
  y: unknown,
): z is number {
  if (z !== MAP_STATIC_ZOOM) return false;
  const count = 2 ** MAP_STATIC_ZOOM;
  return [x, y].every(
    (value) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 &&
      value < count,
  );
}

/** `"0016"` is not 16. Parses a path segment the way a route must. */
export function parseTileSegment(value: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
