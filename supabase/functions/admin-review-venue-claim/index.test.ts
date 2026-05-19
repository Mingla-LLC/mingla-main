// Ve3 — admin-review-venue-claim unit tests
// Run: deno test supabase/functions/admin-review-venue-claim/index.test.ts

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  auditActionForReview,
  normalizeReviewBody,
  pushCopyForReview,
} from "./reviewLogic.ts";
import { buildClaimApprovedEmail } from "../_shared/email/claimApprovedEmail.ts";
import { buildClaimRejectedEmail } from "../_shared/email/claimRejectedEmail.ts";

Deno.test("normalizeReviewBody rejects missing brand_id", () => {
  const r = normalizeReviewBody({ action: "approve" });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "brand_id_required");
});

Deno.test("normalizeReviewBody rejects invalid action", () => {
  const r = normalizeReviewBody({
    brand_id: "11111111-1111-1111-1111-111111111111",
    action: "auto_approve",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "invalid_action");
});

Deno.test("normalizeReviewBody requires rejection_reason on reject", () => {
  const r = normalizeReviewBody({
    brand_id: "11111111-1111-1111-1111-111111111111",
    action: "reject",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "rejection_reason_required");
});

Deno.test("normalizeReviewBody accepts mark_called", () => {
  const r = normalizeReviewBody({
    brand_id: "11111111-1111-1111-1111-111111111111",
    action: "mark_called",
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.action, "mark_called");
    assertEquals(r.rejectionReason, "");
  }
});

Deno.test("auditActionForReview maps claim actions", () => {
  assertEquals(auditActionForReview("mark_called"), "claim.mark_called");
  assertEquals(auditActionForReview("approve"), "claim.approve");
  assertEquals(auditActionForReview("reject"), "claim.reject");
  assertEquals(auditActionForReview("need_more_info"), "claim.need_more_info");
});

Deno.test("pushCopyForReview only for notify actions", () => {
  assertStrictEquals(pushCopyForReview("mark_called", "Joe's"), null);
  assertEquals(pushCopyForReview("approve", "Joe's")?.title, "Venue verified");
  assertEquals(
    pushCopyForReview("need_more_info", "Joe's")?.title,
    "More info needed",
  );
});

Deno.test("buildClaimApprovedEmail includes public CTA", () => {
  const body = buildClaimApprovedEmail({
    brandName: "Joe's Pizza",
    publicVenueUrl: "https://business.usemingla.com/b/joes-pizza",
  });
  assertEquals(body.title, "Your venue is live on Mingla");
  assertEquals(body.cta?.url, "https://business.usemingla.com/b/joes-pizza");
});

Deno.test("buildClaimRejectedEmail includes rejection reason", () => {
  const body = buildClaimRejectedEmail({
    brandName: "Joe's Pizza",
    rejectionReason: "Could not verify by phone",
  });
  assertEquals(body.paragraphs[1], "Reason: Could not verify by phone");
});
