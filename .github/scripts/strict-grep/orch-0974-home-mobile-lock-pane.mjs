#!/usr/bin/env node
/**
 * ORCH-0974 [Home mobile section lock + spacing] strict-grep gate.
 *
 * Enforces the proposed Home mobile lock-pane invariant:
 *   - populated mobile Home has exactly one scrolling surface: FlatList
 *   - KPI/section-header styles and spacing contract remain explicit
 *   - pull-to-refresh stays on the FlatList
 *   - upcoming row rendering stays extracted to UpcomingListItem
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const HOME_PATH = join(REPO_ROOT, "mingla-business", "app", "(tabs)", "home.tsx");
const UPCOMING_ITEM_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "home",
  "UpcomingListItem.tsx",
);

const BEGIN = "// orch-0974-lock-pane:begin-mobile-populated";
const END = "// orch-0974-lock-pane:end-mobile-populated";

let violations = 0;

function rel(path) {
  return relative(REPO_ROOT, path);
}

function fail(checkId, message) {
  violations += 1;
  console.error(`[ORCH-0974] FAIL [${checkId}] ${message}`);
}

function readRequired(path) {
  if (!existsSync(path)) {
    fail("file-exists", `Missing required file: ${rel(path)}`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function countToken(source, token) {
  return source.split(token).length - 1;
}

function extractStyleBlock(source, key) {
  const startRe = new RegExp(`\\n\\s*${key}:\\s*\\{`);
  const match = startRe.exec(source);
  if (match === null) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

const homeSource = readRequired(HOME_PATH);
const upcomingItemSource = readRequired(UPCOMING_ITEM_PATH);

if (homeSource.length > 0) {
  const beginIndex = homeSource.indexOf(BEGIN);
  const endIndex = homeSource.indexOf(END);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    fail(
      "C1: single-scrollable-surface-mobile-populated",
      `Missing or misordered ORCH-0974 mobile populated markers in ${rel(HOME_PATH)}.`,
    );
  } else {
    const scoped = homeSource.slice(beginIndex, endIndex);
    const scrollViewCount = countToken(scoped, "<ScrollView");
    const flatListCount = countToken(scoped, "<FlatList");
    if (scrollViewCount !== 0 || flatListCount !== 1) {
      fail(
        "C1: single-scrollable-surface-mobile-populated",
        `Expected 0 <ScrollView and 1 <FlatList between markers; found ${scrollViewCount} ScrollView and ${flatListCount} FlatList.`,
      );
    }

    const flatListIndex = scoped.indexOf("<FlatList");
    const flatListWindow = scoped
      .slice(flatListIndex)
      .split("\n")
      .slice(0, 31)
      .join("\n");
    if (flatListIndex === -1 || !flatListWindow.includes("refreshControl=")) {
      fail(
        "C4: refresh-control-on-list",
        "The mobile populated FlatList must carry refreshControl= within 30 lines of its opening tag.",
      );
    }
  }

  for (const styleKey of [
    "mobileBody",
    "lockedZone",
    "mobileKpiStack",
    "mobileSectionHeaderRow",
  ]) {
    if (extractStyleBlock(homeSource, styleKey) === null) {
      fail(
        "C2: locked-zone-style-present",
        `Missing styles.${styleKey} in ${rel(HOME_PATH)}.`,
      );
    }
  }

  const sectionHeader = extractStyleBlock(homeSource, "mobileSectionHeaderRow");
  const kpiStack = extractStyleBlock(homeSource, "mobileKpiStack");
  if (
    sectionHeader === null ||
    !sectionHeader.includes("paddingBottom: spacing.md") ||
    !sectionHeader.includes("paddingTop: spacing.lg")
  ) {
    fail(
      "C3: spacing-contract-explicit",
      "styles.mobileSectionHeaderRow must contain paddingTop: spacing.lg and paddingBottom: spacing.md.",
    );
  }
  if (kpiStack === null || !kpiStack.includes("gap: spacing.sm")) {
    fail(
      "C3: spacing-contract-explicit",
      "styles.mobileKpiStack must contain gap: spacing.sm.",
    );
  }

  if (!homeSource.includes("UpcomingListItem")) {
    fail(
      "C5: upcoming-list-item-extracted",
      `${rel(HOME_PATH)} must import and render UpcomingListItem.`,
    );
  }
}

if (
  upcomingItemSource.length > 0 &&
  !upcomingItemSource.includes("export interface UpcomingListItemProps")
) {
  fail(
    "C5: upcoming-list-item-extracted",
    `${rel(UPCOMING_ITEM_PATH)} must export UpcomingListItemProps.`,
  );
}

if (violations === 0) {
  console.log("[ORCH-0974] OK — Home mobile lock pane invariant holds.");
  process.exit(0);
}

console.error(`[ORCH-0974] FAIL — ${violations} violation(s).`);
console.error(
  "See: Mingla_Artifacts/specs/SPEC_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md §10.",
);
process.exit(1);
