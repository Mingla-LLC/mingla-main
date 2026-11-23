// Issue #4571 W6c — the nightly cadence sweep on the Team dashboard: its
// switch (Off, Dry run, On; owner only), the last runs with the Mac script's
// summary line, and what one run did or would do to each card. The sweep runs
// on the server (pg_cron, weekdays 9 PM Lagos); this panel only reads it,
// switches it and asks for a dry run now. Everything shown is the server's.
import { useState } from "react";
import { SectionCard } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Badge } from "../../ui/Badge";
import { useToast } from "../../../context/ToastContext";
import { useOpsPoll } from "../../../hooks/useOpsWork";
import { configureSweep, fetchSweepStatus, runSweepDryRun } from "../../../services/crmService";
import { errorWords, loadErrorWords } from "../../../lib/crmModel";
import { localWhen } from "../../../lib/opsModel";
import { buildCrmHash } from "../../../lib/crmUrl";
import { SWEEP_ACTION_WORDS, SWEEP_MODES, sweepModeWords } from "../../../lib/sopTools";

export function CadenceSweepPanel({ viewerKey = "", isOwner = false }) {
  const { addToast } = useToast();
  const [runId, setRunId] = useState(null);
  const [busy, setBusy] = useState("");
  const status = useOpsPoll(() => fetchSweepStatus(runId), { key: `${viewerKey}|cadence-sweep|${runId || "latest"}`, intervalMs: 300_000 });
  const data = status.data;
  const mode = data?.config?.mode || "off";
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  const shown = runs.find((r) => r.id === data?.run_id) || null;

  const setMode = async (next) => {
    setBusy(`mode:${next}`);
    try {
      await configureSweep(next, data?.config?.report_card_id || null);
      addToast({ variant: "success", title: `The nightly sweep is ${sweepModeWords(next).toLowerCase()}.` });
      status.refetch();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't change the nightly sweep", description: errorWords(err) });
    } finally { setBusy(""); }
  };
  const dryRun = async () => {
    setBusy("dry");
    try {
      const res = await runSweepDryRun();
      addToast({ variant: "success", title: "Dry run done. No card changed.", description: res?.summary || "" });
      setRunId(res?.run_id || null);
      status.refetch();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't run a dry run", description: errorWords(err) });
    } finally { setBusy(""); }
  };

  return (
    <SectionCard title="Nightly cadence sweep" subtitle="Weekdays at 9 PM Lagos, on the server">
      {status.loading && !data ? (
        <div aria-busy="true" aria-label="Loading the nightly sweep"><Skeleton height={120} /></div>
      ) : status.error && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-error-700)]">
          <span>Couldn’t load the nightly sweep. {loadErrorWords(status.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => status.refetch()}>Try again</Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Sweep mode" className="flex flex-wrap gap-1">
              {SWEEP_MODES.map((m) => (
                <Button key={m.value} size="sm" className="min-h-11" variant={mode === m.value ? "primary" : "secondary"} aria-pressed={mode === m.value}
                  disabled={!isOwner || mode === m.value} loading={busy === `mode:${m.value}`} onClick={() => setMode(m.value)}>{m.label}</Button>
              ))}
            </div>
            <Button size="sm" variant="ghost" className="min-h-11" loading={busy === "dry"} onClick={dryRun}>Run a dry run now</Button>
          </div>
          <p className="text-[12.5px] text-[var(--color-text-secondary)]">
            {mode === "apply" ? "On: each weekday night it moves first touches to Contacted, finished cadences to Lost and dates the next round."
              : mode === "dry_run" ? "Dry run: each weekday night it writes what it would do and changes no card. Compare it with the Mac script for 3 nights."
              : "Off: the nightly job does nothing."}
            {!isOwner && " Only the owner can switch it."}
            {data?.job ? "" : " The nightly job is not scheduled on this database."}
          </p>
          {runs.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No runs yet. Run a dry run now to see what it would do.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1" aria-label="Recent runs">
                {runs.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <button type="button" aria-pressed={r.id === data?.run_id} onClick={() => setRunId(r.id)}
                      className={`flex min-h-11 w-full min-w-0 flex-wrap items-center gap-2 rounded-md px-2 text-left text-[12.5px] ${r.id === data?.run_id ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}>
                      <Badge variant={r.dry_run ? "default" : "warning"}>{r.dry_run ? "Dry run" : "Applied"}</Badge>
                      <span className="min-w-0 flex-1 break-words text-[var(--color-text-secondary)]">{r.summary || `Started ${localWhen(r.started_at)}`}</span>
                      {(r.error || r.report_error) && <span className="text-[var(--color-error-700)]">{r.error || `Report not posted: ${r.report_error}`}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {shown && (
                actions.length === 0 ? (
                  <p className="text-[13px] text-[var(--color-text-secondary)]">That run had nothing to move or date.</p>
                ) : (
                  <div className="min-w-0 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[12.5px]" aria-label="What the run did">
                      <thead>
                        <tr className="border-b border-[var(--gray-200)] text-[var(--color-text-tertiary)]">
                          <th scope="col" className="px-2 py-1 text-left font-medium">Card</th>
                          <th scope="col" className="px-2 py-1 text-left font-medium">Change</th>
                          <th scope="col" className="px-2 py-1 text-left font-medium">Detail</th>
                          <th scope="col" className="px-2 py-1 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actions.map((a) => (
                          <tr key={`${a.record_id}-${a.action}`} className="border-b border-[var(--gray-100)] align-top">
                            <td className="px-2 py-1 font-medium text-[var(--color-text-primary)]"><a href={buildCrmHash("hosts", { card: a.record_id })} className="underline-offset-2 hover:underline">{a.name}</a></td>
                            <td className="px-2 py-1">{SWEEP_ACTION_WORDS[a.action] || a.action}</td>
                            <td className="px-2 py-1 text-[var(--color-text-secondary)]">{a.action === "advance" ? `${a.next_action} · due ${a.due_on}` : a.reason}</td>
                            <td className="px-2 py-1">{a.status}{a.error ? `: ${a.error}` : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}
