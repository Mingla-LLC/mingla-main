// @ts-nocheck
// ORCH-1080 [Notification deep-link map + collab→group-chat routing gap]
// TESTER-AUTHORED adversarial regression test — independent of the two
// implementor-authored suites (orch-1080-session-deeplink-to-group-chat +
// orch-1080-session-deeplink-adversarial). This is the CLOSE-gate Step 0.5(b)
// tester artifact.
//
// DISTINCT ANGLE — SIBLING-ROUTE COLLATERAL DAMAGE.
// The implementor tests prove the SESSION case (happy-path repoint to group
// chat; dead-code/query-form/no-deck-autoopen). They never exercise the OTHER
// deep-link cases that share the same `switch` the typed-`Destination`
// session-case edit lives in. A bad future edit (or a sloppy one) to the
// `session` branch could collaterally:
//   - cannibalize the `chat` case (route a DM/group-chat URL to a session),
//   - drop the `connections?tab=` param,
//   - crash on the empty-id `session` branch,
//   - or merge the `session` and `chat` Destination kinds.
//
// This suite drives the REAL `parseDeepLink` + `executeDeepLink` from
// deepLinkService.ts at RUNTIME (no source-text scraping for the routing
// assertions; we observe actual handler calls via a recording mock) and proves
// every sibling route still lands where it must — and is DIFFERENT from the
// session route.
//
// fails-on-revert: if a future edit makes the `chat` case parse to a session,
// drops the `connections` tab param, crashes the bare-`session` branch, or
// merges the session/chat Destination kinds, THIS test FAILS even though both
// implementor suites would still pass (they never touch these routes).
import assert from "node:assert/strict";
import { parseDeepLink, executeDeepLink } from "../deepLinkService.ts";

// A recording NavigationHandlers double — every executor branch routes through
// these, so we capture exactly what the real executeDeepLink does.
function makeRecorder() {
  const calls = {
    setCurrentPage: [],
    setDeepLinkParams: [],
    setShowPaywall: [],
    setViewingFriendProfileId: [],
    setShowPreferences: [],
  };
  const handlers = {
    setCurrentPage: (page) => calls.setCurrentPage.push(page),
    setDeepLinkParams: (params) => calls.setDeepLinkParams.push(params),
    setShowPaywall: (v) => calls.setShowPaywall.push(v),
    setViewingFriendProfileId: (id) => calls.setViewingFriendProfileId.push(id),
    setShowPreferences: (v) => calls.setShowPreferences.push(v),
  };
  return { calls, handlers };
}

function runOrch1077SiblingRoutesRegression() {
  // ── (1) DM: mingla://chat/{id}?type=direct → conversation, DM open, NOT session/Home ──
  {
    const dest = parseDeepLink("mingla://chat/conv-dm-1?type=direct");
    assert.equal(dest.kind, "conversation", "chat?type=direct must parse to a conversation Destination (not session)");
    assert.equal(dest.conversationId, "conv-dm-1", "chat?type=direct must carry the conversationId");
    assert.equal(dest.chatType, "direct", "chat?type=direct must preserve chatType:'direct' (the DM open)");

    const { calls, handlers } = makeRecorder();
    executeDeepLink(dest, handlers);
    assert.deepEqual(
      calls.setCurrentPage,
      ["connections"],
      "DM must route to the connections page (messages live there), exactly once",
    );
    assert.notEqual(calls.setCurrentPage[0], "home", "DM must NOT land Home");
    const dmParams = calls.setDeepLinkParams[0];
    assert.equal(dmParams.tab, "messages", "DM must open the messages tab");
    assert.equal(dmParams.conversationId, "conv-dm-1", "DM must forward the conversationId so the DM thread opens");
    assert.equal(dmParams.chatType, "direct", "DM must forward chatType:'direct'");
    assert.ok(!("sessionId" in dmParams), "DM must NOT acquire a sessionId (no session cannibalization)");
  }

  // ── (2) Group/board-message chat still routes to group chat (chat case not cannibalized) ──
  // The WORKING board-message path uses mingla://chat/{id}?type=group. We assert
  // the chat case is untouched by the session-case rewrite: it parses to a GROUP
  // conversation and routes to connections — NOT to a session, NOT to Home.
  {
    const dest = parseDeepLink("mingla://chat/conv-grp-1?type=group&sessionId=sess-xyz");
    assert.equal(
      dest.kind,
      "conversation",
      "chat?type=group must STILL parse to a conversation Destination — the session-case rewrite must not cannibalize the chat case",
    );
    assert.equal(dest.conversationId, "conv-grp-1", "group chat must carry the conversationId");
    assert.equal(dest.chatType, "group", "group chat must preserve chatType:'group'");

    const { calls, handlers } = makeRecorder();
    executeDeepLink(dest, handlers);
    assert.deepEqual(
      calls.setCurrentPage,
      ["connections"],
      "group chat must route to the connections page (the group chat lives there)",
    );
    assert.notEqual(calls.setCurrentPage[0], "home", "group chat must NOT land Home");
    const grpParams = calls.setDeepLinkParams[0];
    assert.equal(grpParams.tab, "messages", "group chat must open the messages tab");
    assert.equal(grpParams.conversationId, "conv-grp-1", "group chat must forward the conversationId");
    assert.equal(grpParams.chatType, "group", "group chat must forward chatType:'group'");
  }

  // ── (3) Connections tab param survives: mingla://connections?tab=requests ──
  {
    const dest = parseDeepLink("mingla://connections?tab=requests");
    assert.equal(dest.kind, "page", "connections must parse to a page Destination");
    assert.equal(dest.page, "connections", "connections must target the connections page");
    assert.equal(dest.params.tab, "requests", "the tab=requests param must survive parsing");

    const { calls, handlers } = makeRecorder();
    executeDeepLink(dest, handlers);
    assert.deepEqual(calls.setCurrentPage, ["connections"], "connections must route to the connections page");
    assert.equal(
      calls.setDeepLinkParams[0].tab,
      "requests",
      "the tab=requests param must reach the page via setDeepLinkParams (not dropped)",
    );
  }

  // ── (4) Bare mingla://session (no id) lands Home gracefully — empty-id guard ──
  // Adversarial: the new typed session-case code path must not crash on the
  // empty-id branch, and the executor must NOT call setDeepLinkParams with an
  // undefined sessionId (which would forward `{tab:'messages', sessionId:undefined}`
  // into ConnectionsPage and try to resolve a group chat for nothing).
  {
    const dest = parseDeepLink("mingla://session");
    assert.equal(dest.kind, "page", "bare mingla://session must degrade to a page Destination");
    assert.equal(dest.page, "home", "bare mingla://session must land Home (never a dead tap)");

    const { calls, handlers } = makeRecorder();
    executeDeepLink(dest, handlers); // must not throw
    assert.deepEqual(calls.setCurrentPage, ["home"], "bare session must route Home exactly once");
    // The page branch only forwards params when there are >0 keys; bare home has
    // none. Crucially, no session params with an undefined sessionId leak out.
    for (const params of calls.setDeepLinkParams) {
      assert.ok(
        !("sessionId" in params),
        "bare session must NOT forward a sessionId param (no undefined-id group-chat resolve attempt)",
      );
      assert.equal(params.tab, undefined, "bare session must NOT forward a messages tab");
    }
  }

  // ── (5) session and chat produce DIFFERENT Destinations (no accidental merge) ──
  {
    const sessionDest = parseDeepLink("mingla://session/sess-merge-check");
    const chatDest = parseDeepLink("mingla://chat/conv-merge-check?type=group");

    assert.equal(sessionDest.kind, "session", "session URL must produce kind:'session'");
    assert.equal(chatDest.kind, "conversation", "chat URL must produce kind:'conversation'");
    assert.notEqual(
      sessionDest.kind,
      chatDest.kind,
      "session and chat Destinations must be DIFFERENT kinds — the session-case edit must not merge them",
    );
    assert.equal(sessionDest.sessionId, "sess-merge-check", "session Destination keeps its sessionId");
    assert.equal(
      chatDest.sessionId,
      undefined,
      "conversation Destination must NOT carry a sessionId field (kinds stay structurally distinct)",
    );

    // And they route to structurally different params on the SAME page:
    const { calls: sCalls, handlers: sHandlers } = makeRecorder();
    executeDeepLink(sessionDest, sHandlers);
    const { calls: cCalls, handlers: cHandlers } = makeRecorder();
    executeDeepLink(chatDest, cHandlers);

    assert.equal(sCalls.setDeepLinkParams[0].sessionId, "sess-merge-check", "session route forwards sessionId");
    assert.equal(cCalls.setDeepLinkParams[0].conversationId, "conv-merge-check", "chat route forwards conversationId");
    assert.ok(
      !("sessionId" in cCalls.setDeepLinkParams[0]),
      "chat route must not forward a sessionId — proof the two routes stay independent",
    );
    assert.ok(
      !("conversationId" in sCalls.setDeepLinkParams[0]),
      "session route must not forward a conversationId — proof the two routes stay independent",
    );
  }
}

// Run when invoked directly. decodeURIComponent handles worktree paths with
// URL-reserved chars (`[`/`]`) so the direct-invocation guard matches.
const invokedDirectly =
  decodeURIComponent(import.meta.url) === `file://${process.argv[1]}`;
if (invokedDirectly) {
  try {
    runOrch1077SiblingRoutesRegression();
    console.log(
      "PASS ORCH-1080 sibling-routes regression (tester-authored): DM + group-chat + connections-tab + bare-session-Home + no session/chat merge — session-case edit did not break sibling routes",
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
