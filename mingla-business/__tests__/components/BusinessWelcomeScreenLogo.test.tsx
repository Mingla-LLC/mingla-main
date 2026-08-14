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
    expect(source).toContain("Image.resolveAssetSource(MINGLA_WORDMARK).uri");
    expect(source).toContain('React.createElement("img"');
    expect(source).toContain('alt: "Mingla"');
    expect(source).toContain('role: "img"');
    expect(source).toContain('objectFit: "contain"');
    expect(source).toContain('display: "block"');
    expect(source).toContain("opacity: 1");
    expect(source).toContain('accessibilityLabel="Mingla"');
    expect(source).toContain('resizeMode="contain"');
  });

  test("uses the approved wide dimensions and responsive caps", () => {
    expect(source).toContain("const WELCOME_NATIVE_LOGO_CAP = 320;");
    expect(source).toContain("const WELCOME_DESKTOP_LOGO_CAP = 420;");
    expect(source).toContain("const logoHeight = logoWidth * 480 / 1356;");
    expect(source).toContain("aspectRatio: 1356 / 480");
    expect(source).not.toMatch(/aspectRatio:\s*1\s*,/);
  });
});
