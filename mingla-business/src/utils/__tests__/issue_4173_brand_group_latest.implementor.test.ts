import fs from "node:fs";
import path from "node:path";

import {
  BRAND_GROUP_LATEST_MESSAGE_THRESHOLD,
  isNearLatestBrandGroupMessage,
} from "../brandGroupScroll";

const ROOT = path.resolve(__dirname, "../../..");

describe("#4173 Brand group latest-message behavior", () => {
  test("treats the visible tail and short conversations as latest", () => {
    expect(isNearLatestBrandGroupMessage({ contentHeight: 600, viewportHeight: 700, offsetY: 0 })).toBe(true);
    expect(isNearLatestBrandGroupMessage({ contentHeight: 1200, viewportHeight: 600, offsetY: 600 })).toBe(true);
    expect(isNearLatestBrandGroupMessage({
      contentHeight: 1200,
      viewportHeight: 600,
      offsetY: 600 - BRAND_GROUP_LATEST_MESSAGE_THRESHOLD,
    })).toBe(true);
  });

  test("does not yank a host back to latest while they read older messages", () => {
    expect(isNearLatestBrandGroupMessage({
      contentHeight: 1200,
      viewportHeight: 600,
      offsetY: 600 - BRAND_GROUP_LATEST_MESSAGE_THRESHOLD - 1,
    })).toBe(false);
  });

  test("route snaps first-open and followed updates, but focused history opts out", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/messages/[conversationId].tsx"), "utf8");
    expect(route).toContain("onContentSizeChange={followLatestMessage}");
    expect(route).toContain("onScroll={updateLatestMessageProximity}");
    expect(route).toContain("scrollRef.current?.scrollToEnd");
    expect(route).toContain("autoFollowLatest.current = true;");
    expect(route).toContain("autoFollowLatest.current = false;");
  });
});
