import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, RefreshCw, Send } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Input, Textarea } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { formatDateTime } from "../../lib/formatters";
import { pushDelivery } from "../../lib/announcementDelivery";
import { archiveAnnouncement, listAnnouncementDeliveries, listRoadmapCards, publishAnnouncement, retryAnnouncementDelivery, upsertAnnouncement } from "../../services/communityService";
// #4383: Publish now or Schedule; a scheduled announcement stays hidden from
// hosts until its time, then publishes once through the same path.
import { scheduleAnnouncement, unscheduleAnnouncement } from "../../services/communicationsService";
import { LaterInputs, WhenSegment } from "../communications/SchedulePicker";
import { browserTimeZone, checkLaterTime, scheduleLabel, utcToZonedInputs } from "../../lib/scheduleTime";
import { communicationsErrorMessage } from "../../lib/communicationsErrors";

const STATUS_BADGE = { draft: "default", scheduled: "info", published: "success", archived: "warning" };
const blankLater = () => ({ date: "", time: "", zone: browserTimeZone() });
const blankEditor = () => ({ id: null, status: "draft", title: "", bodyMd: "", actionLine: "", roadmapCardId: "", when: "now", later: blankLater() });
const editorFor = (row) => ({
  id: row.id, status: row.status, title: row.title, bodyMd: row.body_md || "", actionLine: row.action_line || "", roadmapCardId: row.roadmap_card_id || "",
  when: row.status === "scheduled" ? "later" : "now",
  later: row.status === "scheduled" && row.scheduled_at
    ? { ...utcToZonedInputs(row.scheduled_at, row.scheduled_timezone || "UTC"), zone: row.scheduled_timezone || "UTC" }
    : blankLater(),
});

function whenWords(row) {
  if (row.status === "scheduled" && row.scheduled_at) {
    const label = scheduleLabel(row.scheduled_at, row.scheduled_timezone || "UTC");
    return `Publishes by itself ${label.primary} ${label.zone}${label.viewer ? ` (${label.viewer})` : ""}`;
  }
  if (row.published_at) return `Sent ${formatDateTime(row.published_at)}`;
  return `Updated ${formatDateTime(row.updated_at)}`;
}

export function AnnouncementsPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [roadmapCards, setRoadmapCards] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [laterError, setLaterError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [announcements, roadmap] = await Promise.all([listAnnouncementDeliveries(), listRoadmapCards()]);
      setRows(announcements);
      setRoadmapCards(roadmap.filter((card) => card.status === "published"));
      setLoadError(null);
    }
    catch (error) { setLoadError(error); addToast({ variant: "error", title: "Could not load announcements", description: error?.message }); }
    finally { setLoading(false); }
  }, [addToast]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // #4383: the Announcements screen's header button opens the editor.
  useEffect(() => {
    const open = () => setEditor(blankEditor());
    window.addEventListener("community:new-announcement", open);
    return () => window.removeEventListener("community:new-announcement", open);
  }, []);

  // mode: "draft" saves only; "now" saves then publishes; "later" saves then
  // schedules (the time checked in its timezone here and again on the server).
  async function saveEditor(mode = "draft") {
    if (!editor) return;
    const title = editor.title.trim(); const bodyMd = editor.bodyMd.trim();
    if (!title || !bodyMd) { addToast({ variant: "error", title: "Title and body are required" }); return; }
    let at = null;
    if (mode === "later") {
      const check = checkLaterTime(editor.later);
      setLaterError(check.ok ? null : check.message);
      if (!check.ok) return;
      at = check.at;
    }
    setBusyId(editor.id || "new");
    try {
      const id = await upsertAnnouncement({ id: editor.id, title, bodyMd, actionLine: editor.actionLine.trim() || null, roadmapCardId: editor.roadmapCardId || null });
      const savedId = editor.id || id;
      if (mode === "now") {
        const result = await publishAnnouncement(savedId);
        addToast({ variant: "success", title: result?.duplicate ? "Already published" : "Published and queued", description: `${result?.audience_count ?? 0} Host users in this delivery.` });
      } else if (mode === "later") {
        await scheduleAnnouncement(savedId, at.toISOString(), editor.later.zone);
        const label = scheduleLabel(at.toISOString(), editor.later.zone);
        addToast({ variant: "success", title: "Announcement scheduled", description: `${label.primary} ${label.zone}. Hosts see it only once it publishes.` });
      } else {
        addToast({ variant: "success", title: editor.status === "scheduled" ? "Changes saved; the time is unchanged" : "Draft saved" });
      }
      setEditor(null); setLaterError(null); await load();
    }
    catch (error) { addToast({ variant: "error", title: mode === "later" ? "Couldn't schedule" : mode === "now" ? "Publish failed" : "Save failed", description: communicationsErrorMessage(error) }); await load(); }
    finally { setBusyId(null); }
  }
  async function onUnschedule(row) {
    setBusyId(row.id);
    try { await unscheduleAnnouncement(row.id); addToast({ variant: "success", title: "Back to draft. Hosts will not see it." }); await load(); }
    catch (error) { addToast({ variant: "error", title: "Couldn't unschedule", description: communicationsErrorMessage(error) }); await load(); }
    finally { setBusyId(null); }
  }
  async function onPublish(id) {
    setBusyId(id);
    try { const result = await publishAnnouncement(id); addToast({ variant: "success", title: result?.duplicate ? "Already published" : "Published and queued", description: `${result?.audience_count ?? 0} Host users in this delivery.` }); await load(); }
    catch (error) { addToast({ variant: "error", title: "Publish failed", description: error?.message }); }
    finally { setBusyId(null); }
  }
  async function onArchive(id) {
    setBusyId(id);
    try { await archiveAnnouncement(id); await load(); }
    catch (error) { addToast({ variant: "error", title: "Archive failed", description: error?.message }); }
    finally { setBusyId(null); }
  }
  async function retry(row) {
    const campaignId = row.delivery?.campaign_id;
    if (!campaignId) return;
    setBusyId(row.id);
    try { const count = await retryAnnouncementDelivery(campaignId); addToast({ variant: "success", title: "Retry queued", description: `${count} failed recipient event${count === 1 ? "" : "s"} will resume.` }); await load(); }
    catch (error) { addToast({ variant: "error", title: "Retry failed", description: error?.message }); }
    finally { setBusyId(null); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[var(--color-text-secondary)]">Host notices use in-app, push and eligible email delivery.</p><div className="flex gap-2"><Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()}>Refresh</Button></div></div>
    <SectionCard title="Sent and scheduled" subtitle="Latest announcement notification delivery by channel" noPadding>
      {loading ? <div className="flex justify-center py-12"><Spinner /></div> : loadError ? <div className="p-5"><LoadError title="Couldn't load announcements" message={communicationsErrorMessage(loadError)} onRetry={() => void load()} /></div> : rows.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">No announcements yet.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-sm"><thead><tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]"><th className="p-3">Announcement</th><th className="p-3">Status</th><th className="p-3">Bell delivered</th><th className="p-3">Push accepted</th><th className="p-3">Push failed</th><th className="p-3">Email accepted</th><th className="p-3">Email suppressed</th><th className="p-3"></th></tr></thead><tbody>{rows.map((row) => {
        const delivery = row.delivery || {}; const channels = delivery.channels || {}; const pushFailed = pushDelivery(row).failed; const emailSuppressed = Number(channels.email_suppressed || 0);
        return <tr key={row.id} className="border-b border-[var(--gray-100)] align-top"><td className="p-3"><strong className="block text-[var(--color-text-primary)]">{row.title}</strong><span className="text-xs text-[var(--color-text-tertiary)]">{whenWords(row)}</span>{row.status === "draft" && row.schedule_error ? <span role="alert" className="block text-xs text-[var(--color-error-700)]">Didn&apos;t publish at its time: {row.schedule_error}. Schedule it again or publish now.</span> : null}</td><td className="p-3"><Badge variant={delivery.state === "failed" || delivery.state === "partial" ? "error" : STATUS_BADGE[row.status] || "default"}>{delivery.state || row.status}</Badge></td><td className="p-3">{channels.inapp_delivered ?? "–"}</td><td className="p-3">{channels.push_accepted ?? "–"}</td><td className="p-3">{pushFailed ? <Badge variant="error">{pushFailed}</Badge> : (channels.push_failed ?? "–")}</td><td className="p-3">{channels.email_accepted ?? "–"}</td><td className="p-3">{emailSuppressed || "–"}</td><td className="p-3"><div className="flex flex-wrap justify-end gap-2">{pushFailed ? <Button size="sm" variant="secondary" icon={RefreshCw} loading={busyId === row.id} onClick={() => void retry(row)}>Retry failed</Button> : null}{row.status === "draft" ? <><Button size="sm" variant="secondary" icon={Pencil} onClick={() => { setLaterError(null); setEditor(editorFor(row)); }}>Edit</Button><Button size="sm" icon={Send} loading={busyId === row.id} onClick={() => void onPublish(row.id)}>Publish</Button></> : null}{row.status === "scheduled" ? <><Button size="sm" variant="secondary" icon={Pencil} onClick={() => { setLaterError(null); setEditor(editorFor(row)); }}>Edit</Button><Button size="sm" variant="ghost" loading={busyId === row.id} onClick={() => void onUnschedule(row)}>Unschedule</Button></> : null}{row.status === "draft" || row.status === "published" ? <Button size="sm" variant="secondary" icon={Archive} loading={busyId === row.id} onClick={() => void onArchive(row.id)}>Archive</Button> : null}</div></td></tr>;
      })}</tbody></table></div>}
    </SectionCard>
    <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.id ? "Edit announcement" : "New announcement"}><ModalBody className="space-y-3"><Input label="Title" value={editor?.title || ""} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} maxLength={200}/><Textarea label="Message" value={editor?.bodyMd || ""} onChange={(event) => setEditor((current) => ({ ...current, bodyMd: event.target.value }))} rows={8}/><Textarea label="What you need to do · optional" value={editor?.actionLine || ""} onChange={(event) => setEditor((current) => ({ ...current, actionLine: event.target.value }))} rows={2} maxLength={500}/><label className="block text-sm font-medium text-[var(--color-text-primary)]">Linked roadmap card · optional<select value={editor?.roadmapCardId || ""} onChange={(event) => setEditor((current) => ({ ...current, roadmapCardId: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"><option value="">None</option>{roadmapCards.map((card) => <option key={card.id} value={card.id}>{card.public_title}</option>)}</select></label><div className="space-y-2"><p className="text-sm font-medium text-[var(--color-text-primary)]">When</p><WhenSegment value={editor?.when || "now"} onChange={(when) => { setLaterError(null); setEditor((current) => ({ ...current, when })); }} nowLabel="Publish now" laterLabel="Schedule" />{editor?.when === "later" ? <LaterInputs value={editor.later} onChange={(later) => setEditor((current) => ({ ...current, later }))} error={laterError} hint="Goes to every host: Host Home, bell and push. Hosts see it only once it publishes." /> : null}</div><div className="rounded-lg bg-[var(--gray-50)] p-3 text-xs text-[var(--color-text-secondary)]"><strong className="text-[var(--color-text-primary)]">Preview</strong><p className="mt-1">{editor?.title || "Your title appears here"}</p><p className="mt-1 whitespace-pre-wrap">{editor?.bodyMd || "Write the Host update here."}</p>{editor?.actionLine ? <p className="mt-2"><strong>What you need to do:</strong> {editor.actionLine}</p> : null}</div></ModalBody><ModalFooter><Button variant="secondary" disabled={Boolean(busyId)} onClick={() => setEditor(null)}>Close</Button><Button variant="secondary" disabled={Boolean(busyId)} onClick={() => void saveEditor("draft")}>{editor?.status === "scheduled" ? "Save changes" : "Save draft"}</Button><Button loading={busyId === (editor?.id || "new")} disabled={Boolean(busyId)} onClick={() => void saveEditor(editor?.when === "later" ? "later" : "now")}>{editor?.when === "later" ? (editor?.status === "scheduled" ? "Save and keep scheduled" : "Schedule") : "Publish now"}</Button></ModalFooter></Modal>
  </div>;
}
