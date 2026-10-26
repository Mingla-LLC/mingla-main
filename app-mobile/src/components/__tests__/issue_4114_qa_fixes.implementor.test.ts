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
