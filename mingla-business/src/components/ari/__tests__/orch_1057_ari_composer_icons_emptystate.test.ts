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
const messageList = read(path.join(ARI_DIR, "MessageList.tsx"));

describe("ORCH-1057 · Item A — Ember Send button", () => {
  it("uses the lucide ArrowUp glyph", () => {
    expect(inputBar).toMatch(/import\s*\{\s*ArrowUp\s*\}\s*from\s*["']lucide-react-native["']/);
    // [TEST-MOD-APPROVED #3429] (a) superseded by the approved #3429 design:
    // the glyph is now size 20 on a 44pt accessible control and is DARK on the
    // warm disc (ariThread.onUserBubble === canvas.depth), which is the
    // contrast direction #3429 approved. strokeWidth 2.75 is unchanged, and the
    // token itself is pinned by issue_3429_ari_chat_polish.implementor.test.ts
    // ("onUserBubble: canvas.depth").
    expect(inputBar).toMatch(/<ArrowUp\s+size=\{20\}\s+color=\{canvas\.depth\}\s+strokeWidth=\{2\.75\}\s*\/>/);
  });

  it("removes the old CSS-border triangle send mark", () => {
    expect(inputBar).not.toContain("sendArrow");
    expect(inputBar).not.toContain("borderBottomColor");
  });

  it("is DISABLED when the input is empty (canSend gating)", () => {
    // [TEST-MOD-APPROVED #3429] (a) superseded: #3429 lets an attachment with
    // no typed text be sent, so the predicate moved into the shared, unit-tested
    // isAriSendReady(text, hasReadyAttachments, disabled, sendDisabled). Empty
    // text with no ready attachment is still false — proven behaviourally by
    // issue_3429_ari_delivery_state.implementor.test.ts, and the exact call
    // shape is pinned by issue_3429_ari_turn_scope.tester.adversarial.test.tsx.
    expect(inputBar).toMatch(/const\s+canSend\s*=\s*isAriSendReady\(text,\s*hasReadyAttachments,\s*disabled,\s*sendDisabled\)/);
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
    // [TEST-MOD-APPROVED ORCH-1101] ORCH-1101 REWORK Bug #5 superseded the literal
    // "+"-in-text copy: the hint now renders the ACTUAL + button glyph as an
    // inline chip ("Tap [＋] for things to try") so it points at the real button
    // rather than printing a plain "+". The 1057 intent — a single, non-tappable,
    // Plus-bearing hint row — is preserved; only the glyph framing + split copy
    // changed. Operator-directed scope expansion for ORCH-1101.
    expect(emptyState).toMatch(/import\s*\{\s*Plus\s*\}\s*from\s*["']lucide-react-native["']/);
    expect(emptyState).toMatch(/<Plus\s+size=\{13\}/);
    // [TEST-MOD-APPROVED #3429] (a) superseded: the composer "+" now opens
    // "Add context", so the first-run hint points at the attach affordance.
    expect(emptyState).toContain("Tap ");
    // [TEST-MOD-APPROVED #3429] REWORK-2 R-3: anchored to the SHIPPED element.
    // As a bare substring this matched the source comment and the
    // accessibilityLabel as readily as the rendered copy, so changing the
    // visible sentence left it green. Still the same protection — the first-run
    // hint copy cannot drift — now expressed against the thing users read.
    expect(emptyState).toContain(
      '<Text style={styles.hintText}> to attach context</Text>',
    );
    // The hint chip is presentational, not an action — never a Pressable / button role.
    expect(emptyState).not.toContain("Pressable");
    expect(emptyState).not.toContain('accessibilityRole="button"');
  });
});

describe("ORCH-1057 · hard guard — quick replies survive the + repurposing", () => {
  // [TEST-MOD-APPROVED #3429] (a) superseded: #3429 gives the composer "+" to
  // attachments ("Add context"), so the screen-level suggestions panel is gone.
  // The protection — a user always has contextual quick replies to tap — moved
  // to MessageList, where issue_3429_ari_chat_polish.implementor.test.ts pins
  // "<QuickReplyChips". This guard now pins BOTH halves of the trade: the chips
  // still exist next to the thread, and the "+" has a real entry point.
  it("keeps contextual QuickReplyChips in MessageList and gives + the attach sheet", () => {
    expect(messageList).toContain("<QuickReplyChips");
    expect(chatScreen).toContain("<AriAttachmentSourceSheet");
    expect(inputBar).toContain('accessibilityLabel="Attach images or documents"');
  });
});
