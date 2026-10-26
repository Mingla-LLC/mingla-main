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

Deno.test("QA1 the composer clears before it sends and drops the iOS echo", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const clear = body(chat, /const clearComposerAfterSend = \(sentText: string\) =>/);
  assert(/sentSnapshotRef\.current = \{ text: sentText, at: Date\.now\(\) \}/.test(clear), "snapshots the sent text");
  assert(/chatController\.reset\(\)/.test(clear) && /inputRef\.current\?\.clear\(\)/.test(clear), "controlled and native clear");
  const send = body(chat, /const handleSendMessage = \(\) =>/);
  assert(/isDuplicateSend\(sentSnapshotRef\.current, sentText, Date\.now\(\)\)\) return;/.test(send), "double tap refused");
  assert(send.indexOf("clearComposerAfterSend(sentText)") >= 0 &&
    send.indexOf("clearComposerAfterSend(sentText)") < send.indexOf("onSendMessage("), "clears before sending");
  const media = body(chat, /const handleSendPickedMedia = \(\) =>/);
  assert(media.indexOf("clearComposerAfterSend(") < media.indexOf("onSendMedia("), "media send clears first too");
  assert(/onChangeText=\{\(text\) => \{\s*if \(isComposerSendEcho\(sentSnapshotRef\.current, text, Date\.now\(\)\)\) \{\s*inputRef\.current\?\.clear\(\);\s*return;/.test(chat),
    "echo dropped before the controller sees it");
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
