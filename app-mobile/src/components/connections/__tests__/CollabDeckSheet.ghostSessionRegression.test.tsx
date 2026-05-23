declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PRIOR_SESSION_ID = "d5ca15ba-e6ce-4f95-a192-03b580e2017d";
const ACTIVE_SESSION_ID = "daadd454-35a8-487d-ab25-bb595abc4635";
const FOREIGN_SESSION_ID = "49f937fb-a2a2-406a-bda2-1cdb22367d34";
const RETEST_2_FOREIGN_SESSION_ID = "f706a421-0c70-4763-8bfe-3fe534218626";

type QueryKey = readonly unknown[];

function resolveRepoFile(relPath: string): string {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath: string): string {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function queryStartsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

function invalidatedSessionIds(queryKeys: QueryKey[], prefix: QueryKey): string[] {
  return queryKeys
    .filter((key) => queryStartsWith(key, prefix))
    .map((key) => String(key[2] ?? ""))
    .filter(Boolean);
}

function getCollabParamsDetectorBlock(source: string): string {
  const marker = "// ── Collab params change detector";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "expected Collab params change detector block");
  const end = source.indexOf("// ── Computed UI State Machine", start);
  assert.notEqual(end, -1, "expected end of Collab params change detector block");
  return source.slice(start, end);
}

function getCollabDeckParamsBlock(source: string): string {
  const marker = "const collabDeckParams = useMemo(() => {";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "expected collabDeckParams memo");
  const end = source.indexOf("// ── Solo Deck Hook", start);
  assert.notEqual(end, -1, "expected end of collabDeckParams block");
  return source.slice(start, end);
}

function getResolvedSessionIdBlock(source: string): string {
  const marker = "const resolvedSessionId = React.useMemo(() => {";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "expected resolvedSessionId memo");
  const end = source.indexOf("const [hasTimedOutWaitingForSession", start);
  assert.notEqual(end, -1, "expected end of resolvedSessionId memo block");
  return source.slice(start, end);
}

function getBoardSessionUpdatedBlock(source: string): string {
  const marker = "onSessionUpdated: (updatedSession: any) => {";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "expected useBoardSession onSessionUpdated callback");
  const end = source.indexOf("onParticipantJoined:", start);
  assert.notEqual(end, -1, "expected end of onSessionUpdated callback");
  return source.slice(start, end);
}

function inferCollabInvalidationPrefix(source: string): QueryKey {
  const detectorBlock = getCollabParamsDetectorBlock(source);
  const scopedPattern =
    /queryKey:\s*\[\s*['"]deck-cards['"]\s*,\s*['"]collab['"]\s*,\s*collabDeckParams\.sessionId\s*\]/s;
  if (scopedPattern.test(detectorBlock)) {
    return ["deck-cards", "collab", ACTIVE_SESSION_ID];
  }

  const broadPattern =
    /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*['"]deck-cards['"]\s*\]\s*\}\s*\)/s;
  if (broadPattern.test(detectorBlock)) {
    return ["deck-cards"];
  }

  assert.fail("expected collab params detector to invalidate deck-cards explicitly");
  throw new Error("unreachable");
}

function resolveOwnedCollabDeckParams(
  resolvedSessionId: string,
  sessionRow: { id: string; deck_params_hash?: string | null } | null,
  currentPosition: number,
) {
  if (!sessionRow || sessionRow.id !== resolvedSessionId) return null;
  return {
    sessionId: resolvedSessionId,
    currentPosition,
    deckParamsHash: sessionRow.deck_params_hash ?? null,
  };
}

export function runCollabDeckSheetGhostSessionRegressionTest() {
  const recommendationsContext = readSource("src/contexts/RecommendationsContext.tsx");
  const boardSession = readSource("src/hooks/useBoardSession.ts");
  const messageInterface = readSource("src/components/MessageInterface.tsx");
  const chatBanners = readSource("src/components/chat/CollabSessionChatBanners.tsx");

  const mountedQueries: QueryKey[] = [
    ["deck-cards", "collab", PRIOR_SESSION_ID, 44],
    ["deck-cards", "collab", FOREIGN_SESSION_ID, 44],
    ["deck-cards", "collab", ACTIVE_SESSION_ID, 44],
    ["deck-cards", "solo", null, 40.713, -74.006, "drinks", "", "walking"],
  ];

  const prefix = inferCollabInvalidationPrefix(recommendationsContext);
  const invalidated = invalidatedSessionIds(mountedQueries, prefix);

  assert.deepEqual(
    invalidated,
    [ACTIVE_SESSION_ID],
    "session_updated/collab-param refresh must not refetch a stale prior collab session id",
  );
  assert.ok(
    !invalidated.includes(PRIOR_SESSION_ID),
    "ghost prior session id must not be invalidated/refetched while another sheet is active",
  );
  assert.ok(
    !invalidated.includes(FOREIGN_SESSION_ID),
    "arbitrary foreign session id must not be invalidated/refetched while another sheet is active",
  );

  const resolverBlock = getResolvedSessionIdBlock(recommendationsContext);
  const persistedPriority = resolverBlock.indexOf("propPersistedSessionId");
  const uuidModePriority = resolverBlock.indexOf("UUID_REGEX.test(currentMode)");
  const currentSessionFallback = resolverBlock.indexOf("currentSession?.id");

  assert.ok(
    persistedPriority !== -1 && uuidModePriority !== -1 && currentSessionFallback !== -1,
    "resolvedSessionId must consider explicit persisted session, UUID currentMode, and currentSession fallback",
  );
  assert.ok(
    persistedPriority < currentSessionFallback,
    "explicit persisted session id must win over ambient currentSession id",
  );
  assert.ok(
    uuidModePriority < currentSessionFallback,
    "UUID currentMode must win over ambient currentSession id",
  );
  assert.match(
    resolverBlock,
    /currentSession\.id\s*===\s*currentMode\s*\|\|\s*currentSession\.name\s*===\s*currentMode/s,
    "currentSession fallback must only win when it matches the requested mode",
  );

  const collabDeckParamsBlock = getCollabDeckParamsBlock(recommendationsContext);
  assert.match(
    collabDeckParamsBlock,
    /sessionRow\.id\s*!==\s*resolvedSessionId/s,
    "collabDeckParams must reject a board session row that does not match the resolved explicit session",
  );
  assert.match(
    collabDeckParamsBlock,
    /sessionId:\s*resolvedSessionId/s,
    "collabDeckParams must use the resolved explicit session as the query owner",
  );
  assert.doesNotMatch(
    collabDeckParamsBlock,
    /sessionId:\s*sessionRow\.id/s,
    "collabDeckParams must not let a mutable board session row choose the query session id",
  );

  const correctParams = resolveOwnedCollabDeckParams(
    ACTIVE_SESSION_ID,
    { id: ACTIVE_SESSION_ID, deck_params_hash: "hash-a" },
    44,
  );
  assert.deepEqual(
    correctParams,
    {
      sessionId: ACTIVE_SESSION_ID,
      currentPosition: 44,
      deckParamsHash: "hash-a",
    },
    "active Testing stuff session should produce active collab deck params",
  );
  assert.equal(
    resolveOwnedCollabDeckParams(
      ACTIVE_SESSION_ID,
      { id: RETEST_2_FOREIGN_SESSION_ID, deck_params_hash: "hash-a" },
      44,
    ),
    null,
    "foreign f706 session row must not produce collabDeckParams while Testing stuff is the resolved session",
  );

  const boardSessionUpdatedBlock = getBoardSessionUpdatedBlock(boardSession);
  assert.match(
    boardSessionUpdatedBlock,
    /updatedSession\?\.session_id\s*\?\?\s*updatedSession\?\.id/s,
    "session_updated handler must read the broadcast session_id/id before mutating session state",
  );
  assert.match(
    boardSessionUpdatedBlock,
    /updatedSessionId\s*&&\s*updatedSessionId\s*!==\s*capturedSessionId/s,
    "session_updated handler must reject foreign preference broadcasts",
  );
  assert.match(
    boardSessionUpdatedBlock,
    /queryKey:\s*\[\s*['"]deck-cards['"]\s*,\s*['"]collab['"]\s*,\s*capturedSessionId\s*\]/s,
    "session_updated handler must invalidate only the subscribed collab session",
  );

  assert.match(
    messageInterface,
    /isCollabSessionGroupChat\s*&&\s*showCollabDeckSheet\s*&&\s*friend\.sessionId\s*\?\s*\(\s*<CollabDeckSheet/s,
    "MessageInterface must unmount CollabDeckSheet when the deck sheet is closed",
  );
  assert.match(
    chatBanners,
    /showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s,
    "CollabSessionChatBanners must unmount InChatDeckSheet when the deck sheet is closed",
  );
}

if (require.main === module) {
  try {
    runCollabDeckSheetGhostSessionRegressionTest();
    console.log(
      "PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids",
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
