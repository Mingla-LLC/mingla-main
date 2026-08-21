#!/usr/bin/env node
// #2230 — Consumer native must carry validated occurrence truth into the
// purchase container and the actual checkout request. --self-test deletes each
// load-bearing seam and proves the gate rejects the reverted shape.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  hook: "app-mobile/src/hooks/usePublicEventBySlug.ts",
  screen: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  sheet: "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  chooser: "app-mobile/src/components/expandedCard/EventDayChooser.tsx",
  flow: "app-mobile/src/payments/nativeCheckoutFlow.ts",
  quantityRow: "packages/offering-rendering/QuantityRow.tsx",
  businessQuantityRow: "mingla-business/src/components/checkout/QuantityRow.tsx",
  workflow: ".github/workflows/issue-2230-consumer-multiday-tests.yml",
};
const readSources = () => Object.fromEntries(
  Object.entries(PATHS).map(([key, rel]) => [key, fs.readFileSync(path.join(ROOT, rel), "utf8")]),
);
const code = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

export function check(raw) {
  const failures = [];
  const hook = code(raw.hook);
  const screen = code(raw.screen);
  const sheet = code(raw.sheet);
  const chooser = code(raw.chooser);
  const flow = code(raw.flow);
  const quantityRow = code(raw.quantityRow);
  const businessQuantityRow = code(raw.businessQuantityRow);
  const workflow = raw.workflow;

  for (const token of [
    "occurrences: mapOccurrences(payload.occurrences, timezone)",
    "isMultiDate: payload.isMultiDate === true",
    'payload.multiDatePricingMode === "all_days" ? "all_days" : "per_day"',
    "const byId = new Map<string, PublicEventOccurrenceLike>()",
    "!isValidInstant(startAt)",
    "!isValidInstant(endAt)",
    ".sort((a, b) =>",
  ]) if (!hook.includes(token)) failures.push(`mapper occurrence contract missing: ${token}`);

  if (!screen.includes("seedProp?.brandSlug ?? brandSlug ?? null") ||
      !screen.includes("seedProp?.eventSlug ?? eventSlug ?? null")) {
    failures.push("warm and cold routes do not both run the canonical bundle");
  }
  if (!screen.includes("canonicalQuery.data.event.id === eventId")) {
    failures.push("warm occurrence truth is not event-id validated");
  }
  if (!raw.hook.includes(
    "const canonical = !seedPresent && canonicalQuery.data ? canonicalQuery.data : null;",
  )) failures.push("directEventColdReadPlan changed");
  if (!screen.includes(
    "const cartTickets = canonical?.event.tickets ?? ticketsQuery.data;",
  ) || !screen.includes("tickets={cartTickets}")) {
    failures.push("named #2242 cartTickets authority changed");
  }
  if (!screen.includes("multiDaySelection={multiDaySelection}")) {
    failures.push("screen does not hand controlled occurrence truth to the cart");
  }
  if (screen.includes("<EventDayChooser")) {
    failures.push("day chooser escaped the purchase container");
  }

  const headerStart = sheet.indexOf("const header = (");
  const headerEnd = sheet.indexOf("const ticketRows", headerStart);
  const header = sheet.slice(headerStart, headerEnd);
  if (headerStart === -1 || headerEnd === -1 ||
      !header.includes("numberOfLines={multiDaySelection === null ? 1 : undefined}") ||
      !header.includes("Get tickets")) {
    failures.push("Consumer ticket-sheet heading does not preserve null-path clamp and unwrap multi-day");
  }
  if (!sheet.includes("allowUnboundedNameWrap={multiDaySelection !== null}") ||
      !quantityRow.includes("allowUnboundedNameWrap?: boolean;") ||
      !quantityRow.includes("allowUnboundedNameWrap = false") ||
      !quantityRow.includes("numberOfLines={allowUnboundedNameWrap ? undefined : 2}")) {
    failures.push("Consumer ticket-name wrapping is not opt-in with a two-line default");
  }
  if (businessQuantityRow.includes("allowUnboundedNameWrap")) {
    failures.push("Business QuantityRow caller opted into Consumer-only unbounded wrapping");
  }
  const testerSuite = "app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx";
  const sharedQuantityRow = "packages/offering-rendering/QuantityRow.tsx";
  if ((workflow.match(new RegExp(testerSuite.replaceAll(".", "\\."), "g")) ?? []).length < 2 ||
      !workflow.includes("src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx") ||
      (workflow.match(new RegExp(sharedQuantityRow.replaceAll(".", "\\."), "g")) ?? []).length < 2) {
    failures.push("scaled-text tester suite or shared QuantityRow is not fully workflow-wired");
  }

  const chooserAt = sheet.indexOf("<EventDayChooser");
  const tiersAt = sheet.indexOf("SELECT YOUR TICKETS", chooserAt);
  if (chooserAt === -1 || tiersAt === -1 || chooserAt >= tiersAt) {
    failures.push("chooser is not first inside the ticket purchase body");
  }
  for (const token of [
    '"Pick at least one day above"',
    "allInCents *= dayMultiplier",
    "totalCents: pricing.allInCents",
    "eventDateIds: selectedEventDateIds",
    'accessibilityLiveRegion="polite"',
    "void Haptics.selectionAsync()",
  ]) if (!sheet.includes(token)) failures.push(`cart contract missing: ${token}`);
  for (const token of [
    'accessibilityLabel="Days you\'re attending"',
    'accessibilityRole="checkbox"',
    'accessibilityRole="alert"',
    "disabled={retryDisabled}",
  ]) if (!chooser.includes(token)) failures.push(`chooser contract missing: ${token}`);
  if (chooser.includes('accessibilityRole="radiogroup"')) {
    failures.push("chooser regressed to radio semantics");
  }
  if (/Intl\.DateTimeFormat|toLocale(?:Date|Time)String/.test(chooser)) {
    failures.push("chooser owns a second date formatter");
  }

  if (!flow.includes("eventDateId?: string | null;")) {
    failures.push("existing singular eventDateId changed");
  }
  if (!flow.includes("eventDateIds?: readonly string[] | null;")) {
    failures.push("multi-day checkout input missing");
  }
  const fingerprintStart = flow.indexOf("const checkoutFingerprint");
  const fingerprintEnd = flow.indexOf("const readHeldHandoff", fingerprintStart);
  const fingerprint = flow.slice(fingerprintStart, fingerprintEnd);
  if (!fingerprint.includes("...(eventDateIds.length > 0 ? { eventDateIds } : {})")) {
    failures.push("non-empty eventDateIds absent from checkout fingerprint");
  }
  const bodyStart = flow.indexOf('"ticket-checkout-create"');
  const bodyEnd = flow.indexOf("if (error)", bodyStart);
  const body = flow.slice(bodyStart, bodyEnd);
  if (!body.includes("? { eventDateIds: normalizedEventDateIds(input) }") ||
      !body.includes("...(input.eventDateId ? { eventDateId: input.eventDateId } : {})")) {
    failures.push("checkout request does not preserve singular and conditionally add plural days");
  }

  if (failures.length > 0) throw new Error(`issue-2230-consumer-carries-occurrences:\n- ${failures.join("\n- ")}`);
}

const sources = readSources();
if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    ["hook", "occurrences: mapOccurrences(payload.occurrences, timezone)", "occurrences: []"],
    ["screen", "seedProp?.brandSlug ?? brandSlug ?? null", "seedProp == null ? (brandSlug ?? null) : null"],
    ["screen", "canonicalQuery.data.event.id === eventId", "true"],
    ["screen", "tickets={cartTickets}", "tickets={ticketsQuery.data}"],
    ["screen", "multiDaySelection={multiDaySelection}", "multiDaySelection={null}"],
    ["sheet", "<EventDayChooser", "<View"],
    ["sheet", "allowUnboundedNameWrap={multiDaySelection !== null}", "allowUnboundedNameWrap={false}"],
    ["sheet", "numberOfLines={multiDaySelection === null ? 1 : undefined}", "numberOfLines={1}"],
    ["quantityRow", "allowUnboundedNameWrap = false", "allowUnboundedNameWrap = true"],
    ["workflow", "src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx", "src/components/expandedCard/__tests__/missing-scaled-text-suite.tsx"],
    ["flow", "...(eventDateIds.length > 0 ? { eventDateIds } : {})", ""],
    ["flow", "? { eventDateIds: normalizedEventDateIds(input) }", "? {}"],
  ];
  for (const [key, from, to] of mutations) {
    if (!sources[key].includes(from)) throw new Error(`self-test fixture missing: ${from}`);
    const changed = { ...sources, [key]: sources[key].replace(from, to) };
    let rejected = false;
    try { check(changed); } catch { rejected = true; }
    if (!rejected) throw new Error(`self-test mutation survived: ${from}`);
  }
  console.log("issue-2230 consumer carries occurrences self-test: PASS");
} else {
  check(sources);
  console.log("issue-2230 consumer carries occurrences: PASS");
}
