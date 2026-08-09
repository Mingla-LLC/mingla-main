/**
 * Issue #1685 [venue-draft-multi] — named "Finish adding <venue>" resume rows
 * (SPEC §9 supporting suite; §7 T-11…T-14).
 *
 * `/venue/create` no longer resumes anything, so these rows are the ONLY door
 * back into a half-built venue. Two things are guarded:
 *   1. the row shape itself (id, label, sublabel, route, naming threshold);
 *   2. that `useBusinessTodos` ACTUALLY passes `venueDrafts` through. Without
 *      (2), the §4.4 legacy fallback silently restores the old single
 *      `finish_venue` row and every behavioural test here still passes — a live
 *      vacuity hazard, so it is asserted at source level.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  buildBusinessTodos,
  type BusinessTodo,
  type BusinessTodoInput,
} from "../businessTodos";

/** The live (META-ORCH-1255 multiVenue) shape: `venuePipelines` is present. */
const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: null,
  pipelineRoute: "",
  venueDraftInProgress: false,
  venuePipelines: [],
  venueClaims: [],
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

const finishRows = (input: BusinessTodoInput): BusinessTodo[] =>
  buildBusinessTodos(input).filter((t) => t.id.startsWith("finish_venue"));

describe("#1685 T-11…T-13 — one named row per unfinished venue draft", () => {
  test("T-11 — ONE draft keeps the generic label, byte-identical to today", () => {
    const rows = finishRows({
      ...base,
      venueDraftInProgress: true,
      venueDrafts: [
        {
          draftId: "dv_one",
          venueName: "Lumen Wine Bar",
          route: "/venue/create?draft=dv_one",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "finish_venue:dv_one",
      label: "Finish adding your venue",
      sublabel: "Pick up where you left off",
      action: { kind: "route", route: "/venue/create?draft=dv_one" },
    });
  });

  test("T-12 — TWO drafts get named rows, each routed to its own draft id", () => {
    const rows = finishRows({
      ...base,
      venueDraftInProgress: true,
      venueDrafts: [
        {
          draftId: "dv_a",
          venueName: "Lumen Wine Bar",
          route: "/venue/create?draft=dv_a",
        },
        {
          draftId: "dv_b",
          venueName: "Vine Hall",
          route: "/venue/create?draft=dv_b",
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "finish_venue:dv_a",
      label: "Finish adding Lumen Wine Bar",
      sublabel: "Pick up where you left off",
      action: { kind: "route", route: "/venue/create?draft=dv_a" },
    });
    expect(rows[1]).toEqual({
      id: "finish_venue:dv_b",
      label: "Finish adding Vine Hall",
      sublabel: "Pick up where you left off",
      action: { kind: "route", route: "/venue/create?draft=dv_b" },
    });
    // Distinct ids and distinct routes — one row can never reopen the other.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(
      new Set(rows.map((r) => (r.action as { route: string }).route)).size,
    ).toBe(2);
  });

  test("T-13 — an UNNAMED second draft falls back cleanly, no dangling space", () => {
    const rows = finishRows({
      ...base,
      venueDraftInProgress: true,
      venueDrafts: [
        {
          draftId: "dv_a",
          venueName: "Lumen Wine Bar",
          route: "/venue/create?draft=dv_a",
        },
        { draftId: "dv_b", venueName: "", route: "/venue/create?draft=dv_b" },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Finish adding Lumen Wine Bar",
      "Finish adding your venue",
    ]);
    for (const row of rows) {
      expect(row.label).not.toMatch(/Finish adding\s*$/);
      expect(row.label.endsWith(" ")).toBe(false);
    }
  });

  test("an EMPTY venueDrafts array emits zero rows (SC-3)", () => {
    // `venueDraftInProgress` is deliberately still true here: the presence of
    // `venueDrafts` must win, or ten empty "+" presses would nag forever.
    expect(
      finishRows({ ...base, venueDraftInProgress: true, venueDrafts: [] }),
    ).toEqual([]);
  });
});

describe("#1685 T-14 — the legacy singular band is untouched", () => {
  test("a caller that passes NO venueDrafts keeps the old row verbatim", () => {
    const rows = finishRows({
      ...base,
      venueDraftInProgress: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "finish_venue",
      label: "Finish adding your venue",
      sublabel: "Pick up where you left off",
      action: { kind: "route", route: "/venue/create" },
    });
  });

  test("the pre-1255 singular band still emits add_venue for a brand with no draft", () => {
    const ids = buildBusinessTodos({
      ...base,
      venuePipelines: undefined,
      venueClaims: undefined,
      hasPhysicalLocation: true,
    }).map((t) => t.id);
    expect(ids).toContain("add_venue");
  });
});

describe("#1685 — the hook actually passes the rows (vacuity guard)", () => {
  const hookSource = readFileSync(
    join(__dirname, "..", "..", "hooks", "useBusinessTodos.ts"),
    "utf8",
  );

  test("useBusinessTodos reads the per-draft list and feeds buildBusinessTodos", () => {
    // It must subscribe to the LIST hook, not the old single-draft boolean.
    expect(hookSource).toContain("useVenueDraftEntriesForBrand(");
    expect(hookSource).not.toContain("draftVenueForBrand(");
    // …derive the row inputs from it…
    expect(hookSource).toContain("draftId: e.id");
    expect(hookSource).toContain("`/venue/create?draft=${e.id}`");
    expect(hookSource).toContain(
      "e.state.displayName.trim() || e.state.workingName.trim()",
    );
    // …and actually HAND THEM to buildBusinessTodos. Without this line the
    // legacy fallback silently restores the single row.
    expect(hookSource).toMatch(
      /buildBusinessTodos\(\{[\s\S]*?\n\s*venueDrafts,/,
    );
    expect(hookSource).toContain(
      "venueDraftInProgress: venueDrafts.length > 0",
    );
    // The memo must re-run when the drafts move.
    const depsStart = hookSource.lastIndexOf("[");
    expect(hookSource.slice(depsStart)).toContain("venueDrafts,");
  });
});
