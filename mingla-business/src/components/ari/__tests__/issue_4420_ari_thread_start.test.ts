/**
 * #4420 (Seth's screenshot): opening an Ari thread showed the orb jammed at
 * x=0 beside an empty grey pill holding a lone caret, and the conversations
 * sheet ran off a 390 phone browser. Guards for each root cause.
 */
import fs from "fs";
import path from "path";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("#4420 Ari thread start", () => {
  const screen = read("../../../screens/ari/AriChatScreen.tsx");
  const streaming = read("../StreamingText.tsx");

  test("restoring the thread selection shows the thread loading state, not a bare bubble", () => {
    expect(screen).toMatch(
      // [TEST-MOD-APPROVED #4420] device round 2: the same opening condition
      // now also carries the timeout / error state.
      /!conversationSelectionReady \|\| Boolean\(chat\.conversationId && chat\.isLoadingMessages\)[\s\S]*\{threadOpening \? \(\s*<AriThreadLoadingState/,
    );
    expect(screen).not.toContain("<StreamingText");
  });

  test("the thinking bubble holds dots, not a lone caret, inside the screen gutter", () => {
    expect(streaming).toContain('testID="ari-thinking-dots"');
    expect(streaming).not.toContain("styles.cursor");
    const row = streaming.slice(streaming.indexOf("  row: {"), streaming.indexOf("},", streaming.indexOf("  row: {")));
    expect(row).toContain("paddingHorizontal: space[4]");
  });

  test("the web conversations sheet never outgrows the viewport", () => {
    expect(read("../ConversationDrawer.tsx")).toContain(
      'webSheet: { width: 440, maxWidth: "100%", maxHeight: "80%" }',
    );
  });
});
