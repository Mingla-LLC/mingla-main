import { useEffect, useRef, useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { AlertCard } from "../ui/Card";
import { CONTROL_CLASS, Field, Select, TEXTAREA_CLASS } from "../crm/fields";
import {
  CONTENT_STAGES,
  canMoveTo,
  contentErrorWords,
  copyIsLocked,
  createLatestOnlyGate,
  dateTimeLocal,
  localToIso,
  requestKey,
  safeHttpsUrl,
} from "../../lib/contentCalendarModel";
import * as service from "../../services/contentCalendarService";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function ContentDrawer({ activeId, detail, config, online, loading, focusTarget, onFocusHandled, onClose, onChanged, onMove, onDeleted, suspended = false }) {
  const [viewDetail, setViewDetail] = useState(detail || null);
  const [item, setItem] = useState(detail?.item || null);
  const [comment, setComment] = useState("");
  const [mentions, setMentions] = useState([]);
  const [busy, setBusy] = useState("");
  const [saveState, setSaveState] = useState({ state: "idle", at: null });
  const [error, setError] = useState(null);
  const [staleChanges, setStaleChanges] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const gate = useRef(createLatestOnlyGate());

  useEffect(() => {
    if (activeId) gate.current.activate(activeId); else gate.current.close();
    setViewDetail(null); setItem(null); setComment(""); setMentions([]); setBusy(""); setError(null); setStaleChanges(null); setRemoved(false); setConfirmDelete(false); setSaveState({ state: "idle", at: null });
  }, [activeId]);
  useEffect(() => {
    if (activeId && detail?.item?.id === activeId && gate.current.active() === activeId) {
      setViewDetail(detail); setItem(detail.item); setRemoved(false);
    }
  }, [activeId, detail]);
  useEffect(() => {
    if (!item || !focusTarget || item.id !== activeId) return;
    requestAnimationFrame(() => {
      const control = document.getElementById(focusTarget);
      if (control) { control.focus(); onFocusHandled?.(); }
    });
  }, [activeId, focusTarget, item, onFocusHandled]);

  const close = () => { gate.current.close(); onClose(); };
  const setCaughtError = (cause, changes = null) => {
    setError(cause); setSaveState({ state: "failed", at: null });
    if (cause?.token === "stale_write") setStaleChanges(changes);
    if (cause?.token === "not_found") setRemoved(true);
  };
  const acceptItem = (ticket, answer) => {
    if (!gate.current.accepts(ticket)) return false;
    setItem(answer.item); setViewDetail((current) => current ? { ...current, item: answer.item } : current); onChanged(answer.item, answer);
    return true;
  };
  const save = async (changes) => {
    if (!item || !online || removed) return;
    const ticket = gate.current.ticket();
    setBusy("Saving"); setSaveState({ state: "saving", at: null }); setError(null); setStaleChanges(null);
    try {
      const answer = await service.updateContent(item.id, changes, item.revision, requestKey("web_update"));
      if (acceptItem(ticket, answer)) setSaveState({ state: "saved", at: new Date() });
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause, changes); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };
  const assign = async (email, checked) => {
    if (!item || !online || removed) return;
    const owners = checked ? [...new Set([...(item.owners || []), email])] : (item.owners || []).filter((owner) => owner !== email);
    const ticket = gate.current.ticket();
    setBusy("Saving owners"); setSaveState({ state: "saving", at: null }); setError(null);
    try {
      const answer = await service.assignContent(item.id, owners, item.revision, requestKey("web_owner"));
      if (acceptItem(ticket, answer)) setSaveState({ state: "saved", at: new Date() });
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause, { owners }); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };
  const reloadLatest = async () => {
    if (!activeId || !online) return;
    const ticket = gate.current.ticket(); setBusy("Loading latest"); setError(null);
    try {
      const answer = await service.getContent(activeId);
      if (gate.current.accepts(ticket)) { setViewDetail(answer); setItem(answer.item); setStaleChanges(null); setRemoved(false); setSaveState({ state: "idle", at: null }); onChanged(answer.item); }
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };
  const saveMine = async () => {
    if (!activeId || !staleChanges || !online) return;
    const ticket = gate.current.ticket(); const mine = staleChanges;
    setBusy("Saving mine"); setSaveState({ state: "saving", at: null }); setError(null);
    try {
      const latest = await service.getContent(activeId);
      if (!gate.current.accepts(ticket)) return;
      const answer = await service.updateContent(activeId, mine, latest.item.revision, requestKey("web_update_latest"));
      if (acceptItem(ticket, answer)) { setStaleChanges(null); setSaveState({ state: "saved", at: new Date() }); }
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause, mine); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };
  const addComment = async () => {
    if (!item || !comment.trim() || !online || removed) return;
    const ticket = gate.current.ticket(); setBusy("Commenting"); setError(null);
    try {
      await service.addContentComment(item.id, comment, mentions, requestKey("web_comment"));
      if (!gate.current.accepts(ticket)) return;
      const latest = await service.getContent(item.id);
      if (gate.current.accepts(ticket)) { setComment(""); setMentions([]); setViewDetail(latest); setItem(latest.item); onChanged(latest.item); }
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };
  const remove = async () => {
    if (!item || !online) return;
    const ticket = gate.current.ticket(); setBusy("Deleting"); setError(null);
    try {
      await service.deleteContent(item.id, item.revision);
      if (gate.current.accepts(ticket)) { onDeleted(item.id); close(); }
    } catch (cause) { if (gate.current.accepts(ticket)) setCaughtError(cause); }
    finally { if (gate.current.accepts(ticket)) setBusy(""); }
  };

  const status = !online ? "Offline — read only" : saveState.state === "saving" ? "Saving…" : saveState.state === "saved" ? `Saved · ${saveState.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : saveState.state === "failed" ? "Save failed" : "Changes save as you leave a field";
  const copyLocked = copyIsLocked(item);
  const driveLink = safeHttpsUrl(item?.drive_url);
  const liveLink = safeHttpsUrl(item?.live_url);
  const disabled = !online || !!busy || removed;

  return (
    <Drawer open={!!activeId} onClose={close} title={item?.title || "Content card"} suspended={suspended}
      footer={<div className="flex min-h-11 items-center justify-between gap-2"><span aria-live="polite" className="text-xs text-[var(--color-text-tertiary)]">{status}</span>{config?.me?.can_delete && <Button type="button" variant="danger" className="min-h-11" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete</Button>}</div>}>
      {loading || (!item && !removed) ? <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading card…</p> : removed ? <AlertCard variant="error" title="This card was removed"><p>{contentErrorWords({ token: "not_found" })}</p><Button type="button" variant="secondary" className="mt-3 min-h-11" onClick={close}>Close</Button></AlertCard> : <div className="space-y-5">
        {error && <AlertCard variant="error" title="Couldn’t save" action={error.token === "stale_write" ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={!!busy || !online} onClick={reloadLatest}>Use latest</Button><Button type="button" variant="brandContrast" className="min-h-11" disabled={!!busy || !online} onClick={saveMine}>Save mine</Button></div> : null}>{contentErrorWords(error)}</AlertCard>}
        <Field label="Title" htmlFor="content-title"><input id="content-title" className={`${CONTROL_CLASS} min-h-11`} disabled={disabled} value={item.title} onChange={(event) => setItem({ ...item, title: event.target.value })} onBlur={() => save({ title: item.title })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Stage" htmlFor="content-stage"><Select id="content-stage" className="min-h-11" disabled={disabled} value={item.stage} options={CONTENT_STAGES.map((stage) => ({ ...stage, disabled: stage.value !== item.stage && !canMoveTo(item, stage.value) }))} onChange={(event) => onMove(item, event.target.value)} /></Field>
          <Field label="Publish date and time" htmlFor="content-publish"><input id="content-publish" type="datetime-local" className={`${CONTROL_CLASS} min-h-11`} disabled={disabled} value={dateTimeLocal(item.publish_at)} onChange={(event) => setItem({ ...item, publish_at: localToIso(event.target.value) })} onBlur={() => save({ publish_at: item.publish_at })} /></Field>
        </div>
        <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Owners</legend><div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{(config?.team || []).map((person) => <label key={person.email} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}><input type="checkbox" checked={(item.owners || []).includes(person.email)} disabled={disabled} onChange={(event) => assign(person.email, event.target.checked)} />{person.display_name || person.email}</label>)}</div></fieldset>
        <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Channels</legend><div className="grid grid-cols-2 gap-1">{(config?.channels || []).map((channel, index) => <label key={channel.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}><input id={index === 0 ? "content-channel-first" : undefined} type="checkbox" checked={(item.channels || []).includes(channel.id)} disabled={disabled} onChange={(event) => { const channels = event.target.checked ? [...new Set([...(item.channels || []), channel.id])] : (item.channels || []).filter((id) => id !== channel.id); setItem({ ...item, channels }); save({ channels }); }} />{channel.label}</label>)}</div></fieldset>
        <Field label="Copy" htmlFor="content-copy" helper={copyLocked ? "Copy is read-only after Writing. Move this card back to Writing to revise it." : undefined}><textarea id="content-copy" className={TEXTAREA_CLASS} rows={6} disabled={disabled || copyLocked} value={item.copy || ""} onChange={(event) => setItem({ ...item, copy: event.target.value })} onBlur={() => save({ copy: item.copy || "" })} /></Field>
        <Field label="Notes" htmlFor="content-notes"><textarea id="content-notes" className={TEXTAREA_CLASS} rows={4} disabled={disabled} value={item.notes || ""} onChange={(event) => setItem({ ...item, notes: event.target.value })} onBlur={() => save({ notes: item.notes || "" })} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Drive link" htmlFor="content-drive"><input id="content-drive" type="url" className={`${CONTROL_CLASS} min-h-11`} disabled={disabled} value={item.drive_url || ""} onChange={(event) => setItem({ ...item, drive_url: event.target.value })} onBlur={() => save({ drive_url: item.drive_url || "" })} />{driveLink && <a href={driveLink} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline ${FOCUS}`}>Open Drive link</a>}</Field>
          <Field label="Live link" htmlFor="content-live"><input id="content-live" type="url" className={`${CONTROL_CLASS} min-h-11`} disabled={disabled} value={item.live_url || ""} onChange={(event) => setItem({ ...item, live_url: event.target.value })} onBlur={() => save({ live_url: item.live_url || "" })} />{liveLink && <a href={liveLink} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-brand-700)] underline ${FOCUS}`}>Open live link</a>}</Field>
        </div>
        <details className="rounded-lg border border-[var(--gray-200)]"><summary className={`flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-[var(--color-text-primary)] ${FOCUS}`}>More details</summary><div className="grid grid-cols-1 gap-4 border-t border-[var(--gray-200)] p-3 sm:grid-cols-2"><Field label="Format" htmlFor="content-format"><Select id="content-format" className="min-h-11" disabled={disabled} value={item.format || ""} placeholder="Not set" options={(config?.formats || []).map((entry) => ({ value: entry.id, label: entry.label }))} onChange={(event) => { setItem({ ...item, format: event.target.value }); save({ format: event.target.value }); }} /></Field><Field label="Audience" htmlFor="content-audience"><Select id="content-audience" className="min-h-11" disabled={disabled} value={item.audience || ""} placeholder="Not set" options={(config?.audiences || []).map((entry) => ({ value: entry.id, label: entry.label }))} onChange={(event) => { setItem({ ...item, audience: event.target.value }); save({ audience: event.target.value }); }} /></Field><Field label="City" htmlFor="content-city"><Select id="content-city" className="min-h-11" disabled={disabled} value={item.city_id || ""} placeholder="Not set" options={(config?.cities || []).map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(event) => { setItem({ ...item, city_id: event.target.value }); save({ city_id: event.target.value }); }} /></Field></div></details>
        <section aria-labelledby="content-comments"><h3 id="content-comments" className="text-sm font-semibold text-[var(--color-text-primary)]">Comments</h3><div className="mt-2 space-y-2">{(viewDetail?.comments || []).length ? viewDetail.comments.map((row) => <div key={row.id} className="rounded-lg bg-[var(--gray-50)] p-3 text-sm"><p className="whitespace-pre-wrap text-[var(--color-text-primary)]">{row.body}</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{row.display_name || row.actor_email}{row.via ? " via agent" : ""}</p></div>) : <p className="text-sm text-[var(--color-text-secondary)]">No comments yet.</p>}</div><label htmlFor="content-comment" className="sr-only">New comment</label><textarea id="content-comment" className={`${TEXTAREA_CLASS} mt-3`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Write a comment" disabled={disabled} /><fieldset className="mt-3"><legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Mention teammates</legend><div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">{(config?.team || []).filter((person) => person.email !== config?.me?.email).map((person) => <label key={person.email} className={`flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}><input type="checkbox" checked={mentions.includes(person.email)} disabled={disabled} onChange={(event) => setMentions((current) => event.target.checked ? [...new Set([...current, person.email])] : current.filter((email) => email !== person.email))} />{person.display_name || person.email}</label>)}</div></fieldset><Button type="button" variant="brandContrast" className="mt-2 min-h-11" disabled={!comment.trim() || disabled} onClick={addComment}>Comment</Button></section>
        {confirmDelete && <AlertCard variant="error" title="Delete this content card?"><p>This removes it from every calendar view.</p><div className="mt-3 flex gap-2"><Button type="button" variant="danger" className="min-h-11" loading={busy === "Deleting"} onClick={remove}>Delete card</Button><Button type="button" variant="secondary" className="min-h-11" onClick={() => setConfirmDelete(false)}>Keep card</Button></div></AlertCard>}
      </div>}
    </Drawer>
  );
}
