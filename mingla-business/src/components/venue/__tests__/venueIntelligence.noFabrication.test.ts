/**
 * ORCH-1186-B — Safeguard 2: no-fabrication source-grep (Constitution #9 /
 * I-PROPOSED-1186-INTELLIGENCE-NO-FABRICATION).
 *
 * Mirrors the proven overview-no-revenue.test.ts pattern: reads
 * VenueIntelligenceModule.tsx from disk and asserts the honesty contract that a
 * render harness can't cheaply prove —
 *   1. the three coming-soon tiles carry NO `$`, NO digit-bearing metric, and
 *      NO bar <View> in their JSX region;
 *   2. money is rendered ONLY via utils/currency (no ad-hoc Intl.NumberFormat);
 *   3. the INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14 threshold anchor is
 *      present (lowering it to 0 must fail this test).
 *
 * fails-on-revert: hardcode a fake "$1,240" into a coming-soon tile, OR lower
 * the threshold to 0, OR swap formatCurrencyRound for Intl.NumberFormat → FAIL.
 */
import fs from "node:fs";
import path from "node:path";

const COMPONENT_PATH = path.resolve(__dirname, "..", "VenueIntelligenceModule.tsx");
const HELPER_PATH = path.resolve(__dirname, "..", "venueIntelligence.ts");

describe("VenueIntelligenceModule (ORCH-1186-B) — Constitution #9 no-fabrication", () => {
  let source: string;
  let helperSource: string;

  beforeAll(() => {
    source = fs.readFileSync(COMPONENT_PATH, "utf8");
    helperSource = fs.readFileSync(HELPER_PATH, "utf8");
  });

  it("renders money ONLY through utils/currency (no ad-hoc Intl.NumberFormat)", () => {
    expect(source.includes("formatCurrencyRound")).toBe(true);
    // No bespoke currency formatter inside the component.
    expect(source.includes("Intl.NumberFormat")).toBe(false);
  });

  it("keeps the INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS = 14 threshold anchor", () => {
    expect(
      /INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS\s*=\s*14\b/.test(helperSource),
    ).toBe(true);
    // and the component actually gates on it
    expect(source.includes("INTELLIGENCE_MIN_ORDERS_FOR_TIME_BUCKETS")).toBe(true);
  });

  it("the ComingSoonTile component contains NO `$`, NO digit metric, NO bar View", () => {
    const region = extractFn(source, "function ComingSoonTile");
    expect(region.length).toBeGreaterThan(0);

    // No literal `$` outside ${...} interpolation.
    const stripped = region.replace(/\$\{[^}]*\}/g, "");
    expect(stripped.includes("$")).toBe(false);

    // No bar primitives in the coming-soon JSX.
    expect(region.includes("styles.bar")).toBe(false);
    expect(region.includes("styles.sparklineBar")).toBe(false);
    expect(region.includes("styles.scoreBarFill")).toBe(false);

    // No standalone digit-bearing metric in the JSX (the title/desc are words).
    // Allow `borderRadius`/style numeric props are NOT in this fn (it has none),
    // so any bare digit in a Text node would be a fabricated metric.
    const textNodes = region.match(/<Text[^>]*>[^<]*<\/Text>/g) ?? [];
    for (const node of textNodes) {
      // "COMING SOON" + the prop-driven {title}/{description} only.
      expect(/\d/.test(node)).toBe(false);
    }
  });

  it("the three coming-soon tiles carry roadmap copy only (no faked data)", () => {
    expect(source.includes("COMING SOON")).toBe(true);
    expect(source.includes("Busy hours")).toBe(true);
    expect(source.includes("Page views & taps")).toBe(true);
    expect(source.includes("Signal to bookings")).toBe(true);
  });
});

/**
 * Extract a top-level `function NAME(...): React.ReactElement { ... }` body
 * region by brace matching. Anchors on the body brace AFTER the return-type
 * marker so the param-destructure / type-literal braces are NOT mistaken for
 * the body. Returns "" if not found.
 */
function extractFn(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  // The body brace is the `{` that immediately follows `): React.ReactElement`.
  const marker = "): React.ReactElement {";
  const markerAt = source.indexOf(marker, start);
  const braceStart =
    markerAt >= 0 ? markerAt + marker.length - 1 : source.indexOf("{", start);
  if (braceStart < 0) return "";
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return source.slice(start);
}
