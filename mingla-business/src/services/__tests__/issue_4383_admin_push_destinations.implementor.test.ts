/* eslint-disable import/first */
/**
 * Issue #4383 — every Host-app destination an Admin push may open is fed
 * through the app's REAL notification router (resolveBusinessNavTarget, the
 * function a push tap runs) and must resolve to a route whose screen file
 * exists under mingla-business/app/. Executed proof, not declared proof
 * (lesson of #2245): adding mingla-business://home (no parser case: the tap
 * would fall back by type) turns this red.
 *
 * Run: npx jest src/services/__tests__/issue_4383_admin_push_destinations.implementor.test.ts (from mingla-business)
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-4383" }) },
}));
jest.mock("../supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../businessNotificationRouting";
import { ADMIN_PUSH_DESTINATIONS } from "../../../../supabase/functions/_shared/adminPushDestinations";

const APP_DIR = path.resolve(__dirname, "../../../app");
const HOST = ADMIN_PUSH_DESTINATIONS.filter((row) => row.app === "host");

/** The screen file an expo-router path renders, or null. */
function screenFileFor(route: string): string | null {
  const pathname = route.split("?")[0].replace(/^\/+/, "");
  for (const candidate of [`${pathname}.tsx`, `${pathname}/index.tsx`]) {
    const file = path.join(APP_DIR, candidate);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

describe("#4383 Host-app push destinations", () => {
  test("there are exactly the two approved destinations", () => {
    expect(HOST.map((row) => [row.value, row.deepLink])).toEqual([
      ["community", "mingla-business://community"],
      ["home", "mingla-business://(tabs)/home"],
    ]);
  });

  test.each(HOST.map((row) => [row.label, row.deepLink]))("%s (%s) parses to a real screen, not a type fallback", (_label, deepLink) => {
    const parsed = parseBusinessDeepLink(deepLink);
    expect(parsed).not.toBeNull();
    const tapped = resolveBusinessNavTarget({ type: "business.mingla_update", deepLink });
    expect(tapped).toBe(parsed);
    expect(screenFileFor(tapped)).not.toBeNull();
  });

  test("Community opens Account > Support on its Community tab; Home opens the Home tab", () => {
    expect(resolveBusinessNavTarget({ type: "business.mingla_update", deepLink: "mingla-business://community" }))
      .toBe("/account/support?tab=community");
    expect(resolveBusinessNavTarget({ type: "business.mingla_update", deepLink: "mingla-business://(tabs)/home" }))
      .toBe("/(tabs)/home");
  });

  test("mingla-business://home is not offered: it has no parser case", () => {
    expect(HOST.some((row) => row.deepLink === "mingla-business://home")).toBe(false);
    expect(parseBusinessDeepLink("mingla-business://home")).toBeNull();
  });
});
