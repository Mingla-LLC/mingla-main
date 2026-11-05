// Issue #4276 B1: the geo box on a real map. Google's box, the stored box and the
// proposed box as outlines, and every active tile as a circle coloured by whether its
// searches ran: searched, unfinished, never searched. Areas no tile reaches are
// dashed red. Same map library and street tiles as the Map tab.

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Circle, Rectangle, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export const TILE_STATE_STYLE = Object.freeze({
  searched: { color: "#6b7280", fillColor: "#e5e7eb", label: "Searched" },
  unfinished: { color: "#b45309", fillColor: "#fdba74", label: "Some searches unfinished" },
  never_searched: { color: "#b91c1c", fillColor: "#fecaca", label: "Never searched" },
});

const BOX_STYLE = Object.freeze({
  stored: { color: "#111827", weight: 2, fill: false, label: "Stored box" },
  google: { color: "#2563eb", weight: 2, dashArray: "6 4", fill: false, label: "Google's box" },
  proposed: { color: "#c2410c", weight: 3, fill: false, label: "Proposed box" },
});

const toBounds = (b) => (b ? [[b.swLat, b.swLng], [b.neLat, b.neLng]] : null);

function FitTo({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [16, 16] });
  }, [bounds, map]);
  return null;
}

function Swatch({ style, round }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 ${round ? "rounded-full" : "rounded-sm"}`}
      style={{ background: style.fillColor ?? "transparent", border: `2px ${style.dashArray ? "dashed" : "solid"} ${style.color}` }}
    />
  );
}

export function CityBoxMap({ stored, google, proposed, tiles, uncovered }) {
  const boxes = useMemo(
    () => [["stored", stored], ["google", google], ["proposed", proposed]].filter(([, b]) => b),
    [stored, google, proposed],
  );
  const bounds = useMemo(() => {
    const all = boxes.map(([, b]) => b);
    if (all.length === 0) return null;
    return [
      [Math.min(...all.map((b) => b.swLat)), Math.min(...all.map((b) => b.swLng))],
      [Math.max(...all.map((b) => b.neLat)), Math.max(...all.map((b) => b.neLng))],
    ];
  }, [boxes]);

  const counts = useMemo(() => {
    const c = { searched: 0, unfinished: 0, never_searched: 0 };
    for (const t of tiles ?? []) c[t.state] = (c[t.state] ?? 0) + 1;
    return c;
  }, [tiles]);

  if (!bounds) return <p className="text-sm text-[var(--color-text-tertiary)]">This city has no box yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      {/* isolate: Leaflet panes use z-index 400+, which would draw over dialogs. */}
      <div className="relative isolate z-0 h-[320px] overflow-hidden rounded-lg border border-[var(--color-border)]" role="img"
        aria-label={`Geo box map: ${counts.searched} tiles searched, ${counts.unfinished} unfinished, ${counts.never_searched} never searched, ${(uncovered ?? []).length} areas no tile reaches`}>
        <MapContainer bounds={bounds} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          <FitTo bounds={bounds} />
          {(tiles ?? []).map((t) => {
            const st = TILE_STATE_STYLE[t.state] ?? TILE_STATE_STYLE.unfinished;
            return (
              <Circle key={t.id} center={[t.lat, t.lng]} radius={t.radiusM}
                pathOptions={{ color: st.color, fillColor: st.fillColor, fillOpacity: 0.35, weight: 1 }}>
                <Tooltip>{st.label}{t.owedSearches ? `: ${t.owedSearches} searches owed${t.failedSearches ? `, ${t.failedSearches} failed` : ""}` : ""}{t.kind === "split" ? " (split)" : ""}</Tooltip>
              </Circle>
            );
          })}
          {(uncovered ?? []).map((u) => (
            <Circle key={`u-${u.lat}-${u.lng}`} center={[u.lat, u.lng]} radius={u.radiusM}
              pathOptions={{ color: "#b91c1c", dashArray: "4 4", fill: false, weight: 1 }}>
              <Tooltip>No tile reaches this area</Tooltip>
            </Circle>
          ))}
          {boxes.map(([kind, b]) => (
            <Rectangle key={kind} bounds={toBounds(b)} pathOptions={BOX_STYLE[kind]}>
              <Tooltip>{BOX_STYLE[kind].label}</Tooltip>
            </Rectangle>
          ))}
        </MapContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {boxes.map(([kind]) => (
          <span key={kind} className="inline-flex items-center gap-1.5"><Swatch style={BOX_STYLE[kind]} />{BOX_STYLE[kind].label}</span>
        ))}
        {Object.entries(TILE_STATE_STYLE).map(([state, st]) => (
          <span key={state} className="inline-flex items-center gap-1.5 tabular-nums"><Swatch style={st} round />{st.label} ({counts[state] ?? 0})</span>
        ))}
        <span className="inline-flex items-center gap-1.5 tabular-nums"><Swatch style={{ color: "#b91c1c", dashArray: "4 4" }} round />No tile reaches ({(uncovered ?? []).length})</span>
      </div>
    </div>
  );
}
