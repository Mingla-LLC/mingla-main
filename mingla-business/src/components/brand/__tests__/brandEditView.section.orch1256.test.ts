/**
 * ORCH-1256 — BrandEditView `?section=` deep-link source contract.
 *
 * The mingla-business Jest harness is node/ts-jest (no RN renderer), so this
 * locks the scroll-to-section mechanism at source level (mirrors the
 * BusinessTodoToggle contract-test approach):
 *   - the six section anchors + fire-once latch + scrollTo exist
 *   - the route wrapper reads/validates the `?section=` param (T-9)
 *   - the PHYSICAL LOCATION block (META-ORCH-1255 territory) carries NO
 *     anchor and its markers are intact
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const VIEW_SRC = readFileSync(
  join(__dirname, "..", "BrandEditView.tsx"),
  "utf8",
);
const ROUTE_SRC = readFileSync(
  join(__dirname, "..", "..", "..", "..", "app", "brand", "[id]", "edit.tsx"),
  "utf8",
);

const SECTIONS = [
  "photo",
  "about",
  "cover",
  "address",
  "contact",
  "social",
] as const;

describe("BrandEditView — ORCH-1256 scroll-to-section contract", () => {
  test("exports the closed BrandEditSection set and the initialSection prop", () => {
    expect(VIEW_SRC).toContain("export type BrandEditSection =");
    expect(VIEW_SRC).toContain("initialSection?: BrandEditSection;");
  });

  test("has a ScrollView ref + fire-once pending latch + scrollTo", () => {
    expect(VIEW_SRC).toContain("const scrollRef = useRef<RNScrollView>(null);");
    expect(VIEW_SRC).toContain(
      "useRef<BrandEditSection | null>(",
    );
    expect(VIEW_SRC).toContain("pendingSectionRef.current = null;");
    expect(VIEW_SRC).toContain("scrollRef.current?.scrollTo({");
    expect(VIEW_SRC).toContain("ref={scrollRef}");
  });

  test.each(SECTIONS)("carries exactly one onLayout anchor for %s", (section) => {
    const marker = `handleSectionLayout("${section}")`;
    const first = VIEW_SRC.indexOf(marker);
    // present…
    expect(first).toBeGreaterThan(-1);
    // …and attached (onLayout), used once in JSX beyond the factory itself.
    expect(VIEW_SRC).toContain(`onLayout={handleSectionLayout("${section}")}`);
    expect(VIEW_SRC.indexOf(marker, first + 1)).toBe(-1);
  });

  test("PHYSICAL LOCATION block (META-ORCH-1255) has NO anchor and its markers are intact", () => {
    // Anchor on the JSX label (comments elsewhere also say "PHYSICAL
    // LOCATION" — the block itself starts at the section label element).
    const start = VIEW_SRC.indexOf(
      "<Text style={styles.sectionLabel}>PHYSICAL LOCATION</Text>",
    );
    const end = VIEW_SRC.indexOf("SECTION B — About");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = VIEW_SRC.slice(start, end);
    // no ORCH-1256 mechanism inside the 1255-owned block
    expect(block).not.toContain("onLayout");
    expect(block).not.toContain("handleSectionLayout");
    // 1255 markers untouched
    expect(block).toContain("Customers visit you in person");
    expect(block).toContain("hasPhysicalLocation");
    expect(block).toContain('accessibilityLabel="Physical location"');
  });
});

describe("app/brand/[id]/edit.tsx — ORCH-1256 ?section= param (T-9)", () => {
  test("reads the section param (array-form normalized) and validates it", () => {
    expect(ROUTE_SRC).toContain("section?: string | string[];");
    expect(ROUTE_SRC).toContain("Array.isArray(params.section)");
    expect(ROUTE_SRC).toContain("isBrandEditSection(");
  });

  test("validator is the closed 6-value set — bogus values fall to undefined", () => {
    for (const section of SECTIONS) {
      expect(ROUTE_SRC).toContain(`value === "${section}"`);
    }
    expect(ROUTE_SRC).toContain(": undefined;");
  });

  test("passes initialSection into BrandEditView", () => {
    expect(ROUTE_SRC).toContain("initialSection={initialSection}");
  });
});
