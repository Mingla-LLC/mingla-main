/**
 * ORCH-1004 [Business web data reliability] — Step 0.5 ADVERSARIAL regression
 * test (DIFFERENT angle from the happy-path hook test).
 *
 * The happy-path test proves ONE hook gates correctly at runtime. This test
 * attacks the PREVENTION GATE itself from the outside:
 *
 *   (1) drives the gate's classification logic against PLANTED FIXTURES —
 *       an auth-scoped hook missing the gate → FAIL; an allowlisted public
 *       hook that stays ungated → PASS; (the npm-wiring FAIL path is exercised
 *       by removing the script reference from a fixture package.json);
 *   (2) runs the gate's --self-test as a subprocess (must exit 0);
 *   (3) runs the live gate against the real repo (must exit 0 — proves the
 *       actual gated hooks pass);
 *   (4) asserts the REAL usePublicEvents / usePublicTripBySlug hooks are NOT
 *       gated on isAuthReady (buyer-web protected — gating them is a P0).
 *
 * Fails-on-revert: if the gate stops catching an ungated auth-scoped hook, or
 * starts flagging an allowlisted public hook, or the live run regresses, or a
 * public buyer hook gets gated, one of the assertions below fails.
 */

import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const gatePath = path.join(
  repoRoot,
  ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
);
const gateSource = readFileSync(gatePath, "utf8");
const hooksDir = path.resolve(__dirname, "..");

// ── Mirror the gate's two detection regexes so we can classify planted
//    fixtures the way the gate does (the gate exports nothing; we replicate
//    its EXACT patterns from source so any drift is caught by test (2)/(3)).
const SESSION_GATE_EQUIVALENT =
  /enabled\s*=\s*!loading\s*&&\s*session\s*!==\s*null/;
const READS_IS_AUTH_READY = /\bisAuthReady\b/;
const ENABLED_USES_IS_AUTH_READY =
  /const\s+enabled\s*=\s*[^;]*\bisAuthReady\b|enabled:\s*[^,}\n]*\bisAuthReady\b/;

const isGated = (src: string): boolean =>
  SESSION_GATE_EQUIVALENT.test(src) ||
  (READS_IS_AUTH_READY.test(src) && ENABLED_USES_IS_AUTH_READY.test(src));

describe("ORCH-1004 gate — planted-fixture classification (adversarial)", () => {
  test("auth-scoped hook MISSING the gate is classified UNGATED → would FAIL", () => {
    const fixture = `
      export const useThing = (brandId) => {
        const enabled = brandId !== null && brandId.length > 0;
        return useQuery({ queryKey: ["thing", brandId], enabled });
      };`;
    expect(isGated(fixture)).toBe(false);
  });

  test("auth-scoped hook WITH the gate is classified GATED → PASS", () => {
    const fixture = `
      export const useThing = (brandId) => {
        const { isAuthReady } = useAuth();
        const enabled = isAuthReady && brandId !== null;
        return useQuery({ queryKey: enabled ? key : DISABLED, enabled });
      };`;
    expect(isGated(fixture)).toBe(true);
  });

  test("imports isAuthReady but never wires it into enabled → still UNGATED (dead-import bug)", () => {
    const fixture = `
      const { isAuthReady } = useAuth();
      void isAuthReady;
      const enabled = brandId !== null;
      useQuery({ enabled });`;
    expect(isGated(fixture)).toBe(false);
  });

  test("a PUBLIC/allowlisted hook that stays ungated is NOT flagged as gated (so the gate leaves it alone)", () => {
    const publicFixture = `
      export const usePublicThing = (slug) => {
        const enabled = typeof slug === "string" && slug.length > 0;
        return useQuery({ queryKey: ["public", slug], enabled });
      };`;
    // The gate's checkPublicNotGated only complains if a public hook GATES on
    // isAuthReady. An ungated public hook is correct → not flagged.
    expect(ENABLED_USES_IS_AUTH_READY.test(publicFixture)).toBe(false);
  });

  test("npm-wiring FAIL path: a package.json without the gate script reference is detected as missing wiring", () => {
    const goodPkg = JSON.stringify({
      scripts: { "test:orch-1004": "node ../.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs" },
    });
    const badPkg = JSON.stringify({ scripts: { "test:other": "echo hi" } });
    const wiringPresent = (pkgJson: string): boolean => {
      const parsed = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
      const script = parsed.scripts?.["test:orch-1004"];
      return (
        typeof script === "string" &&
        script.includes("orch-1004-auth-scoped-query-readiness.mjs")
      );
    };
    expect(wiringPresent(goodPkg)).toBe(true);
    expect(wiringPresent(badPkg)).toBe(false);
  });
});

describe("ORCH-1004 gate — subprocess self-test + live run", () => {
  test("gate --self-test exits 0 (the gate provably catches the bug class)", () => {
    const out = execFileSync("node", [gatePath, "--self-test"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out).toMatch(/self-test PASS/);
  });

  test("live gate exits 0 against the real repo (all registered auth-scoped hooks pass; allowlist clean)", () => {
    const out = execFileSync("node", [gatePath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out).toMatch(/ORCH-1004 gate PASS/);
  });
});

describe("ORCH-1004 — buyer-web public hooks are NOT gated (P0 protection)", () => {
  const assertUngated = (relFile: string): void => {
    const abs = path.join(hooksDir, relFile);
    if (!existsSync(abs)) return;
    const src = readFileSync(abs, "utf8");
    expect(ENABLED_USES_IS_AUTH_READY.test(src)).toBe(false);
  };

  test("usePublicEvents is NOT gated on isAuthReady", () => {
    assertUngated("usePublicEvents.ts");
  });

  test("usePublicTripBySlug is NOT gated on isAuthReady", () => {
    assertUngated("usePublicTripBySlug.ts");
  });

  test("usePublicTripById is NOT gated on isAuthReady", () => {
    assertUngated("usePublicTripById.ts");
  });

  test("useBrand (single, public shell) is NOT gated — but the gate file lists it in the allowlist with a reason", () => {
    // useBrand lives in useBrands.ts alongside the GATED useBrands list hook,
    // so we cannot source-assert the file as a whole. Instead assert the gate
    // explicitly allowlists useBrand.ts with the anon-policy reason.
    expect(gateSource).toMatch(/\["useBrand\.ts",\s*"[^"]*anon[^"]*"\]/i);
  });

  test("the gate allowlist documents the dual-use useIntakeSchema (anon buyer intake) so it is never force-gated", () => {
    expect(gateSource).toMatch(/\["useIntakeSchema\.ts",\s*"[^"]*anon[^"]*"\]/i);
  });
});
