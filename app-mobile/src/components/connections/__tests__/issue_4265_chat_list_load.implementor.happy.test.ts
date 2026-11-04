// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — the Explorer Chats tab loads instantly.
//   * the list is one cached query: cached rows render at once (no skeleton),
//     also while the background refresh runs; the skeleton is first-visit only;
//   * reads that need no conversation ids (pending invites, brand teams) start
//     with the conversations read, not after it;
//   * ONE profiles read covers participants, last-message senders and
//     inviters (a second read only for session people it missed);
//   * unread counts are the same numbers the old download-everything
//     algorithm produced, from a read that returns only unread rows;
//   * local writes (realtime message, optimistic send, archive) land in the
//     query cache; with nothing loaded yet they are dropped, never invented;
//   * the cache entry is per user: persisted for that user, removed on
//     logout / account switch.
//
// FAILS-ON-REVERT: drop the `ops.eq(next, "message_reads.user_id", userId)`
// embed filter (or the `message_reads` is-null anti-join) from applyUnreadFilters and the unread
// equivalence test fails; move `deps.fetchPendingInvites(userId)` after the
// conversations await and the parallel test fails; make chatListViewState
// show the skeleton while fetching with data (`loading: query.isFetching`) and
// the cached-first test fails.

import {
  CHAT_LIST_STALE_TIME_MS,
  UNREAD_MESSAGES_SELECT,
  applyUnreadFilters,
  archivedConversationIds,
  chatListViewState,
  countUnreadRows,
  loadChatList,
  updateChatListConversations,
} from "../chatListLoad.ts";
import { chatListKeys } from "../../../hooks/queryKeys.ts";
import { shouldDehydrateMinglaQuery, shouldRemoveForAuthChange } from "../../../utils/queryPersistence.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const ME = "42650000-0000-4000-8000-000000000001";
const AMY = "42650000-0000-4000-8000-000000000002";
const BEN = "42650000-0000-4000-8000-000000000003";
const CAL = "42650000-0000-4000-8000-000000000004";
const DEE = "42650000-0000-4000-8000-000000000005";

// ── Unread equivalence ──────────────────────────────────────────────────

type FixtureMessage = { id: string; conversation_id: string; sender_id: string | null; deleted_at: string | null; reads: string[] };

const MESSAGES: FixtureMessage[] = [
  // c1: two unread from Amy, one Amy message I read, one I sent, one deleted.
  { id: "m1", conversation_id: "c1", sender_id: AMY, deleted_at: null, reads: [] },
  { id: "m2", conversation_id: "c1", sender_id: AMY, deleted_at: null, reads: [BEN] },
  { id: "m3", conversation_id: "c1", sender_id: AMY, deleted_at: null, reads: [ME] },
  { id: "m4", conversation_id: "c1", sender_id: ME, deleted_at: null, reads: [] },
  { id: "m5", conversation_id: "c1", sender_id: AMY, deleted_at: "2026-11-01T00:00:00Z", reads: [] },
  // c2: a system message (sender NULL) unread, another read by me and others.
  { id: "m6", conversation_id: "c2", sender_id: null, deleted_at: null, reads: [] },
  { id: "m7", conversation_id: "c2", sender_id: BEN, deleted_at: null, reads: [BEN, ME, CAL] },
  // c3: everything read.
  { id: "m8", conversation_id: "c3", sender_id: CAL, deleted_at: null, reads: [ME] },
  // c4: read only by other people — still unread for me.
  { id: "m9", conversation_id: "c4", sender_id: CAL, deleted_at: null, reads: [AMY, BEN] },
  { id: "m10", conversation_id: "c4", sender_id: DEE, deleted_at: null, reads: [CAL] },
];

/** The algorithm getConversations used before #4265 (download all, count on the phone). */
function legacyUnreadCounts(messages: FixtureMessage[], userId: string): Map<string, number> {
  // Server side of the old read: .or(sender_id.neq.me,sender_id.is.null).is(deleted_at, null), every read embedded.
  const rows = messages
    .filter((m) => (m.sender_id === null || m.sender_id !== userId) && m.deleted_at === null)
    .map((m) => ({ id: m.id, conversation_id: m.conversation_id, message_reads: m.reads.map((user_id) => ({ user_id })) }));
  const unreadByConv = new Map<string, number>();
  for (const msg of rows) {
    const isReadByMe = msg.message_reads.some((r) => r.user_id === userId);
    if (!isReadByMe) unreadByConv.set(msg.conversation_id, (unreadByConv.get(msg.conversation_id) || 0) + 1);
  }
  return unreadByConv;
}

const FAKE_OPS = {
  or: (q, filters: string) => q.or(filters),
  isNull: (q, column: string) => q.is(column, null),
  eq: (q, column: string, value: string) => q.eq(column, value),
};

/** A PostgREST-semantics stand-in for the filters applyUnreadFilters sends. */
function fakeMessagesQuery(messages: FixtureMessage[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    calls,
    or(filters: string) { calls.push(["or", filters]); return query; },
    is(column: string, value: null) { calls.push(["is", column, value]); return query; },
    eq(column: string, value: string) { calls.push(["eq", column, value]); return query; },
    run(): Array<{ conversation_id: string }> {
      let rows = messages.map((m) => ({ ...m, embed: m.reads.slice() }));
      for (const [op, a, b] of calls) {
        if (op === "or") {
          const match = /^sender_id\.neq\.([^,]+),sender_id\.is\.null$/.exec(String(a));
          assert(match, `unexpected or filter ${a}`);
          // SQL: sender_id <> X OR sender_id IS NULL
          rows = rows.filter((r) => r.sender_id === null || r.sender_id !== match[1]);
        } else if (op === "is" && a === "deleted_at") {
          rows = rows.filter((r) => r.deleted_at === null);
        } else if (op === "eq" && a === "message_reads.user_id") {
          // Embedded filter: narrows the embedded rows, never the parent.
          rows = rows.map((r) => ({ ...r, embed: r.embed.filter((userId) => userId === b) }));
        } else if (op === "is" && a === "message_reads") {
          // Null filter on the embed (anti-join): keep parents whose filtered embed is empty.
          rows = rows.filter((r) => r.embed.length === 0);
        } else {
          throw new Error(`unexpected filter ${op} ${a}`);
        }
      }
      return rows.map((r) => ({ conversation_id: r.conversation_id }));
    },
  };
  return query;
}

Deno.test("#4265 unread counts are the same numbers as the old algorithm, from unread rows only", () => {
  for (const viewer of [ME, AMY, CAL]) {
    const query = fakeMessagesQuery(MESSAGES);
    const rows = applyUnreadFilters(query, viewer, FAKE_OPS).run();
    const legacy = legacyUnreadCounts(MESSAGES, viewer);
    eq([...countUnreadRows(rows)].sort(), [...legacy].sort(), `same per-chat unread for ${viewer}`);
    const legacyTotal = [...legacy.values()].reduce((sum, n) => sum + n, 0);
    eq(rows.length, legacyTotal, "only unread rows come back (nothing to count away)");
  }
  eq([...countUnreadRows(applyUnreadFilters(fakeMessagesQuery(MESSAGES), ME, FAKE_OPS).run())].sort(),
    [["c1", 2], ["c2", 1], ["c4", 2]], "fixture numbers for me");
  assert(UNREAD_MESSAGES_SELECT === "conversation_id, message_reads()", "the read returns only conversation ids");
  eq([...countUnreadRows([{ conversation_id: null }, { conversation_id: "x" }, "junk"])], [["x", 1]], "null ids and junk rows are skipped");
  eq([...countUnreadRows(null)], [], "no rows, no counts");
});

// ── Load waves ──────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  const profileReads: string[][] = [];
  const deps = {
    getConversations: async (_userId: string) => {
      log.push("conversations:start");
      return {
        error: null,
        conversations: [
          {
            id: "c1", type: "direct", created_by: ME, created_at: "2026-11-01T10:00:00Z",
            participants: [{ user_id: ME }, { user_id: AMY }],
            last_message: { id: "m1", sender_id: AMY, sender_display_name_snapshot: null, sender_name: "Unknown", content: "hi" },
            unread_count: 2, archived_at: null,
          },
          {
            id: "c2", type: "group", session_id: "s1", linked_entity_type: "session", created_by: ME,
            created_at: "2026-11-01T09:00:00Z",
            participants: [{ user_id: ME }, { user_id: BEN }],
            last_message: { id: "m6", sender_id: BEN, sender_display_name_snapshot: "Benny", sender_name: "Benny", content: "yo" },
            unread_count: 0, archived_at: "2026-11-02T00:00:00Z",
          },
        ],
      };
    },
    fetchPendingInvites: async () => {
      log.push("invites:start");
      return [{ id: "i1", session_id: "s9", inviter_id: CAL, created_at: "2026-11-01T11:00:00Z" }];
    },
    fetchTeamBrandIds: async () => { log.push("teams:start"); return []; },
    fetchSessions: async () => {
      log.push("sessions:start");
      return [{
        id: "s1", name: "Brunch", created_by: ME, status: "pending",
        session_participants: [{ user_id: ME, has_accepted: true }, { user_id: BEN, has_accepted: false }],
        collaboration_invites: [{ id: "ci1", invited_user_id: DEE, status: "pending", created_at: null }],
      }];
    },
    fetchSessionPhoneInvites: async () => { log.push("phone:start"); return []; },
    fetchEventMeta: async () => { log.push("events:start"); return new Map(); },
    fetchProfiles: async (ids: string[]) => {
      log.push("profiles:start");
      profileReads.push([...ids].sort());
      return ids.map((id) => ({ id, first_name: `N-${id.slice(-1)}`, avatar_url: null }));
    },
    displayName: (profile: { first_name?: string } | undefined, fallback = "Someone") => profile?.first_name ?? fallback,
    eventPublicUrl: () => null,
    rememberSenderProfiles: (profiles: Array<{ id: string }>) => log.push(`senders:${profiles.map((p) => p.id.slice(-1)).sort().join("")}`),
    warn: () => {},
    setTimer: () => 0,
    clearTimer: () => {},
    ...overrides,
  };
  return { deps, log, profileReads };
}

Deno.test("#4265 pending invites and brand teams start with the conversations read, not after it", async () => {
  const gate = deferred<{ conversations: unknown[]; error: null }>();
  const { deps, log } = makeDeps({
    getConversations: () => { log.push("conversations:start"); return gate.promise; },
  });
  const loading = loadChatList(ME, deps);
  await Promise.resolve();
  assert(log.includes("invites:start"), "the pending-invites read is already running while conversations load");
  assert(log.includes("teams:start"), "the brand-team read is already running while conversations load");
  assert(!log.includes("profiles:start") && !log.includes("sessions:start"), "id-dependent reads wait for the ids");
  gate.resolve({ conversations: [], error: null });
  const data = await loading;
  eq(data.conversations.map((c) => c.id), ["pending-invite-i1"], "the invite row still leads the list");
});

Deno.test("#4265 one profiles read covers participants, senders and inviters; a second only for missed session people", async () => {
  const { deps, log, profileReads } = makeDeps();
  const data = await loadChatList(ME, deps);
  eq(profileReads[0], [ME, AMY, BEN, CAL].sort(), "participants ∪ last-message senders ∪ inviters, in one read");
  eq(profileReads[1], [DEE], "the follow-up read is only for the session invitee nobody else covered");
  eq(profileReads.length, 2, "never more than that");
  assert(log.includes("senders:23"), "sender names warm the messaging cache from the same read");
  const firstProfiles = log.indexOf("profiles:start");
  const sessions = log.indexOf("sessions:start");
  assert(firstProfiles > -1 && sessions > -1 && log.slice(Math.min(firstProfiles, sessions)).indexOf("phone:start") > -1,
    "sessions, phone invites and profiles run in one wave");

  const [invite, direct, group] = data.conversations;
  eq(invite.id, "pending-invite-i1", "pending invites first");
  eq(invite.__pendingInvite.inviterDisplayName, "N-4", "inviter name from the shared profiles read");
  eq(direct.last_message.sender_name, "N-2", "no snapshot: the sender name comes from the profile");
  eq(group.last_message.sender_name, "Benny", "a snapshot always wins");
  eq(direct.participants.map((p) => p.id), [ME, AMY], "participants keep their order");
  eq(group.name, "Brunch", "session name fallback");
  eq(group.__pendingCollabChat.people.map((p) => [p.id, p.status]), [[ME, "creator"], [BEN, "pending"], [DEE, "pending"]],
    "pending collab people include the invitee from the follow-up read");
  eq(direct.unread_count, 2, "unread passes through");
  eq([...archivedConversationIds(data.conversations)], ["c2"], "archived ids are read from the rows");
  eq(data.teamBrandIds, [], "no event chats: the team set is empty");
});

Deno.test("#4265 a failed team read keeps the known set; a failed invites read never fails the list", async () => {
  const { deps } = makeDeps({
    fetchTeamBrandIds: async () => null,
    fetchPendingInvites: async () => { throw new Error("invites down"); },
    getConversations: async () => ({
      error: null,
      conversations: [{
        id: "e1", type: "group", event_id: "ev1", linked_entity_type: "event", created_at: "2026-11-01T00:00:00Z",
        participants: [{ user_id: ME }],
      }],
    }),
  });
  const data = await loadChatList(ME, deps);
  eq(data.teamBrandIds, null, "null = keep the last known set (useChatList restores it)");
  eq(data.conversations.map((c) => c.id), ["e1"], "the list still loads without invites");
});

Deno.test("#4265 the conversations read times out instead of hanging the tab", async () => {
  let fire: (() => void) | null = null;
  const { deps } = makeDeps({
    getConversations: () => new Promise(() => {}),
    setTimer: (callback: () => void) => { fire = callback; return 1; },
  });
  const loading = loadChatList(ME, deps);
  assert(fire, "a timer is armed");
  fire!();
  let name = "";
  try { await loading; } catch (error) { name = (error as Error).name; }
  eq(name, "TimeoutError", "a timeout is a TimeoutError (the page shows no error row for it)");
});

// ── Cached-first render ─────────────────────────────────────────────────

Deno.test("#4265 cached chats render on remount without waiting for the network", () => {
  const cached = { conversations: [{ id: "c1" }], teamBrandIds: [] };
  // Remount with a cached list while the background refresh is running.
  const remount = chatListViewState({ data: cached, isPending: false, isFetching: true, isError: false, error: null });
  eq(remount.conversations?.map((c) => c.id), ["c1"], "rows come straight from the cache");
  eq(remount.loading, false, "no skeleton while the background refresh runs");
  // First-ever visit: nothing cached yet.
  const first = chatListViewState({ data: undefined, isPending: true, isFetching: true, isError: false, error: null });
  eq([first.conversations, first.loading], [null, true], "the skeleton shows only on the first-ever visit");
  // A failed refresh with a cached list keeps the rows; a timeout shows no error.
  const failed = chatListViewState({ data: cached, isPending: false, isFetching: false, isError: true, error: new Error("x") });
  eq([failed.conversations?.length, failed.failed], [1, true], "rows stay, the error row shows");
  const timeout = new Error("t"); timeout.name = "TimeoutError";
  eq(chatListViewState({ data: cached, isPending: false, isFetching: false, isError: true, error: timeout }).failed, false,
    "a timeout is not an error");
  eq(chatListViewState({ data: undefined, isPending: false, isFetching: true, isError: true, error: new Error("x") }).failed, false,
    "retrying: the error row waits for the result");
  assert(CHAT_LIST_STALE_TIME_MS >= 30_000 && CHAT_LIST_STALE_TIME_MS <= 60_000, "revisits inside 30-60 s do not refetch");
});

// ── Cache writes ────────────────────────────────────────────────────────

function memoryCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    getQueryData: (key: readonly unknown[]) => store.get(JSON.stringify(key)),
    setQueryData: (key: readonly unknown[], updater: (old: unknown) => unknown) => {
      const next = updater(store.get(JSON.stringify(key)));
      if (next !== undefined) store.set(JSON.stringify(key), next);
      return next;
    },
  };
}

Deno.test("#4265 a realtime message and an optimistic send land in the query cache", () => {
  const cache = memoryCache();
  const key = chatListKeys.list(ME);
  updateChatListConversations(cache, key, (rows: unknown[]) => [...rows, { id: "ghost" }]);
  eq(cache.getQueryData(key), undefined, "nothing loaded yet: the write is dropped, no fake list");

  cache.store.set(JSON.stringify(key), { conversations: [{ id: "c1", unread_count: 3 }, { id: "c2" }], teamBrandIds: ["b1"] });
  // Realtime insert into c2.
  updateChatListConversations(cache, key, (rows: Array<{ id: string }>) =>
    rows.map((row) => (row.id === "c2" ? { ...row, last_message: { id: "m-live" } } : row)));
  // Optimistic send + mark read in c1.
  updateChatListConversations(cache, key, (rows: Array<{ id: string }>) =>
    rows.map((row) => (row.id === "c1" ? { ...row, unread_count: 0, last_message: { id: "local-1" } } : row)));
  const data = cache.getQueryData(key) as { conversations: Array<Record<string, unknown>>; teamBrandIds: string[] };
  eq(data.conversations, [
    { id: "c1", unread_count: 0, last_message: { id: "local-1" } },
    { id: "c2", last_message: { id: "m-live" } },
  ], "both writes are in the one cache entry");
  eq(data.teamBrandIds, ["b1"], "the rest of the entry is untouched");
});

Deno.test("#4265 the cached list is per user: persisted for them, removed on logout or account switch", () => {
  const key = chatListKeys.list(ME);
  eq(key, ["chatList", "list", ME], "key from the factory");
  const query = { queryKey: key, state: { status: "success", fetchStatus: "idle", data: { conversations: [] } } };
  eq(shouldDehydrateMinglaQuery(query, ME), true, "persisted for the signed-in user");
  eq(shouldDehydrateMinglaQuery(query, AMY), false, "never persisted for someone else");
  eq(shouldRemoveForAuthChange(key, null), true, "logout removes it");
  eq(shouldRemoveForAuthChange(key, AMY), true, "an account switch removes it");
  eq(shouldRemoveForAuthChange(key, ME), false, "kept while the same user is signed in");
});
