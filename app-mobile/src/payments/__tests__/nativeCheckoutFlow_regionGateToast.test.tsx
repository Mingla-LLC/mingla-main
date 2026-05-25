/**
 * ORCH-0955 [Native Stripe Tax for Platforms] — region-gate toast handler
 * decommissioned (consumer app).
 *
 * Original purpose (ORCH-0953 §3.8): assert that the consumer-app native
 * checkout flow mapped the region-gate 400 response
 * (`error: "native_paid_not_allowed_in_region"`) into a user-facing
 * web-fallback toast.
 *
 * Per ORCH-0955 CLOSE 2026-05-25 + I-PROPOSED-REGION-GATE-DELETED: the
 * gate is deleted so the toast handler is dead code and was removed.
 *
 * Preserved per append-only policy; rewritten to assert the DELETED state.
 * [TEST-MOD-APPROVED ORCH-0955]
 */

import fs from "node:fs";
import path from "node:path";

const FLOW_PATH = path.join(__dirname, "..", "nativeCheckoutFlow.ts");

describe("ORCH-0955: consumer native checkout flow region-gate handling deleted", () => {
  it("nativeCheckoutFlow.ts MUST NOT reference the deleted region-gate error code", () => {
    const src = fs.readFileSync(FLOW_PATH, "utf8");
    expect(src).not.toContain("native_paid_not_allowed_in_region");
    expect(src).not.toContain("retryWithSurface");
  });
});
