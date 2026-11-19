// MINGLA-INVARIANT: I-4453-WEBSITE-RAIL | issue #4453 | on desktop the app sidebar is the 80 icon rail on every address under /brand/<id>/website (the workspace, old section addresses, editors, the setup wizard, the full Ari chat), whatever the host's own collapse choice; no other brand screen changes.
/**
 * #4453 — the Website workspace draws its own 392 panel beside the live
 * draft, so the app's left sidebar collapses to the icon rail there.
 *
 * FAILS-ON-REVERT: drop the `/brand/<id>/website` rule from `isRailRoute`
 * (desktopSidebarState.ts) and every "rail" row below reads "sidebar" / 248.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_website_rail.implementor.test.ts
 */
import { describe, expect, test } from "@jest/globals";

import { DESKTOP_RAIL_WIDTH, DESKTOP_SIDEBAR_WIDTH } from "../../../constants/desktopLayout";
import { desktopSidebarWidth, isRailRoute } from "../desktopSidebarState";
import { hostDesktopShellModeFor } from "../hostDesktopShellRoutes";

const ID = "3f6c1c1e-5a1b-4c1d-9e1f-1a2b3c4d5e6f";
const outside: readonly string[] = ["brand", "[id]", "website"];

const WEBSITE = [
  `/brand/${ID}/website`,
  `/brand/${ID}/website/`,
  `/brand/${ID}/website/pages`,
  `/brand/${ID}/website/design`,
  `/brand/${ID}/website/publish`,
  `/brand/${ID}/website/stories/abc`,
  `/brand/${ID}/website/setup`,
  `/brand/${ID}/website/ari`,
  `/brand/${ID}/website?request=${ID}`,
  `/Brand/${ID}/Website`,
];

const NOT_WEBSITE = [
  `/brand/${ID}`,
  `/brand/${ID}/team`,
  `/brand/${ID}/payments`,
  `/brand/${ID}/listing`,
  `/brand/${ID}/websites`,
  "/website-return",
  "/account/support",
];

describe("#4453 — the Website workspace collapses the app sidebar to the rail", () => {
  test.each(WEBSITE)("%s is a rail route", (pathname) => {
    expect(isRailRoute(pathname)).toBe(true);
    expect(desktopSidebarWidth(false, pathname)).toBe(DESKTOP_RAIL_WIDTH);
    expect(hostDesktopShellModeFor(pathname, outside)).toBe("rail");
  });

  test.each(NOT_WEBSITE)("%s keeps the host's own sidebar choice", (pathname) => {
    expect(isRailRoute(pathname)).toBe(false);
    expect(desktopSidebarWidth(false, pathname)).toBe(DESKTOP_SIDEBAR_WIDTH);
    expect(desktopSidebarWidth(true, pathname)).toBe(DESKTOP_RAIL_WIDTH);
  });

  test("the public return page stays chrome-free", () => {
    expect(hostDesktopShellModeFor("/website-return", ["website-return"])).toBe("none");
  });
});
