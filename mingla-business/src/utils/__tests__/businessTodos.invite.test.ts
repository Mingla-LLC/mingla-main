/**
 * ORCH-1111 — buildBusinessTodos pending-invite row.
 *
 * Implementor happy-path regression. Asserts that a pending invite for the
 * signed-in email surfaces as the FIRST To-Do row (above the brand-gate
 * "Create a brand" row), with the exact copy + open_pending_invite action, and
 * that the create_brand row still follows. Reverting the businessTodos.ts emit
 * → the invite row disappears → this test fails (fails-on-revert).
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../businessTodos";

const base: BusinessTodoInput = {
  pendingInvites: [],
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute: "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 3, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
};

describe("buildBusinessTodos — ORCH-1111 pending invite row", () => {
  test("a pending invite surfaces as the FIRST row, with create_brand following", () => {
    const todos = buildBusinessTodos({
      ...base,
      pendingInvites: [{ id: "i1", brandName: "Acme" }],
      hasNoBrands: true,
    });
    expect(todos[0]).toMatchObject({
      id: "pending_invite_i1",
      label: "You've been invited to Acme",
      sublabel: "Tap to accept or decline",
      action: {
        kind: "open_pending_invite",
        invitationId: "i1",
        brandName: "Acme",
      },
    });
    // The create_brand row still follows the invite (a brand-less invitee is
    // not stranded on the empty state).
    expect(todos.map((t) => t.id)).toEqual(["pending_invite_i1", "create_brand"]);
  });

  test("invite row sits ABOVE the normal list for a branded user", () => {
    const todos = buildBusinessTodos({
      ...base,
      pendingInvites: [{ id: "i2", brandName: "Beta Co" }],
      // healthy brand with nothing else to do → only the invite row.
    });
    expect(todos[0]?.id).toBe("pending_invite_i2");
  });

  test("multiple invites preserve the hook's expires_at ASC order", () => {
    const todos = buildBusinessTodos({
      ...base,
      pendingInvites: [
        { id: "first", brandName: "Soonest" },
        { id: "second", brandName: "Later" },
      ],
      hasNoBrands: true,
    });
    expect(todos.map((t) => t.id)).toEqual([
      "pending_invite_first",
      "pending_invite_second",
      "create_brand",
    ]);
  });

  test("no invites → no invite row (vanish contract)", () => {
    const todos = buildBusinessTodos({ ...base, hasNoBrands: true });
    expect(todos.some((t) => t.id.startsWith("pending_invite_"))).toBe(false);
    expect(todos[0]?.id).toBe("create_brand");
  });
});
