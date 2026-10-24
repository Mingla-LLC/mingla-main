/**
 * #3355 — settled thread: no second programmatic bottom scroll for one tail
 * update; history mode surfaces a New reply control instead of stealing the
 * reading position.
 */
import fs from "node:fs";
import path from "node:path";

const messageListSrc = fs.readFileSync(
  path.join(__dirname, "../MessageList.tsx"),
  "utf8",
);
const screenSrc = fs.readFileSync(
  path.join(__dirname, "../../../screens/ari/AriChatScreen.tsx"),
  "utf8",
);

describe("#3355 settled Ari thread scroll", () => {
  test("auto-scroll effect does not depend on isThinking", () => {
    expect(messageListSrc).toMatch(/newestId/);
    expect(messageListSrc).toMatch(/pendingId/);
    expect(messageListSrc).not.toMatch(
      /\[items\.length,\s*pendingAction\?\.pending_action_id,\s*isThinking\]/,
    );
  });

  test("scroll coalesces through a generation guard", () => {
    expect(messageListSrc).toMatch(/scrollGenerationRef/);
    expect(messageListSrc).toMatch(/generation !== scrollGenerationRef\.current/);
  });

  test("history mode exposes viewport-anchored New reply control", () => {
    expect(messageListSrc).toMatch(/New reply ↓/);
    expect(messageListSrc).toMatch(/hasUnseenTail/);
    expect(messageListSrc).toMatch(/jumpToNewest/);
    expect(messageListSrc).toMatch(/newReplyOverlay/);
    expect(messageListSrc).not.toMatch(/ListHeaderComponent=\{/);
  });

  test("pin tracks stable tail identity and conversation switches", () => {
    expect(messageListSrc).toMatch(/lastTailKeyRef/);
    expect(messageListSrc).toMatch(/lastUserMessageIdRef/);
    expect(messageListSrc).toMatch(/conversationId/);
    expect(screenSrc).toMatch(/conversationId=\{chat\.conversationId\}/);
    // One pending card = one logical tail (pending lands before the tool row).
    expect(messageListSrc).toMatch(/pending:\$\{pendingId\}/);
  });
});
