// Issue #4275 Part B — a slow first load is not "no chats".
//
// invariant: I-CHAT-LIST-EMPTY-MEANS-SERVER-EMPTY — the empty state requires a
// loaded list.
//
// FAILS-ON-REVERT: drop `!loaded ||` from chatListViewState and T-B1 fails. Skip
// the retry for timeouts with no list and T-B5 fails. Put the old showSkeleton
// back and T-B7 fails. Always pass CHAT_LIST_TIMEOUT_MS and T-B6 fails.

import {
  CHAT_LIST_FIRST_LOAD_RETRIES,
  CHAT_LIST_FIRST_LOAD_TIMEOUT_MS,
  CHAT_LIST_TIMEOUT_MS,
  ChatListTimeoutError,
  chatListAttemptTimeoutMs,
  chatListRetryDelayMs,
  chatListViewState,
  shouldRetryChatList,
  type ChatListData,
} from "../chatListLoad.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: got ${String(actual)}, expected ${String(expected)}`);
}

const cached = { conversations: [{ id: "c1" }], teamBrandIds: null } as unknown as ChatListData;
const empty = { conversations: [], teamBrandIds: null } as unknown as ChatListData;
const timeout = new ChatListTimeoutError();
const serverError = new Error("HTTP 500");

Deno.test("T-B1 a settled timeout with no list is a failure, not an empty list", () => {
  const view = chatListViewState({ data: undefined, isPending: false, isFetching: false, isError: true, error: timeout });
  eq(view.failed, true, "failed");
  eq(view.loaded, false, "loaded");
  eq(view.loading, false, "loading");
});

Deno.test("T-B2 a timeout with a cached list stays silent and the rows stay", () => {
  const view = chatListViewState({ data: cached, isPending: false, isFetching: false, isError: true, error: timeout });
  eq(view.failed, false, "failed");
  eq(view.loaded, true, "loaded");
  eq(view.conversations?.length, 1, "rows");
});

Deno.test("T-B3 a 500 with no list while retries run is still loading", () => {
  const view = chatListViewState({ data: undefined, isPending: true, isFetching: true, isError: false, error: serverError });
  eq(view.loading, true, "loading");
  eq(view.failed, false, "failed");
  const settled = chatListViewState({ data: undefined, isPending: false, isFetching: true, isError: true, error: serverError });
  eq(settled.failed, false, "a retry in flight is not failed");
});

Deno.test("T-B3 offline with no list is loading: a paused query is still pending", () => {
  const view = chatListViewState({ data: undefined, isPending: true, isFetching: false, isError: false, error: null });
  eq(view.loading, true, "loading");
  eq(view.failed, false, "failed");
});

Deno.test("T-B4 a real empty list is loaded, so the empty state may show", () => {
  const view = chatListViewState({ data: empty, isPending: false, isFetching: false, isError: false, error: null });
  eq(view.loaded, true, "loaded");
  eq(view.loading, false, "loading");
  eq(view.failed, false, "failed");
  eq(view.conversations?.length, 0, "rows");
});

Deno.test("T-B4 a real failure with a cached list still reports", () => {
  const view = chatListViewState({ data: cached, isPending: false, isFetching: false, isError: true, error: serverError });
  eq(view.failed, true, "failed");
});

Deno.test("T-B8 a cached empty list plus a failed refresh is a failure, not no chats", () => {
  for (const error of [timeout, serverError]) {
    const view = chatListViewState({ data: empty, isPending: false, isFetching: false, isError: true, error });
    eq(view.failed, true, `failed on ${error.name}`);
    eq(view.loaded, true, "loaded");
  }
  const hook = Deno.readTextFileSync(new URL("../../../hooks/useChatList.ts", import.meta.url));
  assert(/getQueryData<ChatListData>\(queryKey\)\?\.conversations\.length \?\? 0\) > 0/.test(hook),
    "a cached empty list refreshes with first-load patience");
});

Deno.test("T-B5 the retry table", () => {
  eq(CHAT_LIST_FIRST_LOAD_RETRIES, 4, "retries");
  // Fatal: never, cached or not.
  eq(shouldRetryChatList(0, serverError, false, true), false, "fatal, no cache");
  eq(shouldRetryChatList(0, serverError, true, true), false, "fatal, cached");
  // No cached list: 0-3 retry, timeouts included; 4 stops.
  for (const error of [timeout, serverError]) {
    for (const count of [0, 1, 2, 3]) {
      eq(shouldRetryChatList(count, error, false, false), true, `no cache, count ${count}, ${error.name}`);
    }
    eq(shouldRetryChatList(4, error, false, false), false, `no cache, count 4, ${error.name}`);
  }
  // Cached: timeout never; other errors once.
  eq(shouldRetryChatList(0, timeout, true, false), false, "cached timeout");
  eq(shouldRetryChatList(0, serverError, true, false), true, "cached other, first");
  eq(shouldRetryChatList(1, serverError, true, false), false, "cached other, second");
});

Deno.test("T-B5 retry delays are 2, 4, 8 and 16 s with 20% jitter", () => {
  const steps = [2000, 4000, 8000, 16000];
  steps.forEach((step, attempt) => {
    eq(Math.round(chatListRetryDelayMs(attempt, () => 0.5)), step, `middle ${attempt}`);
    eq(Math.round(chatListRetryDelayMs(attempt, () => 0)), step * 0.8, `low ${attempt}`);
    eq(Math.round(chatListRetryDelayMs(attempt, () => 1)), step * 1.2, `high ${attempt}`);
  });
  eq(chatListRetryDelayMs(99, () => 0.5), 16000, "past the table");
});

Deno.test("T-B6 the attempt timeout depends on whether a list is cached", () => {
  eq(chatListAttemptTimeoutMs(false), CHAT_LIST_FIRST_LOAD_TIMEOUT_MS, "no cache");
  eq(CHAT_LIST_FIRST_LOAD_TIMEOUT_MS, 20_000, "beats an 18 s read");
  eq(chatListAttemptTimeoutMs(true), CHAT_LIST_TIMEOUT_MS, "cached");
  eq(CHAT_LIST_TIMEOUT_MS, 10_000, "cached");
  const hook = Deno.readTextFileSync(new URL("../../../hooks/useChatList.ts", import.meta.url));
  assert(/loadChatList\(userId, \{ \.\.\.deps, timeoutMs: chatListAttemptTimeoutMs\(hasCachedList\(\)\) \}\)/.test(hook),
    "the hook passes the attempt timeout");
  assert(/shouldRetryChatList\(failureCount, error, hasCachedList\(\), isFatalChatListError\(error\)\)/.test(hook),
    "the hook uses the retry table");
  assert(/isQueryCancellationError\(error\)/.test(hook), "a cancellation is fatal");
});

Deno.test("T-B7 the page reaches the empty state only with a loaded list", () => {
  const page = Deno.readTextFileSync(new URL("../../ConnectionsPage.tsx", import.meta.url));
  assert(/const showSkeleton = !chatListView\.loaded && !error;/.test(page), "skeleton until loaded, or the error row");
  const listEmpty = page.slice(page.indexOf("const listEmpty = showSkeleton"), page.indexOf("let screen: React.ReactNode;"));
  const failedBranch = listEmpty.indexOf("error && conversations.length === 0 ? null");
  assert(failedBranch > 0, "a failure with no list shows only the error row");
  for (const copy of ["connections:no_results", "connections:filter_empty_", "connections:empty_title"]) {
    assert(listEmpty.indexOf(copy) > failedBranch, `${copy} comes after the not-loaded branches`);
  }
  assert(/connections:error_inline/.test(page) && /handleRetryLoad/.test(page), "the error row retries");
});

Deno.test("T-M1 merge safety with #4274: if the plan embed is on this branch it survives", () => {
  const service = Deno.readTextFileSync(new URL("../../../services/messagingService.ts", import.meta.url));
  const connections = Deno.readTextFileSync(new URL("../../../services/connectionsService.ts", import.meta.url));
  const hasEmbed = /plan_id/.test(service) || /plan_id/.test(connections);
  if (!hasEmbed) return; // #4274 is not merged into this branch yet.
  for (const source of [service, connections]) {
    const at = source.indexOf("last_message:messages(");
    if (at >= 0) {
      const embed = source.slice(at, source.indexOf(")", at));
      assert(/plan_id/.test(embed) && /plan_quote/.test(embed), "the embed keeps plan_id and plan_quote");
    }
  }
});
