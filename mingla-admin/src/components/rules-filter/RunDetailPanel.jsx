import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { X, FileText, Layers, GitCompare, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";

const SUB_TABS = [
  { id: "summary", label: "Summary", Icon: FileText },
  { id: "affected", label: "Affected", Icon: Layers },
  { id: "diff", label: "Diff", Icon: GitCompare },
];

const PAGE_SIZE = 50;

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "—");
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};
const fmtDuration = (s) => {
  if (typeof s !== "number" || s < 0) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
};
const fmtMoney = (n) => {
  if (typeof n !== "number") return "$0.00";
  return `$${n.toFixed(4)}`;
};

export function RunDetailPanel({ jobId, onClose, allRunsOnCity }) {
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(null);
  const [subTab, setSubTab] = useState("summary");

  const [affectedPlaces, setAffectedPlaces] = useState([]);
  const [affectedTotal, setAffectedTotal] = useState(0);
  const [affectedOffset, setAffectedOffset] = useState(0);
  const [affectedLoading, setAffectedLoading] = useState(false);
  const [affectedError, setAffectedError] = useState(null);

  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState(null);

  // Load detail on mount / jobId change
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    setDetailLoading(true);
    setDetailError(null);
    supabase.rpc("admin_rules_run_detail", { p_job_id: jobId })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setDetailError(error.message);
        else setDetail(data);
      })
      .finally(() => alive && setDetailLoading(false));
    return () => { alive = false; };
  }, [jobId]);

  const loadAffected = useCallback(async (offset) => {
    if (!jobId) return;
    setAffectedLoading(true);
    setAffectedError(null);
    try {
      const { data, error } = await supabase.rpc("admin_rules_run_affected_places", {
        p_job_id: jobId,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (error) throw error;
      setAffectedPlaces(data?.places || []);
      setAffectedTotal(data?.total || 0);
      setAffectedOffset(offset);
    } catch (err) {
      setAffectedError(err.message || "Couldn't load affected places.");
    } finally {
      setAffectedLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (subTab === "affected" && !affectedPlaces.length && !affectedLoading) {
      loadAffected(0);
    }
  }, [subTab, affectedPlaces.length, affectedLoading, loadAffected]);

  // Diff: compare to previous run on the same city
  const previousRunId = (allRunsOnCity || [])
    .filter((r) => r.id !== jobId && r.status === "completed")
    .find((r) => new Date(r.completed_at || 0) < new Date(detail?.run?.completed_at || 0))?.id;

  useEffect(() => {
    if (subTab !== "diff") return;
    if (!jobId || !previousRunId) {
      setDiff(null);
      return;
    }
    let alive = true;
    setDiffLoading(true);
    setDiffError(null);
    supabase.rpc("admin_rules_run_diff", { p_job_a: previousRunId, p_job_b: jobId })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setDiffError(error.message);
        else setDiff(data);
      })
      .finally(() => alive && setDiffLoading(false));
    return () => { alive = false; };
  }, [subTab, jobId, previousRunId]);

  // Esc closes
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          document.activeElement.blur();
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const run = detail?.run;
  const manifest = detail?.rules_version;
  const topRules = detail?.top_firing_rules || [];
  const hasPrev = Boolean(previousRunId);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        style={{ zIndex: "var(--z-modal, 50)" }}
      />
      <motion.aside
        initial={{ x: 480, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 480, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed top-0 right-0 h-full w-[480px] bg-[var(--color-background-primary)] shadow-[var(--shadow-xl)] flex flex-col"
        style={{ zIndex: "calc(var(--z-modal, 50) + 1)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Run detail"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--gray-200)] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[var(--color-text-primary)] font-mono truncate">
                {run?.manifest_label || manifest?.manifest_label || (detailLoading ? "Loading…" : "Run detail")}
              </p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                {run?.city_filter || "All cities"} · {fmtDateTime(run?.completed_at || run?.started_at)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center gap-1 mt-3">
            {SUB_TABS.map((t) => {
              const Icon = t.Icon;
              const disabled = t.id === "diff" && !hasPrev;
              return (
                <button
                  key={t.id}
                  onClick={() => !disabled && setSubTab(t.id)}
                  disabled={disabled}
                  className={[
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium",
                    "transition-colors",
                    subTab === t.id
                      ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                      : disabled
                      ? "text-[var(--color-text-tertiary)] cursor-not-allowed opacity-50"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] cursor-pointer",
                  ].join(" ")}
                  title={disabled ? "No previous run on this city to diff against" : t.label}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {detailLoading && (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 rounded bg-[var(--gray-100)] animate-pulse" />
              ))}
            </div>
          )}
          {detailError && (
            <AlertCard variant="error" title="Couldn't load run">{detailError}</AlertCard>
          )}

          {!detailLoading && !detailError && run && subTab === "summary" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <SummaryStat label="Processed" value={fmt(run.processed)} />
                <SummaryStat label="Rejected" value={fmt(run.rejected)} color="text-[#ef4444]" />
                <SummaryStat label="Reclassified" value={fmt(run.reclassified)} color="text-[#f59e0b]" />
                <SummaryStat label="Unchanged" value={fmt(run.unchanged)} color="text-[var(--color-text-secondary)]" />
              </div>
              <div className="border-t border-[var(--gray-200)] pt-3 space-y-2 text-[12px]">
                <KV label="Status" value={run.status} mono />
                <KV label="Stage" value={run.stage} mono />
                <KV label="Started" value={fmtDateTime(run.started_at)} />
                <KV label="Completed" value={fmtDateTime(run.completed_at)} />
                <KV label="Duration" value={fmtDuration(run.duration_seconds)} />
                <KV label="Triggered by" value={run.triggered_by_email || "—"} />
                <KV label="Cost" value={fmtMoney(run.cost_usd)} hint={run.stage?.startsWith("rules_only") ? "(rules-only runs never incur API cost)" : null} />
                <KV label="Affected rows" value={fmt(detail?.affected_places_count)} />
              </div>
              {topRules.length > 0 && (
                <div className="border-t border-[var(--gray-200)] pt-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                    Top firing rules
                  </p>
                  <div className="space-y-1.5">
                    {topRules.map((r) => (
                      <div key={r.rule_set_id} className="flex items-center justify-between text-[12px]">
                        <span className="font-mono text-[var(--color-text-primary)] truncate">{r.rule_set_name}</span>
                        <span className="text-[var(--color-text-secondary)]">{fmt(r.fires)} fires</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {subTab === "affected" && (
            <div className="space-y-3">
              {affectedLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-14 rounded bg-[var(--gray-100)] animate-pulse" />
                  ))}
                </div>
              ) : affectedError ? (
                <AlertCard variant="error" title="Couldn't load affected places">
                  {affectedError}
                </AlertCard>
              ) : affectedPlaces.length === 0 ? (
                <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-6">
                  No affected places on this run.
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">
                    Showing {affectedOffset + 1}–{affectedOffset + affectedPlaces.length} of {fmt(affectedTotal)}
                  </p>
                  <div className="space-y-2">
                    {affectedPlaces.map((p) => (
                      <AffectedPlaceRow key={p.id} place={p} />
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={ChevronLeft}
                      disabled={affectedOffset === 0 || affectedLoading}
                      onClick={() => loadAffected(Math.max(0, affectedOffset - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={ChevronRight}
                      disabled={affectedOffset + PAGE_SIZE >= affectedTotal || affectedLoading}
                      onClick={() => loadAffected(affectedOffset + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {subTab === "diff" && (
            <div>
              {!hasPrev ? (
                <p className="text-[13px] text-[var(--color-text-tertiary)] text-center py-10">
                  This is the first run on this city — nothing to diff against.
                </p>
              ) : diffLoading ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-6 rounded bg-[var(--gray-100)] animate-pulse" />
                  ))}
                </div>
              ) : diffError ? (
                <AlertCard variant="error" title="Couldn't load diff">{diffError}</AlertCard>
              ) : !diff ? null : (
                <div className="space-y-4">
                  <div className="text-[11px] text-[var(--color-text-tertiary)]">
                    Comparing against previous completed run on the same city
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <SummaryStat label="Still affected" value={fmt(diff.delta?.in_both)} />
                    <SummaryStat label="Newly affected" value={fmt(diff.delta?.additional_in_b)} color="text-[#f59e0b]" />
                    <SummaryStat label="No longer affected" value={fmt(diff.delta?.no_longer_in_b)} color="text-[#22c55e]" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                      Per-rule fires
                    </p>
                    <div className="space-y-1.5">
                      {(diff.rule_diff_summary || []).map((r, i) => {
                        const delta = (r.fires_b || 0) - (r.fires_a || 0);
                        return (
                          <div key={i} className="flex items-center justify-between text-[12px]">
                            <span className="font-mono text-[var(--color-text-primary)] truncate flex-1">{r.rule_set_name}</span>
                            <span className="text-[var(--color-text-secondary)] mx-2">
                              {fmt(r.fires_a)} → {fmt(r.fires_b)}
                            </span>
                            <span
                              className={[
                                "w-12 text-right",
                                delta > 0 ? "text-[#f59e0b]" : delta < 0 ? "text-[#22c55e]" : "text-[var(--color-text-tertiary)]",
                              ].join(" ")}
                            >
                              {delta > 0 ? `+${delta}` : delta}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function SummaryStat({ label, value, color }) {
  return (
    <div className="p-3 rounded border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
      <p className="text-[11px] text-[var(--color-text-secondary)]">{label}</p>
      <p className={`text-[20px] font-bold leading-tight ${color || "text-[var(--color-text-primary)]"}`}>
        {value}
      </p>
    </div>
  );
}

function KV({ label, value, mono, hint }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--color-text-tertiary)] w-[120px] shrink-0">{label}</span>
      <span className={`flex-1 text-[var(--color-text-primary)] ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </span>
      {hint && <span className="text-[10px] text-[var(--color-text-tertiary)] italic">{hint}</span>}
    </div>
  );
}

const DECISION_COLOR = {
  reject: "text-[#ef4444]",
  reclassify: "text-[#f59e0b]",
  approve: "text-[#22c55e]",
};

function DecisionChip({ decision, muted }) {
  const color = muted
    ? "text-[var(--color-text-tertiary)]"
    : DECISION_COLOR[decision] || "text-[var(--color-text-secondary)]";
  return (
    <span className={`text-[11px] font-semibold uppercase ${color}`}>
      {decision || "—"}
    </span>
  );
}

function AffectedPlaceRow({ place }) {
  // ORCH-0550.2 — prior-verdict delta rendering (I-PRIOR-VERDICT-COMPUTED-LIVE).
  // RPC populates prior_decision / prior_reason / prior_created_at via LATERAL join.
  // Three rendering states:
  //   - prior_decision is null         → "First verdict" (no prior row exists)
  //   - prior_decision === decision    → "No change from prior verdict" (muted)
  //   - prior_decision !== decision    → "<prior chip> → <new chip>" + "Prior: <reason>"
  const hasPrior = place?.prior_decision != null;
  const changed = hasPrior && place.prior_decision !== place.decision;

  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate flex-1">
          {place?.place_name || "Unknown place"}
        </p>
        {changed ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <DecisionChip decision={place.prior_decision} muted />
            <span className="text-[var(--color-text-tertiary)]" aria-hidden="true">→</span>
            <DecisionChip decision={place.decision} />
          </div>
        ) : (
          <DecisionChip decision={place?.decision} />
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-tertiary)] line-clamp-1 mb-1">
        {place?.place_address || "(no address)"} · {place?.primary_type}
      </p>
      {place?.reason && (
        <p className="text-[11px] text-[var(--color-text-secondary)] italic line-clamp-2 mb-1">
          {place.reason}
        </p>
      )}
      {!hasPrior ? (
        <p className="text-[10px] text-[var(--color-text-tertiary)] italic">
          First verdict
        </p>
      ) : !changed ? (
        <p className="text-[10px] text-[var(--color-text-tertiary)] italic">
          No change from prior verdict
        </p>
      ) : place?.prior_reason ? (
        <p className="text-[10px] text-[var(--color-text-tertiary)] italic line-clamp-1">
          Prior: {place.prior_reason}
        </p>
      ) : null}
      {place?.rule_set_name && (
        <p className="text-[10px] text-[var(--color-text-tertiary)] font-mono">
          by {place.rule_set_name} v{place.rule_set_version_number}
        </p>
      )}
    </div>
  );
}
