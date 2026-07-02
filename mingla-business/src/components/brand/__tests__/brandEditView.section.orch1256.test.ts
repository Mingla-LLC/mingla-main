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

  // [TEST-MOD-APPROVED META-ORCH-1255] This pin guarded the 1255-owned
  // PHYSICAL LOCATION block against 1256 anchor creep WHILE the block still
  // existed. META-ORCH-1255 §D-5 then DELETED the whole block (toggle + CTA +
  // hasPhysicalLocation write paths) — the SPEC §8 merge-order note
  // anticipated exactly this ("that anchor dies with the section"). The
  // contract intent survives inverted: the block must now be ABSENT, no
  // section anchor may reference it, and no physical-location target exists
  // in the closed section set. Supersession ordered by the orchestrator
  // RETEST directive 2026-07-02; enforcement of non-reintroduction also
  // lives in .github/scripts/strict-grep/
  // orch-1255-brandedit-no-physical-location-toggle.mjs.
  test("PHYSICAL LOCATION block (META-ORCH-1255) is fully deleted — no markers, no anchor", () => {
    expect(VIEW_SRC).not.toContain(
      "<Text style={styles.sectionLabel}>PHYSICAL LOCATION</Text>",
    );
    expect(VIEW_SRC).not.toContain("Customers visit you in person");
    expect(VIEW_SRC).not.toContain("hasPhysicalLocation");
    expect(VIEW_SRC).not.toContain('accessibilityLabel="Physical location"');
    // and no section anchor was ever minted for it
    expect(VIEW_SRC).not.toContain('handleSectionLayout("physical');
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
