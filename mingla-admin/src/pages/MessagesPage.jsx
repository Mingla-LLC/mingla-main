// Issue #4255 (W4, D11) — Messages, full page (#/messages). The same three
// tabs as the panel under the top bar: Notifications, Team chats, Settings.
// It replaces the Notifications page: #/notifications redirects here
// (lib/adminRoutes.js), so old links in emails keep working, and a team chat
// mention's link (#/messages?thread=<id>) opens that chat.
import { PageHeader } from "../components/ui/PageHeader";
import { MessagesBody } from "../components/messages/MessagesBody";
import { useMessages } from "../hooks/useMessages";
import { useHashQuery } from "../hooks/useHashQuery";
import { MESSAGES_TABS, threadFromSearch } from "../lib/messagesModel";

function tabFromSearch(search, thread) {
  let tab = "";
  try { tab = new URLSearchParams(search).get("tab") || ""; } catch { tab = ""; }
  if (thread) return "chats";
  return MESSAGES_TABS.some((t) => t.id === tab) ? tab : "notifications";
}

export function MessagesPage() {
  const messages = useMessages();
  const [search, setSearch] = useHashQuery("messages");
  // The address is the one truth for the open tab and chat.
  const threadId = threadFromSearch(search);
  const tab = tabFromSearch(search, threadId);
  const write = (nextTab, nextThread) => {
    const q = new URLSearchParams();
    if (nextTab !== "notifications") q.set("tab", nextTab);
    if (nextTab === "chats" && nextThread) q.set("thread", nextThread);
    setSearch(q.toString(), { replace: true });
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Messages" description="Notifications for you, team chats and your settings. The same as the Messages button at the top." />
      <div data-messages-page="" className="flex h-[calc(100dvh-var(--header-height)-10rem)] min-h-[480px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] pt-2">
        <MessagesBody messages={messages} tab={tab} threadId={threadId}
          onChange={(t, id) => write(t, id)} />
      </div>
    </div>
  );
}
