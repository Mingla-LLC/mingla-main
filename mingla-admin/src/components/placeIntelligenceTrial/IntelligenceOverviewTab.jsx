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

const PER_PLACE_COST_USD = 0.0040;

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
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            onClick={() => refresh()}
            disabled={loading}
          >
            Refresh
          </Button>
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
                    <th className="px-3 py-2 font-medium text-right">Servable</th>
                    <th className="px-3 py-2 font-medium text-right">Evaluated</th>
                    <th className="px-3 py-2 font-medium text-right">Remaining</th>
                    <th className="px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 font-medium">Last run</th>
                    <th className="px-3 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
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
                  })}
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
    </>
  );
}

export default IntelligenceOverviewTab;
