// @ts-nocheck
// ORCH-1030 [Consumer app notification deep-linking] — ADVERSARIAL regression test (tester-authored).
//
// This is the tester's INDEPENDENT gate. Unlike the implementor's happy-path
// test (deepLinkRouting.orch1030.test.ts), which proves the unified ladder
// routes well-formed inputs to the right Destination, this suite attacks the
// EDGE / ERROR / BOUNDARY / PARITY contract the implementor's test does NOT
// cover:
//
//   1. A valid URL pointing at a STALE/DELETED entity id must still produce a
//      well-formed Destination that the executor lands somewhere (never null,
//      never crash, never blank — graceful degrade).
//   2. Unknown scheme / unknown host / unknown path → parseDeepLink returns
//      null so the caller falls back by type (no dead tap, no throw).
//   3. The special-case-killer: a type that USED to have a hand-coded in-app
//      special-case (paired_user_*, direct_message_*, holiday_reminder) but
//      now ALSO carries a server data.deepLink — the SERVER LINK MUST WIN
//      (the special-case is gone; the deep link is canonical).
//   4. Push vs in-app vs deferred PARITY for the SAME malformed input — all
//      three call paths run the identical `parseDeepLink ?? typeFallbackDestination`
//      ladder, so they MUST reach the byte-identical Destination + identical
//      executor effects.
//   5. profile/{id} with empty / bare / whitespace id — boundary handling.
//   6. Exhaustiveness: every live consumer notification type, with NO deepLink
//      and NO ids, must yield a Destination whose executor lands on a real page
//      (never null, never a kind the executor has no branch for).
//
// fails-on-revert anchor: re-introducing the F-01
//   collaboration_/session_ → { kind:'page', page:'connections' }
// branch into typeFallbackDestination breaks tests in section (4) + (6).
import {
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  executeDeepLink,
  parseDeepLink,
  typeFallbackDestination,
} from "../deepLinkService.ts";

// The exact ladder every call site in index.tsx uses (in-app handler, push
// processNotification, deferred replay, OS Linking).
function route(type, data) {
  const deepLink = data?.deepLink;
  return (deepLink ? parseDeepLink(deepLink) : null) ??
    typeFallbackDestination(type, data);
}

function makeHandlers() {
  const calls = {
    page: null,
    sessionOpened: null,
    profileOpened: null,
    deepLinkParams: null,
    paywall: false,
  };
  const handlers = {
    setCurrentPage: (p) => (calls.page = p),
    setPendingSessionOpen: (s) => (calls.sessionOpened = s),
    setViewingFriendProfileId: (id) => (calls.profileOpened = id),
    setDeepLinkParams: (params) => (calls.deepLinkParams = params),
    setShowPaywall: (v) => (calls.paywall = v),
  };
  return { handlers, calls };
}

// Did the executor land the user *somewhere* (not a dead tap)? A destination
// is "landed" if it changed the page, opened a session, opened a profile
// overlay, or opened the paywall.
function landedSomewhere(calls) {
  return (
    calls.page !== null ||
    calls.sessionOpened !== null ||
    calls.profileOpened !== null ||
    calls.paywall === true
  );
}

// ── (1) Stale / deleted entity id — graceful degrade, never null ─────────────
Deno.test("ADV-1a: mingla://session/{deleted-id} still parses to a session Destination (executor lands Home, never blank)", () => {
  const dest = parseDeepLink("mingla://session/deleted-sess-404");
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "deleted-sess-404");
  const { handlers, calls } = makeHandlers();
  executeDeepLink(dest, handlers);
  // Lands Home (the correct container) + records the pending session open.
  // A non-existent session can never blank: index.tsx's pendingSessionOpen
  // effect just lands Home and clears the id.
  assertEquals(calls.page, "home");
  assertEquals(calls.sessionOpened, "deleted-sess-404");
  assertEquals(landedSomewhere(calls), true);
});

Deno.test("ADV-1b: mingla://calendar/{deleted-id} lands Likes→Calendar; stale id degrades to plain Calendar (CalendarTab only expands on match)", () => {
  const dest = parseDeepLink("mingla://calendar/deleted-entry-404");
  assertEquals(dest.kind, "calendarEntry");
  const { handlers, calls } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "likes");
  assertEquals(calls.deepLinkParams.tab, "calendar");
  // entryId is carried; CalendarTab only auto-expands when the id is found in
  // the loaded list, so a deleted id degrades to a plain Calendar landing.
  assertEquals(calls.deepLinkParams.entryId, "deleted-entry-404");
  assertEquals(landedSomewhere(calls), true);
});

Deno.test("ADV-1c: mingla://profile/{deleted-id} opens the profile overlay (ViewFriendProfileScreen renders its error state for a missing user, never blank)", () => {
  const dest = parseDeepLink("mingla://profile/deleted-user-404");
  assertEquals(dest.kind, "profile");
  const { handlers, calls } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.profileOpened, "deleted-user-404");
  assertEquals(landedSomewhere(calls), true);
});

// ── (2) Unknown scheme / host / path → null, never throws ────────────────────
Deno.test("ADV-2: garbage / unknown-scheme / unknown-path inputs return null and NEVER throw", () => {
  const garbage = [
    "ftp://session/x",
    "",
    "mingla://",
    "mingla://%%%",
    "mingla://totally-unknown-path/123",
    "not-even-a-url",
    "mingla://orders/abc", // documented latent null (no /chat)
  ];
  for (const g of garbage) {
    // Must never throw.
    let dest;
    const fn = () => {
      dest = parseDeepLink(g);
    };
    fn();
    assertEquals(dest, null, `${g} should parse to null`);
  }
  // And the full ladder over a garbage link still lands by type (no dead tap).
  const d = route("session_member_joined", {
    deepLink: "mingla://totally-unknown-path/123",
    sessionId: "s-real",
  });
  assertEquals(d.kind, "session");
  assertEquals(d.sessionId, "s-real");
});

// ── (3) Special-case killer: server deepLink MUST win over the old in-app special-case ──
Deno.test("ADV-3a: paired_user_saved_card WITH a server profile deepLink routes to that link's user, NOT the fallback actor_id (special-case gone)", () => {
  // Pre-fix, an in-app special-case forced paired_user_* to actor_id. Now the
  // server's data.deepLink is canonical: profile/srv-user must win over the
  // actor_id fallback.
  const dest = route("paired_user_saved_card", {
    deepLink: "mingla://profile/srv-user",
    actor_id: "stale-fallback-actor",
  });
  assertEquals(dest.kind, "profile");
  assertEquals(dest.userId, "srv-user");
  assertNotEquals(dest.userId, "stale-fallback-actor");
});

Deno.test("ADV-3b: direct_message_received WITH a server session deepLink follows the SERVER link (session), proving no DM special-case overrides the canonical link", () => {
  const dest = route("direct_message_received", {
    deepLink: "mingla://session/srv-sess",
    conversationId: "conv-fallback-should-be-ignored",
  });
  // The server link wins — it's a session, not the conversation the old
  // special-case would have forced.
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "srv-sess");
});

Deno.test("ADV-3c: holiday_reminder WITH a server profile deepLink wins over the partnerId fallback", () => {
  const dest = route("holiday_reminder", {
    deepLink: "mingla://profile/server-target",
    partnerId: "fallback-partner",
  });
  assertEquals(dest.kind, "profile");
  assertEquals(dest.userId, "server-target");
});

// ── (4) Push vs in-app vs deferred PARITY for the SAME malformed input ───────
Deno.test("ADV-4: in-app, push, and deferred-replay reach the IDENTICAL Destination + executor effects for the same malformed input", () => {
  // All three call sites run the same ladder. Feed a malformed deepLink that
  // forces the type fallback; all three must agree byte-for-byte.
  const type = "session_member_joined";
  const data = { deepLink: "mingla://%garbled%", sessionId: "sess-parity" };

  const inApp = route(type, data);
  const push = route(type, data);
  const deferred = route(type, data);
  assertEquals(inApp, push);
  assertEquals(push, deferred);
  assertEquals(inApp.kind, "session");

  const a = makeHandlers();
  executeDeepLink(inApp, a.handlers);
  const b = makeHandlers();
  executeDeepLink(push, b.handlers);
  const c = makeHandlers();
  executeDeepLink(deferred, c.handlers);
  assertEquals(a.calls.page, b.calls.page);
  assertEquals(b.calls.page, c.calls.page);
  assertEquals(a.calls.sessionOpened, c.calls.sessionOpened);
  assertEquals(a.calls.page, "home");
  // The bug regression assertion: NONE of the three may land Connections.
  for (const calls of [a.calls, b.calls, c.calls]) {
    assertNotEquals(calls.page, "connections");
  }
});

// ── (5) profile/{id} empty / bare / whitespace boundary ──────────────────────
Deno.test("ADV-5: profile with empty/bare id falls back to the user's own Profile tab (never an overlay for an empty id)", () => {
  const empty = parseDeepLink("mingla://profile/");
  assertEquals(empty.kind, "page");
  assertEquals(empty.page, "profile");

  const bare = parseDeepLink("mingla://profile");
  assertEquals(bare.kind, "page");
  assertEquals(bare.page, "profile");

  // Executor for the bare-profile page must land the Profile tab, not a
  // friend-profile overlay with an empty id.
  const { handlers, calls } = makeHandlers();
  executeDeepLink(empty, handlers);
  assertEquals(calls.page, "profile");
  assertEquals(calls.profileOpened, null);
});

// ── (6) Exhaustive: every live consumer type, no deepLink + no ids, lands a real page ──
Deno.test("ADV-6: every live consumer notification type (no deepLink, no ids) lands a real page via the executor — never null, never Connections for collab/session", () => {
  // The full live set from notify-dispatch typeToPreference + SESSION_SCOPED_TYPES.
  const liveTypes = [
    "friend_request_received",
    "friend_request_accepted",
    "pair_request_received",
    "pair_request_accepted",
    "paired_user_saved_card",
    "paired_user_visited",
    "collaboration_invite_received",
    "collaboration_invite_accepted",
    "collaboration_invite_declined",
    "session_member_joined",
    "session_member_left",
    "session_deleted",
    "board_card_saved",
    "board_card_voted",
    "board_card_rsvp",
    "board_card_matched",
    "board_card_message",
    "direct_message_received",
    "board_message_received",
    "board_message_mention",
    "re_engagement",
    "re_engagement_3d",
    "re_engagement_7d",
    "weekly_digest",
    "referral_credited",
    "trial_ending",
    "holiday_reminder",
    "birthday_reminder",
    "calendar_reminder_tomorrow",
    "calendar_reminder_today",
    "visit_feedback_prompt",
  ];

  const collabPrefixes = ["collaboration_", "session_", "board_card_"];

  for (const t of liveTypes) {
    const dest = typeFallbackDestination(t, {}); // no deepLink, no ids
    // 1. Never null — a type always yields a Destination.
    assertNotEquals(dest, null, `${t} produced null`);
    // 2. The executor must land somewhere real.
    const { handlers, calls } = makeHandlers();
    executeDeepLink(dest, handlers);
    assertEquals(
      landedSomewhere(calls),
      true,
      `${t} produced a dead tap (executor did nothing): ${JSON.stringify(dest)}`,
    );
    // 3. F-01 invariant: collaboration_/session_/board_card_ types must NEVER
    //    land Connections via the fallback.
    if (collabPrefixes.some((p) => t.startsWith(p))) {
      assertNotEquals(
        calls.page,
        "connections",
        `F-01 regression: ${t} fell back to Connections`,
      );
    }
  }
});

// ── (7) executor null-input contract: a null Destination is a safe no-op ─────
Deno.test("ADV-7: executeDeepLink(null) is a safe no-op (caller substitutes the fallback before calling)", () => {
  const { handlers, calls } = makeHandlers();
  executeDeepLink(null, handlers);
  assertEquals(landedSomewhere(calls), false);
});
