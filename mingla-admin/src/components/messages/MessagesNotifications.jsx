// Issue #4255 (W4, D11) — the Notifications tab of Messages (panel and full
// page). For you / Watching / All chips; grouped by card: decisions first,
// then mentions and replies, then support alerts (#3988, still their own
// group), then changes on cards you watch. "+N more on this card" nests the
// rest. Unread rows are flat with an orange dot and a bold title (no halo).
// Each row: Open card (or Review and approve), Reply (inline, into the card's
// thread), Done (marks it read, here and in the Host app).
import { useMemo, useState } from "react";
import { CheckCheck } from "lucide-react";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import * as collaboration from "../../services/teamCollaborationService";
import * as ops from "../../services/opsService";
import { markInboxRead } from "../../services/dashboardService";
import { announceMessagesChange } from "../../hooks/useMessages";
import { alertHashRoute, SUPPORT_ALERT_TYPES } from "../../lib/emailAlerts";
import { NOTIFICATION_FILTERS, notificationGroups, rowTarget } from "../../lib/messagesModel";
import { opsErrorWords, requestKey } from "../../lib/opsModel";
import { timeAgo } from "../../lib/formatters";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const ACT = `min-h-8 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] hover:text-[var(--color-text-primary)] ${FOCUS}`;
const GROUP_DOT = { brand: "bg-[var(--color-brand-500)]", info: "bg-[var(--color-info-500)]", warning: "bg-[var(--color-warning-500)]", success: "bg-[var(--color-success-500)]" };
const EMPTY_WORDS = {
  you: "You are all caught up. Mentions, decisions and support alerts for you show here.",
  watch: "No changes on cards you own or watch.",
  all: "Nothing here yet.",
};

async function markRead(source) {
  if (!source || source.read_at) return;
  if (source.type === "mention") await collaboration.markMentionRead(source.id);
  else if (source.type === "support") await collaboration.markSupportAlertRead(source.id);
}

function Row({ row, onOpenChat, onHide }) {
  const { addToast } = useToast();
  const [folded, setFolded] = useState(true);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const target = row.kind === "support" ? (alertHashRoute(row.alert) ? { hash: alertHashRoute(row.alert) } : null) : rowTarget(row);
  const done = async () => {
    setBusy(true);
    try {
      await Promise.all(row.sources.map(markRead));
      onHide(row);
      announceMessagesChange();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t mark it done", description: opsErrorWords(error) });
    } finally { setBusy(false); }
  };
  const open = async () => {
    if (!target) return;
    markRead(row.source).then(announceMessagesChange).catch((error) => console.warn("[Messages] not marked read:", error?.message || error));
    if (target.tab === "chats") onOpenChat(target.threadId);
    else window.location.hash = target.hash;
  };
  const sendReply = async (e) => {
    e.preventDefault();
    const body = reply.trim();
    if (!body || busy || !row.cardId) return;
    setBusy(true);
    try {
      await ops.postMessage(row.cardId, { body, key: requestKey("web_msg") });
      await markRead(row.source);
      setReply(""); setReplying(false);
      addToast({ variant: "success", title: "Replied in the card’s thread" });
      announceMessagesChange();
    } catch (error) {
      addToast({ variant: "error", title: "Your reply didn’t send", description: `${opsErrorWords(error)} Your words are kept.` });
    } finally { setBusy(false); }
  };
  return (
    <li data-notification={row.group} data-unread={row.isNew ? "true" : "false"} className="flex min-w-0 gap-2.5 px-3 py-2.5">
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.isNew ? "bg-[var(--color-brand-500)]" : "bg-transparent"}`} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)] ${row.isNew ? "font-bold" : "font-medium"}`}>{row.isNew && <span className="sr-only">Unread: </span>}{row.title}</span>
          {row.at && <span className="shrink-0 text-[11.5px] text-[var(--color-text-tertiary)]">{timeAgo(row.at)}</span>}
        </p>
        <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-[var(--color-text-secondary)]">
          <span className="shrink-0 rounded bg-[var(--gray-100)] px-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">{row.label}</span>
          <span className="min-w-0 break-words">{row.detail}</span>
        </p>
        {row.more.length > 0 && (folded ? (
          <button type="button" onClick={() => setFolded(false)} className={`mt-1 text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>+{row.more.length} more on this {row.threadId && !row.cardId ? "chat" : "card"}</button>
        ) : (
          <div className="mt-1 flex flex-col gap-1 border-l-2 border-[var(--gray-200)] pl-2">
            {row.more.map((m) => <p key={m.key} className="text-[12px] text-[var(--color-text-secondary)]"><b className="font-semibold text-[var(--color-text-primary)]">{m.actor || m.title}</b> {m.detail} · <span className="text-[var(--color-text-tertiary)]">{timeAgo(m.at)}</span></p>)}
            <button type="button" onClick={() => setFolded(true)} className={`self-start text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Show less</button>
          </div>
        ))}
        {replying && (
          <form onSubmit={sendReply} className="mt-1.5 flex min-w-0 gap-1.5">
            <label className="min-w-0 flex-1"><span className="sr-only">Reply in the card’s thread</span>
              <input autoFocus value={reply} maxLength={10000} onChange={(e) => setReply(e.target.value)} placeholder="Reply in the card’s thread…" className={`min-h-9 w-full rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-[13px] ${FOCUS}`} />
            </label>
            <button type="submit" disabled={busy || !reply.trim()} className={`min-h-9 rounded-md bg-[var(--color-brand-500)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50 ${FOCUS}`}>Send</button>
          </form>
        )}
        <div className="mt-1 flex flex-wrap gap-0.5">
          {target && <button type="button" onClick={open} className={ACT}>{row.group === "decide" ? "Review and approve" : row.kind === "chat" ? "Open chat" : row.kind === "support" ? "Open" : "Open card"}</button>}
          {row.kind === "card" && row.group === "mention" && <button type="button" onClick={() => setReplying((r) => !r)} aria-expanded={replying ? "true" : "false"} className={ACT}>Reply</button>}
          <button type="button" disabled={busy} onClick={done} className={ACT}>Done</button>
        </div>
      </div>
    </li>
  );
}

export function MessagesNotifications({ messages, onOpenChat }) {
  const { addToast } = useToast();
  const [filter, setFilter] = useState("you");
  const [hidden, setHidden] = useState(() => new Set());
  const [marking, setMarking] = useState(false);
  const groups = useMemo(() => notificationGroups(messages.inbox, filter, hidden), [messages.inbox, filter, hidden]);
  const unreadShown = groups.some((g) => g.rows.some((r) => r.isNew));
  const markAll = async () => {
    setMarking(true);
    try {
      await markInboxRead(filter === "watch" ? "work_updates" : "all", SUPPORT_ALERT_TYPES);
      await messages.refetch();
      addToast({ variant: "success", title: "Marked as read" });
    } catch (error) {
      addToast({ variant: "error", title: "Couldn’t mark them read", description: opsErrorWords(error) });
    } finally { setMarking(false); }
  };
  return (
    <div data-messages-notifications="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--gray-200)] px-3 py-2">
        <div role="group" aria-label="Show" className="flex gap-1">
          {NOTIFICATION_FILTERS.map((f) => (
            <button key={f.id} type="button" data-filter={f.id} aria-pressed={filter === f.id ? "true" : "false"} onClick={() => setFilter(f.id)}
              className={`min-h-8 rounded-full border px-3 text-[12.5px] font-semibold ${filter === f.id ? "border-[var(--gray-900)] bg-[var(--gray-900)] text-[var(--color-background-primary)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={marking || !unreadShown} onClick={markAll} className={`ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] disabled:opacity-40 ${FOCUS}`}>
          <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />Mark all read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.inboxError && !messages.inbox ? (
          <div className="p-3"><LoadError title="Couldn’t load your notifications" message={opsErrorWords(messages.inboxError)} onRetry={messages.refetch} /></div>
        ) : messages.loading ? (
          <div aria-busy="true" aria-label="Loading notifications" className="flex flex-col gap-2 p-3"><Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} /></div>
        ) : groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--color-text-tertiary)]">{EMPTY_WORDS[filter]}</p>
        ) : (
          groups.map((g) => (
            <section key={g.id} data-group={g.id} aria-label={g.label}>
              <h3 className="flex items-center gap-1.5 px-3 pb-0.5 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${GROUP_DOT[g.tone]}`} />{g.label}
              </h3>
              <ul className="divide-y divide-[var(--gray-100)]">
                {g.rows.map((row) => <Row key={row.key} row={row} onOpenChat={onOpenChat} onHide={(r) => setHidden((h) => new Set([...h, ...[r, ...r.more].map((x) => x.key)]))} />)}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
