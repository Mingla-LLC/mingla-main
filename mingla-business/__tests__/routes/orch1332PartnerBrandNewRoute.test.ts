import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1332 [partner-brand-fixes] — fails-on-revert regression contract.
 *
 * Root cause (F-1): no `/brand/new` route file existed, so expo-router matched
 * the dynamic `app/brand/[id]` segment with `id="new"`, resolved a null brand,
 * and rendered BrandProfileView's "Brand not found" screen — a dead tap for
 * both partner CTAs (`/partner/brands` empty state + `/partner/earnings`
 * nudge), which push `/brand/new?partner_mode=client`.
 *
 * The fix adds `app/brand/new.tsx` (mounts BrandCreationFlow, NOT
 * BrandProfileView) + an F-2 hardening in BrandCreationFlow so a late-arriving
 * `partner_enabled` still lands client mode.
 *
 * Source-contract test (readFileSync, no RN renderer) matching the repo
 * convention in `__tests__/components/BrandCreationFlow.test.tsx`.
 *
 * fails-on-revert verified at b6765d26 (SC-1 route-exists + SC-6 F-2 branch go RED)
 */

const repoRoot = path.resolve(__dirname, "../..");
const readBusinessFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("ORCH-1332 partner brand-creation route contract", () => {
  test("SC-1 — /brand/new route exists and mounts BrandCreationFlow (not BrandProfileView)", () => {
    // Deleting the route file (the F-1 revert) makes readFileSync throw → RED.
    const source = readBusinessFile("app/brand/new.tsx");
    expect(source).toContain("BrandCreationFlow");
    // The whole bug was the dynamic [id] route rendering BrandProfileView's
    // not-found branch; the new static route must NEVER mount that view.
    expect(source).not.toContain("BrandProfileView");
  });

  test("SC-2/SC-3 — both partner CTAs bind the /brand/new?partner_mode=client target", () => {
    const brands = readBusinessFile("app/partner/brands.tsx");
    const earnings = readBusinessFile("app/partner/earnings.tsx");
    // Both sides depend on this exact string; the route file above is what
    // makes it a live target instead of a dead tap.
    expect(brands).toContain("/brand/new?partner_mode=client");
    expect(earnings).toContain("/brand/new?partner_mode=client");
  });

  test("SC-1 param plumbed — BrandCreationFlow reads partner_mode and presets client mode", () => {
    const flow = readBusinessFile("src/components/brand/BrandCreationFlow.tsx");
    expect(flow).toContain("useLocalSearchParams");
    expect(flow).toContain("partner_mode");
    // The client preset the route relies on (mode:'client', step:1).
    expect(flow).toContain('mode: "client"');
  });

  test("SC-6 F-2 hardening — client mode is re-applied when partner status resolves after mount", () => {
    const flow = readBusinessFile("src/components/brand/BrandCreationFlow.tsx");
    // The added promote-effect branch. Deleting it (the F-2 revert) removes
    // this exact re-apply dispatch → RED. Distinct from the mount-time preset
    // (which uses the initial-state literal, not this setState re-apply).
    expect(flow).toContain('setState((prev) => ({ ...prev, mode: "client" }))');
    expect(flow).toContain('partnerModeParam === "client"');
  });
});
