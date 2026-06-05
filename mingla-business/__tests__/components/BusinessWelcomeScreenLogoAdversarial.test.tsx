import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1084 [business-logo-wordmark] — ADVERSARIAL regression test (tester-authored).
//
// Angle is DELIBERATELY different from the implementor's happy-path presence test
// (BusinessWelcomeScreenLogo.test.tsx), which asserts the literal strings
// `aspectRatio: 1` / `accessibilityLabel="Mingla Business"` are PRESENT.
//
// This test instead attacks the failure modes that a future edit could
// reintroduce WITHOUT tripping the implementor's exact-string checks:
//   A. The RN Web image-box regression — the logo wrapper AND image need
//      explicit equal width+height so the 2000px PNG natural height cannot leak
//      into the rendered <img> box while opacity/visibility remain style-safe.
//      The web path must use a real DOM <img> with opacity:1 because RN Web's
//      Image internals can keep its internal <img> opacity-zero.
//   B. The squashing aspect-ratio regression — ANY non-square ratio in the
//      `logo` style (not only the one literal `1356 / 480` spelling) re-sliver
//      the square 2000x2000 lockup. Catches `2.83`, `1356/480`, `2.825`, etc.
//   C. Duplicate brand mark — the brand name must render at most ONCE as a
//      visible <Text> node (the old <Text>Mingla Business</Text> badge AND the
//      logo Image both showed = double mark). Count-based, not style-name-based.
//   D. Source-asset identity — the consumer wide wordmark
//      (`mingla_official_logo.png`, 1356x480) must NOT be the logo source; the
//      business asset on disk must be a genuine SQUARE PNG so `aspectRatio:1`
//      is physically correct (self-validating against the real file header).
//   E. Binding integrity — the <Image source={logo}> must actually wear
//      `styles.logo`, so the square ratio is applied to the rendered Image.
//
// fails-on-revert: verified to FAIL against the pre-fix parent commit
// (see QA report — adversarial fails-on-revert section).

const componentDir = path.resolve(__dirname, "../..");
const SCREEN = "src/components/auth/BusinessWelcomeScreen.tsx";
const source = fs.readFileSync(path.join(componentDir, SCREEN), "utf8");

/** Extract the body of `styleKey: { ... }` from the StyleSheet.create block. */
function extractStyleBody(src: string, styleKey: string): string {
  const m = src.match(new RegExp(`\\n\\s*${styleKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  if (!m) {
    throw new Error(`Could not locate \`${styleKey}:\` style block in BusinessWelcomeScreen`);
  }
  return m[1];
}

function extractStyleValue(styleBody: string, property: string): string | null {
  const m = styleBody.match(new RegExp(`${property}:\\s*([^,\\n]+)`));
  return m ? m[1].trim() : null;
}

describe("ORCH-1084 BusinessWelcomeScreen — adversarial logo regression", () => {
  test("A. logo wrapper and Image declare explicit equal dimensions — no 2000px web box leak", () => {
    expect(source).toContain("const LOGO_SIZE = Math.min(s(220), 220);");
    expect(source).toContain('const WEB_LOGO_SRC = "/brand/mingla-business-logo.png";');
    expect(source).toContain('React.createElement("img"');
    expect(source).toContain("src: WEB_LOGO_SRC");
    expect(source).toContain('alt: "Mingla Business"');
    expect(source).toContain('objectFit: "contain"');
    expect(source).toContain("opacity: 1");

    const containerBody = extractStyleBody(source, "logoContainer");
    const logoBody = extractStyleBody(source, "logo");

    for (const [name, body] of [
      ["logoContainer", containerBody],
      ["logo", logoBody],
    ] as const) {
      const width = extractStyleValue(body, "width");
      const height = extractStyleValue(body, "height");
      expect(width).toBe("LOGO_SIZE");
      expect(height).toBe("LOGO_SIZE");
      expect(width).toBe(height);

      // Production failure signature: width was constrained but height leaked
      // from the 2000px natural PNG. Percent max dimensions are not enough.
      expect(body).not.toMatch(/maxWidth:\s*["']/);
      expect(body).not.toMatch(/maxHeight:\s*["']/);
      expect(body).not.toMatch(/height:\s*2000/);
      expect(body).not.toMatch(/opacity:\s*0/);
      expect(name).toBeTruthy();
    }
  });

  test("B. logo style declares a SQUARE aspect ratio — no wide/sliver ratio can regress", () => {
    const body = extractStyleBody(source, "logo");

    // There must be an aspectRatio declaration at all.
    const aspectMatch = body.match(/aspectRatio:\s*([^,\n]+)/);
    expect(aspectMatch).not.toBeNull();

    const expr = aspectMatch![1].trim();

    // Compute the ratio and assert it is ~1.0. Accepts a bare number (`1`,
    // `1.0`) or a single division `a / b` (`2000 / 2000`). Rejects `1356 / 480`,
    // `2.83`, any value that is not square — regardless of how it is spelled.
    // A tiny explicit parser is used instead of eval() (no arbitrary-code exec).
    let value: number;
    const div = expr.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
    if (div) {
      value = Number(div[1]) / Number(div[2]);
    } else if (/^[\d.]+$/.test(expr)) {
      value = Number(expr);
    } else {
      throw new Error(`Unexpected aspectRatio expression: ${expr}`);
    }
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeCloseTo(1, 5);

    // Belt-and-braces: the wide consumer-wordmark ratio must not appear at all
    // anywhere in the file, in any spelling.
    expect(/aspectRatio:\s*1356\s*\/\s*480/.test(source)).toBe(false);
    expect(/aspectRatio:\s*2\.8/.test(source)).toBe(false);
  });

  test("C. the brand name renders as a visible <Text> AT MOST once (no duplicate mark)", () => {
    // Count rendered <Text>...Mingla Business...</Text> NODES (the old badge was
    // `<Text style={styles.businessBadge}>Mingla Business</Text>`). The logo
    // Image carries the brand name only via accessibilityLabel, which is an
    // attribute, not a Text child, so it must NOT count here.
    const textNodeMatches =
      source.match(/<Text[^>]*>\s*Mingla Business\s*<\/Text>/g) || [];
    expect(textNodeMatches.length).toBe(0);

    // Native has one accessibilityLabel; web has one alt. The visible text
    // duplicate remains banned above.
    const a11yLabelMatches =
      source.match(/accessibilityLabel="Mingla Business"/g) || [];
    expect(a11yLabelMatches.length).toBe(1);

    const webAltMatches = source.match(/alt:\s*"Mingla Business"/g) || [];
    expect(webAltMatches.length).toBe(1);
  });

  test("D. logo source is the SQUARE business asset, not the wide consumer wordmark", () => {
    // The wide consumer mark must never be the welcome-screen logo source.
    expect(source).not.toContain("mingla_official_logo.png");

    // The required asset, and it must exist on disk as a genuine square PNG.
    const assetRel = "assets/brand/mingla-business-logo.png";
    expect(source).toContain(`require("../../../${assetRel}")`);

    const assetPath = path.join(componentDir, assetRel);
    expect(fs.existsSync(assetPath)).toBe(true);

    // Read PNG IHDR (bytes 16-23) for width/height — self-validate squareness.
    const buf = fs.readFileSync(assetPath);
    // PNG signature check.
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(width).toBe(height); // square
    expect(width).toBeGreaterThan(0);
  });

  test("E. native Image wears styles.logo and web img uses the public logo URI", () => {
    // The native Image element binding the logo must reference styles.logo so
    // the square dimensions are applied to what renders on iOS/Android.
    const imageBlock = source.match(/<Image\s+source=\{logo\}[\s\S]*?\/>/);
    expect(imageBlock).not.toBeNull();
    expect(imageBlock![0]).toContain("style={styles.logo}");
    expect(imageBlock![0]).toContain('resizeMode="contain"');

    const webImageBlock = source.match(/React\.createElement\("img"[\s\S]*?\}\)/);
    expect(webImageBlock).not.toBeNull();
    expect(webImageBlock![0]).toContain("src: WEB_LOGO_SRC");
    expect(webImageBlock![0]).toContain("width: LOGO_SIZE");
    expect(webImageBlock![0]).toContain("height: LOGO_SIZE");
    expect(webImageBlock![0]).toContain("opacity: 1");
  });
});
