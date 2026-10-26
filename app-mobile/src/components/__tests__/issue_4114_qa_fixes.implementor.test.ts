// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA fixes. The rules are exercised behaviourally in
// utils/__tests__/issue_4114_qa_*; this suite pins the WIRING so a revert of
// any call site fails CI.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function body(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  assert(match, `missing ${signature}`);
  const start = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

Deno.test("QA1 the composer sends the settled latest text, clears first, and drops only an echo", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const clear = body(chat, /const clearComposerAfterSend = \(\) =>/);
  assert(/chatController\.reset\(\)/.test(clear) && /inputRef\.current\?\.clear\(\)/.test(clear), "controlled and native clear");
  assert(/settle: \(run\) => \{ requestAnimationFrame\(\(\) => run\(\)\); \}/.test(chat), "send waits one frame for native text");
  const send = body(chat, /const handleSendMessage = \(\) =>/);
  assert(/sendCoordinator\.requestSend\(\{\s*read: chatController\.readText,/.test(send), "send reads the controller ref");
  assert(!/newMessage/.test(send), "send never reads the render copy");
  assert(send.indexOf("clearComposerAfterSend()") >= 0 &&
    send.indexOf("clearComposerAfterSend()") < send.indexOf("onSendMessage("), "clears before sending");
  const media = body(chat, /const handleSendPickedMedia = \(\) =>/);
  assert(/read: chatController\.readText/.test(media), "media caption reads the ref too");
  assert(media.indexOf("clearComposerAfterSend(") < media.indexOf("onSendMedia("), "media send clears first too");
  assert(/onChangeText=\{\(text\) => \{\s*if \(!sendCoordinator\.acceptChange\(text\)\) \{\s*inputRef\.current\?\.clear\(\);\s*return;/.test(chat),
    "echo dropped before the controller sees it");
  assert(/onKeyPress=\{\(event\) => \{\s*sendCoordinator\.noteKeystroke\(\);/.test(chat), "key presses end echo suppression");
  const controller = strip(await read("hooks/useChatInputController.ts"));
  assert(/textRef\.current = nextText;/.test(controller), "controller writes the ref synchronously");
  assert(/content: textRef\.current\.trim\(\)/.test(controller), "serialize reads the ref");
});

Deno.test("QA1 one client id is delivered at most once at a time", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const deliver = body(page, /const deliverMessage = async \(conversationId: string, pending: Message\): Promise<void> =>/);
  assert(/if \(sendsInFlightRef\.current\.has\(clientId\)\) return;/.test(deliver), "in-flight client id refused");
  assert(deliver.indexOf("sendsInFlightRef.current.add(clientId)") > deliver.indexOf("sendsInFlightRef.current.has(clientId)"), "marks in flight");
});

Deno.test("QA2a a failed view-once load re-signs once, then gives up", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const retry = body(chat, /const handleViewOnceLoadError = async \(\) =>/);
  assert(/if \(!pending \|\| pending\.retried\) return;/.test(retry), "only one retry");
  assert(retry.indexOf("pending.retried = true") < retry.indexOf("openViewOnceMedia(pending.messageId)"), "marks the retry before asking");
  const open = body(chat, /const handleOpenViewOnce = async \(message: Message\) =>/);
  assert(/viewOnceRetryRef\.current = \{ messageId: message\.id, retried: false \}/.test(open), "a fresh open arms one retry");
  assert(/<ViewOncePhotoViewer[\s\S]*?onLoadError=\{\(\) => \{ void handleViewOnceLoadError\(\); \}\}/.test(chat), "photo viewer reports load errors");
  assert(/<ChatVideoPlayerModal\s+url=\{viewOnceVideoUrl\}[\s\S]*?onLoadError=\{\(\) => \{ void handleViewOnceLoadError\(\); \}\}/.test(chat), "video player reports load errors");
  const photo = strip(await read("components/chat/ViewOncePhotoViewer.tsx"));
  assert(/onError=\{\(\) => \{[\s\S]*?onLoadError\?\.\(\);/.test(photo), "image onError tells the parent");
  assert(/useEffect\(\(\) => \{\s*setLoading\(true\);\s*setFailed\(false\);\s*\}, \[url\]\);/.test(photo), "a new url starts over");
  const video = strip(await read("components/chat/ChatVideoPlayerModal.tsx"));
  assert(/if \(next === "error"\) onLoadErrorRef\.current\?\.\(\);/.test(video), "video error tells the parent");
  assert(/<Player key=\{url\}/.test(video), "a new url gets a new player");
});

Deno.test("QA2b the received view-once bubble uses the dark received tokens", async () => {
  const bubble = strip(await read("components/chat/MessageBubble.tsx"));
  const fn = bubble.slice(bubble.indexOf("function ViewOnceBubble("), bubble.indexOf("export type CollabSystemToken"));
  assert(fn.length > 100, "ViewOnceBubble found");
  assert(!/viewOnceSpent/.test(bubble), "no extra opacity dims the spent bubble");
  assert(/!isMe && styles\.viewOnceSubtitleReceived/.test(fn), "received subtitle on tokens");
  assert(/spent && \(isMe \? styles\.viewOnceMuted : styles\.viewOnceMutedReceived\)/.test(fn), "received spent title on tokens");
  assert(/viewOnceSubtitleReceived: \{\s*color: receivedBubbleTokens\.textSecondary,/.test(bubble), "subtitle token");
  assert(/viewOnceMutedReceived: \{\s*color: receivedBubbleTokens\.textSecondary,/.test(bubble), "muted token");
});

Deno.test("QA2c/QA4 reactions and view-once opens are subscribed on the conversation channel and merged in place", async () => {
  const service = strip(await read("services/messagingService.ts"));
  const sub = service.slice(service.indexOf("subscribeToConversation("), service.indexOf("unsubscribeFromConversation(conversationId: string)"));
  assert(sub.length > 200, "subscribeToConversation found");
  for (const [event, table] of [["INSERT", "direct_message_reactions"], ["DELETE", "direct_message_reactions"], ["INSERT", "message_media_views"]]) {
    assert(new RegExp(`event: '${event}', schema: 'public', table: '${table}'`).test(sub), `${event} ${table} subscribed`);
  }
  assert(/kind: 'reaction_delete', reactionId: id/.test(sub), "delete by id");
  assert(/\.select\('id, message_id, user_id, emoji, created_at'\)/.test(service), "page reads keep reaction ids");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const setup = body(page, /const setupRealtimeSubscription = \(conversationIds: string \| readonly string\[\], userId: string\) =>/);
  assert(/onLiveChange: \(change: ChatLiveChange\) =>/.test(setup), "the page listens");
  assert(/applyChatLiveChange\(existing, change\)/.test(setup), "merged into the store, no refetch");
  assert(!/onLiveChange[\s\S]*?fetchMessages|onLiveChange[\s\S]*?loadMessages/.test(setup.slice(setup.indexOf("onLiveChange"))), "no thread refetch");
  const migration = await Deno.readTextFile(new URL("../../supabase/migrations/20271230074114_issue_4114_chat_live_updates.sql", root));
  assert(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.direct_message_reactions;/.test(migration) &&
    /ALTER PUBLICATION supabase_realtime ADD TABLE public\.message_media_views;/.test(migration), "both tables published");
});

Deno.test("QA3 a pending 1:1 collab is watched until the friend's join activates it", async () => {
  const { dmCollabSessionToWatch } = await import("../chat/dmCollabModel.ts");
  const base = { id: "s1", name: "", createdBy: "ben", createdAt: "t", participants: [] };
  assert(dmCollabSessionToWatch({ ...base, status: "pending" }) === "s1", "pending is watched");
  assert(dmCollabSessionToWatch({ ...base, status: "active" }) === null, "active is not");
  assert(dmCollabSessionToWatch(null) === null, "no session, no watch");
  const hook = strip(await read("hooks/useDmCollabSession.ts"));
  assert(/const watchedSessionId = dmCollabSessionToWatch\(query\.data\);/.test(hook), "the hook watches the pending session");
  assert(/event: 'UPDATE', schema: 'public', table: 'collaboration_sessions', filter: `conversation_id=eq\.\$\{conversationId\}`/.test(hook),
    "on its status");
  assert(/invalidateQueries\(\{ queryKey: dmCollabKeys\.session\(conversationId \?\? null\) \}\)/.test(hook.slice(hook.indexOf("watchedSessionId"))),
    "and re-reads the header's session");
  assert(/supabase\.removeChannel\(channel\)/.test(hook), "and lets the channel go");
});

Deno.test("QA5 opening a chat reads the whole chat, and an older page is read too", async () => {
  const { idsStillUnread } = await import("../../utils/threadModel.ts");
  const ids = idsStillUnread(["a", "b", "c", "b", ""], ["a"]);
  assert(JSON.stringify(ids) === '["b","c"]', `only unread ids, once: ${JSON.stringify(ids)}`);
  const service = strip(await read("services/messagingService.ts"));
  const mark = body(service, /async markConversationRead\(conversationId: string, userId: string\): Promise<\{ error: string \| null \}>/);
  assert(/\.eq\('conversation_id', conversationId\)\s*\.neq\('sender_id', userId\)/.test(mark), "every message from others in the chat");
  assert(/idsStillUnread\(ids, readIds\)/.test(mark) && /\.from\('message_reads'\)\s*\.upsert\(/.test(mark), "upserts the missing reads");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const onOpen = body(page, /const markConversationAsRead = useCallback\(/);
  assert(/messagingService\.markConversationRead\(conversationId, userId\)/.test(onOpen), "open marks the whole chat");
  assert(!/messagingService\.markAsRead\(unreadIds/.test(onOpen), "not only the loaded page");
  const older = body(page, /const handleLoadOlderMessages = async \(\) =>/);
  assert(/if \(transformed\.some\(\(m\) => !m\.isMe && m\.unread\)\)/.test(older) &&
    /markConversationAsRead\(conversationId, user\.id, transformed\)/.test(older), "an older page with unread rows is read");
});
