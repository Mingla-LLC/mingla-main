// @ts-nocheck
// ORCH-1077 [Notification deep-link map + collab→group-chat routing gap]
// HAPPY-PATH regression test (implementor-authored). FAILS-ON-REVERT anchor.
//
// Source-assertion pattern (mirrors collabDeadEndBannerService.test.ts): pure
// node:assert/strict reads of the two touched source files. Runnable via
// `node <file>` and in CI with zero RN render harness.
//
// What it proves (the core fix, both files):
//   1. deepLinkService.ts `session` Destination routes to the GROUP CHAT
//      (page:'connections', tab:'messages', carrying sessionId) — NOT Home,
//      and reads the id from BOTH URL shapes (pathSegments[1] ?? params.id).
//   2. The dead Home/openSessionId/setPendingSessionOpen path is gone.
//   3. ConnectionsPage.tsx resolves deepLinkParams.sessionId via
//      getOrCreateGroupConversationForSession and carries session_id so the
//      in-chat deck CTA appears.
//
// Reverting EITHER edit (the parser/executor repoint OR the ConnectionsPage
// branch) makes this test FAIL.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function runOrch1077HappyPathTest() {
  const deepLinkSrc = readSource("src/services/deepLinkService.ts");
  const connectionsSrc = readSource("src/components/ConnectionsPage.tsx");

  // ── (A) deepLinkService: session Destination lands the group chat ──────────

  // [FAILS-ON-REVERT KEY] SC-3 / T-04: the parser reads the session id from BOTH
  // the path-form (mingla://session/{id}) AND the query-form
  // (mingla://session?id={id}, emitted by accept-tag-along).
  assert.match(
    deepLinkSrc,
    /pathSegments\[1\]\s*\?\?\s*params\.id/,
    "SC-3: session id must be derived as `pathSegments[1] ?? params.id` (both URL shapes)",
  );

  // [FAILS-ON-REVERT KEY] SC-1/SC-2: the EXECUTOR `session` branch routes to
  // connections (group chat) with tab:'messages' carrying the sessionId.
  assert.match(
    deepLinkSrc,
    /case 'session':[\s\S]*?tab:\s*'messages'[\s\S]*?sessionId:\s*dest\.sessionId[\s\S]*?setCurrentPage\('connections'\)/,
    "SC-1: the `session` executor must route to connections/messages carrying the sessionId",
  );

  // [FAILS-ON-REVERT KEY] SC-4: the `card` param survives into the group-chat params.
  assert.match(
    deepLinkSrc,
    /case 'session':[\s\S]*?params\.card[\s\S]*?\{\s*kind:\s*'session'[\s\S]*?card:\s*params\.card/,
    "SC-4: the parser must carry the `card` param through to the session Destination",
  );

  // SC-1: the `session` executor must NOT land Home anymore.
  assert.doesNotMatch(
    deepLinkSrc,
    /case 'session':[\s\S]*?setCurrentPage\('home'\)/,
    "SC-1: the dead Home landing for the `session` executor must be gone",
  );

  // ── (B) ConnectionsPage: sessionId → group conversation, carries session_id ─

  // [FAILS-ON-REVERT KEY] SC-1/SC-2 (component): the deep-link effect resolves
  // deepLinkParams.sessionId via getOrCreateGroupConversationForSession.
  assert.match(
    connectionsSrc,
    /getOrCreateGroupConversationForSession\(\s*deepLinkParams\.sessionId/,
    "SC-1: ConnectionsPage must resolve deepLinkParams.sessionId → group conversation",
  );

  // [FAILS-ON-REVERT KEY] in-chat deck CTA: the mapped conversation MUST carry
  // session_id so MessageInterface detects isCollabSessionGroupChat.
  assert.match(
    connectionsSrc,
    /session_id:\s*conversation\.session_id\s*\?\?\s*deepLinkParams\.sessionId/,
    "deck CTA: the resolved session conversation must carry session_id",
  );

  // SC-5/SC-6: the effect clears the pending deep link even when no conversation
  // resolves (graceful fallback, no stuck spinner).
  assert.match(
    connectionsSrc,
    /\}\s*else if \(!cancelled\) \{[\s\S]*?onDeepLinkHandled\?\.\(\)/,
    "SC-5/SC-6: the no-conversation path must still clear the pending deep link",
  );
}

// Run when invoked directly. The decode handles worktree paths containing URL-
// reserved chars (e.g. `[`/`]`), which would otherwise break a raw string match.
const invokedDirectly =
  decodeURIComponent(import.meta.url) === `file://${process.argv[1]}`;
if (invokedDirectly) {
  try {
    runOrch1077HappyPathTest();
    console.log(
      "PASS ORCH-1077 happy-path: session deep link → group chat (parser+executor+ConnectionsPage)",
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
