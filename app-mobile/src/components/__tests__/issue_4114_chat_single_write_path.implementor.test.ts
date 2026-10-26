// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 1 — the chat screen routes every message write through the
// one merge, sends carry a client id that retries reuse, and switching chats
// releases the previously subscribed conversation.
//
// The merge itself is exercised behaviourally in
// src/utils/__tests__/issue_4114_merge_messages.implementor.happy.test.ts; this
// suite pins the wiring so a revert of any call site fails CI.
//
// FAILS-ON-REVERT: restoring the sender + content + 5-second guess, a second
// `setMessages` list, `unsubscribeFromConversation(conversationId)` in
// setupRealtimeSubscription, or a sendMessage without client_id fails here.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function functionBody(source: string, signature: RegExp): string {
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

Deno.test("#4114 ConnectionsPage: one store, every write merged, no 5-second guess", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));

  assert(!/setMessages\s*\(/.test(page), "there must be no second visible-messages list (setMessages)");
  assert(!/<\s*5000/.test(page), "the sender + content + 5-second optimistic guess must stay deleted");
  assert(/from\s+"\.\.\/utils\/mergeMessages"/.test(page), "ConnectionsPage imports the merge");

  const writer = functionBody(page, /const writeConversationMessages = useCallback\(\s*\(/);
  assert(/mergeMessages\(/.test(writer), "writeConversationMessages merges");

  // Every setMessagesCache write either goes through mergeMessages or is a pure
  // patch of a row the store already holds via mergeMessages.
  const cacheWrites = page.match(/setMessagesCache\(/g) ?? [];
  const mergedCacheWrites = page.match(/setMessagesCache\([\s\S]{0,600}?mergeMessages\(/g) ?? [];
  assert(cacheWrites.length > 0 && cacheWrites.length === mergedCacheWrites.length,
    `every setMessagesCache write must merge (${mergedCacheWrites.length}/${cacheWrites.length})`);

  const incoming = functionBody(page, /const addIncomingMessageToUI = useCallback\(\s*\(/);
  assert(/writeConversationMessages\(/.test(incoming), "the realtime/broadcast path writes through the merge");
  assert(incoming.indexOf("writeConversationMessages(") < incoming.indexOf("broadcastSeenIds.current.add("),
    "I-DEDUP-AFTER-DELIVERY: the seen-set add comes after the store write");

  const deliver = functionBody(page, /const deliverMessage = async \(/);
  assert(/messagingService\.sendMessage\([\s\S]*clientId,\s*(\{[^}]*\},\s*)?\)/.test(deliver), "every send passes its client id");
  assert(/writeConversationMessages\(conversationId, \[transformMessage\(sentMessage/.test(deliver),
    "the send result is merged, not swapped by temp id");

  const retry = functionBody(page, /const handleRetryMessage = \(/);
  assert(/clientId: failedMessage\.clientId \?\?/.test(retry) && /deliverMessage\(/.test(retry),
    "retry reuses the failed bubble's client id");

  // Wave 4 (#4114) moved the media upload into deliverMessage (one upload
  // service, progress and cancel on the bubble), so the bubble now shows when
  // the send starts and the server's created_at replaces its time on confirm.
  const send = functionBody(page, /const handleSendMessage = async \(/);
  assert(!/getPublicUrl\(/.test(send) && /deliverMessage\(conversationId, optimisticMsg\)/.test(send),
    "a send posts its optimistic bubble and delivers it through deliverMessage");

  // Refresh paths merge as snapshots instead of replacing the list.
  const snapshots = page.match(/writeConversationMessages\([^;]*\{ snapshot: \{ complete: !hasMore \} \}\)/g) ?? [];
  assert(snapshots.length >= 3, `open, pick-friend and reconnect refreshes merge as snapshots (found ${snapshots.length})`);
  const hydrate = functionBody(page, /const hydrateMessages = useCallback\(\s*async \(/);
  assert(/mergeMessages\(\[\], parsed/.test(hydrate), "AsyncStorage hydrate dedupes through the merge");
});

Deno.test("#4114 ConnectionsPage: switching chats releases the subscribed conversation, not the new one", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  const setup = functionBody(page, /const setupRealtimeSubscription = \(/);
  assert(!/unsubscribeFromConversation\(conversationId\)/.test(setup), "must not unsubscribe the id being opened");
  assert(/switchConversationSubscription\(\s*subscribedConversationIdRef/.test(setup), "switch releases the remembered id");
  const back = functionBody(page, /const handleBackFromMessage = useCallback\(\s*\(\) =>/);
  assert(/releaseConversationSubscription\(subscribedConversationIdRef/.test(back), "back releases the remembered id");
});

// A class method's text: from its signature to the next method (its return type
// contains braces, so brace matching from the signature is not reliable).
function methodText(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  assert(start >= 0, `missing method ${name}`);
  const next = source.slice(start + 1).search(/\n  (?:private )?async \w+\(/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

Deno.test("#4114 messagingService: idempotent send by client_id and cursor paging", async () => {
  const service = stripComments(await read("services/messagingService.ts"));
  const send = methodText(service, "sendMessage");
  assert(/client_id: clientId/.test(send), "insert carries client_id");
  assert(/error\.code === '23505'/.test(send) && /\.eq\('client_id', clientId\)/.test(send) && /\.eq\('sender_id', senderId\)/.test(send),
    "a duplicate client id returns the sender's existing row");
  const get = methodText(service, "getMessages");
  assert(/\.lte\('created_at', before\)/.test(get), "getMessages pages backwards from a created_at cursor");
  assert(/hasMore/.test(get), "getMessages reports whether older history exists");
  assert(/client_id\?: string \| null;/.test(service), "DirectMessage carries client_id");
});

Deno.test("#4114 thread UI: failed bubbles retry, older history loads on scroll up", async () => {
  const thread = stripComments(await read("components/MessageInterface.tsx"));
  assert(/onEndReached=\{hasOlderMessages && !isLoadingOlderMessages \? onLoadOlderMessages : undefined\}/.test(thread),
    "inverted list loads older messages at its end (the visual top)");
  assert(/ListFooterComponent=\{\s*isLoadingOlderMessages/.test(thread), "spinner while older messages load");
  assert(/onRetry=\{item\.message\.failed && onRetryMessage/.test(thread), "failed bubbles get a retry handler");
  const bubble = stripComments(await read("components/chat/MessageBubble.tsx"));
  assert(/onPress=\{onRetry\}/.test(bubble) && /chat:failedTapToRetry/.test(bubble), "failed status is a tap-to-retry button");
});

Deno.test("#4114 retry and paging copy exists in all 29 locales", async () => {
  const locales = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
  for (const locale of locales) {
    const chat = JSON.parse(await read(`i18n/locales/${locale}/chat.json`));
    for (const key of ["failedTapToRetry", "loadingOlderMessages", "olderMessagesFailed"]) {
      assert(typeof chat[key] === "string" && chat[key].trim().length > 0, `${locale}/chat.json missing ${key}`);
    }
  }
});
