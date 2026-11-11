// Issue #4255 (W3, rev4) — a card's thread, panel two beside the card (on a
// narrow screen it covers the card, with Back). It replaces Notes:
//   * messages by day; a run of one person's messages shows their name once;
//     each has its avatar, name (an agent's label with an Agent mark), time,
//     Markdown, attachments, reactions, Reply and ⋯ (edit and delete your
//     own, copy link);
//   * replies open in place under the message;
//   * the composer: @ lists active teammates (and @everyone for admins),
//     Enter sends, Shift+Enter is a new line, the paperclip attaches pictures
//     and documents (up to 10, 25 MB each, refused before upload), the link
//     button adds links, and pasting a picture attaches it. A failed upload
//     keeps the text and offers Retry on its chip;
//   * mentioning someone who is not on the card asks once: "Also add Ray as
//     a watcher?";
//   * status, people and close changes show as grey lines behind
//     "Show changes" (off by default, remembered in this browser).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AtSign, Link2, MoreHorizontal, Paperclip, SendHorizontal, SmilePlus, X } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { PersonAvatar } from "../people/PeopleField";
import { MarkdownText } from "./MarkdownText";
import { RichComposer } from "./RichComposer";
import { FileTile, ImageViewer } from "./CardFiles";
import { MenuItem, Popover } from "./Popover";
import { useToast } from "../../context/ToastContext";
import { useOpsCard } from "../../hooks/useOpsCard";
import { useOpsConfig } from "../../hooks/useOpsConfig";
import { useCardThread } from "../../hooks/useWorkBoard";
import { useOpenFile, useThumbnails } from "../../hooks/useCardFiles";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import * as ops from "../../services/opsService";
import { eventWords, opsErrorWords, proofBadge, requestKey } from "../../lib/opsModel";
import {
  FILES_PER_MESSAGE,
  REACTIONS,
  clockTime,
  dayHeading,
  fileKind,
  fileMime,
  fileProblem,
  linkFriendlyName,
  linkProblem,
  mentionedOutsiders,
  readShowChanges,
  threadDays,
  writeShowChanges,
} from "../../lib/workBoardModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const ICON_BTN = `inline-grid h-9 w-9 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-40 ${FOCUS}`;

const storage = () => (typeof window !== "undefined" ? window.localStorage : null);

// The card's own way to upload and post. #4255 W4: a Mingla team chat passes
// its own (services/teamChatService.js) and reuses this composer.
const CARD_ADAPTER = Object.freeze({
  upload: (cardId, item) => (item.kind === "link"
    ? ops.addCardLink(cardId, item.url, item.name, item.key)
    : ops.uploadCardFile(cardId, item.file, { kind: item.kind, mime: fileMime(item.file), key: item.key })),
  post: (cardId, { body, emails, parentId, fileIds, everyone }) =>
    ops.postMessage(cardId, { body, mentions: emails, parentId, fileIds, everyone, key: requestKey("web_msg") }),
});

/** The composer with its tray: attachments wait as chips until the message is sent. */
export function ThreadComposer({ cardId, team, allowEveryone, disabled, parentId = null, placeholder, onPosted, compactHint = true, adapter = CARD_ADAPTER }) {
  const { addToast } = useToast();
  const ref = useRef(null);
  const fileRef = useRef(null);
  const [tray, setTray] = useState([]); // { key, kind, file?, url?, name, state, id?, error }
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const attach = (files) => {
    const next = [];
    for (const file of Array.from(files || [])) {
      const problem = fileProblem(file);
      if (problem) { addToast({ variant: "error", title: problem }); continue; }
      next.push({ key: requestKey("web_file"), kind: fileKind(file), file, name: file.name, state: "ready" });
    }
    setTray((t) => {
      const room = FILES_PER_MESSAGE - t.length;
      if (next.length > room) addToast({ variant: "error", title: "A message carries up to 10 files." });
      return [...t, ...next.slice(0, Math.max(0, room))];
    });
  };
  const addLink = (e) => {
    e.preventDefault();
    const v = link.trim();
    const p = linkProblem(v);
    if (p) { setLinkError(p); return; }
    if (tray.length >= FILES_PER_MESSAGE) { setLinkError("A message carries up to 10 files."); return; }
    setTray((t) => [...t, { key: requestKey("web_link"), kind: "link", url: v, name: linkFriendlyName(v) || v, state: "ready" }]);
    setLink(""); setLinkOpen(false); setLinkError("");
  };
  // Upload each attachment that is not on the card yet; keep a failed one with Retry.
  const upload = async (item) => {
    if (item.id) return item;
    setTray((t) => t.map((x) => (x.key === item.key ? { ...x, state: "sending", error: "" } : x)));
    try {
      const row = await adapter.upload(cardId, item);
      const done = { ...item, id: row?.id, state: "ready" };
      setTray((t) => t.map((x) => (x.key === item.key ? done : x)));
      return done;
    } catch (err) {
      setTray((t) => t.map((x) => (x.key === item.key ? { ...x, state: "failed", error: opsErrorWords(err) } : x)));
      return null;
    }
  };
  const send = async () => {
    if (sending || disabled) return;
    const body = (ref.current?.markdown() || "").trim();
    const { emails, everyone } = ref.current?.mentions() || { emails: [], everyone: false };
    if (!body && tray.length === 0) return;
    setSending(true); setError("");
    try {
      const done = await Promise.all(tray.map(upload));
      if (done.some((d) => !d?.id)) { setError("A file didn’t upload. Retry it, or remove it, then send. Your message is kept."); return; }
      const answer = await adapter.post(cardId, { body, emails, parentId, fileIds: done.map((d) => d.id), everyone });
      ref.current?.clear();
      setTray([]);
      onPosted?.(answer, emails);
    } catch (err) {
      setError(opsErrorWords(err));
    } finally { setSending(false); }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {tray.length > 0 && (
        <ul aria-label="Attachments" className="flex min-w-0 flex-wrap gap-1.5">
          {tray.map((t) => (
            <li key={t.key} data-tray-item={t.kind} data-state={t.state} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] ${t.state === "failed" ? "border-[var(--color-error-500)] text-[var(--color-error-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"}`}>
              <span className="text-[10.5px] font-semibold uppercase">{t.kind === "image" ? "Photo" : t.kind === "link" ? "Link" : "Doc"}</span>
              <span className="max-w-[10rem] truncate">{t.name}</span>
              {t.state === "sending" && <span>· uploading…</span>}
              {t.state === "failed" && <button type="button" onClick={() => upload(t)} className={`rounded px-1 font-semibold underline ${FOCUS}`}>Retry</button>}
              <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setTray((x) => x.filter((y) => y.key !== t.key))} className={`inline-grid h-6 w-6 place-items-center rounded ${FOCUS}`}><X aria-hidden="true" className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {linkOpen && (
        <form onSubmit={addLink} className="flex min-w-0 items-start gap-1.5">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="sr-only">Link address</span>
            <input autoFocus value={link} maxLength={2000} placeholder="https://" onChange={(e) => { setLink(e.target.value); setLinkError(""); }} className={`min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] ${FOCUS}`} />
            {linkError && <span role="alert" className="text-[12px] text-[var(--color-error-700)]">{linkError}</span>}
          </label>
          <button type="submit" className={`min-h-9 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Add</button>
          <button type="button" onClick={() => setLinkOpen(false)} className={`min-h-9 rounded-md px-2 text-[12.5px] text-[var(--color-text-secondary)] ${FOCUS}`}>Cancel</button>
        </form>
      )}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); attach(e.dataTransfer?.files); }}>
        <RichComposer ref={ref} compact toolbar={false} id={`thread-${cardId}-${parentId || "top"}`} label={parentId ? "Reply" : "Message"} disabled={disabled || sending}
          placeholder={placeholder} people={team} allowEveryone={allowEveryone} onSubmit={send} onPasteFiles={attach} />
      </div>
      {error && <p role="alert" className="text-[12px] text-[var(--color-error-700)]">{error}</p>}
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" aria-label="Attach photos or documents" title="Attach photos or documents" disabled={disabled} onClick={() => fileRef.current?.click()} className={ICON_BTN}><Paperclip aria-hidden="true" className="h-4 w-4" /></button>
        <button type="button" aria-label="Add a link" title="Add a link" disabled={disabled} onClick={() => setLinkOpen((o) => !o)} className={ICON_BTN}><Link2 aria-hidden="true" className="h-4 w-4" /></button>
        <button type="button" aria-label="Mention someone" title="Mention someone" disabled={disabled} onClick={() => ref.current?.editor?.chain().focus().insertContent("@").run()} className={ICON_BTN}><AtSign aria-hidden="true" className="h-4 w-4" /></button>
        <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,.heic,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.key,.numbers,.pages"
          onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
        {compactHint && <span className="ml-auto hidden text-[11.5px] text-[var(--color-text-tertiary)] sm:inline">Enter to send · Shift+Enter new line</span>}
        <button type="button" aria-label={parentId ? "Send reply" : "Send message"} disabled={disabled || sending} onClick={send} className={`ml-auto inline-grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50 sm:ml-1 ${FOCUS}`}><SendHorizontal aria-hidden="true" className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Reactions({ message, disabled, onReact }) {
  const list = Array.isArray(message.reactions) ? message.reactions : [];
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {list.map((r) => (
        <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={(r.names || []).join(", ")} disabled={disabled} onClick={() => onReact(message, r.emoji, !r.mine)}
          className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] ${r.mine ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"} ${FOCUS}`}>
          <span aria-hidden="true">{r.emoji}</span><span className="tabular-nums">{r.count}</span><span className="sr-only">{r.mine ? "Take back your" : "Add your"} {r.emoji} reaction</span>
        </button>
      ))}
      <Popover label="Add a reaction" role="menu" width="w-auto" disabled={disabled}
        button={<SmilePlus aria-hidden="true" className="h-3.5 w-3.5" />}
        buttonClassName="inline-grid h-7 w-7 place-items-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)]">
        {(close) => (
          <span className="flex gap-0.5">
            {REACTIONS.map((e) => <button key={e} type="button" role="menuitem" aria-label={`React with ${e}`} onClick={() => { onReact(message, e, true); close(); }} className={`inline-grid h-8 w-8 place-items-center rounded-md text-[16px] hover:bg-[var(--gray-100)] ${FOCUS}`}>{e}</button>)}
          </span>
        )}
      </Popover>
    </span>
  );
}

function Message({ message, collapsed, isReply, cardId, team, allowEveryone, disabled, thumbs, openFile, onChanged, onPosted }) {
  const { addToast } = useToast();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body || "");
  const [deleting, setDeleting] = useState(false);
  const [showReplies, setShowReplies] = useState(true);
  const names = [...(message.mentions || []).map((m) => m.name), ...(message.everyone ? ["everyone"] : [])];
  const replies = Array.isArray(message.replies) ? message.replies : [];
  const call = async (task, ok) => {
    try { await task(); await onChanged(); if (ok) addToast({ variant: "success", title: ok }); return true; }
    catch (error) {
      if (error?.token === "stale_write") { addToast({ variant: "warning", title: "This message changed. Showing the latest." }); await onChanged(); }
      else addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) });
      return false;
    }
  };
  const react = (m, emoji, on) => call(() => ops.reactMessage(m.id, emoji, on));
  const author = { email: message.author_email, name: message.author_name };
  return (
    <li data-message={message.id} data-reply={isReply ? "true" : undefined} className={`group flex min-w-0 gap-2.5 ${collapsed ? "pt-0.5" : "pt-2"}`}>
      <span className="w-7 shrink-0">{!collapsed && (message.agent ? <span aria-hidden="true" className="inline-grid h-7 w-7 place-items-center rounded-full bg-[var(--color-info-50)] text-[10px] font-bold text-[var(--color-info-700)]">AI</span> : <PersonAvatar person={author} />)}</span>
      <div className="min-w-0 flex-1">
        {!collapsed && (
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
            <span className="font-semibold text-[var(--color-text-primary)]">{message.author_name}</span>
            {message.agent && <span className="rounded-full bg-[var(--color-info-50)] px-1.5 text-[10.5px] font-semibold text-[var(--color-info-700)]">Agent</span>}
            <time dateTime={message.created_at} className="text-[11.5px] text-[var(--color-text-tertiary)]">{clockTime(message.created_at)}</time>
            {message.edited_at && <span className="text-[11px] text-[var(--color-text-tertiary)]">(edited)</span>}
          </p>
        )}
        {message.deleted ? (
          <p className="text-[12.5px] italic text-[var(--color-text-tertiary)]">This message was deleted.</p>
        ) : editing ? (
          <form className="flex min-w-0 flex-col gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (await call(() => ops.editMessage(message.id, editBody, message.revision), "Message edited")) setEditing(false); }}>
            <label className="sr-only" htmlFor={`edit-${message.id}`}>Edit message</label>
            <textarea id={`edit-${message.id}`} value={editBody} maxLength={10000} onChange={(e) => setEditBody(e.target.value)} className={`min-h-[72px] w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] p-2 text-[13px] ${FOCUS}`} />
            <span className="flex gap-1.5"><button type="submit" className={`min-h-9 rounded-md bg-[var(--color-brand-500)] px-3 text-[12.5px] font-semibold text-white ${FOCUS}`}>Save</button><button type="button" onClick={() => { setEditing(false); setEditBody(message.body || ""); }} className={`min-h-9 rounded-md px-2 text-[12.5px] ${FOCUS}`}>Cancel</button></span>
          </form>
        ) : (
          message.body ? <MarkdownText text={message.body} mentionNames={names} className="text-[13px] text-[var(--color-text-primary)]" /> : null
        )}
        {!message.deleted && (message.files || []).length > 0 && (
          <ul className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
            {message.files.map((f) => <FileTile key={f.id} file={f} thumb={thumbs[f.id]} onOpen={openFile} compact />)}
          </ul>
        )}
        {deleting && (
          <div role="alertdialog" aria-label="Delete this message?" className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-error-50)] px-2 py-1.5 text-[12.5px]">
            <span>Delete this message? Its files stop being served.</span>
            <button type="button" onClick={async () => { await call(() => ops.deleteMessage(message.id, message.revision), "Message deleted"); setDeleting(false); }} className={`font-semibold text-[var(--color-error-700)] underline ${FOCUS}`}>Delete</button>
            <button type="button" onClick={() => setDeleting(false)} className={`underline ${FOCUS}`}>Keep</button>
          </div>
        )}
        {!message.deleted && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
            <Reactions message={message} disabled={disabled} onReact={react} />
            {!isReply && <button type="button" disabled={disabled} onClick={() => setReplying((r) => !r)} className={`min-h-7 rounded px-1.5 font-semibold hover:bg-[var(--gray-100)] ${FOCUS}`}>Reply</button>}
            <Popover label="Message options" role="menu" align="left" width="w-48"
              button={<MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />}
              buttonClassName="inline-grid h-7 w-7 place-items-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)]">
              {(close) => (
                <div className="flex flex-col">
                  {message.mine && <MenuItem disabled={disabled} onClick={() => { setEditBody(message.body || ""); setEditing(true); close(); }}>Edit</MenuItem>}
                  {message.mine && <MenuItem danger disabled={disabled} onClick={() => { setDeleting(true); close(); }}>Delete…</MenuItem>}
                  <MenuItem onClick={async () => {
                    close();
                    const url = `${window.location.origin}${window.location.pathname}#/work-board?card=${cardId}&side=thread:${cardId}&msg=${message.id}`;
                    try { await navigator.clipboard.writeText(url); addToast({ variant: "success", title: "Link copied" }); }
                    catch { addToast({ variant: "error", title: "Couldn’t copy", description: "Your browser blocked copying." }); }
                  }}>Copy link</MenuItem>
                </div>
              )}
            </Popover>
          </div>
        )}
        {replies.length > 0 && (
          <div className="mt-1">
            <button type="button" aria-expanded={showReplies ? "true" : "false"} onClick={() => setShowReplies((s) => !s)} className={`min-h-7 rounded px-1 text-[12px] font-semibold text-[var(--color-brand-700)] ${FOCUS}`}>{replies.length} {replies.length === 1 ? "reply" : "replies"}</button>
            {showReplies && (
              <ul className="ml-1 flex min-w-0 flex-col border-l-2 border-[var(--gray-200)] pl-3">
                {replies.map((r) => <Message key={r.id} message={r} isReply cardId={cardId} team={team} allowEveryone={allowEveryone} disabled={disabled} thumbs={thumbs} openFile={openFile} onChanged={onChanged} onPosted={onPosted} />)}
              </ul>
            )}
          </div>
        )}
        {replying && (
          <div className="mt-1.5">
            <ThreadComposer cardId={cardId} team={team} allowEveryone={allowEveryone} disabled={disabled} parentId={message.id} placeholder="Reply…" compactHint={false}
              onPosted={(a, emails) => { setReplying(false); onPosted(a, emails); }} />
          </div>
        )}
      </div>
    </li>
  );
}

export function CardThread({ cardId, onClose, onCardChanged }) {
  const { addToast } = useToast();
  const config = useOpsConfig();
  const directory = usePeopleDirectory();
  const card = useOpsCard(cardId);
  const thread = useCardThread(cardId);
  const [showChanges, setShowChanges] = useState(() => readShowChanges(storage()));
  const [askWatch, setAskWatch] = useState([]);
  const team = (directory.people.length ? directory.people : config.data?.team || []).filter((p) => !p.invited);
  const allowEveryone = !!config.data?.me?.can_override;
  const c = card.data?.card;
  const messages = useMemo(() => (Array.isArray(thread.data?.messages) ? thread.data.messages : []), [thread.data]);
  const allFiles = useMemo(() => messages.flatMap((m) => [...(m.files || []), ...(m.replies || []).flatMap((r) => r.files || [])]), [messages]);
  const thumbs = useThumbnails(allFiles);
  // The newest message is in view when the thread opens and after each post.
  const scrollRef = useRef(null);
  const count = messages.reduce((n, m) => n + 1 + (m.replies || []).length, 0);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && count) el.scrollTop = el.scrollHeight;
  }, [count]);
  // #4255 rework (P3): opening the thread (and every new message seen while
  // it is open) marks it read for me, so the card's Thread badge counts only
  // what I have not seen. Posting marks it read on the server.
  const loaded = !!thread.data;
  useEffect(() => {
    if (!cardId || !loaded) return undefined;
    let gone = false;
    ops.markThreadRead(cardId)
      .then(() => { if (!gone) window.dispatchEvent(new CustomEvent("mingla:work-card-changed", { detail: cardId })); })
      .catch(() => { if (!gone) addToast({ variant: "warning", title: "Couldn’t mark this thread read.", description: "The Thread badge may still show it as new." }); });
    return () => { gone = true; };
  }, [cardId, loaded, count]);
  const opener = useOpenFile();
  const disabled = !c || c.archived || (typeof navigator !== "undefined" && navigator.onLine === false);
  const refresh = async () => {
    await Promise.all([thread.refetch({ quiet: true }), card.refetch({ quiet: true })]);
    onCardChanged?.();
    // The card beside it (panel one) shows the new count and the thread's files at once.
    window.dispatchEvent(new CustomEvent("mingla:work-card-changed", { detail: cardId }));
  };
  const posted = async (answer, emails) => {
    await refresh();
    if (answer?.told) addToast({ variant: "success", title: `Sent. ${answer.told} told.` });
    const outsiders = mentionedOutsiders(emails, c);
    if (outsiders.length) setAskWatch(outsiders);
  };
  // History lines (status, people, close) interleaved by time, behind Show changes.
  const events = card.data?.events;
  const changes = useMemo(() => (showChanges && Array.isArray(events) ? events.filter((e) => e.action !== "note") : []), [showChanges, events]);
  const items = useMemo(() => {
    const rows = messages.map((m) => ({ at: m.created_at, message: m }));
    for (const e of changes) rows.push({ at: e.at, event: e });
    return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [messages, changes]);
  const days = threadDays(items.filter((r) => r.message).map((r) => r.message));
  const collapsedIds = new Set(days.flatMap((d) => d.items.filter((i) => i.collapsed).map((i) => i.message.id)));
  const nameOf = (email) => team.find((p) => p.email === email)?.name || email;
  // Each row with the day heading it opens (if it is the first of its day).
  const shown = items.map((row, i) => {
    const day = String(row.at || "").slice(0, 10);
    const prev = i > 0 ? String(items[i - 1].at || "").slice(0, 10) : "";
    return { row, day, heading: day !== prev ? dayHeading(new Date(row.at)) : "" };
  });

  return (
    <Drawer open onClose={onClose} title={c ? `Thread of card ${c.number}` : "Thread"} bare>
      <div data-card-thread={cardId} className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-[var(--gray-200)] px-2">
          <button type="button" aria-label="Close the thread" onClick={onClose} className={ICON_BTN}><ArrowLeft aria-hidden="true" className="h-4 w-4" /></button>
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">Thread {c ? <span className="font-normal text-[var(--color-text-tertiary)]">#{c.number}</span> : null}</h2>
          <label className="inline-flex min-h-9 items-center gap-1.5 text-[12.5px] text-[var(--color-text-secondary)]">
            <input type="checkbox" data-show-changes="" checked={showChanges} onChange={(e) => { setShowChanges(e.target.checked); writeShowChanges(storage(), e.target.checked); }} className="h-4 w-4 accent-[var(--color-brand-700)]" />
            Show changes
          </label>
          <button type="button" aria-label="Close" onClick={onClose} className={ICON_BTN}><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {thread.loading ? (
            <div aria-busy="true" aria-label="Loading the thread" className="flex flex-col gap-2"><Skeleton height={40} /><Skeleton height={60} /></div>
          ) : thread.error ? (
            <LoadError title="Couldn’t load the thread" message={opsErrorWords(thread.error)} onRetry={() => thread.refetch()} />
          ) : (
            <>
              {items.length === 0 && <p className="py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">No messages yet. Ask a question, share a file or tag a teammate.</p>}
              <ul className="flex min-w-0 flex-col">
                {shown.map(({ row, day, heading }) => {
                  return [
                    heading ? <li key={`d-${day}`} className="py-2 text-center text-[11.5px] font-semibold text-[var(--color-text-tertiary)]">{heading}</li> : null,
                    row.event ? (
                      <li key={`e-${row.event.id}`} data-change-line="" className="py-0.5 pl-9 text-[12px] text-[var(--color-text-tertiary)]">
                        {row.event.actor_name} {eventWords(row.event.action)}{row.event.body ? ` · ${row.event.body}` : ""} · {clockTime(row.event.at)}
                      </li>
                    ) : (
                      <Message key={row.message.id} message={row.message} collapsed={collapsedIds.has(row.message.id)} cardId={cardId} team={team} allowEveryone={allowEveryone}
                        disabled={disabled} thumbs={thumbs} openFile={opener.open} onChanged={refresh} onPosted={posted} />
                    ),
                  ];
                })}
              </ul>
              {c?.status === "done" && (c.proof || []).length > 0 && (
                <div data-closing-proof="" className="mt-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2 text-[12.5px]">
                  <p className="font-semibold text-[var(--color-text-primary)]">Closed{c.closed_by_name ? ` by ${c.closed_by_name}` : ""}</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {c.proof.map((p, i) => <li key={i} className="min-w-0 break-words text-[var(--color-text-secondary)]"><span className="font-semibold">{proofBadge(p)}:</span> {p.text}</li>)}
                  </ul>
                  {c.result && <MarkdownText text={c.result} className="mt-1 text-[12.5px] text-[var(--color-text-secondary)]" />}
                </div>
              )}
            </>
          )}
        </div>
        {askWatch.length > 0 && c && (
          <div role="status" data-ask-watch="" className="mx-3 mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-[var(--color-info-50)] px-3 py-2 text-[12.5px] text-[var(--color-info-700)]">
            <span className="min-w-0 flex-1">Also add {askWatch.map(nameOf).join(" and ")} as {askWatch.length === 1 ? "a watcher" : "watchers"}?</span>
            <button type="button" onClick={async () => {
              const list = askWatch;
              setAskWatch([]);
              try { await ops.updateWork(c.id, { watchers: [...(c.watchers || []).map((p) => p.email), ...list] }, c.revision); await refresh(); addToast({ variant: "success", title: `${list.map(nameOf).join(" and ")} watching` }); }
              catch (error) { addToast({ variant: "error", title: "Couldn’t add them", description: opsErrorWords(error) }); }
            }} className={`min-h-8 rounded-md px-2 font-semibold underline ${FOCUS}`}>Yes</button>
            <button type="button" onClick={() => setAskWatch([])} className={`min-h-8 rounded-md px-2 underline ${FOCUS}`}>Just mention</button>
          </div>
        )}
        <div className="shrink-0 border-t border-[var(--gray-200)] p-2.5">
          {c?.archived ? <p className="text-[12.5px] text-[var(--color-text-tertiary)]">This card was removed. Its thread is kept for the record.</p> : (
            <ThreadComposer cardId={cardId} team={team} allowEveryone={allowEveryone} disabled={disabled}
              placeholder={allowEveryone ? "Message the card… @ to tag, @everyone for all staff" : "Message the card… @ to tag"} onPosted={posted} />
          )}
        </div>
        {opener.viewing && <ImageViewer file={opener.viewing} onClose={opener.close} />}
      </div>
    </Drawer>
  );
}
