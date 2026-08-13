// #2013 append-only shared Business iOS/Android/web UI contract.
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../../../..");
const screen = fs.readFileSync(path.join(root, "src/screens/ari/AriChatScreen.tsx"), "utf8");
const drawer = fs.readFileSync(path.join(root, "src/components/ari/ConversationDrawer.tsx"), "utf8");
const hook = fs.readFileSync(path.join(root, "src/hooks/useAgentChat.ts"), "utf8");

describe("#2013 Ari tenant-containment UI", () => {
  test("maps every persistent typed recovery to binding copy and canonical actions", () => {
    for (const copy of [
      "Choose a brand to chat with Ari", "Ari keeps each conversation tied to one brand.",
      "You no longer have access to this brand", "This chat belongs to another brand",
      "Ari will not move a conversation between brands.", "This older chat is read-only",
      "It was not saved to a brand, so Ari cannot safely continue it.",
      "Ari cannot verify your brand right now", "Nothing was sent. Try again in a moment.",
      "Your session expired", "Sign in again to keep chatting with Ari.",
    ]) expect(screen).toContain(copy);
    expect(screen).toContain("<BrandSwitcherSheet");
  });

  test("legacy and typed recovery replace rather than disable the composer", () => {
    expect(screen).toMatch(/\{recovery \? <RecoveryPanel[\s\S]*: \(\s*<InputBar/);
    expect(screen).toContain('accessibilityRole="alert"');
    expect(screen).toContain("ariThread.ariBubbleAndroid");
  });

  test("brand switch is atomic and stale responses cannot enter the new scope", () => {
    for (const token of ["setDrawerOpen(false)", "setSuggestionsOpen(false)", "Keyboard.dismiss()", "brandEpoch", "stateBrandId === brandId"]) {
      expect(screen + hook).toContain(token);
    }
  });

  test("drawer separates selected-brand and legacy history and fails closed", () => {
    for (const copy of ["chats</Text>", "Older chats · Read-only", "Could not load conversations.", "Try again", "loadingRow"]) {
      expect(drawer).toContain(copy);
    }
    expect(drawer).toContain("older read-only conversation");
    expect(drawer).toContain("<Lock size={16}");
  });
});
