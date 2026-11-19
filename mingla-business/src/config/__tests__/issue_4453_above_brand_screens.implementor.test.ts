/**
 * #4453 — the brand name is at the top of every brand screen, and of no
 * screen above brand level (Account, Notifications, Help, creating a brand).
 * (How the shell, the workspace and Account are wired to this is a source rule:
 * .github/scripts/strict-grep/issue-4453-sites-host-wiring.mjs.)
 */
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

describe("on a phone, a brand's own screens name the brand at the top", () => {
  it.each(["/brand/b1", "/brand/b1/team", "/brand/b1/edit", "/brand/b1/payments/reports", "/brand/b1/pricing-defaults", "/brand/b1/creators/roster", "/brand/b1/setup"])("%s", (path) => {
    expect(phoneBrandStripFor(path, "b1")).toBe("b1");
  });
  it("Website setup, overview and try-again screens are named too (a brand with no website yet)", () => {
    expect(phoneBrandStripFor("/brand/b1/website", "b1")).toBe("b1");
    expect(phoneBrandStripFor("/brand/b1/website/setup", "b1")).toBe("b1");
    expect(phoneBrandStripFor("/brand/b1/website/preview", "b1")).toBeNull();
  });
  it("nothing above brand level, and nothing on tab screens (their top bar has it)", () => {
    expect(phoneBrandStripFor("/brand/new", null)).toBeNull();
    expect(phoneBrandStripFor("/account", null)).toBeNull();
    expect(phoneBrandStripFor("/marketing/ads", null)).toBeNull();
    expect(phoneBrandStripFor("/ari", "b1")).toBeNull();
  });
});
