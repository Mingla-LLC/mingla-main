/**
 * #2180 [get-app link opens the installed app and strands the user]
 * Implementor happy-path regression suite — SPEC §7, T-1..T-7, T-10, T-11.
 *
 * Covers BOTH apps' `+native-intent.tsx` from this one suite on purpose. The
 * `mingla-business jest (full suite)` gate is the only auto-globbing test gate in
 * the repo — `app-mobile` has no equivalent, every consumer suite is wired by a
 * hand-written per-issue workflow. Importing the consumer module from here is the
 * established pattern for exactly this reason (see the `#1560` note in
 * `jest.config.cjs`, which is why `diagnostics.exclude` already carries
 * `**\/app-mobile\/**`), and it means these assertions are enforced by a REQUIRED
 * check rather than sitting dark.
 *
 * What these guard: the router used to hand `https://biz.usemingla.com/ZSCW` to
 * expo-router, which strips the origin with no domain allowlist, matched nothing,
 * and dead-ended the user on a screen whose only exit was off-screen.
 */

import fs from "node:fs";
import path from "node:path";

import { redirectSystemPath as businessRedirect, __test__ as business } from "../app/+native-intent";
import {
  redirectSystemPath as consumerRedirect,
  __test__ as consumer,
} from "../../app-mobile/app/+native-intent";

/** expo-router always supplies `initial`; these tests exercise both call sites. */
const cold = (path: string): { path: string; initial: boolean } => ({ path, initial: true });
const warm = (path: string): { path: string; initial: boolean } => ({ path, initial: false });

const BUSINESS_APP_DIR = path.resolve(__dirname, "../app");
const CONSUMER_APP_DIR = path.resolve(__dirname, "../../app-mobile/app");

describe("#2180 T-1 — the Host get-app CTA is not a route", () => {
  const CTA = "https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_nav";

  it("resolves the production CTA to / on a cold start", () => {
    expect(businessRedirect(cold(CTA))).toBe("/");
  });

  it("resolves the production CTA to / on a warm foreground link (SC-5)", () => {
    expect(businessRedirect(warm(CTA))).toBe("/");
  });

  it("resolves the bare template id and any deeper path under it to /", () => {
    expect(businessRedirect(cold("https://biz.usemingla.com/ZSCW"))).toBe("/");
    expect(businessRedirect(cold("https://biz.usemingla.com/ZSCW/deeper"))).toBe("/");
    expect(businessRedirect(cold("https://biz.usemingla.com/anything-at-all"))).toBe("/");
  });

  it("resolves an owned host with an empty path to / (R-4)", () => {
    expect(businessRedirect(cold("https://biz.usemingla.com"))).toBe("/");
    expect(businessRedirect(cold("https://biz.usemingla.com/"))).toBe("/");
  });
});

describe("#2180 T-2 — the Explorer get-app CTA is not a route", () => {
  const CTA = "https://go.usemingla.com/w36m?pid=mingla_web&c=explorer_nav";

  it("resolves the production CTA to / on a cold start", () => {
    expect(consumerRedirect(cold(CTA))).toBe("/");
  });

  it("resolves the production CTA to / on a warm foreground link (SC-5)", () => {
    expect(consumerRedirect(warm(CTA))).toBe("/");
  });

  it("resolves an owned host with an empty path to / (R-4)", () => {
    expect(consumerRedirect(cold("https://go.usemingla.com/"))).toBe("/");
  });
});

describe("#2180 T-3 — real deep links pass through byte-for-byte (SC-3)", () => {
  it("preserves an event link with query and fragment in both apps", () => {
    const link = "https://host.usemingla.com/e/acme/party?ref=x#frag";
    expect(businessRedirect(cold(link))).toBe(link);
    expect(consumerRedirect(cold(link))).toBe(link);
  });

  it("preserves the other public offering families", () => {
    for (const link of [
      "https://host.usemingla.com/t/acme/rome-trip?utm=abc",
      "https://host.usemingla.com/b/acme",
      "https://host.usemingla.com/exp/acme/dive",
    ]) {
      expect(businessRedirect(cold(link))).toBe(link);
      expect(consumerRedirect(cold(link))).toBe(link);
    }
  });

  it("preserves the business-only route families the consumer app does not serve", () => {
    // These are real business routes; the derived allowlist must contain them.
    // Copying the SPEC's shorter pasted list would have sent every one to "/".
    for (const link of [
      "https://biz.usemingla.com/trip/123",
      "https://biz.usemingla.com/venue/abc",
      "https://biz.usemingla.com/stay/abc",
      "https://biz.usemingla.com/rsvp/1/preview",
      "https://biz.usemingla.com/refund/1",
      "https://biz.usemingla.com/reserve/1",
      "https://biz.usemingla.com/insights",
      "https://biz.usemingla.com/support",
      "https://biz.usemingla.com/partner/x",
      "https://biz.usemingla.com/experience/x",
      "https://biz.usemingla.com/o/x",
      "https://biz.usemingla.com/home",
      "https://biz.usemingla.com/hub/x",
      "https://biz.usemingla.com/marketing/x",
      "https://biz.usemingla.com/people/x",
      "https://biz.usemingla.com/analytics",
    ]) {
      expect(businessRedirect(cold(link))).toBe(link);
    }
  });

  it("preserves a custom-scheme deep link (R-6)", () => {
    const biz = "mingla-business://connect-onboarding?client_secret=REDACTED_FIXTURE";
    expect(businessRedirect(cold(biz))).toBe(biz);
    const consumerLink = "com.mingla.app.v2://e/acme/party";
    expect(consumerRedirect(cold(consumerLink))).toBe(consumerLink);
  });

  it("sends a custom-scheme URL on an unserved segment to /", () => {
    expect(businessRedirect(cold("com.sethogieva.minglabusiness://ZSCW"))).toBe("/");
  });
});

describe("#2180 T-4 — credential-bearing routes keep their URL credential", () => {
  it("returns a Stripe connect-onboarding link untouched, client_secret intact", () => {
    const link = "https://host.usemingla.com/connect-onboarding?client_secret=REDACTED_FIXTURE";
    const out = businessRedirect(cold(link));
    expect(out).toBe(link);
    expect(out).toContain("client_secret=REDACTED_FIXTURE");
  });

  it("returns the self-authenticating accept-* links untouched", () => {
    for (const link of [
      "https://host.usemingla.com/accept-brand-invitation?token=REDACTED_FIXTURE_A",
      "https://host.usemingla.com/accept-scanner-invitation?token=REDACTED_FIXTURE_B",
      "https://host.usemingla.com/stripe-onboarding-return?acct=acct_1",
      "https://host.usemingla.com/connect-tax-registrations?x=1",
    ]) {
      expect(businessRedirect(cold(link))).toBe(link);
    }
  });
});

describe("#2180 T-5 — a foreign or spoofed host cannot drive navigation (SC-6)", () => {
  const SPOOFS = [
    "https://biz.usemingla.com@evil.example/ZSCW",
    "https://biz.usemingla.com@evil.example/e/acme/party",
    "https://evil.example/?u=biz.usemingla.com",
    "https://biz.usemingla.com.evil.example/x",
    "https://biz.usemingla.com.evil.example/e/acme/party",
    "https://evil.example/e/acme/party",
    // trailing-dot host: deliberately NOT normalised, so it cannot reach a route
    "https://biz.usemingla.com./e/acme/party",
    "https://go.usemingla.com./e/acme/party",
    // punycode / IDN lookalike
    "https://xn--bz-fka.usemingla.com/e/acme/party",
    // a scheme neither app owns
    "javascript://host.usemingla.com/e/acme/party",
    "com.mingla.app.v2://e/acme/party",
  ];

  it("sends every spoofing vector to / in the business app", () => {
    for (const link of SPOOFS) {
      expect(businessRedirect(cold(link))).toBe("/");
    }
  });

  it("sends foreign hosts to / in the consumer app", () => {
    for (const link of [
      "https://go.usemingla.com@evil.example/e/acme/party",
      "https://evil.example/?u=go.usemingla.com",
      "https://go.usemingla.com.evil.example/e/acme/party",
      "https://biz.usemingla.com/e/acme/party",
    ]) {
      expect(consumerRedirect(cold(link))).toBe("/");
    }
  });

  it("still accepts a legitimate uppercase host and an explicit port", () => {
    // URL lower-cases the hostname and excludes the port, so these are the SAME
    // owned host and must keep working.
    expect(businessRedirect(cold("https://HOST.USEMINGLA.COM/e/a/b"))).toBe(
      "https://HOST.USEMINGLA.COM/e/a/b",
    );
    expect(businessRedirect(cold("https://host.usemingla.com:443/e/a/b"))).toBe(
      "https://host.usemingla.com:443/e/a/b",
    );
  });
});

describe("#2180 T-6 — claimed-but-unrouted consumer link families resolve to /", () => {
  it("sends /invite, /board, /orders and /chat to / rather than the Unmatched view", () => {
    // All four are claimed in app-mobile/app.json's Android intent filters and
    // have NO route in app-mobile/app/. They must NOT be added to the allowlist.
    for (const link of [
      "https://usemingla.com/invite/abc",
      "https://usemingla.com/board/1",
      "https://usemingla.com/orders/1",
      "https://usemingla.com/chat/1",
    ]) {
      expect(consumerRedirect(cold(link))).toBe("/");
    }
  });

  it("keeps the consumer families that DO have routes working", () => {
    for (const link of [
      "https://usemingla.com/b/acme",
      "https://usemingla.com/p/xyz",
      "https://usemingla.com/s/abc",
    ]) {
      expect(consumerRedirect(cold(link))).toBe(link);
    }
  });
});

/**
 * T-7 — the anti-drift gate. Enumerates the REAL `app/` tree and compares it with
 * the hand-maintained constant. Adding a route without adding its segment would
 * otherwise silently start sending a real link to "/".
 *
 * This enumerator is written independently of the constant on purpose: sharing a
 * derivation helper with the source would make the assertion tautological.
 */
function enumerateRouteSegments(dir: string): Set<string> {
  const out = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    // expo-router specials (`_layout`, `+html`, `+not-found`, `+native-intent`),
    // `__tests__` / `__styleguide`, and dotfiles are not routes.
    if (name.startsWith("_") || name.startsWith("+") || name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      // Group directories `(tabs)` are not a URL segment — recurse into them.
      if (/^\(.*\)$/.test(name)) {
        for (const seg of enumerateRouteSegments(path.join(dir, name))) out.add(seg);
      } else {
        out.add(name);
      }
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    const segment = name.slice(0, name.indexOf("."));
    // `index` IS "/", not a segment.
    if (segment === "" || segment === "index") continue;
    out.add(segment);
  }
  return out;
}

describe("#2180 T-7 — SERVED_ROUTE_SEGMENTS stays in sync with the route tree", () => {
  it("matches the real mingla-business/app tree exactly", () => {
    const onDisk = [...enumerateRouteSegments(BUSINESS_APP_DIR)].sort();
    const declared = [...business.SERVED_ROUTE_SEGMENTS].sort();
    expect(declared).toEqual(onDisk);
  });

  it("matches the real app-mobile/app tree exactly", () => {
    const onDisk = [...enumerateRouteSegments(CONSUMER_APP_DIR)].sort();
    const declared = [...consumer.SERVED_ROUTE_SEGMENTS].sort();
    expect(declared).toEqual(onDisk);
  });

  it("discovers a non-trivial number of routes (never passes vacuously)", () => {
    expect(enumerateRouteSegments(BUSINESS_APP_DIR).size).toBeGreaterThan(20);
    expect(enumerateRouteSegments(CONSUMER_APP_DIR).size).toBeGreaterThan(5);
  });

  it("pins the owned-host sets to app.json's claimed domains", () => {
    expect([...business.OWNED_LINK_HOSTS].sort()).toEqual([
      "biz.usemingla.com",
      "host.usemingla.com",
    ]);
    expect([...consumer.OWNED_LINK_HOSTS].sort()).toEqual([
      "go.usemingla.com",
      "host.usemingla.com",
      "usemingla.com",
    ]);
  });
});

describe("#2180 T-10 — malformed input never throws (R-7)", () => {
  const JUNK: unknown[] = [
    "",
    "https://",
    "http://",
    "://",
    "not a url",
    "%%%",
    null,
    undefined,
    123,
    {},
    [],
  ];

  it("always returns a string from the business app", () => {
    for (const value of JUNK) {
      const call = (): string =>
        businessRedirect({ path: value as string, initial: true });
      expect(call).not.toThrow();
      expect(typeof call()).toBe("string");
    }
  });

  it("always returns a string from the consumer app", () => {
    for (const value of JUNK) {
      const call = (): string =>
        consumerRedirect({ path: value as string, initial: false });
      expect(call).not.toThrow();
      expect(typeof call()).toBe("string");
    }
  });

  it("sends an unparseable absolute URL to / rather than onward", () => {
    expect(businessRedirect(cold("https://"))).toBe("/");
    expect(consumerRedirect(cold("https://"))).toBe("/");
  });
});

describe("#2180 T-11 — relative input is passed through unchanged (R-1)", () => {
  it("returns in-app paths untouched in both apps", () => {
    for (const relative of [
      "/e/acme/party",
      "/e/acme/party?ref=1#frag",
      "/",
      "/checkout/123/buyer",
    ]) {
      expect(businessRedirect(cold(relative))).toBe(relative);
      expect(consumerRedirect(cold(relative))).toBe(relative);
    }
  });

  it("does not mistake a relative path for an absolute URL", () => {
    // No `scheme:` prefix, so R-1 applies and the value is handed straight back.
    expect(businessRedirect(cold("/ZSCW"))).toBe("/ZSCW");
  });
});
