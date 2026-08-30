import fs from "node:fs";

const files = {
  lifecycle: "packages/offering-rendering/eventAcquisitionLifecycle.ts",
  brand: "packages/brand-rendering/PublicBrandPage.tsx",
  service: "mingla-business/src/services/publicEventsService.ts",
  consumer: "app-mobile/src/hooks/useBrandBySlug.ts",
  consumerDirect: "app-mobile/src/hooks/usePublicEventBySlug.ts",
  consumerScreen: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  direct: "mingla-business/src/components/event/PublicEventPage.tsx",
  checkout: "mingla-business/app/checkout/[eventId]/index.tsx",
  wrapper: "mingla-business/src/components/brand/PublicBrandPage.tsx",
  teaser: "mingla-business/src/components/brand/NextEventTeaser.tsx",
  eventBody: "packages/offering-rendering/EventOfferingBody.tsx",
  rsvpBody: "packages/offering-rendering/RsvpOfferingBody.tsx",
  historical: "mingla-business/src/utils/eventLifecycle.ts",
  eventFoundation:
    "mingla-business/src/components/event/FoundationEventPreview.tsx",
  rsvpFoundation:
    "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
  backendSql:
    "supabase/migrations/20270322001902_issue_1902_public_event_lifecycle.sql",
  backendEdge: "supabase/functions/public-submit-rsvp/index.ts",
  ciManifest: ".github/ci-batch/MANIFEST.json",
};
const baseline = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [
    key,
    fs.readFileSync(file, "utf8"),
  ]),
);
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`issue #1902 missing ${label}`);
};

// [#2438 SC-13] The two reviewed Phase 3B lifecycles. This guard tracks whichever
// one the registry declares instead of pinning shadow, so the SC-21 cutover does
// not red it; a third value is still rejected.
const PHASE3B_LIFECYCLES = ["shadow-active", "batched-historical"];

// [#2438 SC-12/SC-21] This guard's enforcement provider, in semantic identity
// form. SC-21 deleted the historical wrapper, so naming a workflow filename here
// would be a reference to a file that no longer exists. The typed batch suite is
// the provider, and `.github/scripts/strict-grep/MANIFEST.json` names the same
// identity (`ci-batch:<suite-id>`), which meta-1383 P4b binds to that exact
// terminal suite. Named rather than commented so the decoupling stays an
// EXECUTED self-test assertion below.
const CI_BATCH_PROVIDER = "ci-batch:issue-1902-public-event-lifecycle-tests";
const SELF_SOURCE_PATH = ".github/scripts/strict-grep/issue-1902-public-event-lifecycle.mjs";

// Seven PRODUCT proof files. The typed registry contract above replaces the
// wrapper's file-existence check and is stricter: it proves the suite's
// migration wave, lifecycle, 11 outer steps, 4-leaf compound, conditional-file
// registry and typed NODE_PATH env, none of which file existence proved.
const PROOF_FILES = [
  "packages/offering-rendering/__tests__/issue_1902_event_acquisition_lifecycle.test.ts",
  "packages/brand-rendering/__tests__/issue_1902_public_brand_events.test.tsx",
  "mingla-business/src/services/__tests__/issue_1902_public_brand_events.test.ts",
  "mingla-business/src/components/event/__tests__/issue_1902_public_event_acquisition.test.tsx",
  "mingla-business/src/components/event/__tests__/issue_1902_public_event_transition_overlays.test.tsx",
  "app-mobile/src/hooks/__tests__/issue_1902_public_brand_events.test.ts",
  "app-mobile/src/screens/__tests__/issue_1902_brand_event_routing.test.tsx",
];

function enforce(s) {
  let shadowSuite;
  try { shadowSuite = JSON.parse(s.ciManifest).suites.find((suite) => suite.id === "issue-1902-public-event-lifecycle-tests"); } catch {}
  const optionalProofs = [
    "packages/offering-rendering/__tests__/issue_1902_event_acquisition_lifecycle.tester_adversarial.test.ts",
    "packages/brand-rendering/__tests__/issue_1902_public_brand_events.tester_adversarial.test.tsx",
    "mingla-business/src/components/event/__tests__/issue_1902_public_event_acquisition.tester_adversarial.test.tsx",
    "app-mobile/src/hooks/__tests__/issue_1902_public_brand_events.tester_adversarial.test.ts",
  ];
  // [#2438 SC-13] Accept the registry's own reviewed lifecycle — shadow-active
  // today, batched-historical after the SC-21 cutover — so flipping the wave does
  // not red this guard. Any third value still fails closed.
  if (!shadowSuite || shadowSuite.migrationWave !== "phase3b-postgres-wave"
      || !PHASE3B_LIFECYCLES.includes(shadowSuite.lifecycle)
      || shadowSuite.steps?.length !== 11 || shadowSuite.steps?.[6]?.children?.length !== 4
      || JSON.stringify(shadowSuite.conditionalExpectedFiles) !== JSON.stringify([...optionalProofs].sort())
      || JSON.stringify(shadowSuite.steps?.[2]?.env) !== JSON.stringify({ NODE_PATH: "./node_modules" })) {
    throw new Error("issue #1902 typed shadow provider contract drifted");
  }
  requireText(
    s.lifecycle,
    "resolveEventAcquisitionState",
    "single lifecycle owner",
  );
  requireText(s.lifecycle, "2_147_483_000", "safe timer cap");
  requireText(s.lifecycle, "resolveEventTerminal", "terminal resolver");
  requireText(s.lifecycle, "row.startAt", "raw camelCase occurrence start");
  requireText(s.lifecycle, "row.endAt", "raw camelCase occurrence end");
  requireText(s.brand, 'event.eventType === "rsvp"', "RSVP event cards");
  requireText(
    s.brand,
    'if (upcomingEvents.length > 0) tabs.push("events")',
    "current-only Events tab",
  );
  requireText(
    s.service,
    'row.event_type === "event" || row.event_type === "rsvp"',
    "business RSVP admission",
  );
  requireText(
    s.service,
    "MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4",
    "bounded Business bundle hydration",
  );
  requireText(s.service, "payload.tickets", "Business bundle ticket reuse");
  requireText(s.service, 'row.event_type === "rsvp"', "Business RSVP bundle exclusion");
  requireText(
    s.consumer,
    'row.event_type === "event" || row.event_type === "rsvp"',
    "consumer RSVP admission",
  );
  requireText(s.consumer, "MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4", "bounded Consumer bundle hydration");
  requireText(s.consumer, "mapRpcPayloadToPublicEvent", "Consumer bundle mapper reuse");
  requireText(s.consumer, 'row.event_type === "rsvp"', "Consumer RSVP bundle exclusion");
  if (/\.from\(["']ticket_types["']\)/.test(s.consumer)) {
    throw new Error("issue #1902 Consumer brand path retained ticket_types read");
  }
  requireText(s.consumerDirect, "value: payload.occurrences", "Consumer raw occurrence source");
  requireText(s.consumerDirect, "terminalSource", "Consumer canonical terminal source");
  requireText(s.consumerScreen, "validatedDayCanonical.event.acquisitionState", "warm canonical acquisition overlay");
  requireText(s.consumerScreen, "canonicalLifecycleReady", "warm purchase suppression");
  requireText(s.direct, "terminalSource", "Business detail terminal source");
  requireText(s.checkout, "resolveEventCheckoutLifecycleGate", "checkout tri-state adapter");
  requireText(s.checkout, 'checkoutLifecycle.kind === "unavailable"', "checkout unavailable branch");
  requireText(s.checkout, 'checkoutLifecycle.kind === "closed"', "checkout closed branch");
  requireText(s.wrapper, "terminalSource: event.terminalSource", "Business brand terminal pass-through");
  if (/terminalSource\s*:\s*event\.terminalSource\s*(?:\?\?|\?)/.test(s.wrapper)) {
    throw new Error("issue #1902 Business brand terminal source gained a fallback");
  }
  if (/Date\.parse|Date\.now|new Date/.test(s.wrapper)) {
    throw new Error("issue #1902 Business brand wrapper gained local date logic");
  }
  requireText(s.direct, "<EventAcquisitionNotice", "direct lifecycle notice");
  requireText(
    s.direct,
    'acquisitionState.kind === "current"',
    "direct control suppression",
  );
  requireText(s.teaser, 'rsvp: "RSVP"', "RSVP upcoming teaser label");
  requireText(
    s.eventBody,
    "acquisitionClosed || hideTicketBox",
    "ticket control suppression",
  );
  requireText(
    s.eventBody,
    "!acquisitionClosed && ticketsLeftLabel",
    "ended ticket inventory suppression",
  );
  requireText(
    s.eventBody,
    "capacity: null, hideRemainingCount: true",
    "read-only historical social proof",
  );
  requireText(
    s.eventBody,
    "acquisitionClosed ? undefined : onSeeWhosGoing",
    "ended guest-action suppression",
  );
  requireText(s.direct, "setGateVisible(false)", "guest gate transition closure");
  requireText(
    s.direct,
    "setWaitlistTicketId(null)",
    "waitlist transition closure",
  );
  requireText(
    s.rsvpBody,
    "acquisitionClosed || hideDecisionBox",
    "RSVP control suppression",
  );
  requireText(
    s.rsvpBody,
    "!acquisitionClosed && state.chipInInlinePanel",
    "contribution suppression",
  );
  requireText(
    s.rsvpBody,
    "setSuccessDetails(null)",
    "stale-write success overlay closure",
  );
  requireText(
    s.rsvpBody,
    'setChipInState("idle")',
    "stale-write chip-in closure",
  );
  requireText(
    s.eventFoundation,
    'animation: "none"',
    "ticket history animation suppression",
  );
  requireText(
    s.rsvpFoundation,
    'animation: "none"',
    "RSVP history animation suppression",
  );
  requireText(s.backendSql, "P1901", "backend ended dependency seal");
  requireText(s.backendSql, "P1902", "backend unavailable dependency seal");
  requireText(s.backendEdge, 'case "P1901"', "Edge 410 dependency seal");
  requireText(s.backendEdge, 'case "P1902"', "Edge 409 dependency seal");
  for (const key of ["brand", "service", "consumer", "direct"]) {
    requireText(
      s[key],
      "resolveEventAcquisitionState",
      `${key} lifecycle caller`,
    );
  }
  const declarationCount = Object.values(s).reduce(
    (count, source) =>
      count +
      (source.match(/export const resolveEventAcquisitionState\s*=/g)?.length ??
        0),
    0,
  );
  if (declarationCount !== 1)
    throw new Error(`issue #1902 lifecycle owner count ${declarationCount}`);
  const forbiddenComparator =
    /(?:masterEndAtUtc|endedAt)[^\n]*(?:Date\.now|new Date|Date\.parse)/;
  for (const key of [
    "brand",
    "service",
    "consumer",
    "direct",
    "eventBody",
    "rsvpBody",
  ]) {
    if (forbiddenComparator.test(s[key]))
      throw new Error(`issue #1902 local lifecycle fork in ${key}`);
  }
  requireText(
    s.historical,
    "computeMasterEndAtUtc",
    "sealed historical helper",
  );
  for (const file of PROOF_FILES)
    if (!fs.existsSync(file))
      throw new Error(`issue #1902 missing proof file ${file}`);
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    ["ciManifest", '"phase3b-postgres-wave"'],
    ["lifecycle", "resolveEventAcquisitionState"],
    ["lifecycle", "2_147_483_000"],
    ["brand", 'event.eventType === "rsvp"'],
    ["brand", 'if (upcomingEvents.length > 0) tabs.push("events")'],
    ["service", 'row.event_type === "event" || row.event_type === "rsvp"'],
    ["service", "MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4"],
    ["service", "payload.tickets"],
    ["service", 'row.event_type === "rsvp"'],
    ["consumer", 'row.event_type === "event" || row.event_type === "rsvp"'],
    ["consumer", "MAX_PUBLIC_BRAND_EVENT_BUNDLE_CONCURRENCY = 4"],
    ["consumer", "mapRpcPayloadToPublicEvent"],
    ["consumerDirect", "value: payload.occurrences"],
    ["consumerDirect", "terminalSource"],
    ["consumerScreen", "validatedDayCanonical.event.acquisitionState"],
    ["consumerScreen", "canonicalLifecycleReady"],
    ["direct", "terminalSource"],
    ["checkout", "resolveEventCheckoutLifecycleGate"],
    ["checkout", 'checkoutLifecycle.kind === "unavailable"'],
    ["checkout", 'checkoutLifecycle.kind === "closed"'],
    ["wrapper", "terminalSource: event.terminalSource"],
    ["direct", "<EventAcquisitionNotice"],
    ["direct", 'acquisitionState.kind === "current"'],
    ["teaser", 'rsvp: "RSVP"'],
    ["historical", "computeMasterEndAtUtc"],
    ["eventBody", "acquisitionClosed || hideTicketBox"],
    ["eventBody", "!acquisitionClosed && ticketsLeftLabel"],
    ["eventBody", "capacity: null, hideRemainingCount: true"],
    ["eventBody", "acquisitionClosed ? undefined : onSeeWhosGoing"],
    ["direct", "setGateVisible(false)"],
    ["direct", "setWaitlistTicketId(null)"],
    ["rsvpBody", "acquisitionClosed || hideDecisionBox"],
    ["rsvpBody", "!acquisitionClosed && state.chipInInlinePanel"],
    ["eventFoundation", 'animation: "none"'],
    ["rsvpBody", "setSuccessDetails(null)"],
    ["rsvpBody", 'setChipInState("idle")'],
    ["rsvpFoundation", 'animation: "none"'],
    ["backendSql", "P1901"],
    ["backendSql", "P1902"],
    ["backendEdge", 'case "P1901"'],
    ["backendEdge", 'case "P1902"'],
  ];
  for (const [key, needle] of mutations) {
    const mutated = {
      ...baseline,
      [key]: baseline[key].replaceAll(needle, "MUTATED"),
    };
    let failed = false;
    try {
      enforce(mutated);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`self-test survived ${key}:${needle}`);
  }

  for (const [label, wrapper] of [
    [
      "Business brand terminal fallback",
      baseline.wrapper.replace(
        "terminalSource: event.terminalSource",
        "terminalSource: event.terminalSource ?? { kind: \"single_end\", endAtUtc: event.masterEndAtUtc }",
      ),
    ],
    [
      "Business brand local date parsing",
      baseline.wrapper.replace(
        "terminalSource: event.terminalSource",
        "terminalSource: event.terminalSource, lifecycleProbe: Date.parse(event.masterEndAtUtc ?? \"\")",
      ),
    ],
  ]) {
    let failed = false;
    try {
      enforce({ ...baseline, wrapper });
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`self-test survived injected ${label}`);
  }

  // [#2438 SC-13/SC-17] Execute the terminal branch instead of merely writing it.
  const withPhase3bLifecycle = (value) => {
    const document = JSON.parse(baseline.ciManifest);
    for (const suite of document.suites) {
      if (suite.migrationWave === "phase3b-postgres-wave") suite.lifecycle = value;
    }
    return { ...baseline, ciManifest: JSON.stringify(document) };
  };
  // 1. The SC-21 terminal lifecycle must PASS. Before #2438 this threw.
  for (const accepted of PHASE3B_LIFECYCLES) {
    try {
      enforce(withPhase3bLifecycle(accepted));
    } catch (error) {
      throw new Error(`self-test rejected reviewed lifecycle ${accepted}: ${error.message}`);
    }
  }
  // 2. Widening to the terminal value must not widen to anything else.
  for (const forged of ["shadow-inactive", "batched-active", "phase3b-forged", "SHADOW-ACTIVE", "", null]) {
    let failed = false;
    try { enforce(withPhase3bLifecycle(forged)); } catch { failed = true; }
    if (!failed) throw new Error(`self-test survived forged lifecycle ${JSON.stringify(forged)}`);
  }
  // 3. Restored-terminal-wrapper decoupling: no mandatory proof file may be a CI
  //    provider of any kind, or SC-21's deletion reds this gate again.
  if (PROOF_FILES.includes(CI_BATCH_PROVIDER)) {
    throw new Error(`issue #1902 mandatory proof list re-coupled to its CI provider ${CI_BATCH_PROVIDER}`);
  }
  for (const file of PROOF_FILES) {
    if (file.startsWith(".github/workflows/")) {
      throw new Error(`issue #1902 mandatory proof list re-coupled to a deletable CI wrapper: ${file}`);
    }
  }
  // 3b. [#2438 SC-12] Falsifiable, whole-module decoupling: this gate must name
  //     NO workflow file at all. Re-introducing any `.github/workflows/*.yml`
  //     literal anywhere in this module — the exact re-coupling SC-21 forbids —
  //     reds the self-test here rather than at the next cutover.
  const selfSource = fs.readFileSync(SELF_SOURCE_PATH, "utf8");
  const workflowLiterals = [...new Set(selfSource.match(/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml/g) || [])];
  if (workflowLiterals.length !== 0) {
    throw new Error(`issue #1902 gate re-coupled to deletable workflow file(s): ${workflowLiterals.join(", ")}`);
  }
  if (PROOF_FILES.length !== 7) throw new Error(`issue #1902 expects exactly 7 product proof files, found ${PROOF_FILES.length}`);
  console.log(
    `issue #1902 gate self-test: PASS (${mutations.length} removals, 2 injected wrapper mutations, ${PHASE3B_LIFECYCLES.length} accepted lifecycles, 6 forged lifecycles, ${PROOF_FILES.length} decoupled product proofs, 0 workflow-file literals, provider ${CI_BATCH_PROVIDER})`,
  );
} else {
  enforce(baseline);
  console.log("issue #1902 public event lifecycle gate: PASS");
}
