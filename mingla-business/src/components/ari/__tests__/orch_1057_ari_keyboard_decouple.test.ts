import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1057 — Ari empty-state keyboard decoupling + dismiss escape hatch.
 *
 * Two operator-reported bugs (verified live on a physical iPhone, 2026-06-02):
 *   1. Opening the keyboard on the empty Ari chat shoved the centered hero
 *      (orb + greeting + hint) upward, because the hero was a flex sibling of
 *      the composer, which grows by the keyboard height.
 *   2. With the multiline composer focused (Return = newline) and the keyboard
 *      covering the bottom nav, there was NO way to dismiss the keyboard — the
 *      user was stuck.
 *
 * These assertions pin the fix's invariants. They read source directly (the
 * codebase's established ORCH-1057 test style) and every asserted token exists
 * ONLY in the fixed code, so the test FAILS if the fix is reverted.
 */

const ARI_SCREEN = path.resolve(__dirname, "../../../screens/ari/AriChatScreen.tsx");
const MESSAGE_LIST = path.resolve(__dirname, "../MessageList.tsx");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("ORCH-1057 — Ari keyboard decouple + dismiss", () => {
  const screen = read(ARI_SCREEN);
  const list = read(MESSAGE_LIST);

  it("hero is rendered inside an absolute overlay (decoupled from the composer flex column)", () => {
    // The overlay style must use absolute fill so the rising composer cannot
    // squeeze the flex column and re-center the orb.
    expect(screen).toMatch(/emptyOverlay:\s*\{[\s\S]*absoluteFillObject/);
    // EmptyState must be wrapped by that overlay, not a bare flex sibling.
    const overlayBlock = screen.slice(screen.indexOf("styles.emptyOverlay"));
    expect(overlayBlock).toContain("<EmptyState />");
  });

  it("a flex spacer docks the composer to the bottom when the hero is an overlay", () => {
    expect(screen).toMatch(/flexSpacer:\s*\{\s*flex:\s*1/);
    expect(screen).toContain("styles.flexSpacer");
  });

  it("tapping the empty hero area dismisses the keyboard (the only escape on a multiline composer)", () => {
    // The overlay is a Pressable wired to Keyboard.dismiss with an a11y label.
    expect(screen).toMatch(/onPress=\{\(\)\s*=>\s*Keyboard\.dismiss\(\)\}/);
    expect(screen).toContain('accessibilityLabel="Dismiss keyboard"');
  });

  it("the message list dismisses the keyboard on drag", () => {
    expect(list).toContain('keyboardDismissMode="on-drag"');
  });

  it("the hero's keyboard-independent bottom clearance does NOT reference keyboardHeight (no jump)", () => {
    // The overlay paddingBottom must be derived from insets + nav clearance
    // only — never keyboardHeight — so the hero stays put when the keyboard opens.
    // Slice forward from the JSX usage of styles.emptyOverlay to capture its
    // inline style block (the style def + paddingBottom expression).
    const usageIdx = screen.indexOf("styles.emptyOverlay,");
    expect(usageIdx).toBeGreaterThan(-1);
    const overlayPad = screen.slice(usageIdx, usageIdx + 300);
    expect(overlayPad).toContain("BOTTOM_NAV_CLEARANCE_PX");
    expect(overlayPad).not.toContain("keyboardHeight");
  });
});
