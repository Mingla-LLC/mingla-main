/**
 * META-ORCH-1009 Sub-E (Job A) — no-venue discoverability — UPDATED for ORCH-1038.
 *
 * ORCH-1038 replaced the standalone <NoVenueDeckEntryCard> (now deleted) with a
 * row in the shared smart to-do toggle. The Sub-E CAPABILITY is preserved: a
 * brand with no venue is still guided to /venue/create (resume-aware). This test
 * locks that capability at its new home — buildBusinessTodos + the toggle that
 * Home and Hub both render.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../../../utils/businessTodos";

const HOME = join(__dirname, "../../../..", "app/(tabs)/home.tsx");
const HUB = join(__dirname, "../../../..", "app/(tabs)/hub/_layout.tsx");

const withBrand: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: null, // no venue yet
  pipelineRoute:
    "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 1, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  // META-ORCH-1059 — new BusinessTodoInput fields (no pending venue claim here).
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  // ORCH-1064 — open-feedback escalation fields (no open feedback here).
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
};

describe("META-ORCH-1009 Sub-E Job A — no-venue entry (ORCH-1038 to-do toggle)", () => {
  test("no venue → add_venue row routes to /venue/create", () => {
    const todo = buildBusinessTodos(withBrand).find((t) => t.id === "add_venue");
    expect(todo).toBeDefined();
    expect(todo?.action).toEqual({ kind: "route", route: "/venue/create" });
  });

  test("in-progress venue draft → resume-aware finish_venue row (still /venue/create)", () => {
    const todo = buildBusinessTodos({
      ...withBrand,
      venueDraftInProgress: true,
    }).find((t) => t.id === "finish_venue");
    expect(todo).toBeDefined();
    expect(todo?.label).toBe("Finish adding your venue");
    expect(todo?.action).toEqual({ kind: "route", route: "/venue/create" });
  });

  test("Home and Hub both surface the entry via the shared to-do toggle", () => {
    const home = readFileSync(HOME, "utf8");
    const hub = readFileSync(HUB, "utf8");
    expect(home).toContain("<BusinessTodoToggle");
    expect(hub).toContain("<BusinessTodoToggle");
    // the deleted standalone card must not return
    expect(home).not.toContain("NoVenueDeckEntryCard");
  });
});
