/**
 * Issue #871 — TESTER ADVERSARIAL: nested-route authentication boundary.
 *
 * The implementor guard proves the intended pathname is public. This guard
 * approaches the fix from the route topology instead: the protected
 * `/attendance` namespace must have exactly one materialized public child,
 * while adjacent and encoded lookalikes continue through the root sign-in
 * gate. That catches both removal of the exemption and accidental widening as
 * more files are added beneath the namespace.
 *
 * FAILS ON REVERT: deleting `/attendance/claim` from
 * `PUBLIC_BUYER_ROUTE_PREFIXES` makes the materialized child redirect.
 */

import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  isPublicBuyerRoute,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

const loggedOutOnWeb = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
};

const attendanceRouteDir = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "attendance",
);

describe("issue #871 tester guard — attendance namespace stays narrowly public", () => {
  test("the sole materialized attendance child remains reachable while signed out", () => {
    const routeFiles = fs
      .readdirSync(attendanceRouteDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /(?:\.web)?\.tsx$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    expect(routeFiles).toEqual(["claim.tsx"]);
    expect(isPublicBuyerRoute("/attendance/claim")).toBe(true);
    expect(
      shouldRedirectToSignInFromRoute({
        ...loggedOutOnWeb,
        pathname: "/attendance/claim",
      }),
    ).toBe(false);
  });

  test.each([
    "/attendance",
    "/attendance/claims",
    "/attendance/claimant",
    "/attendance/claim.evil",
    "/attendance/%63laim",
    "/Attendance/claim",
  ])("keeps the non-canonical lookalike %s behind authentication", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(false);
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
    ).toBe(true);
  });
});
