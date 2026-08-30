/**
 * ORCH-1139 [stripe-connect-route-gate] — ROUTE-GATE CLOSURE invariant.
 *
 * Carries DRAFT invariant I-PROPOSED-1139-ROUTE-GATE-CLOSURE (flips ACTIVE at
 * CLOSE). Every top-level route under `mingla-business/app/` MUST be classified
 * into EXACTLY ONE bucket: gated-by-default, or one of the three exemption sets
 * (buyer / connect-seller / invite). A new route added to `app/` that is not
 * classified FAILS the build — converting "a new route silently inherits
 * redirect-to-sign-in" (the exact mechanism behind BOTH ORCH-1115 and ORCH-1139)
 * from a latent P0 into a CI failure.
 *
 * Mechanism:
 * 1. Enumerate top-level routes from the live `app/` dir: each `*.tsx`/`*.web.tsx`
 *    directly in `app/` (dedupe `.tsx`+`.web.tsx` pairs), plus each immediate
 *    SUBDIRECTORY (the dir name IS the route segment). Exclude Expo-router
 *    internals / dev-only files (`_layout`, `+html`, `+not-found`, `__styleguide`).
 * 2. Classify each route via membership in the actual exported constants:
 *    connect-exempt iff `/route` in SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
 *    invite-exempt iff in INVITE_ACCEPT_ROUTE_PREFIXES, buyer-exempt iff
 *    `/route/` in PUBLIC_BUYER_ROUTE_PREFIXES, else gated-default.
 * 3. Assert the live classification equals the SEEDED expected map (§5 inventory)
 *    AND every route lands in exactly one bucket.
 *
 * FAILS ON REVERT (T-C2): removing a connect prefix from the constant reclassifies
 * that route connect-exempt → gated-default, contradicting the expected map →
 * FAIL. Adding a new file to `app/` without seeding it here → the live
 * enumeration finds an unmapped route → FAIL. Restore → PASS.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  INVITE_ACCEPT_ROUTE_PREFIXES,
  PUBLIC_BUYER_ROUTE_PREFIXES,
  SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES,
} from "../src/utils/coldLoadAuthGates";

// __dirname = mingla-business/__tests__ → up 1 = mingla-business.
const APP_DIR = path.resolve(__dirname, "..", "app");

// Expo-router internals + dev-only files that are NOT user-facing routes.
const NON_ROUTE_FILES = new Set([
  "_layout",
  "+html",
  "+not-found",
  "__styleguide",
  // #2180 — expo-router special, exactly like `+html` and `+not-found` above.
  // `app/+native-intent.tsx` exports a pure `redirectSystemPath` string function
  // that the router calls before any navigation state exists. It renders nothing
  // and is not addressable, so it has no auth gate to classify.
  "+native-intent",
]);

type Bucket =
  "gated-default" | "buyer-exempt" | "connect-seller-exempt" | "invite-exempt";

// Strip the no-trailing-slash form of each prefix into a Set of bare segments.
const bareSet = (prefixes: readonly string[]): Set<string> =>
  new Set(
    prefixes.map((p) => (p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p)),
  );

const CONNECT = bareSet(SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES);
const INVITE = bareSet(INVITE_ACCEPT_ROUTE_PREFIXES);
const BUYER = bareSet(PUBLIC_BUYER_ROUTE_PREFIXES);

const classify = (route: string): Bucket[] => {
  const p = `/${route}`;
  const buckets: Bucket[] = [];
  if (CONNECT.has(p)) buckets.push("connect-seller-exempt");
  if (INVITE.has(p)) buckets.push("invite-exempt");
  if (BUYER.has(p)) buckets.push("buyer-exempt");
  if (buckets.length === 0) buckets.push("gated-default");
  return buckets;
};

// Live enumeration of top-level routes.
const enumerateRoutes = (): string[] => {
  const entries = fs.readdirSync(APP_DIR, { withFileTypes: true });
  const routes = new Set<string>();
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      routes.add(e.name);
      continue;
    }
    if (!e.isFile()) continue;
    const m = e.name.match(/^(.+?)(?:\.web)?\.tsx$/);
    if (!m) continue;
    const name = m[1];
    if (NON_ROUTE_FILES.has(name)) continue;
    routes.add(name);
  }
  return [...routes].sort();
};

// SEEDED expected classification — the verified §5 inventory at ORCH-1139 close.
// Buyer prefixes here are SINGLE-LETTER / short segments that ALSO appear as
// app/ subdirectories (e/ t/ b/ exp/ checkout/ checkout-trip/ checkout-experience/
// reserve/ o/ booking/) → those directories are the buyer-exempt routes.
const EXPECTED: Record<string, Bucket> = {
  // --- connect-seller-exempt (6) ---
  "connect-onboarding": "connect-seller-exempt",
  "connect-account-management": "connect-seller-exempt",
  "connect-partner-onboarding": "connect-seller-exempt",
  "connect-partner-account-management": "connect-seller-exempt",
  "connect-tax-registrations": "connect-seller-exempt",
  "stripe-onboarding-return": "connect-seller-exempt",
  // --- invite-exempt (2) ---
  "accept-brand-invitation": "invite-exempt",
  "accept-scanner-invitation": "invite-exempt",
  // --- buyer-exempt (11 — directory segments) ---
  e: "buyer-exempt",
  t: "buyer-exempt",
  b: "buyer-exempt",
  exp: "buyer-exempt",
  checkout: "buyer-exempt",
  "checkout-trip": "buyer-exempt",
  "checkout-experience": "buyer-exempt",
  reserve: "buyer-exempt",
  refund: "buyer-exempt",
  o: "buyer-exempt",
  booking: "buyer-exempt",
  // --- gated-default (everything else) ---
  "(tabs)": "gated-default",
  account: "gated-default",
  ari: "gated-default",
  attendance: "gated-default",
  auth: "gated-default",
  brand: "gated-default",
  event: "gated-default",
  experience: "gated-default",
  // [TEST-MOD-APPROVED ORCH-1403] — private listing Insights is an authenticated
  // route and is intentionally absent from every public/connect/invite exemption.
  insights: "gated-default",
  partner: "gated-default",
  recent: "gated-default",
  // [ORCH-1062 drift-update] The `app/rsvp` authed RSVP creator route
  // (create / [id]/{index,edit,guests,preview}; shipped ORCH-1355/#831,
  // mirrors `event`) was added to app/ but never seeded into this ORCH-1139
  // inventory. `/rsvp` is in NONE of the exempt prefix sets
  // (PUBLIC_BUYER / SELF_AUTHENTICATING_CONNECT / INVITE_ACCEPT), so it is
  // gated-default — proven from coldLoadAuthGates membership.
  rsvp: "gated-default",
  // ORCH-1390 guest reservation lifecycle is authenticated and therefore
  // remains behind the root auth gate; public Stay discovery lives under /b/.
  stay: "gated-default",
  support: "gated-default",
  trip: "gated-default",
  venue: "gated-default",
  index: "gated-default",
  notifications: "gated-default",
};

describe("ORCH-1139 T-C1 (closure) — every app/ route is classified into exactly one bucket", () => {
  const liveRoutes = enumerateRoutes();

  test("the live app/ route enumeration equals the seeded inventory (no unmapped route)", () => {
    expect(liveRoutes.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(enumerateRoutes())(
    "%s is classified into EXACTLY ONE bucket, matching the expected map",
    (route) => {
      const buckets = classify(route);
      // Exactly one bucket — never double-counted across exemption sets.
      expect(buckets).toHaveLength(1);
      expect(EXPECTED[route]).toBeDefined();
      expect(buckets[0]).toBe(EXPECTED[route]);
    },
  );

  test("no route lives in two exemption sets simultaneously", () => {
    for (const route of liveRoutes) {
      const exemptHits = classify(route).filter((b) => b !== "gated-default");
      expect(exemptHits.length).toBeLessThanOrEqual(1);
    }
  });

  test("all 6 connect + 2 invite exempt routes resolve to real classifications", () => {
    const connectRoutes = liveRoutes.filter(
      (r) => classify(r)[0] === "connect-seller-exempt",
    );
    const inviteRoutes = liveRoutes.filter(
      (r) => classify(r)[0] === "invite-exempt",
    );
    expect(connectRoutes.sort()).toEqual(
      [
        "connect-account-management",
        "connect-onboarding",
        "connect-partner-account-management",
        "connect-partner-onboarding",
        "connect-tax-registrations",
        "stripe-onboarding-return",
      ].sort(),
    );
    expect(inviteRoutes.sort()).toEqual(
      ["accept-brand-invitation", "accept-scanner-invitation"].sort(),
    );
  });
});
