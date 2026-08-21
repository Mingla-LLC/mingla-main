#!/usr/bin/env node
// #2399 — buyer-web multi-day selection belongs inside the purchase card and
// owns the displayed multiplier/readiness on both box and floating CTA.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  page: "mingla-business/src/components/event/PublicEventPage.tsx",
  foundation: "mingla-business/src/components/event/FoundationEventPreview.tsx",
  chooser: "mingla-business/src/components/event/MultiDateDayChooser.tsx",
  truth: "mingla-business/src/utils/publicEventOccurrenceTruth.ts",
  shared: "packages/offering-rendering/EventOfferingBody.tsx",
  route: "mingla-business/app/e/[brandSlug]/[eventSlug].tsx",
  test: "mingla-business/src/components/event/__tests__/issue_2399_multiday_picker_ticket_box.happy.test.tsx",
  workflow: ".github/workflows/issue-2399-multiday-picker-ticket-box.yml",
};
const readSources = () =>
  Object.fromEntries(
    Object.entries(PATHS).map(([key, rel]) => [
      key,
      fs.readFileSync(path.join(ROOT, rel), "utf8"),
    ]),
  );
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

export function check(raw) {
  const failures = [];
  const page = code(raw.page);
  const foundation = code(raw.foundation);
  const chooser = code(raw.chooser);
  const truth = code(raw.truth);
  const shared = code(raw.shared);

  if (page.includes("ticketedStateBanner")) {
    failures.push("detached ticketedStateBanner chooser placement returned");
  }
  for (const token of [
    "leadingPurchaseSection={multiDateDayChooser}",
    "priceMultiplier={selectedDayMultiplier}",
    "purchaseReady={multiDatePurchaseReady}",
    "setSelectedOccurrenceIds(NO_SELECTION)",
    '"Pick at least one day above"',
  ]) {
    if (!page.includes(token)) failures.push(`page contract missing: ${token}`);
  }
  if ((page.match(/if \(blockForDayTruth\(\)\) return;/g) ?? []).length !== 3) {
    failures.push("all three checkout entry points do not fail closed on day truth");
  }
  if ((page.match(/leadingPurchaseSection=\{multiDateDayChooser\}/g) ?? []).length !== 2) {
    failures.push("desktop and mobile purchase containers do not share chooser injection");
  }
  if ((page.match(/priceMultiplier=\{selectedDayMultiplier\}/g) ?? []).length !== 3) {
    failures.push("desktop, mobile box, and floating CTA do not share multiplier");
  }
  const dayTruthStart = raw.page.indexOf("  const requiresMultiDatePurchase =");
  const dayTruthEnd = raw.page.indexOf("  const signInResumeHref", dayTruthStart);
  const chooserStart = raw.page.indexOf("  // issue #2399 — app-local");
  const chooserEnd = raw.page.indexOf("  // ORCH-1167-R2", chooserStart);
  const productionDayTruth =
    dayTruthStart === -1 || dayTruthEnd === -1 || chooserStart === -1 || chooserEnd === -1
      ? "missing-issue-2399-production-seam"
      : raw.page.slice(dayTruthStart, dayTruthEnd) + raw.page.slice(chooserStart, chooserEnd);
  if (/NODE_ENV|process\.env|legacyHarnessStateBanner|legacyOneRowHarness/.test(productionDayTruth)) {
    failures.push("test-only production compatibility path is forbidden");
  }

  for (const token of [
    "leadingPurchaseSection={leadingPurchaseSection}",
    "priceMultiplier={priceMultiplier}",
    "purchaseReady={purchaseReady}",
  ]) {
    if (!foundation.includes(token)) failures.push(`foundation passthrough missing: ${token}`);
  }
  const ticketBoxAt = shared.indexOf("export const EventTicketBox");
  const leadingAt = shared.indexOf("          {leadingPurchaseSection}", ticketBoxAt);
  const tiersAt = shared.indexOf("visibleTickets.map", ticketBoxAt);
  if (leadingAt === -1 || tiersAt === -1 || leadingAt >= tiersAt) {
    failures.push("leading purchase section is not before ticket tiers");
  }
  if ((shared.match(/computeRunningTotal\(event\.tickets, ticketQuantities\) \* priceMultiplier/g) ?? []).length !== 2) {
    failures.push("ticket box and floating bar do not both multiply totals");
  }
  if ((shared.match(/!purchaseReady \|\| selectedQty === 0/g) ?? []).length !== 2) {
    failures.push("zero-day total is not unknown on both purchase controls");
  }
  if (!shared.includes('accessibilityLiveRegion="polite"')) {
    failures.push("ticket-box total lacks polite live-region semantics");
  }

  for (const token of [
    'accessibilityLabel="Days you\'re attending"',
    'accessibilityRole="checkbox"',
    'accessibilityRole="alert"',
    '"We couldn’t load the event days."',
    '"You’re offline. Reconnect to continue."',
    '"Those dates just changed. Refresh and choose again."',
    'nativeID="issue-2399-day-section"',
  ]) {
    if (!chooser.includes(token)) failures.push(`chooser state/a11y missing: ${token}`);
  }
  if (chooser.includes('accessibilityRole="radiogroup"')) {
    failures.push("chooser regressed to radio semantics");
  }

  for (const token of [
    "new Map<string, PublicEventOccurrence>()",
    "!validInstant(startAt)",
    "!validInstant(endAt)",
    ".sort(",
  ]) {
    if (!truth.includes(token)) failures.push(`occurrence normalization missing: ${token}`);
  }
  if (!raw.route.includes("onRetryOccurrences") || !raw.route.includes("publicEventQuery.refetch")) {
    failures.push("route does not own occurrence recovery");
  }
  if (!raw.workflow.includes(PATHS.test) || !raw.workflow.includes(PATHS.workflow) ||
      !raw.workflow.includes(PATHS.shared) || !raw.workflow.includes(PATHS.page)) {
    failures.push("workflow does not cover the complete #2399 change surface");
  }
  if (!raw.test.includes("omitting #2399 context preserves the true single-day rendered tree") ||
      !raw.test.includes("zero selected days keeps Total unknown")) {
    failures.push("implementor happy-path regression is incomplete");
  }

  if (failures.length > 0) {
    throw new Error(`issue-2399-multiday-picker-ticket-box:\n- ${failures.join("\n- ")}`);
  }
}

const sources = readSources();
if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    ["page", "leadingPurchaseSection={multiDateDayChooser}", "leadingPurchaseSection={null}"],
    ["page", "if (blockForDayTruth()) return;", "if (false) return;"],
    ["page", "const multiDateDayChooser = requiresMultiDatePurchase ? (", "const multiDateDayChooser = process.env.NODE_ENV === \"test\" ? null : requiresMultiDatePurchase ? ("],
    ["shared", "          {leadingPurchaseSection}", ""],
    ["shared", "* priceMultiplier", "* 1"],
    ["shared", "!purchaseReady || selectedQty === 0", "selectedQty === 0"],
    ["chooser", 'accessibilityRole="checkbox"', 'accessibilityRole="radio"'],
    ["truth", "new Map<string, PublicEventOccurrence>()", "new Map()"],
    ["route", "publicEventQuery.refetch", "Promise.resolve"],
  ];
  for (const [key, from, to] of mutations) {
    if (!sources[key].includes(from)) throw new Error(`self-test fixture missing: ${from}`);
    const changed = { ...sources, [key]: sources[key].replace(from, to) };
    let rejected = false;
    try {
      check(changed);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`self-test mutation survived: ${from}`);
  }
  console.log("issue-2399 multi-day picker ticket box self-test: PASS");
} else {
  check(sources);
  console.log("issue-2399 multi-day picker ticket box: PASS");
}
