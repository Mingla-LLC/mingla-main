/**
 * pinDropMapStyle — Issue #1363 (CHANGE 3 — satellite imagery in the pin-drop).
 *
 * The business app has no street labels to rely on in un-indexed Nigerian areas,
 * so the PinDropSheet defaults to Mapbox SATELLITE-STREETS imagery — real aerial
 * photography WITH the road/label overlay (best of both) — so the brand can
 * visually find their building or junction. A toggle lets them switch to the
 * plain dark "Map" style (matches the app chrome) when the imagery is noisy.
 *
 * These are the Mapbox style ids the `static-map` edge-fn ALREADY allowlists
 * (supabase/functions/static-map/index.ts ALLOWED_STYLES) and that flow through
 * `buildStaticMapUrl`'s `style` param end-to-end — so CHANGE 3 is purely additive
 * on the client, with NO edge-fn / proxy change.
 *
 * Pure + react-free so the default + the map/satellite mapping are unit-testable
 * in a node env (mirrors the assistFooter / staticMapPixelToLngLat pattern).
 */

/** Imagery + road/label overlay — the default (best of both for NG). */
export const PIN_DROP_SATELLITE_STYLE = "satellite-streets-v12";
/** Plain dark vector map (matches the app chrome) — the toggle-off alternative. */
export const PIN_DROP_MAP_STYLE = "dark-v11";
/** The PinDropSheet OPENS on satellite (imagery-first — CHANGE 3). */
export const PIN_DROP_DEFAULT_SATELLITE = true;

/** Resolve the Mapbox style id for the pin-drop map from the toggle state. */
export const pinDropMapStyle = (satelliteOn: boolean): string =>
  satelliteOn ? PIN_DROP_SATELLITE_STYLE : PIN_DROP_MAP_STYLE;
