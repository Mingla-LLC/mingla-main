/**
 * ORCH-1040 — listingStatusView matrix. The brand-facing status is derived from
 * the pipeline status + the admin claim status, with admin decisions taking
 * precedence.
 */
import { describe, expect, test } from "@jest/globals";

import { listingStatusView } from "../listingStatus";

describe("listingStatusView", () => {
  test("no venue → 'No listing yet' (neutral)", () => {
    const v = listingStatusView({ hasVenue: false, status: null, claimStatus: "none" });
    expect(v).toMatchObject({ label: "No listing yet", tone: "neutral" });
  });

  test("claim verified → Live (success), regardless of pipeline status", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "verified",
    });
    expect(v).toMatchObject({ label: "Live on Mingla", tone: "success" });
  });

  test("claim rejected → Changes needed (warning), overrides pipeline", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "rejected",
    });
    expect(v).toMatchObject({ label: "Changes needed", tone: "warning" });
  });

  test("pipeline failed → Changes needed (warning)", () => {
    const v = listingStatusView({ hasVenue: true, status: "failed", claimStatus: "none" });
    expect(v).toMatchObject({ label: "Changes needed", tone: "warning" });
  });

  test("deck_eligible + pending review → In review (info)", () => {
    const v = listingStatusView({
      hasVenue: true,
      status: "deck_eligible",
      claimStatus: "pending_review",
    });
    expect(v).toMatchObject({ label: "In review", tone: "info" });
  });

  test("deck_eligible (no claim decision yet) → In review", () => {
    const v = listingStatusView({ hasVenue: true, status: "deck_eligible", claimStatus: "none" });
    expect(v.label).toBe("In review");
  });

  test("needs_fix → Needs fixes (warning)", () => {
    const v = listingStatusView({ hasVenue: true, status: "needs_fix", claimStatus: "none" });
    expect(v).toMatchObject({ label: "Needs fixes", tone: "warning" });
  });

  test("processing → Processing (info)", () => {
    const v = listingStatusView({ hasVenue: true, status: "processing", claimStatus: "none" });
    expect(v).toMatchObject({ label: "Processing", tone: "info" });
  });

  test("draft → Draft (neutral)", () => {
    const v = listingStatusView({ hasVenue: true, status: "draft", claimStatus: "none" });
    expect(v).toMatchObject({ label: "Draft", tone: "neutral" });
  });

  test("null status with a venue → Draft", () => {
    const v = listingStatusView({ hasVenue: true, status: null, claimStatus: undefined });
    expect(v.label).toBe("Draft");
  });
});
