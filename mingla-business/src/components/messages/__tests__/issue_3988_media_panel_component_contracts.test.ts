import fs from "node:fs";
import path from "node:path";

const componentDir = path.resolve(__dirname, "..");
const panel = fs.readFileSync(path.join(componentDir, "BrandGroupMediaPanel.tsx"), "utf8");
const chat = fs.readFileSync(path.resolve(componentDir, "../../../app/messages/[conversationId].tsx"), "utf8");
const mediaRoute = fs.readFileSync(path.resolve(componentDir, "../../../app/messages/media/[conversationId].tsx"), "utf8");

describe("#3988 media panel and chat component matrix", () => {
  it("renders media and file tabs with keyset paging and pull-to-refresh", () => {
    expect(panel).toContain("SectionList");
    expect(panel).toContain("FlatList");
    expect(panel).toContain("fetchNextPage");
    expect(panel).toContain("onEndReached={loadMore}");
    expect(panel).toContain("RefreshControl");
    expect(panel).toMatch(/tabs:\s*\{ minHeight: 44/);
  });

  it("renders media bubbles and carries show-in-chat focus across routes", () => {
    expect(chat).toContain("<BrandGroupMediaBubble item={mediaItem}");
    expect(chat).toContain("requestedFocusMessageId");
    expect(chat).toContain("onShowInChat={(messageId) => void showInChat(messageId)}");
    expect(mediaRoute).toContain("focusMessageId: messageId");
    expect(mediaRoute).toContain("router.replace");
  });

  it("opens the gallery and viewer through 44pt-or-larger controls", () => {
    expect(chat).toMatch(/mediaButton:\s*\{ minHeight: 44/);
    expect(panel).toMatch(/iconButton:\s*\{ width: 44, height: 44/);
    expect(panel).toMatch(/retry:\s*\{ minHeight: 44/);
    expect(panel).toContain("setViewerFileId(item.fileId)");
  });
});
