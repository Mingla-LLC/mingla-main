// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 5 — the rules of a collab inside a 1:1 chat.
//
// FAILS-ON-REVERT:
//  - dmCollabHeaderMode offering Collab to a non-friend, while loading, or
//    while a collab is live, or not switching to the collab header once the
//    friend joined;
//  - chatKind not reading live_session_* (a 1:1 collab row losing its deck badge);
//  - dmCollabNeedsPaywall letting a free account past its one open session;
//  - the invite cards showing Join to the starter or after the friend joined;
//  - the chat menu missing "Start a collab" / "End the collab" at the right time.

import {
  dmCollabCardView,
  dmCollabHeaderMode,
  dmCollabNeedsPaywall,
  isDmCollabActive,
  isDmCollabEventPayload,
  isLiveSessionStatus,
  latestDmCollabEventKey,
  parseDmCollabStartError,
} from "../dmCollabModel.ts";
import { chatKind, matchesChatFilter } from "../../connections/chatListModel.ts";
import { buildFriendMenu } from "../../../utils/chatMenuModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const ME = "me";
const FRIEND = "friend";
const pending = {
  id: "s1",
  name: "Ife & Tomi",
  status: "pending",
  createdBy: ME,
  createdAt: "2026-10-26T10:00:00Z",
  participants: [
    { userId: ME, hasAccepted: true },
    { userId: FRIEND, hasAccepted: false },
  ],
};
const active = {
  ...pending,
  status: "active",
  participants: [
    { userId: ME, hasAccepted: true },
    { userId: FRIEND, hasAccepted: true },
  ],
};

Deno.test("W5 the Collab button shows only for a friend with no live collab", () => {
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: true, session: null, loading: false }), "start", "friend, nothing live");
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: false, session: null, loading: false }), "none", "not a friend (blocked / unfriended)");
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: true, session: null, loading: true }), "none", "still loading");
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: true, session: pending, loading: false }), "pending", "invite out");
  assertEquals(dmCollabHeaderMode({ isDirect: false, isFriend: true, session: null, loading: false }), "none", "groups have their own header");
});

Deno.test("W5 once the friend joins, the 1:1 chat gets the collab header", () => {
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: true, session: active, loading: false }), "active", "active");
  assertEquals(dmCollabHeaderMode({ isDirect: true, isFriend: true, session: { ...active, status: "locked" }, loading: false }), "active", "a plan being locked is still the collab");
  assertEquals(isDmCollabActive(pending), false, "pending is not active");
  assertEquals(["pending", "active", "voting", "locked"].every(isLiveSessionStatus), true, "live statuses");
  assertEquals(["completed", "archived", "dormant", null].some(isLiveSessionStatus), false, "ended statuses");
});

Deno.test("W5 the paywall opens at the free plan's limit (D4)", () => {
  assertEquals(dmCollabNeedsPaywall({ canCreateSession: false, isUnlimited: false }), true, "free at limit");
  assertEquals(dmCollabNeedsPaywall({ canCreateSession: true, isUnlimited: false }), false, "free with room");
  assertEquals(dmCollabNeedsPaywall({ canCreateSession: false, isUnlimited: true }), false, "Mingla+");
  assertEquals(parseDmCollabStartError("session_limit_reached: You have reached your free limit of 1 active session(s)."), "limit", "server limit error");
  assertEquals(parseDmCollabStartError("collab_already_live"), "already_live", "already live");
  assertEquals(parseDmCollabStartError("not_friends"), "not_friends", "not friends");
});

Deno.test("W5 chatKind direct_collab comes from the chat's live session", () => {
  const base = { id: "c1", created_at: "2026-10-26T10:00:00Z", type: "direct", participants: [] };
  assertEquals(chatKind(base), "direct", "plain 1:1");
  assertEquals(chatKind({ ...base, live_session_id: "s1", live_session_status: "pending" }), "direct", "invite out: still a plain circle");
  assertEquals(chatKind({ ...base, live_session_id: "s1", live_session_status: "active" }), "direct_collab", "friend collab: deck badge");
  assertEquals(chatKind({ ...base, live_session_id: null, live_session_status: null }), "direct", "ended");
  assertEquals(matchesChatFilter({ ...base, live_session_id: "s1", live_session_status: "active" }, "groups"), false, "a friend collab is not a group");
});

Deno.test("W5 invite cards: starter Set my vibes, friend Join / Not now", () => {
  const started = { kind: "dm_collab", event: "started", session_id: "s1", user_id: ME };
  assertEquals(isDmCollabEventPayload(started), true, "payload shape");
  assertEquals(isDmCollabEventPayload({ kind: "collab_dead_end" }), false, "other system rows");
  assertEquals(dmCollabCardView({ payload: started, session: pending, currentUserId: ME }).kind, "starter", "starter");
  assertEquals(dmCollabCardView({ payload: started, session: pending, currentUserId: FRIEND }).kind, "invitee", "friend can Join");
  assertEquals(dmCollabCardView({ payload: started, session: active, currentUserId: FRIEND }).kind, "notice", "joined: no buttons");
  assertEquals(dmCollabCardView({ payload: started, session: null, currentUserId: FRIEND }).kind, "notice", "ended: no buttons");
  assertEquals(dmCollabCardView({ payload: { ...started, session_id: "old" }, session: pending, currentUserId: FRIEND }).kind, "notice", "an older collab's card");
  assertEquals(
    latestDmCollabEventKey([
      { id: "m1", cardPayload: started },
      { id: "m2", cardPayload: null },
      { id: "m3", cardPayload: { ...started, event: "joined" } },
      { id: "m4" },
    ]),
    "m3",
    "newest collab row",
  );
});

Deno.test("W5 the chat menu: Start a collab first, End the collab while one is live", () => {
  const chat = {
    surface: "chat",
    isFriend: true,
    pairState: "none",
    canOpenPairedView: false,
    canUnpair: false,
    canViewProfile: true,
    hasConversation: true,
    isMuted: false,
  };
  assertEquals(buildFriendMenu({ ...chat, canStartCollab: true })[0].id, "startCollab", "Start a collab is first");
  const live = buildFriendMenu({ ...chat, canStartCollab: false, canEndCollab: true }).map((item) => item.id);
  assertEquals(live[0], "endCollab", "End the collab takes its place");
  assertEquals(live.includes("startCollab"), false, "no second start while live");
  assertEquals(buildFriendMenu({ ...chat, isFriend: false, canStartCollab: true }).some((item) => item.id === "startCollab"), false, "not for a non-friend");
  assertEquals(buildFriendMenu({ ...chat, surface: "friendSheet", canStartCollab: true, canEndCollab: true }).some((item) => item.id === "startCollab" || item.id === "endCollab"), false, "chat surface only");
});
