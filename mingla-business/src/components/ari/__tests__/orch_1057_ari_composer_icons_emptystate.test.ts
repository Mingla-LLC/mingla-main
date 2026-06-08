import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1057 — Ari composer + header icons + empty-state polish.
 * Implementor happy-path regression test.
 *
 * Follows the established mingla-business CI pattern (ts-jest, testEnvironment:
 * node, source-assertion not React render — see metaOrch1002SubDBusinessGlass).
 * The three Ari surfaces are static enough that source structure is the truth:
 *
 *   A. InputBar send button — uses lucide ArrowUp (not the old CSS-triangle),
 *      is disabled when the input is empty (canSend gating), gates the
 *      send-moment micro-interaction behind useReducedMotion(), and honors the
 *      Android opaque-glass policy (no Android shadow under the rounded fill).
 *   B. AriChatScreen header — renders lucide Menu + Settings, NOT the Unicode
 *      glyphs ≡ / ⚙, and the dead `iconText` style is gone.
 *   C. EmptyState — no QuickReplyChips wall, no EXAMPLES, no onChipSelect prop;
 *      renders the single non-tappable hint row (lucide Plus + the caption).
 *
 * fails-on-revert: each assertion targets a string that ONLY exists after the
 * ORCH-1057 fix (lucide imports, the new hint copy, ArrowUp) or that the fix
 * REMOVED (Unicode glyphs, QuickReplyChips in EmptyState, the CSS triangle).
 * Reverting any of the three files flips its assertions red.
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");

const read = (p: string): string => fs.readFileSync(p, "utf8");

const inputBar = read(path.join(ARI_DIR, "InputBar.tsx"));
const emptyState = read(path.join(ARI_DIR, "EmptyState.tsx"));
const chatScreen = read(path.join(SCREEN_DIR, "AriChatScreen.tsx"));

describe("ORCH-1057 · Item A — Ember Send button", () => {
  it("uses the lucide ArrowUp glyph", () => {
    expect(inputBar).toMatch(/import\s*\{\s*ArrowUp\s*\}\s*from\s*["']lucide-react-native["']/);
    // [TEST-MOD-APPROVED ORCH-1101] ORCH-1101 §4.2 deepens the glyph to
    // size 18 / strokeWidth 2.75 (was 20 / 2.5) on the flat ember disc.
    expect(inputBar).toMatch(/<ArrowUp\b[^>]*color=["']#ffffff["'][^>]*strokeWidth=\{2\.75\}/);
  });

  it("removes the old CSS-border triangle send mark", () => {
    expect(inputBar).not.toContain("sendArrow");
    expect(inputBar).not.toContain("borderBottomColor");
  });

  it("is DISABLED when the input is empty (canSend gating)", () => {
    // canSend is false on empty/whitespace input...
    expect(inputBar).toMatch(/const\s+canSend\s*=\s*text\.trim\(\)\.length\s*>\s*0\s*&&\s*!disabled/);
    // ...and that drives both the Pressable disabled prop and a11y state.
    expect(inputBar).toContain("disabled={!canSend}");
    expect(inputBar).toContain("accessibilityState={{ disabled: !canSend }}");
  });

  it("gates the send-moment micro-interaction behind useReducedMotion()", () => {
    expect(inputBar).toContain("useReducedMotion");
    expect(inputBar).toMatch(/const\s+reduceMotion\s*=\s*useReducedMotion\(\)/);
    expect(inputBar).toContain("if (reduceMotion)");
    expect(inputBar).toContain("withSpring");
  });

  it("honors the Android opaque-glass policy (no Android shadow under the rounded fill)", () => {
    // iOS gets the ember glow; the Android branch must NOT carry shadow*/elevation.
    expect(inputBar).toMatch(/Platform\.select/);
    expect(inputBar).toContain("shadowColor: ariPalette.ember");
    const defaultBranch = inputBar.slice(inputBar.indexOf("default: {"));
    expect(defaultBranch).not.toMatch(/shadow(Color|Opacity|Radius|Offset)/);
    expect(defaultBranch).not.toMatch(/elevation/);
  });
});

describe("ORCH-1057 · Item B — header lucide icons", () => {
  it("imports Menu + Settings from lucide-react-native", () => {
    expect(chatScreen).toMatch(/import\s*\{\s*Menu,\s*Settings\s*\}\s*from\s*["']lucide-react-native["']/);
  });

  it("renders Menu (24) and Settings (22) with primary color", () => {
    expect(chatScreen).toMatch(/<Menu\s+size=\{24\}\s+color=\{textTokens\.primary\}\s+strokeWidth=\{2\}\s*\/>/);
    expect(chatScreen).toMatch(/<Settings\s+size=\{22\}\s+color=\{textTokens\.primary\}\s+strokeWidth=\{2\}\s*\/>/);
  });

  it("no longer renders the Unicode glyphs ≡ / ⚙", () => {
    expect(chatScreen).not.toContain("≡");
    expect(chatScreen).not.toContain("⚙");
  });

  it("removes the now-dead iconText style", () => {
    expect(chatScreen).not.toContain("iconText");
  });

  it("preserves the 44×44 tap targets + a11y labels", () => {
    expect(chatScreen).toContain('accessibilityLabel="Show conversations"');
    expect(chatScreen).toContain('accessibilityLabel="Open Ari settings"');
    expect(chatScreen).toMatch(/iconBtn:\s*\{[^}]*width:\s*44[^}]*height:\s*44/s);
  });

  it("mounts EmptyState with no props", () => {
    expect(chatScreen).toContain("<EmptyState />");
    expect(chatScreen).not.toContain("<EmptyState onChipSelect");
  });
});

describe("ORCH-1057 · Item C — empty state chip wall removed", () => {
  it("no longer imports QuickReplyChips", () => {
    expect(emptyState).not.toContain("QuickReplyChips");
  });

  it("drops the EXAMPLES array and the onChipSelect prop", () => {
    expect(emptyState).not.toContain("EXAMPLES");
    expect(emptyState).not.toContain("onChipSelect");
    expect(emptyState).not.toContain("chipsWrap");
  });

  it("keeps the orb + headline + body", () => {
    expect(emptyState).toContain("AriOrb");
    expect(emptyState).toContain("Hi, I&apos;m Ari.");
    expect(emptyState).toContain("manage brands, and answer questions");
  });

  it("renders the single non-tappable hint row (lucide Plus + caption)", () => {
    expect(emptyState).toMatch(/import\s*\{\s*Plus\s*\}\s*from\s*["']lucide-react-native["']/);
    expect(emptyState).toMatch(/<Plus\s+size=\{14\}\s+color=\{textTokens\.tertiary\}\s+strokeWidth=\{2\}\s*\/>/);
    expect(emptyState).toContain("Tap + for things to try");
    // The hint is a pointer, not an action — never a Pressable / button role.
    expect(emptyState).not.toContain("Pressable");
    expect(emptyState).not.toContain('accessibilityRole="button"');
  });
});

describe("ORCH-1057 · hard guard — suggestionsPanel untouched", () => {
  it("keeps the +-triggered QuickReplyChips suggestions panel in AriChatScreen", () => {
    expect(chatScreen).toContain("QuickReplyChips");
    expect(chatScreen).toContain("suggestionsOpen");
  });
});
