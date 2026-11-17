/**
 * issue #3645 bundle 2A — a paid per-stop experience needs its stops to total
 * more than 0 once each stop is rounded to minor units, exactly as the server
 * sums them (biz_publish_experience / biz_update_live_experience refuse it
 * with experience_price_invalid otherwise). The wizard holds Continue/Save on
 * the same rule, with its existing "Set a valid price (or mark it free)" copy.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "@jest/globals";

import { perStopTotalMinor } from "../experienceWizardTypes";

const stops = (...prices: string[]): { priceMajor: string }[] =>
  prices.map((priceMajor) => ({ priceMajor }));

describe("issue #3645 2A — per-stop total in minor units", () => {
  test("empty, blank and zero stops total 0", () => {
    expect(perStopTotalMinor(stops("", "  ", "0", "0.00"))).toBe(0);
    expect(perStopTotalMinor([])).toBe(0);
  });

  test("each stop is rounded before summing, like the payload and the server", () => {
    // 3 × 0.004 is 0.012 as a float, but each stop sends round(0.4) = 0 cents.
    expect(perStopTotalMinor(stops("0.004", "0.004", "0.004"))).toBe(0);
    expect(perStopTotalMinor(stops("0.005"))).toBe(1);
    expect(perStopTotalMinor(stops("10", "", "2.50"))).toBe(1250);
  });

  test("unreadable entries count as 0, never as a price", () => {
    expect(perStopTotalMinor(stops("abc", "-5", "."))).toBe(0);
  });

  test("an entry the stop field rejects is never counted (strict, not parseFloat-lenient)", () => {
    // parseFloat would read these as 1, 1, 100 and 3.
    expect(perStopTotalMinor(stops("1abc", "1..2", "1e2", " 3 x"))).toBe(0);
    expect(perStopTotalMinor(stops("1abc", " 2.50 "))).toBe(250);
  });

  test("the wizard's pricing rule uses it for per-stop, and keeps the free and whole paths", () => {
    const src = fs.readFileSync(path.join(__dirname, "../ExperienceCreatorWizard.tsx"), "utf8");
    const rule = src.slice(src.indexOf("const pricingValid = useMemo"), src.indexOf("}, [", src.indexOf("const pricingValid = useMemo")));
    expect(rule).toMatch(/if \(isFree\) return true;/);
    expect(rule).toMatch(/if \(pricingMode === "whole"\) return paidPriceHasMinorUnits\(resolvedTotalMajor\);/);
    expect(rule).toMatch(/stops\.every\(\(s\) => stopPriceEntryIsValid\(s\.priceMajor\)\) &&\s*perStopTotalMinor\(stops\) > 0/);
    // The payload sends each stop exactly the way perStopTotalMinor counts it,
    // and a free experience sends every stop price as 0 (create/publish and live save).
    const sends = src.match(/pricingMode === "per_stop" && !isFree\s*\?\s*Math\.round\(\(parseFloat\(s\.priceMajor\) \|\| 0\) \* 100\)\s*:\s*0/g) ?? [];
    expect(sends).toHaveLength(2);
    expect(src).not.toMatch(/pricingMode === "per_stop"\s*\?\s*Math\.round\(\(parseFloat/);
    expect(src).toMatch(/experience_price_invalid: "Set a valid price, or mark the experience free\."/);
    // Review never calls a paid per-stop experience "Free": only the free mark does.
    expect(src).not.toMatch(/pricingMode === "per_stop" && resolvedTotalMajor === 0/);
    expect(src).toMatch(/<Text style=\{styles\.reviewValue\}>\{isFree \? "Free" :/);
  });
});
