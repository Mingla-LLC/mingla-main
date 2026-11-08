// Issue #4276: Live runs, at the top of Place pool > Pipeline.
//
// One card per active city run, newest first, then the runs that finished in the last
// 7 days. Each card says in plain words whether the run is moving, waiting (normal,
// never a failure), stalled or stopped for a person, with its stage track, progress,
// pace, places stored, spend against its limit and the actions that fit. The data
// comes from useLiveCityRuns (one database read every 5 s while anything is active),
// which PipelineSection owns and shares with the Run plan and the city rows.
//
// Serper stays "not priced" until a rate is set; it is never shown as $0.

import { useEffect, useState } from "react";
import { Check, Pause, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { useToast } from "../../context/ToastContext";
import { pipeline } from "../../services/cityPipelineService";
import { ShareBar, StatTile } from "./PoolUi";
import { ConfirmModal, Field, inputClass } from "./CityRunPanel";
import {
  ACTIVE_RUN_STATUSES,
  FINISHED_RUN_STATUSES,
  RUN_STAGES,
  ageText,
  approvalLines,
  clockTime,
  currentProgress,
  etaText,
  finishedRunRow,
  heartbeatState,
  livePill,
  liveSpend,
  liveStats,
  outcomeText,
  pauseNote,
  pendingApproval,
  problemNote,
  stageLabel,
  stageTrack,
  usd,
} from "../../lib/cityPipeline";

const BEAT_DOT = {
  moving: "bg-[var(--color-success-500)] motion-safe:animate-pulse",
  waiting: "bg-[var(--color-info-500)]",
  stalled: "bg-[var(--color-warning-500)]",
  stopped: "bg-[var(--gray-400)]",
  done: "bg-[var(--gray-400)]",
};

const TRACK_TONE = {
  done: "bg-[var(--color-success-500)] opacity-70",
  current: "bg-[var(--color-brand-500)]",
  paused: "bg-[var(--color-warning-500)]",
  skipped: "bg-[repeating-linear-gradient(45deg,var(--gray-200)_0_3px,transparent_3px_6px)]",
  pending: "bg-[var(--gray-200)]",
};

const NOTE_TONE = {
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  warn: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  err: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
};

/** A clock that ticks once a second, for "updated N s ago" and the heartbeat. */
function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

function Heartbeat({ run, now }) {
  const beat = heartbeatState(run, now);
  if (!beat.text) return null;
  return (
    <div className={`flex items-center gap-2 text-[12.5px] ${beat.state === "stalled" ? "font-medium text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`} role="status">
      <i aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${beat.quiet && beat.state === "moving" ? "bg-[var(--color-success-500)]" : BEAT_DOT[beat.state]}`} />
      {beat.text}
    </div>
  );
}

function Note({ tone, title, children, mono }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-[12.5px] ${NOTE_TONE[tone]}`}>
      <b className="font-semibold">{title}</b>
      {children && <span className={mono ? "break-words font-mono text-[11.5px] opacity-90" : "tabular-nums"}>{children}</span>}
    </div>
  );
}

function StageTrack({ run }) {
  const track = stageTrack(run);
  const current = run.current_stage ? stageLabel(run.current_stage) : null;
  const at = track.findIndex((s) => s.id === run.current_stage);
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-11 gap-[3px]" role="img" aria-label={at >= 0 ? `Stage ${at + 1} of ${RUN_STAGES.length}: ${current}` : `${RUN_STAGES.length} stages`}>
        {track.map((s) => <span key={s.id} title={`${s.label}: ${s.state}`} className={`h-1.5 rounded-sm ${TRACK_TONE[s.state]}`} />)}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-[var(--color-text-tertiary)]">
        <span>Box</span>
        {current && <span className="truncate font-medium text-[var(--color-text-secondary)]">{run.current_stage === "fill" ? "Searching" : current}</span>}
        <span>Thumbnails</span>
      </div>
    </div>
  );
}

function ProgressBlock({ run }) {
  const p = currentProgress(run);
  if (!p) return null;
  const remaining = p.total !== null && p.done !== null ? p.total - p.done : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-medium text-[var(--color-text-primary)]">{p.label}</span>
        <span className="tabular-nums text-[var(--color-text-secondary)]">{p.line}</span>
      </div>
      {p.pct !== null && <ShareBar share={p.pct} label={`${p.label}: ${p.pct}%`} />}
      {p.total !== null && run.status === "running" && (
        <span className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{etaText(run._ratePerMin ?? null, remaining, p.unit ?? "searches")}</span>
      )}
    </div>
  );
}

function SpendMeter({ run, serperRate }) {
  const s = liveSpend(run, serperRate);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5 text-[12.5px] tabular-nums">
        <span>Spent <b className="font-semibold">{s.spentText}</b></span>
        <span className="ml-auto text-[var(--color-text-secondary)]">of {s.limitText} limit</span>
      </div>
      <ShareBar share={s.pct ?? 0} tone={s.over ? "error" : "brand"} label={s.pct === null ? "Spend unknown" : `${s.pct}% of the spend limit`} />
      {s.serperText && <span className="text-[11px] text-[var(--color-text-tertiary)]">{s.serperText}</span>}
    </div>
  );
}

/** The actions a card offers, called the way the Run plan's act() calls them. */
function CardActions({ run, serperRate, onDone, onOpen }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // cancel | rules_only | raise | approve
  const [newLimit, setNewLimit] = useState("");
  const [highCostOk, setHighCostOk] = useState(false);
  const approval = pendingApproval(run);
  const limitNumber = Number(newLimit);
  const raiseOk = newLimit.trim() !== "" && Number.isFinite(limitNumber) && limitNumber > 0;

  const act = async (action, body, done) => {
    setBusy(action);
    try {
      await pipeline(action, { runId: run.id, ...body });
      addToast({ variant: "success", title: done });
      setConfirm(null);
      setHighCostOk(false);
      setNewLimit("");
      await onDone(run);
    } catch (err) {
      addToast({ variant: "error", title: "That didn't go through", description: err.message });
      await onDone(run);
    } finally {
      setBusy(null);
    }
  };

  const approve = () => act("approve", { key: approval.key, confirmHighCost: approval.highCost ? true : undefined }, "Approved. The run carries on.");
  const approveCost = approval?.numbers?.estimatedCostUsd;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--gray-200)] pt-3">
      {(run.status === "running" || run.status === "queued") && (
        <Button size="sm" variant="secondary" icon={Pause} loading={busy === "pause"} onClick={() => act("pause", {}, "Paused.")}>Pause</Button>
      )}
      {run.status === "paused" && (
        <>
          {run.pause_reason === "spend_limit" && <Button size="sm" onClick={() => setConfirm("raise")}>Raise limit and resume</Button>}
          <Button size="sm" variant={run.pause_reason === "spend_limit" ? "secondary" : "primary"} icon={RotateCcw} loading={busy === "resume"}
            onClick={() => act("resume", {}, "Resumed. Gates are checked again before the next step.")}>Resume</Button>
        </>
      )}
      {approval && (
        <Button size="sm" icon={Check} loading={busy === "approve"} onClick={() => (approval.highCost ? setConfirm("approve") : approve())}>
          {approveCost != null ? `Approve ${usd(approveCost)}` : "Approve this step"}
        </Button>
      )}
      {(run.status === "paused" || run.status === "awaiting_approval") && !run.rules_only && (
        <Button size="sm" variant="secondary" onClick={() => setConfirm("rules_only")}>Rules only</Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => onOpen(run)}>Open run</Button>
      <Button size="sm" variant="ghost" icon={XCircle} className="ml-auto !text-[var(--color-error-700)]" onClick={() => setConfirm("cancel")}>Cancel</Button>

      <ConfirmModal open={confirm === "cancel"} title={`Cancel the ${run.city_name ?? "city"} run?`} destructive confirmLabel="Cancel the run"
        busy={busy === "cancel"} onConfirm={() => act("cancel", {}, "Run cancelled. New places it held stay hidden.")} onClose={() => setConfirm(null)}>
        <p>Searches, photos and Intelligence it started are stopped. New places it was holding stay hidden from Explorers until a later run finishes them.</p>
      </ConfirmModal>
      <ConfirmModal open={confirm === "rules_only"} title="Let places go live on rules only?" confirmLabel="Use rules only"
        busy={busy === "rules_only"} onConfirm={() => act("rules_only", { confirmRulesOnly: true }, "Rules only chosen. The run carries on.")} onClose={() => setConfirm(null)}>
        <p>Places that passed the final check are released without Intelligence, scored on rules alone. Use this only when reviews or Intelligence can't run and the city can't wait.</p>
      </ConfirmModal>
      <ConfirmModal open={confirm === "raise"} title={`Raise the ${run.city_name ?? "city"} spend limit?`} confirmLabel={raiseOk ? `Resume at ${usd(limitNumber)}` : "Resume"}
        busy={busy === "resume"} onConfirm={() => { if (raiseOk) act("resume", { spendLimitUsd: limitNumber }, "Resumed. Gates are checked again before the next step."); }} onClose={() => setConfirm(null)}>
        <p className="tabular-nums">It has spent {usd(run.spent_usd)} of its {usd(run.spend_limit_usd)} limit.</p>
        <Field label="New spend limit, USD">
          <input className={inputClass} aria-label="New spend limit, USD" inputMode="decimal" value={newLimit} onChange={(e) => setNewLimit(e.target.value)}
            placeholder={String(run.spend_limit_usd ?? "")} aria-invalid={newLimit !== "" && !raiseOk} />
        </Field>
      </ConfirmModal>
      {approval && (
        <ConfirmModal open={confirm === "approve"} title={`Approve ${stageLabel(approval.stage)}?`} confirmLabel="Approve this step"
          busy={busy === "approve"} onConfirm={() => { if (highCostOk) approve(); }} onClose={() => setConfirm(null)}>
          <ul className="list-disc pl-5 tabular-nums">{approvalLines(approval, serperRate).map((l) => <li key={l}>{l}</li>)}</ul>
          <div className="flex min-h-10 items-center gap-2">
            <input id={`live-high-cost-${run.id}`} type="checkbox" className="h-5 w-5" checked={highCostOk} onChange={(e) => setHighCostOk(e.target.checked)} />
            <label htmlFor={`live-high-cost-${run.id}`}>I accept this is above the high-cost limit</label>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function RunCard({ run, now, serperRate, highlighted, onDone, onOpen }) {
  const beat = heartbeatState(run, now);
  const pill = livePill(run, now);
  const approval = pendingApproval(run);
  const problem = problemNote(run);
  const paused = pauseNote(run);
  const stats = liveStats(run, serperRate);
  const outcome = outcomeText(run.last_outcome);
  const started = run.started_at ?? run.created_at;
  const border = run.status === "paused"
    ? "border-[color-mix(in_srgb,var(--color-warning-500)_55%,var(--gray-200))]"
    : run.status === "awaiting_approval" ? "border-[color-mix(in_srgb,var(--color-info-500)_55%,var(--gray-200))]" : "border-[var(--gray-200)]";
  return (
    <article id={`live-run-${run.id}`} aria-label={`${run.city_name ?? "City"} run, ${pill.label.toLowerCase()}`}
      className={`flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-xl border bg-[var(--color-background-primary)] p-4 transition-shadow duration-300 ${border} ${highlighted ? "ring-2 ring-[var(--color-brand-500)] ring-offset-2" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">{run.city_name ?? "Unknown city"}</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">{[run.country, started ? `started ${clockTime(started)}` : null].filter(Boolean).join(" · ")}</span>
        <Badge variant={pill.variant} dot className="ml-auto">{pill.label}</Badge>
      </div>
      <Heartbeat run={run} now={now} />
      <StageTrack run={run} />
      {paused && (
        <Note tone="warn" title={paused.title}>{paused.lines.length ? paused.lines.join(" ") : null}</Note>
      )}
      {approval && (
        <Note tone="info" title={`${stageLabel(approval.stage)} is waiting for your OK`}>{approvalLines(approval, serperRate).join(" · ")}</Note>
      )}
      <ProgressBlock run={run} />
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.value} note={s.note} />)}
      </div>
      <SpendMeter run={run} serperRate={serperRate} />
      {beat.state === "waiting" && run.status === "running" && (
        <Note tone="info" title="This is normal.">The run picks up again on its own. Nothing is counted as a failure.</Note>
      )}
      {problem && <Note tone="err" title={problem.title} mono>{problem.message || null}</Note>}
      {outcome && run.last_outcome?.at && (
        <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">Last wake-up {clockTime(run.last_outcome.at, { seconds: true })} · {outcome}</span>
      )}
      <CardActions run={run} serperRate={serperRate} onDone={onDone} onOpen={onOpen} />
    </article>
  );
}

function RecentRuns({ runs }) {
  if (runs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Last 7 days</h4>
      <div className="overflow-x-auto rounded-xl border border-[var(--gray-200)]">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px] tabular-nums" aria-label="City runs finished in the last 7 days">
          <thead>
            <tr className="bg-[var(--gray-50)] text-left text-[11px] font-semibold text-[var(--color-text-secondary)]">
              <th scope="col" className="px-3 py-2">City</th>
              <th scope="col" className="px-3 py-2">Result</th>
              <th scope="col" className="px-3 py-2">Stages</th>
              <th scope="col" className="px-3 py-2 text-right">Places stored</th>
              <th scope="col" className="px-3 py-2 text-right">Now live</th>
              <th scope="col" className="px-3 py-2 text-right">Spent</th>
              <th scope="col" className="px-3 py-2">Took</th>
              <th scope="col" className="px-3 py-2">Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const r = finishedRunRow(run);
              return (
                <tr key={r.id} className="border-t border-[var(--gray-200)] whitespace-nowrap">
                  <td className="px-3 py-2 font-medium">{r.city}</td>
                  <td className="px-3 py-2"><Badge variant={r.pill.variant} dot>{r.pill.label}</Badge></td>
                  <td className="px-3 py-2">{r.stagesText}</td>
                  <td className="px-3 py-2 text-right">{r.storedText}</td>
                  <td className="px-3 py-2 text-right">{r.liveText}</td>
                  <td className="px-3 py-2 text-right">{r.spentText}</td>
                  <td className="px-3 py-2">{r.tookText}</td>
                  <td className="px-3 py-2">{r.finishedText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--color-text-tertiary)]">"Now live" counts places released to Explorers by that run.</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3" aria-busy="true" aria-label="Loading live runs">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] p-4">
          <div className="h-4 w-1/3 rounded bg-[var(--gray-100)] motion-safe:animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-[var(--gray-100)] motion-safe:animate-pulse" />
          <div className="h-1.5 w-full rounded bg-[var(--gray-100)] motion-safe:animate-pulse" />
          <div className="h-16 w-full rounded bg-[var(--gray-100)] motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * live: the useLiveCityRuns result. onOpen(run) picks that city's Run plan;
 * onChanged() refreshes the rest of the tab after an action.
 */
export function LiveRunsSection({ live, serperRate, highlightRunId = null, onOpen, onChanged }) {
  const now = useNow();
  const { runs, loading, error, updatedAt, refresh } = live;
  const active = runs.filter((r) => ACTIVE_RUN_STATUSES.includes(r.status))
    .sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0));
  const finished = runs.filter((r) => FINISHED_RUN_STATUSES.includes(r.status))
    .sort((a, b) => Date.parse(b.completed_at ?? 0) - Date.parse(a.completed_at ?? 0));
  const onDone = async () => { await refresh(); onChanged?.(); };

  const status = (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
      <i aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${error ? "bg-[var(--color-warning-500)]" : "bg-[var(--color-success-500)] motion-safe:animate-pulse"}`} />
      Live{updatedAt ? ` · updated ${ageText(now - updatedAt)} ago` : ""}
    </span>
  );

  return (
    <SectionCard
      title="Live runs"
      subtitle={active.length ? "Every city run on the server. Updates every 5 seconds while a run is going." : "Every city run on the server."}
      action={<>{status}<Button size="sm" variant="ghost" icon={RefreshCw} aria-label="Refresh live runs" onClick={refresh} /></>}
    >
      <div className="flex flex-col gap-4" aria-live="polite">
        {error && runs.length > 0 && (
          <AlertCard variant="warning" title="Couldn't refresh live runs">{error} Showing the last numbers read; it keeps trying.</AlertCard>
        )}
        {loading && runs.length === 0 ? (
          <Skeleton />
        ) : error && runs.length === 0 ? (
          <AlertCard variant="error" title="Couldn't read live runs" action={<Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>}>{error}</AlertCard>
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--gray-300)] px-5 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">
            <b className="font-semibold text-[var(--color-text-primary)]">No runs going</b>
            <span>Pick a city in the table below and start one. Finished runs from the last 7 days show here.</span>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3">
            {active.map((run) => (
              <RunCard key={run.id} run={run} now={now} serperRate={serperRate} highlighted={run.id === highlightRunId} onDone={onDone} onOpen={onOpen} />
            ))}
          </div>
        )}
        <RecentRuns runs={finished} />
      </div>
    </SectionCard>
  );
}

export default LiveRunsSection;
