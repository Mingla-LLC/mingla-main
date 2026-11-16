/**
 * #4238 rework 6 — device verdict fixes (Android keyboard in the builder,
 * full Withdraw label, small fixes).
 *
 * P1-1: on Android the pinned dock steps aside while the keyboard is open.
 * P2-1: the Withdraw sheet stacks full-width buttons so the amount never cuts.
 * P3: stacked rejected-ad dock, "same total" line on Ari's extend confirm in
 * every locale, builder leaves through the Leave sheet on hardware back / swipe.
 *
 * Fails on revert: deleting shouldHideHostAdDock or its use, putting the
 * withdraw buttons back in a half-width row, dropping the same-total line or a
 * locale key, or removing the beforeRemove guard reds the matching test.
 */

import fs from "node:fs";
import path from "node:path";

import { shouldHideHostAdDock } from "../hostAdBuilderRules";

const root = path.resolve(__dirname, "../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

describe("P1-1 builder dock and the Android keyboard", () => {
  it("hides the dock only on Android with the keyboard open", () => {
    expect(shouldHideHostAdDock("android", true)).toBe(true);
    expect(shouldHideHostAdDock("android", false)).toBe(false);
    expect(shouldHideHostAdDock("ios", true)).toBe(false);
    expect(shouldHideHostAdDock("web", true)).toBe(false);
  });

  it("the phone builder renders the dock through that rule", () => {
    const src = read("src/screens/hostAds/HostAdCreateScreen.tsx");
    expect(src).toContain("shouldHideHostAdDock(Platform.OS, keyboardOpen)");
    expect(src).toContain("{dockHiddenForKeyboard ? null : (");
    expect(src).toContain('from "../../wrappers/useKeyboardIsVisible"');
  });
});

describe("P2-1 withdraw buttons never cut the amount", () => {
  const src = read("src/components/marketing/ads/HostAdManageSheets.tsx");
  const withdraw = src.slice(src.indexOf("export function HostAdWithdrawSheet"));
  const foot = withdraw.slice(withdraw.indexOf("foot={"), withdraw.indexOf("    >\n"));

  it("stacks full-width buttons, not a half-width row", () => {
    expect(foot).toContain("s.stackedActions");
    expect(foot).not.toContain("s.half");
    expect(foot).not.toContain("bs.actions");
    expect((foot.match(/fullWidth/g) ?? []).length).toBe(2);
  });
});

describe("P3 small fixes", () => {
  it("the rejected-ad dock stacks full-width buttons", () => {
    const src = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    const block = src.slice(src.indexOf('testID="ads-detail-rejected-dock"'), src.indexOf('testID="ads-detail-rejected-change"'));
    expect(block).toContain("fullWidth");
    expect(block).not.toContain("styles.flex");
  });

  it("Ari's extend confirm says the total stays the same, in every locale", () => {
    const sheet = read("src/components/marketing/ads/HostAdManageSheets.tsx");
    expect(sheet).toContain('suggestion.kind === "extend_end"');
    const dir = path.join(root, "src/i18n/locales");
    const locales = fs.readdirSync(dir).filter((l) => fs.existsSync(path.join(dir, l, "hostAds.json")));
    expect(locales.length).toBeGreaterThanOrEqual(28);
    for (const locale of locales) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, locale, "hostAds.json"), "utf8")) as Record<string, unknown>;
      const hit = JSON.stringify(json).match(/"sameTotalLine":"([^"]+)"/);
      expect(`${locale}:${hit ? "ok" : "missing"}`).toBe(`${locale}:ok`);
    }
  });

  it("hardware back and the iOS swipe go through the Leave sheet", () => {
    const src = read("src/screens/hostAds/HostAdCreateScreen.tsx");
    expect(src).toContain('navigation.addListener("beforeRemove"');
    expect(src).toContain('setSheet("leave")');
    expect(src).toContain("sanctionedExitRef.current = true;");
  });

  it("the list keeps its floating-button clearance", () => {
    const src = read("src/screens/hostAds/HostAdListScreen.tsx");
    expect(src).toContain("hostAdScrollBottomPadding(useStickyFooterOffset())");
  });
});
