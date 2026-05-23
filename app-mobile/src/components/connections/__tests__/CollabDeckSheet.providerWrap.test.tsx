declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath: string): string {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readCollabDeckSheetSource(): string {
  return fs.readFileSync(
    resolveRepoFile("src/components/connections/CollabDeckSheet.tsx"),
    "utf8",
  );
}

function getDeckBlock(source: string): string {
  const match = source.match(
    /<View style=\{styles\.deck\}>([\s\S]*?)<\/View>/,
  );
  assert.ok(match, "expected CollabDeckSheet to render <View style={styles.deck}>");
  return match[1];
}

function getProviderBlock(source: string): string {
  const deckBlock = getDeckBlock(source);
  const providerStart = deckBlock.indexOf("<RecommendationsProvider");
  const swipeableStart = deckBlock.indexOf("<SwipeableCards");
  const providerEnd = deckBlock.indexOf("</RecommendationsProvider>");

  assert.notEqual(
    providerStart,
    -1,
    "expected RecommendationsProvider ancestor, found none",
  );
  assert.notEqual(swipeableStart, -1, "expected SwipeableCards inside deck block");
  assert.notEqual(providerEnd, -1, "expected closing RecommendationsProvider");
  assert.ok(
    providerStart < swipeableStart && swipeableStart < providerEnd,
    "expected RecommendationsProvider to wrap SwipeableCards",
  );

  return deckBlock.slice(providerStart, providerEnd);
}

function assertSessionScopedProvider(source: string, sessionId: string) {
  const providerBlock = getProviderBlock(source);
  assert.match(
    providerBlock,
    /currentMode=\{sessionId\}/,
    `${sessionId}: inner provider currentMode must come from sessionId`,
  );
  assert.match(
    providerBlock,
    /persistedSessionId=\{sessionId\}/,
    `${sessionId}: inner provider persistedSessionId must come from sessionId`,
  );
  assert.match(
    providerBlock,
    /refreshKey=\{0\}/,
    `${sessionId}: inner provider refreshKey must stay static`,
  );
  assert.match(
    providerBlock,
    /onSessionLost=\{onClose\}/,
    `${sessionId}: inner provider must close the sheet when the session is lost`,
  );
  assert.match(
    providerBlock,
    /key=\{sessionId\}/,
    `${sessionId}: inner provider must remount when the session changes`,
  );
  assert.doesNotMatch(
    providerBlock,
    /currentMode=["']solo["']/,
    `${sessionId}: inner provider must not inherit the ambient solo mode`,
  );
}

export function runCollabDeckSheetProviderWrapTest() {
  const source = readCollabDeckSheetSource();

  assert.match(
    source,
    /import \{ RecommendationsProvider \} from "\.\.\/\.\.\/contexts\/RecommendationsContext";/,
    "CollabDeckSheet must import RecommendationsProvider",
  );

  // T-IMP-1: SwipeableCards is wrapped in a RecommendationsProvider ancestor.
  assertSessionScopedProvider(source, "session-A");

  // T-IMP-2: an ambient global currentMode="solo" provider cannot win because
  // the inner provider supplies currentMode={sessionId} to the SwipeableCards
  // subtree.
  const providerBlock = getProviderBlock(source);
  assert.ok(
    providerBlock.indexOf("currentMode={sessionId}") <
      providerBlock.indexOf("<SwipeableCards"),
    "session provider currentMode must be established before SwipeableCards renders",
  );

  // T-IMP-3: key={sessionId} forces a clean provider remount on session switch.
  assertSessionScopedProvider(source, "session-B");
}

if (require.main === module) {
  try {
    runCollabDeckSheetProviderWrapTest();
    console.log(
      "PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider",
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
