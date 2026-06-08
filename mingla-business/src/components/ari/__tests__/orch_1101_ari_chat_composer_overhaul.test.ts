import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1101 — Ari chat interface + composer overhaul.
 * Implementor happy-path regression test.
 *
 * Follows the established mingla-business CI pattern (ts-jest, testEnvironment:
 * node, source-assertion not React render — same as orch_1057_ari_*). The Ari
 * composer + token surfaces are static enough that source structure is the
 * truth. This locks the two desktop-web defect fixes + the new tokens + the
 * presentational response components.
 *
 *   Bug B (send "blob"): the InputBar send button must carry NO react-native-svg
 *      gradient composition (the cause of the web blob) — no <Svg>, <Defs>,
 *      <RadialGradient>, <Circle>, no `react-native-svg` import — and must be a
 *      flat ember disc (ariPalette.userBubble) with a single lucide ArrowUp.
 *   Bug A (web bottom gap): the input is explicitly one line tall (lineHeight
 *      19 / minHeight 30 / paddingVertical 6) with web-only rows={1} +
 *      resize:'none', host minHeight 48; AriChatScreen's inputWrap
 *      paddingBottom is platform-aware (web → spacing.sm, no phantom 80px).
 *   Tokens: ariPalette.userBubble + the ariThread density block exist.
 *
 * fails-on-revert: each assertion targets a string that ONLY exists after the
 * ORCH-1101 fix (ariPalette.userBubble fill, ariThread tokens, rows={1}, the
 * web paddingBottom branch) or that the fix REMOVED (the SVG gradient block,
 * the react-native-svg import, the 52 host minHeight, the 80px-always
 * paddingBottom). Reverting any touched file flips its assertions red.
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");
const CONSTANTS_DIR = path.resolve(__dirname, "../../../constants");

const read = (p: string): string => fs.readFileSync(p, "utf8");

const inputBar = read(path.join(ARI_DIR, "InputBar.tsx"));
const chatScreen = read(path.join(SCREEN_DIR, "AriChatScreen.tsx"));
const designSystem = read(path.join(CONSTANTS_DIR, "designSystem.ts"));

describe("ORCH-1101 · Bug B — send button is a flat ember disc, no SVG blob", () => {
  it("has DELETED the react-native-svg gradient composition", () => {
    // The whole SVG-gradient-circle-behind-glyph composition is gone.
    expect(inputBar).not.toMatch(/from\s*["']react-native-svg["']/);
    expect(inputBar).not.toMatch(/<Svg\b/);
    expect(inputBar).not.toMatch(/<Defs\b/);
    expect(inputBar).not.toMatch(/<RadialGradient\b/);
    expect(inputBar).not.toMatch(/<Circle\b/);
    expect(inputBar).not.toMatch(/url\(#ari-send-fill\)/);
    expect(inputBar).not.toContain("sendFill");
  });

  it("renders a flat ember disc fill (ariPalette.userBubble) on the send button", () => {
    const sendBtnBlock = inputBar.slice(
      inputBar.indexOf("sendBtn:"),
      inputBar.indexOf("suggestBtn:"),
    );
    expect(sendBtnBlock).toMatch(/backgroundColor:\s*ariPalette\.userBubble/);
    // Opaque fill — never a translucent rgba/hsla (Android opaque-glass policy).
    expect(sendBtnBlock).not.toMatch(/backgroundColor:\s*["']?(rgba|hsla)/);
  });

  it("renders exactly one lucide ArrowUp (18 / 2.75 / white) as the glyph", () => {
    expect(inputBar).toMatch(/import\s*\{\s*ArrowUp\s*\}\s*from\s*["']lucide-react-native["']/);
    expect(inputBar).toMatch(/<ArrowUp\s+size=\{18\}\s+color=["']#ffffff["']\s+strokeWidth=\{2\.75\}\s*\/>/);
  });

  it("keeps the Animated.View + iOS ember shadow-glow + reduced-motion gate", () => {
    expect(inputBar).toContain("Animated.View");
    expect(inputBar).toContain("shadowColor: ariPalette.ember");
    expect(inputBar).toMatch(/const\s+reduceMotion\s*=\s*useReducedMotion\(\)/);
    expect(inputBar).toContain("withSpring");
    // Android branch carries NO shadow/elevation (opaque-glass policy).
    const defaultBranch = inputBar.slice(inputBar.indexOf("default: {"));
    expect(defaultBranch).not.toMatch(/shadow(Color|Opacity|Radius|Offset)/);
    expect(defaultBranch).not.toMatch(/elevation/);
  });

  it("sizes the send disc to 34 and the + to 30 (paired with the tighter composer)", () => {
    expect(inputBar).toMatch(/width:\s*ariThread\.sendSize/);
    const suggestBlock = inputBar.slice(inputBar.indexOf("suggestBtn:"));
    expect(suggestBlock).toMatch(/width:\s*30/);
  });
});

describe("ORCH-1101 · Bug A — composer is one line tall on web (no bottom gap)", () => {
  it("sizes the input to one line (lineHeight 19 / minHeight 30 / paddingVertical 6)", () => {
    const inputBlock = inputBar.slice(
      inputBar.indexOf("input: {"),
      inputBar.indexOf("sendBtn:"),
    );
    expect(inputBlock).toMatch(/lineHeight:\s*ariThread\.bodyLine/);
    expect(inputBlock).toMatch(/minHeight:\s*ariThread\.inputMinH/);
    expect(inputBlock).toMatch(/paddingVertical:\s*ariThread\.inputPadV/);
    expect(inputBlock).toMatch(/fontSize:\s*ariThread\.bodyFont/);
  });

  it("caps the host minHeight at 48 (was 52) and tightens web paddingVertical to 6", () => {
    const hostBlock = inputBar.slice(
      inputBar.indexOf("host: {"),
      inputBar.indexOf("input: {"),
    );
    expect(hostBlock).toMatch(/minHeight:\s*ariThread\.composerMinH/);
    expect(hostBlock).not.toMatch(/minHeight:\s*52/);
    expect(hostBlock).toMatch(/Platform\.OS === "web" \? 6/);
  });

  it("passes web-only rows={1} + resize:'none' + height:'auto' to the textarea", () => {
    expect(inputBar).toMatch(/rows:\s*1/);
    expect(inputBar).toContain('resize: "none"');
    expect(inputBar).toContain('height: "auto"');
    expect(inputBar).toContain('overflowY: "auto"');
    // Web-gated, not applied on native.
    expect(inputBar).toMatch(/Platform\.OS === ["']web["']/);
  });

  it("makes AriChatScreen inputWrap.paddingBottom platform-aware (web → spacing.sm, no phantom 80px)", () => {
    // The web branch must short-circuit to spacing.sm BEFORE the keyboard/nav math.
    expect(chatScreen).toMatch(
      /paddingBottom:\s*[\s\S]*?Platform\.OS === ["']web["']\s*\?\s*spacing\.sm/,
    );
    // The phantom-80px clearance is still present for native, gated behind the
    // non-web keyboard branch (BOTTOM_NAV_CLEARANCE_PX kept for native).
    expect(chatScreen).toContain("BOTTOM_NAV_CLEARANCE_PX");
  });
});

describe("ORCH-1101 · density tokens exist", () => {
  it("ariPalette.userBubble uses the Mingla brand token accent.warm (#eb7825) [TEST-MOD-APPROVED ORCH-1101]", () => {
    // Operator brand-consistency decision 2026-06-08: the Ari thread accent
    // (send button + user bubble + Confirm + §5 cards) references the dev
    // style-guide brand action color accent.warm, not an Ari-only ember.
    expect(designSystem).toMatch(/userBubble:\s*accent\.warm/);
    expect(designSystem).toMatch(/warm:\s*["']#eb7825["']/);
  });

  it("adds the ariThread density token block with the load-bearing values", () => {
    expect(designSystem).toMatch(/export const ariThread\s*=/);
    expect(designSystem).toMatch(/composerMinH:\s*48/);
    expect(designSystem).toMatch(/inputMinH:\s*30/);
    expect(designSystem).toMatch(/inputPadV:\s*6/);
    expect(designSystem).toMatch(/sendSize:\s*34/);
    expect(designSystem).toMatch(/bodyFont:\s*14/);
    expect(designSystem).toMatch(/bodyLine:\s*19/);
    expect(designSystem).toMatch(/gapTurn:\s*10/);
    expect(designSystem).toMatch(/gapGroup:\s*4/);
  });
});

describe("ORCH-1101 · four presentational response components exist", () => {
  const has = (name: string): boolean =>
    fs.existsSync(path.join(ARI_DIR, name));

  it("ships ClarifyingCard / MultiSelectPrompt / ResponseCard as new files", () => {
    expect(has("ClarifyingCard.tsx")).toBe(true);
    expect(has("MultiSelectPrompt.tsx")).toBe(true);
    expect(has("ResponseCard.tsx")).toBe(true);
  });

  it("QuickReplyChips gained the §5.1 single-select CHOICE mode (presentational)", () => {
    const chips = read(path.join(ARI_DIR, "QuickReplyChips.tsx"));
    expect(chips).toMatch(/options\?:/);
    expect(chips).toMatch(/onSelectId\?:/);
    expect(chips).toContain("ariPalette.userBubble");
    // Legacy suggestions-panel API preserved (chips/onSelect still optional props).
    expect(chips).toMatch(/chips\?:/);
    expect(chips).toMatch(/onSelect\?:/);
  });

  it("each response card primary action uses the legible ember (no white-on-flame)", () => {
    const clar = read(path.join(ARI_DIR, "ClarifyingCard.tsx"));
    const multi = read(path.join(ARI_DIR, "MultiSelectPrompt.tsx"));
    const resp = read(path.join(ARI_DIR, "ResponseCard.tsx"));
    expect(clar).toContain("ariPalette.userBubble");
    expect(multi).toContain("ariPalette.userBubble");
    expect(resp).toContain("ariPalette.userBubble");
    // None reintroduce the failing flame fill on a primary button.
    expect(clar).not.toMatch(/primaryBtn[\s\S]{0,120}ariPalette\.flame/);
    expect(multi).not.toMatch(/confirmBtn[\s\S]{0,120}ariPalette\.flame/);
  });
});
