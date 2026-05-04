/**
 * CompareWithClaudeTab — ORCH-0708 Phase 0
 *
 * Side-by-side per-fixture diff between operator's expected_aggregate (the
 * answer key) and Claude's actual photo_aesthetic_data.aggregate. Activates
 * automatically when at least one committed fixture has photo_aesthetic_data
 * populated; otherwise shows the pre-backfill placeholder.
 *
 * Per-field PASS/FAIL logic per spec §24.5:
 *   aesthetic_score:    PASS if abs(actual - expected) <= 1.0
 *   lighting:           PASS if exact match
 *   composition:        PASS if exact match
 *   subject_clarity:    PASS if exact match
 *   primary_subject:    PASS if exact match
 *   vibe_tags:          PASS if expected ⊆ actual (Claude allowed extras)
 *   appropriate_for:    PASS if expected ⊆ actual
 *   inappropriate_for:  PASS if expected ⊆ actual
 *   safety_flags:       PASS if EXACT match (binary)
 *
 * Aggregate stats panel at top + "Show only failing" filter.
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { fetchFixtureLabels } from "./labelsService";

// ── Diff logic ──────────────────────────────────────────────────────────────

function isSubset(expected, actual) {
  const a = new Set(actual || []);
  return (expected || []).every((x) => a.has(x));
}

function setEqual(a, b) {
  const sa = new Set(a || []);
  const sb = new Set(b || []);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function diffField(field, expected, actual) {
  if (expected == null && actual == null) return { pass: true };
  switch (field) {
    case "aesthetic_score": {
      if (typeof expected !== "number" || typeof actual !== "number")
        return { pass: false, reason: "missing" };
      const delta = Math.abs(actual - expected);
      return { pass: delta <= 1.0, delta };
    }
    case "lighting":
    case "composition":
    case "subject_clarity":
    case "primary_subject":
      return { pass: expected === actual };
    case "vibe_tags":
    case "appropriate_for":
    case "inappropriate_for":
      return { pass: isSubset(expected, actual) };
    case "safety_flags":
      return { pass: setEqual(expected, actual) };
    default:
      return { pass: false, reason: "unknown_field" };
  }
}

const COMPARED_FIELDS = [
  "aesthetic_score",
  "lighting",
  "composition",
  "subject_clarity",
  "primary_subject",
  "vibe_tags",
  "appropriate_for",
  "inappropriate_for",
  "safety_flags",
];

function computeFixtureDiff(label) {
  const expected = label.expected_aggregate || {};
  const actual = label.place?.photo_aesthetic_data?.aggregate || null;
  if (!actual) {
    return { ready: false, fields: {}, overall: null };
  }
  const fields = {};
  let allPass = true;
  for (const f of COMPARED_FIELDS) {
    const d = diffField(f, expected[f], actual[f]);
    fields[f] = d;
    if (!d.pass) allPass = false;
  }
  return { ready: true, fields, overall: allPass ? "PASS" : "FAIL", expected, actual };
}

// ── Aggregate stats ─────────────────────────────────────────────────────────

function computeAggregateStats(diffs) {
  const ready = diffs.filter((d) => d.ready);
  const total = ready.length;
  const fixturesPass = ready.filter((d) => d.overall === "PASS").length;
  const perField = {};
  for (const f of COMPARED_FIELDS) {
    const passes = ready.filter((d) => d.fields[f]?.pass).length;
    perField[f] = { passes, total };
  }
  return { total, fixturesPass, perField };
}

// ── UI bits ─────────────────────────────────────────────────────────────────

function FieldBadge({ pass }) {
  if (pass) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-success-50)] text-[var(--color-success-700)]">
        <CheckCircle className="w-3 h-3" /> PASS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-[var(--color-error-50)] text-[var(--color-error-700)]">
      <XCircle className="w-3 h-3" /> FAIL
    </span>
  );
}

function fmtVal(v) {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.join(", ")}]`;
  if (typeof v === "number") return v.toFixed(1);
  return String(v);
}

function FixtureDiffCard({ label, diff }) {
  const place = label.place;
  return (
    <div className="border border-[var(--gray-200)] rounded-lg overflow-hidden bg-[var(--color-background-primary)]">
      <div className="flex items-baseline justify-between gap-2 px-4 py-3 border-b border-[var(--gray-200)]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {place?.name || "Unknown"}
          </h4>
          <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">{label.city}</span>
        </div>
        {diff.overall === "PASS" ? (
          <span className="text-xs font-mono uppercase tracking-wide font-semibold text-[var(--color-success-700)]">
            ALL PASS
          </span>
        ) : (
          <span className="text-xs font-mono uppercase tracking-wide font-semibold text-[var(--color-error-700)]">
            FAIL
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 text-xs font-mono divide-x divide-[var(--gray-200)]">
        <div className="p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">
            Expected (operator)
          </div>
          {COMPARED_FIELDS.map((f) => (
            <div key={f} className="flex items-baseline gap-2">
              <span className="w-32 text-[var(--color-text-tertiary)] shrink-0">{f}:</span>
              <span className="text-[var(--color-text-primary)] break-all">{fmtVal(diff.expected?.[f])}</span>
            </div>
          ))}
        </div>
        <div className="p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">
            Actual (Claude)
          </div>
          {COMPARED_FIELDS.map((f) => {
            const d = diff.fields[f];
            return (
              <div key={f} className="flex items-baseline gap-2">
                <span className="w-32 text-[var(--color-text-tertiary)] shrink-0">{f}:</span>
                <span className="text-[var(--color-text-primary)] break-all flex-1 min-w-0">
                  {fmtVal(diff.actual?.[f])}
                </span>
                <FieldBadge pass={d?.pass} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function CompareWithClaudeTab() {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showOnlyFailing, setShowOnlyFailing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchFixtureLabels();
      // Only committed fixtures show up in compare view.
      setLabels(all.filter((l) => l.committed_at));
    } catch (err) {
      console.error("[CompareWithClaudeTab] fetch failed:", err);
      setError(err?.message || "Couldn't load fixtures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const diffs = useMemo(
    () => labels.map((l) => ({ label: l, diff: computeFixtureDiff(l) })),
    [labels],
  );
  const readyDiffs = diffs.filter((d) => d.diff.ready);
  const stats = useMemo(() => computeAggregateStats(diffs.map((d) => d.diff)), [diffs]);
  const visibleDiffs = showOnlyFailing
    ? readyDiffs.filter((d) => d.diff.overall === "FAIL")
    : readyDiffs;

  if (loading) {
    return (
      <SectionCard title="Compare with Claude">
        <div className="flex items-center justify-center py-12">
          <Spinner size="md" />
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard title="Compare with Claude">
        <AlertCard
          variant="error"
          title="Couldn't load comparison"
          action={
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={refresh}>
              Retry
            </Button>
          }
        >
          {error}
        </AlertCard>
      </SectionCard>
    );
  }

  // Pre-backfill state — no fixture has photo_aesthetic_data yet.
  if (readyDiffs.length === 0) {
    return (
      <SectionCard title="Compare with Claude">
        <AlertCard variant="info" title="Run the photo-aesthetic backfill to compare">
          {labels.length === 0
            ? "No committed fixtures yet. Label some fixtures first."
            : `${labels.length} committed fixture${labels.length === 1 ? "" : "s"} are waiting on Claude. Once the score-place-photo-aesthetics edge function runs, this tab will populate with per-field PASS/FAIL diffs.`}
        </AlertCard>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Compare with Claude"
      subtitle={`${stats.fixturesPass} / ${stats.total} fixtures all-pass`}
      action={
        <div className="flex items-center gap-3">
          <Toggle
            label="Show only failing"
            checked={showOnlyFailing}
            onChange={setShowOnlyFailing}
          />
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>
            Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Aggregate stats panel */}
        <div className="grid grid-cols-3 md:grid-cols-9 gap-2 p-3 bg-[var(--gray-50)] rounded-lg border border-[var(--gray-200)]">
          {COMPARED_FIELDS.map((f) => {
            const s = stats.perField[f];
            const ratio = s.total > 0 ? s.passes / s.total : 0;
            return (
              <div key={f} className="text-center">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] font-mono mb-1">
                  {f.replace(/_/g, " ")}
                </div>
                <div
                  className={[
                    "text-sm font-mono font-semibold",
                    ratio === 1
                      ? "text-[var(--color-success-700)]"
                      : ratio >= 0.7
                      ? "text-[var(--color-warning-700)]"
                      : "text-[var(--color-error-700)]",
                  ].join(" ")}
                >
                  {s.passes}/{s.total}
                </div>
              </div>
            );
          })}
        </div>

        {/* Diff cards */}
        {visibleDiffs.length === 0 && showOnlyFailing && (
          <AlertCard variant="success" title="All committed fixtures pass">
            Toggle "Show only failing" off to see the full list.
          </AlertCard>
        )}
        {visibleDiffs.map(({ label, diff }) => (
          <FixtureDiffCard key={label.id} label={label} diff={diff} />
        ))}
      </div>
    </SectionCard>
  );
}

export default CompareWithClaudeTab;
