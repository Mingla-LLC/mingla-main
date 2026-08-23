import fs from "node:fs";

const files = {
  lifecycle: "packages/offering-rendering/eventAcquisitionLifecycle.ts",
  brand: "packages/brand-rendering/PublicBrandPage.tsx",
  service: "mingla-business/src/services/publicEventsService.ts",
  consumer: "app-mobile/src/hooks/useBrandBySlug.ts",
  direct: "mingla-business/src/components/event/PublicEventPage.tsx",
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

// [#2438 SC-13] The historical CI wrapper this guard is DECOUPLED from. SC-21
// deletes it, and a guard that hard-requires the file the cutover deletes cannot
// authorise that cutover. Named rather than commented so the decoupling is a
// executed self-test assertion below, and so this module keeps its reviewed
// workflow-provider reference (registry record
// issue-1902-public-event-lifecycle-tests.yml -> this file).
const DECOUPLED_CI_WRAPPER = ".github/workflows/issue-1902-public-event-lifecycle-tests.yml";

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
    'row.event_type === "event" ? fetchTickets(row.id) : []',
    "RSVP ticket-read exclusion",
  );
  requireText(
    s.consumer,
    'row.event_type === "event" || row.event_type === "rsvp"',
    "consumer RSVP admission",
  );
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
    ["service", 'row.event_type === "event" ? fetchTickets(row.id) : []'],
    ["consumer", 'row.event_type === "event" || row.event_type === "rsvp"'],
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
  // 3. Restored-terminal-wrapper decoupling: no mandatory proof file may be the
  //    historical CI wrapper, or SC-21's deletion reds this gate again.
  if (PROOF_FILES.includes(DECOUPLED_CI_WRAPPER)) {
    throw new Error(`issue #1902 mandatory proof list re-coupled to the deletable CI wrapper ${DECOUPLED_CI_WRAPPER}`);
  }
  for (const file of PROOF_FILES) {
    if (file.startsWith(".github/workflows/")) {
      throw new Error(`issue #1902 mandatory proof list re-coupled to a deletable CI wrapper: ${file}`);
    }
  }
  if (PROOF_FILES.length !== 7) throw new Error(`issue #1902 expects exactly 7 product proof files, found ${PROOF_FILES.length}`);
  console.log(
    `issue #1902 gate self-test: PASS (${mutations.length} mutations, ${PHASE3B_LIFECYCLES.length} accepted lifecycles, 6 forged lifecycles, ${PROOF_FILES.length} decoupled product proofs)`,
  );
} else {
  enforce(baseline);
  console.log("issue #1902 public event lifecycle gate: PASS");
}
