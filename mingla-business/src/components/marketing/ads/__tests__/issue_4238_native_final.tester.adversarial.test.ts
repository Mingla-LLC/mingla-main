// Issue #4238 — independent tester, final native pass (rework 5 + W7 at 12a79570c7).
//
// Angles the implementor's rework-5 and W7 suites do not take:
// 1. Confirm binding when ONLY the plan changes (same brand, same campaign):
//    a confirm opened on plan A must refuse once the screen shows plan B.
//    Empty-string ids never mint a key, and a plan that is null on one render
//    and undefined on the next keeps the same key (no false "Nothing was
//    changed" while the screen settles).
// 2. Age fields: non-ASCII digits (full-width, Arabic-Indic), a leading "+",
//    hex, four digits and surrounding tabs/newlines, plus the exact 18 and 65
//    edges with leading zeros.
// 3. Budget marks: the measured phone track stacks "Minimum" and
//    "Recommended" 30% apart, a desktop track does not, the exact threshold
//    does not stack, and an unmeasured (NaN) track falls back to the 22% rule.

import { describe, expect, test } from "@jest/globals";

import {
  HOST_AD_MARK_LABEL_WIDTH,
  hostAdAgeRangeValid,
  hostAdMarksCollide,
} from "../hostAdBuilderRules";
import { hostAdConfirmKey, hostAdConfirmStillBound } from "../hostAdManageModel";

describe("#4238 native final: a confirm is bound to the plan as well as the campaign", () => {
  test("same brand and campaign, different plan: the confirm refuses", () => {
    const openedOn = hostAdConfirmKey({ brandId: "brand-1", campaignId: "camp-1", planId: "plan-a" });
    const nowShowing = hostAdConfirmKey({ brandId: "brand-1", campaignId: "camp-1", planId: "plan-b" });
    expect(openedOn).not.toBeNull();
    expect(nowShowing).not.toBeNull();
    expect(hostAdConfirmStillBound(openedOn, nowShowing)).toBe(false);
  });

  test("empty-string ids never mint a key, so nothing can bind to them", () => {
    expect(hostAdConfirmKey({ brandId: "", campaignId: "camp-1", planId: "p" })).toBeNull();
    expect(hostAdConfirmKey({ brandId: "brand-1", campaignId: "", planId: "p" })).toBeNull();
    expect(hostAdConfirmStillBound(null, null)).toBe(false);
  });

  test("a plan that is null on one render and undefined on the next keeps the same key", () => {
    const a = hostAdConfirmKey({ brandId: "brand-1", campaignId: "camp-1", planId: null });
    const b = hostAdConfirmKey({ brandId: "brand-1", campaignId: "camp-1", planId: undefined });
    expect(hostAdConfirmStillBound(a, b)).toBe(true);
  });
});

describe("#4238 native final: age fields accept ASCII whole years only", () => {
  test.each([
    ["２１", "45"], // full-width digits
    ["٢١", "45"], // Arabic-Indic digits
    ["+21", "45"],
    ["0x15", "45"],
    ["21", "1000"],
    ["21", "45.0"],
  ])("refuses %p to %p", (min, max) => {
    expect(hostAdAgeRangeValid(min, max)).toBe(false);
  });

  test("edges and harmless whitespace are accepted", () => {
    expect(hostAdAgeRangeValid("018", "065")).toBe(true);
    expect(hostAdAgeRangeValid("\t21\n", "  45 ")).toBe(true);
    expect(hostAdAgeRangeValid("65", "65")).toBe(true);
    expect(hostAdAgeRangeValid("18", "18")).toBe(true);
  });
});

describe("#4238 native final: budget marks stack on the measured phone track only", () => {
  test("30% apart stacks on a 330 pt phone track but not on an 800 pt desktop track", () => {
    expect(hostAdMarksCollide(20, 50, 330)).toBe(true);
    expect(hostAdMarksCollide(20, 50, 800)).toBe(false);
  });

  test("exactly at the label width + 8 the marks do not stack (strict)", () => {
    const width = 1000;
    const apartPct = ((HOST_AD_MARK_LABEL_WIDTH + 8) / width) * 100;
    expect(hostAdMarksCollide(0, apartPct, width)).toBe(false);
    expect(hostAdMarksCollide(0, apartPct - 0.1, width)).toBe(true);
  });

  test("an unmeasured track falls back to the 22% rule", () => {
    expect(hostAdMarksCollide(20, 41, Number.NaN)).toBe(true);
    expect(hostAdMarksCollide(20, 42, 0)).toBe(false);
  });
});
