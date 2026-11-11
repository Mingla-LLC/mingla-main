// Issue #4255 (W4, D11) — Messages' three tabs (Notifications, Team chats,
// Settings), shared by the 440px panel under the top bar and the full page
// at #/messages. The numbers come from the one Messages poll (useMessages).
import { useId } from "react";
import { MESSAGES_TABS } from "../../lib/messagesModel";
import { MessagesNotifications } from "./MessagesNotifications";
import { TeamChats } from "./TeamChats";
import { MessagesSettings } from "./MessagesSettings";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function MessagesBody({ messages, tab, threadId, onChange }) {
  const base = useId();
  const counts = {
    notifications: Math.max(0, (messages.count ?? 0) - Number(messages.badge?.chats || 0)),
    chats: Number(messages.badge?.chats || 0),
    settings: 0,
  };
  const openChat = (id) => onChange("chats", id);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Messages" className="flex shrink-0 gap-1 border-b border-[var(--gray-200)] px-2.5 pb-2">
        {MESSAGES_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${base}-tab-${t.id}`} aria-selected={tab === t.id ? "true" : "false"} aria-controls={`${base}-panel`}
            data-messages-tab={t.id} onClick={() => onChange(t.id, null)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ${t.id === "settings" ? "ml-auto" : ""} ${tab === t.id ? "bg-[var(--gray-100)] font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
            {t.label}
            {counts[t.id] > 0 && <span className="min-w-[18px] rounded-full bg-[var(--color-brand-500)] px-1.5 text-center text-[11px] font-bold tabular-nums text-white">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "notifications" && <MessagesNotifications messages={messages} onOpenChat={openChat} />}
        {tab === "chats" && <TeamChats threadId={threadId} onThreadChange={(id) => onChange("chats", id)} />}
        {tab === "settings" && <MessagesSettings />}
      </div>
    </div>
  );
}
