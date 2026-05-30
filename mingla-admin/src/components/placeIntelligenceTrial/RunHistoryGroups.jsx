/**
 * RunHistoryGroups — ORCH-1008 Phase 4b (DESIGN §3)
 *
 * Replaces the per-run flat list with a status-grouped view across all runs.
 * Groups: Running / Queued / Failed / Completed / Cancelled.
 *
 * Defaults (DESIGN §3.3):
 *   - Running : expanded
 *   - Failed  : expanded if count > 0
 *   - Queued  : collapsed
 *   - Completed: collapsed
 *   - Cancelled: collapsed
 *
 * Each row renders the existing collapsed-row chrome + expands to
 * <PlaceResultExpanded /> (16-card Q2 stack).
 *
 * Long-list virtualisation (Completed group only): initial slice of 50 rows,
 * "Load 50 more" button at the bottom.
 */

import { useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight, RotateCcw,
} from "lucide-react";
import { Button } from "../ui/Button";
import { PlaceResultExpanded } from "./PlaceResultExpanded";

const STATUS_ORDER = ["running", "queued", "failed", "completed", "cancelled"];

const STATUS_META = {
  running:   { label: "Running",   dot: "bg-[var(--color-info-500)]",    live: true,  expandedDefault: true,  hideWhenEmpty: true,  text: "text-[var(--color-info-700)]" },
  queued:    { label: "Queued",    dot: "bg-[var(--gray-400)]",          live: false, expandedDefault: false, hideWhenEmpty: true,  text: "text-[var(--color-text-tertiary)]" },
  failed:    { label: "Failed",    dot: "bg-[var(--color-error-500)]",   live: false, expandedDefault: true,  hideWhenEmpty: true,  text: "text-[var(--color-error-700)]" },
  completed: { label: "Completed", dot: "bg-[var(--color-success-500)]", live: false, expandedDefault: false, hideWhenEmpty: false, text: "text-[var(--color-success-700)]" },
  cancelled: { label: "Cancelled", dot: "bg-[var(--gray-500)]",          live: false, expandedDefault: false, hideWhenEmpty: true,  text: "text-[var(--color-text-tertiary)]" },
};

function normaliseStatus(raw) {
  if (raw === "pending") return "queued";
  if (STATUS_META[raw]) return raw;
  return "queued";
}

function formatCost(n) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(4)}`;
}

const COMPLETED_INITIAL_SLICE = 50;
const COMPLETED_LOAD_STEP = 50;

function PlaceRow({ row, onFilterByRun, multiCity }) {
  const [expanded, setExpanded] = useState(false);
  const place = row.place;
  const isRunning = row.status === "running";
  return (
    <div className="border border-[var(--gray-200)] rounded-lg overflow-hidden bg-[var(--color-background-primary)] relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--gray-50)] transition-colors duration-150 cursor-pointer"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
        )}
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1 text-left">
          {place?.name || row.place_pool_id}
        </span>
        {multiCity && row.city_id && (
          <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--gray-100)] text-[var(--color-text-tertiary)] shrink-0">
            {String(row.city_id).slice(0, 6)}
          </span>
        )}
        {row.model && (
          <span
            className={[
              "text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded shrink-0",
              row.model.startsWith("gemini")
                ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                : "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
            ].join(" ")}
            title={`Model: ${row.model}${row.model_version ? ` (${row.model_version})` : ""}`}
          >
            {row.model.startsWith("gemini") ? "Gemini" : "Other"}
          </span>
        )}
        <span className="text-xs text-[var(--color-text-tertiary)] font-mono shrink-0 tabular-nums">
          {formatCost(row.cost_usd)}
        </span>
      </button>
      {isRunning && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-info-50)] overflow-hidden">
          <div className="h-full w-1/3 bg-[var(--color-info-500)] animate-[shimmer_2s_linear_infinite]" />
        </div>
      )}
      {expanded && <PlaceResultExpanded row={row} onFilterByRun={onFilterByRun} />}
    </div>
  );
}

function GroupHeader({ statusId, count, isExpanded, onToggle, rightTools }) {
  const meta = STATUS_META[statusId];
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--gray-50)] rounded-lg transition-colors duration-150"
      onClick={onToggle}
      role="button"
      aria-expanded={isExpanded}
      aria-controls={`group-${statusId}-content`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {isExpanded ? (
        <ChevronDown className="w-4 h-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      ) : (
        <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
      )}
      <span className="relative flex w-2 h-2" aria-hidden="true">
        {meta.live && count > 0 && (
          <span className="absolute inline-flex w-full h-full rounded-full bg-[var(--color-info-500)] opacity-75 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]" />
        )}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${meta.dot}`} />
      </span>
      <span className="text-sm font-semibold text-[var(--color-text-primary)]">
        {meta.label}
      </span>
      <span className="text-xs font-mono tabular-nums text-[var(--color-text-tertiary)]">
        ({count.toLocaleString()})
      </span>
      {meta.live && count > 0 && (
        <span className="text-[10px] uppercase tracking-wide font-mono text-[var(--color-info-700)]">
          · live
        </span>
      )}
      {rightTools && (
        <div
          className="ml-auto flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {rightTools}
        </div>
      )}
    </div>
  );
}

export function RunHistoryGroups({
  allRows,
  onFilterByRun,
  onRetryFailed,
  retryFailedDisabled,
  retryableFailedCount = 0,
}) {
  // Group by normalised status across all runs
  const grouped = useMemo(() => {
    const out = { running: [], queued: [], failed: [], completed: [], cancelled: [] };
    for (const row of allRows) {
      const s = normaliseStatus(row.status);
      out[s].push(row);
    }
    return out;
  }, [allRows]);

  const multiCity = useMemo(() => {
    const cities = new Set(allRows.map((r) => r.city_id).filter(Boolean));
    return cities.size > 1;
  }, [allRows]);

  // Per-group expand state — initialised once per render-cycle of allRows.
  const [expandState, setExpandState] = useState(null);
  const computedExpand = useMemo(() => {
    if (expandState) return expandState;
    const next = {};
    for (const s of STATUS_ORDER) {
      const count = grouped[s].length;
      const meta = STATUS_META[s];
      next[s] = meta.expandedDefault && count > 0;
    }
    return next;
  }, [grouped, expandState]);

  // Completed group: load-more sentinel state
  const [completedShown, setCompletedShown] = useState(COMPLETED_INITIAL_SLICE);

  function toggleGroup(id) {
    setExpandState((prev) => {
      const base = prev || { ...computedExpand };
      return { ...base, [id]: !base[id] };
    });
  }

  return (
    <section
      role="region"
      aria-label="Run history"
      className="border border-[var(--gray-200)] rounded-xl bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] p-3 flex flex-col gap-1"
    >
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {`${grouped.running.length} running, ${grouped.queued.length} queued, ${grouped.failed.length} failed, ${grouped.completed.length} completed, ${grouped.cancelled.length} cancelled.`}
      </div>
      {STATUS_ORDER.map((statusId) => {
        const meta = STATUS_META[statusId];
        const rows = grouped[statusId];
        const isExpanded = computedExpand[statusId];
        if (rows.length === 0 && meta.hideWhenEmpty) return null;

        // Right-side group tools per design §3.4
        let rightTools = null;
        if (statusId === "failed" && onRetryFailed) {
          rightTools = (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={onRetryFailed}
              disabled={retryFailedDisabled || retryableFailedCount === 0}
              title={
                retryableFailedCount === 0
                  ? "No retryable failures"
                  : `Retry ${retryableFailedCount} failed places`
              }
            >
              Retry failed{retryableFailedCount > 0 ? ` (${retryableFailedCount})` : ""}
            </Button>
          );
        }

        const isCompletedGroup = statusId === "completed";
        const rowsToRender = isCompletedGroup ? rows.slice(0, completedShown) : rows;
        const hasMore = isCompletedGroup && rows.length > completedShown;

        return (
          <div key={statusId}>
            <GroupHeader
              statusId={statusId}
              count={rows.length}
              isExpanded={isExpanded}
              onToggle={() => toggleGroup(statusId)}
              rightTools={rightTools}
            />
            {isExpanded && (
              <div
                id={`group-${statusId}-content`}
                role="group"
                aria-labelledby={`group-${statusId}-header`}
                className="pl-7 pr-2 pb-3 flex flex-col gap-1.5"
              >
                {rows.length === 0 ? (
                  <p className="text-xs italic text-[var(--color-text-tertiary)] px-2 py-1">
                    None.
                  </p>
                ) : (
                  rowsToRender.map((row) => (
                    <PlaceRow
                      key={row.id}
                      row={row}
                      onFilterByRun={onFilterByRun}
                      multiCity={multiCity}
                    />
                  ))
                )}
                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCompletedShown((n) => n + COMPLETED_LOAD_STEP)}
                    >
                      Load {Math.min(COMPLETED_LOAD_STEP, rows.length - completedShown)} more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default RunHistoryGroups;
