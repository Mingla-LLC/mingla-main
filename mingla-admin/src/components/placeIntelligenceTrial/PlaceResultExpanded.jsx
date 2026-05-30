/**
 * PlaceResultExpanded — ORCH-1008 Phase 4 (DESIGN §3.6 + §3.7)
 *
 * Renders the expanded view of a per-place row: place panel (collage +
 * metadata + run lineage) on the left, Q2 16-card stack on the right.
 *
 * Each Q2 evaluation = one card with:
 *   - signal id (uppercase mono header)
 *   - score (0-100 bold mono, or VETO + XCircle)
 *   - horizontal score bar with bucket-tier accent (success/info/warning/error)
 *   - reasoning paragraph (no truncation)
 *   - inappropriate_for badge (veto only)
 *
 * Card sort: score_0_to_100 desc, then signal_id asc; veto cards sink to bottom.
 *
 * Uses only existing tokens (per DESIGN §0 + §8 reuse table). Zero new colors.
 */

import { XCircle } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { timeAgo } from "../../lib/formatters";

function bucketAccent(score, vetoed) {
  if (vetoed) return "var(--color-error-500)";
  if (score == null) return "var(--gray-300)";
  if (score >= 76) return "var(--color-success-500)";
  if (score >= 51) return "var(--color-info-500)";
  if (score >= 26) return "var(--color-warning-500)";
  return "var(--color-error-500)";
}

function bucketTextClass(score, vetoed) {
  if (vetoed) return "text-[var(--color-error-700)]";
  if (score == null) return "text-[var(--color-text-tertiary)]";
  if (score >= 76) return "text-[var(--color-success-700)]";
  if (score >= 51) return "text-[var(--color-info-700)]";
  if (score >= 26) return "text-[var(--color-warning-700)]";
  return "text-[var(--color-error-700)]";
}

function normaliseScore(e) {
  // v2 shape: score_0_to_100. v1 fallback: confidence_0_to_10 * 10. Veto: null.
  if (e.score_0_to_100 != null) return Number(e.score_0_to_100);
  if (e.confidence_0_to_10 != null) return Number(e.confidence_0_to_10) * 10;
  return null;
}

function SignalReasoningCard({ evaluation }) {
  const score = normaliseScore(evaluation);
  const vetoed = !!evaluation.inappropriate_for;
  const accent = bucketAccent(score, vetoed);
  const scoreColor = bucketTextClass(score, vetoed);
  const cardBg = vetoed
    ? "bg-[var(--color-error-50)]"
    : "bg-[var(--color-background-primary)]";
  return (
    <div
      className={[
        "rounded-lg border border-[var(--gray-200)] p-4 flex flex-col gap-2.5",
        "border-l-4",
        cardBg,
      ].join(" ")}
      style={{ borderLeftColor: accent }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide font-mono text-[var(--color-text-secondary)]">
          {evaluation.signal_id}
        </span>
        {vetoed ? (
          <span className="flex items-center gap-1">
            <XCircle className="w-4 h-4 text-[var(--color-error-700)]" aria-hidden="true" />
            <span className="text-sm font-bold font-mono text-[var(--color-error-700)]">
              VETO
            </span>
          </span>
        ) : score != null ? (
          <span className="flex items-baseline">
            <span className={["text-lg font-bold font-mono tabular-nums", scoreColor].join(" ")}>
              {Math.round(score)}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)] ml-0.5">
              /100
            </span>
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-tertiary)] font-mono">—</span>
        )}
      </div>

      <div
        className="h-1.5 w-full bg-[var(--gray-100)] rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={score ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          vetoed
            ? `${evaluation.signal_id} structurally inappropriate, veto`
            : `${evaluation.signal_id} score ${Math.round(score ?? 0)} of 100`
        }
      >
        {vetoed ? (
          <div
            className="h-full w-full rounded-full"
            style={{
              background:
                "repeating-linear-gradient(45deg, var(--color-error-500), var(--color-error-500) 4px, #b91c1c 4px, #b91c1c 8px)",
            }}
          />
        ) : (
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${Math.max(0, Math.min(100, score ?? 0))}%`,
              background: accent,
            }}
          />
        )}
      </div>

      {evaluation.reasoning && (
        <p className="text-sm text-[var(--color-text-primary)] leading-snug">
          {evaluation.reasoning}
        </p>
      )}

      {vetoed && (
        <Badge variant="error">
          inappropriate_for: {evaluation.signal_id}
        </Badge>
      )}
    </div>
  );
}

export function PlaceResultExpanded({ row, onFilterByRun }) {
  const place = row.place;
  const q2 = row.q2_response;
  const failed = row.status === "failed";

  // Sort: veto last, then score desc, then signal_id asc
  const evaluations = q2?.evaluations
    ? [...q2.evaluations].sort((a, b) => {
        const va = !!a.inappropriate_for;
        const vb = !!b.inappropriate_for;
        if (va !== vb) return va ? 1 : -1;
        const sa = normaliseScore(a) ?? -1;
        const sb = normaliseScore(b) ?? -1;
        if (sb !== sa) return sb - sa;
        return String(a.signal_id).localeCompare(String(b.signal_id));
      })
    : [];

  return (
    <div className="border-t border-[var(--gray-200)] grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 p-5">
      {/* Place panel */}
      <div className="flex flex-col gap-3">
        {row.collage_url ? (
          <img
            src={row.collage_url}
            alt={`Photo collage for ${place?.name || "place"}`}
            className="w-full aspect-square rounded-lg border border-[var(--gray-200)] object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full aspect-square rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] flex items-center justify-center text-xs text-[var(--color-text-tertiary)]">
            No collage
          </div>
        )}
        <div>
          <h5 className="text-base font-semibold text-[var(--color-text-primary)]">
            {place?.name || row.place_pool_id}
          </h5>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            {place?.primary_type || "—"}
          </p>
        </div>
        <div className="text-xs text-[var(--color-text-tertiary)] flex flex-col gap-1">
          {row.completed_at && <span>Evaluated {timeAgo(row.completed_at)}</span>}
          {row.cost_usd != null && (
            <span className="font-mono">Cost ${Number(row.cost_usd).toFixed(4)}</span>
          )}
          {row.run_id && (
            <button
              type="button"
              onClick={() => onFilterByRun?.(row.run_id)}
              className="text-left text-[var(--color-brand-500)] hover:text-[var(--color-brand-700)] underline cursor-pointer font-mono"
            >
              Run {String(row.run_id).slice(0, 8)}…
            </button>
          )}
        </div>
      </div>

      {/* Q2 reasoning cards */}
      <div className="flex flex-col gap-3">
        {failed && row.error_message && (
          <AlertCard variant="error" title="Run failed">
            {row.error_message}
          </AlertCard>
        )}
        {evaluations.length === 0 && !failed && (
          <p className="text-xs text-[var(--color-text-tertiary)] italic">
            No Q2 evaluations recorded for this place.
          </p>
        )}
        {evaluations.length > 0 && (
          <div className="grid grid-cols-1 [@media(min-width:1100px)]:grid-cols-2 gap-3">
            {evaluations.map((e) => (
              <SignalReasoningCard key={e.signal_id} evaluation={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PlaceResultExpanded;
