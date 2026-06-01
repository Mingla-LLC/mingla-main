/**
 * META-ORCH-1009 Sub-E deck-readiness coaching — UPDATED for ORCH-1038.
 *
 * ORCH-1038 deleted the inline <DeckReadinessCard> from Home + Hub (and the
 * component itself). The deck-readiness coaching now lives on the dedicated
 * /venue/deck-readiness screen (VenueCreatorWizard), reached via a single
 * "Get your venue live" row in the shared to-do toggle. This test locks that
 * preserved capability at its new home.
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

const DECK_ROUTE =
  "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "needs_fix",
  pipelineRoute: DECK_ROUTE,
  venueDraftInProgress: false,
  counts: { total: 1, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
};

describe("META-ORCH-1009 Sub-E deck readiness (ORCH-1038 to-do toggle)", () => {
  test("venue not live → get_venue_live row routes to the deck-readiness screen", () => {
    const todo = buildBusinessTodos(base).find((t) => t.id === "get_venue_live");
    expect(todo).toBeDefined();
    expect(todo?.action).toEqual({ kind: "route", route: DECK_ROUTE });
  });

  test("venue live (deck_eligible) → no get_venue_live row (vanishes)", () => {
    const ids = buildBusinessTodos({
      ...base,
      pipelineStatus: "deck_eligible",
    }).map((t) => t.id);
    expect(ids).not.toContain("get_venue_live");
  });

  test("Home + Hub render the shared toggle; the inline coaching card is gone", () => {
    const home = readFileSync(HOME, "utf8");
    const hub = readFileSync(HUB, "utf8");
    expect(home).toContain("<BusinessTodoToggle");
    expect(hub).toContain("<BusinessTodoToggle");
    expect(home).not.toContain("DeckReadinessCard");
    expect(hub).not.toContain("DeckReadinessCard");
  });
});
