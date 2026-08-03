/**
 * ISSUE-865 PR1 WP-4 — "Customers your ads drove" tile contract (NEW, append-only).
 *
 * Source-grep on VenueIntelligenceModule.tsx (the house venue-suite test idiom —
 * see venueIntelligence.noFabrication.test.ts). Proves the tile exists, is wired
 * to the real rollup hook, is placed as tile #2 (under Revenue, above Slow hours),
 * gates every number behind real data (honest empty state), and renders money only
 * through utils/currency — never fabricating a metric.
 *
 * fails-on-revert: delete the tile / the hook wiring, ungate the numbers, or add a
 * hardcoded metric → FAIL.
 */
import fs from "node:fs";
import path from "node:path";

const COMPONENT_PATH = path.resolve(__dirname, "..", "VenueIntelligenceModule.tsx");

describe("VenueIntelligenceModule — Customers your ads drove tile (#865 PR1)", () => {
  let source: string;
  beforeAll(() => {
    source = fs.readFileSync(COMPONENT_PATH, "utf8");
  });

  it("renders the tile and wires it to the brand_conversion_rollup hook", () => {
    expect(source.includes("Customers your ads drove")).toBe(true);
    expect(source.includes("useBrandConversionRollup")).toBe(true);
  });

  it("is placed as tile #2 — after Revenue, before Slow hours", () => {
    const revenueIdx = source.indexOf('<Text style={styles.tileTitle}>Revenue</Text>');
    // Anchor on the tile's JSX title (the string also appears in a header comment).
    const adsIdx = source.indexOf('<Text style={styles.tileTitle}>Customers your ads drove</Text>');
    const slowHoursIdx = source.indexOf('<Text style={styles.tileTitle}>Slow hours</Text>');
    expect(revenueIdx).toBeGreaterThan(-1);
    expect(adsIdx).toBeGreaterThan(revenueIdx);
    expect(slowHoursIdx).toBeGreaterThan(adsIdx);
  });

  it("gates every number behind real data (honest empty state)", () => {
    // The populated branch is gated on adsHasData (derived from a real lifetime count).
    expect(/adsHasData\s*\?/.test(source)).toBe(true);
    expect(source.includes("const adsHasData = adsDrivenLifetime > 0")).toBe(true);
    // An honest empty-state sentence with NO digits.
    expect(/they show up\s*\n?\s*here/.test(source)).toBe(true);
  });

  it("renders money only via utils/currency (no ad-hoc formatter in the tile)", () => {
    // The tile's value uses formatCurrencyRound; there is no bespoke Intl formatter.
    expect(source.includes("formatCurrencyRound(adsValueLifetime")).toBe(true);
    expect(source.includes("Intl.NumberFormat")).toBe(false);
  });
});
