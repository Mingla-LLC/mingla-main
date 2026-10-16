import { useEffect, useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { CONTROL_CLASS, Field, Select, TEXTAREA_CLASS } from "../crm/fields";
import { CONTENT_STAGES, contentErrorWords, dateTimeLocal, localToIso, requestKey } from "../../lib/contentCalendarModel";
import * as service from "../../services/contentCalendarService";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function ContentDrawer({ detail, config, online, loading, onClose, onChanged, onMove, onDeleted, onReload }) {
  const [item, setItem] = useState(detail?.item || null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setItem(detail?.item || null); setError(null); }, [detail]);
  if (!item && !loading) return null;

  const save = async (changes, label = "Saving") => {
    if (!item || !online) return;
    setBusy(label); setError(null);
    try {
      const answer = await service.updateContent(item.id, changes, item.revision, requestKey("web_update"));
      setItem(answer.item); onChanged(answer.item, answer);
    } catch (cause) { setError(cause); } finally { setBusy(""); }
  };
  const assign = async (email, checked) => {
    const owners = checked ? [...new Set([...(item.owners || []), email])] : (item.owners || []).filter((owner) => owner !== email);
    setBusy("Saving owners"); setError(null);
    try { const answer = await service.assignContent(item.id, owners, item.revision, requestKey("web_owner")); setItem(answer.item); onChanged(answer.item, answer); }
    catch (cause) { setError(cause); } finally { setBusy(""); }
  };
  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy("Commenting"); setError(null);
    try { await service.addContentComment(item.id, comment, requestKey("web_comment")); setComment(""); await onReload(); }
    catch (cause) { setError(cause); } finally { setBusy(""); }
  };
  const remove = async () => {
    setBusy("Deleting"); setError(null);
    try { await service.deleteContent(item.id, item.revision); onDeleted(item.id); onClose(); }
    catch (cause) { setError(cause); } finally { setBusy(""); }
  };

  return (
    <Drawer open={!!item || loading} onClose={onClose} title={item?.title || "Content card"} suspended={false}
      footer={<div className="flex min-h-11 items-center justify-between gap-2"><span aria-live="polite" className="text-xs text-[var(--color-text-tertiary)]">{busy || (online ? "Changes save as you leave a field" : "Offline — read only")}</span>{config?.me?.can_delete && <Button type="button" variant="danger" className="min-h-11" disabled={!online || !!busy} onClick={() => setConfirmDelete(true)}>Delete</Button>}</div>}>
      {loading ? <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading card…</p> : <div className="space-y-5">
        {error && <AlertCard variant="error" title="Couldn’t save" action={error.token === "stale_write" ? <Button type="button" variant="secondary" className="min-h-11" onClick={onReload}>Reload card</Button> : null}>{contentErrorWords(error)}</AlertCard>}
        <Field label="Title" htmlFor="content-title"><input id="content-title" className={`${CONTROL_CLASS} min-h-11`} disabled={!online || !!busy} value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} onBlur={() => save({ title: item.title })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Stage" htmlFor="content-stage"><Select id="content-stage" className="min-h-11" disabled={!online || !!busy} value={item.stage} options={CONTENT_STAGES} onChange={(e) => onMove(item, e.target.value)} /></Field>
          <Field label="Publish date and time" htmlFor="content-publish"><input id="content-publish" type="datetime-local" className={`${CONTROL_CLASS} min-h-11`} disabled={!online || !!busy} value={dateTimeLocal(item.publish_at)} onChange={(e) => setItem({ ...item, publish_at: localToIso(e.target.value) })} onBlur={() => save({ publish_at: item.publish_at })} /></Field>
        </div>
        <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Owners</legend><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{(config?.team || []).map((person) => <label key={person.email} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}><input type="checkbox" checked={(item.owners || []).includes(person.email)} disabled={!online || !!busy} onChange={(e) => assign(person.email, e.target.checked)} />{person.display_name || person.email}</label>)}</div></fieldset>
        <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Channels</legend><div className="grid grid-cols-2 gap-1">{(config?.channels || []).map((channel) => <label key={channel.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]"><input type="checkbox" checked={(item.channels || []).includes(channel.id)} disabled={!online || !!busy} onChange={(e) => { const channels = e.target.checked ? [...new Set([...(item.channels || []), channel.id])] : (item.channels || []).filter((id) => id !== channel.id); setItem({ ...item, channels }); save({ channels }); }} />{channel.label}</label>)}</div></fieldset>
        <Field label="Copy" htmlFor="content-copy"><textarea id="content-copy" className={TEXTAREA_CLASS} rows={6} disabled={!online || !!busy} value={item.copy || ""} onChange={(e) => setItem({ ...item, copy: e.target.value })} onBlur={() => save({ copy: item.copy || "" })} /></Field>
        <Field label="Notes" htmlFor="content-notes"><textarea id="content-notes" className={TEXTAREA_CLASS} rows={4} disabled={!online || !!busy} value={item.notes || ""} onChange={(e) => setItem({ ...item, notes: e.target.value })} onBlur={() => save({ notes: item.notes || "" })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Drive link" htmlFor="content-drive"><input id="content-drive" type="url" className={`${CONTROL_CLASS} min-h-11`} disabled={!online || !!busy} value={item.drive_url || ""} onChange={(e) => setItem({ ...item, drive_url: e.target.value })} onBlur={() => save({ drive_url: item.drive_url || "" })} /></Field><Field label="Live link" htmlFor="content-live"><input id="content-live" type="url" className={`${CONTROL_CLASS} min-h-11`} disabled={!online || !!busy} value={item.live_url || ""} onChange={(e) => setItem({ ...item, live_url: e.target.value })} onBlur={() => save({ live_url: item.live_url || "" })} /></Field></div>
        <details className="rounded-lg border border-[var(--gray-200)]"><summary className={`flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-[var(--color-text-primary)] ${FOCUS}`}>More details</summary><div className="grid grid-cols-1 gap-4 border-t border-[var(--gray-200)] p-3 sm:grid-cols-2"><Field label="Format" htmlFor="content-format"><Select id="content-format" className="min-h-11" disabled={!online || !!busy} value={item.format || ""} placeholder="Not set" options={(config?.formats || []).map((x) => ({ value: x.id, label: x.label }))} onChange={(e) => { setItem({ ...item, format: e.target.value }); save({ format: e.target.value }); }} /></Field><Field label="Audience" htmlFor="content-audience"><Select id="content-audience" className="min-h-11" disabled={!online || !!busy} value={item.audience || ""} placeholder="Not set" options={(config?.audiences || []).map((x) => ({ value: x.id, label: x.label }))} onChange={(e) => { setItem({ ...item, audience: e.target.value }); save({ audience: e.target.value }); }} /></Field><Field label="City" htmlFor="content-city"><Select id="content-city" className="min-h-11" disabled={!online || !!busy} value={item.city_id || ""} placeholder="Not set" options={(config?.cities || []).map((x) => ({ value: x.id, label: x.name }))} onChange={(e) => { setItem({ ...item, city_id: e.target.value }); save({ city_id: e.target.value }); }} /></Field></div></details>
        <section aria-labelledby="content-comments"><h3 id="content-comments" className="text-sm font-semibold text-[var(--color-text-primary)]">Comments</h3><div className="mt-2 space-y-2">{(detail?.comments || []).length ? detail.comments.map((row) => <div key={row.id} className="rounded-lg bg-[var(--gray-50)] p-3 text-sm"><p className="whitespace-pre-wrap text-[var(--color-text-primary)]">{row.body}</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{row.display_name || row.actor_email}{row.via ? ` via ${row.via === "claude" ? "Claude" : "Codex"}` : ""}</p></div>) : <p className="text-sm text-[var(--color-text-secondary)]">No comments yet.</p>}</div><label htmlFor="content-comment" className="sr-only">New comment</label><textarea id="content-comment" className={`${TEXTAREA_CLASS} mt-3`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" disabled={!online || !!busy} /><Button type="button" variant="brandContrast" className="mt-2 min-h-11" disabled={!comment.trim() || !online || !!busy} onClick={addComment}>Comment</Button></section>
        {confirmDelete && <AlertCard variant="error" title="Delete this content card?"><p>This removes it from every calendar view.</p><div className="mt-3 flex gap-2"><Button type="button" variant="danger" className="min-h-11" loading={busy === "Deleting"} onClick={remove}>Delete card</Button><Button type="button" variant="secondary" className="min-h-11" onClick={() => setConfirmDelete(false)}>Keep card</Button></div></AlertCard>}
      </div>}
    </Drawer>
  );
}
