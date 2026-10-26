// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 07a): a server-side allowance
// refusal showed "Not sent. Tap to retry" because the app compared usage with
// a hardcoded 200 MB instead of the server's limit, and the bubble behind the
// limit toast offered a retry that cannot work.
//
// FAILS-ON-REVERT: compare against the hardcoded 200 MB when the server says
// otherwise, skip the allowance read on a dropped upload, or let a
// daily-limit bubble offer retry, and the matching case fails.

import {
  DAILY_CHAT_MEDIA_BYTES,
  isOverDailyQuota,
  wouldExceedDailyLimit,
} from "../chatMedia.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const MB = 1024 * 1024;

Deno.test("QA run 2: the server's limit wins over the 200 MB fallback", () => {
  const quota = { usedBytes: 4 * MB, limitBytes: 5 * MB };
  assert(isOverDailyQuota(quota, 2 * MB), "a 5 MB server limit refuses 4 + 2 MB");
  assert(!isOverDailyQuota(quota, 1 * MB), "exactly the server limit is allowed");
  assert(!isOverDailyQuota({ usedBytes: 210 * MB, limitBytes: 500 * MB }, 1 * MB), "a higher server limit allows past 200 MB");
  assert(!isOverDailyQuota(null, 999 * MB), "no quota read: storage still enforces");
});

Deno.test("QA run 2: 200 MB stays only as the fallback", () => {
  assert(DAILY_CHAT_MEDIA_BYTES === 200 * MB, "fallback is 200 MB");
  assert(wouldExceedDailyLimit(190 * MB, 10 * MB + 1), "fallback used when no limit is given");
  assert(wouldExceedDailyLimit(190 * MB, 10 * MB + 1, Number.NaN), "a bad limit falls back");
});

Deno.test("QA run 2: every upload failure asks the server's allowance", async () => {
  const service = strip(await read("services/chatMediaUploadService.ts"));
  assert(!/wouldExceedDailyLimit\(/.test(service), "the service never uses the hardcoded limit directly");
  const calls = service.match(/isOverDailyQuota\(await readChatMediaQuota\(\), size\)\) throw new ChatMediaUploadError\('daily_limit'\)/g) ?? [];
  assert(calls.length === 3, `before upload, after a dropped upload, after a refused upload (got ${calls.length})`);
  const network = service.slice(service.indexOf("response = await task.uploadAsync();"));
  assert(network.indexOf("isOverDailyQuota(") < network.indexOf("new ChatMediaUploadError('network'"), "a dropped upload is checked first");
});

Deno.test("QA run 2: the daily-limit bubble says so and offers no retry", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/markFailed\(code === "daily_limit" \? "daily_limit" : undefined\);/.test(page), "upload refusal marks the reason");
  const retry = page.slice(page.indexOf("const handleRetryMessage = "));
  assert(/if \(failedMessage\.failedReason === "daily_limit"\) return;/.test(retry.slice(0, 900)), "retry refused");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/onRetry=\{item\.message\.failed && !item\.message\.failedReason && onRetryMessage/.test(chat), "no retry button");
  assert(/if \(item\.message\.failed && !item\.message\.failedReason && onRetryMessage\) \{/.test(chat), "no bubble tap retry");
  assert(/failedReason: message\.failedReason,/.test(chat), "reason reaches the bubble");
  const bubble = strip(await read("components/chat/MessageBubble.tsx"));
  const status = bubble.slice(bubble.indexOf("{isMe && isFailed && ("));
  assert(status.indexOf("message.failedReason === 'daily_limit'") >= 0 &&
    status.indexOf("message.failedReason === 'daily_limit'") < status.indexOf("onRetry ?"), "limit state before retry");
  assert(/t\('chat:failedDailyLimit'\)/.test(status), "limit copy");
  const en = JSON.parse(await read("i18n/locales/en/chat.json"));
  assert(en.failedDailyLimit === "Not sent · daily photo and video limit reached", "copy");
});
