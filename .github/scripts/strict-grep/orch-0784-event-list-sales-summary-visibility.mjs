#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const failures = [];

const assertIncludes = (file, needle, message) => {
  if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertNotIncludes = (file, needle, message) => {
  if (read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertRegexAbsent = (file, regex, message) => {
  if (regex.test(read(file))) failures.push(`${file}: ${message}`);
};

const packageJson = JSON.parse(read("mingla-business/package.json"));
const testScript = packageJson.scripts?.["test:orch-0784"] ?? "";
if (
  !testScript.includes(
    "orch-0784-event-list-sales-summary-visibility.mjs",
  ) ||
  !testScript.includes("eventSalesSummary.test")
) {
  failures.push(
    "mingla-business/package.json: test:orch-0784 must run the strict-grep gate and eventSalesSummary.test",
  );
}

assertIncludes(
  "mingla-business/src/utils/eventSalesSummary.ts",
  "buildEventSalesSummary",
  "shared sales summary helper must exist",
);
assertIncludes(
  "mingla-business/src/utils/eventSalesSummary.ts",
  "formatCurrencyRound(moneySummary.onlineRevenue, displayCurrency)",
  "true zero revenue must format as currency zero",
);
assertIncludes(
  "mingla-business/src/hooks/useEventOrders.ts",
  "useEventSalesSummaries",
  "Home must have a server-backed event sales summary hook",
);

assertNotIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "useOrderStore",
  "Home non-draft sales summaries must not import/read local orderStore",
);
assertNotIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "getSoldCountForEvent",
  "Home must not use local sold-count selectors for event rows",
);
assertNotIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "getRevenueForEvent",
  "Home must not use local revenue selectors for event rows",
);
assertNotIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "getRevenueSummaryForEvent",
  "Home must not use local revenue-summary selectors for event rows",
);
assertNotIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "orderEntries",
  "Home must not derive list revenue from local order entries",
);
assertIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "useEventSalesSummaries",
  "Home must consume server-backed sales summaries",
);
assertIncludes(
  "mingla-business/app/(tabs)/home.tsx",
  "eventRevenueValue",
  "Home event rows must render an amount-made value",
);

assertIncludes(
  "mingla-business/src/components/event/EventListCard.tsx",
  "buildEventSalesSummary",
  "EventListCard must use the shared sales summary helper",
);
assertIncludes(
  "mingla-business/src/components/event/EventListCard.tsx",
  "salesSummary.soldLabel",
  "EventListCard must render sold label outside finite-only capacity paths",
);
assertIncludes(
  "mingla-business/src/components/event/EventListCard.tsx",
  "salesSummary.revenueLabel",
  "EventListCard must render summary revenue label",
);
assertRegexAbsent(
  "mingla-business/src/components/event/EventListCard.tsx",
  /revenue\w*\s*>\s*0[\s\S]{0,260}["']—["']/,
  "EventListCard must not branch true zero revenue to a dash",
);
assertRegexAbsent(
  "mingla-business/src/components/event/EventListCard.tsx",
  /totalCapacity\s*>\s*0\s*\?/,
  "EventListCard must not gate sold visibility on totalCapacity > 0",
);

const workflow = read(".github/workflows/strict-grep-mingla-business.yml");
if (!workflow.includes("orch-0784-event-list-sales-summary-visibility")) {
  failures.push(
    ".github/workflows/strict-grep-mingla-business.yml: missing ORCH-0784 strict-grep job",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0784 event list sales summary visibility guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0784 event list sales summary visibility guard passed.");
