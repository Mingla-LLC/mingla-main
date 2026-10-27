// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2b — the friends sheet and Add a friend, as pure rules.
//
//   M-1  Add a friend always goes through send-pair-request: a found user is
//        sent by id, a number not on Mingla by phone; already friends, pending
//        and "that's you" send nothing.
//   M-2  "Invite texted" only when the server says the text went; otherwise the
//        share fallback with the returned OneLink. The limit flag is carried.
//   M-3  ONE Accept runs the friend accept, THEN the pair accept; at the limit
//        the person is still a friend, and the paywall is theirs or mine.
//   M-4  Received: a friend request with a hidden pair request is ONE row.
//   M-5  Sent: phone invites appear (new pair invites and the old ones, once
//        per number), and a friend request is folded into the pair request it
//        gates.
//   M-6  Paired: next-birthday labels, and the + tile's free-plan state.
//   M-7  Phone masking for the invite confirmation.
//
// FAILS-ON-REVERT: drop the `phone_invite` rows from buildSentRows and M-5
// fails; swap the order in runCombinedAccept (or skip acceptPair) and M-3
// fails; make addFriendOutcome say texted for any Tier 3 and M-2 fails.

import {
  addFriendCard,
  addFriendOutcome,
  addFriendRequestBody,
  buildReceivedRows,
  buildSentRows,
  maskPhone,
  nextBirthdayLabel,
  pairTileState,
  runCombinedAccept,
} from "../friendsSheetModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const ME = "00000000-0000-4000-8000-0000000000aa";
const BISI = "00000000-0000-4000-8000-0000000000b1";

function lookup(found: boolean, status = "none", id = BISI) {
  return {
    found,
    user: found ? { id, display_name: "Bisi Adeyemi", username: "bisi", avatar_url: null } : null,
    friendship_status: status,
  };
}
const card = (l, extra = {}) =>
  addFriendCard({ digitCount: 10, debouncing: false, loading: false, failed: false, lookup: l, currentUserId: ME, ...extra });

Deno.test("M-1 Add a friend: found → by id, not on Mingla → by phone, the rest send nothing", () => {
  const found = card(lookup(true));
  assertEquals(found.kind, "found", "a Mingla user who is not a friend can be added");
  assertEquals(addFriendRequestBody(found, "+2348035550142"), { friendUserId: BISI }, "found user goes to send-pair-request by id");

  const notOn = card(lookup(false));
  assertEquals(notOn.kind, "not_on_mingla", "unknown number → invite");
  assertEquals(addFriendRequestBody(notOn, "+2348035554412"), { phoneE164: "+2348035554412" }, "invite goes to send-pair-request by phone");

  assertEquals(card(lookup(true, "friends")).kind, "friends", "already friends → Message");
  assertEquals(card(lookup(true, "pending_sent")).kind, "pending", "pending → Pending");
  assertEquals(card(lookup(true, "none", ME)).kind, "self", "own number → That's you");
  assertEquals(card(lookup(true), { pendingUserIds: new Set([BISI]) }).kind, "pending", "a pending pair counts as pending");
  for (const k of ["friends", "pending", "self"]) {
    const c = k === "self" ? card(lookup(true, "none", ME)) : card(lookup(true, k === "friends" ? "friends" : "pending_sent"));
    assertEquals(addFriendRequestBody(c, "+1"), null, `${k} sends nothing`);
  }
  assertEquals(addFriendCard({ digitCount: 6, debouncing: false, loading: false, failed: false, lookup: null, currentUserId: ME }).kind, "idle", "fewer than 7 digits: no lookup");
  assertEquals(addFriendCard({ digitCount: 9, debouncing: true, loading: false, failed: false, lookup: null, currentUserId: ME }).kind, "searching", "while the 500ms debounce runs");
});

Deno.test("M-2 the outcome: texted only on sent; the limit flag is carried", () => {
  assertEquals(addFriendOutcome({ tier: 3, smsStatus: "sent" }), { kind: "invite_texted", pairingLimitReached: false }, "sent → Invite texted");
  assertEquals(
    addFriendOutcome({ tier: 3, smsStatus: "failed", inviteLink: "https://go.usemingla.com/w36m?x=1" }),
    { kind: "invite_not_texted", inviteLink: "https://go.usemingla.com/w36m?x=1", pairingLimitReached: false },
    "failed → share fallback with the OneLink",
  );
  assertEquals(addFriendOutcome({ tier: 3 }).kind, "invite_not_texted", "no SMS status is never claimed as texted");
  assertEquals(addFriendOutcome({ tier: 2, friendOnly: true, pairingLimitReached: true }), { kind: "request_sent", pairingLimitReached: true }, "D16 friend-only send");
  assertEquals(addFriendOutcome({ tier: 2 }), { kind: "request_sent", pairingLimitReached: false }, "friend + pair send");
});

Deno.test("M-3 the combined Accept runs both accepts, friend first, and survives the limit", async () => {
  const calls: string[] = [];
  const deps = {
    acceptFriend: async (id: string) => { calls.push(`friend:${id}`); },
    acceptPair: async (id: string) => { calls.push(`pair:${id}`); return { pairingId: "p" }; },
  };
  const ok = await runCombinedAccept({ friendRequestId: "fr1", pairRequestId: "pr1" }, ME, deps);
  assertEquals(calls, ["friend:fr1", "pair:pr1"], "ONE Accept = friend accept then pair accept");
  assertEquals(ok, { friends: true, paired: true }, "friends and paired");

  const limited = (who: string | null) => ({
    acceptFriend: async () => {},
    acceptPair: async () => {
      const err = new Error("pairing_limit_reached");
      err.limitedUserId = who;
      throw err;
    },
  });
  assertEquals(await runCombinedAccept({ friendRequestId: "f", pairRequestId: "p" }, ME, limited(ME)), { friends: true, paired: false, limit: "mine" }, "my limit → paywall");
  assertEquals(await runCombinedAccept({ friendRequestId: "f", pairRequestId: "p" }, ME, limited(BISI)), { friends: true, paired: false, limit: "theirs" }, "their limit → just friends");
  assertEquals((await runCombinedAccept({ friendRequestId: "f", pairRequestId: "p" }, ME, limited(null))).limit, "mine", "unknown → treat as mine (paywall)");

  let pairCalled = false;
  let threw = false;
  try {
    await runCombinedAccept({ friendRequestId: "f", pairRequestId: "p" }, ME, {
      acceptFriend: async () => { throw new Error("network"); },
      acceptPair: async () => { pairCalled = true; },
    });
  } catch {
    threw = true;
  }
  assert(threw && !pairCalled, "a failed friend accept throws and never tries the pair");
});

Deno.test("M-4 Received: a friend request carrying a hidden pair request is ONE row", () => {
  const rows = buildReceivedRows({
    incomingFriendRequests: [
      { id: "fr-femi", sender_id: "femi", receiver_id: ME, status: "pending", created_at: "2026-10-25T10:00:00Z", sender: { display_name: "Femi Ade" } },
      { id: "fr-zara", sender_id: "zara", receiver_id: ME, status: "pending", created_at: "2026-10-24T10:00:00Z", sender: { display_name: "Zara O." } },
    ],
    hiddenPairRequests: [{ id: "pr-femi", senderId: "femi", gatedByFriendRequestId: "fr-femi", pendingPhoneE164: "+2348035554412" }],
    visiblePairRequests: [{ id: "pr-ada", senderId: "ada", senderName: "Ada Okafor", senderAvatar: null, createdAt: "2026-10-23T10:00:00Z" }],
  });
  assertEquals(rows.map((r) => r.kind), ["friend_pair", "friend", "pair"], "combined row, plain friend request, pair-only");
  assertEquals(rows[0].pairRequestId, "pr-femi", "the combined row carries the hidden pair request");
  assertEquals(rows[0].invitedByText, true, "a converted text invite is labelled");
  assertEquals(rows.length, 3, "no second row for the hidden pair request");
});

Deno.test("M-5 Sent: phone invites appear, once per number, and friend + pair folds into one row", () => {
  const rows = buildSentRows({
    outgoingFriendRequests: [
      { id: "fr-kemi", sender_id: ME, receiver_id: "kemi", status: "pending", created_at: "2026-10-22T10:00:00Z", sender: { display_name: "Kemi N." } },
      { id: "fr-zara", sender_id: ME, receiver_id: "zara", status: "pending", created_at: "2026-10-21T10:00:00Z", sender: { display_name: "Zara O." } },
    ],
    pairingPills: [
      { id: "request-1", type: "pending_request", displayName: "Kemi N.", avatarUrl: null, pillState: "greyed_waiting_friend", pairedUserId: "kemi", birthday: null, pairingId: null, pairRequestId: "pr-kemi", pendingInviteId: null, createdAt: "2026-10-22T10:00:00Z" },
      { id: "invite-1", type: "pending_invite", displayName: "+2348035554412", avatarUrl: null, pillState: "greyed_waiting_signup", pairedUserId: null, birthday: null, pairingId: null, pairRequestId: null, pendingInviteId: "inv-1", createdAt: "2026-10-25T10:00:00Z" },
      { id: "pairing-1", type: "active", displayName: "Ada", avatarUrl: null, pillState: "active", pairedUserId: "ada", birthday: null, pairingId: "pg1", pairRequestId: "x", pendingInviteId: null, createdAt: "2026-01-01T10:00:00Z" },
    ],
    legacyPhoneInvites: [
      { id: "legacy-1", phoneE164: "+2348035554412", createdAt: "2026-10-20T10:00:00Z" },
      { id: "legacy-2", phoneE164: "+447700900123", createdAt: "2026-10-19T10:00:00Z" },
    ],
  });
  const invites = rows.filter((r) => r.kind === "phone_invite");
  assertEquals(invites.map((r) => r.phoneE164), ["+2348035554412", "+447700900123"], "phone invites are listed, one per number");
  assertEquals(invites[0].pairInviteId, "inv-1", "the Add a friend invite cancels through pending_pair_invites");
  assertEquals(invites[1].legacyInviteId, "legacy-2", "the old friends-sheet invite is cancellable too");
  assertEquals(rows.filter((r) => r.kind === "friend_pair_request").length, 1, "Kemi's friend request folds into her pair request");
  assertEquals(rows.filter((r) => r.kind === "friend_request").map((r) => r.friendRequestId), ["fr-zara"], "a plain friend request stays");
  assert(!rows.some((r) => r.key.includes("pairing-1")), "an active pair is not a sent request");
});

Deno.test("M-6 Paired: next birthday and the + tile", () => {
  const today = new Date(2026, 9, 25); // 25 Oct 2026
  assertEquals(nextBirthdayLabel("1994-11-06", today), { kind: "in_days", days: 12 }, "within 30 days → Bday in 12d");
  assertEquals(nextBirthdayLabel("1990-10-25", today), { kind: "today" }, "today");
  assertEquals(nextBirthdayLabel("1991-02-03", today), { kind: "on_date", month: 2, day: 3 }, "later → the date");
  assertEquals(nextBirthdayLabel("1992-10-24", today), { kind: "on_date", month: 10, day: 24 }, "yesterday's birthday rolls to next year");
  assertEquals(nextBirthdayLabel(null, today), null, "no birthday → no label (never faked)");
  assertEquals(pairTileState({ pairedCount: 1, isUnlimited: false, freeLimit: 1 }), { showFreeCount: true, used: 1, limit: 1, atLimit: true }, "1 of 1 free, at the limit");
  assertEquals(pairTileState({ pairedCount: 0, isUnlimited: false, freeLimit: 1 }).atLimit, false, "free slot left");
  assertEquals(pairTileState({ pairedCount: 7, isUnlimited: true, freeLimit: -1 }).showFreeCount, false, "Mingla+ shows no count");
});

Deno.test("M-7 the invite confirmation masks the number", () => {
  assertEquals(maskPhone("+2348035554412", ["+1", "+234", "+44"]), "+234 803 ••• 4412", "design copy");
  assertEquals(maskPhone("+447700900123", ["+1", "+234", "+44"]), "+44 770 ••• 0123", "UK");
});
