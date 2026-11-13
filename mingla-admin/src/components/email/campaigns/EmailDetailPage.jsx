// Issue #4419 — one email's page (#/email/<id>): status, its timeline, the
// banner that says what you are looking at, the email in an inbox frame,
// delivery and audience, and the actions that fit the state.
//
// While it is sending the page refreshes every 5 seconds and stops as soon as
// it leaves Sending, or when you leave the page.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { useToast } from "../../../context/ToastContext";
import { exportCsv } from "../../../lib/exportCsv";
import { communicationsErrorMessage } from "../../../lib/communicationsErrors";
import { checkLaterTime, utcToZonedInputs } from "../../../lib/scheduleTime";
import { callEdgeFunction, getCampaignDetail, sendCampaignTest } from "../../../services/adminSendEmailService";
import { EmailComposer } from "../EmailComposer";
import { EmailTimeline } from "./EmailTimeline";
import { EmailViewBanner } from "./EmailViewBanner";
import { EmailViewer } from "./EmailViewer";
import { DeliveryCard } from "./DeliveryCard";
import { ChangeTimeDialog, ConfirmCancel, EmailActionButtons, SendTestDialog } from "./EmailActions";
import { campaignAudienceLabel, duplicateDraft, exportRows, startSendingPoll, statePill, zonedTime } from "./campaignModel";

function AudienceCard({ detail }) {
  const c = detail.campaign;
  const audience = campaignAudienceLabel({ ...c, recipient_type: c.recipient_type });
  const rows = [
    ["Who", audience],
    [c.scheduled_for ? "Time zone" : "When", c.scheduled_for ? c.timezone || "UTC" : "Right away"],
    [c.state === "scheduled" ? "Scheduled by" : "Sent by", c.created_by_name || "Not recorded"],
  ];
  return (
    <section aria-label="Audience" className="rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-[18px]">
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-text-primary)]">Audience</h3>
      <div className="flex flex-col gap-2.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-[var(--color-text-tertiary)]">{k}</span>
            <b className="break-words text-right font-medium text-[var(--color-text-primary)]">{v}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function BackButton({ onBack }) {
  return <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>All emails</Button>;
}

/** What the page shows for a load state. Presentational; tests render it for every state. */
export function EmailDetailBody({ status, detail, error, isAdmin = false, busy = null, onBack, onRetry, onAction }) {
  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" data-detail-state="loading">
        <div><BackButton onBack={onBack} /></div>
        <div className="h-7 w-3/5 animate-pulse rounded bg-[var(--gray-100)] motion-reduce:animate-none" />
        <div className="h-[84px] animate-pulse rounded-2xl bg-[var(--gray-100)] motion-reduce:animate-none" />
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1080px]:grid-cols-1">
          <div className="h-[520px] animate-pulse rounded-2xl bg-[var(--gray-100)] motion-reduce:animate-none" />
          <div className="h-[320px] animate-pulse rounded-2xl bg-[var(--gray-100)] motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  if (status === "error" || status === "not_found") {
    const notFound = status === "not_found";
    return (
      <div className="flex flex-col gap-4" data-detail-state={status}>
        <div><BackButton onBack={onBack} /></div>
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-error-50)] text-[var(--color-error-700)]"><AlertTriangle className="h-5 w-5" aria-hidden="true" /></span>
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Couldn&apos;t open this email</h3>
          <p className="max-w-[44ch] text-sm text-[var(--color-text-secondary)]">
            {notFound ? "This email doesn't exist or was removed." : `${communicationsErrorMessage(error, "The connection dropped.")} Nothing was changed.`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {notFound ? null : <Button icon={RotateCcw} onClick={onRetry}>Try again</Button>}
            <Button variant="secondary" onClick={onBack}>Back to all emails</Button>
          </div>
        </div>
      </div>
    );
  }
  const c = detail.campaign;
  const pill = statePill(c.state, c.state_label);
  return (
    <div className="flex flex-col gap-4" data-detail-state={c.state}>
      <div><BackButton onBack={onBack} /></div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--color-text-tertiary)]">
            <Badge variant={pill.variant} dot>{pill.label}</Badge>
            {detail.view?.kind === "rebuilt" ? <Badge variant="outline">No exact copy</Badge> : null}
            <span>{campaignAudienceLabel(c)}</span>
          </div>
          <h2 className="break-words text-xl font-bold tracking-[-0.01em] text-[var(--color-text-primary)]">{c.subject}</h2>
        </div>
        <EmailActionButtons detail={detail} isAdmin={isAdmin} busy={busy} onAction={onAction} />
      </div>
      <EmailTimeline detail={detail} />
      <EmailViewBanner detail={detail} />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5 max-[1080px]:grid-cols-1">
        <EmailViewer detail={detail} />
        <div className="flex min-w-0 flex-col gap-4">
          <DeliveryCard detail={detail} />
          <AudienceCard detail={detail} />
        </div>
      </div>
    </div>
  );
}

/** The container: loads the email, polls while sending, runs the actions. */
export function EmailDetailPage({ campaignId, isAdmin, myEmail, providerConfigured, onBack, onDuplicate, onSessionExpired }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ status: "loading", detail: null, error: null });
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [later, setLater] = useState(null);
  const [laterError, setLaterError] = useState(null);
  const [editing, setEditing] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const failed = useCallback((title, error) => {
    if (error?.name === "SessionExpiredError") { onSessionExpired?.(); return; }
    addToast({ variant: "error", title, description: communicationsErrorMessage(error) });
  }, [addToast, onSessionExpired]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const detail = await getCampaignDetail(campaignId);
      if (mounted.current) setState({ status: "ready", detail, error: null });
      return detail;
    } catch (error) {
      if (!mounted.current) return null;
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      // A failed refresh while sending keeps what is on screen.
      if (quiet) return null;
      const notFound = /campaign_not_found/.test(String(error?.message || ""));
      setState({ status: notFound ? "not_found" : "error", detail: null, error });
      return null;
    }
  }, [campaignId, onSessionExpired]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  // Poll while sending; stop when it leaves Sending or the page closes.
  const sending = state.status === "ready" && state.detail?.campaign?.state === "sending";
  useEffect(() => {
    if (!sending) return undefined;
    return startSendingPoll({ refresh: () => load({ quiet: true }) });
  }, [sending, load]);

  const detail = state.detail;
  const c = detail?.campaign;

  async function onAction(id) {
    if (!c) return;
    if (id === "change_time") {
      setLaterError(null);
      setLater({ ...utcToZonedInputs(c.scheduled_for, c.timezone || "UTC"), zone: c.timezone || "UTC" });
      setDialog("time");
    } else if (id === "edit_words") {
      setBusy(id);
      try {
        const result = await callEdgeFunction({ action: "get_scheduled_campaign", campaignId: c.id });
        setEditing(result.campaign);
      } catch (error) { failed("Couldn't open this email", error); void load(); }
      finally { setBusy(null); }
    } else if (id === "send_test") {
      setDialog("test");
    } else if (id === "cancel") {
      setDialog("cancel");
    } else if (id === "duplicate") {
      onDuplicate?.(duplicateDraft(detail));
    } else if (id === "export") {
      exportCsv([{ key: "measure", label: "Measure" }, { key: "count", label: "Count" }], exportRows(detail), `email_${c.id.slice(0, 8)}_counts`);
    }
  }

  async function saveTime() {
    const check = checkLaterTime(later);
    setLaterError(check.ok ? null : check.message);
    if (!check.ok) return;
    setBusy("change_time");
    try {
      await callEdgeFunction({ action: "reschedule_campaign", campaignId: c.id, scheduledFor: check.at.toISOString(), timezone: later.zone });
      addToast({ variant: "success", title: "Time changed", description: `It now goes out ${zonedTime(check.at.toISOString(), later.zone)}.` });
      setDialog(null);
    } catch (error) { failed("Couldn't change the time", error); setDialog(null); }
    finally { setBusy(null); void load({ quiet: true }); }
  }

  async function doCancel() {
    setBusy("cancel");
    try {
      await callEdgeFunction({ action: "cancel_campaign", campaignId: c.id });
      addToast({ variant: "success", title: "Cancelled. It will not go out." });
    } catch (error) { failed("Couldn't cancel the email", error); }
    finally { setBusy(null); setDialog(null); void load({ quiet: true }); }
  }

  async function doTest() {
    setBusy("send_test");
    try {
      const result = await sendCampaignTest(c.id);
      addToast({ variant: "success", title: "Test sent", description: `Check ${result?.to || "your inbox"} in a minute.` });
      setDialog(null);
    } catch (error) {
      const limit = /test_send_limit/.test(String(error?.message || ""));
      failed(limit ? "That's five tests this hour" : "Couldn't send the test", limit ? { message: "Try again in an hour." } : error);
      setDialog(null);
    } finally { setBusy(null); }
  }

  if (editing) {
    return (
      <EmailComposer
        key={editing.id}
        callEdgeFunction={callEdgeFunction}
        providerConfigured={providerConfigured}
        onSessionExpired={onSessionExpired}
        editingCampaign={editing}
        onEditingDone={() => { setEditing(null); void load(); }}
      />
    );
  }

  return (
    <>
      <EmailDetailBody status={state.status} detail={detail} error={state.error} isAdmin={isAdmin} busy={busy} onBack={onBack} onRetry={() => void load()} onAction={(id) => void onAction(id)} />
      {c ? (
        <>
          <ChangeTimeDialog open={dialog === "time"} subject={c.subject} value={later} error={laterError} busy={busy === "change_time"} onChange={setLater} onSave={() => void saveTime()} onClose={() => setDialog(null)} />
          <SendTestDialog open={dialog === "test"} exact={detail.view?.kind === "exact"} email={myEmail} busy={busy === "send_test"} onSend={() => void doTest()} onClose={() => setDialog(null)} />
          <ConfirmCancel target={dialog === "cancel" ? { id: c.id, title: c.subject } : null} kindLabel="email" busy={busy === "cancel"} onConfirm={() => void doCancel()} onClose={() => setDialog(null)} />
        </>
      ) : null}
    </>
  );
}
