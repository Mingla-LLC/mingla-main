/**
 * #1957 [unlisted-event-publish-opens-broken-public-page] — TESTER ADVERSARIAL.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE HAPPY-PATH TEST ────────────────────
 *
 * The implementor guard `issue1957EventHttpsAppLinks.test.ts` asserts the POSITIVE
 * shape: Consumer owns `/b/*`, `/e/*`, `/t/*`, `/exp/*` on `host.usemingla.com`, and
 * Host does not. That is the right assertion and it passes. It is also blind to every
 * way this fix can be silently un-shipped while continuing to print green.
 *
 * This file attacks the fix from the angles the happy-path test cannot see. Each
 * assertion below corresponds to a concrete, observed-in-the-wild failure mode, not a
 * hypothetical:
 *
 *   A1  OVERLAP BLINDNESS VIA THE `path` FORM. The happy-path helper `ownsAndroidPath`
 *       inspects ONLY `entry.pathPrefix`. Android intent filters accept `path`,
 *       `pathPrefix`, AND `pathPattern`, and a bare host entry with no path key at all
 *       claims the ENTIRE host. So a Host filter of `{host: "host.usemingla.com",
 *       path: "/e"}` — or one with no path key — takes co-ownership of the event route
 *       and is COMPLETELY INVISIBLE to the happy-path test, which would keep passing.
 *       Two apps verified for the same URL is not a tie the OS breaks in our favour;
 *       it is undefined routing.
 *
 *   A2  autoVerify WITH NO BACKING assetlinks.json. Android `autoVerify: true` is a
 *       REQUEST, not a grant. It only holds if the host actually serves an
 *       `assetlinks.json` naming the package. Declare a host the file does not back and
 *       verification fails silently — every link on that host falls through to the
 *       browser. That fall-through IS the #1957 symptom. `app.json` alone can never
 *       reveal this; it takes a cross-file check.
 *
 *   A3  ONE-SIDED PLATFORM CLAIM — THE ACTUAL #1957 BUG CLASS. The original defect was
 *       not "app links are broken." It was that `/e` was present in some places and
 *       missing in others, so the route worked on one surface and opened the browser on
 *       another. A guest path claimed in the iOS AASA but absent from the Android intent
 *       filters (or the reverse) reproduces exactly that asymmetry, and BOTH one-sided
 *       states satisfy the happy-path test's per-platform assertions.
 *
 *   A4  A DECLARED DOMAIN THE AASA DOES NOT BACK. Listing `applinks:<host>` in
 *       `associatedDomains` while the AASA that host serves never names the Consumer
 *       app ID is a no-op that reads as configured.
 *
 *   A5  NEGATION VIA `exclude`. AASA components are evaluated in order and a later
 *       component carrying `"exclude": true` CANCELS an earlier claim. The happy-path
 *       test only asserts the `/` string is present in the components array, so a claim
 *       plus its own exclusion passes it while shipping nothing.
 *
 *   A6  RETIRED-DOMAIN RESURRECTION. `business.usemingla.com` was retired by #2050.
 *       Its reappearance in the native config is how this fix gets pointed back at a
 *       dead target.
 *
 * ── THE FAILURE MODE THAT MOTIVATED A6 SPECIFICALLY ─────────────────────────────
 * This is not a theoretical worry about guards rotting. #1957's fix merged as PR #2039
 * and was rewritten roughly eight hours later by PR #2065 (the #2050 Host cutover),
 * which moved every one of these routes from `business.usemingla.com` to
 * `host.usemingla.com`. The rewrite was correct — but the signed physical Android
 * acceptance recorded on 2026-08-14 had been run against the retired domain, so a
 * genuine PASS became void without a single test turning red. Config that is asserted
 * only against itself cannot detect that it is describing something no longer served.
 *
 * ── FAILS-ON-REVERT ─────────────────────────────────────────────────────────────
 * Deleting the `/e/*` component from the Consumer AASA detail, or deleting the
 * `host.usemingla.com` + `/e/` Android data entry from `app-mobile/app.json`, makes A3
 * fail — those are the two halves of the #1957 fix. Verified by mutation; see the
 * issue comment for the recorded run.
 */

import fs from "node:fs";
import path from "node:path";

const CONSUMER_APP_ID = "782KVMY869.com.mingla.app.v2";
const CONSUMER_PACKAGE = "com.mingla.app.v2";
const HOST_APP_ID = "782KVMY869.com.sethogieva.minglabusiness";
const PUBLIC_HOST = "host.usemingla.com";
const RETIRED_HOST = "business.usemingla.com";

/** The four guest routes #1957 exists to keep in the Consumer app. */
const GUEST_ROUTES = ["/b", "/e", "/t", "/exp"] as const;

const repoRoot = path.resolve(__dirname, "../..");
const readJson = (relative: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf8"));

/**
 * Which repo directory serves which host's `.well-known/`. Any host the Consumer app
 * autoVerifies must appear here or in EXTERNALLY_SERVED_HOSTS — the point of A2 is that
 * a NEW host cannot be added without someone writing down who serves its assetlinks.
 */
const WELL_KNOWN_BY_HOST: Record<string, string> = {
  [PUBLIC_HOST]: "mingla-business/public/.well-known",
  "usemingla.com": "mingla-marketing/public/.well-known",
};

/**
 * Hosts whose `.well-known/` this repo deliberately does NOT serve.
 * `go.usemingla.com` is the AppsFlyer OneLink domain; AppsFlyer serves its
 * assetlinks/AASA from its own infrastructure, so absence here is correct, not a gap.
 */
const EXTERNALLY_SERVED_HOSTS = new Set(["go.usemingla.com"]);

type IntentData = {
  scheme?: string;
  host?: string;
  path?: string;
  pathPrefix?: string;
  pathPattern?: string;
};
type IntentFilter = {
  action?: string;
  autoVerify?: boolean;
  data?: IntentData[];
  category?: string[];
};
type AasaComponent = { "/"?: string; exclude?: boolean; comment?: string };

const consumerApp = readJson("app-mobile/app.json") as {
  expo: {
    ios: { associatedDomains?: string[] };
    android: { intentFilters?: IntentFilter[] };
  };
};
const hostApp = readJson("mingla-business/app.json") as {
  expo: {
    ios: { associatedDomains?: string[] };
    android: { intentFilters?: IntentFilter[] };
  };
};

const consumerFilters = consumerApp.expo.android.intentFilters ?? [];
const hostFilters = hostApp.expo.android.intentFilters ?? [];
const consumerDomains = consumerApp.expo.ios.associatedDomains ?? [];

/** Verified HTTPS data entries — the only ones Android will actually auto-verify. */
const verifiedHttpsData = (filters: IntentFilter[]): IntentData[] =>
  filters
    .filter(
      (filter) =>
        filter.action === "VIEW" &&
        filter.autoVerify === true &&
        filter.category?.includes("BROWSABLE") &&
        filter.category?.includes("DEFAULT"),
    )
    .flatMap((filter) => filter.data ?? [])
    .filter((entry) => entry.scheme === "https");

/**
 * A1's load-bearing helper: does this filter set claim `route` on `host` through ANY
 * path form — `path`, `pathPrefix`, `pathPattern`, or a bare host entry that swallows
 * the whole host? The happy-path test answers this for `pathPrefix` only.
 */
const claimsRouteAnyForm = (
  filters: IntentFilter[],
  host: string,
  route: string,
): boolean =>
  verifiedHttpsData(filters).some((entry) => {
    if (entry.host !== host) return false;
    const hasNoPathConstraint =
      entry.path === undefined &&
      entry.pathPrefix === undefined &&
      entry.pathPattern === undefined;
    if (hasNoPathConstraint) return true; // claims the entire host, route included
    const candidates = [entry.path, entry.pathPrefix, entry.pathPattern].filter(
      (value): value is string => typeof value === "string",
    );
    return candidates.some(
      (value) => value === route || value.startsWith(`${route}/`),
    );
  });

const aasaDetailFor = (relative: string, appId: string) => {
  const parsed = readJson(relative) as {
    applinks: { details: Array<Record<string, unknown>> };
  };
  return parsed.applinks.details.find((detail) => {
    const ids = detail.appIDs as string[] | undefined;
    const single = detail.appID as string | undefined;
    return ids?.includes(appId) || single === appId;
  });
};

const aasaComponents = (detail: Record<string, unknown> | undefined) =>
  (detail?.components as AasaComponent[] | undefined) ?? [];

const BUSINESS_AASA =
  "mingla-business/public/.well-known/apple-app-site-association";

describe("#1957 event HTTPS app links — tester adversarial", () => {
  it("A1: no Host claim co-owns a Consumer guest route through the path/pathPattern/bare-host forms the happy-path test cannot see", () => {
    for (const route of GUEST_ROUTES) {
      expect({
        route,
        coOwnedByHostApp: claimsRouteAnyForm(hostFilters, PUBLIC_HOST, route),
      }).toEqual({ route, coOwnedByHostApp: false });
    }
  });

  it("A2: every host the Consumer app autoVerifies is backed by an assetlinks.json naming the Consumer package", () => {
    const verifiedHosts = Array.from(
      new Set(
        verifiedHttpsData(consumerFilters)
          .map((entry) => entry.host)
          .filter((host): host is string => typeof host === "string"),
      ),
    ).sort();

    expect(verifiedHosts.length).toBeGreaterThan(0);

    for (const host of verifiedHosts) {
      if (EXTERNALLY_SERVED_HOSTS.has(host)) continue;

      const wellKnownDir = WELL_KNOWN_BY_HOST[host];
      // An unmapped host means someone added an autoVerify target without recording
      // who serves its assetlinks — exactly the silent browser-fallthrough of #1957.
      expect({ host, mapped: Boolean(wellKnownDir) }).toEqual({
        host,
        mapped: true,
      });

      const assetlinks = readJson(`${wellKnownDir}/assetlinks.json`) as Array<{
        target: { package_name: string };
      }>;
      const packages = assetlinks.map((entry) => entry.target.package_name);
      expect({ host, declares: packages.includes(CONSUMER_PACKAGE) }).toEqual({
        host,
        declares: true,
      });
    }
  });

  it("A3: every guest route is claimed on BOTH platforms or NEITHER — no one-sided claim (the #1957 bug class)", () => {
    const consumerAasaPaths = aasaComponents(
      aasaDetailFor(BUSINESS_AASA, CONSUMER_APP_ID),
    )
      .map((component) => component["/"])
      .filter((value): value is string => typeof value === "string");

    for (const route of GUEST_ROUTES) {
      const claimedOnIos = consumerAasaPaths.some(
        (value) => value === `${route}/*` || value === `${route}/`,
      );
      const claimedOnAndroid = claimsRouteAnyForm(
        consumerFilters,
        PUBLIC_HOST,
        route,
      );
      expect({ route, claimedOnIos, claimedOnAndroid }).toEqual({
        route,
        claimedOnIos: true,
        claimedOnAndroid: true,
      });
    }
  });

  it("A4: every repo-served applinks domain the Consumer declares is actually named by that domain's AASA", () => {
    const declaredHosts = consumerDomains
      .filter((entry) => entry.startsWith("applinks:"))
      .map((entry) => entry.slice("applinks:".length));

    expect(declaredHosts.length).toBeGreaterThan(0);

    for (const host of declaredHosts) {
      if (EXTERNALLY_SERVED_HOSTS.has(host)) continue;
      const wellKnownDir = WELL_KNOWN_BY_HOST[host];
      expect({ host, mapped: Boolean(wellKnownDir) }).toEqual({
        host,
        mapped: true,
      });

      const detail = aasaDetailFor(
        `${wellKnownDir}/apple-app-site-association`,
        CONSUMER_APP_ID,
      );
      expect({ host, backedByAasa: Boolean(detail) }).toEqual({
        host,
        backedByAasa: true,
      });
    }
  });

  it("A5: no AASA component negates a Consumer guest route via exclude", () => {
    const components = aasaComponents(
      aasaDetailFor(BUSINESS_AASA, CONSUMER_APP_ID),
    );
    const negated = components
      .filter((component) => component.exclude === true)
      .map((component) => component["/"]);
    expect(negated).toEqual([]);
  });

  it("A6: the retired business.usemingla.com does not reappear in native config or either served AASA", () => {
    const surfaces: Array<[string, string]> = [
      ["app-mobile/app.json", "app-mobile/app.json"],
      ["mingla-business/app.json", "mingla-business/app.json"],
      ["business AASA", BUSINESS_AASA],
      [
        "marketing AASA",
        "mingla-marketing/public/.well-known/apple-app-site-association",
      ],
    ];
    for (const [label, relative] of surfaces) {
      const raw = fs.readFileSync(path.join(repoRoot, relative), "utf8");
      expect({ label, mentionsRetiredHost: raw.includes(RETIRED_HOST) }).toEqual(
        { label, mentionsRetiredHost: false },
      );
    }
  });

  it("A7: Host and Consumer never both claim the same AASA component on the public host", () => {
    const consumerPaths = new Set(
      aasaComponents(aasaDetailFor(BUSINESS_AASA, CONSUMER_APP_ID))
        .map((component) => component["/"])
        .filter((value): value is string => typeof value === "string"),
    );
    const hostPaths = aasaComponents(aasaDetailFor(BUSINESS_AASA, HOST_APP_ID))
      .map((component) => component["/"])
      .filter((value): value is string => typeof value === "string");

    const overlap = hostPaths.filter((value) => consumerPaths.has(value));
    expect(overlap).toEqual([]);
  });
});
