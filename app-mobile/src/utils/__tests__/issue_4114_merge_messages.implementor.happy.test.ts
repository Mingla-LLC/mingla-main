// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 1 — a sent message shows exactly once, survives refreshes,
// retries never duplicate, the list is time-sorted, and switching chats closes
// the previous chat's live channel.
//
// FAILS-ON-REVERT: delete the client-id match in mergeMessages (`byClientId`
// lookup in `upsert`) and the echo-before-return case shows two rows; delete the
// snapshot window (treat a refresh as a replace) and the pending send vanishes;
// make releaseConversationSubscription unsubscribe the next id and the
// unsubscribe case fails.
// MINGLA-INVARIANT: I-4114-ONE-MESSAGE-PER-CLIENT-ID | issue #4114 | A chat list never holds two rows for one client id or one server id, and a refresh never drops a pending or failed local send.

import {
  createClientMessageId,
  isLocalMessage,
  mergeMessages,
  oldestConfirmedTimestamp,
} from "../mergeMessages.ts";
import {
  releaseConversationSubscription,
  switchConversationSubscription,
} from "../conversationSubscription.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const SERVER_NOW = Date.parse("2026-10-25T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

type Msg = {
  id: string;
  clientId?: string;
  senderId: string;
  content: string;
  timestamp: string;
  isMe: boolean;
  failed?: boolean;
  isRead?: boolean;
};

function confirmed(id: string, offsetMs: number, extra: Partial<Msg> = {}): Msg {
  return { id, senderId: "friend", content: `msg ${id}`, timestamp: iso(SERVER_NOW + offsetMs), isMe: false, ...extra };
}

Deno.test("#4114 happy path: the realtime echo lands BEFORE sendMessage resolves, phone clock 6 s off — exactly one message", () => {
  const history = [confirmed("s1", -60_000), confirmed("s2", -30_000)];
  const clientId = createClientMessageId();
  const PHONE_SKEW_MS = 6_000; // the phone's clock runs 6 s ahead of the server

  // 1. Optimistic bubble, stamped with the phone's (skewed) clock.
  const optimistic: Msg = {
    id: `temp-${clientId}`,
    clientId,
    senderId: "me",
    content: "see you at 8",
    timestamp: iso(SERVER_NOW + PHONE_SKEW_MS),
    isMe: true,
  };
  let list = mergeMessages(history, [optimistic]);
  assertEquals(list.map((m) => m.id), ["s1", "s2", optimistic.id], "optimistic bubble appended");

  // 2. The realtime INSERT echo arrives first (server id + server time + same client id).
  const serverRow: Msg = {
    id: "server-row-1",
    clientId,
    senderId: "me",
    content: "see you at 8",
    timestamp: iso(SERVER_NOW),
    isMe: true,
  };
  list = mergeMessages(list, [serverRow]);
  // The broadcast path can deliver the same row a second time.
  list = mergeMessages(list, [{ ...serverRow }]);

  // 3. sendMessage finally resolves with the same row.
  list = mergeMessages(list, [{ ...serverRow, isRead: false }]);

  const mine = list.filter((m) => m.content === "see you at 8");
  assertEquals(mine.length, 1, "the sent message must show exactly once");
  assertEquals(mine[0].id, "server-row-1", "the confirmed row replaced the optimistic one");
  assertEquals(mine[0].timestamp, iso(SERVER_NOW), "the server's time is shown once confirmed");
  assertEquals(list.length, 3, "no extra rows");
  assert(!list.some(isLocalMessage), "no optimistic copy left behind");

  // A late "send failed" for the same client id (the response was lost after the echo) is ignored.
  list = mergeMessages(list, [{ ...optimistic, failed: true }]);
  assertEquals(list.filter((m) => m.content === "see you at 8").map((m) => [m.id, !!m.failed]), [["server-row-1", false]], "late failure ignored");
});

Deno.test("#4114 the send response before the echo also collapses to one row", () => {
  const clientId = createClientMessageId();
  const optimistic: Msg = { id: `temp-${clientId}`, clientId, senderId: "me", content: "hi", timestamp: iso(SERVER_NOW - 6_000), isMe: true };
  const row: Msg = { id: "row-2", clientId, senderId: "me", content: "hi", timestamp: iso(SERVER_NOW), isMe: true };
  let list = mergeMessages([], [optimistic]);
  list = mergeMessages(list, [row]);
  list = mergeMessages(list, [row]);
  assertEquals(list.map((m) => m.id), ["row-2"], "one row");
});

Deno.test("#4114 a refresh during a pending send keeps the pending message (and drops only rows deleted in its window)", () => {
  const older = confirmed("old-page", -3_600_000); // loaded by scrolling up, outside the refresh window
  const a = confirmed("a", -20_000);
  const deleted = confirmed("deleted-on-server", -15_000);
  const b = confirmed("b", -10_000);
  const clientId = createClientMessageId();
  const pending: Msg = { id: `temp-${clientId}`, clientId, senderId: "me", content: "on my way", timestamp: iso(SERVER_NOW), isMe: true };
  const failedClient = createClientMessageId();
  const failed: Msg = { id: `temp-${failedClient}`, clientId: failedClient, senderId: "me", content: "lost", timestamp: iso(SERVER_NOW - 5_000), isMe: true, failed: true };
  const arrivedAfterSnapshot = confirmed("late", 30_000);
  // A send from a phone whose clock runs behind: its local time falls INSIDE the
  // refresh window, where a missing confirmed row would be dropped.
  const skewedClient = createClientMessageId();
  const skewedPending: Msg = { id: `temp-${skewedClient}`, clientId: skewedClient, senderId: "me", content: "clock behind", timestamp: iso(SERVER_NOW - 12_000), isMe: true };

  const prev = mergeMessages([], [older, a, deleted, b, failed, pending, arrivedAfterSnapshot, skewedPending]);
  // The background refresh returns the newest page — written before the send landed.
  const snapshot = [a, { ...b, isRead: true }];
  const list = mergeMessages(prev, snapshot, { snapshot: { complete: false } });

  const ids = list.map((m) => m.id);
  assert(ids.includes(pending.id), "pending send must survive the refresh");
  assert(ids.includes(skewedPending.id), "a pending send inside the refresh window must survive it");
  assert(ids.includes(failed.id), "failed send must survive the refresh (so it can be retried)");
  assert(ids.includes("old-page"), "older loaded pages outside the window are kept");
  assert(ids.includes("late"), "a message newer than the snapshot is kept");
  assert(!ids.includes("deleted-on-server"), "a row the server no longer has inside the window is dropped");
  assertEquals(list.find((m) => m.id === "b")?.isRead, true, "refresh updates rows in place");
  assertEquals(ids, ["old-page", "a", skewedPending.id, "b", failed.id, pending.id, "late"], "time order");
});

Deno.test("#4114 a retry with the same client id does not duplicate", () => {
  const clientId = createClientMessageId();
  const failed: Msg = { id: `temp-${clientId}`, clientId, senderId: "me", content: "retry me", timestamp: iso(SERVER_NOW), isMe: true, failed: true };
  let list = mergeMessages([confirmed("x", -1_000)], [failed]);

  // Tap to retry: same bubble back to pending.
  list = mergeMessages(list, [{ ...failed, failed: false }]);
  assertEquals(list.filter((m) => m.clientId === clientId).length, 1, "retry reuses the bubble");
  assertEquals(list.find((m) => m.clientId === clientId)?.failed, false, "bubble is pending again");

  // The first attempt had actually landed: the server returns the existing row for that client id.
  const existing: Msg = { id: "already-landed", clientId, senderId: "me", content: "retry me", timestamp: iso(SERVER_NOW - 2_000), isMe: true };
  list = mergeMessages(list, [existing]);
  list = mergeMessages(list, [existing]); // and its echo
  assertEquals(list.filter((m) => m.content === "retry me").map((m) => m.id), ["already-landed"], "exactly one row after retry");
});

Deno.test("#4114 the merge sorts by time with a stable tie-break, and dedupes stored duplicates", () => {
  const t = iso(SERVER_NOW);
  const shuffled = [
    confirmed("c", 3_000),
    confirmed("a", 1_000),
    { ...confirmed("tie-2", 2_000) },
    confirmed("tie-1", 2_000),
    confirmed("b", 1_500),
    confirmed("a", 1_000), // a duplicate persisted by an older build
  ];
  const list = mergeMessages([], shuffled);
  assertEquals(list.map((m) => m.id), ["a", "b", "tie-2", "tie-1", "c"], "sorted, first-seen order on ties, duplicate removed");

  // A local copy at the same instant sorts after the confirmed row.
  const localId = createClientMessageId();
  const withLocal = mergeMessages([{ id: `temp-${localId}`, clientId: localId, senderId: "me", content: "l", timestamp: t, isMe: true }], [confirmed("same-instant", 0)]);
  assertEquals(withLocal.map((m) => m.id), ["same-instant", `temp-${localId}`], "confirmed before local on a tie");

  // A cached row without a client id and the server row with one are the same message.
  const legacy = confirmed("m1", 0);
  const server = { ...legacy, clientId: createClientMessageId() };
  assertEquals(mergeMessages([legacy], [server]).length, 1, "matched by id when the cached copy has no client id");

  assertEquals(oldestConfirmedTimestamp(list), iso(SERVER_NOW + 1_000), "paging cursor is the oldest confirmed time");
  assertEquals(oldestConfirmedTimestamp(withLocal.filter(isLocalMessage)), null, "no cursor from local-only rows");
});

Deno.test("#4114 client ids are v4 uuids (the column is uuid)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const id = createClientMessageId();
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), `not a v4 uuid: ${id}`);
    seen.add(id);
  }
  assertEquals(seen.size, 200, "unique");
});

Deno.test("#4114 switching chats unsubscribes the OLD conversation, not the one being opened", () => {
  const calls: string[] = [];
  const service = { unsubscribeFromConversation: (id: string) => calls.push(`unsubscribe:${id}`) };
  const subscribe = (id: string) => {
    calls.push(`subscribe:${id}`);
    return { channel: id };
  };
  const ref = { current: null as string | null };

  const first = switchConversationSubscription(ref, "chat-A", service, subscribe);
  assertEquals(first, { channel: "chat-A" }, "returns the new channel");
  switchConversationSubscription(ref, "chat-B", service, subscribe);
  assertEquals(ref.current, "chat-B", "records the subscribed id");
  releaseConversationSubscription(ref, service); // back to the list
  releaseConversationSubscription(ref, service); // a second back is a no-op

  assertEquals(calls, ["subscribe:chat-A", "unsubscribe:chat-A", "subscribe:chat-B", "unsubscribe:chat-B"], "old id released each time");
  assertEquals(ref.current, null, "nothing subscribed after back");
});
