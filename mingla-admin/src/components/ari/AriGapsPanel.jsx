// Issue #3355 Wave D (D3) — Ari gaps: what Ari fell short on, by type and
// week, with the excerpt, a link to the conversation's quality case when one
// exists, "Turn into eval", and the weekly digest's Work board card.
//
// Reads ari_admin_capability_gap_events and writes ari_admin_gap_to_eval
// (both admin-only RPCs). Excerpts are PII-minimised at the source.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, RefreshCw, Wrench } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { LoadError } from "../ui/LoadError";
import { loadAriGaps, turnAriGapIntoEval } from "../../services/ariImprovementService";
import {
  ARI_GAP_TYPES,
  digestCardLabel,
  gapTypeLabel,
  gapTypesPresent,
  gapWeekRows,
} from "../../lib/ariGaps";

function weekLabel(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
}

function when(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AriGapsPanel({ onOpenCase }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [type, setType] = useState("all");
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadAriGaps({ weeks: 8, type: type === "all" ? null : type, limit: 100 }));
    } catch (err) {
      setError(err.message || "Couldn’t load Ari gaps");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => gapWeekRows(data?.weeks), [data]);
  const columns = useMemo(() => gapTypesPresent(rows), [rows]);
  const events = data?.events || [];
  const digests = data?.digests || [];

  const turnIntoEval = async (event) => {
    setBusy(event.id);
    setActionError(null);
    try {
      await turnAriGapIntoEval(event.id);
      await load();
    } catch (err) {
      setActionError(err.message || "Couldn’t turn that gap into an eval");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <LoadError title="Couldn’t load Ari gaps" message={error} onRetry={load} retrying={loading} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Ari gaps by week"
        subtitle="Logged automatically from Ari turns: refusals, repeats, set-aside setups, thumbs down, frustration, empty replies, tool errors and dropped screen links"
        noPadding
        action={<div className="flex flex-wrap gap-2">
          <select aria-label="Gap type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 text-sm text-[var(--color-text-primary)]">
            <option value="all">All gap types</option>
            {ARI_GAP_TYPES.map((value) => <option key={value} value={value}>{gapTypeLabel(value)}</option>)}
          </select>
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={load}>Refresh</Button>
        </div>}
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-xs text-[var(--color-text-secondary)]">
                  <th className="px-4 py-2.5 font-medium sm:px-5">Week of</th>
                  {columns.map((column) => <th key={column} className="px-3 py-2.5 font-medium">{gapTypeLabel(column)}</th>)}
                  <th className="px-3 py-2.5 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gray-200)]">
                {rows.map((row) => (
                  <tr key={row.week_start}>
                    <td className="px-4 py-2.5 text-[var(--color-text-primary)] sm:px-5">{weekLabel(row.week_start)}</td>
                    {columns.map((column) => <td key={column} className="px-3 py-2.5 text-[var(--color-text-secondary)]">{row.counts[column] || 0}</td>)}
                    <td className="px-3 py-2.5 font-semibold text-[var(--color-text-primary)]">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-[var(--color-text-secondary)]">
            {loading ? "Loading…" : "No Ari gaps logged in the last 8 weeks."}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Latest gaps" subtitle={`${events.length} shown · excerpts are scrubbed of emails, phone and card numbers`} noPadding>
        {actionError ? <p role="alert" className="px-5 pt-3 text-sm text-[var(--color-error-700)]">{actionError}</p> : null}
        {events.length ? (
          <div className="divide-y divide-[var(--gray-200)]">
            {events.map((event) => (
              <div key={event.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={event.strong ? "error" : "warning"}>{event.label || gapTypeLabel(event.gap_type)}</Badge>
                    {event.brand_name ? <span className="text-xs text-[var(--color-text-secondary)]">{event.brand_name}</span> : null}
                    <span className="text-xs text-[var(--color-text-tertiary)]">{when(event.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-primary)]">{event.excerpt || "No excerpt."}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                    Conversation {event.conversation_id ? String(event.conversation_id).slice(0, 8) : "deleted"}
                    {event.quality_case_id ? (
                      <>
                        {" · "}
                        <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => onOpenCase?.({ id: event.quality_case_id })}>
                          Open the quality case
                        </button>
                      </>
                    ) : null}
                  </p>
                </div>
                {event.eval_scenario_key ? (
                  <Badge variant="success">Eval {event.eval_scenario_key}</Badge>
                ) : (
                  <Button variant="secondary" icon={FlaskConical} loading={busy === event.id} disabled={!event.excerpt || busy !== null} onClick={() => turnIntoEval(event)}>
                    Turn into eval
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center px-5 py-8 text-center">
            <Wrench className="mb-2 h-4 w-4 text-[var(--color-text-secondary)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">{loading ? "Loading…" : "No gaps match this filter."}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Weekly digest" subtitle="Every Monday one Work board card sums up last week’s gaps" noPadding>
        {digests.length ? (
          <div className="divide-y divide-[var(--gray-200)]">
            {digests.map((digest) => (
              <div key={digest.week_start} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Week of {weekLabel(digest.week_start)}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{digest.total} gaps</p>
                </div>
                <span className="text-xs text-[var(--color-text-secondary)]">{digestCardLabel(digest.card)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--color-text-secondary)]">No digest has run yet.</div>
        )}
      </SectionCard>
    </div>
  );
}
