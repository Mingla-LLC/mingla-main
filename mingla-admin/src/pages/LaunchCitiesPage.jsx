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
import { Rocket, MapPinned } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/ui/PageHeader";
import { cityGaps, cityReadinessWithGaps } from "../lib/cityPipeline";
import { fetchPipelineFunnel, seeding } from "../services/cityPipelineService";

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
  const [filter, setFilter] = useState("all"); // "all" | "live"
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
      key: "_readiness",
      label: "Readiness",
      width: "260px",
      render: (_v, row) => {
        if (gapsError) {
          return <span className="text-xs text-[var(--color-error-700)]">Gaps couldn't be counted: {gapsError}</span>;
        }
        if (!gaps) return <Skeleton width={120} height={20} rounded="full" />;
        const readiness = cityReadinessWithGaps(row, gaps[row.city_id] ?? null);
        return (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <Badge variant={readiness.variant} dot>{readiness.label}</Badge>
            {readiness.gaps.length > 0 && (
              <span className="text-xs text-[var(--color-text-secondary)]">{readiness.gaps.join(" · ")}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "has_bbox",
      label: "Geo box",
      width: "150px",
      render: (_v, row) => {
        if (!row.has_bbox) return <Badge variant="warning" dot>No box</Badge>;
        const outside = gaps?.[row.city_id]?.outsideBox ?? 0;
        return outside > 0
          ? <Badge variant="error" dot>{`${outside.toLocaleString()} places outside`}</Badge>
          : <Badge variant="success" dot>Box set</Badge>;
      },
    },
    {
      key: "is_live_for_consumers",
      label: "Live",
      width: "130px",
      render: (_v, row) => (
        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
          <Toggle
            checked={!!row.is_live_for_consumers}
            onChange={() => setConfirmCity(row)}
            disabled={togglingIds.has(row.city_id)}
          />
          {togglingIds.has(row.city_id) && <Spinner size="sm" />}
        </div>
      ),
    },
  ], [togglingIds, gaps, gapsError]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Launch Cities"
        description="Flip a city live to let people there start onboarding."
        actions={
          loading ? (
            <Skeleton width={56} height={22} rounded="full" className="shrink-0" />
          ) : (
            <Badge variant={liveCount > 0 ? "success" : "outline"} dot className="shrink-0">
              {liveCount} live
            </Badge>
          )
        }
      />

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
            <Button variant="link" onClick={() => { window.location.hash = "#/placepool?tab=pipeline"; }}>
              Add a city in Pipeline
            </Button>
          }
          getRowId={(r) => r.city_id}
          rowClassName={(r) => r.is_live_for_consumers ? "bg-[var(--color-success-50)]/40" : ""}
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
