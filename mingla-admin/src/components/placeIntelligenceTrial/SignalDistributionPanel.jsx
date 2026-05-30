/**
 * SignalDistributionPanel — ORCH-1008 Phase 4d (DESIGN §5)
 *
 * Per-signal verdict distribution for a single completed run:
 *   - 16 horizontal stacked bars (one per signal) bucketed:
 *       0-25 (error)  /  26-50 (warning)  /  51-75 (info)  /  76-100 (success)
 *       + veto (gray-700) as a separate stack
 *   - Spot-check panel beneath: signal-picker + Top 5 / Random 5 / Lowest 5
 *
 * Data source: computed CLIENT-SIDE from `rows` (the place_intelligence_trial_runs
 * already loaded for the selected run). Avoids a second edge-fn call.
 * Hidden when run has <10 completed places (DESIGN §5.1).
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { XCircle, CheckCircle, ChevronDown, ExternalLink } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";

const SIGNAL_IDS = [
  "brunch", "casual_food", "creative_arts", "drinks", "fine_dining", "flowers",
  "groceries", "icebreakers", "lively", "movies", "nature", "picnic_friendly",
  "play", "romantic", "scenic", "theatre",
];

const BUCKET_LABEL = {
  bucket_0_25: "0–25",
  bucket_26_50: "26–50",
  bucket_51_75: "51–75",
  bucket_76_100: "76–100",
  bucket_veto: "Veto",
};

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-background-primary)",
  border: "1px solid var(--gray-200)",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "12px",
  boxShadow: "var(--shadow-md)",
  color: "var(--color-text-primary)",
};

function normaliseScore(e) {
  if (e.score_0_to_100 != null) return Number(e.score_0_to_100);
  if (e.confidence_0_to_10 != null) return Number(e.confidence_0_to_10) * 10;
  return null;
}

function bucketKey(score) {
  if (score == null) return null;
  if (score >= 76) return "bucket_76_100";
  if (score >= 51) return "bucket_51_75";
  if (score >= 26) return "bucket_26_50";
  return "bucket_0_25";
}

export function SignalDistributionPanel({ runRows, runId, onOpenPlace }) {
  // Only the completed rows for this run carry q2 reasoning.
  const completed = useMemo(
    () => (runRows || []).filter((r) => r.status === "completed" && r.q2_response?.evaluations),
    [runRows],
  );

  // Aggregate per-signal bucket counts across the completed rows.
  const signalRows = useMemo(() => {
    const map = new Map();
    for (const sid of SIGNAL_IDS) {
      map.set(sid, {
        signal_id: sid,
        bucket_0_25: 0,
        bucket_26_50: 0,
        bucket_51_75: 0,
        bucket_76_100: 0,
        bucket_veto: 0,
      });
    }
    for (const row of completed) {
      for (const e of row.q2_response.evaluations) {
        const r = map.get(e.signal_id);
        if (!r) continue;
        if (e.inappropriate_for) {
          r.bucket_veto += 1;
        } else {
          const k = bucketKey(normaliseScore(e));
          if (k) r[k] += 1;
        }
      }
    }
    return Array.from(map.values());
  }, [completed]);

  // Spot-check: per-signal place lists (top 5 / random 5 / lowest 5)
  const [spotCheckSignal, setSpotCheckSignal] = useState(SIGNAL_IDS[0]);
  const [signalDropdownOpen, setSignalDropdownOpen] = useState(false);

  const spotCheck = useMemo(() => {
    if (!spotCheckSignal) return { top: [], random: [], lowest: [], vetoed: [] };
    const items = [];
    for (const row of completed) {
      const ev = row.q2_response.evaluations.find((e) => e.signal_id === spotCheckSignal);
      if (!ev) continue;
      const score = normaliseScore(ev);
      items.push({
        place_pool_id: row.place_pool_id,
        place_name: row.place?.name || row.place_pool_id,
        score,
        vetoed: !!ev.inappropriate_for,
      });
    }
    const scored = items.filter((i) => !i.vetoed && i.score != null);
    const vetoed = items.filter((i) => i.vetoed);
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 5);
    const lowest = [...scored].sort((a, b) => a.score - b.score).slice(0, 5);
    // Deterministic random-ish: rotate by string hash so spot-check stays
    // stable across rerenders but varies per signal pick.
    const shuffled = [...scored];
    let h = 0;
    for (let i = 0; i < spotCheckSignal.length; i++) {
      h = (h * 31 + spotCheckSignal.charCodeAt(i)) | 0;
    }
    const offset = Math.abs(h) % Math.max(1, shuffled.length);
    const random = shuffled
      .slice(offset)
      .concat(shuffled.slice(0, offset))
      .slice(0, 5);
    return { top, random, lowest, vetoed: vetoed.slice(0, 5) };
  }, [completed, spotCheckSignal]);

  if (completed.length < 10) return null;

  return (
    <SectionCard
      title="Signal verdict distribution"
      subtitle={`${completed.length.toLocaleString()} places · run ${String(runId).slice(0, 8)}…`}
      action={
        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            iconRight={ChevronDown}
            onClick={() => setSignalDropdownOpen((v) => !v)}
          >
            Spot-check signal:{" "}
            <span className="font-mono ml-1">{spotCheckSignal}</span>
          </Button>
          {signalDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setSignalDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-[180px] max-h-[320px] overflow-y-auto bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg shadow-[var(--shadow-md)] py-1">
                {SIGNAL_IDS.map((sid) => (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => {
                      setSpotCheckSignal(sid);
                      setSignalDropdownOpen(false);
                    }}
                    className={[
                      "w-full text-left px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors duration-150",
                      sid === spotCheckSignal
                        ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]",
                    ].join(" ")}
                  >
                    {sid}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Stacked bar chart */}
        <div className="border border-[var(--gray-200)] rounded-lg p-3 bg-[var(--color-background-primary)]">
          <ResponsiveContainer width="100%" height={420}>
            <BarChart
              data={signalRows}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 20, bottom: 8 }}
              barCategoryGap={4}
            >
              <XAxis
                type="number"
                tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                dataKey="signal_id"
                type="category"
                width={120}
                tick={{
                  fill: "var(--color-text-tertiary)",
                  fontSize: 11,
                  fontFamily: "'Geist Mono', monospace",
                }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) => [
                  `${Number(value).toLocaleString()} places`,
                  BUCKET_LABEL[name] || name,
                ]}
                labelFormatter={(label) => `Signal: ${label}`}
              />
              <Bar dataKey="bucket_0_25" stackId="dist" fill="var(--color-error-500)" isAnimationActive={false} />
              <Bar dataKey="bucket_26_50" stackId="dist" fill="var(--color-warning-500)" isAnimationActive={false} />
              <Bar dataKey="bucket_51_75" stackId="dist" fill="var(--color-info-500)" isAnimationActive={false} />
              <Bar dataKey="bucket_76_100" stackId="dist" fill="var(--color-success-500)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              <Bar dataKey="bucket_veto" stackId="dist" fill="var(--gray-700)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-tertiary)] mt-3 px-2">
            {[
              { label: "0–25", bg: "var(--color-error-500)" },
              { label: "26–50", bg: "var(--color-warning-500)" },
              { label: "51–75", bg: "var(--color-info-500)" },
              { label: "76–100", bg: "var(--color-success-500)" },
              { label: "Veto", bg: "var(--gray-700)" },
            ].map((b) => (
              <span key={b.label} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: b.bg }}
                  aria-hidden="true"
                />
                <span>{b.label}</span>
              </span>
            ))}
          </div>
          <table className="sr-only" aria-label="Signal verdict distribution data">
            <thead>
              <tr>
                <th>Signal</th><th>0–25</th><th>26–50</th><th>51–75</th><th>76–100</th><th>Veto</th>
              </tr>
            </thead>
            <tbody>
              {signalRows.map((s) => (
                <tr key={s.signal_id}>
                  <td>{s.signal_id}</td>
                  <td>{s.bucket_0_25}</td>
                  <td>{s.bucket_26_50}</td>
                  <td>{s.bucket_51_75}</td>
                  <td>{s.bucket_76_100}</td>
                  <td>{s.bucket_veto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Spot-check */}
        <div>
          <h4 className="text-[11px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-2">
            Spot-check — <span className="text-[var(--color-text-primary)]">{spotCheckSignal}</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SpotCheckColumn label="Top 5 by score" items={spotCheck.top} onOpenPlace={onOpenPlace} />
            <SpotCheckColumn label="Random 5" items={spotCheck.random} onOpenPlace={onOpenPlace} />
            <SpotCheckColumn label="Lowest 5" items={spotCheck.lowest} onOpenPlace={onOpenPlace} />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function SpotCheckColumn({ label, items, onOpenPlace }) {
  return (
    <div className="border border-[var(--gray-200)] rounded-lg p-3">
      <p className="text-[11px] uppercase tracking-wide font-mono text-[var(--color-text-tertiary)] mb-2">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-xs italic text-[var(--color-text-tertiary)]">
          No places in this tier.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((it) => (
            <li key={`${label}-${it.place_pool_id}`}>
              <button
                type="button"
                onClick={() => onOpenPlace?.(it.place_pool_id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--gray-50)] cursor-pointer text-xs text-left transition-colors duration-150"
              >
                {it.vetoed ? (
                  <XCircle className="w-3.5 h-3.5 text-[var(--color-error-700)] shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success-700)] shrink-0" aria-hidden="true" />
                )}
                <span className="truncate text-[var(--color-text-primary)] flex-1">
                  {it.place_name}
                </span>
                <span className="font-mono tabular-nums text-[var(--color-text-tertiary)] shrink-0">
                  {it.vetoed ? "VETO" : Math.round(it.score ?? 0)}
                </span>
                <ExternalLink className="w-3 h-3 text-[var(--color-text-tertiary)] shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SignalDistributionPanel;
