// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4456 — the Chats list preview of an unsent last message, and the
// Chats list's live channel.
//
// MINGLA-INVARIANT: I-4456-CHAT-LIST-LIVE | issue #4456 | while the Chats list is open, an UPDATE on any of my conversations (a new message bumps last_message_at, an unsend bumps updated_at) refetches the list, on its own channel, debounced; chat membership changes refetch the list too
//
// FAILS-ON-REVERT: drop the chat-list channel, move the conversations binding
// onto the shared social channel, put ["messages"] back on the membership
// binding, or show the unsent text (or "Ana: …") in the preview, and the
// matching case fails.

import { chatTombstonePreview } from "../chatListModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
const t = (key: string, params?: Record<string, unknown>) => (params?.name ? `${key}:${params.name}` : key);
const names: Record<string, string> = { ana: "Ana Lopez", sam: "Sam Okafor", me: "Jordan" };
const nameOf = (id: string) => names[id] ?? null;

Deno.test("#4456 Chats list: the unsent line replaces the preview", () => {
  const preview = (message) => chatTombstonePreview({ message, currentUserId: "me", nameOf, t });
  assertEquals(preview({ sender_id: "me", unsent_kind: "sender", unsent_by: "me" }), "chat:tombstoneYouUnsent", "you");
  assertEquals(preview({ sender_id: "ana", sender_name: "Ana Lopez", unsent_kind: "sender", unsent_by: "ana" }), "chat:tombstoneTheyUnsent:Ana", "Ana, first name, no prefix");
  assertEquals(preview({ sender_id: "ana", unsent_kind: "sender", unsent_by: "ana" }), "chat:tombstoneTheyUnsent:Ana", "name from the members");
  assertEquals(preview({ sender_id: "ana", unsent_kind: "admin", unsent_by: "me" }), "chat:tombstoneYouRemoved", "you removed");
  assertEquals(preview({ sender_id: "me", unsent_kind: "admin", unsent_by: "sam" }), "chat:tombstoneAdminRemovedYours:Sam", "Sam removed yours");
  assertEquals(preview({ sender_id: "ana", unsent_kind: "admin", unsent_by: "sam" }), "chat:tombstoneAdminRemoved:Sam", "Sam removed");
  assertEquals(preview({ sender_id: "ana", unsent_kind: null }), null, "a live message keeps its preview");
  // #4459: the brand removing a message in its Guest chat reads "Message removed by <Brand>".
  assertEquals(
    chatTombstonePreview({ message: { sender_id: "ana", unsent_kind: "host" }, currentUserId: "me", nameOf, t, brandName: "Club X" }),
    "chat:tombstoneHostRemoved:Club X",
    "a brand removal names the brand",
  );
  assertEquals(preview({ sender_id: "ana", unsent_kind: "host" }), "chat:tombstoneHostRemovedGeneric", "without a brand name, the host");
  assertEquals(preview({ sender_id: "ana", unsent_kind: "server" }), null, "hidden kinds are not previewed as unsent");
  assertEquals(preview(null), null, "no message");
});

Deno.test("#4456 Chats list row renders the line in italics, not as unread", async () => {
  const row = await Deno.readTextFile(new URL("../ChatListItem.tsx", import.meta.url));
  assert(/tombstonePreview \? styles\.previewUnsent : unread \? styles\.previewUnread : null/.test(row), "unsent style wins over unread");
  assert(/previewUnsent: \{\s*fontStyle: 'italic',\s*fontWeight: '400'/.test(row), "italic, regular weight");
});

function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

Deno.test("#4456 the Chats list listens for conversation updates on its own channel", async () => {
  const hook = strip(await Deno.readTextFile(new URL("../../../hooks/useSocialRealtime.ts", import.meta.url)));
  const start = hook.indexOf(".channel(`chat-list-live-");
  assert(start >= 0, "chat-list-live channel");
  const body = hook.slice(start, hook.indexOf(".subscribe();", start));
  assertEquals([...body.matchAll(/table:\s*"([a-z_]+)"/g)].map((m) => m[1]), ["conversations"], "binds conversations only");
  assert(/event: "UPDATE"/.test(body), "UPDATE events");
  assert(!/filter:/.test(body), "no filter: RLS scopes it to my chats");
  assert(/refreshChatListSoon\(\)/.test(body), "debounced list refetch");
  assert(/const refreshChatListSoon = \(\) => \{\s*if \(chatListTimer\) clearTimeout\(chatListTimer\);\s*chatListTimer = setTimeout\(\(\) => \{\s*chatListTimer = null;\s*void queryClient\.invalidateQueries\(\{ queryKey: chatListKeys\.all \}\);\s*\}, CHAT_LIST_LIVE_DEBOUNCE_MS\);/.test(hook), "one 750 ms debounce");
  assert(/removeChannel\(chatListChannel\)/.test(hook) && /clearTimeout\(chatListTimer\)/.test(hook), "cleaned up");
  const social = hook.slice(hook.indexOf(".channel(`social-realtime-"), hook.indexOf(".subscribe();", hook.indexOf(".channel(`social-realtime-")));
  assert(!/table: "conversations"/.test(social), "not on the shared social channel (#4435 trap)");
  // Tester F-3: read receipts change membership rows, so this is debounced too.
  assert(/table: "conversation_participants"[\s\S]*?refreshChatListSoon\(\);/.test(social), "membership refreshes the list, debounced");
  assert(!/queryKey: \["messages"\]/.test(hook), "the unused messages key is gone");
});
