/**
 * #4420 — Ari's past conversations: wide desktop keeps them in a side pane
 * beside the chat (mockup ari-chat__conversation-drawer); phone and narrow
 * web keep the sheet. Every drawer action (new, open, select, rename,
 * regenerate, delete) lives in the one shared body, so both get them.
 *
 * FAILS-ON-REVERT: dropping the pane presentation, or the screen mounting it
 * outside wide desktop, fails this suite.
 */
import fs from "fs";
import path from "path";

const drawer = fs.readFileSync(path.resolve(__dirname, "../ConversationDrawer.tsx"), "utf8");
const screen = fs.readFileSync(path.resolve(__dirname, "../../../screens/ari/AriChatScreen.tsx"), "utf8");

describe("#4420 Ari history pane", () => {
  test("the drawer renders one body as a sheet or as a pane", () => {
    expect(drawer).toMatch(/presentation\?: "sheet" \| "pane"/);
    expect(drawer).toMatch(/if \(asPane\) \{[\s\S]*testID="ari-conversation-pane"[\s\S]*\{body\}/);
    expect(drawer).toMatch(/<Sheet visible=\{visible\}[^>]*>\s*\{body\}\s*<\/Sheet>/);
    // Opening a chat keeps the pane open; the sheet still closes.
    expect(drawer).toContain("if (!asPane) onClose();");
    for (const action of ["Rename conversation", "Regenerate title", "New conversation", "Select"]) {
      expect(drawer).toContain(action);
    }
  });

  test("the screen shows the pane on wide desktop only and keeps the sheet elsewhere", () => {
    expect(screen).toMatch(/const historyPane = isWideDesktop && !setup && !embedded && !websiteSplit;/);
    expect(screen).toMatch(/\{historyPane \? \(\s*<ConversationDrawer\s+presentation="pane"/);
    expect(screen).toContain("visible={drawerOpen && brandScopeStable && !historyPane}");
    // The Chats button is hidden only when the pane is showing.
    expect(screen).toMatch(/\{historyPane \? null : \(\s*<Pressable[\s\S]{0,200}setDrawerOpen\(true\)/);
  });
});
