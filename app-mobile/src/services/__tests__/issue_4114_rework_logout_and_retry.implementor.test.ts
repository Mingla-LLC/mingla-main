// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 rework — two Explorer wiring fixes the runtime cannot reach from
// Deno (both files import React Native modules), pinned at source level:
//   * logout clears the per-account `chat:seen-matches:` keys (Constitution #6),
//     and the signed chat-media link cache is still cleared there;
//   * a send retry whose first attempt already landed (the 23505 path) returns
//     the stored row WITHOUT sending the push notifications a second time.
//
// FAILS-ON-REVERT: delete the SEEN_MATCHES_KEY_PREFIX line from
// isPrivateAsyncStorageKey, or the `if (!alreadySent)` guard (or the
// `alreadySent = true` line) in messagingService.sendMessage, and this fails.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function methodText(source: string, name: string): string {
  const start = source.indexOf(`  async ${name}(`);
  assert(start >= 0, `missing method ${name}`);
  const next = source.slice(start + 1).search(/\n  (?:private )?async \w+\(/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

Deno.test("#4114 logout clears the seen-matches keys and the chat media links", async () => {
  const hook = stripComments(await read("hooks/useSeenSessionMatches.ts"));
  const prefix = /export const SEEN_MATCHES_KEY_PREFIX = "([^"]+)"/.exec(hook);
  assert(prefix && prefix[1] === "chat:seen-matches:", "the hook exports its key prefix");
  assert(/`\$\{KEY_PREFIX\}\$\{sessionId\}`/.test(hook) && /const KEY_PREFIX = SEEN_MATCHES_KEY_PREFIX/.test(hook),
    "the hook stores under the exported prefix");

  const cleanup = stripComments(await read("utils/authCleanup.ts"));
  const fn = cleanup.slice(cleanup.indexOf("function isPrivateAsyncStorageKey"), cleanup.indexOf("export async function performPrivateAuthCleanup"));
  assert(/key\.startsWith\(SEEN_MATCHES_KEY_PREFIX\)\) return true/.test(fn), "seen-matches keys are private and removed on logout");
  assert(/import \{ SEEN_MATCHES_KEY_PREFIX \} from "\.\.\/hooks\/useSeenSessionMatches"/.test(cleanup), "one owner for the prefix");
  assert(/clearChatMediaUrlCache\(\)/.test(cleanup), "logout still clears the signed chat media links");
  assert(/privateKeys = allKeys\.filter\(isPrivateAsyncStorageKey\)/.test(cleanup), "the private-key filter drives the removal");
});

Deno.test("#4114 a retry that finds its first send already stored does not notify again", async () => {
  const service = stripComments(await read("services/messagingService.ts"));
  const send = methodText(service, "sendMessage");
  const conflictAt = send.indexOf("error.code === '23505'");
  const flagAt = send.indexOf("alreadySent = true");
  const notifyAt = send.indexOf("this.sendPartitionedMessageNotifications(");
  assert(conflictAt > 0, "the 23505 path exists");
  assert(/let alreadySent = false;/.test(send), "the flag starts false for a new send");
  assert(flagAt > conflictAt && flagAt < notifyAt, "only the 23505 path marks the row as already sent");
  assert((send.match(/alreadySent = true/g) ?? []).length === 1, "nothing else marks a send as a duplicate");
  assert(/if \(!alreadySent\) \{\s*this\.sendPartitionedMessageNotifications\(/.test(send),
    "push notifications are skipped for a row that already existed");
  assert((send.match(/sendPartitionedMessageNotifications\(/g) ?? []).length === 1, "one notification call site");
});
