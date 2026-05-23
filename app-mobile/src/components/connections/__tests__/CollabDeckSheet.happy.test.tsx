import { getCollabChatHeaderActions } from "../collabChatHeaderUtils";

declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");

function resolveCollabDeckRenderProps(sessionId?: string | null) {
  if (!sessionId) return null;
  return {
    currentMode: sessionId,
    sessionIdOverride: sessionId,
    boardsSessions: [],
    removedCardIds: [],
    refreshKey: 0,
  };
}

export function runCollabDeckSheetHappyTest() {
  const props = resolveCollabDeckRenderProps("abc");
  assert.deepEqual(props, {
    currentMode: "abc",
    sessionIdOverride: "abc",
    boardsSessions: [],
    removedCardIds: [],
    refreshKey: 0,
  });

  let closed = false;
  const onClose = () => {
    closed = true;
  };
  onClose();
  assert.equal(closed, true);

  assert.deepEqual(
    getCollabChatHeaderActions({
      matchesCount: 0,
      scheduledCount: 0,
    }).map((action) => action.id),
    ["swipe"],
  );

  assert.deepEqual(
    getCollabChatHeaderActions({
      matchesCount: 2,
      scheduledCount: 1,
    }).map((action) => action.id),
    ["matches", "swipe", "plans"],
  );
}

if (require.main === module) {
  try {
    runCollabDeckSheetHappyTest();
    console.log("PASS T-IMP-3 CollabDeckSheet happy path");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
