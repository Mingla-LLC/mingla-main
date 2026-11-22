#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOST = "host.usemingla.com";
const CONSUMER = ["/b/", "/e/", "/t/", "/exp/"];
// #3524 — the attendance-claim handoff, and the ONE place in this file where the
// two platforms are deliberately not mirror images.
//
// Android matches an intent filter BY PREFIX, so the consumer app declares the
// whole `/attendance/` family in the existing `host.usemingla.com` filter. iOS
// matches AASA components EXACTLY, so the consumer app claims `/attendance/claim`
// and ONLY that — claiming a family it cannot serve is how a Universal Link opens
// an app that then shows nothing.
//
// NO SUBPATH, and that follows from the same sentence. A fragment is not part of
// a path, so the exact component already matches the only URL anything mints:
// `/attendance/claim#<fragment>`. A subpath under it matches nothing that exists
// and `isAttendanceClaimUrl` does not recognise it, so claiming
// `/attendance/claim/*` would be claiming precisely such a family.
// scripts/issue-2245/declared-app-links-resolve.deno.test.ts drives the real
// modules and asserts it, which is the check that would have caught this list
// being wrong.
//
// Both lists are pinned here rather than derived from each other, so a later
// change that widens the iOS claim to `/attendance/*`, or narrows the Android
// one, is a RED gate rather than a silent drift. The Host app gains nothing:
// `/attendance/` is a buyer route and stays off its side of this file.
const CONSUMER_ANDROID_EXTRA = ["/attendance/", "/visit/waitlist/"];
const CONSUMER_AASA_EXTRA = ["/attendance/claim"];
// #4490 (spec 06 W1 item 4) — the Explorer app serves a guest's venue booking
// links: one booking (/visit/<id>), a waitlist place, a Stay booking, a venue
// order and a table booking's manage page. Android cannot exclude, so it claims
// id-shaped paths only (exactly one UUID: /visit/plan/… and /o/venue/… do not
// match); /reserve/<brand>/manage is the one /reserve page the app serves (the
// confirm and pay pages stay on the web). iOS lists the web-only pages first as
// exclusions. Pinned exactly, both platforms: a new pattern or a dropped
// exclusion is RED.
const UUID_PATTERN = "........-....-....-....-............";
const CONSUMER_ANDROID_PATTERNS = [
  `/visit/${UUID_PATTERN}`,
  `/stay/${UUID_PATTERN}`,
  `/o/${UUID_PATTERN}`,
  "/reserve/.*/manage.*",
];
const CONSUMER_AASA_4490 = [
  "exclude /visit/* ?paid",
  "exclude /visit/plan/*",
  "exclude /stay/pay/*",
  "exclude /reserve/*/confirm*",
  "exclude /o/venue/*",
  "/visit/*",
  "/stay/*",
  "/o/*",
  "/reserve/*/manage*",
];
const OPERATOR = [
  "/accept-brand-invitation",
  "/accept-scanner-invitation",
  "/connect-onboarding",
  "/connect-account-management",
  "/connect-partner-onboarding",
  "/connect-partner-account-management",
  "/connect-tax-registrations",
  "/stripe-onboarding-return",
];
const BROWSER_ONLY = ["/auth", "/pay", "/checkout", "/reserve", "/booking", "/oauth"];

const fail = (message) => { throw new Error(`[issue-2050] ${message}`); };
const same = (actual, expected) =>
  actual.length === expected.length && actual.every((value, i) => value === expected[i]);

export function validate(consumer, hostApp, aasa) {
  const consumerHost = consumer.expo.android.intentFilters
    .flatMap((filter) => filter.data ?? [])
    .filter((item) => item.host === HOST);
  const consumerPrefixes = consumerHost.map((item) => item.pathPrefix).filter(Boolean).sort();
  const consumerPatterns = consumerHost.map((item) => item.pathPattern).filter(Boolean).sort();
  if (
    !same(consumerPrefixes, [...CONSUMER, ...CONSUMER_ANDROID_EXTRA].sort()) ||
    !same(consumerPatterns, [...CONSUMER_ANDROID_PATTERNS].sort()) ||
    consumerHost.some((item) => [item.path, item.pathPrefix, item.pathPattern].filter(Boolean).length !== 1)
  ) {
    fail("consumer Android Host routes drifted");
  }

  const operatorHost = hostApp.expo.android.intentFilters
    .flatMap((filter) => filter.data ?? [])
    .filter((item) => item.host === HOST);
  const exact = operatorHost.map((item) => item.path).filter(Boolean).sort();
  const prefixes = operatorHost.map((item) => item.pathPrefix).filter(Boolean).sort();
  if (!same(exact, [...OPERATOR].sort())) fail("Host Android exact routes drifted");
  if (!same(prefixes, OPERATOR.map((route) => `${route}/`).sort())) {
    fail("Host Android segment-safe subroutes drifted");
  }

  const allNative = [...consumerHost, ...operatorHost];
  if (allNative.some((item) => item.host === HOST && !item.path && !item.pathPrefix && !item.pathPattern)) {
    fail("Host catch-all app claim is forbidden");
  }
  if (BROWSER_ONLY.some((route) => allNative.some((item) =>
    item.path === route || item.pathPrefix?.startsWith(`${route}/`) || item.pathPrefix === route))) {
    fail("browser-only route was claimed by a native app");
  }
  // #4490: a pattern claims a browser-only family only as the one pinned
  // consumer manage page (/reserve/<brand>/manage); anything else is RED.
  if (BROWSER_ONLY.some((route) => allNative.some((item) =>
    typeof item.pathPattern === "string" && item.pathPattern.startsWith(`${route}/`) &&
    !(consumerHost.includes(item) && item.pathPattern === "/reserve/.*/manage.*")))) {
    fail("browser-only route was claimed by a native app");
  }
  if ([...CONSUMER, ...CONSUMER_ANDROID_EXTRA].some((route) => OPERATOR.some((other) =>
    route.startsWith(`${other}/`) || other.startsWith(route)))) {
    fail("consumer and Host route families overlap");
  }

  const details = aasa.applinks.details;
  const hostDetail = details.find((detail) =>
    detail.appIDs?.includes("782KVMY869.com.sethogieva.minglabusiness"));
  const consumerDetail = details.find((detail) =>
    detail.appIDs?.includes("782KVMY869.com.mingla.app.v2"));
  const hostAasa = hostDetail?.components?.map((item) => item["/"]).sort() ?? [];
  // #4490: an exclusion reads "exclude <path>" (with " ?<query keys>" when it
  // matches on a query), so exclusions and claims are pinned apart.
  const aasaWord = (item) => {
    const query = item["?"] ? ` ?${Object.keys(item["?"]).sort().join(",")}` : "";
    return item.exclude === true ? `exclude ${item["/"]}${query}` : `${item["/"]}${query}`;
  };
  const consumerAasa = consumerDetail?.components?.map(aasaWord).sort() ?? [];
  const expectedHostAasa = OPERATOR.flatMap((route) => [route, `${route}/*`]).sort();
  if (!same(hostAasa, expectedHostAasa)) fail("Host AASA ownership drifted");
  if (!same(
    consumerAasa,
    [...CONSUMER.map((route) => `${route}*`), ...CONSUMER_AASA_EXTRA, ...CONSUMER_AASA_4490].sort(),
  )) {
    fail("consumer AASA ownership drifted");
  }

  const consumerDomains = consumer.expo.ios.associatedDomains ?? [];
  const hostDomains = hostApp.expo.ios.associatedDomains ?? [];
  if (!consumerDomains.includes(`applinks:${HOST}`) || !hostDomains.includes(`applinks:${HOST}`)) {
    fail("both apps must associate the Host domain");
  }
  if ([...consumerDomains, ...hostDomains].includes("applinks:business.usemingla.com")) {
    fail("retired Business associated domain remains");
  }
}

function load() {
  return [
    JSON.parse(fs.readFileSync(path.join(ROOT, "app-mobile/app.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(ROOT, "mingla-business/app.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(
      ROOT,
      "mingla-business/public/.well-known/apple-app-site-association",
    ), "utf8")),
  ];
}

// The consumer filter that carries the public Host links (found by its routes,
// not its index: #4490 W1 added the venue booking filter before it).
const consumerLinkFilter = (c) => c.expo.android.intentFilters.find((f) =>
  (f.data ?? []).some((d) => d.host === HOST && d.pathPrefix === "/b/"));

if (process.argv.includes("--self-test")) {
  const good = load();
  validate(...good);
  const mutations = [
    (c) => consumerLinkFilter(c).data.push({ scheme: "https", host: HOST }),
    (_, h) => h.expo.android.intentFilters[0].data[1].pathPrefix = "/accept-brand-invitation",
    (_, h) => h.expo.android.intentFilters[0].data.push({ scheme: "https", host: HOST, pathPrefix: "/pay/" }),
    (c) => consumerLinkFilter(c).data.pop(),
    (_, __, a) => a.applinks.details[0].components.pop(),
    // #3524 — the attendance claim disappearing from either platform must be
    // RED, not a quiet half-shipped handoff.
    (c) => {
      const data = consumerLinkFilter(c).data;
      const i = data.findIndex((item) => item.pathPrefix === "/attendance/");
      data.splice(i, 1);
    },
    (_, __, a) => {
      const consumer = a.applinks.details.find((detail) =>
        detail.appIDs?.includes("782KVMY869.com.mingla.app.v2"));
      consumer.components = consumer.components.filter((item) =>
        item["/"] !== "/attendance/claim");
    },
    // …and widening the iOS claim from the one route the app can serve to the
    // whole family must be RED too.
    (_, __, a) => {
      const consumer = a.applinks.details.find((detail) =>
        detail.appIDs?.includes("782KVMY869.com.mingla.app.v2"));
      consumer.components = consumer.components.map((item) =>
        item["/"].startsWith("/attendance/") ? { ...item, "/": "/attendance/*" } : item);
    },
    // #4490 — a widened Android pattern, a dropped iOS exclusion, or a pattern
    // claiming a browser-only family is RED.
    (c) => {
      const filter = c.expo.android.intentFilters.find((f) => (f.data ?? []).some((d) => d.pathPattern));
      filter.data.push({ scheme: "https", host: HOST, pathPattern: "/visit/.*" });
    },
    (c) => {
      const filter = c.expo.android.intentFilters.find((f) => (f.data ?? []).some((d) => d.pathPattern));
      filter.data = filter.data.filter((d) => d.pathPattern !== "/reserve/.*/manage.*");
    },
    (c) => {
      const filter = c.expo.android.intentFilters.find((f) => (f.data ?? []).some((d) => d.pathPattern));
      filter.data.push({ scheme: "https", host: HOST, pathPattern: "/checkout/.*" });
    },
    (_, __, a) => {
      const consumer = a.applinks.details.find((detail) =>
        detail.appIDs?.includes("782KVMY869.com.mingla.app.v2"));
      consumer.components = consumer.components.filter((item) =>
        !(item.exclude === true && item["/"] === "/visit/plan/*"));
    },
    (_, __, a) => {
      const consumer = a.applinks.details.find((detail) =>
        detail.appIDs?.includes("782KVMY869.com.mingla.app.v2"));
      consumer.components = consumer.components.map((item) =>
        item.exclude === true && item["/"] === "/visit/*" ? { ...item, "?": undefined } : item);
    },
    // The Host app must NOT acquire the buyer's attendance route.
    (_, h) => h.expo.android.intentFilters[0].data.push({
      scheme: "https", host: HOST, pathPrefix: "/attendance/",
    }),
  ];
  for (const mutate of mutations) {
    const fixture = structuredClone(good);
    mutate(...fixture);
    let rejected = false;
    try { validate(...fixture); } catch { rejected = true; }
    if (!rejected) fail("BAD fixture passed");
  }
  console.log(
    `PASS issue-2050 Host route ownership: GOOD + ${mutations.length} BAD fixtures`,
  );
} else {
  validate(...load());
  console.log("PASS issue-2050 Host route ownership");
}
