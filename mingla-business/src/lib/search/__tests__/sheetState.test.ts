/**
 * META-ORCH-1073 Sub-A — sheet-body state machine + recents + row-press.
 *
 * Covers the GlobalSearchSheet component's decision logic without rendering
 * (the harness has no @testing-library/react-native). T-01/T-07/T-08/T-13/T-15
 * mechanics live here.
 */

import { describe, expect, test } from "@jest/globals";

import {
  computeBodyState,
  pushRecent,
  rowPressEffects,
} from "../sheetState";
import { buildSearchIndex } from "../globalSearch";
import type { SearchResult } from "../types";

const BRAND_ID = "brand_1";
const index = buildSearchIndex({
  events: [],
  drafts: [],
  trips: [],
  experiences: [],
  brandId: BRAND_ID,
});

describe("computeBodyState", () => {
  test("T-07: <2 chars → empty state with recents + jump-to suggestions", () => {
    const body = computeBodyState({ query: "a", index, recents: ["refund"] });
    expect(body.kind).toBe("empty");
    if (body.kind === "empty") {
      expect(body.recents).toEqual(["refund"]);
      expect(body.suggestions.length).toBeGreaterThan(0);
    }
  });

  test("populated: a matching query yields grouped results", () => {
    const body = computeBodyState({ query: "payments", index, recents: [] });
    expect(body.kind).toBe("populated");
    if (body.kind === "populated") {
      expect(body.results.some((r) => r.id === "payments")).toBe(true);
    }
  });

  test("T-08: no-match query → zero state with ≤3 suggestions", () => {
    const body = computeBodyState({ query: "zzzqxq", index, recents: [] });
    expect(body.kind).toBe("zero");
    if (body.kind === "zero") {
      expect(body.query).toBe("zzzqxq");
      expect(body.suggestions.length).toBeLessThanOrEqual(3);
    }
  });

  test("T-15: a malformed index entry → error state (no crash)", () => {
    const brokenIndex = [{ searchText: null } as never];
    const body = computeBodyState({
      query: "payments",
      index: brokenIndex,
      recents: [],
    });
    expect(body.kind).toBe("error");
  });
});

describe("pushRecent (T-13)", () => {
  test("dedupes case-insensitively, MRU-orders, caps at 6", () => {
    let r: string[] = [];
    r = pushRecent(r, "Refund");
    r = pushRecent(r, "payout");
    r = pushRecent(r, "refund"); // dup of "Refund" → moves to front, no double
    expect(r).toEqual(["refund", "payout"]);
  });

  test("empty/whitespace query is a no-op", () => {
    expect(pushRecent(["a"], "   ")).toEqual(["a"]);
  });

  test("caps at 6 MRU", () => {
    let r: string[] = [];
    for (let i = 0; i < 10; i += 1) r = pushRecent(r, `q${i}`);
    expect(r.length).toBe(6);
    expect(r[0]).toBe("q9");
  });
});

describe("rowPressEffects", () => {
  test("returns the row route, records the query, and signals close", () => {
    const result = { route: "/event/le_1" } as Pick<SearchResult, "route">;
    const effects = rowPressEffects(result, "summer", ["old"]);
    expect(effects.route).toBe("/event/le_1");
    expect(effects.nextRecents[0]).toBe("summer");
    expect(effects.shouldClose).toBe(true);
  });
});
