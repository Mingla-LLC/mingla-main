/**
 * #4453 — the brand name is at the top of every brand screen, and of no
 * screen above brand level (Account, Notifications, Help, creating a brand).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAboveBrandScreen, phoneBrandStripFor } from "../workspaceBrandRoute";

describe("screens above brand level", () => {
  it.each([
    "/account", "/(tabs)/account", "/account/edit-profile", "/notifications", "/support", "/support/ticket-1",
    "/recent", "/partner", "/promoting", "/brand/new",
  ])("%s shows no brand name", (path) => {
    expect(isAboveBrandScreen(path)).toBe(true);
  });
  it.each([
    "/brand/b1", "/brand/b1/website", "/brand/b1/website/design", "/brand/b1/team", "/brand/b1/payments/reports",
    "/home", "/(tabs)/home", "/hub/events", "/marketing", "/marketing/ads", "/marketing/campaigns", "/people",
    "/messages", "/analytics", "/ari", "/event/e1", "/trip/t1", "/account/tap-to-pay", "/", null, undefined,
  ])("%s is a brand screen (or follows the current brand)", (path) => {
    expect(isAboveBrandScreen(path as string | null | undefined)).toBe(false);
  });
});

describe("the desktop top bar", () => {
  const shell = readFileSync(resolve(__dirname, "../../components/ui/HostDesktopShell.tsx"), "utf8");
  it("shows the brand switcher on brand screens only", () => {
    expect(shell).toContain('<TopBar leftKind={aboveBrand ? "none" : "brand"} onBrandTap={onBrandTap} />');
    expect(shell).toContain("aboveBrand={isAboveBrandScreen(pathname)}");
  });
});

describe("Account (the list of every brand)", () => {
  const account = readFileSync(resolve(__dirname, "../../../app/(tabs)/account.tsx"), "utf8");
  it("has no brand switcher at the top", () => {
    expect(account).toMatch(/<TopBar\s+leftKind="none"/);
    expect(account).not.toMatch(/<TopBar\s+leftKind="brand"/);
  });
  it("still opens the brands sheet (create, continue setup, delete) from Your brands", () => {
    expect(account).toContain('testID="account-manage-brands"');
    expect(account).toMatch(/<ListRow\s+onPress=\{handleOpenSwitcher\}\s+accessibilityLabel="Add or manage brands"/);
  });
});

describe("on a phone, a brand's own screens name the brand at the top", () => {
  it.each(["/brand/b1", "/brand/b1/team", "/brand/b1/edit", "/brand/b1/payments/reports", "/brand/b1/pricing-defaults", "/brand/b1/creators/roster", "/brand/b1/setup"])("%s", (path) => {
    expect(phoneBrandStripFor(path, "b1")).toBe("b1");
  });
  it("Website setup, overview and try-again screens are named too (a brand with no website yet)", () => {
    expect(phoneBrandStripFor("/brand/b1/website", "b1")).toBe("b1");
    expect(phoneBrandStripFor("/brand/b1/website/setup", "b1")).toBe("b1");
    expect(phoneBrandStripFor("/brand/b1/website/preview", "b1")).toBeNull();
  });
  it("the Website workspace carries the switcher in its own bar and the shell steps aside: one per screen", () => {
    const shell = readFileSync(resolve(__dirname, "../../components/ui/HostDesktopShell.tsx"), "utf8");
    const workspace = readFileSync(resolve(__dirname, "../../components/sites/website/workspace/WorkspaceShell.tsx"), "utf8");
    expect(workspace).toContain("useOwnPhoneBrandSwitcher(phone);");
    expect(shell).toContain("user != null && !screenOwnsSwitcher");
  });
  it("nothing above brand level, and nothing on tab screens (their top bar has it)", () => {
    expect(phoneBrandStripFor("/brand/new", null)).toBeNull();
    expect(phoneBrandStripFor("/account", null)).toBeNull();
    expect(phoneBrandStripFor("/marketing/ads", null)).toBeNull();
    expect(phoneBrandStripFor("/ari", "b1")).toBeNull();
  });
  it("is drawn by the shell on phone-width web only, above the screen", () => {
    const shell = readFileSync(resolve(__dirname, "../../components/ui/HostDesktopShell.tsx"), "utf8");
    expect(shell).toContain('const phoneBrandId = Platform.OS === "web" && !isWideDesktop && user != null && !screenOwnsSwitcher');
    expect(shell).toContain('<WorkspaceBrandSwitcher brandId={phoneBrandId} compact testID="host-phone-brand-switcher" />');
    expect(shell.indexOf('testID="host-phone-brand-strip"')).toBeLessThan(shell.indexOf("<View style={styles.stack}>{children}</View>"));
  });
});
