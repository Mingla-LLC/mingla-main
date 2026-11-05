// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4275: a failed read of the other person's profile told a 1:1 chat they
// had deleted their account and took the message box away; a failed friends read
// said they were no longer connected. Only a real answer may do either.
//
// FAILS-ON-REVERT (each proven by deleting the line):
//  - in classifyPeerAccountRead, make any error return 'deleted' → "a failed read
//    is not a deletion" fails;
//  - in classifyPeerFriendshipRead, delete `result.error ||` and treat no data as
//    not friends → "a failed friends read" fails;
//  - in ConnectionsPage, restore `otherProfile?.active === false || !otherProfile`
//    → "the page takes its answer from the helper" fails;
//  - delete the isPeerGoneFromDirectChat branch → "a chat whose person is gone"
//    fails;
//  - delete either isCurrent check in settleChatPeerRead → "stale" cases fail.
// MINGLA-INVARIANT: I-4275-CHAT-PEER-READ-FAILURE-IS-NOT-AN-ANSWER | issue #4275 | A failed profile or friends read never hides a 1:1 chat's message box; only active = false, a truly absent row, or a chat with no other participant says the person is gone.

import {
  classifyPeerAccountRead,
  classifyPeerFriendshipRead,
  isPeerGoneFromDirectChat,
  settleChatPeerRead,
} from "../chatPeerState.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const noWait = () => Promise.resolve();
const page = await Deno.readTextFile(new URL("../../ConnectionsPage.tsx", import.meta.url));

Deno.test("a failed read is not a deletion, whatever failed", () => {
  const failures = [
    { code: "" }, // the device never reached the server: supabase-js gives no code
    { code: "57014" }, // statement timeout
    { code: "PGRST301" }, // expired session
    { code: "42501" }, // permission denied
    { code: "22P02" }, // malformed id
    {},
  ];
  for (const error of failures) {
    assertEquals(classifyPeerAccountRead({ data: null, error }), "unknown", JSON.stringify(error));
  }
  assertEquals(classifyPeerAccountRead({ data: null, error: null }), "unknown", "no data and no error");
});

Deno.test("only a real answer says the person is gone", () => {
  assertEquals(classifyPeerAccountRead({ data: { active: false }, error: null }), "deleted", "active false");
  assertEquals(classifyPeerAccountRead({ data: null, error: { code: "PGRST116" } }), "deleted", "absent row");
  assertEquals(classifyPeerAccountRead({ data: { active: true }, error: null }), "active", "active true");
  assertEquals(classifyPeerAccountRead({ data: { active: null }, error: null }), "active", "active null");
});

Deno.test("a failed friends read does not say they are no longer connected", () => {
  assertEquals(classifyPeerFriendshipRead({ data: null, error: { code: "57014" } }), "unknown", "error");
  assertEquals(classifyPeerFriendshipRead({ data: null, error: null }), "unknown", "no data");
  assertEquals(classifyPeerFriendshipRead({ data: [], error: null }), "not_friends", "no rows");
  assertEquals(classifyPeerFriendshipRead({ data: [{ id: "f" }], error: null }), "friends", "a row");
});

Deno.test("a chat whose person is gone is told so without a read", () => {
  assertEquals(isPeerGoneFromDirectChat({ isGroupConversation: false, otherParticipantId: undefined }), true, "no other");
  assertEquals(isPeerGoneFromDirectChat({ isGroupConversation: false, otherParticipantId: "" }), true, "empty id");
  assertEquals(isPeerGoneFromDirectChat({ isGroupConversation: false, otherParticipantId: "u" }), false, "has id");
  assertEquals(isPeerGoneFromDirectChat({ isGroupConversation: true, otherParticipantId: undefined }), false, "group");
  if (!page.includes("isPeerGoneFromDirectChat({ isGroupConversation, otherParticipantId: otherParticipant?.id })")) {
    throw new Error("ConnectionsPage no longer checks for a chat whose person is gone");
  }
});

Deno.test("one retry: a blip recovers, and two failures stay unknown", async () => {
  let reads = 0;
  const recovered = await settleChatPeerRead({
    label: "t",
    read: () => {
      reads += 1;
      return Promise.resolve(reads === 1
        ? { data: null, error: { code: "57014" } }
        : { data: { active: false }, error: null });
    },
    classify: classifyPeerAccountRead,
    isCurrent: () => true,
    wait: noWait,
  });
  assertEquals(recovered, "deleted", "second try answers");
  assertEquals(reads, 2, "two reads");

  let failedReads = 0;
  const failed = await settleChatPeerRead({
    label: "t",
    read: () => {
      failedReads += 1;
      return Promise.reject(new Error("offline"));
    },
    classify: classifyPeerAccountRead,
    isCurrent: () => true,
    wait: noWait,
  });
  assertEquals(failed, "unknown", "both failed");
  assertEquals(failedReads, 2, "never a third read");
});

Deno.test("a real answer is not read twice", async () => {
  let reads = 0;
  await settleChatPeerRead({
    label: "t",
    read: () => {
      reads += 1;
      return Promise.resolve({ data: null, error: { code: "PGRST116" } });
    },
    classify: classifyPeerAccountRead,
    isCurrent: () => true,
    wait: noWait,
  });
  assertEquals(reads, 1, "PGRST116 is an answer");
});

Deno.test("stale: the chat moved on during the read", async () => {
  const state = await settleChatPeerRead({
    label: "t",
    read: () => Promise.resolve({ data: { active: false }, error: null }),
    classify: classifyPeerAccountRead,
    isCurrent: () => false,
    wait: noWait,
  });
  assertEquals(state, null, "dropped");
});

Deno.test("stale: the chat moved on during the retry wait, so no second read", async () => {
  let current = true;
  let reads = 0;
  const state = await settleChatPeerRead({
    label: "t",
    read: () => {
      reads += 1;
      return Promise.resolve({ data: null, error: { code: "57014" } });
    },
    classify: classifyPeerAccountRead,
    isCurrent: () => current,
    wait: () => {
      current = false;
      return Promise.resolve();
    },
  });
  assertEquals(state, null, "dropped");
  assertEquals(reads, 1, "no second read");
});

Deno.test("stale: the chat moved on during the second read", async () => {
  let current = true;
  let reads = 0;
  const state = await settleChatPeerRead({
    label: "t",
    read: () => {
      reads += 1;
      if (reads === 2) current = false;
      return Promise.resolve(reads === 1
        ? { data: null, error: { code: "57014" } }
        : { data: { active: false }, error: null });
    },
    classify: classifyPeerAccountRead,
    isCurrent: () => current,
    wait: noWait,
  });
  assertEquals(state, null, "dropped");
});

Deno.test("the page takes its answer from the helper and sets flags only on a real answer", () => {
  for (const gone of ["|| !otherProfile", "!isFriendNow"]) {
    if (page.includes(gone)) throw new Error(`ConnectionsPage still decides from data alone: ${gone}`);
  }
  for (const needed of [
    "classify: classifyPeerAccountRead",
    "classify: classifyPeerFriendshipRead",
    "if (state === 'deleted' || state === 'active') {",
    "if (state === 'friends' || state === 'not_friends') {",
  ]) {
    if (!page.includes(needed)) throw new Error(`ConnectionsPage is missing: ${needed}`);
  }
});

Deno.test("the helper stays free of expo, React and supabase imports", async () => {
  const helper = await Deno.readTextFile(new URL("../chatPeerState.ts", import.meta.url));
  if (/^\s*import\s/m.test(helper)) throw new Error("chatPeerState.ts must not import anything");
});
