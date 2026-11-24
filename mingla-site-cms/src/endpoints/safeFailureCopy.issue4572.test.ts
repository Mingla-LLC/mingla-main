// INVARIANT sites-safe-failure-named-copy: only SERVICE_TEMPORARILY_UNAVAILABLE may return the generic message
/*
 * #4572 item 1 — every refusal code the Studio routes send has its own
 * sentence; only the real outage says "Website tools are temporarily
 * unavailable." FAILS-ON-REVERT: with the old if-chain every listed code but
 * the media/booking ones returned the generic sentence.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/config", () => ({ cmsConfig: () => ({ businessOrigin: "https://host.usemingla.com", cmsOrigin: "https://studio.sites.usemingla.com" }) }));
vi.mock("../lib/origins", () => ({ businessPreviewFrameAncestor: () => null }));

const { GENERIC_FAILURE_MESSAGE, SAFE_FAILURE_COPY, safeFailureCopy } = await import("./sitesEndpoints");

const SPEC: Record<string, [string, boolean]> = {
  REVISION_CONFLICT: ["Your draft changed since you opened it. Refresh to see the latest.", true],
  FORBIDDEN: ["You don't have access to this website. Ask the brand's owner to add you.", false],
  NOT_FOUND: ["We couldn't find that. It may have been removed. Refresh and try again.", false],
  VALIDATION_FAILED: ["Something in that change isn't valid. Check it and try again.", false],
  INVALID_STATE: ["That can't be done right now. Refresh and try again.", true],
  SESSION_EXPIRED: ["Your session ended. Open your website again from Mingla.", false],
  IDEMPOTENCY_CONFLICT: ["That was already sent with different details. Refresh and try again.", false],
  PAGE_LIMIT_EXCEEDED: ["Your website has the most pages it can hold. Remove one to add another.", false],
  PATH_COLLISION: ["Another page already uses that address. Choose a different one.", false],
  ROUTE_COLLISION: ["Another page already uses that address. Choose a different one.", false],
  DESIGN_CHECKS_REQUIRED: ["We're still checking your design. Try publishing again in a minute.", true],
  STREAM_VIDEO_UNAVAILABLE: ["Video streaming is off for now. Upload the video as a file instead.", false],
  PUBLISH_FAILED_LAST_GOOD_PRESERVED: ["Publishing didn't finish. Your live website hasn't changed. Try again.", true],
};

describe("#4572 item 1 — named refusal copy", () => {
  it("each code in the spec table has its own sentence and retry hint", () => {
    for (const [code, [message, retryable]] of Object.entries(SPEC)) {
      expect(safeFailureCopy(code), code).toEqual({ message, retryable });
    }
  });

  it("only SERVICE_TEMPORARILY_UNAVAILABLE (and unknown codes, which read as it) say the generic sentence", () => {
    for (const [code, copy] of Object.entries(SAFE_FAILURE_COPY)) {
      if (code === "SERVICE_TEMPORARILY_UNAVAILABLE") expect(copy.message).toBe(GENERIC_FAILURE_MESSAGE);
      else expect(copy.message, code).not.toBe(GENERIC_FAILURE_MESSAGE);
    }
    expect(safeFailureCopy("SOMETHING_NEW").message).toBe(GENERIC_FAILURE_MESSAGE);
  });

  it("safeFailure reads the table (no second copy of the sentences)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");
    expect(source).toContain("message: safeFailureCopy(code).message,");
    expect(source.match(/Website tools are temporarily unavailable\./g)).toHaveLength(1);
  });
});
