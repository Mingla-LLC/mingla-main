/**
 * LAUNCH CITIES PAGE — ORCH-1027 [Launch Cities admin control]
 *
 * Operator-only control panel to declare individual seeding cities "live for
 * consumers" (the source of truth for the ORCH-1028 onboarding location gate via
 * the check-launch-city edge fn). One decision per row: flip the live switch.
 * One utility per row: map/refresh the city boundary (bbox-only).
 *
 * Spec:   Mingla_Artifacts/specs/SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md (§A–§C)
 * Design: Mingla_Artifacts/specs/DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md (all 9 states)
 *
 * Constitutional guarantees (DESIGN §9):
 *  - Live toggle is optimistic with VISIBLE rollback on failure + manual-dismiss
 *    red toast — never a silent success.
 *  - Servable counts are render-only from admin_launch_city_list() — no placeholders.
 *  - is_live_for_consumers is NEVER coupled to status (I-LC-STATUS-ORTHOGONAL):
 *    the live toggle and the boundary action are independent writes.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MapContainer, TileLayer, Rectangle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Rocket, MapPin, MapPinned, Search } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { supabase } from "../lib/supabase";

// ─── Local presentational helper: summary metric chip (DESIGN §4) ────────────
function SummaryChip({ icon: Icon, label, value, accent = "muted" }) {
  const bubbleBg = accent === "brand" ? "bg-[var(--color-brand-50)]" : "bg-[var(--gray-100)]";
  const iconColor = accent === "brand" ? "text-[var(--color-brand-500)]" : "text-[var(--gray-500)]";
  return (
    <div className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 py-3 shadow-[var(--shadow-sm)]">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${bubbleBg}`}>
        {Icon && <Icon className={`h-[18px] w-[18px] ${iconColor}`} />}
      </span>
      <div className="leading-tight">
        <p className="text-[20px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </div>
  );
}

// ─── Leaflet helper: fit the map to the given bounds when they change ─────────
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      try {
        map.fitBounds(bounds, { padding: [24, 24] });
      } catch {
        /* invalid bounds — leave the map where it is */
      }
    }
  }, [bounds, map]);
  return null;
}

// ─── Boundary map preview (DESIGN §8.1): current (gray dashed) + proposed (orange) ─
function BoundaryMap({ city, result }) {
  const current = (city?.bbox_sw_lat != null && city?.bbox_ne_lat != null)
    ? [[city.bbox_sw_lat, city.bbox_sw_lng], [city.bbox_ne_lat, city.bbox_ne_lng]]
    : null;
  const proposed = result?.viewport
    ? [[result.viewport.swLat, result.viewport.swLng], [result.viewport.neLat, result.viewport.neLng]]
    : null;
  const fitTo = proposed || current;
  const center = current
    ? [(city.bbox_sw_lat + city.bbox_ne_lat) / 2, (city.bbox_sw_lng + city.bbox_ne_lng) / 2]
    : [city?.center_lat ?? 0, city?.center_lng ?? 0];

  return (
    <div>
      <div className="rounded-lg overflow-hidden border border-[var(--gray-200)]" style={{ height: 280 }}>
        <MapContainer center={center} zoom={10} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <FitBounds bounds={fitTo} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {current && (
            <Rectangle bounds={current} pathOptions={{ color: "#6b7280", dashArray: "8 4", fillOpacity: 0.03, weight: 2 }} />
          )}
          {proposed && (
            <Rectangle bounds={proposed} pathOptions={{ color: "#f97316", fillOpacity: 0.06, weight: 2 }} />
          )}
        </MapContainer>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm border border-dashed border-[#6b7280]" /> Current
        </span>
        {proposed && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-[#f97316]/40 border border-[#f97316]" /> New
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Boundary modal (DESIGN §8): geocode → preview → persist bbox-only ────────
function BoundaryModal({ open, city, onClose, onSaved }) {
  const { addToast } = useToast();
  const [query, setQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState(null);
  const [overlap, setOverlap] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && city) {
      setQuery(city.city_name || "");
      setGeocodeResult(null);
      setOverlap([]);
      setError(null);
      setSaving(false);
    }
  }, [open, city]);

  const handleGeocode = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) return;
    setGeocoding(true);
    setGeocodeResult(null);
    setOverlap([]);
    setError(null);
    try {
      // Reuse the EXISTING admin-seed-places geocode_city action — no new edge fn.
      // It calls Google Geocoding server-side:
      //   https://maps.googleapis.com/maps/api/geocode/json?address={address}&key={key}
      // Docs: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
      // Response fields used: results[0].geometry.location.{lat,lng} +
      //   results[0].geometry.viewport.{southwest,northeast}.{lat,lng}; status handling
      //   for OK / ZERO_RESULTS / REQUEST_DENIED per the docs' GeocodingResponses section.
      const { data, error: fnErr } = await supabase.functions.invoke("admin-seed-places", {
        body: { action: "geocode_city", query: query.trim() },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setGeocodeResult(data);

      // Informational overlap check (mirrors PlacePoolManagementPage:943) — exclude self.
      const { data: overlapData } = await supabase.rpc("check_city_bbox_overlap", {
        p_sw_lat: data.viewport.swLat,
        p_sw_lng: data.viewport.swLng,
        p_ne_lat: data.viewport.neLat,
        p_ne_lng: data.viewport.neLng,
        p_exclude_id: city.city_id,
      });
      setOverlap(overlapData || []);
    } catch (err) {
      setError(err.message || "Couldn't map that — try a more specific name.");
    } finally {
      setGeocoding(false);
    }
  }, [query, city]);

  const handleSave = useCallback(async () => {
    if (!geocodeResult || !city) return;
    setSaving(true);
    setError(null);
    const vp = geocodeResult.viewport;
    try {
      // LOCKED (SPEC §B.4): persist ONLY center + bbox + updated_at. Never touches
      // is_live_for_consumers, status, tile_radius_m; no tile regeneration.
      const { error: updateErr } = await supabase.from("seeding_cities").update({
        center_lat: geocodeResult.center.lat,
        center_lng: geocodeResult.center.lng,
        bbox_sw_lat: vp.swLat,
        bbox_sw_lng: vp.swLng,
        bbox_ne_lat: vp.neLat,
        bbox_ne_lng: vp.neLng,
        updated_at: new Date().toISOString(),
      }).eq("id", city.city_id);
      if (updateErr) throw updateErr;

      logAdminAction("city.refresh_boundary", "seeding_city", city.city_id, {
        bbox_sw_lat: vp.swLat, bbox_sw_lng: vp.swLng, bbox_ne_lat: vp.neLat, bbox_ne_lng: vp.neLng,
      });
      addToast({ variant: "success", title: `Boundary updated for ${city.city_name}.` });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [geocodeResult, city, addToast, onSaved, onClose]);

  if (!open || !city) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Boundary — ${city.city_name}`} size="md">
      <ModalBody>
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <Input
              label="City"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleGeocode(); } }}
              className="flex-1"
              placeholder="e.g. Lagos, Nigeria"
            />
            <Button variant="secondary" icon={Search} loading={geocoding} onClick={handleGeocode}>Find</Button>
          </div>

          <BoundaryMap city={city} result={geocodeResult} />

          {overlap.length > 0 && (
            <AlertCard variant="warning" title="Overlaps existing cities">
              New boundary overlaps: {overlap.map((o) => o.name).join(", ")}. That&apos;s allowed — just confirming.
            </AlertCard>
          )}

          {error && (
            <AlertCard variant="error" title="Couldn't map that">{error}</AlertCard>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!geocodeResult} onClick={handleSave}>
          Save boundary
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function LaunchCitiesPage({ onTabChange }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [togglingIds, setTogglingIds] = useState(new Set());
  const [filter, setFilter] = useState("all"); // "all" | "live"
  const [boundaryCity, setBoundaryCity] = useState(null);

  const fetchCities = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc("admin_launch_city_list");
      if (error) throw error;
      if (mountedRef.current) setRows(data || []);
    } catch (err) {
      if (mountedRef.current) setLoadError(err.message || "Failed to load launch cities");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCities(); }, [fetchCities]);

  // ─── Live toggle: optimistic flip → write → VISIBLE rollback on failure ─────
  const handleToggleLive = useCallback(async (row) => {
    const next = !row.is_live_for_consumers;
    const prev = row.is_live_for_consumers;

    // 1. OPTIMISTIC
    setRows((rs) => rs.map((r) => r.city_id === row.city_id ? { ...r, is_live_for_consumers: next } : r));
    setTogglingIds((s) => { const n = new Set(s); n.add(row.city_id); return n; });

    try {
      const { error } = await supabase.rpc("admin_set_city_live", {
        p_city_id: row.city_id,
        p_live: next,
      });
      if (error) throw error;
      logAdminAction("city.set_live", "seeding_city", row.city_id, { is_live_for_consumers: next });
      addToast({
        variant: "success",
        title: next
          ? `${row.city_name} is now live for consumers.`
          : `${row.city_name} is hidden from consumers.`,
      });
    } catch (err) {
      // 2. ROLLBACK — visible, never silent. Error toast is manual-dismiss (red).
      if (mountedRef.current) {
        setRows((rs) => rs.map((r) => r.city_id === row.city_id ? { ...r, is_live_for_consumers: prev } : r));
      }
      addToast({ variant: "error", title: `Couldn't update ${row.city_name}`, description: err.message });
    } finally {
      if (mountedRef.current) {
        setTogglingIds((s) => { const n = new Set(s); n.delete(row.city_id); return n; });
      }
    }
  }, [addToast]);

  const liveCount = useMemo(() => rows.filter((r) => r.is_live_for_consumers).length, [rows]);
  const totalCount = rows.length;
  const visibleRows = useMemo(
    () => filter === "live" ? rows.filter((r) => r.is_live_for_consumers) : rows,
    [rows, filter],
  );

  const columns = useMemo(() => [
    {
      key: "city_name",
      label: "City",
      sortable: true,
      render: (_v, row) => (
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-text-primary)] truncate">{row.city_name}</p>
          <p className="text-xs text-[var(--color-text-tertiary)] truncate">{row.country_name}</p>
        </div>
      ),
    },
    {
      key: "country_name",
      label: "Country",
      sortable: true,
      width: "160px",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)]">
          {row.country_name}
          {row.country_code && (
            <span className="ml-1.5 text-xs font-medium text-[var(--color-text-muted)] uppercase tabular-nums">
              {row.country_code}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "is_servable_places",
      label: "Servable",
      sortable: true,
      width: "170px",
      cellClassName: "tabular-nums",
      render: (_v, row) => {
        const servable = Number(row.is_servable_places ?? 0);
        const active = Number(row.total_active_places ?? 0);
        return (
          <div className="leading-tight flex items-center gap-2">
            <span>
              <span className={`font-semibold tabular-nums ${servable === 0 ? "text-[var(--color-warning-600)]" : "text-[var(--color-text-primary)]"}`}>
                {servable.toLocaleString()}
              </span>
              <span className="ml-1 text-xs text-[var(--color-text-tertiary)] tabular-nums">
                / {active.toLocaleString()} active
              </span>
            </span>
            {servable === 0 && <Badge variant="warning">0 servable</Badge>}
          </div>
        );
      },
    },
    {
      key: "has_bbox",
      label: "Boundary",
      width: "130px",
      render: (_v, row) => row.has_bbox
        ? <Badge variant="success" dot>Boundary set</Badge>
        : <Badge variant="warning" dot>No boundary</Badge>,
    },
    {
      key: "is_live_for_consumers",
      label: "Live",
      width: "130px",
      render: (_v, row) => (
        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
          <Toggle
            checked={!!row.is_live_for_consumers}
            onChange={() => handleToggleLive(row)}
            disabled={togglingIds.has(row.city_id)}
          />
          {togglingIds.has(row.city_id) && <Spinner size="sm" />}
        </div>
      ),
    },
    {
      key: "_action",
      label: "",
      width: "64px",
      cellClassName: "text-right",
      render: (_v, row) => (
        <Button
          variant="ghost"
          size="md"
          icon={MapPin}
          className="!h-10"
          onClick={(e) => { e.stopPropagation(); setBoundaryCity(row); }}
          aria-label={`Map or refresh boundary for ${row.city_name}`}
        />
      ),
    },
  ], [togglingIds, handleToggleLive]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Launch Cities</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Flip a city live to let people there start onboarding.
          </p>
        </div>
        {loading ? (
          <Skeleton width={56} height={22} rounded="full" className="mt-1 shrink-0" />
        ) : (
          <Badge variant={liveCount > 0 ? "success" : "outline"} dot className="mt-1 shrink-0">
            {liveCount} live
          </Badge>
        )}
      </div>

      {/* Load error */}
      {loadError && (
        <AlertCard
          variant="error"
          title="Couldn't load launch cities"
          action={<Button variant="secondary" size="sm" onClick={fetchCities}>Retry</Button>}
        >
          {loadError}
        </AlertCard>
      )}

      {/* Summary strip */}
      {loading ? (
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
          <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <SummaryChip icon={Rocket} label="Live for consumers" value={liveCount} accent="brand" />
          <SummaryChip icon={MapPinned} label="Cities mapped" value={totalCount} accent="muted" />
        </div>
      )}

      {/* First-time info banner: cities exist but none live yet */}
      {!loading && !loadError && totalCount > 0 && liveCount === 0 && (
        <AlertCard variant="info" title="No cities are live yet">
          Flip one on when its places are ready.
        </AlertCard>
      )}

      {/* Filter row — only with rows */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between">
          <div role="tablist" aria-label="Filter cities" className="inline-flex rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-secondary)] p-1">
            {[["all", "All"], ["live", "Live only"]].map(([id, label]) => {
              const active = filter === id;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(id)}
                  className={[
                    "h-9 px-4 text-xs font-semibold rounded-md transition-colors duration-150 cursor-pointer",
                    active
                      ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)] tabular-nums">
            {visibleRows.length} {visibleRows.length === 1 ? "city" : "cities"}
          </span>
        </div>
      )}

      {/* List */}
      <SectionCard title="Seeding cities" subtitle={`${totalCount} total`} noPadding>
        <DataTable
          columns={columns}
          rows={visibleRows}
          loading={loading}
          striped
          emptyIcon={Rocket}
          emptyMessage="No cities to launch yet."
          emptyAction={
            <Button variant="link" onClick={() => onTabChange?.("placepool")}>
              Add a city in Place Pool
            </Button>
          }
          getRowId={(r) => r.city_id}
          rowClassName={(r) => r.is_live_for_consumers ? "bg-[var(--color-success-50)]/40" : ""}
        />
      </SectionCard>

      <BoundaryModal
        open={!!boundaryCity}
        city={boundaryCity}
        onClose={() => setBoundaryCity(null)}
        onSaved={fetchCities}
      />
    </div>
  );
}
