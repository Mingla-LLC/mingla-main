/**
 * LAUNCH CITIES PAGE — ORCH-1027 [Launch Cities admin control]
 *
 * Operator-only control panel to declare individual seeding cities "live for
 * consumers" (the source of truth for the ORCH-1028 onboarding location gate via
 * the check-launch-city edge fn). One decision per row: flip the live switch.
 * #4276: readiness counts what is still missing (Intelligence, reviews, unsearched
 * areas, a flagged box). Geo boxes change in the Place pool pipeline, not here.
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
import { Rocket } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/ui/PageHeader";
import { CITY_FILTERS, boxSizeText, cityFilterMatch, cityGaps, cityLaunchState } from "../lib/cityPipeline";
import { fetchPipelineFunnel, seeding } from "../services/cityPipelineService";
import { ChipGroup, StatTile } from "../components/placePool/PoolUi";

// ─── Leaflet helper: fit the map to the given bounds when they change ─────────
// #4276 (B1): the boundary modal that wrote Google's viewport straight over the box is
// gone. A box now changes only in the pipeline (apply_city_box): Google's box applies
// keeping the larger edge, tiles are rebuilt with their history kept, and places that
// would fall outside are counted first.

export function LaunchCitiesPage() {
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
  const [filter, setFilter] = useState("all"); // CITY_FILTERS
  const [boxes, setBoxes] = useState({});
  // #4276 U3: what keeps each city from being ready, counted on the server. Null while
  // loading; a failed read is said in the readiness cell, never read as "no gaps".
  const [gaps, setGaps] = useState(null);
  const [gapsError, setGapsError] = useState(null);
  // #4130 (Wave 4b): going live (or hiding a live city) asks first.
  const [confirmCity, setConfirmCity] = useState(null);

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

  // The box size beside each city (read only; boxes change in the Pipeline tab).
  useEffect(() => {
    supabase.from("seeding_cities").select("id, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng")
      .then(({ data, error }) => {
        if (!error && mountedRef.current) setBoxes(Object.fromEntries((data ?? []).map((c) => [c.id, c])));
      });
  }, []);

  const fetchGaps = useCallback(async () => {
    setGapsError(null);
    try {
      const [funnel, search, outside] = await Promise.all([
        fetchPipelineFunnel(null),
        seeding("cities_search_status").catch(() => ({ cities: [] })),
        seeding("places_outside_box").catch(() => ({ report: null })),
      ]);
      const byId = (list, key) => Object.fromEntries((list ?? []).map((x) => [x[key], x]));
      const f = byId(funnel?.cities, "city_id");
      const s = byId(search?.cities, "cityId");
      const o = outside?.report ? byId(outside.report, "city_id") : null;
      const out = {};
      for (const id of Object.keys(f)) {
        if (id === "null") continue;
        out[id] = cityGaps(f[id], s[id] ?? null, o ? o[id] ?? { outside_active: 0 } : null);
      }
      if (mountedRef.current) setGaps(out);
    } catch (err) {
      if (mountedRef.current) setGapsError(err.message);
    }
  }, []);

  useEffect(() => { fetchGaps(); }, [fetchGaps]);

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
          ? `${row.city_name} is now live for Explorers.`
          : `${row.city_name} is hidden from Explorers.`,
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

  // Each city's readiness in the design's words, or null while gaps are counted.
  const states = useMemo(() => {
    if (!gaps) return null;
    return Object.fromEntries(rows.map((row) => [row.city_id, cityLaunchState(row, gaps[row.city_id] ?? null)]));
  }, [rows, gaps]);
  const countOf = (key) => (states ? Object.values(states).filter((st) => st.key === key).length : null);
  const visibleRows = useMemo(
    () => (filter === "all" || !states ? rows : rows.filter((r) => cityFilterMatch(states[r.city_id]?.key, filter))),
    [rows, filter, states],
  );
  const openBox = () => { window.location.hash = "#/placepool?tab=pipeline"; };

  const columns = useMemo(() => [
    {
      key: "city_name",
      label: "City",
      render: (_v, row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--color-text-primary)]">{row.city_name}</p>
          <p className="truncate text-xs text-[var(--color-text-tertiary)]">{row.country_name}</p>
        </div>
      ),
    },
    {
      key: "_readiness",
      label: "Readiness",
      width: "150px",
      render: (_v, row) => {
        if (gapsError) return <Badge variant="default">Unknown</Badge>;
        if (!states) return <Skeleton width={96} height={20} rounded="full" />;
        const st = states[row.city_id];
        return <Badge variant={st.variant}>{st.label}</Badge>;
      },
    },
    {
      key: "_why",
      label: "What's in the way",
      render: (_v, row) => {
        // A failed gap count is said, never read as "nothing in the way".
        if (gapsError) return <span className="text-xs text-[var(--color-error-700)]">Gaps couldn't be counted: {gapsError}</span>;
        if (!states) return <Skeleton width={220} height={14} />;
        return <span className="whitespace-normal break-words text-[13px] text-[var(--color-text-primary)]">{states[row.city_id].why}</span>;
      },
    },
    {
      key: "is_servable_places",
      label: "Explorers can see",
      width: "140px",
      cellClassName: "tabular-nums",
      render: (_v, row) => {
        const servable = Number(row.is_servable_places ?? 0);
        const active = Number(row.total_active_places ?? 0);
        return servable > 0
          ? <span title={`${active.toLocaleString()} active`}>{servable.toLocaleString()}</span>
          : <span className="text-[var(--color-text-tertiary)]">–</span>;
      },
    },
    {
      key: "has_bbox",
      label: "Geo box",
      width: "120px",
      render: (_v, row) => {
        if (!row.has_bbox) return <Badge variant="warning">No box</Badge>;
        const outside = gaps?.[row.city_id]?.outsideBox ?? 0;
        const size = boxSizeText(boxes[row.city_id]) || "Box set";
        return (
          <Button variant="link" className={`min-h-11 tabular-nums underline ${outside > 0 ? "!text-[var(--color-error-700)]" : "!text-[var(--color-text-primary)]"}`}
            onClick={openBox} title={outside > 0 ? `${outside.toLocaleString()} active ${outside === 1 ? "place sits" : "places sit"} outside it. Change it in Pipeline.` : "Change it in Pipeline"}>
            {size}
          </Button>
        );
      },
    },
    {
      key: "is_live_for_consumers",
      label: "Live for Explorers",
      width: "170px",
      render: (_v, row) => {
        const live = !!row.is_live_for_consumers;
        if (!live && Number(row.is_servable_places ?? 0) === 0) {
          return <span className="text-xs text-[var(--color-text-secondary)]">Needs servable places</span>;
        }
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
            <Button
              variant={live ? "secondary" : "primary"}
              className="min-h-11 w-[120px] justify-center"
              onClick={() => setConfirmCity(row)}
              disabled={togglingIds.has(row.city_id)}
            >
              {live ? "Hide" : "Go live"}
            </Button>
            {togglingIds.has(row.city_id) && <Spinner size="sm" />}
          </div>
        );
      },
    },
  ], [togglingIds, gaps, gapsError, states, boxes]);

  const tile = (n) => (loading || n === null ? "–" : String(n));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Launch Cities" description="Which cities Explorers can use." />

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Live for Explorers" value={tile(states ? countOf("live") + countOf("live_gaps") : null)} />
        <StatTile label="Live, with gaps" value={tile(countOf("live_gaps"))} />
        <StatTile label="Seeded, not live" value={tile(states ? countOf("ready") + countOf("needs_work") : null)} />
        <StatTile label="Drafts, never seeded" value={tile(countOf("draft"))} />
      </div>

      <SectionCard
        title="Which cities Explorers can use"
        subtitle="Going live is a separate choice, so finishing a pipeline run never shows a city to Explorers by accident. Geo boxes and seeding change in Pipeline."
        noPadding
      >
        <div className="px-4 pt-4 sm:px-5">
          <ChipGroup label="Filter cities" options={CITY_FILTERS.map((f) => ({ ...f }))} value={filter} onChange={setFilter} />
        </div>
        <DataTable
          columns={columns}
          rows={visibleRows}
          loading={loading}
          emptyIcon={Rocket}
          emptyMessage={rows.length ? "No cities in this view." : "No cities to launch yet."}
          emptyAction={
            <Button variant="link" onClick={() => { window.location.hash = "#/placepool?tab=pipeline"; }}>
              Add a city in Pipeline
            </Button>
          }
          getRowId={(r) => r.city_id}
          headerCase="sentence"
        />
      </SectionCard>

      <Modal
        open={!!confirmCity}
        onClose={() => setConfirmCity(null)}
        title={confirmCity?.is_live_for_consumers ? `Hide ${confirmCity?.city_name} from Explorers?` : `Make ${confirmCity?.city_name} live?`}
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {confirmCity?.is_live_for_consumers
              ? "People there can no longer start onboarding. People already in keep their account."
              : `People there can start onboarding straight away. ${Number(confirmCity?.is_servable_places ?? 0).toLocaleString()} places are ready for them.`}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirmCity(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const row = confirmCity;
              setConfirmCity(null);
              if (row) handleToggleLive(row);
            }}
          >
            {confirmCity?.is_live_for_consumers ? "Hide it" : "Go live"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
