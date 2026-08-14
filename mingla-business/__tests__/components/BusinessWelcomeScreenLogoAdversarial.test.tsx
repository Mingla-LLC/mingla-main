import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(businessRoot, "..");
const source = fs.readFileSync(
  path.join(businessRoot, "src/components/auth/BusinessWelcomeScreen.tsx"),
  "utf8",
);

describe("issue #2052 Business welcome wordmark adversarial contract", () => {
  test("the canonical asset itself is the expected 1356 by 480 PNG", () => {
    const asset = fs.readFileSync(
      path.join(repoRoot, "packages/brand-assets/mingla-wordmark.png"),
    );
    expect(asset.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(asset.readUInt32BE(16)).toBe(1356);
    expect(asset.readUInt32BE(20)).toBe(480);
  });

  test("the old square logo and Business label cannot return", () => {
    expect(source).not.toContain("mingla-business-logo.png");
    expect(source.match(/\/brand\//g)).toHaveLength(1);
    expect(source).toContain(
      'const WEB_LOGO_SRC = "/brand/mingla-wordmark.png";',
    );
    expect(source).not.toContain('alt: "Mingla Business"');
    expect(source).not.toContain('accessibilityLabel="Mingla Business"');
    expect(source).not.toContain("const LOGO_SIZE");
  });

  test("native and web image boxes bind the same contained wordmark dimensions", () => {
    const nativeImage = source.match(/<Image\s+source=\{logo\}[\s\S]*?\/>/);
    expect(nativeImage).not.toBeNull();
    expect(nativeImage![0]).toContain("width: logoWidth");
    expect(nativeImage![0]).toContain("height: logoHeight");

    const webImage = source.match(/React\.createElement\("img"[\s\S]*?\}\)/);
    expect(webImage).not.toBeNull();
    expect(webImage![0]).toContain("src: WEB_LOGO_SRC");
    expect(webImage![0]).toContain("width: logoWidth");
    expect(webImage![0]).toContain("height: logoHeight");
    expect(webImage![0]).toContain("opacity: 1");
    expect(source).toContain(
      "(logoPillWidth * WELCOME_WORDMARK_WIDTH) / WELCOME_LOGO_PILL_WIDTH",
    );
  });
});
