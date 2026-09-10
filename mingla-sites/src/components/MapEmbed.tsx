"use client";

import { useId, useState } from "react";

import { planStaticMap } from "../lib/staticMap";

/**
 * #3149 — a map that contacts NOBODY until a visitor asks for one.
 *
 * gogi's own site drops a Google Maps iframe into the page on load. That is one
 * request to Google, with the visitor's IP and the page they are reading,
 * before anyone has asked to see a map — on a product whose own analytics are
 * consent-gated, and on a page that carries no third-party anything else.
 *
 * #3149 wave 4 — SO THE MAP IS DRAWN, AND IT IS STILL NOBODY'S BUSINESS BUT
 * OURS. A visitor now sees where the restaurant is the moment the page paints,
 * from a grid of ordinary images served by THIS origin (see `lib/staticMap`
 * and the route behind `/map`). The browser makes no third-party request; the
 * tiles were fetched once, by us, and cached.
 *
 * What is still behind the button is the INTERACTIVE map — panning, zooming,
 * the provider's own frame — because that genuinely cannot happen without
 * contacting them. The provider is OpenStreetMap: its embed is a plain iframe
 * with no script of ours to load and no advertising identity behind it. The
 * runtime CSP still has to name it — `default-src 'self'` covers `frame-src`,
 * so without the one host added in `lib/csp.ts` the frame is blocked and the
 * panel would simply never resolve.
 *
 * The button says who is contacted BEFORE it is pressed. A "load map" control
 * that does not name the third party is the same leak with an extra click.
 */
export const MAP_TILE_ORIGIN = "https://www.openstreetmap.org" as const;

/*
 * The span of the view, in degrees, around the point. ~0.006° is a few hundred
 * metres: the street and its neighbours, which is the useful scale for finding
 * a frontage. It is fixed rather than carried on the block because a brand has
 * no way to reason about a bounding box, and a wrong one is a map of the wrong
 * thing.
 */
const SPAN = 0.006;

export function mapEmbedUrl(latitude: number, longitude: number): string {
  const clamp = (value: number, limit: number) =>
    Math.max(-limit, Math.min(limit, value));
  const lat = clamp(latitude, 90);
  const lon = clamp(longitude, 180);
  const bbox = [
    clamp(lon - SPAN, 180),
    clamp(lat - SPAN, 90),
    clamp(lon + SPAN, 180),
    clamp(lat + SPAN, 90),
  ].map((value) => value.toFixed(6)).join("%2C");
  return `${MAP_TILE_ORIGIN}/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${
    lat.toFixed(6)
  }%2C${lon.toFixed(6)}`;
}

/*
 * The drawn map. A plane of tiles inside a clipped box, offset so the point is
 * dead centre — which is where the pin is drawn, at 50%/50%, rather than being
 * positioned per-tile.
 *
 * ONE image with a name: the grid is a single `role="img"` labelled with the
 * place, and every square inside it is `alt=""`. A screen reader that read
 * fifteen unlabelled images would be reading the same map fifteen times, and
 * one that read fifteen LABELLED images would be worse.
 *
 * A square that fails to arrive leaves the panel colour behind it. That is the
 * honest degradation for a map: some streets, or none, but never a broken
 * image icon over the address.
 */
function StaticMap(
  { latitude, longitude, label }: {
    latitude: number;
    longitude: number;
    label: string;
  },
) {
  const plan = planStaticMap(latitude, longitude);
  if (!plan || plan.tiles.length === 0) return null;
  return (
    <div className="map-static" role="img" aria-label={`Map of ${label}`}>
      {/*
       * The plane is a FIXED pixel size and is centred on the box, so the point
       * lands at the middle of whatever width the column happens to be. The
       * plan covers at least half its own width and height either side of the
       * point, which is what makes any container up to that size fully
       * covered — a narrower one simply crops, as a map should.
       */}
      <span
        className="map-static-plane"
        style={{ width: `${plan.width}px`, height: `${plan.height}px` }}
      >
        {plan.tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element -- a map tile is a fixed 256px square served by this app's own route; the framework optimiser would re-encode it and add a second hop for nothing.
          <img
            key={tile.path}
            src={tile.path}
            alt=""
            width={256}
            height={256}
            decoding="async"
            style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
          />
        ))}
      </span>
      <span className="map-static-pin" aria-hidden="true" />
    </div>
  );
}

export function MapEmbed(
  { latitude, longitude, label }: {
    latitude: number;
    longitude: number;
    label: string;
  },
) {
  const [shown, setShown] = useState(false);
  const noteId = useId();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!shown) {
    return (
      <div className="map-panel">
        <StaticMap latitude={latitude} longitude={longitude} label={label} />
        <p className="map-panel-place">{label}</p>
        <button
          type="button"
          className="button ghost map-load"
          aria-describedby={noteId}
          onClick={() => setShown(true)}
        >
          Show the map
        </button>
        <p className="map-note" id={noteId}>
          The map above is served by this site. The interactive one is loaded
          from openstreetmap.org, and nothing is requested from them until you
          press this.
        </p>
      </div>
    );
  }
  return (
    <div className="map-frame">
      <iframe
        title={`Map of ${label}`}
        src={mapEmbedUrl(latitude, longitude)}
        loading="lazy"
        /*
         * Nothing about the page a visitor is reading travels with the tile
         * request. `no-referrer` is the strongest value and the map does not
         * need one.
         */
        referrerPolicy="no-referrer"
      />
      <button
        type="button"
        className="button ghost map-load"
        onClick={() => setShown(false)}
      >
        Hide the map
      </button>
    </div>
  );
}
