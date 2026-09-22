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
// matches AASA components EXACTLY, so the consumer app claims only
// `/attendance/claim` and its subpath — it has no other `/attendance/` route to
// answer for, and claiming a family it cannot serve is how a Universal Link
// opens an app that then shows nothing.
//
// Both lists are pinned here rather than derived from each other, so a later
// change that widens the iOS claim to `/attendance/*`, or narrows the Android
// one, is a RED gate rather than a silent drift. The Host app gains nothing:
// `/attendance/` is a buyer route and stays off its side of this file.
const CONSUMER_ANDROID_EXTRA = ["/attendance/"];
const CONSUMER_AASA_EXTRA = ["/attendance/claim", "/attendance/claim/*"];
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
  const consumerPrefixes = consumerHost.map((item) => item.pathPrefix).sort();
  if (!same(consumerPrefixes, [...CONSUMER, ...CONSUMER_ANDROID_EXTRA].sort())) {
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
  if (allNative.some((item) => item.host === HOST && !item.path && !item.pathPrefix)) {
    fail("Host catch-all app claim is forbidden");
  }
  if (BROWSER_ONLY.some((route) => allNative.some((item) =>
    item.path === route || item.pathPrefix?.startsWith(`${route}/`) || item.pathPrefix === route))) {
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
  const consumerAasa = consumerDetail?.components?.map((item) => item["/"]).sort() ?? [];
  const expectedHostAasa = OPERATOR.flatMap((route) => [route, `${route}/*`]).sort();
  if (!same(hostAasa, expectedHostAasa)) fail("Host AASA ownership drifted");
  if (!same(
    consumerAasa,
    [...CONSUMER.map((route) => `${route}*`), ...CONSUMER_AASA_EXTRA].sort(),
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

if (process.argv.includes("--self-test")) {
  const good = load();
  validate(...good);
  const mutations = [
    (c) => c.expo.android.intentFilters[1].data.push({ scheme: "https", host: HOST }),
    (_, h) => h.expo.android.intentFilters[0].data[1].pathPrefix = "/accept-brand-invitation",
    (_, h) => h.expo.android.intentFilters[0].data.push({ scheme: "https", host: HOST, pathPrefix: "/pay/" }),
    (c) => c.expo.android.intentFilters[1].data.pop(),
    (_, __, a) => a.applinks.details[0].components.pop(),
    // #3524 — the attendance claim disappearing from either platform must be
    // RED, not a quiet half-shipped handoff.
    (c) => {
      const data = c.expo.android.intentFilters[1].data;
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
