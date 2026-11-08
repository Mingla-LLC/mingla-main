// Issue #4276 U1: one city's pipeline run, from plan to finish, driven by the server.
//
// Before a run: what it would do and cost, what stands in its way, a spend limit
// (always required) and the scope (new places only unless a person chooses the whole
// city). During a run: every stage, what it is waiting for, spend so far, and the
// controls the conductor offers (approve, pause, resume, cancel, rules only). Closing
// the browser changes nothing: the run carries on server-side.
//
// Serper's cost is shown as unknown until a rate is set; nothing here invents it.
//
// #4276 Live runs: while the Pipeline tab's live read is answering, RunStatus takes
// its run from there (no 15 s poll of its own), shows each stage's progress, the
// heartbeat, the last wake-up and any error before a pause, and tells the tab when
// the run's status changes so the city row refreshes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, XCircle, Check, RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";
import { ModalBody, ModalFooter } from "../ui/Modal";
// #4276: modals here are drawn on document.body, above the sticky table and Run plan.
import { PortalModal as Modal, ShareBar } from "./PoolUi";
import { useToast } from "../../context/ToastContext";
import { pipeline } from "../../services/cityPipelineService";
import {
  ACTIVE_RUN_STATUSES,
  RUN_STAGES,
  approvalLines,
  clockTime,
  count,
  errorLine,
  heartbeatState,
  liveStage,
  outcomeText,
  problemNote,
  stageProgress,
  pauseReasonText,
  pendingApproval,
  runStatusWord,
  serperCostText,
  spendSummary,
  stageLabel,
  usd,
} from "../../lib/cityPipeline";

const POLL_MS = 15_000;
const PREVIEW_DEBOUNCE_MS = 350;

const STAGE_STATUS = {
  pending: { label: "Waiting", variant: "default" },
  running: { label: "Running", variant: "brand" },
  complete: { label: "Done", variant: "success" },
  skipped: { label: "Skipped", variant: "outline" },
};

export function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
      {label}
      {children}
      {hint && <span className="font-normal text-[var(--color-text-tertiary)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] tabular-nums";

export function ConfirmModal({ open, title, children, confirmLabel, destructive, busy, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} destructive={destructive}>
      <ModalBody><div className="flex flex-col gap-2 text-sm text-[var(--color-text-secondary)]">{children}</div></ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Keep as is</Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Before a run ─────────────────────────────────────────────────────────────

function RunPlan({ city, serperRate, onStarted, picks }) {
  const { addToast } = useToast();
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("");
  const [wholeCity, setWholeCity] = useState(false);
  const [skipSearch, setSkipSearch] = useState(false);
  const [confirmWhole, setConfirmWhole] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [starting, setStarting] = useState(false);
  // #4276: with picks, the run does only those stages. The server prices exactly them,
  // and Start waits for that price; the cells' estimate is only a guide.
  const server = picks && picks.lines.length > 0 ? picks.server : null;
  const planKey = server ? JSON.stringify([city.city_id, server.stages, server.redoIntelligence, wholeCity]) : null;
  const [planPrice, setPlanPrice] = useState(null); // { key, plan }
  const [planError, setPlanError] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    setPreviewError(null);
    try {
      setPreview(await pipeline("preview", { cityId: city.city_id }));
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setLoading(false);
    }
  }, [city.city_id]);

  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPreview(null); setPreviewError(null); }, [city.city_id]);

  // The server's price for exactly these picks, read again whenever they change.
  useEffect(() => {
    if (!planKey) return undefined;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlanLoading(true);
    setPlanError(null);
    const [, stages, redoIntelligence, whole] = JSON.parse(planKey);
    // One request per settled plan: quick taps (and a remount) cancel the timer first.
    const timer = setTimeout(() => {
      pipeline("preview", { cityId: city.city_id, stages, redoIntelligence, scope: whole ? "whole_city" : "new_only" })
        .then((res) => { if (live) setPlanPrice({ key: planKey, plan: res.plan }); })
        .catch((err) => { if (live) setPlanError(err.message); })
        .finally(() => { if (live) setPlanLoading(false); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [planKey, city.city_id]);
  const plan = planPrice && planPrice.key === planKey ? planPrice.plan : null;

  const limitNumber = Number(limit);
  const limitOk = limit.trim() !== "" && Number.isFinite(limitNumber) && limitNumber > 0;

  const start = async () => {
    setStarting(true);
    try {
      const res = await pipeline("start", {
        cityId: city.city_id,
        spendLimitUsd: limitNumber,
        scope: wholeCity ? "whole_city" : "new_only",
        confirmWholeCity: wholeCity ? true : undefined,
        ...(server
          ? { stages: server.stages, redoIntelligence: server.redoIntelligence, confirmRedo: server.redoIntelligence ? true : undefined }
          : { skipSearch }),
      });
      addToast({ variant: "success", title: `Run started for ${city.city_name}`, description: "It carries on if you close this page." });
      setConfirmWhole(false);
      setConfirmPlan(false);
      onStarted(res.runId);
    } catch (err) {
      addToast({ variant: "error", title: "The run did not start", description: err.message });
    } finally {
      setStarting(false);
    }
  };

  const stages = preview?.stages ?? {};
  const unhealthy = [...(preview?.unhealthy?.search ?? []), ...(preview?.unhealthy?.intelligence ?? [])];
  const blockers = Array.isArray(preview?.blockers) ? preview.blockers : [];

  return (
    <div className="flex flex-col gap-4">
      {picks && picks.lines.length > 0 && (
        <div className="flex flex-col gap-2" aria-label="Your picks">
          <ul className="flex flex-col divide-y divide-[var(--gray-100)] rounded-lg border border-[var(--gray-200)] text-[13px]">
            {picks.lines.map((l) => (
              <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-[var(--color-text-primary)]">{l.label}</span>
                  {l.needed && <span className="ml-1.5 text-[11px] text-[var(--color-brand-700)]">needed first</span>}
                </span>
                <span className="tabular-nums text-[var(--color-text-secondary)]">{l.count}</span>
                <span className="tabular-nums text-[var(--color-text-primary)]">{l.cost.text || "–"}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--color-text-secondary)]">Estimated cost</span>
            <b className="text-[20px] font-semibold tabular-nums text-[var(--color-text-primary)]">{picks.totalText}</b>
          </div>
          <p className="text-[11px] leading-4 text-[var(--color-text-tertiary)]">The cells' estimate. The run does only these stages and what they need first, then stops.</p>
          <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3" aria-label="Server price">
            {planError ? (
              <AlertCard variant="error" title="Couldn't price the plan">{planError}</AlertCard>
            ) : !plan || planLoading ? (
              <span className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"><Spinner size="sm" /> Pricing on the server…</span>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-[var(--color-text-primary)]">Server price{plan.atLeast ? ", at least" : ""}</span>
                  <b className="text-[18px] font-semibold tabular-nums">{planPriceText(plan, serperRate)}</b>
                </div>
                <ul className="flex flex-col gap-0.5 text-[12px] tabular-nums text-[var(--color-text-secondary)]">
                  {plan.lines.map((l) => (
                    <li key={l.stage} className="flex justify-between gap-3">
                      <span>{stageLabel(l.stage)}{l.redo ? " (redo with fresh reviews)" : ""}{l.places != null ? ` · ${count(l.places)} places` : ""}</span>
                      <span>{Number(l.usd) > 0 ? usd(l.usd) : "Free"}</span>
                    </li>
                  ))}
                </ul>
                {plan.serperRequests > 0 && <span className="text-[11px] text-[var(--color-text-tertiary)]">{serperCostText(plan.serperRequests, serperRate)}</span>}
              </>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" icon={RefreshCw} onClick={check} loading={loading}>
          {preview ? "Check again" : "See what a run would do"}
        </Button>
        <span className="text-xs text-[var(--color-text-tertiary)]">Checking is free. Nothing is spent until you start.</span>
      </div>

      {previewError && <AlertCard variant="error" title="Couldn't work out the run">{previewError}</AlertCard>}

      {preview && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-[var(--color-text-secondary)]">Searches never run or failed</dt>
            <dd className="text-right tabular-nums">{count(stages.fill?.searches)} · {usd(stages.fill?.estimatedCostUsd)}{stages.fill?.exceedsHighCost ? " (asks first)" : ""}</dd>
            <dt className="text-[var(--color-text-secondary)]">Capped searches, split level {stages.split?.nextLevel ?? "–"}</dt>
            <dd className="text-right tabular-nums">{count(stages.split?.searches)} · {usd(stages.split?.estimatedCostUsd)}{stages.split?.costIsFloor ? " at least" : ""}, asks first</dd>
            <dt className="text-[var(--color-text-secondary)]">Completeness check</dt>
            <dd className="text-right tabular-nums">{count(stages.completeness?.searches)} · {usd(stages.completeness?.estimatedCostUsd)}</dd>
            <dt className="text-[var(--color-text-secondary)]">Photos and Intelligence</dt>
            <dd className="text-right text-[var(--color-text-tertiary)]">Known once the searches finish; each asks again if it is over its limit</dd>
            <dt className="text-[var(--color-text-secondary)]">Serper</dt>
            <dd className="text-right text-[var(--color-text-tertiary)]">{serperRate == null ? "Counted by request; cost unknown until a rate is set" : `${usd(serperRate * 1000)} per 1,000 requests`}</dd>
            <dt className="text-[var(--color-text-secondary)]">Held new places</dt>
            <dd className="text-right tabular-nums">{count(preview.placeCounts?.held)}</dd>
          </dl>

          {unhealthy.length > 0 && (
            <AlertCard variant="warning" title="A provider is failing its health check">
              {unhealthy.map((u) => `${u.provider}: ${u.problem}${u.http_status ? ` (HTTP ${u.http_status})` : ""}`).join(" · ")}. The run pauses before any step that needs it.
            </AlertCard>
          )}
          {blockers.length > 0 && (
            <AlertCard variant="warning" title="Something else holds this city">
              {blockers.map((b) => `${b.kind} run ${b.status}${b.stale ? ", no activity for 30 minutes" : ""}`).join(" · ")}. A run pauses until it finishes or is cancelled.
            </AlertCard>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label="Spend limit, USD" hint="Required. The run pauses when it reaches this.">
          <input className={inputClass} aria-label="Spend limit, USD" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 50" aria-invalid={limit !== "" && !limitOk} />
        </Field>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex min-h-10 items-center gap-2">
            <input id={`whole-city-${city.city_id}`} type="checkbox" className="h-5 w-5" checked={wholeCity} onChange={(e) => setWholeCity(e.target.checked)} />
            <label htmlFor={`whole-city-${city.city_id}`}>Re-check the whole city, not just new places</label>
          </div>
          {server ? (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {server.stages.some((st) => ["box", "fill", "split"].includes(st))
                ? "Searches run because you picked them."
                : "No searching: nothing you picked needs places not found yet."}
            </p>
          ) : (
            <div className="flex min-h-10 items-center gap-2">
              <input id={`skip-search-${city.city_id}`} type="checkbox" className="h-5 w-5" checked={skipSearch} onChange={(e) => setSkipSearch(e.target.checked)} />
              <label htmlFor={`skip-search-${city.city_id}`}>Skip searching; only check, photograph and score</label>
            </div>
          )}
        </div>
      </div>

      <div>
        <Button icon={Play} disabled={!limitOk || starting || (server !== null && !plan)} loading={starting}
          onClick={() => (server ? setConfirmPlan(true) : wholeCity ? setConfirmWhole(true) : start())}>
          Start run
        </Button>
        {!limitOk && <span className="ml-3 text-xs text-[var(--color-text-tertiary)]">Set a spend limit to start.</span>}
        {limitOk && server && !plan && <span className="ml-3 text-xs text-[var(--color-text-tertiary)]">Waiting for the server's price.</span>}
      </div>

      <ConfirmModal
        open={confirmWhole}
        title={`Re-check all of ${city.city_name}?`}
        confirmLabel="Re-check the whole city"
        busy={starting}
        onConfirm={start}
        onClose={() => setConfirmWhole(false)}
      >
        <p>Every place in the city is judged again by both checks, not only new ones. Live places can leave Explorers' decks if they now fail.</p>
        <p>Spend limit: {usd(limitNumber)}.</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirmPlan && !!plan}
        title={`Run ${plan ? `${plan.stages.length} ${plan.stages.length === 1 ? "stage" : "stages"}` : "these stages"} for ${city.city_name}?`}
        confirmLabel={`Start, ${plan ? planPriceText(plan, serperRate) : ""}`}
        busy={starting}
        onConfirm={start}
        onClose={() => setConfirmPlan(false)}
      >
        <p>The server prices this run at {plan ? planPriceText(plan, serperRate) : "…"}{plan?.atLeast ? " or more: the checks can add places before photos and Intelligence, and each asks again if it goes over its limit" : ""}.</p>
        <p>It does: {plan ? plan.stages.map(stageLabel).join(", ") : ""}. Then it stops.</p>
        {judgedCount(plan) !== null && (
          <p className="font-medium text-[var(--color-text-primary)]">Re-judges {count(judgedCount(plan))} {judgedCount(plan) === 1 ? "place" : "places"} in {city.city_name} (never places held in the score backlog).</p>
        )}
        {server?.redoIntelligence && <p className="text-[var(--color-warning-700)]">Redoing Intelligence with fresh reviews changes live decks for the places it covers.</p>}
        {wholeCity && <p>Every place in the city is judged again by both checks, not only new ones.</p>}
        <p>Spend limit: {usd(limitNumber)}.</p>
      </ConfirmModal>
    </div>
  );
}

/** How many places the planned Intelligence stage takes, from the server's own count. */
function judgedCount(plan) {
  const line = plan?.lines?.find((l) => l.stage === "intelligence");
  return line && line.places != null ? Number(line.places) : null;
}

/** The server's price in words: dollars, plus Serper by request until it is priced. */
function planPriceText(plan, serperRate) {
  if (plan.totalUsd != null) return usd(plan.totalUsd);
  return `${usd(plan.knownUsd)} + Serper${serperRate == null ? ` (${count(plan.serperRequests)} requests, unpriced)` : ""}`;
}

// ── During and after a run ───────────────────────────────────────────────────

const BEAT_TONE = {
  moving: "bg-[var(--color-success-500)]",
  waiting: "bg-[var(--color-info-500)]",
  stalled: "bg-[var(--color-warning-500)]",
  stopped: "bg-[var(--gray-400)]",
  done: "bg-[var(--gray-400)]",
};

function RunStatus({ runId, serperRate, onChanged, liveRun = null, liveReady = false }) {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [newLimit, setNewLimit] = useState("");
  const [highCostOk, setHighCostOk] = useState(false);
  const [confirm, setConfirm] = useState(null); // "cancel" | "rules_only"

  const load = useCallback(async () => {
    try {
      setData(await pipeline("status", { runId }));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [runId]);

  useEffect(() => {
    // A server read; its state changes happen when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // The live read already refreshes this run every 5 s; poll here only without it.
    if (liveReady) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, liveReady]);

  // The spend ledger and held counts come from the status call: read it again when
  // the live run moves to another status or stage, not on a timer.
  const liveKey = liveRun ? `${liveRun.status}:${liveRun.current_stage ?? ""}` : null;
  const lastLiveKey = useRef(liveKey);
  useEffect(() => {
    if (liveKey === null || liveKey === lastLiveKey.current) return;
    lastLiveKey.current = liveKey;
    load();
  }, [liveKey, load]);

  // Tell the tab when the status changes, so the city row and the table refresh.
  const status = liveRun?.status ?? data?.run?.status ?? null;
  // A clock for the heartbeat's "N s ago", ticking once a second while live.
  const [now, setNow] = useState(() => Date.now());
  const isLive = liveRun !== null;
  useEffect(() => {
    if (!isLive) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isLive]);
  const lastStatus = useRef(null);
  useEffect(() => {
    if (status === null) return;
    const before = lastStatus.current;
    lastStatus.current = status;
    if (before !== null && before !== status) onChanged();
  }, [status, onChanged]);

  const act = async (action, body, done) => {
    setBusy(action);
    try {
      await pipeline(action, { runId, ...body });
      addToast({ variant: "success", title: done });
      setConfirm(null);
      setHighCostOk(false);
      await load();
      onChanged();
    } catch (err) {
      addToast({ variant: "error", title: "That didn't go through", description: err.message });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <AlertCard variant="error" title="Couldn't read the run" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{error}</AlertCard>;
  if (!data) return <div className="flex justify-center py-6"><Spinner /></div>;

  // The live run is newer than the last status read; its fields win.
  const run = liveRun ? { ...data.run, ...liveRun } : data.run;
  const word = runStatusWord(run.status);
  const beat = liveRun ? heartbeatState(run, now) : null;
  const problem = problemNote(run);
  const outcome = outcomeText(run.last_outcome);
  const approval = pendingApproval(run);
  const spend = spendSummary(data.spend);
  const active = ACTIVE_RUN_STATUSES.includes(run.status);
  const stagesById = Object.fromEntries((data.stages ?? []).map((s) => [s.stage, s]));
  if (liveRun) for (const s of liveRun.stages ?? []) stagesById[s.stage] = { ...stagesById[s.stage], ...s };
  const limitNumber = Number(newLimit);
  const newLimitOk = newLimit.trim() === "" || (Number.isFinite(limitNumber) && limitNumber > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={word.variant}>{word.label}</Badge>
        {run.current_stage && active && <span className="text-sm text-[var(--color-text-secondary)]">At: {stageLabel(run.current_stage)}</span>}
        <span className="ml-auto text-sm tabular-nums text-[var(--color-text-secondary)]">
          Spent {usd(spend.knownUsd)} of {usd(run.spend_limit_usd)} limit
        </span>
      </div>
      {run.pause_reason && active && <p className="text-sm text-[var(--color-text-primary)]">{pauseReasonText(run.pause_reason)}</p>}
      {run.pause_detail?.error && <p className="text-xs text-[var(--color-error-700)]">{errorLine(run.pause_detail.error)}</p>}
      {beat && beat.text && (
        <div className={`flex items-center gap-2 text-[12.5px] ${beat.state === "stalled" ? "font-medium text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`} role="status">
          <i aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${BEAT_TONE[beat.state]}`} />{beat.text}
        </div>
      )}
      {outcome && run.last_outcome?.at && (
        <p className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">Last wake-up {clockTime(run.last_outcome.at, { seconds: true })} · {outcome}</p>
      )}
      {problem && (
        <div className="flex flex-col gap-0.5 rounded-lg bg-[var(--color-error-50)] px-3 py-2 text-[12.5px] text-[var(--color-error-700)]">
          <b className="font-semibold">{problem.title}</b>
          {problem.message && <span className="break-words font-mono text-[11.5px]">{problem.message}</span>}
        </div>
      )}
      {run.rules_only && <p className="text-xs text-[var(--color-warning-700)]">Rules only was chosen for this run: places can go live without Intelligence.</p>}

      {approval && (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-warning-200,#fde68a)] bg-[var(--color-warning-50)] p-3">
          <b className="text-sm">{stageLabel(approval.stage)} is waiting for your OK</b>
          <ul className="list-disc pl-5 text-sm tabular-nums">
            {approvalLines(approval, serperRate).map((l) => <li key={l}>{l}</li>)}
          </ul>
          {approval.highCost && (
            <div className="flex min-h-10 items-center gap-2 text-sm">
              <input id={`high-cost-${runId}`} type="checkbox" className="h-5 w-5" checked={highCostOk} onChange={(e) => setHighCostOk(e.target.checked)} />
              <label htmlFor={`high-cost-${runId}`}>I accept this is above the high-cost limit</label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={Check} disabled={approval.highCost && !highCostOk} loading={busy === "approve"}
              onClick={() => act("approve", { key: approval.key, confirmHighCost: approval.highCost ? true : undefined }, "Approved. The run carries on.")}>
              Approve this step
            </Button>
          </div>
        </div>
      )}

      <ol className="flex flex-col divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {RUN_STAGES.map((s) => {
          const st = stagesById[s.id];
          const status = STAGE_STATUS[st?.status] ?? STAGE_STATUS.pending;
          const isCurrent = run.current_stage === s.id && active;
          const progress = stageProgress(liveStage({ stages: Object.values(stagesById) }, s.id));
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${isCurrent ? "bg-[var(--color-brand-50)]" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{s.sub}</span>
                {progress && (
                  <span className="mt-1 flex flex-col gap-1">
                    <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{progress.line}</span>
                    {progress.pct !== null && <ShareBar share={progress.pct} label={`${s.label}: ${progress.pct}%`} />}
                  </span>
                )}
              </span>
              {st?.estimate?.google_usd != null && <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">est. {usd(st.estimate.google_usd)}</span>}
              {st?.estimate?.gemini_usd != null && <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">est. {usd(st.estimate.gemini_usd)} + {serperCostText(st.estimate.serper_requests_max, serperRate)}</span>}
              <Badge variant={isCurrent && run.status === "running" ? "brand" : status.variant}>{isCurrent && run.status !== "running" ? word.label : status.label}</Badge>
            </li>
          );
        })}
      </ol>

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--color-text-secondary)]">Google</dt><dd className="text-right tabular-nums">{usd(spend.google)}</dd>
        <dt className="text-[var(--color-text-secondary)]">Gemini</dt><dd className="text-right tabular-nums">{usd(spend.gemini)}</dd>
        <dt className="text-[var(--color-text-secondary)]">Serper</dt><dd className="text-right tabular-nums">{spend.serperText}</dd>
        <dt className="text-[var(--color-text-secondary)]">Held new places</dt><dd className="text-right tabular-nums">{count(data.placeCounts?.held)} ({count(data.placeCounts?.held_passed)} passed, waiting to finish)</dd>
      </dl>

      {active && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
          {run.status === "paused" && (
            <div className="flex flex-col items-start gap-3">
              <Field label="New spend limit, USD (optional)">
                <input className={inputClass} inputMode="decimal" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder={String(run.spend_limit_usd)} aria-invalid={!newLimitOk} />
              </Field>
              <Button className="justify-self-start" icon={RotateCcw} disabled={!newLimitOk} loading={busy === "resume"}
                onClick={() => act("resume", newLimit.trim() ? { spendLimitUsd: limitNumber } : {}, "Resumed. Gates are checked again before the next step.")}>
                Resume
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(run.status === "running" || run.status === "queued") && (
              <Button variant="secondary" icon={Pause} loading={busy === "pause"} onClick={() => act("pause", {}, "Paused.")}>Pause</Button>
            )}
            {(run.status === "paused" || run.status === "awaiting_approval") && !run.rules_only && (
              <Button variant="secondary" onClick={() => setConfirm("rules_only")}>Let places go live on rules only</Button>
            )}
            <Button variant="secondary" icon={XCircle} onClick={() => setConfirm("cancel")}>Cancel run</Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirm === "cancel"}
        title="Cancel this run?"
        destructive
        confirmLabel="Cancel the run"
        busy={busy === "cancel"}
        onConfirm={() => act("cancel", {}, "Run cancelled. New places it held stay hidden.")}
        onClose={() => setConfirm(null)}
      >
        <p>Searches, photos and Intelligence it started are stopped. New places it was holding stay hidden from Explorers until a later run finishes them.</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "rules_only"}
        title="Let places go live on rules only?"
        confirmLabel="Use rules only"
        busy={busy === "rules_only"}
        onConfirm={() => act("rules_only", { confirmRulesOnly: true }, "Rules only chosen. The run carries on.")}
        onClose={() => setConfirm(null)}
      >
        <p>Places that passed the final check are released without Intelligence, scored on rules alone. Use this only when reviews or Intelligence can't run and the city can't wait.</p>
      </ConfirmModal>
    </div>
  );
}

export function CityRunPanel({ city, latestRun, serperRate, onChanged, footer = null, picks = null, liveRuns = null }) {
  const [runId, setRunId] = useState(latestRun?.id ?? null);
  const [planning, setPlanning] = useState(false);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRunId(latestRun?.id ?? null); setPlanning(false); }, [latestRun?.id, city.city_id]);

  const activeRun = latestRun && ACTIVE_RUN_STATUSES.includes(latestRun.status);
  const showPlan = !runId || (planning && !activeRun);

  return (
    <SectionCard
      title={`Run plan: ${city.city_name}`}
      subtitle="Box to final score on the server. It keeps going if you close this page."
      action={runId && !activeRun && !planning ? <Button size="sm" variant="secondary" onClick={() => setPlanning(true)}>Plan a new run</Button> : null}
    >
      {showPlan ? (
        <RunPlan city={city} serperRate={serperRate} picks={picks} onStarted={(id) => { setRunId(id); setPlanning(false); onChanged(); }} />
      ) : (
        <RunStatus runId={runId} serperRate={serperRate} onChanged={onChanged}
          liveReady={Array.isArray(liveRuns)} liveRun={Array.isArray(liveRuns) ? liveRuns.find((r) => r.id === runId) ?? null : null} />
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </SectionCard>
  );
}
