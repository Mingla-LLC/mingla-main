#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOST = "host.usemingla.com";
const CONSUMER = ["/b/", "/e/", "/t/", "/exp/"];
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
  if (!same(consumerPrefixes, [...CONSUMER].sort())) fail("consumer Android Host routes drifted");

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
  if (CONSUMER.some((route) => OPERATOR.some((other) =>
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
  if (!same(consumerAasa, CONSUMER.map((route) => `${route}*`).sort())) {
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
  ];
  for (const mutate of mutations) {
    const fixture = structuredClone(good);
    mutate(...fixture);
    let rejected = false;
    try { validate(...fixture); } catch { rejected = true; }
    if (!rejected) fail("BAD fixture passed");
  }
  console.log("PASS issue-2050 Host route ownership: GOOD + 5 BAD fixtures");
} else {
  validate(...load());
  console.log("PASS issue-2050 Host route ownership");
}
