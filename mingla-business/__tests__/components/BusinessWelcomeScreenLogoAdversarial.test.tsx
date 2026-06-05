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
//   A. The squashing aspect-ratio regression — ANY non-square ratio in the
//      `logo` style (not only the one literal `1356 / 480` spelling) re-sliver
//      the square 2000x2000 lockup. Catches `2.83`, `1356/480`, `2.825`, etc.
//   B. Duplicate brand mark — the brand name must render at most ONCE as a
//      visible <Text> node (the old <Text>Mingla Business</Text> badge AND the
//      logo Image both showed = double mark). Count-based, not style-name-based.
//   C. Source-asset identity — the consumer wide wordmark
//      (`mingla_official_logo.png`, 1356x480) must NOT be the logo source; the
//      business asset on disk must be a genuine SQUARE PNG so `aspectRatio:1`
//      is physically correct (self-validating against the real file header).
//   D. Binding integrity — the <Image source={logo}> must actually wear
//      `styles.logo`, so the square ratio is applied to the rendered Image.
//
// fails-on-revert: verified to FAIL against the pre-fix parent commit
// (see QA report — adversarial fails-on-revert section).

const componentDir = path.resolve(__dirname, "../..");
const SCREEN = "src/components/auth/BusinessWelcomeScreen.tsx";
const source = fs.readFileSync(path.join(componentDir, SCREEN), "utf8");

/** Extract the body of `logo: { ... }` from the StyleSheet.create block. */
function extractLogoStyleBody(src: string): string {
  // Match `logo:` as a style key (preceded by whitespace/newline, followed by
  // `: {`), not `logoContainer:` and not `accessibilityLabel`/comments.
  const m = src.match(/\n\s*logo:\s*\{([\s\S]*?)\n\s*\},/);
  if (!m) {
    throw new Error("Could not locate `logo:` style block in BusinessWelcomeScreen");
  }
  return m[1];
}

describe("ORCH-1084 BusinessWelcomeScreen — adversarial logo regression", () => {
  test("A. logo style declares a SQUARE aspect ratio — no wide/sliver ratio can regress", () => {
    const body = extractLogoStyleBody(source);

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

  test("B. the brand name renders as a visible <Text> AT MOST once (no duplicate mark)", () => {
    // Count rendered <Text>...Mingla Business...</Text> NODES (the old badge was
    // `<Text style={styles.businessBadge}>Mingla Business</Text>`). The logo
    // Image carries the brand name only via accessibilityLabel, which is an
    // attribute, not a Text child, so it must NOT count here.
    const textNodeMatches =
      source.match(/<Text[^>]*>\s*Mingla Business\s*<\/Text>/g) || [];
    expect(textNodeMatches.length).toBe(0);

    // And the brand name must appear exactly once as an accessibilityLabel
    // (on the single Image) — proving there is one, and only one, brand mark.
    const a11yLabelMatches =
      source.match(/accessibilityLabel="Mingla Business"/g) || [];
    expect(a11yLabelMatches.length).toBe(1);
  });

  test("C. logo source is the SQUARE business asset, not the wide consumer wordmark", () => {
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

  test("D. the <Image source={logo}> actually wears styles.logo (square ratio is applied)", () => {
    // The Image element binding the logo must reference styles.logo so the
    // square aspectRatio is applied to what renders.
    const imageBlock = source.match(/<Image\s+source=\{logo\}[\s\S]*?\/>/);
    expect(imageBlock).not.toBeNull();
    expect(imageBlock![0]).toContain("style={styles.logo}");
    expect(imageBlock![0]).toContain('resizeMode="contain"');
  });
});
