/**
 * IntelligenceOverviewTab — ORCH-1008
 *
 * Default landing tab on the Place Intelligence Trial page. Renders the
 * per-city coverage table + tiles + "Run remainder" CTA per row.
 *
 * Data source: services/intelligenceCoverageService.fetchIntelligenceCoverage()
 * which calls the run-place-intelligence-trial edge fn with
 * action='intelligence_coverage' (admin-gated).
 *
 * Empty / loading / error states reuse existing primitives (AlertCard,
 * Spinner). Active-run guard: before opening the remainder modal we
 * re-query list_active_runs for the selected city to avoid the
 * unique-partial-index 23505 race.
 *
 * SPEC §3 Phase 3a.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Play, ArrowRight } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { invokeWithRefresh } from "../../lib/supabase";
import { extractFunctionError } from "../../lib/edgeFunctionError";
import { fetchIntelligenceCoverage } from "../../services/intelligenceCoverageService";
import { timeAgo } from "../../lib/formatters";
import { RunRemainderConfirmModal } from "./RunRemainderConfirmModal";
// ORCH-1013 Finding B — bulk launch ("Run remainder on all").
import { RunRemainderOnAllConfirmModal } from "./RunRemainderOnAllConfirmModal";
import { useBulkRunDispatcher } from "../../hooks/useBulkRunDispatcher";
// ORCH-1015 Finding A — per-city Boundary + Details binary readiness badges.
// Replaces ORCH-1014's count-based Seed + Refresh badges (those raw fields
// stay on the wire as operator diagnostics; see SPEC §7-D7).
import { BoundaryReadinessBadge } from "./BoundaryReadinessBadge";
import { DetailsReadinessBadge } from "./DetailsReadinessBadge";

const PER_PLACE_COST_USD = 0.0040;

// ORCH-1015 — readiness predicates used by both the 3-band layout (§3 B.2)
// and the smart-skip bulk button (§3 C.2). Keep these helpers HERE (not in a
// shared util) so the test surface stays bound to the component file.
function isBoundaryReady(r) {
  return r?.regeocoded === true;
}
function isDetailsReady(r) {
  return r?.refreshed_new_fields === true;
}
function isFullyReady(r) {
  return isBoundaryReady(r) && isDetailsReady(r);
}

// ORCH-1015 — operator-locked band labels per SPEC §3 B.2.
const BAND_LABELS = {
  band1: "Ready — boundary current + details current",
  band2: "Needs detail refresh",
  band3: "Needs re-seed (deprecated boundary)",
};

// ORCH-1015 — per-city <tr> renderer extracted so all 3 bands share one shape.
// Per SPEC §3 B.2 — within a band sort happens at the bandedRows memo level;
// this helper only renders. Per-row "Run remainder" button is preserved across
// all 3 bands (override path per SPEC §3 C.4 / §7-D6).
function renderCityRow({ row, checkingActiveRun, handleOpenRemainderModal }) {
  const disabled = row.remaining_count <= 0 || checkingActiveRun;
  return (
    <tr
      key={row.city_id}
      className="border-b border-[var(--gray-200)] last:border-b-0 hover:bg-[var(--gray-50)] transition-colors duration-150"
    >
      <td className="px-3 py-2 text-[var(--color-text-primary)] font-medium">
        {row.city_name}
      </td>
      <td className="px-3 py-2 text-[var(--color-text-secondary)]">
        {row.country || "—"}
      </td>
      {/* ORCH-1015 — Boundary + Details binary readiness cells (read-only) */}
      <td className="px-3 py-2 align-top">
        <BoundaryReadinessBadge regeocoded={row.regeocoded} />
      </td>
      <td className="px-3 py-2 align-top">
        <DetailsReadinessBadge
          refreshed={row.refreshed_new_fields}
          needs_refresh_count={row.needs_refresh_count ?? 0}
        />
      </td>
      <td className="px-3 py-2 text-right text-[var(--color-text-primary)] font-mono tabular-nums">
        {row.servable_count.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right text-[var(--color-success-700)] font-mono tabular-nums">
        {row.evaluated_count.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right text-[var(--color-warning-700)] font-mono tabular-nums">
        {row.remaining_count.toLocaleString()}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-[var(--gray-100)] rounded-full h-2 overflow-hidden max-w-[120px]">
            <div
              className="h-full bg-[var(--color-brand-500)] transition-all duration-200"
              style={{ width: `${row.coverage_pct}%` }}
              role="progressbar"
              aria-valuenow={row.coverage_pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${row.city_name} coverage ${row.coverage_pct.toFixed(1)}%`}
            />
          </div>
          <span className="text-xs font-mono tabular-nums text-[var(--color-text-secondary)] shrink-0">
            {row.coverage_pct.toFixed(1)}%
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
        {row.last_run_at ? (
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[var(--color-text-primary)]">
              {modeLabel(row.last_run_mode)}
            </span>
            <span
              className={[
                "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded",
                statusBadgeClasses(row.last_run_status),
              ].join(" ")}
            >
              {row.last_run_status}
            </span>
            <span className="text-[var(--color-text-tertiary)]">·</span>
            <span>{timeAgo(row.last_run_at)}</span>
            {row.last_run_cost_usd != null && (
              <>
                <span className="text-[var(--color-text-tertiary)]">·</span>
                <span className="font-mono">
                  ${Number(row.last_run_cost_usd).toFixed(2)}
                </span>
              </>
            )}
          </span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          size="sm"
          variant={disabled ? "ghost" : "secondary"}
          icon={Play}
          onClick={() => handleOpenRemainderModal(row)}
          disabled={disabled}
          title={
            row.remaining_count <= 0
              ? "0 places to evaluate"
              : checkingActiveRun
                ? "Checking active runs…"
                : `Evaluate ${row.remaining_count.toLocaleString()} un-evaluated places`
          }
        >
          Run remainder
        </Button>
      </td>
    </tr>
  );
}

function modeLabel(mode) {
  if (!mode) return "—";
  if (mode === "full_city") return "Whole city";
  if (mode === "retry_failed") return "Retry failed";
  if (mode === "remainder") return "Remainder";
  if (mode === "sample") return "Sample";
  return mode;
}

function statusBadgeClasses(status) {
  if (status === "complete") {
    return "bg-[var(--color-success-50)] text-[var(--color-success-700)]";
  }
  if (status === "failed") {
    return "bg-[var(--color-error-50)] text-[var(--color-error-700)]";
  }
  if (status === "cancelled") {
    return "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]";
  }
  return "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]";
}

export function IntelligenceOverviewTab({ onSwitchToResults, onTabChange }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalCity, setModalCity] = useState(null); // { id, name, remaining_count }
  const [checkingActiveRun, setCheckingActiveRun] = useState(false);
  // ORCH-1013 Finding B — bulk-launch modal + 3-concurrent dispatcher.
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const dispatcher = useBulkRunDispatcher({ onToast: addToast });

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchIntelligenceCoverage();
      setRows(data);
    } catch (err) {
      setError(err?.message || "Couldn't load coverage");
      if (!silent) {
        addToast({
          variant: "error",
          title: "Couldn't load coverage",
          description: err?.message,
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ORCH-1015 Finding C — split candidate cities into "ready" (both badges ✓,
  // safe to bulk-run) and "skipped" (boundary or details ⚠, surfaced in modal
  // as needing prep first). Replaces ORCH-1013's flat candidateCities memo.
  // Per SPEC §3-C.2.
  const readyCities = useMemo(
    () =>
      rows
        .filter((r) => r.remaining_count > 0 && isFullyReady(r))
        .map((r) => ({
          city_id: r.city_id,
          city_name: r.city_name,
          remaining_count: r.remaining_count,
        })),
    [rows],
  );

  const skippedCities = useMemo(
    () =>
      rows
        .filter((r) => r.remaining_count > 0 && !isFullyReady(r))
        .map((r) => ({
          city_id: r.city_id,
          city_name: r.city_name,
          remaining_count: r.remaining_count,
          regeocoded: r.regeocoded,
          refreshed_new_fields: r.refreshed_new_fields,
          skip_reason: !r.regeocoded
            ? "needs reseed"
            : "needs detail refresh",
        })),
    [rows],
  );

  // ORCH-1015 Finding B — 3-band ladder. Each band sorted by servable_count
  // DESC so the biggest (most expensive) cities surface first within band.
  // Per SPEC §3 B.4.
  const bandedRows = useMemo(() => {
    const sortBySrv = (a, b) => b.servable_count - a.servable_count;
    const band1 = rows
      .filter((r) => isBoundaryReady(r) && isDetailsReady(r))
      .sort(sortBySrv);
    const band2 = rows
      .filter((r) => isBoundaryReady(r) && !isDetailsReady(r))
      .sort(sortBySrv);
    const band3 = rows.filter((r) => !isBoundaryReady(r)).sort(sortBySrv);
    return { band1, band2, band3 };
  }, [rows]);

  const aggregate = useMemo(() => {
    const totals = rows.reduce(
      (a, r) => {
        a.servable += r.servable_count;
        a.evaluated += r.evaluated_count;
        a.remaining += r.remaining_count;
        return a;
      },
      { servable: 0, evaluated: 0, remaining: 0 },
    );
    return {
      ...totals,
      coverage_pct: totals.servable === 0
        ? 0
        : +((totals.evaluated / totals.servable) * 100).toFixed(1),
    };
  }, [rows]);

  async function handleOpenRemainderModal(row) {
    if (row.remaining_count <= 0) return;
    setCheckingActiveRun(true);
    try {
      // Re-query active runs scoped to this city to avoid the 23505 race
      const { data, error: actErr } = await invokeWithRefresh(
        "run-place-intelligence-trial",
        { body: { action: "list_active_runs" } },
      );
      if (actErr) {
        addToast({
          variant: "error",
          title: "Couldn't check active runs",
          description: await extractFunctionError(actErr, "list_active_runs failed"),
        });
        return;
      }
      const conflict = (data?.runs || []).find((r) => r.city_id === row.city_id);
      if (conflict) {
        addToast({
          variant: "warning",
          title: "Run already in progress",
          description:
            `${row.city_name} has an active ${conflict.status} run. Cancel it first or wait.`,
        });
        return;
      }
      setModalCity({
        id: row.city_id,
        name: row.city_name,
        remaining_count: row.remaining_count,
      });
    } catch (err) {
      addToast({
        variant: "error",
        title: "Couldn't open remainder",
        description: err?.message,
      });
    } finally {
      setCheckingActiveRun(false);
    }
  }

  if (loading && rows.length === 0) {
    return (
      <SectionCard title="Per-city coverage">
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
        </div>
      </SectionCard>
    );
  }

  if (error && rows.length === 0) {
    return (
      <SectionCard title="Per-city coverage">
        <AlertCard
          variant="error"
          title="Couldn't load coverage"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              onClick={() => refresh()}
            >
              Retry
            </Button>
          }
        >
          {error}
        </AlertCard>
      </SectionCard>
    );
  }

  if (rows.length === 0) {
    return (
      <SectionCard title="Per-city coverage">
        <AlertCard
          variant="info"
          title="No cities with servable places yet"
          action={
            onTabChange ? (
              <Button
                size="sm"
                variant="secondary"
                iconRight={ArrowRight}
                onClick={() => onTabChange("placepool")}
              >
                Go to Place Pool
              </Button>
            ) : undefined
          }
        >
          Seed a city via Place Pool first.
        </AlertCard>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        title="Per-city coverage"
        subtitle={`${rows.length} cit${rows.length === 1 ? "y" : "ies"} · ${aggregate.servable.toLocaleString()} servable · ${aggregate.evaluated.toLocaleString()} evaluated (${aggregate.coverage_pct.toFixed(1)}%)`}
        action={
          <div className="flex items-center gap-2">
            {/* ORCH-1015 Finding C — smart-skip bulk launcher. Only enqueues
                cities where BOTH Boundary + Details are ✓; cities needing
                prep land in the modal's "skipped" panel. Per SPEC §3-C.1. */}
            <Button
              size="sm"
              variant="secondary"
              icon={Play}
              onClick={() => setBulkModalOpen(true)}
              disabled={loading || readyCities.length === 0}
              title={
                readyCities.length === 0
                  ? skippedCities.length > 0
                    ? "All cities with remainder need prep first (reseed or detail refresh)"
                    : "All cities are fully evaluated"
                  : `Queues remainder runs on ${readyCities.length} cit${readyCities.length === 1 ? "y" : "ies"} — skips ${skippedCities.length} cit${skippedCities.length === 1 ? "y" : "ies"} needing reseed or refresh to protect Gemini scoring quality`
              }
            >
              Run remainder on all ready cities
              {readyCities.length > 0 ? ` (${readyCities.length})` : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              onClick={() => refresh()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Aggregate tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Cities
              </div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                {rows.length}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Servable
              </div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                {aggregate.servable.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Evaluated
              </div>
              <div className="text-sm font-semibold text-[var(--color-success-700)] tabular-nums">
                {aggregate.evaluated.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono">
                Remaining
              </div>
              <div className="text-sm font-semibold text-[var(--color-warning-700)] tabular-nums">
                {aggregate.remaining.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Per-city table */}
          <div
            className="border border-[var(--gray-200)] rounded-lg overflow-hidden"
            role="region"
            aria-label="Per-city coverage table"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--gray-50)] border-b border-[var(--gray-200)]">
                  <tr className="text-left text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]">
                    <th className="px-3 py-2 font-medium">City</th>
                    <th className="px-3 py-2 font-medium">Country</th>
                    {/* ORCH-1015 — Boundary + Details binary readiness columns
                        (read-only; act on Place Pool page) */}
                    <th
                      className="px-3 py-2 font-medium"
                      title="Re-seed in Place Pool when ⚠"
                    >
                      Boundary
                    </th>
                    <th
                      className="px-3 py-2 font-medium"
                      title="Refresh in Place Pool when ⚠"
                    >
                      Details (new Google fields)
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Servable</th>
                    <th className="px-3 py-2 font-medium text-right">Evaluated</th>
                    <th className="px-3 py-2 font-medium text-right">Remaining</th>
                    <th className="px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 font-medium">Last run</th>
                    <th className="px-3 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ORCH-1015 Finding B — 3-band ladder. Empty bands skip
                      their divider row entirely (no "Needs re-seed — 0 cities"
                      noise). Per SPEC §3 B.2. */}
                  {bandedRows.band1.length > 0 && (
                    <>
                      <tr
                        className="bg-[var(--gray-50)] border-y border-[var(--gray-200)]"
                        data-band="band1"
                      >
                        <td
                          colSpan={10}
                          className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]"
                        >
                          {BAND_LABELS.band1}
                        </td>
                      </tr>
                      {bandedRows.band1.map((row) =>
                        renderCityRow({
                          row,
                          checkingActiveRun,
                          handleOpenRemainderModal,
                        }),
                      )}
                    </>
                  )}
                  {bandedRows.band2.length > 0 && (
                    <>
                      <tr
                        className="bg-[var(--gray-50)] border-y border-[var(--gray-200)]"
                        data-band="band2"
                      >
                        <td
                          colSpan={10}
                          className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]"
                        >
                          {BAND_LABELS.band2}
                        </td>
                      </tr>
                      {bandedRows.band2.map((row) =>
                        renderCityRow({
                          row,
                          checkingActiveRun,
                          handleOpenRemainderModal,
                        }),
                      )}
                    </>
                  )}
                  {bandedRows.band3.length > 0 && (
                    <>
                      <tr
                        className="bg-[var(--gray-50)] border-y border-[var(--gray-200)]"
                        data-band="band3"
                      >
                        <td
                          colSpan={10}
                          className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)]"
                        >
                          {BAND_LABELS.band3}
                        </td>
                      </tr>
                      {bandedRows.band3.map((row) =>
                        renderCityRow({
                          row,
                          checkingActiveRun,
                          handleOpenRemainderModal,
                        }),
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SectionCard>

      <RunRemainderConfirmModal
        open={!!modalCity}
        onClose={() => setModalCity(null)}
        cityId={modalCity?.id}
        cityName={modalCity?.name}
        remainingCount={modalCity?.remaining_count ?? 0}
        perPlaceCostUsd={PER_PLACE_COST_USD}
        onStarted={() => {
          // Refresh table + switch to results tab so operator can watch progress.
          refresh({ silent: true });
          onSwitchToResults?.();
        }}
        onConcurrentRun={() => onSwitchToResults?.()}
      />

      {/* ORCH-1015 Finding C — bulk launcher with smart-skip. Modal receives
          ready cities (sent to dispatcher) + skipped cities (listed in modal
          for visibility only; never enqueued). Per SPEC §3 C.2 + C.3. */}
      <RunRemainderOnAllConfirmModal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        candidateCities={readyCities}
        skippedCities={skippedCities}
        perPlaceCostUsd={PER_PLACE_COST_USD}
        onConfirm={(cities) => {
          dispatcher.enqueue(cities);
          const totalCost = cities.reduce(
            (sum, c) => sum + Number(c.remaining_count || 0) * PER_PLACE_COST_USD,
            0,
          );
          addToast({
            variant: "info",
            title: "Bulk remainder queued",
            description: `${cities.length} cit${cities.length === 1 ? "y" : "ies"}, ~$${totalCost.toFixed(2)} total. Up to 3 run at a time.`,
          });
          // Surface the in-flight runs ASAP — the control tower poll picks them
          // up within 5s anyway.
          refresh({ silent: true });
        }}
      />
    </>
  );
}

export default IntelligenceOverviewTab;
