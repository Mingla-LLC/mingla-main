// #4383 — Communications › Overview: everything scheduled to go out to hosts
// and explorers, soonest first, and anything that failed or ran late. It
// opens for whoever can open any Communications screen (lib/access.js
// PAGE_ACCESS_UNION.communications); the server lists only the kinds that
// person may open (issue_4383_scheduled_communications), and Needs attention
// is for full admins (issue_4383_communications_failures). It only reads:
// each item's time lives on its own row (I-4383-SCHEDULE-ONE-OWNER).
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { SectionCard, StatCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { LoadError } from "../../components/ui/LoadError";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { canOpenPage } from "../../lib/access";
import { ScheduleTime } from "../../components/communications/ScheduleTime";
import { ConfirmCancel } from "../../components/communications/ConfirmCancel";
import { COMMUNICATIONS_KINDS, attentionWords, cancelKindLabel } from "../../lib/communications";
import { communicationsErrorMessage } from "../../lib/communicationsErrors";
import {
  cancelPush,
  cancelRoadmapNotice,
  listCommunicationsFailures,
  listScheduledCommunications,
  retryPushDelivery,
  unscheduleAnnouncement,
  unscheduleRoadmapCard,
} from "../../services/communicationsService";
import { callEdgeFunction } from "../../services/adminSendEmailService";

// How each kind is called off from here (the same call its own screen uses).
const CANCEL = {
  push: (item) => cancelPush(item.id),
  announcement: (item) => unscheduleAnnouncement(item.id),
  roadmap_card: (item) => unscheduleRoadmapCard(item.id),
  roadmap_notice: (item) => cancelRoadmapNotice(item.id),
  email: (item) => callEdgeFunction({ action: "cancel_campaign", campaignId: item.id }),
};

export function CommunicationsOverviewPage() {
  const { access } = useAuth();
  const { addToast } = useToast();
  const isAdmin = canOpenPage(access, "push");
  const [coming, setComing] = useState({ state: "loading", rows: [], error: null });
  const [attention, setAttention] = useState({ state: isAdmin ? "loading" : "hidden", rows: [], error: null });
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(null);

  const loadComing = useCallback(async () => {
    setComing((c) => ({ ...c, state: "loading", error: null }));
    try { setComing({ state: "ready", rows: await listScheduledCommunications(), error: null }); }
    catch (error) { setComing({ state: "error", rows: [], error }); }
  }, []);
  const loadAttention = useCallback(async () => {
    if (!isAdmin) return;
    setAttention((a) => ({ ...a, state: "loading", error: null }));
    try { setAttention({ state: "ready", rows: await listCommunicationsFailures(), error: null }); }
    catch (error) { setAttention({ state: "error", rows: [], error }); }
  }, [isAdmin]);
  useEffect(() => { queueMicrotask(() => { void loadComing(); void loadAttention(); }); }, [loadComing, loadAttention]);

  const counts = useMemo(() => ({
    scheduled: coming.rows.length,
    attention: attention.rows.length,
  }), [coming.rows, attention.rows]);

  async function doCancel() {
    const item = cancelling;
    const run = item && CANCEL[item.kind];
    if (!run) return;
    setBusy(`cancel:${item.id}`);
    try {
      await run(item);
      addToast({ variant: "success", title: "Cancelled. It will not go out." });
      setCancelling(null);
      void loadComing();
      void loadAttention();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't cancel", description: communicationsErrorMessage(error) });
      setCancelling(null);
      void loadComing();
    } finally { setBusy(null); }
  }

  async function retry(item) {
    setBusy(`retry:${item.id}`);
    try {
      const n = await retryPushDelivery(item.campaign_id);
      addToast({ variant: "success", title: "Retrying the failed pushes now", description: `${n} failed push${n === 1 ? "" : "es"} will go again.` });
      void loadAttention();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't retry", description: communicationsErrorMessage(error) });
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Everything scheduled to go out to hosts and explorers, soonest first."
        actions={
          <>
            {isAdmin ? <Button onClick={() => { window.location.hash = "#/push"; }}>New push</Button> : null}
            {canOpenPage(access, "email") ? <Button variant="secondary" onClick={() => { window.location.hash = "#/email"; }}>Write email</Button> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Scheduled" value={coming.state === "ready" ? counts.scheduled : "–"} />
        {isAdmin ? <StatCard label="Need attention" value={attention.state === "ready" ? counts.attention : "–"} /> : null}
      </div>

      {isAdmin ? (
        <SectionCard title="Needs attention" subtitle="Failed or late items. Late means the time passed and it has not gone out."
          action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void loadAttention()}>Refresh</Button>}>
          {attention.state === "loading" ? <div className="flex justify-center py-6"><Spinner /></div>
            : attention.state === "error" ? <LoadError title="Couldn't load what needs attention" message={communicationsErrorMessage(attention.error)} onRetry={() => void loadAttention()} />
            : attention.rows.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing needs attention. Everything due has gone out.</p>
            : <ul className="divide-y divide-[var(--gray-100)]">{attention.rows.map((item) => (
              <li key={`${item.kind}:${item.id}:${item.problem}`} className="flex flex-wrap items-start gap-3 py-3">
                <Badge variant={item.problem === "late" ? "warning" : "error"}>{item.problem === "late" ? "Late" : item.problem === "push_failed" ? "Push failed" : "Failed"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">{item.title}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">{COMMUNICATIONS_KINDS[item.kind]?.label || item.kind} · {attentionWords(item)}</p>
                </div>
                {item.at ? <ScheduleTime at={item.at} zone={item.timezone || "UTC"} /> : null}
                <div className="flex gap-2">
                  {item.problem === "push_failed" && item.campaign_id ? (
                    <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === `retry:${item.id}`} disabled={Boolean(busy)} onClick={() => void retry(item)}>Retry failed</Button>
                  ) : null}
                  <a href={item.href} className="inline-flex h-8 items-center rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]">Open</a>
                </div>
              </li>))}</ul>}
        </SectionCard>
      ) : null}

      <SectionCard title="Coming up" subtitle="Times show in the timezone each item was scheduled in."
        action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void loadComing()}>Refresh</Button>}>
        {coming.state === "loading" ? <div className="flex justify-center py-8"><Spinner /></div>
          : coming.state === "error" ? <LoadError title="Couldn't load what is scheduled" message={communicationsErrorMessage(coming.error)} onRetry={() => void loadComing()} />
          : coming.rows.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing scheduled. Push, announcements, roadmap notices, emails and blog posts you schedule show here.</p>
          : <ul className="divide-y divide-[var(--gray-100)]">{coming.rows.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-start gap-3 py-3">
              <Badge variant={COMMUNICATIONS_KINDS[item.kind]?.tone || "default"}>{COMMUNICATIONS_KINDS[item.kind]?.label || item.kind}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">{item.title}</p>
                {item.by ? <p className="text-xs text-[var(--color-text-secondary)]">by {item.by}</p> : null}
              </div>
              <ScheduleTime at={item.scheduled_for} zone={item.timezone} />
              <div className="flex gap-2">
                <a href={item.href} className="inline-flex h-8 items-center rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]">Open</a>
                {item.can_cancel && CANCEL[item.kind] ? (
                  <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setCancelling(item)}>Cancel</Button>
                ) : item.kind === "email" ? <span className="self-center text-xs text-[var(--color-text-tertiary)]">Sending</span> : null}
              </div>
            </li>))}</ul>}
      </SectionCard>

      <ConfirmCancel target={cancelling} kindLabel={cancelKindLabel(cancelling?.kind)} busy={busy === `cancel:${cancelling?.id}`} onConfirm={() => void doCancel()} onClose={() => setCancelling(null)} />
    </div>
  );
}
