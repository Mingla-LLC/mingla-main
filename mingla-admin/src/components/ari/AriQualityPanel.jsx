// Issue #3355 Wave F (F2) — Ari quality: how often guided setups finish or
// get set aside, how often Ari refuses, repeats or replies with nothing,
// thumbs up / down, and host turns to finish each kind of setup, over a
// chosen window.
//
// Reads ari_admin_quality_metrics (an admin-only, read-only RPC).

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { LoadError } from "../ui/LoadError";
import { loadAriQuality } from "../../services/ariImprovementService";
import {
  ARI_QUALITY_DEFAULT_DAYS,
  ARI_QUALITY_WINDOWS,
  qualityIsEmpty,
  qualityRows,
  turnsToDoneRows,
} from "../../lib/ariQuality";

export const ARI_QUALITY_EMPTY_COPY =
  "No Ari activity in this window yet. Rates appear once hosts talk to Ari.";

/** The panel's view: pure, so every state renders in tests. */
export function AriQualityView({ state, days, onDays, onRetry }) {
  if (state.status === "error") {
    return <LoadError title="Couldn’t load Ari quality" message={state.error} onRetry={onRetry} retrying={false} />;
  }
  const loading = state.status === "loading";
  const metrics = state.metrics;
  const rows = qualityRows(metrics);
  const turns = turnsToDoneRows(metrics);
  const empty = !loading && qualityIsEmpty(metrics);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Ari quality"
        subtitle="Rates over the chosen window, from Ari's own turns, setups and thumbs"
        noPadding
        action={<div className="flex flex-wrap gap-2">
          <select aria-label="Window" value={days} onChange={(e) => onDays(Number(e.target.value))} className="h-9 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 text-sm text-[var(--color-text-primary)]">
            {ARI_QUALITY_WINDOWS.map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={onRetry}>Refresh</Button>
        </div>}
      >
        {loading ? (
          <div aria-label="Loading Ari quality" className="px-5 py-10 text-center text-sm text-[var(--color-text-secondary)]">Loading…</div>
        ) : empty ? (
          <div className="flex min-h-32 flex-col items-center justify-center px-5 py-8 text-center">
            <Gauge className="mb-2 h-4 w-4 text-[var(--color-text-secondary)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">{ARI_QUALITY_EMPTY_COPY}</p>
          </div>
        ) : (
          <div className="grid gap-px bg-[var(--gray-200)] sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <div key={row.key} data-rate={row.key} className="bg-[var(--color-background-primary)] px-4 py-3.5 sm:px-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">{row.label}</p>
                  {row.verdict === "good" ? <Badge variant="success">On target</Badge> : row.verdict === "bad" ? <Badge variant="warning">Below target</Badge> : null}
                </div>
                <p className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">{row.value}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{row.detail}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Turns to done" subtitle="Host messages from a setup's start to its finish, per kind of setup" noPadding>
        {!loading && turns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-xs text-[var(--color-text-secondary)]">
                  <th className="px-4 py-2.5 font-medium sm:px-5">Setup</th>
                  <th className="px-3 py-2.5 font-medium">Finished</th>
                  <th className="px-3 py-2.5 font-medium">Median turns</th>
                  <th className="px-3 py-2.5 font-medium">Average turns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gray-200)]">
                {turns.map((row) => (
                  <tr key={row.flow_key}>
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)] sm:px-5">{row.label}</td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{row.completed}</td>
                    <td className="px-3 py-2.5 font-semibold text-[var(--color-text-primary)]">{row.median}</td>
                    <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{row.avg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-text-secondary)]">
            {loading ? "Loading…" : "No setup finished in this window."}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export function AriQualityPanel({ service = { loadAriQuality } }) {
  const [days, setDays] = useState(ARI_QUALITY_DEFAULT_DAYS);
  const [state, setState] = useState({ status: "loading", metrics: null, error: null });

  const load = useCallback(async () => {
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    try {
      setState({ status: "ready", metrics: await service.loadAriQuality({ days }), error: null });
    } catch (err) {
      setState({ status: "error", metrics: null, error: err?.message || "Couldn’t load Ari quality" });
    }
  }, [days, service]);

  useEffect(() => { load(); }, [load]);

  return <AriQualityView state={state} days={days} onDays={setDays} onRetry={load} />;
}
