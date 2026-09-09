"use client";

import { useId, useState } from "react";

/**
 * #3149 — a map that contacts NOBODY until a visitor asks for one.
 *
 * gogi's own site drops a Google Maps iframe into the page on load. That is one
 * request to Google, with the visitor's IP and the page they are reading,
 * before anyone has asked to see a map — on a product whose own analytics are
 * consent-gated, and on a page that carries no third-party anything else. So
 * this renders a panel, and the map arrives only on a click.
 *
 * The provider is OpenStreetMap: its embed is a plain iframe with no script of
 * ours to load and no advertising identity behind it. The runtime CSP still has
 * to name it — `default-src 'self'` covers `frame-src`, so without the one host
 * added in `lib/csp.ts` the frame is blocked and the panel would simply never
 * resolve.
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
          The map is loaded from openstreetmap.org. Nothing is requested from
          them until you press this.
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
