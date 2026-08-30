#!/usr/bin/env node
/**
 * ORCH-0974 [Home mobile section lock + spacing] strict-grep gate.
 *
 * Enforces the proposed Home mobile lock-pane invariant:
 *   - populated mobile Home has exactly one scrolling surface: FlatList
 *   - Last 7 days -> Analytics -> Live -> Recent order is preserved on wide and mobile
 *   - the removed Active events KPI cannot return
 *   - KPI/section-header styles and spacing contract remain explicit
 *   - pull-to-refresh stays on the FlatList and refreshes Analytics
 *   - Recent row rendering stays extracted to RecentRow/EventCoverMedia
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const HOME_PATH = join(REPO_ROOT, "mingla-business", "app", "(tabs)", "home.tsx");
const RECENT_ROW_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "home",
  "RecentRow.tsx",
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function assertOrdered(checkId, source, anchors) {
  let prior = -1;
  for (const [label, token] of anchors) {
    const index = source.indexOf(token);
    if (index === -1) {
      fail(checkId, `Missing ${label} anchor: ${token}`);
      return;
    }
    if (index <= prior) {
      fail(checkId, `${label} is out of order.`);
      return;
    }
    prior = index;
  }
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
const recentRowSource = readRequired(RECENT_ROW_PATH);

if (homeSource.length > 0) {
  const homeCode = stripComments(homeSource);
  const beginIndex = homeSource.indexOf(BEGIN);
  const endIndex = homeSource.indexOf(END);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    fail(
      "C1: single-scrollable-surface-mobile-populated",
      `Missing or misordered ORCH-0974 mobile populated markers in ${rel(HOME_PATH)}.`,
    );
  } else {
    const scoped = homeSource.slice(beginIndex, endIndex);
    const scopedCode = stripComments(scoped);
    const scrollViewCount = countToken(scoped, "<ScrollView");
    const flatListCount = countToken(scoped, "<FlatList");
    if (scrollViewCount !== 0 || flatListCount !== 1) {
      fail(
        "C1: single-scrollable-surface-mobile-populated",
        `Expected 0 <ScrollView and 1 <FlatList between markers; found ${scrollViewCount} ScrollView and ${flatListCount} FlatList.`,
      );
    }

    const flatListIndex = scoped.indexOf("<FlatList");
    if (flatListIndex === -1 || !scoped.includes("refreshControl=")) {
      fail(
        "C4: refresh-control-on-list",
        "The mobile populated FlatList must carry refreshControl=.",
      );
    }
    if (!scopedCode.includes('testID="home-mobile-scroll"')) {
      fail(
        "C1: single-scrollable-surface-mobile-populated",
        "The marker-bounded mobile FlatList must own testID home-mobile-scroll.",
      );
    }
    assertOrdered("C8: mobile-order", scopedCode, [
      ["conditional Last 7 days", "{showRevenueTile ? ("],
      ["Last 7 days tile", 'label="Last 7 days"'],
      ["mobile Analytics tile", "<AnalyticsHomeTile"],
      ["mobile Live section", "{renderLiveSection()}"],
      ["Recent header", "style={styles.mobileRecentHeaderWrap}"],
    ]);
  }

  for (const forbidden of [
    "const hasActiveEvents",
    "{hasActiveEvents ?",
    "const showKpiGrid",
    "{showKpiGrid ?",
    'label="Active events"',
  ]) {
    if (homeCode.includes(forbidden)) {
      fail(
        "C7: active-events-removed",
        `Removed Active events presentation token returned: ${forbidden}`,
      );
    }
  }

  const desktopRecent = homeSource.indexOf('testID="home-desktop-recent-scroll"');
  const wideStart = homeSource.lastIndexOf("{isWideDesktop ? (", desktopRecent);
  const mobileStart = beginIndex;
  if (wideStart === -1 || mobileStart === -1 || mobileStart <= wideStart) {
    fail(
      "C8: responsive-order",
      "Could not isolate the real wide and mobile Home JSX branches.",
    );
  } else {
    const wide = stripComments(homeSource.slice(wideStart, mobileStart));
    assertOrdered("C8: wide-order", wide, [
      ["wide KPI row", "style={styles.desktopKpiGrid}"],
      ["conditional Last 7 days", "{showRevenueTile ? ("],
      ["Last 7 days tile", 'label="Last 7 days"'],
      ["wide Analytics tile", "<AnalyticsHomeTile"],
      ["wide Live section", "{renderLiveSection()}"],
      ["wide Recent section", "style={styles.desktopUpcomingPane}"],
      ["independent desktop Recent scroll", 'testID="home-desktop-recent-scroll"'],
    ]);
  }

  if (countToken(homeCode, "<AnalyticsHomeTile") !== 2) {
    fail(
      "C9: analytics-two-branches",
      "Home must render exactly one AnalyticsHomeTile in each wide/mobile branch.",
    );
  }
  if (!homeCode.includes('router.push("/analytics?entry=home_tile"')) {
    fail(
      "C9: analytics-navigation",
      "AnalyticsHomeTile must route to /analytics?entry=home_tile.",
    );
  }
  if (
    !homeCode.includes(
      "brandAnalyticsKeys.minglaDrove(currentBrand.id)",
    )
  ) {
    fail(
      "C10: analytics-refresh-key",
      "Home refresh must invalidate the current brand's mingla-drove Analytics key.",
    );
  }
  if (!homeCode.includes("data={recent.rows.slice(0, 10)}")) {
    fail(
      "C5: recent-row-extracted",
      "The mobile Recent FlatList must use the bounded recent.rows slice as its source.",
    );
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
  // #1616 [analytics card collapse] — the TOP half of this contract moved from
  // spacing.lg (24) to spacing.sm (8), on purpose. `mobileSectionHeaderRow`
  // .paddingTop was one of three paddings (`mobileKpiOuter.paddingBottom` 16 +
  // `mobileBody.paddingTop` 16 + this 24) that stacked to 56pt of dead space
  // between the analytics card and the "Upcoming" header whenever
  // `renderLiveSection()` returned null. It now converges on the desktop pane's
  // `sectionHeaderRow`, which already used spacing.sm. This gate is where the
  // ORCH-0974 T-04 assertion actually lives (`jest.config.cjs` quarantines
  // `home.orch_0974.test.tsx` with "invariant -> updated
  // orch-0974-home-mobile-lock-pane.mjs"), so the pin is updated in BOTH files.
  // The paddingBottom half is unchanged and still explicitly pinned.
  if (
    sectionHeader === null ||
    !sectionHeader.includes("paddingBottom: spacing.md") ||
    !sectionHeader.includes("paddingTop: spacing.sm")
  ) {
    fail(
      "C3: spacing-contract-explicit",
      "styles.mobileSectionHeaderRow must contain paddingTop: spacing.sm and paddingBottom: spacing.md.",
    );
  }
  if (kpiStack === null || !kpiStack.includes("gap: spacing.sm")) {
    fail(
      "C3: spacing-contract-explicit",
      "styles.mobileKpiStack must contain gap: spacing.sm.",
    );
  }

  if (!homeSource.includes("RecentRow")) {
    fail(
      "C5: recent-row-extracted",
      `${rel(HOME_PATH)} must import and render RecentRow.`,
    );
  }
}

if (
  recentRowSource.length > 0 &&
  !recentRowSource.includes("<EventCoverMedia")
) {
  fail(
    "C5: recent-row-extracted",
    `${rel(RECENT_ROW_PATH)} must render EventCoverMedia.`,
  );
}

if (violations === 0) {
  console.log("[ORCH-0974] OK — Home mobile lock pane invariant holds.");
  process.exit(0);
}

console.error(`[ORCH-0974] FAIL — ${violations} violation(s).`);
console.error(
  "See issue #2794 SPEC Amendment 6 for the current Home lock-pane contract.",
);
process.exit(1);
