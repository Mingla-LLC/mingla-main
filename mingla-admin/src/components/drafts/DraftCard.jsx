import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Copy, FileText, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { DraftEditor } from "./DraftEditor";
import { channelLabel, draftErrorWords, remainingUndoMs } from "../../lib/draftModel";
import { timeAgo } from "../../lib/formatters";

const MotionArticle = motion.article;
const FLAG_WORDS = { money: "Money", giveaway: "Giveaway", date_or_time: "Date or time", call: "Call", unverified: "Not verified" };

async function copyVisible(text, node) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    node?.focus?.(); node?.select?.();
    if (!node?.select && node && typeof window.getSelection === "function") {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    return typeof document.execCommand === "function" && document.execCommand("copy") === true;
  } catch { return false; }
}

function useSecondClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function DraftCard({ draft, online, busy, busyAction, offlineHelpId, deepLinked = false, onDirty, onUpdate, onDiscard, onRestore, onMark, onUndo, onShowWaiting, onUseLatest, onCloseWithdrawn }) {
  const reduced = useReducedMotion();
  const now = useSecondClock(draft.state !== "waiting");
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ subject: draft.subject || "", body: draft.body, dirtySubject: false, validation: {} });
  const [problem, setProblem] = useState("");
  const [localAction, setLocalAction] = useState("");
  const bodyRef = useRef(null);
  const editRef = useRef(null);
  const titleRef = useRef(null);
  const dirtyChanged = useCallback((value) => { onDirty?.(value); }, [onDirty]);
  const removed = !draft.record;
  const withdrawn = !!draft.withdrawn;
  const undoMs = remainingUndoMs(draft.sent_at, now);
  const stale = draft.expires_at && Date.parse(draft.expires_at) < now;
  const restoreMs = Math.max(0, Date.parse(draft.discarded_at || "") + 60_000 - now);
  const action = localAction || busyAction || "";
  const progress = { saving: "Saving…", marking: "Marking sent…", discarding: "Discarding…", restoring: "Restoring…", undoing: "Undoing…" }[action] || "";

  useEffect(() => { if (deepLinked) titleRef.current?.focus(); }, [deepLinked]);

  const markReason = useMemo(() => {
    if (withdrawn) return "This draft was withdrawn while you were editing. Your text is still here, but it can’t be saved or marked sent.";
    if (values.validation?.body) return values.validation.body;
    if (values.validation?.subject) return values.validation.subject;
    if (values.dirtySubject) return "Save the subject before marking this draft sent.";
    if (!online) return "You’re offline. Reconnect before marking this draft sent.";
    if (removed) return "This draft can’t be recorded as sent because its CRM card is gone.";
    if (action) return action === "copying" ? "Copying…" : progress || "This draft is being updated.";
    return "";
  }, [action, online, progress, removed, values, withdrawn]);

  const mark = async () => {
    if (markReason) return;
    setProblem(""); setLocalAction("copying");
    const copied = await copyVisible(values.body, bodyRef.current);
    if (!copied) { setLocalAction(""); setProblem("Couldn’t copy. Nothing was marked sent."); return; }
    setLocalAction("marking");
    try { await onMark(values.body); }
    catch { setProblem("Copied, but not marked sent. Try again."); }
    finally { setLocalAction(""); }
  };

  const runAction = async (run) => {
    setProblem("");
    try { await run(); } catch (error) {
      setProblem(draft.state === "discarded" && error?.token === "undo_expired" ? "The restore window has ended." : draftErrorWords(error));
    }
  };
  const setEditor = (next) => { setEditing(next); if (!next) requestAnimationFrame(() => editRef.current?.focus()); };
  const kind = draft.record?.pipeline === "hosts" ? "host" : "creator";
  const openWords = `Open ${kind}`;
  const removedHelpId = `draft-removed-help-${draft.id}`;
  const actionHelpId = `draft-action-help-${draft.id}`;
  const openControl = removed || busy ? <Button type="button" variant="ghost" icon={FileText} disabled className="min-h-11" aria-describedby={removed ? removedHelpId : undefined}>{openWords}</Button>
    : <a href={`#/${draft.record.pipeline}?record=${draft.record.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-transparent px-4 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2"><FileText className="h-4 w-4" aria-hidden="true" />{openWords}<ArrowRight className="h-4 w-4" aria-hidden="true" /></a>;
  const primary = <Button type="button" icon={Copy} loading={action === "copying" || action === "marking"} disabled={!!markReason} aria-describedby={markReason ? (!online ? offlineHelpId : actionHelpId) : undefined} onClick={mark}
    className="min-h-11 bg-[var(--color-brand-800)] hover:bg-[var(--color-brand-900)] active:bg-[var(--color-brand-900)] focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-[var(--color-background-primary)] max-sm:w-full">{action === "copying" ? "Copying…" : action === "marking" ? "Marking sent…" : "Copy and mark sent"}</Button>;
  const edit = !editing ? <Button ref={editRef} type="button" variant="secondary" icon={Pencil} disabled={busy} className="min-h-11" onClick={() => setEditor(true)}>Edit</Button> : null;
  const discard = <Button type="button" variant="ghost" icon={Trash2} loading={action === "discarding"} disabled={busy || !online} aria-describedby={!online ? offlineHelpId : undefined} className="min-h-11" onClick={() => runAction(onDiscard)}>{action === "discarding" ? "Discarding…" : "Discard"}</Button>;

  return (
    <MotionArticle data-draft-id={draft.id} layout={!reduced} aria-labelledby={`draft-title-${draft.id}`} aria-busy={busy || !!localAction ? "true" : undefined}
      initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduced ? {} : { opacity: 0, y: -4 }} transition={{ duration: reduced ? 0 : 0.15 }}
      className="min-w-0">
      <SectionCard className="min-w-0" noPadding>
      <div className="border-b border-[var(--gray-200)] px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 ref={titleRef} tabIndex={deepLinked ? -1 : undefined} id={`draft-title-${draft.id}`} className="break-words text-[15px] font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{removed ? "Record no longer available" : draft.record.name}</h2></div>
          <Badge variant="outline">{channelLabel(draft.channel)}</Badge>
        </div>
        {draft.record && <p className="mt-1 break-words text-[13px] leading-5 text-[var(--color-text-secondary)]">{draft.record.pipeline === "hosts" ? "Host" : "Creator"}{draft.record.stage ? ` · ${draft.record.stage}` : ""}</p>}
        <p className="break-words text-[13px] leading-5 text-[var(--color-text-secondary)]">Written by {draft.created_via === "claude" ? "Claude" : "Codex"} · {timeAgo(draft.created_at)}</p>
        {draft.recipient && <p className="break-words text-[13px] leading-5 text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">To: {draft.recipient}</p>}
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {removed && <div id={removedHelpId} role="alert" className="rounded-lg bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]">You can still read or discard this draft, but it can’t be recorded as sent because its CRM card is gone.</div>}
        {((draft.flags || []).length > 0 || stale) && <div className="space-y-2"><div className="flex flex-wrap gap-2">{(draft.flags || []).map((flag) => <Badge key={flag} variant="warning">{FLAG_WORDS[flag] || flag.replaceAll("_", " ")}</Badge>)}{stale && <Badge variant="warning">May be stale</Badge>}</div>{stale && <p className="text-[13px] leading-5 text-[var(--color-warning-700)]">This draft may be out of date. Check the card before you send.</p>}</div>}
        {draft.incoming && <blockquote className="rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-tertiary)] p-3"><p className="text-xs font-semibold leading-4 text-[var(--color-text-secondary)]">Replying to · {channelLabel(draft.incoming.channel || draft.channel)} · {timeAgo(draft.incoming.occurred_at || draft.incoming.created_at)}</p><p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-5 text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{draft.incoming.body}</p></blockquote>}
        {draft.reason && <p className="break-words text-[13px] leading-5 text-[var(--color-text-secondary)]"><span className="font-semibold">Why this draft:</span> {draft.reason}</p>}
        <DraftEditor key={editing ? draft.id : `${draft.id}:${draft.updated_at}`} ref={bodyRef} draft={draft} editing={editing} busy={busy} online={online} offlineHelpId={offlineHelpId}
          primaryAction={editing ? primary : null} openAction={editing ? openControl : null} discardAction={editing && !withdrawn ? discard : null}
          onEditing={setEditor} onDirty={dirtyChanged} onValues={setValues} onSave={onUpdate} onUseLatest={onUseLatest} onCloseWithdrawn={onCloseWithdrawn} />
        {draft.original_body !== draft.body && <details className="text-[13px] leading-5 text-[var(--color-text-secondary)]"><summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2">See agent’s original</summary><p className="whitespace-pre-wrap break-words rounded-lg bg-[var(--color-background-tertiary)] p-3 text-sm leading-6 [overflow-wrap:anywhere]">{draft.original_body}</p></details>}
        <div className="min-h-5" aria-live="polite">{problem && <p role="alert" className="break-words text-[13px] font-semibold text-[var(--color-error-700)]">{problem}</p>}{!problem && markReason && draft.state === "waiting" && <p id={actionHelpId} className="break-words text-[13px] text-[var(--color-text-secondary)]">{markReason}</p>}{!problem && progress && draft.state !== "waiting" && <p className="text-[13px] text-[var(--color-text-secondary)]">{progress}</p>}</div>

        {draft.state === "waiting" && !editing && <>
          <div className="space-y-2 sm:hidden">{primary}<div className="grid grid-cols-2 gap-2">{edit}{openControl}</div>{discard}</div>
          <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 border-t border-[var(--gray-200)] pt-4 sm:flex"><div className="flex flex-wrap items-center gap-2">{openControl}{discard}</div><div className="flex flex-wrap items-center gap-2">{edit}{primary}</div></div>
        </>}
        {draft.state === "sent" && <div className="space-y-3"><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{openControl}{undoMs > 0 && <Button type="button" variant="secondary" icon={RotateCcw} loading={action === "undoing"} disabled={!online || busy} aria-describedby={!online ? offlineHelpId : undefined} className="min-h-11" onClick={() => runAction(onUndo)}>{action === "undoing" ? "Undoing…" : "Undo Mingla record"}</Button>}</div><p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">{undoMs > 0 ? `Undo available for ${Math.ceil(undoMs / 1000)} seconds. ` : "The Undo window has ended. "}This cannot recall the message from the real channel.</p></div>}
        {draft.state === "discarded" && <div className="space-y-3"><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{openControl}{restoreMs > 0 && <Button type="button" variant="secondary" icon={RotateCcw} loading={action === "restoring"} disabled={!online || busy} aria-describedby={!online ? offlineHelpId : undefined} className="min-h-11" onClick={() => runAction(onRestore)}>{action === "restoring" ? "Restoring…" : "Restore draft"}</Button>}</div><p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">{restoreMs > 0 ? `Restore available for ${Math.ceil(restoreMs / 1000)} seconds` : "The restore window has ended."}</p>{problem.includes("3 drafts waiting") && draft.record && <Button type="button" variant="secondary" className="min-h-11" onClick={onShowWaiting}>Show waiting drafts</Button>}</div>}
      </div>
      </SectionCard>
    </MotionArticle>
  );
}
