/**
 * ORCH-1114 [public trip + experience Share button is a dead tap on web] —
 * public anon experience page contract (mirror of public-trip-page.test.ts).
 *
 * Asserts the /exp/[brandSlug]/[experienceSlug] route is anon-tolerant per
 * feedback_anon_buyer_routes.md (no useAuth, no sign-in redirect) AND that the
 * Share control routes through the web-aware ShareModal, NOT bare react-native
 * Share.share (which dead-taps on react-native-web when navigator.share is
 * undefined).
 *
 * Fails-on-revert: reverting the share control to Share.share flips both the
 * .toMatch(<ShareModal) and the .not.toMatch(Share.share) assertions in
 * A-EXP-9.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const publicRouteSource = readFileSync(
  join(__dirname, "..", "[brandSlug]", "[experienceSlug].tsx"),
  "utf-8",
);
const publicHookSource = readFileSync(
  join(__dirname, "..", "..", "..", "src", "hooks", "usePublicExperience.ts"),
  "utf-8",
);

describe("ORCH-1114 — /exp/{brandSlug}/{experienceSlug} public anon route contract", () => {
  test("A-EXP-1: route does NOT import or call useAuth (anon-tolerant)", () => {
    expect(publicRouteSource).not.toMatch(/^import[\s\S]*\buseAuth\b[\s\S]*from/m);
    expect(publicRouteSource).not.toMatch(/\buseAuth\s*\(/);
  });

  test("A-EXP-2: route does NOT redirect to sign-in / (auth)", () => {
    expect(publicRouteSource).not.toMatch(/router\.replace.*\(auth\)/);
    expect(publicRouteSource).not.toMatch(/router\.push.*\(auth\)/);
    expect(publicRouteSource).not.toMatch(/router\.replace.*sign-in/);
  });

  test("A-EXP-3: route mounts ExperiencePreview", () => {
    expect(publicRouteSource).toMatch(/<ExperiencePreview/);
  });

  test("A-EXP-4: route mounts ExperienceCheckoutFlow", () => {
    expect(publicRouteSource).toMatch(/<ExperienceCheckoutFlow/);
  });

  test("A-EXP-5: route uses usePublicExperienceBySlug hook", () => {
    expect(publicRouteSource).toMatch(/usePublicExperienceBySlug/);
  });

  test("A-EXP-6: route handles loading, error, and not-found states", () => {
    expect(publicRouteSource).toMatch(/isLoading/);
    expect(publicRouteSource).toMatch(/isError/);
    expect(publicRouteSource).toMatch(/Experience not found|null|undefined/);
  });

  test("A-EXP-7: usePublicExperience hook does NOT import or call useAuth", () => {
    expect(publicHookSource).not.toMatch(/^import[\s\S]*\buseAuth\b[\s\S]*from/m);
    expect(publicHookSource).not.toMatch(/\buseAuth\s*\(/);
  });

  // ORCH-1114 — the Share control must route through the web-aware ShareModal,
  // NOT bare react-native Share.share. Fails-on-revert: reverting to Share.share
  // flips both the .toMatch(<ShareModal) and the .not.toMatch(Share.share).
  test("A-EXP-9: experience share routes through ShareModal, not bare Share.share", () => {
    expect(publicRouteSource).toMatch(/<ShareModal/);
    expect(publicRouteSource).toMatch(/setShareModalVisible/);
    expect(publicRouteSource).toMatch(/experiencePublicUrl\(/);
    expect(publicRouteSource).not.toMatch(/\bShare\.share\b/);
    expect(publicRouteSource).not.toMatch(
      /^import[\s\S]*\bShare\b[\s\S]*from ["']react-native["']/m,
    );
  });
});
