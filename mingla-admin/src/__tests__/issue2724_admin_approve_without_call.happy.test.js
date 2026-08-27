// Issue #2724 implementor happy-path guard.
//
// This suite pins the Admin source contract without provider, browser, or
// production calls. It fails if approval is put behind marked_called_at again,
// if the canonical edge owner is bypassed, or if approval stops relocating the
// canonical Pending/Verified reads.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminSrc = path.resolve(here, "..");
const page = fs.readFileSync(path.join(adminSrc, "pages/ClaimsPage.jsx"), "utf8");
const service = fs.readFileSync(
  path.join(adminSrc, "services/adminClaimsService.js"),
  "utf8",
);

const primaryFooter = page.match(
  /<ModalFooter className="!grid[\s\S]*?<\/ModalFooter>/,
)?.[0];
const runReview = page.match(
  /const runReview = async \(action, opts = \{\}\) => \{[\s\S]*?\n {2}\};/,
)?.[0];
const approvalRefresh = page.match(
  /const refreshAfterApproval = async \(venueId, venueName\) => \{[\s\S]*?\n {2}\};/,
)?.[0];
const verifiedRetry = page.match(
  /const retryVerified = async \(venueId = approvalRefreshVenue\?\.id\) => \{[\s\S]*?\n {2}\};/,
)?.[0];
const markCalledBranch = runReview?.match(
  /if \(action === "mark_called"\) \{[\s\S]*?\n {6}\} else if/,
)?.[0];

describe("Issue #2724 — Admin approval without a call marker", () => {
  it("renders all four review actions for an uncalled pending claim", () => {
    assert.ok(primaryFooter, "the responsive claim-review footer must exist");
    for (const label of ["Need more info", "Reject", "Mark as called", "Approve"]) {
      assert.ok(primaryFooter.includes(label), `missing visible ${label} action`);
    }
    assert.ok(
      primaryFooter.indexOf("Need more info") < primaryFooter.indexOf("Reject") &&
        primaryFooter.indexOf("Reject") < primaryFooter.indexOf("Mark as called") &&
        primaryFooter.indexOf("Mark as called") < primaryFooter.lastIndexOf("Approve"),
      "review actions must retain the approved keyboard/visual order",
    );
    assert.match(page, /const canApprove = !isDuplicateOfApproved;/);
    assert.doesNotMatch(
      page,
      /const canApprove\s*=\s*Boolean\(detail\?\.marked_called_at\)/,
      "the optional call marker must never gate approval",
    );
  });

  it("keeps Mark as called independent and replaces it with readable audit text", () => {
    assert.match(primaryFooter, /detail\?\.marked_called_at \? \([\s\S]*?Called \{formatDateTime\(detail\.marked_called_at\)\}[\s\S]*?: \([\s\S]*?runReview\("mark_called"\)/);
    assert.match(markCalledBranch, /marked_called_at: new Date\(\)\.toISOString\(\)[\s\S]*?actionRefs\.current\.approve\?\.focus\(\)/);
    assert.doesNotMatch(markCalledBranch, /refreshAfterApproval/);
  });

  it("uses action-specific busy and recoverable failure states", () => {
    for (const label of ["Approving…", "Rejecting…", "Requesting info…", "Marking called…"]) {
      assert.ok(page.includes(label), `missing honest busy label ${label}`);
    }
    assert.match(primaryFooter, /loading=\{reviewingAction === "approve"\}/);
    assert.match(primaryFooter, /aria-busy=\{reviewingAction === "approve"\}/);
    assert.match(primaryFooter, /disabled=\{acting\}/);
    for (const title of [
      "Could not approve venue",
      "Could not reject venue",
      "Could not request more info",
      "Could not mark venue as called",
    ]) {
      assert.ok(page.includes(title), `missing failure title ${title}`);
    }
    assert.match(runReview, /catch \(e\) \{[\s\S]*?setReviewError\(/);
    assert.match(page, /role="alert"[\s\S]*?reviewError\.title/);
  });

  it("approves through the canonical service/edge owner only", () => {
    assert.match(primaryFooter, /runReview\("approve"\)/);
    assert.match(runReview, /await reviewClaim\(venueId, action, opts\)/);
    assert.match(
      service,
      /supabase\.functions\.invoke\(\s*"admin-review-venue-claim"/,
    );
    assert.doesNotMatch(service, /\.update\s*\(\s*\{[^}]*claim_status/);
    assert.doesNotMatch(service, /\.rpc\s*\(\s*["']biz_review_venue_claim/);
  });

  it("moves a successful approval to canonically refetched Verified data", () => {
    assert.match(runReview, /action === "approve"[\s\S]*?title: "Venue approved"[\s\S]*?closeDetail\(\);[\s\S]*?await refreshAfterApproval\(venueId, venueName\)/);
    assert.match(approvalRefresh, /setActiveTab\("verified"\)/);
    assert.match(approvalRefresh, /Promise\.allSettled\(\[[\s\S]*?listPendingClaims\(\)[\s\S]*?listVerifiedClaims\(\)/);
    assert.match(approvalRefresh, /setRows\(verifiedResult\.value\)/);
    assert.match(approvalRefresh, /verifiedResult\.value\.some\(\(row\) => row\.id === venueId\)/);
    assert.match(approvalRefresh, /await retryVerified\(venueId\)/, "Verified gets one automatic read retry");
    assert.match(verifiedRetry, /await listVerifiedClaims\(\)/);
    assert.doesNotMatch(verifiedRetry, /reviewClaim\(/, "list retry must never resend approval");
    assert.match(page, /Verified could not refresh\./);
    assert.match(page, /Retry Verified/);
  });

  it("keeps the approved duplicate guard visible and accessible", () => {
    assert.match(primaryFooter, /Resolve duplicate — reject this claim first\./);
    assert.match(primaryFooter, /aria-disabled=\{!canApprove \|\| undefined\}/);
    assert.match(primaryFooter, /aria-describedby=\{[\s\S]*?claim-duplicate-approve-help/);
    assert.match(primaryFooter, /if \(canApprove\) void runReview\("approve"\)/);
  });
});
