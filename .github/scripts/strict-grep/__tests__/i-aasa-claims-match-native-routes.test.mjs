// ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — I-AASA-CLAIMS-MATCH-NATIVE-ROUTES
//
// Fails-on-revert JSON-shape guard for SPEC_ORCH-1318 §C.3 / §C.6 (DRAFT invariant
// I-AASA-CLAIMS-MATCH-NATIVE-ROUTES). Runs with zero dependencies:
//
//     node --test .github/scripts/strict-grep/__tests__/i-aasa-claims-match-native-routes.test.mjs
//
// It reads the REAL committed files across both app packages and proves:
//   (a) the consumer AASA appID block (782KVMY869.com.mingla.app.v2) claims
//       /b/*, /t/*, /exp/*  AND  app-mobile/app.json Android intentFilters carry
//       matching /t + /exp pathPrefix entries on business.usemingla.com;
//   (b) every path the consumer AASA claims has a real expo-router file route
//       under app-mobile/app/ — a stray claim (e.g. /z/*) with no screen behind
//       it FAILS (catches the inverse "dead Universal Link → 404" failure);
//   (c) the branded OneLink domain go.usemingla.com is wired in BOTH apps
//       (ios.associatedDomains + an autoVerify Android intentFilter) — §C.1.
//
// ORCH-1318 /e DEVIATION (Seth's decision): the consumer AASA intentionally does
// NOT claim /e/* on business.usemingla.com (avoids the /e dual-claim with the
// business app). Consumer /e content routes via the go.usemingla.com OneLink
// payload, not a raw host claim. So the required consumer set is {/b,/t,/exp}.
//
// Fails-on-revert matrix:
//   - delete /t/* (or /exp/*) from the consumer AASA block      -> test (a) fails
//   - delete the /t (or /exp) pathPrefix from app-mobile app.json -> test (a) fails
//   - add an unbacked claim (e.g. /z/*) to the consumer block    -> test (b) fails
//   - drop go.usemingla.com from either app's config             -> test (c) fails

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// __tests__ -> strict-grep -> scripts -> .github -> <repo root>
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const CONSUMER_APP_ID = "782KVMY869.com.mingla.app.v2";
const CONSUMER_HOST = "business.usemingla.com";
const ONELINK_DOMAIN = "go.usemingla.com";

// The consumer entity share-URL builders in publicUrls.ts emit /b, /t, /exp on
// business.usemingla.com; each MUST be claimed for the consumer app (§C.3). /e is
// deliberately excluded per the ORCH-1318 /e dual-claim deviation.
const REQUIRED_CONSUMER_AASA_PATHS = ["/b/*", "/t/*", "/exp/*"];
const REQUIRED_ANDROID_PATH_PREFIXES = ["/t", "/exp"]; // added by ORCH-1318 alongside existing /b

const readJson = (rel) => JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8"));

const loadAasa = () =>
  readJson("mingla-business/public/.well-known/apple-app-site-association");

const consumerBlock = (aasa) => {
  const block = aasa.applinks.details.find((d) =>
    (d.appIDs ?? []).includes(CONSUMER_APP_ID),
  );
  assert.ok(block, `AASA must contain the consumer appID block ${CONSUMER_APP_ID}`);
  return block;
};

// Every component object in this AASA uses the modern { "/": "/b/*" } form.
const claimedPaths = (block) =>
  (block.components ?? []).map((c) => c["/"]).filter((p) => typeof p === "string");

// "/exp/*" -> "exp" ; "/b/*" -> "b" ; "/connect-onboarding" -> "connect-onboarding"
const routeSegment = (claimPath) =>
  claimPath.replace(/^\//, "").split("/")[0].replace(/\*/g, "");

// A claimed path is "backed" if a matching expo-router file route exists under
// app-mobile/app/ — either a directory (app/b/, app/t/, app/exp/, app/e/) or a
// leaf file (app/<seg>.tsx / .ts / <seg>/index.tsx).
const hasNativeRoute = (segment) => {
  const base = join(REPO_ROOT, "app-mobile", "app", segment);
  if (existsSync(base) && statSync(base).isDirectory()) return true;
  return [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].some(
    (p) => existsSync(p),
  );
};

test("(a) consumer AASA block claims /b/*, /t/*, /exp/*", () => {
  const paths = claimedPaths(consumerBlock(loadAasa()));
  for (const required of REQUIRED_CONSUMER_AASA_PATHS) {
    assert.ok(
      paths.includes(required),
      `consumer AASA appID block must claim ${required} (has: ${JSON.stringify(paths)})`,
    );
  }
});

test("(a) app-mobile Android intentFilters carry /t + /exp pathPrefix on business.usemingla.com (autoVerify)", () => {
  const filters = readJson("app-mobile/app.json").expo.android.intentFilters ?? [];
  for (const prefix of REQUIRED_ANDROID_PATH_PREFIXES) {
    const match = filters.some(
      (f) =>
        f.autoVerify === true &&
        (f.data ?? []).some(
          (d) =>
            d.scheme === "https" &&
            d.host === CONSUMER_HOST &&
            d.pathPrefix === prefix,
        ),
    );
    assert.ok(
      match,
      `app-mobile/app.json must declare an autoVerify https intentFilter for ${CONSUMER_HOST}${prefix}`,
    );
  }
});

test("(b) every consumer-AASA claimed path is backed by a real expo-router route (rejects a stray /z/*)", () => {
  const paths = claimedPaths(consumerBlock(loadAasa()));
  assert.ok(paths.length > 0, "consumer AASA block must claim at least one path");
  for (const claimPath of paths) {
    const seg = routeSegment(claimPath);
    assert.ok(
      hasNativeRoute(seg),
      `consumer AASA claims ${claimPath} but no expo-router route exists at app-mobile/app/${seg} — a claim with no screen is a dead Universal Link (404)`,
    );
  }
});

test("(c) branded OneLink domain go.usemingla.com is wired in BOTH apps (associatedDomains + autoVerify intentFilter)", () => {
  const apps = [
    { label: "consumer", rel: "app-mobile/app.json" },
    { label: "business", rel: "mingla-business/app.json" },
  ];
  for (const { label, rel } of apps) {
    const expo = readJson(rel).expo;

    const iosDomains = expo.ios?.associatedDomains ?? [];
    assert.ok(
      iosDomains.includes(`applinks:${ONELINK_DOMAIN}`),
      `${label} (${rel}) ios.associatedDomains must include applinks:${ONELINK_DOMAIN}`,
    );

    const filters = expo.android?.intentFilters ?? [];
    const hasOneLinkFilter = filters.some(
      (f) =>
        f.autoVerify === true &&
        (f.data ?? []).some((d) => d.scheme === "https" && d.host === ONELINK_DOMAIN),
    );
    assert.ok(
      hasOneLinkFilter,
      `${label} (${rel}) must declare an autoVerify https Android intentFilter for ${ONELINK_DOMAIN}`,
    );
  }
});
