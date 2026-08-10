import { describe, expect, test } from "@jest/globals";

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

describe("issue #871 attendance claim public-route handoff", () => {
  test.each([
    "/attendance/claim",
    "/attendance/claim/",
  ])("keeps signed-out buyers on %s", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(true);
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
    ).toBe(false);
  });

  test.each([
    "/attendance",
    "/attendance-claim",
    "/attendance/claims",
    "/attendance/claim-evil",
  ])("does not expose the protected lookalike %s", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(false);
    expect(
      shouldRedirectToSignInFromRoute({ ...loggedOutOnWeb, pathname }),
    ).toBe(true);
  });
});
