/**
 * ORCH-0974 [Home mobile section lock + spacing] — UPDATED for ORCH-1038
 * [unified smart to-do toggle].
 *
 * ORCH-1038 replaced every per-surface conditional card (no-brand / choose-brand /
 * loading / add-venue / deck-readiness / rule-ladder next-action / offering-chooser)
 * with one collapsible <BusinessTodoToggle> flush under the top bar, and gated the
 * analytics so KPI tiles + the Upcoming section render ONLY when there is real data.
 *
 * This file now locks the NEW source-level contract. The ORCH-0974 wins it preserves:
 *   - the mobile populated pane is still a single FlatList scroll surface (no nested
 *     ScrollView) inside the locked zone, with the 24/16 section-header spacing and
 *     the 8px KPI gap.
 * What it newly enforces (ORCH-1038):
 *   - the to-do toggle renders under the top bar (both surfaces, one component),
 *   - analytics are data-gated,
 *   - the removed cards/copy do not come back.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const UPCOMING_ITEM = read(
  "mingla-business/src/components/home/UpcomingListItem.tsx",
);

const BEGIN = "// orch-0974-lock-pane:begin-mobile-populated";
const END = "// orch-0974-lock-pane:end-mobile-populated";

function scopedMobilePopulated(): string {
  const begin = HOME.indexOf(BEGIN);
  const end = HOME.indexOf(END);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(begin);
  return HOME.slice(begin, end);
}

function countToken(source: string, token: string): number {
  return source.split(token).length - 1;
}

function styleBlock(key: string): string {
  const match = new RegExp(`\\n\\s*${key}:\\s*\\{`).exec(HOME);
  expect(match).not.toBeNull();
  const start = (match?.index ?? 0) + (match?.[0].length ?? 0);
  let depth = 1;
  for (let i = start; i < HOME.length; i += 1) {
    if (HOME[i] === "{") depth += 1;
    if (HOME[i] === "}") {
      depth -= 1;
      if (depth === 0) return HOME.slice(start, i);
    }
  }
  throw new Error(`Style block not closed: ${key}`);
}

describe("ORCH-1038 Home to-do toggle + ORCH-0974 lock pane", () => {
  test("T-01: to-do toggle renders under the top bar (one shared component, flush width)", () => {
    expect(HOME).toContain("<BusinessTodoToggle");
    expect(HOME).toContain("todos={todos}");
    expect(HOME).toContain("onAction={handleTodoAction}");
    // wrapped in todoWrap, which matches the top bar's horizontal padding
    expect(HOME).toContain("style={styles.todoWrap}");
    expect(styleBlock("todoWrap")).toContain("paddingHorizontal: spacing.md");
    // toggle sits AFTER the barWrap/TopBar block
    expect(HOME.indexOf("style={styles.todoWrap}")).toBeGreaterThan(
      HOME.indexOf("style={styles.barWrap}"),
    );
  });

  test("T-02: mobile populated pane is one FlatList scroll surface in the locked zone", () => {
    const scoped = scopedMobilePopulated();
    expect(scoped).toContain("styles.mobileBody");
    expect(scoped).toContain("styles.lockedZone");
    expect(scoped).toContain("styles.mobileKpiStack");
    expect(countToken(scoped, "<FlatList")).toBe(1);
    expect(countToken(scoped, "<ScrollView")).toBe(0);
  });

  test("T-03: analytics are data-gated (no zero/empty placeholder tiles)", () => {
    const scoped = scopedMobilePopulated();
    expect(scoped).toContain("{showKpiGrid ? (");
    expect(scoped).toContain("{showRevenueTile ? (");
    expect(scoped).toContain("{hasActiveEvents ? (");
    expect(scoped).toContain("{hasUpcomingItems ? (");
  });

  test("T-04: section header keeps 24px top / 16px bottom spacing", () => {
    const sectionHeader = styleBlock("mobileSectionHeaderRow");
    expect(sectionHeader).toContain("paddingTop: spacing.lg");
    expect(sectionHeader).toContain("paddingBottom: spacing.md");
    expect(scopedMobilePopulated()).toContain(
      "<Text style={styles.sectionTitle}>Upcoming</Text>",
    );
    expect(UPCOMING_ITEM).toContain("<EventCoverMedia");
  });

  test("T-05: KPI hero/tiles keep the 8px gap contract", () => {
    expect(styleBlock("mobileKpiStack")).toContain("gap: spacing.sm");
  });

  test("T-06: the replaced cards + empty-state copy do not return", () => {
    expect(HOME).not.toContain("HomeNextActionCard");
    expect(HOME).not.toContain("NoVenueDeckEntryCard");
    expect(HOME).not.toContain("OfferingChooser");
    expect(HOME).not.toContain("No brands yet");
    expect(HOME).not.toContain("Choose a brand");
    expect(HOME).not.toContain("No upcoming events");
  });
});
