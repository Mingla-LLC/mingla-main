/**
 * #4273 — the Host app's segment count against the same table of cases as the
 * server (supabase/functions/__tests__/issue_4273_sms_segments.implementor.test.ts,
 * which also runs both calculators against each other).
 *
 * Fails on revert: restore `Math.ceil(len / 153)` in smsCost.computeSegments and
 * the extended, pair-straddling and emoji cases fail. Drop "\f" from GSM7_EXT and
 * the form feed cases fail.
 */
import { readFileSync } from "fs";
import path from "path";

import { prefillSmsFromEmail } from "../../features/marketing/blastSendModel";
import { computeSegments, estimateSmsCost, gsmSeptets, isGsm7, sanitizeGsm7, wireBody } from "../smsCost";

interface SegmentCase {
  id: string;
  parts: [string, number][];
  encoding: "GSM-7" | "UCS-2";
  segments: number;
}

const FIXTURE = path.join(
  __dirname,
  "../../../../supabase/functions/__tests__/fixtures/issue4273_sms_segment_cases.json",
);
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: SegmentCase[] };
const build = (parts: [string, number][]): string =>
  parts.map(([text, times]) => text.repeat(times)).join("");

describe("#4273 computeSegments matches the shared table", () => {
  it("still has its cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
  it.each(cases.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const body = build(row.parts);
    expect(computeSegments(body)).toBe(row.segments);
    expect(isGsm7(body)).toBe(row.encoding === "GSM-7");
  });
});

describe("#4273 what the host reads follows the count", () => {
  it("a 136-septet body stays one segment with the footer; 137 does not", () => {
    expect(estimateSmsCost(`${"a".repeat(134)}€`, 10).segmentsPerRecipient).toBe(1);
    expect(estimateSmsCost(`${"a".repeat(135)}€`, 10)).toMatchObject({
      encoding: "GSM-7",
      segmentsPerRecipient: 2,
      totalSegments: 20,
      estimatedCostMinor: 20,
    });
  });
  it("counts a form feed as two septets", () => {
    expect(gsmSeptets("\f")).toBe(2);
  });
});

describe("#4273 pre-fill still promises one segment by the real count", () => {
  const measure = { isGsm7, sanitizeGsm7 };
  it.each([
    ["euro", "Tickets €5 ".repeat(40)],
    ["all extended", "€[]{}|^~\\".repeat(30)],
    ["plain", "Live band tonight. ".repeat(30)],
    ["emoji", "Live tonight \u{1F389} ".repeat(30)],
  ])("%s", (_name, words) => {
    const text = prefillSmsFromEmail({ subject: "", bodyHtml: words, brandName: "Club" }, measure);
    expect(text.length).toBeGreaterThan(0);
    expect(computeSegments(wireBody(text))).toBe(1);
  });
});
