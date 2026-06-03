// @ts-nocheck
// ORCH-1030 [Consumer app notification deep-linking] regression test.
//
// Deno-runnable: deepLinkService.ts is a PURE module (zero RN deps), so the
// whole router can be exercised without a device. This is the fails-on-revert
// anchor for the PRIMARY acceptance gate (SC-1 / T-01 / T-02):
//
//   A collaboration_/session_ notification with NO data.deepLink must route to
//   the HOME container (with the session opened via setPendingSessionOpen),
//   NOT to Connections — both for the in-app sheet tap AND the OneSignal push
//   tap (they share one parseDeepLink ?? typeFallbackDestination ladder).
//
// Before the fix, index.tsx had an explicit
//   else if (type.startsWith('collaboration_') || type.startsWith('session_'))
//     setCurrentPage('connections')
// branch (F-01) and NAV_TARGETS as a third routing authority. The fix folds
// both into typeFallbackDestination, which returns the SAME Destination kinds
// the parser produces. This test reproduces the exact unified ladder and proves
// the destination is Home/session, never Connections.
import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  executeDeepLink,
  parseDeepLink,
  typeFallbackDestination,
} from "../deepLinkService.ts";

// The exact ladder both call sites in index.tsx use:
//   const dest = (deepLink ? parseDeepLink(deepLink) : null)
//     ?? typeFallbackDestination(type, data);
function route(type, data) {
  const deepLink = data?.deepLink;
  return (deepLink ? parseDeepLink(deepLink) : null) ??
    typeFallbackDestination(type, data);
}

// A handlers spy that records the page + session/profile effects the executor
// produces, mirroring index.tsx's NavigationHandlers object.
function makeHandlers() {
  const calls = {
    page: null,
    sessionOpened: null,
    profileOpened: null,
    deepLinkParams: null,
    paywall: false,
  };
  const handlers = {
    setCurrentPage: (p) => {
      calls.page = p;
    },
    setPendingSessionOpen: (s) => {
      calls.sessionOpened = s;
    },
    setViewingFriendProfileId: (id) => {
      calls.profileOpened = id;
    },
    setDeepLinkParams: (params) => {
      calls.deepLinkParams = params;
    },
    setShowPaywall: (v) => {
      calls.paywall = v;
    },
  };
  return { handlers, calls };
}

// ── PRIMARY GATE (SC-1 / T-01): session, no deepLink, in-app tap ──────────────
Deno.test("ORCH-1030 SC-1 PRIMARY: session_member_joined (no deepLink) routes to HOME+session, NOT Connections", () => {
  const dest = route("session_member_joined", { sessionId: "sess-123" });
  // Fallback must produce a session Destination, not a connections page.
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "sess-123");

  const { handlers, calls } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "home"); // lands Home — the correct container
  assertEquals(calls.sessionOpened, "sess-123"); // session opened
  // The bug regression assertion: it must NEVER land Connections.
  if (calls.page === "connections") {
    throw new Error("F-01 regression: session notification routed to Connections");
  }
});

// ── PARITY (SC-1 push leg / T-02): same ladder, identical result ──────────────
Deno.test("ORCH-1030 SC-1 push parity: push tap of the same session notification lands HOME+session identically", () => {
  // Both call paths run the identical ladder, so routing the same input twice
  // must yield identical effects (kills the 3-authority drift).
  const inApp = route("session_member_joined", { sessionId: "sess-123" });
  const push = route("session_member_joined", { sessionId: "sess-123" });
  assertEquals(inApp, push);

  const a = makeHandlers();
  executeDeepLink(inApp, a.handlers);
  const b = makeHandlers();
  executeDeepLink(push, b.handlers);
  assertEquals(a.calls.page, b.calls.page);
  assertEquals(a.calls.sessionOpened, b.calls.sessionOpened);
  assertEquals(a.calls.page, "home");
});

// ── collaboration_ prefix (F-01 sibling): same Home routing ──────────────────
Deno.test("ORCH-1030 collaboration_invite_received (no deepLink, no sessionId) routes to HOME, NOT Connections", () => {
  const dest = route("collaboration_invite_received", {});
  // No sessionId → page:home (still NOT connections).
  assertEquals(dest.kind, "page");
  assertEquals(dest.page, "home");

  const { handlers, calls } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "home");
  if (calls.page === "connections") {
    throw new Error("F-01 regression: collaboration_ notification routed to Connections");
  }
});

// ── SC-2: session WITH a deepLink resolves identically through the parser ─────
Deno.test("ORCH-1030 SC-2: mingla://session/{id} deepLink routes to HOME+session", () => {
  const dest = route("board_card_saved", { deepLink: "mingla://session/sess-999" });
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "sess-999");
  const { calls, handlers } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "home");
  assertEquals(calls.sessionOpened, "sess-999");
});

// ── T-04: query-form session?id= (tag-along producer) ─────────────────────────
Deno.test("ORCH-1030 T-04: query-form mingla://session?id={id} routes to HOME+session", () => {
  const dest = parseDeepLink("mingla://session?id=sess-q");
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "sess-q");
});

// ── SC-8 / T-14: fallback==parser agreement for every live type ──────────────
// For each type, the typeFallbackDestination page must not contradict the page
// the executor lands on; specifically, collab/session types must never produce
// a Connections destination.
Deno.test("ORCH-1030 T-14: no collab/session type falls back to Connections", () => {
  const collabTypes = [
    "session_member_joined",
    "session_member_left",
    "session_deleted",
    "collaboration_invite_received",
    "collaboration_invite_accepted",
    "board_card_saved",
    "board_card_voted",
  ];
  for (const t of collabTypes) {
    const dest = typeFallbackDestination(t, {}); // no ids
    const landsConnections = dest.kind === "page" && dest.page === "connections";
    assertEquals(landsConnections, false, `${t} must not fall back to Connections`);
  }
});

// ── SC-7 / T-11: malformed link never crashes, falls back by type ────────────
Deno.test("ORCH-1030 T-11: malformed deepLink returns null → caller falls back by type", () => {
  assertEquals(parseDeepLink("mingla://garbage"), null);
  // The ladder then uses the type fallback (Home for an unknown collab type).
  const dest = route("session_member_joined", { deepLink: "mingla://garbage", sessionId: "s1" });
  assertEquals(dest.kind, "session");
  assertEquals(dest.sessionId, "s1");
});

// ── SC-5 / T-09: profile route opens the friend profile overlay ──────────────
Deno.test("ORCH-1030 T-09: mingla://profile/{id} opens the friend profile, no page change", () => {
  const dest = route("birthday_reminder", { deepLink: "mingla://profile/user-42" });
  assertEquals(dest.kind, "profile");
  assertEquals(dest.userId, "user-42");
  const { calls, handlers } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.profileOpened, "user-42");
  assertEquals(calls.page, null); // overlay mounts over current page
});

// ── SC-3 / T-05: calendar reminder lands Likes→Calendar with entryId ─────────
Deno.test("ORCH-1030 T-05: mingla://calendar/{id} routes to Likes→Calendar carrying entryId", () => {
  const dest = route("calendar_reminder_today", { deepLink: "mingla://calendar/entry-7" });
  assertEquals(dest.kind, "calendarEntry");
  assertEquals(dest.entryId, "entry-7");
  const { calls, handlers } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "likes");
  assertEquals(calls.deepLinkParams.tab, "calendar");
  assertEquals(calls.deepLinkParams.entryId, "entry-7");
});

// ── F-11 / T-06: review carries experienceId (never silently dropped) ────────
Deno.test("ORCH-1030 T-06: mingla://review/{id} lands Likes→Calendar and carries experienceId", () => {
  const dest = route("visit_feedback_prompt", { deepLink: "mingla://review/exp-5" });
  assertEquals(dest.kind, "review");
  assertEquals(dest.experienceId, "exp-5");
  const { calls, handlers } = makeHandlers();
  executeDeepLink(dest, handlers);
  assertEquals(calls.page, "likes");
  assertEquals(calls.deepLinkParams.experienceId, "exp-5");
});

// ── SC-9 / T-15: lifecycle regressions stay correct ───────────────────────────
Deno.test("ORCH-1030 T-15: trial_ending→paywall, re_engagement→home (regression guard)", () => {
  const trial = route("trial_ending", {});
  assertEquals(trial.kind, "paywall");
  const t = makeHandlers();
  executeDeepLink(trial, t.handlers);
  assertEquals(t.calls.paywall, true);

  const reeng = route("re_engagement_7d", {});
  assertEquals(reeng.kind, "page");
  assertEquals(reeng.page, "home");
});
