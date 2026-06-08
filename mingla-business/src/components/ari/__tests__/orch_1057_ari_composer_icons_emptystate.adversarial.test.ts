import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1057 — Ari composer + header icons + empty-state polish.
 * TESTER adversarial regression test.
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path test
 * (orch_1057_ari_composer_icons_emptystate.test.ts). Where the implementor
 * asserts "the new thing is present", this test attacks the INVARIANTS and
 * BOUNDARY/NEGATIVE cases that a future careless edit could silently violate
 * while still passing the happy-path test:
 *
 *   ADV-1  Wrong-package guard: must NEVER import `lucide-react` (the WEB-only
 *          package, not a dependency). The happy-path test only checks the
 *          correct `lucide-react-native` import is present — it would still
 *          pass if someone ALSO added a stray `lucide-react` import.
 *   ADV-2  iOS shadow branch must NOT smuggle `elevation` (Android-only) —
 *          the happy-path test only inspects the `default:` (Android) branch.
 *          An elevation in the iOS branch would still draw a rectangle on any
 *          RN web/Android shim that honors it, violating the opaque-glass
 *          policy from the OTHER branch.
 *   ADV-3  Opaque-fill invariant: the SVG radial stops must be fully opaque
 *          (stopOpacity 1), and NO translucent rgba/hsla fill may be
 *          introduced on the send circle — the Android opaque-glass policy is
 *          about the FILL being opaque, which the happy-path test never checks.
 *   ADV-4  Press-feedback gating boundary: the manual `btnPressed` opacity dim
 *          must only apply when `canSend` is true (no dead-tap visual feedback
 *          on a disabled send). The happy-path test checks `disabled={!canSend}`
 *          but never that the pressed style is canSend-gated.
 *   ADV-5  Reduced-motion correctness boundary: the iOS glow-pulse
 *          (glowOpacity withSequence) must live ONLY inside the non-reduced
 *          branch — a reduced-motion user must get NO glow animation. The
 *          happy-path test only checks `if (reduceMotion)` + `withSpring`
 *          exist, not that the glow is excluded from the reduced path.
 *   ADV-6  Hierarchy/contrast invariant on the hint: the empty-state hint glyph
 *          + text must use the LOW-emphasis `tertiary` token, never `primary`
 *          or `secondary` (the hint must not compete with the orb/headline).
 *   ADV-7  suggestionsPanel byte-stability: the 3 example strings must be
 *          EXACTLY the originals — the happy-path test only checks the
 *          QuickReplyChips component is still referenced, not that its content
 *          is unchanged. A reworded example would pass happy-path but breaks
 *          the "do not touch the suggestions panel" hard guard.
 *   ADV-8  Send-glyph direction invariant: the send mark must be ArrowUp
 *          (vertical-chat correct), never a paper-plane `Send` / `SendHorizontal`
 *          left over from a copy-paste of an alternate spec direction.
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");

const read = (p: string): string => fs.readFileSync(p, "utf8");

const inputBar = read(path.join(ARI_DIR, "InputBar.tsx"));
const emptyState = read(path.join(ARI_DIR, "EmptyState.tsx"));
const chatScreen = read(path.join(SCREEN_DIR, "AriChatScreen.tsx"));

describe("ORCH-1057 adversarial · Item A — Ember Send invariants", () => {
  it("ADV-1 never imports the WEB-only `lucide-react` package", () => {
    // The native package is lucide-react-native. `lucide-react` is NOT a dep.
    // A bare `from "lucide-react"` (no `-native`) would crash on device.
    expect(inputBar).not.toMatch(/from\s*["']lucide-react["']/);
  });

  it("ADV-2 keeps `elevation` out of BOTH platform branches (opaque-glass policy)", () => {
    // The whole file must not introduce Android elevation under the rounded
    // send fill — not in the iOS branch, not in the default branch, nowhere.
    expect(inputBar).not.toMatch(/elevation\s*:/);
  });

  it("ADV-3 the send fill is a flat OPAQUE disc (no SVG gradient, no translucent fill)", () => {
    // [TEST-MOD-APPROVED ORCH-1101] ORCH-1101 §4.2 deletes the SVG
    // radial-gradient circle (the desktop-web "blob" defect) and replaces it
    // with a flat opaque ember disc. The opaque-fill INVARIANT is preserved,
    // just expressed as a flat backgroundColor instead of opaque SVG stops.
    // No SVG composition may return.
    expect(inputBar).not.toMatch(/stopOpacity=/);
    expect(inputBar).not.toMatch(/<RadialGradient\b/);
    expect(inputBar).not.toMatch(/<Circle\b/);
    expect(inputBar).not.toMatch(/from\s*["']react-native-svg["']/);
    // The send disc fill must be the opaque token (a hex), never a translucent
    // rgba/hsla — the Android opaque-glass policy is about the FILL being opaque.
    const sendBtnBlock = inputBar.slice(
      inputBar.indexOf("sendBtn:"),
      inputBar.indexOf("suggestBtn:"),
    );
    expect(sendBtnBlock).toMatch(/backgroundColor:\s*ariPalette\.userBubble/);
    expect(sendBtnBlock).not.toMatch(/backgroundColor:\s*["']?(rgba|hsla)/);
  });

  it("ADV-4 manual pressed-dim only fires when canSend is true (no dead-tap feedback)", () => {
    // btnPressed must be canSend-gated in the send Pressable style callback.
    expect(inputBar).toMatch(/pressed\s*&&\s*canSend[^\n]*btnPressed/);
    // It must NOT be applied unconditionally / on the disabled path.
    expect(inputBar).not.toMatch(/!canSend\s*&&\s*styles\.btnPressed/);
  });

  it("ADV-5 the iOS glow pulse lives ONLY in the non-reduced-motion branch", () => {
    // Split the file at the reduced-motion guard. The glowOpacity withSequence
    // animation must appear AFTER the `else` (non-reduced) path, never before.
    const elseIdx = inputBar.indexOf("} else {");
    expect(elseIdx).toBeGreaterThan(-1);
    const reducedBranch = inputBar.slice(
      inputBar.indexOf("if (reduceMotion)"),
      elseIdx,
    );
    // No glow animation inside the reduced-motion branch.
    expect(reducedBranch).not.toContain("glowOpacity.value = withSequence");
    // The glow pulse DOES exist in the file (non-reduced path).
    expect(inputBar).toContain("glowOpacity.value = withSequence");
  });

  it("ADV-8 the send glyph is ArrowUp, never a paper-plane Send/SendHorizontal", () => {
    expect(inputBar).not.toMatch(/\bSendHorizontal\b/);
    expect(inputBar).not.toMatch(/import\s*\{[^}]*\bSend\b[^}]*\}\s*from\s*["']lucide-react-native["']/);
    expect(inputBar).toContain("ArrowUp");
  });
});

describe("ORCH-1057 adversarial · Item C — empty-state hierarchy invariant", () => {
  it("ADV-6 the hint uses the low-emphasis tertiary token, not primary/secondary", () => {
    // The hint glyph color must be tertiary.
    expect(emptyState).toMatch(/<Plus[^>]*color=\{textTokens\.tertiary\}/);
    // The hint TEXT style must resolve to tertiary, not primary/secondary.
    const hintTextBlock = emptyState.slice(emptyState.indexOf("hintText:"));
    expect(hintTextBlock).toMatch(/color:\s*textTokens\.tertiary/);
    expect(hintTextBlock).not.toMatch(/color:\s*textTokens\.(primary|secondary)/);
    // The hint must NOT be re-promoted to a real button affordance.
    expect(emptyState).not.toContain("onPress");
  });
});

describe("ORCH-1057 adversarial · hard guard — suggestions content byte-stable", () => {
  it("ADV-7 keeps the 3 example prompt strings EXACTLY as the originals", () => {
    expect(chatScreen).toContain("Create a brand called Sample Events");
    expect(chatScreen).toContain("What events do I have this week?");
    expect(chatScreen).toContain("Help me schedule a Friday event");
  });

  it("ADV-7b no screen-shift fix was smuggled in (sheet/keyboard logic untouched)", () => {
    // The investigation's screen-shift NREP was explicitly OUT of scope. Guard
    // that no keyboard-padding constant or Sheet wrapper was newly introduced.
    expect(chatScreen).toContain("BOTTOM_NAV_CLEARANCE_PX");
    expect(chatScreen).toContain("keyboardHeight");
    // ConversationDrawer mount kept (not swapped for a Sheet/SheetMobile).
    expect(chatScreen).toContain("<ConversationDrawer");
  });
});
