// Issue #4275 P3-B — over a cached empty chat list, a failing refresh no longer
// holds pull to refresh or accepting an invite for every retry, and the list shows
// the error row while it retries, not "no chats".
//
// Runs the real @tanstack/query-core at the lockfile version, with the query
// function wired the way useChatList wires it (the source test below pins that).
//
// FAILS-ON-REVERT: remove noteChatListAttemptFailed from useChatList's query
// function, or make the page await the refetch itself, and the awaiter tests fail.
// Remove the failureCount rule from chatListViewState and the view test fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CHAT_LIST_FIRST_LOAD_RETRIES,
  ChatListTimeoutError,
  chatListViewState,
  noteChatListAttemptFailed,
  refreshUntilFirstFailure,
  shouldRetryChatList,
} from "../chatListLoad.ts";

const lock = JSON.parse(
  Deno.readTextFileSync(new URL("../../../../package-lock.json", import.meta.url)),
) as { packages: Record<string, { version: string }> };
const rqVersion = lock.packages["node_modules/@tanstack/query-core"].version;
const { QueryClient, QueryObserver } = await import(`npm:@tanstack/query-core@${rqVersion}`);

type ListData = { conversations: Array<{ id: string }>; teamBrandIds: null };
const USER = "user-1";
const KEY = ["chat-list", USER];

function rig(cached: ListData, attempt: (n: number) => Promise<ListData>) {
  const client = new QueryClient();
  client.setQueryData(KEY, cached);
  let attempts = 0;
  const views: Array<ReturnType<typeof chatListViewState>> = [];
  const observer = new QueryObserver(client, {
    queryKey: KEY,
    // As useChatList: an attempt that throws wakes refresh awaiters first.
    queryFn: async () => {
      attempts += 1;
      try {
        return await attempt(attempts);
      } catch (error) {
        noteChatListAttemptFailed(USER);
        throw error;
      }
    },
    retry: (count: number, error: unknown) => {
      const rows = (client.getQueryData(KEY) as ListData | undefined)?.conversations.length ?? 0;
      return shouldRetryChatList(count, error, rows > 0, false);
    },
    retryDelay: () => 5,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe((result: Parameters<typeof chatListViewState>[0]) => {
    views.push(chatListViewState(result));
  });
  return { client, views, unsubscribe, attempts: () => attempts };
}

const empty: ListData = { conversations: [], teamBrandIds: null };
const rows: ListData = { conversations: [{ id: "c1" }], teamBrandIds: null };
const waitFor = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

Deno.test("P3-B a failing refresh over a cached empty list settles its awaiter after the first attempt, and retries go on", async () => {
  const r = rig(empty, () => Promise.reject(new ChatListTimeoutError()));
  await refreshUntilFirstFailure(USER, () => r.client.refetchQueries({ queryKey: KEY, exact: true }));
  assertEquals(r.attempts(), 1, "the awaiter did not wait out the retries");
  await waitFor(() => r.attempts() === CHAT_LIST_FIRST_LOAD_RETRIES + 1);
  assertEquals(r.attempts(), CHAT_LIST_FIRST_LOAD_RETRIES + 1, "background retries continue");
  r.unsubscribe();
});

Deno.test("P3-B while retries run after a failure, the list is the error row, never no chats", async () => {
  const r = rig(empty, () => Promise.reject(new Error("HTTP 500")));
  await refreshUntilFirstFailure(USER, () => r.client.refetchQueries({ queryKey: KEY, exact: true }));
  await waitFor(() => r.attempts() === CHAT_LIST_FIRST_LOAD_RETRIES + 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const firstFailure = r.views.findIndex((view) => view.failed);
  assert(firstFailure >= 0, "the error row showed");
  const after = r.views.slice(firstFailure);
  assert(after.every((view) => view.failed), "once an attempt failed, every view until the end is the error row");
  assert(r.views.some((view) => view.failed && r.views.indexOf(view) < r.views.length - 1), "shown while retries were still running");
  r.unsubscribe();
});

Deno.test("P3-B a refresh that succeeds settles with the new data in place", async () => {
  const r = rig(empty, () => Promise.resolve(rows));
  await refreshUntilFirstFailure(USER, () => r.client.refetchQueries({ queryKey: KEY, exact: true }));
  assertEquals((r.client.getQueryData(KEY) as ListData).conversations.length, 1);
  assertEquals(r.views.at(-1)?.failed, false);
  r.unsubscribe();
});

Deno.test("P3-B a failure then a success: the error row goes away", async () => {
  const r = rig(empty, (n) => (n === 1 ? Promise.reject(new Error("HTTP 500")) : Promise.resolve(rows)));
  await refreshUntilFirstFailure(USER, () => r.client.refetchQueries({ queryKey: KEY, exact: true }));
  await waitFor(() => (r.client.getQueryData(KEY) as ListData).conversations.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(r.views.at(-1)?.failed, false);
  r.unsubscribe();
});

Deno.test("P3-B rows on screen: a refresh failing does not raise the error row while it retries", () => {
  const view = chatListViewState({ data: rows as never, isPending: false, isFetching: true, isError: false, error: null, failureCount: 1 });
  assertEquals(view.failed, false);
});

Deno.test("P3-B wiring: the query function wakes awaiters, and the page awaits through refreshUntilFirstFailure", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const hook = strip(Deno.readTextFileSync(new URL("../../../hooks/useChatList.ts", import.meta.url)));
  assert(/catch \(error\) \{\s*noteChatListAttemptFailed\(userId\);\s*throw error;/.test(hook), "the hook reports a failed attempt");
  const page = strip(Deno.readTextFileSync(new URL("../../ConnectionsPage.tsx", import.meta.url)));
  assert(/const fetchConversations = useCallback\(\(userId: string\): Promise<void> =>\s*refreshUntilFirstFailure\(userId,/.test(page),
    "every awaiter of fetchConversations settles at the first failure");
});
