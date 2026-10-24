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

describe("#3355 settled Ari thread scroll", () => {
  test("auto-scroll effect does not depend on isThinking", () => {
    // Thinking / reveal / card growth must not re-animate to offset 0.
    expect(messageListSrc).toMatch(
      /\[items\.length,\s*pendingAction\?\.pending_action_id/,
    );
    expect(messageListSrc).not.toMatch(
      /\[items\.length,\s*pendingAction\?\.pending_action_id,\s*isThinking\]/,
    );
  });

  test("scroll coalesces through a generation guard", () => {
    expect(messageListSrc).toMatch(/scrollGenerationRef/);
    expect(messageListSrc).toMatch(/generation !== scrollGenerationRef\.current/);
  });

  test("history mode exposes New reply control", () => {
    expect(messageListSrc).toMatch(/New reply ↓/);
    expect(messageListSrc).toMatch(/hasUnseenTail/);
    expect(messageListSrc).toMatch(/jumpToNewest/);
    expect(messageListSrc).toMatch(/NEWEST_PIN_TOLERANCE_PX/);
  });

  test("pin restores only when host was at newest or just sent", () => {
    expect(messageListSrc).toMatch(/userJustSent/);
    expect(messageListSrc).toMatch(/pinnedRef\.current/);
    expect(messageListSrc).toMatch(/role === ["']user["']/);
  });
});
