import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

describe("ORCH-0964 smoke rework — business public-page preview chrome/theme", () => {
  const sharedSource = repoFile("packages/brand-rendering/PublicBrandPage.tsx");
  const adapterSource = readFileSync(
    path.join(process.cwd(), "src/components/brand/PublicBrandPage.tsx"),
    "utf8",
  );

  test("hero band is themed and entrance animation cannot intercept chrome taps", () => {
    expect(sharedSource).toContain(
      "style={[styles.heroWrap, { backgroundColor: heroColor }]}",
    );
    expect(sharedSource).toContain(
      "<ThemeEntranceAnimation\n          theme={resolvedTheme}",
    );
    expect(sharedSource).toContain('pointerEvents="none"');
    expect(sharedSource).toContain("styles.floatingChrome");
    expect(sharedSource).toContain('pointerEvents="box-none"');
  });

  test("business adapter passes resolved theme and safe chrome top offset", () => {
    expect(adapterSource).toContain("theme={theme}");
    expect(adapterSource).toContain("chromeTopOffset={insets.top + 8}");
    expect(adapterSource).toContain("onClose: handleClose");
    expect(adapterSource).toContain("onShare: () => setShareModalVisible(true)");
  });

  test("shared close/share buttons keep ORCH-0961 test IDs and render share glyph", () => {
    expect(sharedSource).toContain('testID="orch-0961-public-brand-close"');
    expect(sharedSource).toContain('testID="orch-0961-public-brand-share"');
    expect(sharedSource).toContain("hitSlop={8}");
    expect(sharedSource).toContain('glyph: "x" | "share"');
    expect(sharedSource).toContain("<ChromeGlyph glyph={glyph} />");
    expect(sharedSource).not.toContain('{glyph === "x" ? "x" : "up"}');
  });
});
