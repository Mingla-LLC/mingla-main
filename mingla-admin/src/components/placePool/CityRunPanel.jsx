// Issue #4276 U1: one city's pipeline run, from plan to finish, driven by the server.
//
// Before a run: what it would do and cost, what stands in its way, a spend limit
// (always required) and the scope (new places only unless a person chooses the whole
// city). During a run: every stage, what it is waiting for, spend so far, and the
// controls the conductor offers (approve, pause, resume, cancel, rules only). Closing
// the browser changes nothing: the run carries on server-side.
//
// Serper's cost is shown as unknown until a rate is set; nothing here invents it.

import { useCallback, useEffect, useState } from "react";
import { Play, Pause, RotateCcw, XCircle, Check, RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import { pipeline } from "../../services/cityPipelineService";
import {
  ACTIVE_RUN_STATUSES,
  RUN_STAGES,
  approvalLines,
  count,
  pauseReasonText,
  pendingApproval,
  runStatusWord,
  serperCostText,
  spendSummary,
  stageLabel,
  usd,
} from "../../lib/cityPipeline";

const POLL_MS = 15_000;

const STAGE_STATUS = {
  pending: { label: "Waiting", variant: "default" },
  running: { label: "Running", variant: "brand" },
  complete: { label: "Done", variant: "success" },
  skipped: { label: "Skipped", variant: "outline" },
};

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
      {label}
      {children}
      {hint && <span className="font-normal text-[var(--color-text-tertiary)]">{hint}</span>}
    </label>
  );
}

const inputClass =
  "h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] tabular-nums";

function ConfirmModal({ open, title, children, confirmLabel, destructive, busy, onConfirm, onClose }) {
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

function RunPlan({ city, serperRate, onStarted }) {
  const { addToast } = useToast();
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("");
  const [wholeCity, setWholeCity] = useState(false);
  const [skipSearch, setSkipSearch] = useState(false);
  const [confirmWhole, setConfirmWhole] = useState(false);
  const [starting, setStarting] = useState(false);

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
        skipSearch,
      });
      addToast({ variant: "success", title: `Run started for ${city.city_name}`, description: "It carries on if you close this page." });
      setConfirmWhole(false);
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Spend limit, USD" hint="Required. The run pauses when it reaches this.">
          <input className={inputClass} aria-label="Spend limit, USD" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 50" aria-invalid={limit !== "" && !limitOk} />
        </Field>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex min-h-10 items-center gap-2">
            <input id={`whole-city-${city.city_id}`} type="checkbox" className="h-5 w-5" checked={wholeCity} onChange={(e) => setWholeCity(e.target.checked)} />
            <label htmlFor={`whole-city-${city.city_id}`}>Re-check the whole city, not just new places</label>
          </div>
          <div className="flex min-h-10 items-center gap-2">
            <input id={`skip-search-${city.city_id}`} type="checkbox" className="h-5 w-5" checked={skipSearch} onChange={(e) => setSkipSearch(e.target.checked)} />
            <label htmlFor={`skip-search-${city.city_id}`}>Skip searching; only check, photograph and score</label>
          </div>
        </div>
      </div>

      <div>
        <Button icon={Play} disabled={!limitOk || starting} loading={starting}
          onClick={() => (wholeCity ? setConfirmWhole(true) : start())}>
          Start run
        </Button>
        {!limitOk && <span className="ml-3 text-xs text-[var(--color-text-tertiary)]">Set a spend limit to start.</span>}
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
    </div>
  );
}

// ── During and after a run ───────────────────────────────────────────────────

function RunStatus({ runId, serperRate, onChanged }) {
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
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

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

  const run = data.run;
  const word = runStatusWord(run.status);
  const approval = pendingApproval(run);
  const spend = spendSummary(data.spend);
  const active = ACTIVE_RUN_STATUSES.includes(run.status);
  const stagesById = Object.fromEntries((data.stages ?? []).map((s) => [s.stage, s]));
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
      {run.pause_detail?.error && <p className="text-xs text-[var(--color-error-700)]">{run.pause_detail.error}</p>}
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
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${isCurrent ? "bg-[var(--color-brand-50)]" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{s.sub}</span>
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
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,220px)_auto]">
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

export function CityRunPanel({ city, latestRun, serperRate, onChanged }) {
  const [runId, setRunId] = useState(latestRun?.id ?? null);
  const [planning, setPlanning] = useState(false);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRunId(latestRun?.id ?? null); setPlanning(false); }, [latestRun?.id, city.city_id]);

  const activeRun = latestRun && ACTIVE_RUN_STATUSES.includes(latestRun.status);
  const showPlan = !runId || (planning && !activeRun);

  return (
    <SectionCard
      title={`Run ${city.city_name}`}
      subtitle="Box to final score on the server. It keeps going if you close this page."
      action={runId && !activeRun && !planning ? <Button size="sm" variant="secondary" onClick={() => setPlanning(true)}>Plan a new run</Button> : null}
    >
      {showPlan ? (
        <RunPlan city={city} serperRate={serperRate} onStarted={(id) => { setRunId(id); setPlanning(false); onChanged(); }} />
      ) : (
        <RunStatus runId={runId} serperRate={serperRate} onChanged={onChanged} />
      )}
    </SectionCard>
  );
}
