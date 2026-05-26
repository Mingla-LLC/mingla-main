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
  const animationSource = repoFile("packages/event-rendering/ThemeEntranceAnimation.tsx");

  test("hero band is themed and entrance animation cannot intercept chrome taps", () => {
    expect(sharedSource).toContain(
      "style={[styles.heroWrap, { backgroundColor: heroColor }]}",
    );
    expect(sharedSource).toContain("const palette = useMemo(() => createThemePalette(resolvedTheme)");
    expect(sharedSource).toContain("styles.heroThemeTint");
    expect(sharedSource).toContain(
      "</ScrollView>\n\n      <ThemeEntranceAnimation\n        theme={resolvedTheme}",
    );
    expect(sharedSource).toContain("replayOnMount");
    expect(sharedSource).toContain("colorOverride={palette.accent}");
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

  test("theme is visible beyond the cover image fallback", () => {
    expect(sharedSource).toContain("type ThemePalette");
    expect(sharedSource).toContain("const createThemePalette = (theme: ResolvedTheme)");
    expect(sharedSource).toContain("const contrastRatio = (a: string, b: string): number");
    expect(sharedSource).toContain("const contrastAdjustedAccent = (");
    expect(sharedSource).toContain("const useDark =");
    expect(sharedSource).toContain("const accentColor = contrastAdjustedAccent(theme.color, page, 3.15)");
    expect(sharedSource).toContain("backgroundColor: palette.page");
    expect(sharedSource).toContain("backgroundColor: palette.heroLift");
    expect(sharedSource).toContain("borderColor: palette.accent");
    expect(sharedSource).toContain("backgroundColor: palette.card");
    expect(sharedSource).toContain("backgroundColor: palette.accent");
    expect(sharedSource).toContain("color: palette.primaryText");
    expect(sharedSource).toContain("color: palette.accentText");
    expect(sharedSource).toContain("styles.pageThemeWashBottom");
    expect(sharedSource).toContain("styles.identityTopRow");
    expect(sharedSource).toContain("flexDirection: \"column\"");
    expect(sharedSource).toContain("height: 174");
  });

  test("ticket CTA is promoted into a large themed card action", () => {
    const eventBuyPillBlock = sharedSource.match(/eventBuyPill: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(sharedSource).toContain("Buy tickets");
    expect(sharedSource).toContain("minHeight: 52");
    expect(sharedSource).toContain("fontSize: 16");
    expect(sharedSource).toContain("fontWeight: \"900\"");
    expect(eventBuyPillBlock).not.toContain("position: \"absolute\"");
  });

  test("public brand animation replays per page mount without changing event-page behavior", () => {
    expect(animationSource).toContain("replayOnMount?: boolean");
    expect(animationSource).toContain("colorOverride?: string");
    expect(animationSource).toContain("replayOnMount = false");
    expect(animationSource).toContain("mountIdRef");
    expect(animationSource).toContain("replayOnMount\n    ? `${sessionKey}:${theme.animation}:${mountIdRef.current}`");
    expect(animationSource).toContain("colorOverride ?? theme.color");
    expect(animationSource).toContain("elevation: 6");
    expect(sharedSource).toContain(
      "sessionKey={`brand:${brand.slug}:${resolvedTheme.color}:${resolvedTheme.font}`}",
    );
    expect(sharedSource).toContain("replayOnMount");
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
