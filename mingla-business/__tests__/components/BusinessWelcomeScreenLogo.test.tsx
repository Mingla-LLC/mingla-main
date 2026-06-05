import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1084 [business-logo-wordmark] — the welcome/auth screen must present the
// OFFICIAL Mingla Business logo image as the single brand mark, NOT the orange
// uppercase "Mingla Business" text wordmark. This screen is the shared RN
// component rendered on web (business.usemingla.com), iOS, and Android, so this
// one assertion covers all three surfaces.
//
// fails-on-revert verified at e8e3f2c (pre-fix commit; see implementation report)

const repoRoot = path.resolve(__dirname, "../..");
const readBusinessFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const SCREEN = "src/components/auth/BusinessWelcomeScreen.tsx";

describe("ORCH-1084 BusinessWelcomeScreen official-logo wordmark", () => {
  test("SC-1 renders the official Mingla Business logo Image in a stable square box", () => {
    const source = readBusinessFile(SCREEN);

    // The official square business-logo asset is the brand mark.
    expect(source).toContain(
      'require("../../../assets/brand/mingla-business-logo.png")',
    );
    // Native still renders as an <Image source={logo} ...> with contain sizing.
    expect(source).toMatch(/<Image\s+source=\{logo\}/);
    expect(source).toContain('resizeMode="contain"');
    // Web uses a DOM <img> because RN Web's internal Image <img> can remain
    // opacity-zero even when the wrapper is square.
    expect(source).toContain('React.createElement("img"');
    expect(source).toContain('const WEB_LOGO_SRC = "/brand/mingla-business-logo.png";');
    expect(source).toContain("src: WEB_LOGO_SRC");
    expect(source).toContain('alt: "Mingla Business"');
    expect(source).toContain("objectFit: \"contain\"");
    expect(source).toContain("opacity: 1");
    // The Image is labelled for the brand (replaces the old text badge).
    expect(source).toContain('accessibilityLabel="Mingla Business"');
    // RN Web needs explicit dimensions here. A width-only + aspectRatio style
    // passed source tests but leaked the 2000px natural asset height live.
    expect(source).toContain("const LOGO_SIZE = Math.min(s(220), 220);");
    expect(source).toMatch(/logoContainer:\s*\{[\s\S]*?width:\s*LOGO_SIZE,[\s\S]*?height:\s*LOGO_SIZE,/);
    expect(source).toMatch(/logo:\s*\{[\s\S]*?width:\s*LOGO_SIZE,[\s\S]*?height:\s*LOGO_SIZE,/);
    // Square aspect ratio remains as belt-and-braces documentation so the
    // 2000x2000 official lockup is not letterboxed into the old wide
    // 1356/480 consumer-wordmark ratio.
    expect(source).toContain("aspectRatio: 1");
    expect(source).not.toContain("aspectRatio: 1356 / 480");
  });

  test("SC-2 does NOT render the orange 'Mingla Business' text wordmark badge", () => {
    const source = readBusinessFile(SCREEN);

    // The removed text badge: <Text style={styles.businessBadge}>Mingla Business</Text>
    expect(source).not.toMatch(/<Text[^>]*styles\.businessBadge[^>]*>/);
    expect(source).not.toContain(">Mingla Business</Text>");
    // Its dedicated style is gone too.
    expect(source).not.toMatch(/businessBadge:\s*\{/);
  });
});
