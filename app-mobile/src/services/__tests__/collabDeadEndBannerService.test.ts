// @ts-nocheck
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

function runCollabDeadEndBannerServiceTest() {
  const source = readSource("src/services/collabDeadEndBannerService.ts");

  // [FAILS-ON-REVERT KEY] T-08: old code had no system-message insert path for collab dead ends.
  assert.match(source, /getOrCreateGroupConversationForSession\(input\.sessionId\)/, "T-08 must resolve the session group conversation");
  assert.match(source, /\.from\('messages'\)\s*\.insert\(\{/s, "T-08 must insert into the canonical messages substrate");
  assert.match(source, /sender_id:\s*input\.currentUserId/, "T-08 must insert with the authenticated sender required by live messages RLS");
  assert.doesNotMatch(source, /sender_id:\s*null/, "T-08 must not regress to the null-sender insert rejected by live messages RLS");
  assert.match(source, /message_type:\s*'text'/, "T-08 must keep the existing text message_type contract");
  assert.match(source, /error\.message\s*\?\?\s*String\(error\)/, "T-08 insert failures must preserve the Supabase error message");
  assert.match(source, /\[\[open-prefs:travel:\$\{outlier\.userId\}\]\]/, "T-08 intersection banner must carry an open-prefs travel token");
  assert.match(source, /\[\[open-prefs:self:categories\]\]/, "T-08 category banner must carry self categories token");
  assert.match(source, /\[\[open-dismissed\]\]/, "T-08 no-unswiped banner must carry open-dismissed token");
  assert.match(source, /\[\[compose-mention:\$\{id\}:can_you_tap_accept\]\]/, "T-08 quorum banner must carry compose mention token");
  assert.match(source, /\[\[open-prefs:self:dates\]\]/, "T-08 exhausted banner must carry self dates token");

  // [FAILS-ON-REVERT KEY] T-09: debounce must prevent duplicate banner inserts within 5 minutes.
  assert.match(source, /DEBOUNCE_MS = 5 \* 60 \* 1000/, "T-09 debounce window must be five minutes");
  assert.match(source, /orch_0945_banner_debounce:\$\{input\.sessionId\}:\$\{input\.currentUserId\}:\$\{input\.reason\}/, "T-09 debounce key must include session, user, and reason");
  assert.match(source, /now - previousTimestamp < DEBOUNCE_MS/, "T-09 duplicate taps inside debounce window must short-circuit");
  assert.match(source, /Already flagged just now\./, "T-09 debounce no-op must surface a short toast");

  const messagingSource = readSource("src/services/messagingService.ts");
  assert.match(messagingSource, /isCollabDeadEndBannerMessage/, "T-08 must classify user-attributed ORCH-0945 banners for system rendering");
  assert.match(messagingSource, /message\.sender_id === null \|\| isCollabDeadEndBannerMessage\(message\.content\)/, "T-08 system rendering must preserve null-sender banners and add only the ORCH-0945 banner contract");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runCollabDeadEndBannerServiceTest();
    console.log("PASS T-08..T-09 ORCH-0945 collab dead-end banner insert + debounce");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
