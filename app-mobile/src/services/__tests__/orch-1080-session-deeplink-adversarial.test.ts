// @ts-nocheck
// ORCH-1080 [Notification deep-link map + collab→group-chat routing gap]
// ADVERSARIAL regression test — a DIFFERENT failure surface from the happy-path.
//
// The happy-path test proves the functional repoint (session → group chat) in
// the two touched files. This suite attacks three orthogonal surfaces a partial
// fix could leave broken:
//
//   1. DEAD-CODE ERADICATION (SC-7): a fix that repoints the parser/executor but
//      leaves the `setPendingSessionOpen` / `openSessionId` symbols anywhere in
//      app-mobile (deepLinkService.ts AND every executeDeepLink call site in
//      app/index.tsx, plus the NavigationHandlers interface) still satisfies the
//      happy-path test but FAILS here. We scan the actual source files.
//   2. QUERY-FORM COVERAGE (SC-3): the analysis-missed tag_along producer emits
//      `mingla://session?id={id}`. A pure path-form fix passes the happy-path's
//      `pathSegments[1]` check superficially but a regression dropping the
//      `params.id` fallback is caught here by exercising the LIVE parser at
//      runtime against the query-form URL.
//   3. NO DECK AUTO-OPEN (INV-COLLAB-DECK-IN-GROUP-CHAT, META-ORCH-0929): the
//      land target is the GROUP CHAT, never the deck and never Home. The
//      deep-link path must not reference CollabDeckSheet, and the session
//      executor must not return/route to Home.
//
// fails-on-revert: reverting the dead-code deletion (surface 1) or the
// `params.id` query-form fallback (surface 2) FAILS this test even if the
// happy-path test were left passing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDeepLink } from "../deepLinkService.ts";

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function runOrch1077AdversarialTest() {
  const deepLinkSrc = readSource("src/services/deepLinkService.ts");
  const indexSrc = readSource("app/index.tsx");

  // ── (1) Dead-code eradication across BOTH files (SC-7) ─────────────────────
  for (const [label, src] of [
    ["deepLinkService.ts", deepLinkSrc],
    ["app/index.tsx", indexSrc],
  ]) {
    assert.doesNotMatch(
      src,
      /setPendingSessionOpen/,
      `SC-7: ${label} must contain zero setPendingSessionOpen references (dead Home seam)`,
    );
    assert.doesNotMatch(
      src,
      /openSessionId/,
      `SC-7: ${label} must contain zero openSessionId references (dead Home seam)`,
    );
  }
  // The NavigationHandlers interface must no longer declare the removed handler.
  assert.doesNotMatch(
    deepLinkSrc,
    /NavigationHandlers\b[\s\S]*?setPendingSessionOpen/,
    "SC-7: NavigationHandlers must not declare setPendingSessionOpen",
  );

  // ── (2) Query-form coverage via the LIVE parser (SC-3) ─────────────────────
  // Path-form still works.
  const pathForm = parseDeepLink("mingla://session/sess-path");
  assert.equal(pathForm.kind, "session", "path-form must parse to a session Destination");
  assert.equal(pathForm.sessionId, "sess-path", "path-form session id must come from pathSegments[1]");

  // Query-form (tag_along_accepted / tag_along_match) must ALSO resolve.
  const queryForm = parseDeepLink("mingla://session?id=sess-query");
  assert.equal(queryForm.kind, "session", "query-form must parse to a session Destination");
  assert.equal(
    queryForm.sessionId,
    "sess-query",
    "SC-3: query-form session id must fall back to params.id",
  );

  // The source must still contain the `params.id` fallback (guards a refactor
  // that drops it but happens to pass the runtime check via a different path).
  assert.match(
    deepLinkSrc,
    /params\.id/,
    "SC-3: the parser must keep the params.id fallback for the query-form",
  );

  // ── (3) No deck auto-open; land target is group chat, not Home ─────────────
  assert.doesNotMatch(
    deepLinkSrc,
    /CollabDeckSheet/,
    "INV-COLLAB-DECK-IN-GROUP-CHAT: the deep-link service must never auto-open CollabDeckSheet",
  );
  // The session executor branch must route to connections, never Home.
  assert.match(
    deepLinkSrc,
    /case 'session':[\s\S]*?setCurrentPage\('connections'\)/,
    "land target: the session executor must route to connections (group chat)",
  );
  assert.doesNotMatch(
    deepLinkSrc,
    /case 'session':[\s\S]*?setCurrentPage\('home'\)/,
    "land target: the session executor must NOT route to Home",
  );
}

// Run when invoked directly. The decode handles worktree paths containing URL-
// reserved chars (e.g. `[`/`]`), which would otherwise break a raw string match.
const invokedDirectly =
  decodeURIComponent(import.meta.url) === `file://${process.argv[1]}`;
if (invokedDirectly) {
  try {
    runOrch1077AdversarialTest();
    console.log(
      "PASS ORCH-1080 adversarial: dead-code absence + query-form parsing + no deck auto-open",
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
