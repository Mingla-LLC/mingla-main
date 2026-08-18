/**
 * #2180 [get-app link opens the installed app and strands the user]
 * TESTER-OWNED adversarial regression suite.
 *
 * DIFFERENT ANGLE from the implementor's happy-path suite
 * (`issue_2180_native_intent.implementor.happy.test.ts`), which validates the
 * R-1..R-7 contract against whatever `URL` the test runner happens to provide —
 * i.e. **Node's** spec-complete, IDNA-folding `URL`.
 *
 * The device does not run that parser. `expo` installs
 * `whatwg-url-without-unicode` as the global `URL` on native
 * (`expo/src/winter/runtime.native.ts`), which is the SAME WHATWG algorithm with
 * the **Unicode/IDNA layer removed**. That is a real behavioural fork on the
 * security-critical line of this fix — `OWNED_LINK_HOSTS.has(url.hostname)`.
 *
 * Measured divergence (tester, 2026-08-18, `whatwg-url-without-unicode@8.0.0-3`):
 *
 *   input                                   Node URL              device URL
 *   https://ｂiz.usemingla.com/e/a/b         passes through        "/"
 *   https://biz。usemingla。com/e/a/b         passes through        "/"
 *
 * Both are cases where Node's IDNA mapping folds the lookalike codepoint back to
 * the genuine owned host, so Node's pass-through is correct; the device parser
 * simply cannot fold and therefore refuses. The divergence is real but it points
 * in the SAFE direction (fail-closed).
 *
 * These tests pin that direction. The invariant they defend is not "the two
 * parsers agree" — they demonstrably do not — it is:
 *
 *   **No input may reach a real in-app route under the DEVICE parser that the
 *   Node parser would have blocked.** A future dependency bump that starts
 *   folding hostnames differently, or a refactor that reaches for
 *   `endsWith`/`includes`/regex on the raw URL, breaks this and is caught here
 *   rather than in production.
 *
 * Plus three angles the happy-path suite does not take at all:
 *   A-2  exhaustive over-blocking sweep — EVERY served segment, not a spot check.
 *        Over-blocking is the risk SPEC §7 names as "the single biggest risk in
 *        this change"; the implementor's T-3 checks a hand-picked subset.
 *   A-3  idempotence — `f(f(x)) === f(x)`.
 *   A-4  a NUMERIC layout budget for the 404 column on the smallest supported
 *        screen. T-9 asserts STRUCTURE (the footer is a sibling); this asserts
 *        the fixed-height arithmetic still fits 375x667, which is what actually
 *        went wrong (#2180's logo laid out at 2000 pt).
 */

import { createRequire } from "node:module";

import {
  redirectSystemPath as businessRedirect,
  __test__ as business,
} from "../app/+native-intent";
import {
  redirectSystemPath as consumerRedirect,
  __test__ as consumer,
} from "../../app-mobile/app/+native-intent";

const cold = (path: string): { path: string; initial: boolean } => ({
  path,
  initial: true,
});

/**
 * The exact `URL` implementation that ships on device. Resolved from this app's
 * real `node_modules` so a dependency change is visible to this test.
 */
const deviceRequire = createRequire(require.resolve("expo/package.json"));
const DeviceURL: typeof URL = deviceRequire(
  "whatwg-url-without-unicode",
).URL as typeof URL;

/** Run `fn` with the global `URL` swapped for the on-device implementation. */
function underDeviceURL<T>(fn: () => T): T {
  const saved = globalThis.URL;
  (globalThis as { URL: typeof URL }).URL = DeviceURL;
  try {
    return fn();
  } finally {
    (globalThis as { URL: typeof URL }).URL = saved;
  }
}

/**
 * Everything a hostile or malformed link could look like. Each MUST resolve to
 * "/" — under BOTH parsers. `+native-intent` is the only thing standing between
 * an attacker-chosen URL and expo-router's origin-stripping route lookup.
 */
const SPOOFING_VECTORS = [
  // userinfo — the classic. Real host is `evil.example`.
  "https://biz.usemingla.com@evil.example/e/acme/party",
  "https://go.usemingla.com@evil.example/e/acme/party",
  "https://biz.usemingla.com:anything@evil.example/e/a/b",
  // suffix / prefix confusion — would defeat `endsWith` / `includes`.
  "https://biz.usemingla.com.evil.example/e/a/b",
  "https://evil.example.biz.usemingla.com.evil.example/e/a/b",
  "https://notbiz.usemingla.com/e/a/b",
  "https://biz.usemingla.comevil.example/e/a/b",
  // the owned host smuggled into a query, a fragment, or a path.
  "https://evil.example/?u=biz.usemingla.com/e/a/b",
  "https://evil.example/#biz.usemingla.com/e/a/b",
  "https://evil.example//biz.usemingla.com/e/a/b",
  "https://evil.example/biz.usemingla.com/e/a/b",
  // backslash authority confusion.
  "https://biz.usemingla.com\\@evil.example/e/a/b",
  // IDN / punycode lookalikes.
  "https://xn--bz-eja.usemingla.com/e/a/b",
  "https://biѕ.usemingla.com/e/a/b", // U+0455 CYRILLIC DZE
  "https://bız.usemingla.com/e/a/b", // U+0131 DOTLESS I
  // trailing dot — an absolute-FQDN spelling of the owned host. Deliberately
  // NOT normalised away by the fix, so it must fail closed.
  "https://biz.usemingla.com./e/acme/party",
  "https://go.usemingla.com./e/acme/party",
  // plain foreign hosts.
  "https://evil.example/e/acme/party",
  "https://usemingla.com.attacker.io/e/a/b",
  "http://localhost:8081/e/acme/party",
  "https://127.0.0.1/e/acme/party",
];

describe("#2180 A-1 — the host check holds under the DEVICE URL parser, not just Node's", () => {
  it("is actually running a different URL implementation than the ambient one", () => {
    // Guards against this whole suite silently degrading into a duplicate of the
    // implementor's, which is what would happen if the resolve started handing
    // back Node's own URL. A test that cannot fail carries no information.
    expect(DeviceURL).toBeDefined();
    expect(DeviceURL).not.toBe(globalThis.URL);
    expect(
      deviceRequire("whatwg-url-without-unicode/package.json").version,
    ).toMatch(/^8\./);
  });

  it("sends every spoofing vector to / in the business app under the device parser", () => {
    underDeviceURL(() => {
      for (const vector of SPOOFING_VECTORS) {
        expect({ vector, out: businessRedirect(cold(vector)) }).toEqual({
          vector,
          out: "/",
        });
      }
    });
  });

  it("sends every spoofing vector to / in the consumer app under the device parser", () => {
    underDeviceURL(() => {
      for (const vector of SPOOFING_VECTORS) {
        expect({ vector, out: consumerRedirect(cold(vector)) }).toEqual({
          vector,
          out: "/",
        });
      }
    });
  });

  it("never lets the device parser pass something the Node parser blocks", () => {
    // THE core invariant. Divergence between the two parsers is tolerated in the
    // fail-closed direction only.
    const probes = [
      ...SPOOFING_VECTORS,
      "https://ｂiz.usemingla.com/e/a/b",
      "https://biz。usemingla。com/e/a/b",
      "https://BIZ.USEMINGLA.COM/e/acme/party",
      "https://biz.usemingla.com:443/e/acme/party",
      "https://host.usemingla.com/e/acme/party?ref=x#frag",
      "https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_nav",
    ];
    for (const probe of probes) {
      const node = businessRedirect(cold(probe));
      const device = underDeviceURL(() => businessRedirect(cold(probe)));
      if (node === "/") {
        expect({ probe, device }).toEqual({ probe, device: "/" });
      }
    }
  });

  it("still resolves the #2180 CTA to / under the device parser", () => {
    underDeviceURL(() => {
      expect(
        businessRedirect(
          cold("https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_nav"),
        ),
      ).toBe("/");
      expect(
        consumerRedirect(
          cold("https://go.usemingla.com/w36m?pid=mingla_web&c=explorer_nav"),
        ),
      ).toBe("/");
    });
  });

  it("still passes real deep links through byte-for-byte under the device parser", () => {
    underDeviceURL(() => {
      const link = "https://host.usemingla.com/e/acme/party?ref=x#frag";
      expect(businessRedirect(cold(link))).toBe(link);
      expect(consumerRedirect(cold(link))).toBe(link);
      const stripe =
        "https://host.usemingla.com/connect-onboarding?client_secret=REDACTED_FIXTURE_C";
      expect(businessRedirect(cold(stripe))).toBe(stripe);
      expect(businessRedirect(cold(stripe))).toContain("REDACTED_FIXTURE_C");
    });
  });
});

describe("#2180 A-2 — exhaustive over-blocking sweep (SPEC §7: the single biggest risk)", () => {
  const sweep = (
    redirect: typeof businessRedirect,
    segments: ReadonlySet<string>,
    hosts: ReadonlySet<string>,
  ): void => {
    expect(segments.size).toBeGreaterThan(5); // never vacuous
    expect(hosts.size).toBeGreaterThan(1);
    for (const host of hosts) {
      for (const segment of segments) {
        for (const tail of ["", "/acme", "/acme/party?ref=1#f"]) {
          const link = `https://${host}/${segment}${tail}`;
          expect({ link, out: redirect(cold(link)) }).toEqual({
            link,
            out: link,
          });
        }
      }
    }
  };

  it("passes through EVERY served business segment on EVERY owned business host", () => {
    sweep(
      businessRedirect,
      business.SERVED_ROUTE_SEGMENTS,
      business.OWNED_LINK_HOSTS,
    );
  });

  it("passes through EVERY served consumer segment on EVERY owned consumer host", () => {
    sweep(
      consumerRedirect,
      consumer.SERVED_ROUTE_SEGMENTS,
      consumer.OWNED_LINK_HOSTS,
    );
  });

  it("passes through EVERY served segment over the owned custom schemes too (R-6)", () => {
    for (const scheme of business.OWNED_LINK_SCHEMES) {
      for (const segment of business.SERVED_ROUTE_SEGMENTS) {
        const link = `${scheme}://${segment}/acme?x=1`;
        expect({ link, out: businessRedirect(cold(link)) }).toEqual({
          link,
          out: link,
        });
      }
    }
    for (const scheme of consumer.OWNED_LINK_SCHEMES) {
      for (const segment of consumer.SERVED_ROUTE_SEGMENTS) {
        const link = `${scheme}://${segment}/acme?x=1`;
        expect({ link, out: consumerRedirect(cold(link)) }).toEqual({
          link,
          out: link,
        });
      }
    }
  });
});

describe("#2180 A-3 — the redirect is idempotent", () => {
  it("f(f(x)) === f(x) for every vector, both apps", () => {
    const probes = [
      ...SPOOFING_VECTORS,
      "https://biz.usemingla.com/ZSCW?pid=mingla_web&c=business_nav",
      "https://go.usemingla.com/w36m?pid=mingla_web&c=explorer_nav",
      "https://host.usemingla.com/e/acme/party?ref=x#frag",
      "https://host.usemingla.com/connect-onboarding?client_secret=S",
      "mingla-business://connect-onboarding?client_secret=S",
      "/e/acme/party",
      "/",
    ];
    for (const redirect of [businessRedirect, consumerRedirect]) {
      for (const probe of probes) {
        const once = redirect(cold(probe));
        const twice = redirect(cold(once));
        expect({ probe, once, twice }).toEqual({ probe, once, twice: once });
      }
    }
  });
});

describe("#2180 A-4 — the 404 column still fits the smallest supported screen", () => {
  /**
   * The defect that made #2180 terminal was arithmetic, not structure: the logo
   * laid out at 2000 pt on an 852 pt screen and pushed the only exit to y~1478.
   * T-9 pins the STRUCTURE (footer is a sibling of the centred region). This
   * pins the NUMBERS, so a future "make the logo bigger" cannot quietly eat the
   * screen even though the structure is still correct.
   *
   * iPhone SE (3rd gen) — the smallest supported device — is 375 x 667 pt with a
   * 20 pt status-bar inset and no home-indicator inset.
   */
  const SCREEN_H = 667;
  const TOP_INSET = 20;
  const BOTTOM_INSET = 0;

  const readStyleNumber = (
    file: string,
    styleKey: string,
    prop: string,
  ): number | undefined => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
    const block = new RegExp(`${styleKey}:\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(
      src,
    );
    if (!block) return undefined;
    const m = new RegExp(`\\b${prop}:\\s*(\\d+(?:\\.\\d+)?)\\b`).exec(block[1]);
    return m ? Number(m[1]) : undefined;
  };

  it.each([
    ["business", "../app/+not-found.tsx"],
    ["consumer", "../../app-mobile/app/+not-found.tsx"],
  ])(
    "%s 404 fits 375x667 with the exit fully on-screen",
    (_label, file: string) => {
      const logoH = readStyleNumber(file, "logo", "height");
      expect(typeof logoH).toBe("number"); // fails if height is dropped again

      // Fixed, non-scaling chrome. Text lineHeights are Dynamic-Type-scalable
      // and live inside the clipped `content` region, so they are deliberately
      // excluded — the exit's visibility must not depend on them.
      const HEADING_LH = 30;
      const SUBTEXT_LH = 22;
      const GAP = 16; // spacing.md, 3 gaps in the centred column
      const LG = 24; // spacing.lg
      const BUTTON_H = 44; // SIZE_HEIGHT.md / touchTargets.minimum

      const centred =
        (logoH as number) + LG + HEADING_LH + SUBTEXT_LH + LG + GAP * 2;
      const footer = BUTTON_H + LG;
      const available = SCREEN_H - TOP_INSET - BOTTOM_INSET;

      expect({ file, centred, footer, total: centred + footer, available }).
        toEqual({
          file,
          centred,
          footer,
          total: centred + footer,
          available,
        });
      expect(centred + footer).toBeLessThanOrEqual(available);
      // And the footer alone must always fit even if the centred region were
      // to consume everything it can.
      expect(footer).toBeLessThan(available);
    },
  );

  it("no brand logo on either 404 is large enough to cover the smallest screen", () => {
    for (const file of ["../app/+not-found.tsx", "../../app-mobile/app/+not-found.tsx"]) {
      const h = readStyleNumber(file, "logo", "height");
      const w = readStyleNumber(file, "logo", "width");
      expect({ file, hIsNumber: typeof h, wIsNumber: typeof w }).toEqual({
        file,
        hIsNumber: "number",
        wIsNumber: "number",
      });
      expect(h as number).toBeLessThan(SCREEN_H - TOP_INSET - 44);
      expect(w as number).toBeLessThanOrEqual(375);
    }
  });
});
