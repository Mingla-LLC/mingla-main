// ORCH-1064 — admin UI + service regression for the venue-claim feedback panel.
//
// SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1064_VENUE_CLAIM_FEEDBACK_LOOP.md §5.
// Acceptance: SC-ADMIN-1 (stage items + send), SC-ADMIN-2 (Send disabled at 0
// items), SC-ADMIN-3 (current-round status badges), SC-ADMIN-4 (routes through
// admin-review-venue-claim action:add_feedback).
//
// Source-inspect pattern (same as orch1008/orch1009 admin tests): boots no
// React; reads the JSX/service files as text + asserts the load-bearing strings
// exist. Fails on revert: removing the panel JSX, the disable guard, the service
// fn, or the add_feedback action string flips the matching assertion → fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const PAGE = path.join(ADMIN_ROOT, "src", "pages", "ClaimsPage.jsx");
const SERVICE = path.join(ADMIN_ROOT, "src", "services", "adminClaimsService.js");

const PAGE_SRC = fs.readFileSync(PAGE, "utf8");
const SERVICE_SRC = fs.readFileSync(SERVICE, "utf8");

describe("ORCH-1064 — admin feedback service", () => {
  it("S-01: addClaimFeedback routes through admin-review-venue-claim action:add_feedback (SC-ADMIN-4)", () => {
    assert.ok(
      /export async function addClaimFeedback\(brandId, items, overallMessage\)/.test(SERVICE_SRC),
      "addClaimFeedback(brandId, items, overallMessage) signature missing",
    );
    assert.ok(
      SERVICE_SRC.includes('"admin-review-venue-claim"'),
      "addClaimFeedback must invoke the admin-review-venue-claim edge fn",
    );
    assert.ok(
      SERVICE_SRC.includes('action: "add_feedback"'),
      "addClaimFeedback must send action:add_feedback",
    );
    assert.ok(
      SERVICE_SRC.includes("overall_message: overallMessage ?? null"),
      "addClaimFeedback must pass overall_message (nullable)",
    );
  });
});

describe("ORCH-1064 — admin feedback panel", () => {
  it("P-01: addClaimFeedback imported + submit handler wired (SC-ADMIN-1)", () => {
    assert.ok(PAGE_SRC.includes("addClaimFeedback"), "addClaimFeedback not imported into ClaimsPage");
    assert.ok(
      PAGE_SRC.includes("const submitFeedback = async"),
      "submitFeedback handler missing",
    );
    assert.ok(
      PAGE_SRC.includes('logAdminAction("claim.add_feedback"'),
      "submitFeedback must audit-log claim.add_feedback",
    );
  });

  it("P-02: Send feedback button disabled with zero staged items (SC-ADMIN-2)", () => {
    assert.ok(
      PAGE_SRC.includes(">\n                    Send feedback\n                  </Button>") ||
        PAGE_SRC.includes("Send feedback"),
      "Send feedback button label missing",
    );
    assert.ok(
      PAGE_SRC.includes("disabled={acting || feedbackItems.length === 0}"),
      "Send feedback must be disabled when feedbackItems is empty",
    );
  });

  it("P-03: staged-item composer (category select + note + Add item) present", () => {
    assert.ok(PAGE_SRC.includes("Feedback to business"), "panel header missing");
    assert.ok(PAGE_SRC.includes("addFeedbackItem"), "addFeedbackItem stager missing");
    assert.ok(PAGE_SRC.includes("FEEDBACK_CAT_LABELS"), "category label map missing");
    assert.ok(PAGE_SRC.includes("Add item"), "Add item button missing");
  });

  it("P-04: current-round status renders Open/Fixed badges from bundle.feedback (SC-ADMIN-3)", () => {
    assert.ok(
      PAGE_SRC.includes("bundle?.feedback"),
      "panel must read the active round from bundle.feedback",
    );
    assert.ok(
      PAGE_SRC.includes('item.status === "fixed" ? "success" : "warning"'),
      "current-round items must show Fixed(success)/Open(warning) badges",
    );
    assert.ok(
      PAGE_SRC.includes('item.status === "fixed" ? "Fixed" : "Open"'),
      "badge label must reflect fixed/open status",
    );
  });
});
