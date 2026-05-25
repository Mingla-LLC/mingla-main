/**
 * ORCH-0974 [Home mobile section lock + spacing] happy-path regression tests.
 *
 * The mingla-business Jest harness is node/ts-jest, so this file verifies the
 * source-level contract that makes the runtime layout possible. Fails-on-revert
 * minimum coverage:
 *   - T-01 fails if the old outer mobile ScrollView returns.
 *   - T-02 fails if section-header spacing reverts.
 *   - T-05 fails if the large-phone ladder card placement is removed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const HOME = read("mingla-business/app/(tabs)/home.tsx");
const UPCOMING_ITEM = read(
  "mingla-business/src/components/home/UpcomingListItem.tsx",
);

const BEGIN = "// orch-0974-lock-pane:begin-mobile-populated";
const END = "// orch-0974-lock-pane:end-mobile-populated";
const LADDER_CONDITION =
  "nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4)";

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

describe("ORCH-0974 mobile Home lock pane", () => {
  test("T-01: mobile populated path has locked primitives and one FlatList scroll surface", () => {
    const scoped = scopedMobilePopulated();
    expect(scoped).toContain("styles.mobileBody");
    expect(scoped).toContain("styles.lockedZone");
    expect(scoped).toContain("styles.mobileKpiStack");
    expect(scoped).toContain("styles.mobileSectionHeaderRow");
    expect(countToken(scoped, "<FlatList")).toBe(1);
    expect(countToken(scoped, "<ScrollView")).toBe(0);
  });

  test("T-02: section header has 24px top boundary and 16px breathing room below", () => {
    const sectionHeader = styleBlock("mobileSectionHeaderRow");
    expect(sectionHeader).toContain("paddingTop: spacing.lg");
    expect(sectionHeader).toContain("paddingBottom: spacing.md");
    expect(scopedMobilePopulated()).toContain("<Text style={styles.sectionTitle}>Upcoming</Text>");
    expect(UPCOMING_ITEM).toContain("<EventCoverMedia");
  });

  test("T-03: KPI hero and Active Events tile use the 8px gap contract", () => {
    expect(styleBlock("mobileKpiStack")).toContain("gap: spacing.sm");
  });

  test("T-04: empty mobile branch keeps its ScrollView, emptyCol, copy, and RefreshControl", () => {
    const emptyBranchStart = HOME.indexOf(") : currentBrand === null ? (");
    const lockStart = HOME.indexOf(BEGIN);
    expect(emptyBranchStart).toBeGreaterThanOrEqual(0);
    expect(lockStart).toBeGreaterThan(emptyBranchStart);
    const emptyBranch = HOME.slice(emptyBranchStart, lockStart);
    expect(emptyBranch).toContain("<ScrollView");
    expect(emptyBranch).toContain("contentContainerStyle={styles.emptyScroll}");
    expect(emptyBranch).toContain("refreshControl=");
    expect(emptyBranch).toContain("<View style={styles.emptyCol}>");
    expect(emptyBranch).toContain("No brands yet");
    expect(emptyBranch).toContain("Choose a brand");
    expect(emptyBranch).toContain("Loading brands");
  });

  test("T-05: large-phone ladder card renders inside the locked zone before FlatList", () => {
    const scoped = scopedMobilePopulated();
    const lockedCondition = `${LADDER_CONDITION} && !isSmallPhoneWithLiveHero`;
    expect(scoped).toContain(lockedCondition);
    expect(scoped.indexOf(lockedCondition)).toBeLessThan(scoped.indexOf("<FlatList"));
    expect(scoped.indexOf("<HomeNextActionCard action={nextAction}")).toBeLessThan(
      scoped.indexOf("<FlatList"),
    );
  });

  test("T-06: iPhone-SE-class live-hero carve-out renders ladder card after FlatList", () => {
    const scoped = scopedMobilePopulated();
    expect(HOME).toContain(
      "primaryLiveEvent !== null && dimensions.height <= 700",
    );
    const footerCondition = `${LADDER_CONDITION} && isSmallPhoneWithLiveHero`;
    expect(scoped).toContain(footerCondition);
    expect(scoped.indexOf(footerCondition)).toBeGreaterThan(scoped.indexOf("<FlatList"));
    expect(styleBlock("smallPhoneLadderHost")).toContain("flexShrink: 0");
  });
});
