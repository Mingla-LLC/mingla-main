// #4383 — Communications › Push: a push and a bell item to hosts, explorers
// or both, now or at a time you pick. Full admins only (lib/access.js
// default, the same as announcements). Hosts get it in the Host app
// (business.mingla_update), explorers in the Explorer app
// (explorer.mingla_update); the server fans it out at 12 a minute so order and
// payout pushes are never held up. A push only opens a screen in the
// destination table (supabase/functions/_shared/adminPushDestinations.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, RefreshCw, Send, X } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { SectionCard } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Input, Textarea } from "../../components/ui/Input";
import { Modal, ModalBody, ModalFooter } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { LoadError } from "../../components/ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { LaterInputs, SELECT_CLASS, WhenSegment } from "../../components/communications/SchedulePicker";
import { ScheduleTime } from "../../components/communications/ScheduleTime";
import { ConfirmCancel } from "../../components/communications/ConfirmCancel";
import {
  DEFAULT_EXPLORER_DESTINATION,
  DEFAULT_HOST_DESTINATION,
  EXPLORER_DESTINATIONS,
  HOST_DESTINATIONS,
  PUSH_AUDIENCES,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  audienceApps,
  audienceLabel,
  opensLabel,
  pushReach,
  sendsToExplorers,
  sendsToHosts,
} from "../../lib/pushDestinations";
import { browserTimeZone, checkLaterTime, formatInZone, utcToZonedInputs } from "../../lib/scheduleTime";
import { communicationsErrorMessage } from "../../lib/communicationsErrors";
import { pushDelivery } from "../../lib/announcementDelivery";
import {
  cancelPush,
  getPushAudienceCounts,
  listPushes,
  retryPushDelivery,
  savePush,
  sendPushNow,
  sendPushTestToMe,
} from "../../services/communicationsService";

const blankForm = () => ({
  id: null,
  revision: null,
  title: "",
  body: "",
  audience: "hosts",
  explorerTarget: DEFAULT_EXPLORER_DESTINATION,
  hostTarget: DEFAULT_HOST_DESTINATION,
  when: "now",
  later: { date: "", time: "", zone: browserTimeZone() },
});

const STATUS = {
  draft: ["Draft", "default"],
  scheduled: ["Scheduled", "info"],
  sending: ["Sending", "warning"],
  sent: ["Sent", "success"],
  failed: ["Failed", "error"],
  cancelled: ["Cancelled", "default"],
};

function PhonePreview({ app, title, body, when }) {
  return (
    <div className="rounded-2xl bg-[var(--gray-100)] p-3">
      <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
        <span>{app === "host" ? "Mingla Business" : "Mingla"}</span>
        <span>{when}</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-[var(--color-text-primary)] break-words">{title || "Your title"}</p>
      <p className="text-[12.5px] text-[var(--color-text-secondary)] break-words">{body || "Your message"}</p>
    </div>
  );
}

export function PushPage() {
  const { addToast } = useToast();
  const [form, setForm] = useState(blankForm);
  const [counts, setCounts] = useState({ state: "loading", data: null, error: null });
  const [list, setList] = useState({ state: "loading", rows: [], error: null });
  const [busy, setBusy] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [laterError, setLaterError] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const loadCounts = useCallback(async () => {
    setCounts((c) => ({ ...c, state: "loading", error: null }));
    try { setCounts({ state: "ready", data: await getPushAudienceCounts(), error: null }); }
    catch (error) { setCounts({ state: "error", data: null, error }); }
  }, []);
  const loadList = useCallback(async () => {
    setList((l) => ({ ...l, state: "loading", error: null }));
    try { setList({ state: "ready", rows: await listPushes(), error: null }); }
    catch (error) { setList({ state: "error", rows: [], error }); }
  }, []);
  useEffect(() => { queueMicrotask(() => { void loadCounts(); void loadList(); }); }, [loadCounts, loadList]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const reach = useMemo(() => pushReach(form.audience, counts.data), [form.audience, counts.data]);
  const scheduled = list.rows.filter((r) => r.status === "scheduled" || r.status === "draft" || r.status === "sending");
  const sent = list.rows.filter((r) => ["sent", "failed", "cancelled"].includes(r.status));
  const editing = Boolean(form.id);

  function payload(scheduledFor) {
    return {
      id: form.id,
      revision: form.revision,
      title: form.title.trim(),
      body: form.body.trim(),
      audience: form.audience,
      explorerTarget: form.explorerTarget,
      hostTarget: form.hostTarget,
      scheduledFor,
      timezone: form.when === "later" ? form.later.zone : browserTimeZone(),
    };
  }

  // Keep the saved row's id and revision so the next save edits it.
  function remember(row) {
    if (row?.id) setForm((f) => ({ ...f, id: row.id, revision: row.revision }));
    return row;
  }

  async function sendTest() {
    if (!form.title.trim() || !form.body.trim()) { addToast({ variant: "error", title: "Add a title and a message first." }); return; }
    setBusy("test");
    try {
      // A test needs a saved push. A scheduled one keeps its time.
      const keep = form.when === "later" ? checkLaterTime(form.later) : null;
      const row = remember(await savePush(payload(keep?.ok ? keep.at.toISOString() : null)));
      const result = await sendPushTestToMe(row.id);
      addToast({ variant: "success", title: "Test sent to you only", description: `${result?.queued ?? 0} test push${result?.queued === 1 ? "" : "es"} queued for your own phone.` });
      void loadList();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't send the test", description: communicationsErrorMessage(error) });
    } finally { setBusy(null); }
  }

  function review() {
    if (!form.title.trim() || !form.body.trim()) { addToast({ variant: "error", title: "Add a title and a message first." }); return; }
    if (form.when === "later") {
      const check = checkLaterTime(form.later);
      setLaterError(check.ok ? null : check.message);
      if (!check.ok) return;
      setReviewing({ at: check.at });
      return;
    }
    setLaterError(null);
    setReviewing({ at: null });
  }

  async function confirm() {
    if (!reviewing) return;
    setBusy("confirm");
    try {
      if (reviewing.at) {
        // Checked again at the moment of saving, in the chosen timezone.
        const check = checkLaterTime(form.later);
        if (!check.ok) { setLaterError(check.message); setReviewing(null); return; }
        await savePush(payload(check.at.toISOString()));
        addToast({ variant: "success", title: editing ? "Push updated" : "Push scheduled", description: `${formatInZone(check.at.toISOString(), form.later.zone)} ${form.later.zone}. It is listed under Scheduled and on Overview.` });
      } else {
        const row = remember(await savePush(payload(null)));
        const result = await sendPushNow(row.id, row.revision);
        addToast({ variant: "success", title: "Sending now", description: `${result?.audience_count ?? 0} pushes queued; everyone is reached in about ${reach.minutes} minute${reach.minutes === 1 ? "" : "s"}.` });
      }
      setReviewing(null);
      setForm(blankForm());
      setLaterError(null);
      void loadList();
    } catch (error) {
      addToast({ variant: "error", title: reviewing.at ? "Couldn't schedule the push" : "Couldn't send the push", description: communicationsErrorMessage(error) });
      setReviewing(null);
      void loadList();
    } finally { setBusy(null); }
  }

  function edit(row) {
    const later = row.scheduled_for ? { ...utcToZonedInputs(row.scheduled_for, row.timezone), zone: row.timezone } : { date: "", time: "", zone: browserTimeZone() };
    setForm({
      id: row.id, revision: row.revision, title: row.title, body: row.body, audience: row.audience,
      explorerTarget: row.explorer_target, hostTarget: row.host_target,
      when: row.status === "scheduled" ? "later" : "now", later,
    });
    setLaterError(null);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
    addToast({ variant: "info", title: "Loaded into the composer", description: "Review to save the change." });
  }

  async function doCancel() {
    if (!cancelling) return;
    setBusy(`cancel:${cancelling.id}`);
    try {
      await cancelPush(cancelling.id);
      addToast({ variant: "success", title: "Cancelled. It will not go out." });
      if (form.id === cancelling.id) setForm(blankForm());
      setCancelling(null);
      void loadList();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't cancel the push", description: communicationsErrorMessage(error) });
      setCancelling(null);
      void loadList();
    } finally { setBusy(null); }
  }

  async function retry(row) {
    setBusy(`retry:${row.id}`);
    try {
      const n = await retryPushDelivery(row.campaign_id);
      addToast({ variant: "success", title: "Retrying the failed pushes now", description: `${n} failed push${n === 1 ? "" : "es"} will go again.` });
      void loadList();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't retry", description: communicationsErrorMessage(error) });
    } finally { setBusy(null); }
  }

  const nowLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  const previewWhen = form.when === "later" && form.later.time ? form.later.time : nowLabel;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Push"
        description="Send a push and a bell item to hosts, explorers or both, now or at a time you pick."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SectionCard title={editing ? "Edit push" : "New push"} subtitle="Each person also gets it in their in-app bell."
          action={editing ? <Button size="sm" variant="ghost" icon={X} onClick={() => { setForm(blankForm()); setLaterError(null); }}>Start over</Button> : null}>
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-[var(--color-text-primary)]">Who gets it</p>
              {counts.state === "error" ? (
                <LoadError title="Couldn't count who gets it" message={communicationsErrorMessage(counts.error)} onRetry={() => void loadCounts()} />
              ) : (
                <div role="group" aria-label="Who gets it" className="grid gap-2 sm:grid-cols-3">
                  {PUSH_AUDIENCES.map((a) => {
                    const n = counts.data ? pushReach(a.value, counts.data).people : null;
                    return (
                      <button key={a.value} type="button" aria-pressed={form.audience === a.value} onClick={() => set({ audience: a.value })}
                        aria-label={`${a.label}${n === null ? "" : `, ${n} people`}, ${a.value === "both" ? "hosts get both apps" : a.app}`}
                        className={`rounded-lg border p-3 text-left transition-colors ${form.audience === a.value ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--gray-300)] hover:bg-[var(--gray-50)]"}`}>
                        <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{a.label}</span>
                        <span className="block text-xs text-[var(--color-text-secondary)]">
                          {counts.state === "loading" ? "Counting…" : `${n} people`} · {a.value === "both" ? "hosts get both apps" : a.app}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Input label="Title" value={form.title} maxLength={PUSH_TITLE_MAX} onChange={(e) => set({ title: e.target.value })} helper={`${form.title.length}/${PUSH_TITLE_MAX}`} />
            <Textarea label="Message" value={form.body} maxLength={PUSH_BODY_MAX} rows={3} onChange={(e) => set({ body: e.target.value })} helper={`${form.body.length}/${PUSH_BODY_MAX}`} />
            <div className="grid gap-3 sm:grid-cols-2">
              {sendsToExplorers(form.audience) ? (
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                  Opens in the Explorer app
                  <select className={`${SELECT_CLASS} mt-1.5`} value={form.explorerTarget} onChange={(e) => set({ explorerTarget: e.target.value })}>
                    {EXPLORER_DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
              ) : null}
              {sendsToHosts(form.audience) ? (
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                  Opens in the Host app
                  <select className={`${SELECT_CLASS} mt-1.5`} value={form.hostTarget} onChange={(e) => set({ hostTarget: e.target.value })}>
                    {HOST_DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">When</p>
              <WhenSegment value={form.when} onChange={(when) => { set({ when }); setLaterError(null); }} nowLabel="Send now" laterLabel="Schedule" />
              {form.when === "later" ? (
                <LaterInputs value={form.later} onChange={(later) => set({ later })} error={laterError}
                  hint="Pushes due in someone's quiet hours wait until the quiet hours end. Typed text is not translated." />
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" loading={busy === "test"} disabled={Boolean(busy)} onClick={() => void sendTest()}>Send test to me</Button>
              <Button icon={Send} disabled={Boolean(busy) || counts.state !== "ready"} onClick={review}>
                {form.when === "now" ? "Review and send" : "Review and schedule"}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Lock-screen preview" subtitle={counts.data ? `${reach.people} people` : " "}>
          <div className="space-y-3">
            {sendsToExplorers(form.audience) ? <PhonePreview app="explorer" title={form.title} body={form.body} when={previewWhen} /> : null}
            {sendsToHosts(form.audience) ? <PhonePreview app="host" title={form.title} body={form.body} when={previewWhen} /> : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Scheduled" subtitle="Edit or cancel until it starts sending." action={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void loadList()}>Refresh</Button>}>
        {list.state === "loading" ? <div className="flex justify-center py-8"><Spinner /></div>
          : list.state === "error" ? <LoadError title="Couldn't load scheduled pushes" message={communicationsErrorMessage(list.error)} onRetry={() => void loadList()} />
          : scheduled.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">Nothing scheduled. Pick Schedule above to send one later.</p>
          : <ul className="divide-y divide-[var(--gray-100)]">{scheduled.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-3 py-3">
              <Badge variant={STATUS[row.status]?.[1] || "default"}>{STATUS[row.status]?.[0] || row.status}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">{row.title}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{audienceLabel(row.audience)} · {opensLabel(row)}{row.created_by_name ? ` · by ${row.created_by_name}` : ""}</p>
              </div>
              {row.scheduled_for ? <ScheduleTime at={row.scheduled_for} zone={row.timezone} /> : null}
              <div className="flex gap-2">
                {row.status === "draft" || row.status === "scheduled" ? <Button size="sm" variant="secondary" icon={Pencil} disabled={Boolean(busy)} onClick={() => edit(row)}>Edit</Button> : null}
                {row.status === "scheduled" ? <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setCancelling(row)}>Cancel</Button> : null}
              </div>
            </li>))}</ul>}
      </SectionCard>

      <SectionCard title="Sent" subtitle="Bell items always land; push depends on the phone.">
        {list.state === "loading" ? <div className="flex justify-center py-8"><Spinner /></div>
          : list.state === "error" ? <LoadError title="Couldn't load sent pushes" message={communicationsErrorMessage(list.error)} onRetry={() => void loadList()} />
          : sent.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">No pushes sent yet.</p>
          : <ul className="divide-y divide-[var(--gray-100)]">{sent.map((row) => {
            const channels = row.delivery?.channels || {};
            const failed = pushDelivery(row).failed;
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-3 py-3">
                <Badge variant={row.status === "sent" && failed ? "error" : STATUS[row.status]?.[1] || "default"}>{row.status === "sent" && failed ? "Some failed" : STATUS[row.status]?.[0] || row.status}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">{row.title}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {audienceLabel(row.audience)}
                    {row.status === "sent" ? ` · bell ${channels.inapp_delivered ?? 0} · push accepted ${channels.push_accepted ?? 0} · push failed ${channels.push_failed ?? 0}${row.delivery?.state === "queued" || row.delivery?.state === "processing" ? " · still sending" : ""}` : ""}
                    {row.status === "failed" && row.last_error ? ` · ${row.last_error}` : ""}
                  </p>
                </div>
                <ScheduleTime at={row.fired_at || row.cancelled_at || row.updated_at} zone={row.timezone} />
                {failed && row.campaign_id ? <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy === `retry:${row.id}`} disabled={Boolean(busy)} onClick={() => void retry(row)}>Retry failed</Button> : null}
              </li>
            );
          })}</ul>}
      </SectionCard>

      <Modal open={Boolean(reviewing)} onClose={() => (busy ? null : setReviewing(null))} title={reviewing?.at ? "Schedule this push?" : "Send this push now?"}>
        <ModalBody>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-[var(--color-text-tertiary)]">To</dt><dd className="text-[var(--color-text-primary)]">{audienceLabel(form.audience)} · {reach.people} people</dd>
            <dt className="text-[var(--color-text-tertiary)]">Apps</dt><dd className="text-[var(--color-text-primary)]">{audienceApps(form.audience)}</dd>
            <dt className="text-[var(--color-text-tertiary)]">Opens</dt><dd className="text-[var(--color-text-primary)]">{opensLabel({ audience: form.audience, explorer_target: form.explorerTarget, host_target: form.hostTarget })}</dd>
            <dt className="text-[var(--color-text-tertiary)]">When</dt><dd className="text-[var(--color-text-primary)]">{reviewing?.at ? `${formatInZone(reviewing.at.toISOString(), form.later.zone)} · ${form.later.zone}` : `Now (about ${reach.minutes} minute${reach.minutes === 1 ? "" : "s"} to reach everyone)`}</dd>
            <dt className="text-[var(--color-text-tertiary)]">Title</dt><dd className="text-[var(--color-text-primary)] break-words">{form.title.trim()}</dd>
          </dl>
          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Everyone also gets it in their bell.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" disabled={busy === "confirm"} onClick={() => setReviewing(null)}>Back</Button>
          <Button loading={busy === "confirm"} onClick={() => void confirm()}>{reviewing?.at ? "Schedule" : `Send to ${reach.people} people`}</Button>
        </ModalFooter>
      </Modal>

      <ConfirmCancel target={cancelling} kindLabel="push" busy={busy === `cancel:${cancelling?.id}`} onConfirm={() => void doCancel()} onClose={() => setCancelling(null)} />
    </div>
  );
}
