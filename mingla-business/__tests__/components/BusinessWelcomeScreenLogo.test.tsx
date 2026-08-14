import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const source = fs.readFileSync(
  path.join(repoRoot, "src/components/auth/BusinessWelcomeScreen.tsx"),
  "utf8",
);

describe("issue #2052 Business welcome canonical wordmark", () => {
  test("renders the regular wide Mingla wordmark on native and real-DOM web paths", () => {
    expect(source).toContain(
      'import { MINGLA_WORDMARK } from "@mingla/brand-assets"',
    );
    expect(source).toContain("const logo = MINGLA_WORDMARK;");
    expect(source).not.toContain("MINGLA_BUSINESS_LOGO");
    expect(source).toContain(
      'const WEB_LOGO_SRC = "/brand/mingla-wordmark.png";',
    );
    expect(source).not.toContain("Image.resolveAssetSource(MINGLA_WORDMARK).uri");
    expect(source).toContain('React.createElement("img"');
    expect(source).toContain("src: WEB_LOGO_SRC");
    expect(source).toContain('alt: "Mingla"');
    expect(source).toContain('role: "img"');
    expect(source).toContain('objectFit: "contain"');
    expect(source).toContain('display: "block"');
    expect(source).toContain("opacity: 1");
    expect(source).toContain('accessibilityLabel="Mingla"');
    expect(source).toContain('resizeMode="contain"');
  });

  test("uses the approved compact capsule and fully contained wordmark", () => {
    expect(source).toContain("const WELCOME_LOGO_PILL_WIDTH = 140;");
    expect(source).toContain("const WELCOME_LOGO_PILL_HEIGHT = 54;");
    expect(source).toContain("const WELCOME_WORDMARK_WIDTH = 108;");
    expect(source).toContain("const WELCOME_DESKTOP_PILL_SCALE = 1.2;");
    expect(source).toContain("{ width: logoPillWidth, height: logoPillHeight }");
    expect(source).toContain("const logoHeight = logoWidth * 480 / 1356;");
    expect(source).toContain('backgroundColor: "#ffffff"');
    expect(source).toContain("borderRadius: 999");
    expect(source).toContain("aspectRatio: 1356 / 480");
    expect(source).not.toMatch(/aspectRatio:\s*1\s*,/);
  });
});
