import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1332 [partner-brand-fixes] — TESTER ADVERSARIAL regression.
 *
 * Different angle from the implementor's happy-path suite
 * (`orch1332PartnerBrandNewRoute.test.ts`, which asserts the route file EXISTS
 * and the F-2 setState branch is PRESENT). This suite attacks the SAFETY of the
 * F-2 hardening and the client/self invariant:
 *
 *   1. The F-2 client-mode re-apply MUST be fully guarded so it can NEVER
 *      clobber a user who has committed identity or already left self/step-1.
 *      A naive unguarded `else if (isPartner && param==="client") setState(...)`
 *      would pass the implementor's "branch exists" test but silently override
 *      user state — this suite fails that.
 *   2. The re-apply dispatch must preserve prior state (`...prev`) and change
 *      ONLY `mode` — no name/bio/step reset (no data loss).
 *   3. Structural invariant: self-mode NEVER reaches the invite step (step 5 /
 *      partner_brand_links) — the invite is client-only, so a self-mode flow
 *      can never create a partner link.
 *
 * Source-contract test (readFileSync, no RN renderer) — matches the repo
 * convention in `__tests__/components/BrandCreationFlow.test.tsx`.
 *
 * fails-on-revert verified at 11a2c446a (revert the F-2 branch → the guarded
 * else-if regex match goes null → test 1 RED).
 */

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");

const FLOW = "src/components/brand/BrandCreationFlow.tsx";

describe("ORCH-1332 partner-mode guard — adversarial", () => {
  test("F-2 re-apply branch is fully guarded (cannot clobber committed / non-self state)", () => {
    const flow = read(FLOW);
    // Capture the exact else-if block that performs the client-mode re-apply.
    const block = flow.match(
      /}\s*else if\s*\(([\s\S]*?)\)\s*{[\s\S]*?setState\(\(prev\) => \(\{ \.\.\.prev, mode: "client" \}\)\);/,
    );
    expect(block).not.toBeNull();
    const condition = block![1];
    // Every guard clause MUST be present — dropping any one re-opens a clobber:
    expect(condition).toContain('isPartner');
    expect(condition).toContain('partnerModeParam === "client"'); // intent gate
    expect(condition).toContain("state.step === 1"); // only pre-identity step
    expect(condition).toContain('state.mode === "self"'); // never re-fires once client
    expect(condition).toContain('state.name === ""'); // user hasn't committed identity
    expect(condition).toContain('state.bio === ""');
  });

  test("F-2 re-apply changes ONLY mode — preserves prior state (no data loss)", () => {
    const flow = read(FLOW);
    // The dispatch must spread `...prev` and set only `mode` — it must NOT reset
    // name/bio/step/brandId in the same setState (which would drop typed input).
    expect(flow).toContain('setState((prev) => ({ ...prev, mode: "client" }))');
    // Guard against a regression that resets identity alongside the mode flip.
    expect(flow).not.toContain('{ ...prev, mode: "client", name: ""');
    expect(flow).not.toContain('{ ...prev, mode: "client", bio: ""');
    expect(flow).not.toContain('{ ...prev, mode: "client", step:');
  });

  test("self-mode NEVER reaches the invite step (partner link is client-only)", () => {
    const flow = read(FLOW);
    // Reducer cap: client → max step 5 (invite); self → max step 4 (welcome).
    expect(flow).toContain('const max = state.mode === "client" ? 5 : 4;');
    // The jump to the invite (step 5) is gated on client mode + step 3.
    expect(flow).toContain('state.mode === "client" && state.step === 3');
    // The brand row is flagged partner_setup strictly from client mode.
    expect(flow).toContain('partnerSetup: state.mode === "client"');
  });
});
