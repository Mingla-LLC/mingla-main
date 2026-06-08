import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1101 — Ari chat interface + composer overhaul.
 * TESTER ADVERSARIAL regression test.
 *
 * Different angle than the implementor's happy-path test
 * (orch_1101_ari_chat_composer_overhaul.test.ts), which asserts string
 * presence/absence on a fixed enumerated list of SVG tags and token names.
 * That test passes the moment the named strings are gone — it does NOT defend
 * against:
 *
 *   ADV-1  a NEW kind of two-layer composition (a `<Path>`, `<G>`,
 *          `<LinearGradient>`, `<Image>`, `<ImageBackground>`, or a second
 *          sibling View behind the glyph) being added back to the send button
 *          — the implementor's list only forbids <Svg>/<Defs>/<RadialGradient>/
 *          <Circle>. The blob is a *composition* defect, not a tag-name defect.
 *   ADV-2  the send disc carrying MORE THAN ONE JSX child (the blob root cause
 *          was a glyph + a sibling fill node). The invariant is "exactly one
 *          child element". Boundary attack on child count.
 *   ADV-3  the AriChatScreen web paddingBottom branch being REORDERED after the
 *          native keyboard/nav math so web can still fall through to the
 *          phantom 80px. Ordering attack — string presence alone can't catch a
 *          mis-ordered ternary.
 *   ADV-4  the composer height growing UNBOUNDED on a long multiline value
 *          (no maxHeight cap → a pasted paragraph reopens the dead space on
 *          web). Long-multiline height invariant.
 *   ADV-5  ANY send/primary fill regressing to a translucent rgba/hsla/opacity
 *          (Android opaque-glass policy — broader than the one block the
 *          happy-path test checks).
 *   ADV-6  the contrast of the deep-ember fill silently dropping below WCAG AA
 *          4.5:1 against white if someone "tweaks" the hsl lightness. Computed
 *          luminance attack — not a string match.
 *   ADV-7  the SVG composition leaking back into ANY sibling ari surface that
 *          composes a flat fill (regression-by-copy-paste guard).
 *
 * Harness: the mingla-business jest config is ts-jest / testEnvironment:node /
 * source-assertion (no RN render preset, no jsdom). Same constraint the
 * implementor worked under. These assertions therefore attack the SOURCE
 * STRUCTURE and COMPUTED VALUES, not rendered DOM. The web-DOM render proof
 * (react-native-web + react-dom/server emitting a flat round <div> with
 * rgba(168,90,68,1.00) + overflow:hidden and a <textarea rows="1">, NO <svg>)
 * is captured in the QA report TEST_ORCH-1101 §Web leg — proven there, not
 * re-run here (jsdom/@types absent from this harness).
 */

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN_DIR = path.resolve(__dirname, "../../../screens/ari");
const CONSTANTS_DIR = path.resolve(__dirname, "../../../constants");

const read = (p: string): string => fs.readFileSync(p, "utf8");

const inputBar = read(path.join(ARI_DIR, "InputBar.tsx"));
const chatScreen = read(path.join(SCREEN_DIR, "AriChatScreen.tsx"));
const designSystem = read(path.join(CONSTANTS_DIR, "designSystem.ts"));

/** Strip block + line comments so structural assertions ignore the docblock
 *  that legitimately *mentions* the deleted SVG terms in prose. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const inputBarCode = stripComments(inputBar);

/** Extract the JSX of the send button: from the Pressable that carries the
 *  "Send message to Ari" a11y label through its closing </Pressable>. */
const extractSendPressable = (code: string): string => {
  const anchor = code.indexOf('"Send message to Ari"');
  expect(anchor).toBeGreaterThan(-1);
  // Walk back to the enclosing <Pressable, forward to the matching close.
  const open = code.lastIndexOf("<Pressable", anchor);
  const close = code.indexOf("</Pressable>", anchor);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return code.slice(open, close + "</Pressable>".length);
};

describe("ORCH-1101 ADV-1 · send button carries NO two-layer composition (any kind)", () => {
  const sendJsx = extractSendPressable(inputBarCode);

  it("contains no SVG-family node, gradient, image, or background-image", () => {
    // Superset of the happy-path list + the tags it omits.
    const forbidden = [
      /<Svg\b/,
      /<Defs\b/,
      /<RadialGradient\b/,
      /<LinearGradient\b/,
      /<Circle\b/,
      /<Ellipse\b/,
      /<Rect\b/,
      /<Path\b/,
      /<G\b/,
      /<Stop\b/,
      /<Image\b/,
      /<ImageBackground\b/,
      /backgroundImage/i,
      /url\(#/,
    ];
    for (const re of forbidden) {
      expect(sendJsx).not.toMatch(re);
    }
  });

  it("imports no react-native-svg primitive into the module (code, not comments)", () => {
    expect(inputBarCode).not.toMatch(/from\s*["']react-native-svg["']/);
    expect(inputBarCode).not.toMatch(/require\(\s*["']react-native-svg["']\s*\)/);
  });
});

describe("ORCH-1101 ADV-2 · send disc has EXACTLY ONE JSX child (boundary)", () => {
  const sendJsx = extractSendPressable(inputBarCode);

  it("the Animated.View wrapping the glyph contains exactly one JSX element child", () => {
    // Grab the Animated.View body.
    const open = sendJsx.indexOf("<Animated.View");
    const bodyStart = sendJsx.indexOf(">", open) + 1;
    const bodyEnd = sendJsx.indexOf("</Animated.View>");
    expect(bodyStart).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const body = stripComments(sendJsx.slice(bodyStart, bodyEnd));
    // Count opening JSX element tags inside the disc body.
    const childTags = body.match(/<[A-Z][A-Za-z]*/g) ?? [];
    expect(childTags.length).toBe(1);
    // …and that single child is the lucide ArrowUp glyph.
    expect(childTags[0]).toBe("<ArrowUp");
  });
});

describe("ORCH-1101 ADV-3 · web paddingBottom short-circuits BEFORE the 80px native math", () => {
  it("the web branch is evaluated first; web can never reach BOTTOM_NAV_CLEARANCE_PX", () => {
    const screenCode = stripComments(chatScreen);
    // Find the inputWrap paddingBottom expression (the one that branches on web).
    const pbIdx = screenCode.search(
      /paddingBottom:\s*\n?\s*Platform\.OS === ["']web["']/,
    );
    expect(pbIdx).toBeGreaterThan(-1);
    // Slice from that paddingBottom to the next property/line end.
    const expr = screenCode.slice(pbIdx, pbIdx + 260);
    const webBranchPos = expr.indexOf('Platform.OS === "web"');
    const navMathPos = expr.indexOf("BOTTOM_NAV_CLEARANCE_PX");
    const webResultPos = expr.indexOf("spacing.sm");
    expect(webBranchPos).toBeGreaterThan(-1);
    expect(navMathPos).toBeGreaterThan(-1);
    expect(webResultPos).toBeGreaterThan(-1);
    // The web result (spacing.sm) must come BEFORE the native 80px term.
    expect(webResultPos).toBeLessThan(navMathPos);
    // And the web test must come before the keyboardHeight test (true ternary head).
    const kbPos = expr.indexOf("keyboardHeight");
    if (kbPos > -1) expect(webBranchPos).toBeLessThan(kbPos);
  });
});

describe("ORCH-1101 ADV-4 · composer height is bounded on a long multiline value", () => {
  it("the input style caps growth with a finite maxHeight (no unbounded dead space)", () => {
    const inputBlock = inputBarCode.slice(
      inputBarCode.indexOf("input:"),
      inputBarCode.indexOf("sendBtn:"),
    );
    const m = inputBlock.match(/maxHeight:\s*(\d+)/);
    expect(m).not.toBeNull();
    const maxH = Number(m![1]);
    expect(Number.isFinite(maxH)).toBe(true);
    expect(maxH).toBeGreaterThan(0);
    // Empty box is one line (minHeight 30); cap must exceed it but stay bounded.
    expect(maxH).toBeGreaterThanOrEqual(30);
    expect(maxH).toBeLessThanOrEqual(200);
  });

  it("web textarea disables manual resize so the browser can't reopen dead space", () => {
    expect(inputBarCode).toContain('resize: "none"');
    expect(inputBarCode).toContain('height: "auto"');
    expect(inputBarCode).toMatch(/rows:\s*1/);
  });
});

describe("ORCH-1101 ADV-5 · no send/primary fill is translucent (Android opaque policy)", () => {
  it("the send disc backgroundColor is an opaque token, never rgba/hsla/opacity", () => {
    const sendBtnBlock = inputBarCode.slice(
      inputBarCode.indexOf("sendBtn:"),
      inputBarCode.indexOf("suggestBtn:"),
    );
    expect(sendBtnBlock).toMatch(/backgroundColor:\s*ariPalette\.userBubble/);
    expect(sendBtnBlock).not.toMatch(/backgroundColor:\s*["']?(rgba|hsla)/i);
    // No opacity on the FILL itself (disabled-state opacity lives on a separate
    // style and is fine; the base disc must be solid).
    expect(sendBtnBlock).not.toMatch(/\bopacity:\s*0?\.\d/);
  });

  it("ariPalette.userBubble uses the opaque Mingla brand token accent.warm (#eb7825) [TEST-MOD-APPROVED ORCH-1101]", () => {
    // Operator brand-consistency decision 2026-06-08: the thread accent
    // references accent.warm (the dev style-guide brand action color), which
    // must remain a fully-opaque hex — an alpha channel would let the thread
    // bleed through the send disc / user bubble.
    expect(designSystem).toMatch(/userBubble:\s*accent\.warm/);
    const m = designSystem.match(/warm:\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("#eb7825");
    expect(m![1]).not.toMatch(/hsla|rgba/i);
  });
});

describe("ORCH-1101 ADV-6 · Ari thread accent stays on the Mingla brand token [TEST-MOD-APPROVED ORCH-1101]", () => {
  // Operator brand-consistency decision (2026-06-08): the Ari thread accent is
  // pinned to the dev style-guide brand action color (accent.warm = #eb7825),
  // paired with white text exactly like every other brand action button
  // app-wide. This intentionally supersedes the earlier Ari-only WCAG-AA 4.5:1
  // target (deep ember #a85a44) — brand consistency was chosen over the
  // Ari-specific contrast goal. The invariant now guarded is the brand-token
  // linkage, so a stray "tweak" away from the canonical brand color trips here.
  it("userBubble === accent.warm (#eb7825), the canonical Mingla brand action color", () => {
    expect(designSystem).toMatch(/userBubble:\s*accent\.warm/);
    expect(designSystem).toMatch(/warm:\s*["']#eb7825["']/);
  });
});

describe("ORCH-1101 ADV-7 · the SVG-gradient blob never leaks into a sibling ari fill surface", () => {
  it("no ari component composes a RadialGradient send/bubble fill behind a glyph", () => {
    // Guard against a copy-paste regression in any *non-orb* ari component.
    // AriOrb legitimately uses react-native-svg (the orb IS an SVG illustration)
    // and is the single sanctioned consumer — excluded by name.
    const files = fs
      .readdirSync(ARI_DIR)
      .filter((f) => f.endsWith(".tsx") && f !== "AriOrb.tsx");
    for (const f of files) {
      const src = stripComments(read(path.join(ARI_DIR, f)));
      expect(src).not.toMatch(/<RadialGradient\b/);
      expect(src).not.toMatch(/url\(#ari-send-fill\)/);
    }
  });
});
