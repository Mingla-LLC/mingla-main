/**
 * #4514 (decision 11, contract C3): brand form links belong to the EXPLORER
 * app; until it opens them, the web page offers "Open in the Explorer app".
 * The Host app serves a `/form` route, so #2180 T-7 lists the segment in
 * SERVED_ROUTE_SEGMENTS. Serving is not claiming: the claims (AASA, Android
 * intent filters) leave /form out, proved by test (e) in
 * .github/scripts/strict-grep/__tests__/i-aasa-claims-match-native-routes.test.mjs.
 *
 * Here: a /form link the OS or the app itself hands to the Host app routes to
 * the form page instead of falling to Home, and an unowned host still lands on
 * Home.
 */
import { redirectSystemPath, __test__ as intent } from "../app/+native-intent";

describe("#4514 the Host app serves (never claims) brand form links", () => {
  it("a /form link the app IS handed routes to the form page instead of Home", () => {
    const link = "mingla-business://form/7f1c2a9e-1111-4111-8111-111111111111#t=abc";
    expect(redirectSystemPath({ path: link, initial: true })).toBe(link);
    const web = "https://host.usemingla.com/form/7f1c2a9e-1111-4111-8111-111111111111";
    expect(redirectSystemPath({ path: web, initial: false })).toBe(web);
    expect(intent.SERVED_ROUTE_SEGMENTS.has("form")).toBe(true);
  });

  it("an unowned host still lands on Home", () => {
    expect(redirectSystemPath({ path: "https://usemingla.com/form/x", initial: true })).toBe("/");
    expect(redirectSystemPath({ path: "https://evil.example/form/x", initial: true })).toBe("/");
  });
});
