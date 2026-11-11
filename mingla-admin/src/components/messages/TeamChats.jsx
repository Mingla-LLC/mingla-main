// Issue #4255 (W4, D12) — Team chats in Admin Messages: the same chats as
// Mingla team in the Host app (team_threads; read state, reactions and
// settings shared). The list (the Mingla team group first, then groups and
// direct messages, newest first), find or start a chat, + Group, and a chat
// with replies, reactions, @mentions, photos, documents and links (rev4).
// Every write goes through the team_* functions; realtime keeps it live.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Plus, X } from "lucide-react";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { PersonAvatar } from "../people/PeopleField";
import { MarkdownText } from "../ops/MarkdownText";
import { ThreadComposer } from "../ops/CardThread";
import { FileTile, ImageViewer } from "../ops/CardFiles";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import * as team from "../../services/teamChatService";
import { announceMessagesChange } from "../../hooks/useMessages";
import { opsErrorWords } from "../../lib/opsModel";
import { REACTIONS, clockTime, dayHeading, fileMime, threadDays } from "../../lib/workBoardModel";
import { composerPeople, filterThreads, mentionIds, peopleToStart, threadPreview } from "../../lib/messagesModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const ICON_BTN = `inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`;
export const HOST_TEAM_URL = "https://host.usemingla.com/team";

function ThreadAvatar({ thread }) {
  if (thread.kind === "dm") return <PersonAvatar person={{ name: thread.title, email: thread.other_user_id }} />;
  return (
    <span aria-hidden="true" className={`inline-grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white ${thread.kind === "team" ? "bg-[var(--gray-900)]" : "bg-[var(--color-success-600)]"}`}>
      {thread.kind === "team" ? "M" : "#"}
    </span>
  );
}

function shortTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const heading = dayHeading(d);
  return heading === "Today" ? clockTime(d) : heading.split(" ").slice(0, 1).join(" ") === "Yesterday" ? "Yesterday" : heading.replace(/^\w+ /, "");
}

/** Signed thumbnails for the photos shown (5 minutes; read again when the list changes). */
function useTeamThumbs(files) {
  const ids = useMemo(() => files.filter((f) => f?.kind === "image" && f.uploaded !== false).map((f) => f.id), [files]);
  const key = ids.join(",");
  const [urls, setUrls] = useState({});
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    Promise.all(key.split(",").map((id) => team.attachmentUrl(id).then((u) => [id, u]).catch(() => [id, ""])))
      .then((pairs) => { if (live) setUrls(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [key]);
  return urls;
}

function NewGroup({ people, onCreated, onCancel }) {
  const { addToast } = useToast();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const others = people.filter((p) => !p.me);
  const create = async (e) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const made = await team.createGroup(title.trim(), picked);
      announceMessagesChange();
      onCreated(made?.thread?.id || made?.id || null);
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t start the group", description: opsErrorWords(error) });
    } finally { setSaving(false); }
  };
  return (
    <form onSubmit={create} data-new-group="" className="flex min-w-0 flex-col gap-2 border-b border-[var(--gray-200)] p-3">
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
        Group name
        <input autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Lagos launch" className={`min-h-9 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] font-normal ${FOCUS}`} />
      </label>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">People</legend>
        <div className="flex max-h-40 min-w-0 flex-col overflow-y-auto">
          {others.map((p) => (
            <label key={p.user_id} className="flex min-h-9 items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={picked.includes(p.user_id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.user_id] : x.filter((y) => y !== p.user_id)))} className="h-4 w-4 accent-[var(--color-brand-700)]" />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <span className="flex gap-2">
        <button type="submit" disabled={!title.trim() || saving} className={`min-h-9 rounded-md bg-[var(--color-brand-500)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50 ${FOCUS}`}>{saving ? "Starting…" : "Start group"}</button>
        <button type="button" onClick={onCancel} className={`min-h-9 rounded-md px-2 text-[12.5px] text-[var(--color-text-secondary)] ${FOCUS}`}>Cancel</button>
      </span>
    </form>
  );
}

function ChatList({ onOpen }) {
  const { addToast } = useToast();
  const [threads, setThreads] = useState({ status: "loading", rows: [], error: null });
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await team.listThreads();
      setThreads({ status: "ready", rows: Array.isArray(data?.threads) ? data.threads : [], error: null });
    } catch (error) {
      setThreads((t) => ({ status: t.rows.length ? "ready" : "error", rows: t.rows, error }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    team.listPeople().then((rows) => setPeople(Array.isArray(rows) ? rows : [])).catch((error) => console.warn("[Messages] teammates not loaded:", error?.message || error));
  }, []);
  useEffect(() => {
    const ch = supabase.channel("admin-team-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_messages" }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_threads" }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);
  const shown = filterThreads(threads.rows, query);
  const starters = peopleToStart(people, threads.rows, query);
  const startDm = async (p) => {
    try {
      const made = await team.openDm(p.user_id);
      const id = made?.thread?.id || made?.id;
      if (id) onOpen(id);
    } catch (error) {
      addToast({ variant: "error", title: `Couldn’t start a chat with ${p.name}`, description: opsErrorWords(error) });
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gray-200)] p-2.5">
        <label className="min-w-0 flex-1"><span className="sr-only">Find a chat</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find or start a chat with a teammate" className={`min-h-9 w-full rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 text-[13px] ${FOCUS}`} />
        </label>
        <button type="button" data-new-group-button="" onClick={() => setGrouping((g) => !g)} className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border border-[var(--gray-200)] px-2.5 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />Group
        </button>
      </div>
      {grouping && <NewGroup people={people} onCancel={() => setGrouping(false)} onCreated={(id) => { setGrouping(false); void load(); if (id) onOpen(id); }} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.status === "loading" ? (
          <div aria-busy="true" aria-label="Loading team chats" className="flex flex-col gap-2 p-3"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>
        ) : threads.status === "error" ? (
          <div className="p-3"><LoadError title="Couldn’t load team chats" message={opsErrorWords(threads.error)} onRetry={load} /></div>
        ) : (
          <ul className="flex flex-col">
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" data-thread-row={t.kind} onClick={() => onOpen(t.id)} className={`flex min-h-14 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}>
                  <ThreadAvatar thread={t} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className={`truncate text-[13px] text-[var(--color-text-primary)] ${t.unread ? "font-bold" : "font-semibold"}`}>{t.title || "Chat"}</span>
                      {t.kind !== "dm" && <span className="shrink-0 text-[11.5px] text-[var(--color-text-tertiary)]">{t.member_count}</span>}
                    </span>
                    <span className="block truncate text-[12.5px] text-[var(--color-text-secondary)]">{threadPreview(t)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">{shortTime(t.last_message_at || t.created_at)}</span>
                    {t.unread > 0 && <span className="min-w-[18px] rounded-full bg-[var(--color-brand-500)] px-1.5 text-center text-[11px] font-bold tabular-nums text-white">{t.unread}<span className="sr-only"> unread</span></span>}
                  </span>
                </button>
              </li>
            ))}
            {starters.map((p) => (
              <li key={`p-${p.user_id}`}>
                <button type="button" data-start-dm="" onClick={() => startDm(p)} className={`flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-[var(--gray-50)] ${FOCUS}`}>
                  <PersonAvatar person={{ name: p.name, email: p.email }} />
                  <span className="min-w-0 flex-1 truncate">Start a chat with <b>{p.name}</b></span>
                </button>
              </li>
            ))}
            {shown.length === 0 && starters.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">{query ? "No chat or teammate matches." : "No chats yet. Start one with a teammate."}</li>
            )}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-[var(--gray-200)] px-3 py-2 text-[11.5px] text-[var(--color-text-tertiary)]">
        <span aria-hidden="true" className="text-[var(--color-success-600)]">● </span>Same chats as Mingla team in the Host app.{" "}
        <a href={HOST_TEAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-brand-700)] hover:underline">Open in Mingla Host<ExternalLink aria-hidden="true" className="h-3 w-3" /></a>
      </p>
    </div>
  );
}

function Reactions({ message, onReact }) {
  const list = Array.isArray(message.reactions) ? message.reactions : [];
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {list.map((r) => (
        <button key={r.emoji} type="button" aria-pressed={r.mine ? "true" : "false"} title={(r.names || []).join(", ")} onClick={() => onReact(message, r.emoji, !r.mine)}
          className={`inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[12px] ${r.mine ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)]"} ${FOCUS}`}>
          <span aria-hidden="true">{r.emoji}</span><span className="tabular-nums">{r.count}</span><span className="sr-only">{r.mine ? "Take back your" : "Add your"} {r.emoji} reaction</span>
        </button>
      ))}
      <button type="button" aria-label="Add a reaction" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((o) => !o)} className={`inline-grid h-7 min-w-7 place-items-center rounded-full px-1 text-[12px] text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>☺+</button>
      {open && REACTIONS.map((e) => <button key={e} type="button" aria-label={`React with ${e}`} onClick={() => { setOpen(false); onReact(message, e, true); }} className={`inline-grid h-7 w-7 place-items-center rounded-md text-[15px] hover:bg-[var(--gray-100)] ${FOCUS}`}>{e}</button>)}
    </span>
  );
}

function Thread({ threadId, onBack, allowEveryone }) {
  const { addToast } = useToast();
  const [data, setData] = useState({ status: "loading", value: null, error: null });
  const [people, setPeople] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [viewing, setViewing] = useState(null);
  const scrollRef = useRef(null);
  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const value = await team.getMessages(threadId, 100);
      setData({ status: "ready", value, error: null });
    } catch (error) {
      setData((d) => (quiet && d.value ? d : { status: "error", value: d.value, error }));
    }
  }, [threadId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    team.listPeople().then((rows) => setPeople(Array.isArray(rows) ? rows : [])).catch((error) => console.warn("[Messages] teammates not loaded:", error?.message || error));
  }, []);
  // Reading a chat marks it read (shared with the Host app).
  useEffect(() => {
    if (data.status !== "ready") return;
    team.markThreadRead(threadId).then(announceMessagesChange).catch((error) => console.warn("[Messages] chat not marked read:", error?.message || error));
  }, [threadId, data.status, data.value?.messages?.length]);
  useEffect(() => {
    const ch = supabase.channel(`admin-team-thread-${threadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_messages", filter: `thread_id=eq.${threadId}` }, () => { void load({ quiet: true }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "team_message_reactions" }, () => { void load({ quiet: true }); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [threadId, load]);
  const thread = data.value?.thread;
  const members = useMemo(() => data.value?.members || [], [data.value]);
  const messages = useMemo(() => (Array.isArray(data.value?.messages) ? data.value.messages : []), [data.value]);
  const files = useMemo(() => messages.flatMap((m) => m.attachments || []), [messages]);
  const thumbs = useTeamThumbs(files);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  const days = threadDays(messages.map((m) => ({ ...m, author_email: m.author_id })));
  const adapter = useMemo(() => ({
    upload: (tid, item) => (item.kind === "link" ? team.addLink(tid, item.url, item.name) : team.uploadAttachment(tid, item.file, { kind: item.kind, mime: fileMime(item.file) })),
    post: (tid, { body, emails, parentId, fileIds, everyone }) =>
      team.postMessage(tid, { body, mentions: mentionIds(emails, people, members), replyToId: parentId, attachmentIds: fileIds, everyone, key: `admin_team_${globalThis.crypto?.randomUUID?.() || Date.now()}` }),
  }), [people, members]);
  const react = async (m, emoji, on) => {
    try { await team.reactMessage(m.id, emoji, on); await load({ quiet: true }); }
    catch (error) { addToast({ variant: "error", title: "That didn’t save", description: opsErrorWords(error) }); }
  };
  const openFile = async (file) => {
    if (file.kind === "image") { setViewing(file); return; }
    if (file.kind === "link") { window.open(file.url, "_blank", "noopener,noreferrer"); return; }
    const tab = window.open("", "_blank");
    try {
      const url = await team.attachmentUrl(file.id);
      if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      tab?.close();
      addToast({ variant: "error", title: `Couldn’t open ${file.name}`, description: opsErrorWords(error) });
    }
  };
  const subtitle = thread ? (thread.kind === "dm" ? "Direct message" : members.map((m) => m.name).join(", ")) : "";
  return (
    <div data-team-thread={threadId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-[var(--gray-200)] px-2">
        <button type="button" aria-label="Back to chats" onClick={onBack} className={ICON_BTN}><ArrowLeft aria-hidden="true" className="h-4 w-4" /></button>
        {thread && <ThreadAvatar thread={thread} />}
        <b className="shrink-0 truncate text-[13.5px] text-[var(--color-text-primary)]">{thread?.title || "Chat"}</b>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">{subtitle}</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {data.status === "loading" ? (
          <div aria-busy="true" aria-label="Loading the chat" className="flex flex-col gap-2"><Skeleton height={40} /><Skeleton height={60} /></div>
        ) : data.status === "error" ? (
          <LoadError title="Couldn’t load this chat" message={opsErrorWords(data.error)} onRetry={() => load()} />
        ) : (
          <>
            {data.value?.has_more && <p className="py-1 text-center text-[11.5px] text-[var(--color-text-tertiary)]">Older messages are in the Host app.</p>}
            {messages.length === 0 && <p className="py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">No messages yet. Say hello, share a file or tag a teammate.</p>}
            <ul className="flex min-w-0 flex-col">
              {days.flatMap((d) => [
                <li key={`d-${d.day}`} className="py-2 text-center text-[11.5px] font-semibold text-[var(--color-text-tertiary)]">{d.label}</li>,
                ...d.items.map(({ message: m, collapsed }) => (
                  <li key={m.id} data-team-message={m.id} className={`flex min-w-0 gap-2.5 ${collapsed ? "pt-0.5" : "pt-2"}`}>
                    <span className="w-7 shrink-0">{!collapsed && <PersonAvatar person={{ name: m.author_name, email: m.author_id }} />}</span>
                    <div className="min-w-0 flex-1">
                      {!collapsed && (
                        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
                          <span className="font-semibold text-[var(--color-text-primary)]">{m.author_name}</span>
                          <time dateTime={m.created_at} className="text-[11.5px] text-[var(--color-text-tertiary)]">{clockTime(m.created_at)}</time>
                          {m.edited_at && <span className="text-[11px] text-[var(--color-text-tertiary)]">(edited)</span>}
                        </p>
                      )}
                      {m.reply_to && <p className="truncate border-l-2 border-[var(--gray-300)] pl-2 text-[12px] text-[var(--color-text-tertiary)]">↩ {m.reply_to.author_name}: {m.reply_to.deleted ? "a deleted message" : `“${m.reply_to.excerpt || ""}”`}</p>}
                      {m.deleted ? <p className="text-[12.5px] italic text-[var(--color-text-tertiary)]">This message was deleted.</p>
                        : m.body ? <MarkdownText text={m.body} mentionNames={[...(m.mentions || []).map((x) => x.name), ...(m.everyone ? ["everyone"] : [])]} className="text-[13px] text-[var(--color-text-primary)]" /> : null}
                      {!m.deleted && (m.attachments || []).length > 0 && (
                        <ul className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                          {m.attachments.map((f) => <FileTile key={f.id} file={f} thumb={thumbs[f.id]} onOpen={openFile} compact />)}
                        </ul>
                      )}
                      {!m.deleted && (
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                          <Reactions message={m} onReact={react} />
                          <button type="button" onClick={() => setReplyTo(m)} className={`min-h-7 rounded px-1.5 font-semibold hover:bg-[var(--gray-100)] ${FOCUS}`}>Reply</button>
                        </div>
                      )}
                    </div>
                  </li>
                )),
              ])}
            </ul>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--gray-200)] p-2.5">
        {replyTo && (
          <p className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
            <span className="min-w-0 flex-1 truncate">Replying to <b>{replyTo.author_name}</b></span>
            <button type="button" aria-label="Cancel the reply" onClick={() => setReplyTo(null)} className={`inline-grid h-7 w-7 place-items-center rounded ${FOCUS}`}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </p>
        )}
        {thread && (
          <ThreadComposer key={replyTo?.id || "top"} cardId={threadId} team={composerPeople(people.filter((p) => members.some((x) => x.user_id === p.user_id)))}
            allowEveryone={allowEveryone && thread.kind !== "dm"} parentId={replyTo?.id || null} adapter={adapter}
            placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : `Message ${thread.title || "the chat"}… @ to tag`}
            onPosted={async () => { setReplyTo(null); await load({ quiet: true }); announceMessagesChange(); }} />
        )}
      </div>
      {viewing && <ImageViewer file={viewing} onClose={() => setViewing(null)} resolveUrl={team.attachmentUrl} />}
    </div>
  );
}

/** The Team chats tab: the list, or one chat. `threadId` opens a chat (from a mention or #/messages?thread=). */
export function TeamChats({ threadId = null, onThreadChange }) {
  const { access } = useAuth();
  const allowEveryone = access?.role === "owner" || access?.role === "admin";
  return (
    <div data-team-chats="" className="flex min-h-0 flex-1 flex-col">
      {threadId
        ? <Thread key={threadId} threadId={threadId} allowEveryone={allowEveryone} onBack={() => onThreadChange(null)} />
        : <ChatList onOpen={onThreadChange} />}
    </div>
  );
}
