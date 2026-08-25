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
  // [#2439 SC-15 item 5] Was ".github/workflows/issue-2230-consumer-multiday-tests.yml".
  // That wrapper is deleted at Phase 3C cutover; the CI registry is where #2230's
  // trigger provenance and executed assertions live from the shadow commit
  // onward. The three properties this guard protected are unchanged, expressed
  // against the registry instead of a filename.
  registry: ".github/ci-batch/MANIFEST.json",
};
const readSources = () => Object.fromEntries(
  Object.entries(PATHS).map(([key, rel]) => [key, fs.readFileSync(path.join(ROOT, rel), "utf8")]),
);
const code = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SUITE_ID = "issue-2230-consumer-multiday-tests";
const ORIGIN = ".github/workflows/issue-2230-consumer-multiday-tests.yml";
const DENO_V2_ACTION = "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed";

/**
 * [#2439 SC-15.1] The same three protections the workflow read enforced, now
 * against the CI registry: the tester suite is named in BOTH trigger path lists
 * (the two occurrences the old regex counted), it is executed by a real leaf
 * with the right cwd, and the shared QuantityRow is named in both path lists.
 * Runtime, action pin, permissions and environment are checked too, because a
 * filename read could never see them.
 *
 * Pure: takes the parsed registry so every mutant runs in memory.
 */
export function ciWiring(manifest, testerSuite, sharedQuantityRow) {
  const failures = [];
  const suites = (manifest.suites || []).filter((suite) => suite.id === SUITE_ID);
  if (suites.length !== 1) {
    failures.push(`expected exactly one ${SUITE_ID} suite in the CI registry, got ${suites.length}`);
    return failures;
  }
  const [suite] = suites;
  if (suite.migrationWave !== "phase3c-deno-wave") failures.push("suite is not owned by phase3c-deno-wave");
  if (suite.origin !== ORIGIN) failures.push(`provider identity drifted: ${suite.origin}`);
  const pathLists = [suite.triggerContract?.push?.paths, suite.triggerContract?.pullRequest?.paths];
  for (const [label, needle] of [["tester suite", testerSuite], ["shared QuantityRow", sharedQuantityRow]]) {
    const occurrences = pathLists.filter((list) => Array.isArray(list) && list.includes(needle)).length;
    if (occurrences !== 2) failures.push(`${label} is named in ${occurrences} of 2 trigger path lists`);
  }
  const leaves = (suite.steps || []).flatMap((step) => (step.children || []).map((child) => ({ step, child })));
  const executesTester = leaves.some(({ step, child }) => (child.cwd ?? step.cwd) === "app-mobile"
    && (child.invocation?.argv?.[1] || "").includes("src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx"));
  if (!executesTester) failures.push("no app-mobile leaf executes the scaled-text tester suite");
  if (!(suite.expectedFiles || []).includes(testerSuite)) failures.push("tester suite is not a registered expected file");
  // The shared QuantityRow is a guarded SOURCE file, not a test the suite names
  // in a command, so it belongs to the origin path provenance rather than the
  // command-derived expected-file inventory. Both are asserted, each where it
  // actually lives.
  if (!(suite.originPaths || []).includes(sharedQuantityRow)) failures.push("shared QuantityRow left the origin path provenance");
  const runtime = suite.runtime || {};
  if (runtime.name !== "node+deno" || runtime.nodeVersion !== "22" || runtime.deno?.action !== DENO_V2_ACTION) {
    failures.push(`runtime or Deno action pin drifted: ${JSON.stringify(runtime)}`);
  }
  if ((suite.envNames || []).length) failures.push("suite gained an environment capability");
  if (JSON.stringify(suite.triggerContract?.permissions) !== JSON.stringify(["contents: read"])) {
    failures.push("trust boundary drifted from contents: read");
  }
  const wrapperLive = fs.existsSync(path.join(ROOT, ORIGIN));
  if (suite.lifecycle === "batched-historical" && wrapperLive) failures.push("terminal wrapper was restored");
  if (suite.lifecycle === "shadow-active" && !wrapperLive) failures.push("shadow wrapper is missing");
  // [#2439 SC-15.1] Lifecycle consistency asserted PURELY from the registry, so
  // it is falsifiable in memory: at shadow the legacy origin names its own
  // wrapper as sole provider, at terminal it must name the batch umbrella. A
  // batched record still naming its deleted wrapper is the SC-18.3 attack.
  const legacyOrigin = (manifest.legacyOrigins || []).find((item) => `${item.stem}.${item.extension}` === ORIGIN.split("/").pop());
  const namesItself = legacyOrigin?.providerWorkflow === ORIGIN;
  if (!legacyOrigin || namesItself !== (suite.lifecycle !== "batched-historical")) {
    failures.push("legacy origin does not name the sole provider for this lifecycle");
  }
  return failures;
}

export function check(raw) {
  const failures = [];
  const hook = code(raw.hook);
  const screen = code(raw.screen);
  const sheet = code(raw.sheet);
  const chooser = code(raw.chooser);
  const flow = code(raw.flow);
  const quantityRow = code(raw.quantityRow);
  const businessQuantityRow = code(raw.businessQuantityRow);

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
  failures.push(...ciWiring(JSON.parse(raw.registry), testerSuite, sharedQuantityRow));

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
  if (!sheet.includes("const pricing = (():") ||
      /const pricing = useMemo<[\s\S]{0,1800}selectedEventDateIds/.test(sheet)) {
    failures.push("day-priced cart total can remain stale behind the native sheet host");
  }
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
    ["sheet", "const pricing = (():", "const pricing = useMemo<"],
    ["quantityRow", "allowUnboundedNameWrap = false", "allowUnboundedNameWrap = true"],
    // [#2439 SC-15.1] The workflow-text mutant is replaced by registry mutants
    // that attack the same three properties plus the ones a filename read could
    // not see. All of them are applied to the registry JSON in memory.
    ["registry", '"issue-2230-consumer-multiday-tests"', '"issue-2230-consumer-multiday-tests-renamed"'],
    ["registry", "issue_2230_cart_days.test.tsx src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx", "issue_2230_cart_days.test.tsx"],
    ["registry", '"app-mobile/src/components/expandedCard/__tests__/issue_2230_scaled_text.tester_adversarial.test.tsx"', '"app-mobile/src/components/expandedCard/__tests__/gone.tsx"'],
    ["registry", '"packages/offering-rendering/QuantityRow.tsx"', '"packages/offering-rendering/Gone.tsx"'],
    ["registry", ORIGIN, ".github/workflows/not-a-real-workflow-identity"],
    ["registry", '"phase3c-deno-wave"', '"phase3d-unreviewed-wave"'],
    ["registry", DENO_V2_ACTION, "denoland/setup-deno@v2"],
    ["registry", '"contents: read"', '"contents: write"'],
    // Attacks the registry-only lifecycle/provider agreement above. Removing the
    // legacy origin record fires on BOTH sides of cutover, so unlike a mutant
    // pinned to one lifecycle value it never becomes unfalsifiable.
    ["registry", '"stem": "issue-2230-consumer-multiday-tests"', '"stem": "issue-2230-consumer-multiday-tests-gone"'],
    ["flow", "...(eventDateIds.length > 0 ? { eventDateIds } : {})", ""],
    ["flow", "? { eventDateIds: normalizedEventDateIds(input) }", "? {}"],
  ];
  for (const [key, from, to] of mutations) {
    if (!sources[key].includes(from)) throw new Error(`self-test fixture missing: ${from}`);
    // The registry is JSON: one identity can appear in originPaths, in both
    // trigger path lists and in a leaf argv, so a registry mutant replaces EVERY
    // occurrence. A first-occurrence-only mutant would silently leave the
    // assertion it was written to attack still satisfied.
    const changed = { ...sources, [key]: key === "registry" ? sources[key].split(from).join(to) : sources[key].replace(from, to) };
    let rejected = false;
    try { check(changed); } catch { rejected = true; }
    if (!rejected) throw new Error(`self-test mutation survived: ${from}`);
  }
  console.log("issue-2230 consumer carries occurrences self-test: PASS");
} else {
  check(sources);
  console.log("issue-2230 consumer carries occurrences: PASS");
}
