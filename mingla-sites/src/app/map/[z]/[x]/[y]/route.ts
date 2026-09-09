import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { loadPublication, normalizePublicHost } from "../../../../../lib/publication";
import {
  MAP_TILE_SOURCE,
  isTileCoordinate,
  parseTileSegment,
  planStaticMap,
} from "../../../../../lib/staticMap";

/*
 * #3149 wave 4 — THE ONE DOOR A MAP TILE COMES THROUGH.
 *
 * A visitor's browser must make ZERO third-party requests when a page paints,
 * and a Visit page now paints a map. Both are only true together if the map's
 * squares are served from this origin, so this route fetches them once, checks
 * them, and hands back an image with a year-long immutable cache.
 *
 * IT IS NOT AN OPEN PROXY, and the guard is the same one the media route uses:
 * the request is answered against the SITE'S OWN PUBLISHED ARTIFACT. The
 * artifact's `map_embed` blocks are re-planned here and a coordinate that is
 * not in that plan is a 404. A published site therefore exposes the ten to
 * fifteen squares around its own frontage and nothing else — there is no way
 * to walk this endpoint across a country, let alone the planet.
 *
 * The upstream request identifies Mingla by name and by a URL, which is what
 * the tile provider's usage policy asks of anyone who uses it, and the caching
 * here is the other half of that bargain: a tile is fetched once and then
 * served from this app and its CDN for a year.
 */

// The tile provider asks that automated users identify themselves.
const TILE_USER_AGENT =
  "MinglaSites/1.0 (+https://usemingla.com; restaurant website tiles)";

export async function GET(
  _request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
) {
  try {
    const { z, x, y } = await context.params;
    const zoom = parseTileSegment(z);
    const column = parseTileSegment(x);
    const row = parseTileSegment(y);
    if (!isTileCoordinate(zoom, column, row)) throw new Error();
    const incoming = await headers();
    const host = normalizePublicHost(
      incoming.get("x-forwarded-host") || incoming.get("host"),
    );
    const { artifact } = await loadPublication(host);
    /*
     * Every square this site's own maps need, and no other. Re-derived rather
     * than trusted from the request, so the allowed set cannot drift from what
     * the page actually asks for.
     */
    const permitted = new Set<string>();
    for (const page of artifact.pages) {
      for (const block of page.blocks) {
        if (block.type !== "map_embed") continue;
        const plan = planStaticMap(block.latitude, block.longitude);
        for (const tile of plan?.tiles ?? []) {
          permitted.add(`${tile.z}/${tile.x}/${tile.y}`);
        }
      }
    }
    if (!permitted.has(`${zoom}/${column}/${row}`)) throw new Error();
    const upstream = await fetch(
      `${MAP_TILE_SOURCE}/${zoom}/${column}/${row}.png`,
      {
        headers: { "user-agent": TILE_USER_AGENT, accept: "image/png" },
        /*
         * Fetched ONCE. Next keeps the response in its data cache for a month,
         * which is what turns "one request per visitor to a third party" into
         * "one request per tile per month, from us".
         */
        next: { revalidate: 2_592_000 },
      },
    );
    if (!upstream.ok) throw new Error();
    /*
     * A tile is a PNG or it is not a tile. Without this an error page, an
     * HTML redirect or a rate-limit notice would be served to the browser
     * under an image content type.
     */
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error();
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 2_000_000) throw new Error();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        // Nothing about the page a visitor is reading travels onward, and the
        // square itself is not a document anyone should be able to frame.
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      },
    });
  } catch {
    return new NextResponse(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
}
