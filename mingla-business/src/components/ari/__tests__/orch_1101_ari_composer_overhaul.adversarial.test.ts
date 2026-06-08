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

  it("ariPalette.userBubble resolves to a fully-opaque hsl (no alpha channel)", () => {
    const m = designSystem.match(/userBubble:\s*["']([^"']+)["']/);
    expect(m).not.toBeNull();
    const val = m![1];
    // hsl(...) with three comps only — an hsla/4th-arg would carry transparency.
    expect(val).toMatch(/^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$/);
    expect(val).not.toMatch(/hsla|rgba/i);
  });
});

describe("ORCH-1101 ADV-6 · white-on-ember meets WCAG AA 4.5:1 (computed, not asserted)", () => {
  // Parse hsl(10, 55%, 42%) → sRGB and compute the real contrast ratio.
  const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0,
      g = 0,
      b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  };
  const relLum = (rgb: [number, number, number]): number => {
    const f = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };

  it("contrast(white, userBubble) >= 4.5:1", () => {
    const m = designSystem.match(/userBubble:\s*["']hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)["']/);
    expect(m).not.toBeNull();
    const [h, s, l] = [Number(m![1]), Number(m![2]), Number(m![3])];
    const bg = relLum(hslToRgb(h, s, l));
    const fg = relLum([255, 255, 255]);
    const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
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
