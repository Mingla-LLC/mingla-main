/**
 * #4453 — the brand name is at the top of every brand screen, and of no
 * screen above brand level (Account, Notifications, Help, creating a brand).
 * (How the shell, the workspace and Account are wired to this is a source rule:
 * .github/scripts/strict-grep/issue-4453-sites-host-wiring.mjs.)
 */
import { hostDesktopShellModeFor } from "../../components/ui/hostDesktopShellRoutes";
import { isAboveBrandScreen, itemRouteRef, phoneBrandStrip, phoneBrandStripFor } from "../workspaceBrandRoute";
import { sameScreenForBrand } from "../workspaceBrandRoutes";

describe("screens above brand level", () => {
  it.each([
    "/account", "/(tabs)/account", "/account/edit-profile", "/notifications", "/support", "/support/ticket-1",
    "/recent", "/partner", "/promoting", "/brand/new", "/ari/settings",
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

describe("on a phone, one item of a brand names the brand too, and switching opens the other brand's list", () => {
  const strip = (path: string, tabs = false) =>
    phoneBrandStrip(path, null, hostDesktopShellModeFor(path, tabs ? ["(tabs)"] : [path.split("/")[1] ?? ""], null));

  it.each([
    ["/trip/t1", "/(tabs)/hub/trips"],
    ["/trip/t1/travelers", "/(tabs)/hub/trips"],
    ["/event/e1", "/(tabs)/hub/events"],
    ["/event/e1/orders/o1", "/(tabs)/hub/events"],
    ["/event/e1/guests", "/(tabs)/hub/events"],
    ["/rsvp/r1", "/(tabs)/hub/events"],
    ["/experience/x1", "/(tabs)/hub/experiences"],
    ["/venue/v1", "/(tabs)/hub/listing"],
    ["/insights/i1", "/(tabs)/analytics"],
  ])("%s shows the current brand and switches to %s", (path, list) => {
    expect(strip(path)).toEqual({ brandId: undefined });
    expect(sameScreenForBrand(path, {}, "b1", "b2")).toBe(list);
  });

  it("a brand's own screen names the route's brand", () => {
    expect(phoneBrandStrip("/brand/b1/team", "b1", "sidebar")).toEqual({ brandId: "b1" });
    expect(phoneBrandStrip("/brand/b1/website/preview", "b1", "none")).toBeNull();
  });

  it.each(["/home", "/marketing/ads", "/hub/trips"])("tab screen %s keeps its own top bar (no second switcher)", (path) => {
    expect(strip(path, true)).toBeNull();
  });

  it.each([
    "/account", "/account/edit-profile", "/notifications", "/support/inbox", "/brand/new", "/ari/settings",
    "/auth", "/e/brand/event", "/t/brand/trip", "/checkout/e1", "/pay/tok", "/event/e1/door", "/event/e1/scanner",
    "/event/create", "/trip/create", "/trip/t1/edit",
  ])("%s shows no brand strip", (path) => {
    expect(strip(path)).toBeNull();
  });
});

describe("which item a screen is about (its brand is read from that row)", () => {
  const id = "a3e4756c-f273-47fc-bf73-2f8432217e3a";
  it.each([
    [`/trip/${id}`, "events"], [`/trip/${id}/travelers`, "events"], [`/event/${id}/orders/o1`, "events"],
    [`/rsvp/${id}/guests`, "events"], [`/experience/${id}`, "events"], [`/venue/${id}`, "venue_listings"],
  ])("%s", (path, table) => {
    expect(itemRouteRef(path)).toEqual({ table, id });
  });
  it.each(["/event/create", "/trip/create", "/rsvp/pass", "/venue/deck-readiness", "/venue/create", `/brand/${id}`, "/home", `/insights/${id}`, null])("%s is not an item", (path) => {
    expect(itemRouteRef(path)).toBeNull();
  });
  it("the strip names that brand once it is known", () => {
    expect(phoneBrandStrip(`/trip/${id}`, "b9", "sidebar")).toEqual({ brandId: "b9" });
  });
});
