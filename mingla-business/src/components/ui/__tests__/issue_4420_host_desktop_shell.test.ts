/**
 * #4420 B6 — which desktop chrome every route group gets.
 *
 * Signed-in host routes outside app/(tabs) rendered with no sidebar and no top
 * bar on desktop. The root HostDesktopShell now gives them the 248 grouped
 * sidebar + web top bar (or the 80 rail on wizard / full-screen routes), while
 * public buyer routes, auth, the door / scanner full-screen and the wizards
 * that draw their own rail stay exactly as they were.
 *
 * FAILS ON REVERT: drop a route group from the table (it loses or wrongly
 * gains chrome), or let a public buyer route pick up the host sidebar.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../desktopSidebarState", () => ({
  isRailRoute: (pathname: string): boolean =>
    pathname.includes("/campaigns/compose") || /\/(create|new|edit)(\/|$)/.test(pathname) || /\/marketing\/ads\/[^/]+/.test(pathname),
}));

import { hostDesktopShellModeFor } from "../hostDesktopShellRoutes";

const ID = "1cb11811-f009-3ac7-1d25-dfbf77a0ca4a";
const outside: readonly string[] = ["brand"];

const TABLE: ReadonlyArray<readonly [string, string, string]> = [
  // [group, pathname, expected]
  // Signed-in host routes outside (tabs) → sidebar
  ["brand profile", `/brand/${ID}`, "sidebar"],
  ["brand payments", `/brand/${ID}/payments`, "sidebar"],
  ["brand creators", `/brand/${ID}/creators/roster`, "sidebar"],
  ["account support", "/account/support", "sidebar"],
  ["account notifications settings", "/account/notifications", "sidebar"],
  ["support inbox", "/support/inbox", "sidebar"],
  ["support ticket", "/support/abc", "sidebar"],
  ["notifications", "/notifications", "sidebar"],
  ["team", "/team", "sidebar"],
  ["event home", `/event/${ID}`, "sidebar"],
  ["event orders", `/event/${ID}/orders`, "sidebar"],
  ["event guests", `/event/${ID}/guests`, "sidebar"],
  ["event group chat", `/event/${ID}/group-chat`, "sidebar"],
  ["venue", `/venue/${ID}`, "sidebar"],
  ["trip home", `/trip/${ID}`, "sidebar"],
  ["trip money", `/trip/${ID}/money`, "sidebar"],
  ["experience home", `/experience/${ID}`, "sidebar"],
  ["messages", "/messages", "sidebar"],
  ["messages thread", "/messages/abc", "sidebar"],
  ["ari settings", "/ari/settings", "sidebar"],
  ["insights", "/insights", "sidebar"],
  ["partner earnings", "/partner/earnings", "sidebar"],
  ["promoting", "/promoting", "sidebar"],
  // [TEST-MOD-APPROVED #4420] journey: the host RSVP manage routes lost the
  // shell because the whole "/rsvp" prefix was treated as public.
  ["rsvp home", `/rsvp/${ID}`, "sidebar"],
  ["rsvp guests", `/rsvp/${ID}/guests`, "sidebar"],
  ["rsvp scanners", `/rsvp/${ID}/scanners`, "sidebar"],
  // Wizard / full-screen routes → 80 rail
  ["new brand", "/brand/new", "rail"],
  ["venue create", "/venue/create", "rail"],
  ["experience create", "/experience/create", "rail"],
  ["experience edit", `/experience/${ID}/edit`, "rail"],
  ["brand edit", `/brand/${ID}/edit`, "rail"],
  // Unchanged → none
  ["sign-in", "/", "none"],
  ["auth", "/auth", "none"],
  ["auth callback", "/auth/callback", "none"],
  ["public event", "/e/brand/event", "none"],
  ["public trip", "/t/brand/trip", "none"],
  ["public brand", "/b/brand", "none"],
  ["public experience", "/exp/brand/x", "none"],
  ["checkout", `/checkout/${ID}`, "none"],
  ["checkout trip", `/checkout-trip/${ID}`, "none"],
  ["checkout experience", `/checkout-experience/${ID}`, "none"],
  ["instalment pay", "/pay/token", "none"],
  ["stay group", "/stay/group-1", "none"],
  ["stay pay", "/stay/pay/token", "none"],
  ["booking cancel", `/booking/${ID}/cancel`, "none"],
  ["rsvp", "/rsvp/pass", "none"],
  ["reserve", "/reserve/brand/confirm", "none"],
  ["bearer ticket", "/g/token", "none"],
  ["order receipt", `/o/${ID}`, "none"],
  ["enquiry thread", "/m/token", "none"],
  ["invite", "/invite/abc", "none"],
  ["accept invitation", "/accept-brand-invitation", "none"],
  ["door", `/event/${ID}/door`, "none"],
  ["door sell", `/event/${ID}/door/sell`, "none"],
  ["scanner", `/event/${ID}/scanner`, "none"],
  ["event preview", `/event/${ID}/preview`, "none"],
  ["event wizard (own rail)", "/event/create", "none"],
  ["event edit wizard (own rail)", `/event/${ID}/edit`, "none"],
  ["trip wizard (own rail)", "/trip/create", "none"],
  ["rsvp wizard (own rail)", `/rsvp/${ID}/edit`, "none"],
  ["rsvp create wizard (own rail)", "/rsvp/create", "none"],
  ["rsvp scanner", `/rsvp/${ID}/scanner`, "none"],
  ["rsvp preview", `/rsvp/${ID}/preview`, "none"],
];

describe("#4420 B6 — HostDesktopShell route table", () => {
  test.each(TABLE.map(([group, pathname, expected]) => [group, pathname, expected]))(
    "%s (%s) → %s",
    (_group, pathname, expected) => {
      expect(hostDesktopShellModeFor(pathname, outside)).toBe(expected);
    },
  );

  test("(tabs) routes are left to the (tabs) layout, which mounts the same sidebar", () => {
    for (const p of ["/home", "/hub/events", "/marketing/campaigns", "/account", "/ari"]) {
      expect(hostDesktopShellModeFor(p, ["(tabs)", p.slice(1)])).toBe("tabs");
    }
  });

  test("a query string never changes the answer", () => {
    expect(hostDesktopShellModeFor(`/event/${ID}?tab=orders`, outside)).toBe("sidebar");
    expect(hostDesktopShellModeFor("/checkout/x?step=pay", outside)).toBe("none");
  });
});
