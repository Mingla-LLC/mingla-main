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

function enforce(s) {
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
  for (const file of [
    "packages/offering-rendering/__tests__/issue_1902_event_acquisition_lifecycle.test.ts",
    "packages/brand-rendering/__tests__/issue_1902_public_brand_events.test.tsx",
    "mingla-business/src/services/__tests__/issue_1902_public_brand_events.test.ts",
    "mingla-business/src/components/event/__tests__/issue_1902_public_event_acquisition.test.tsx",
    "mingla-business/src/components/event/__tests__/issue_1902_public_event_transition_overlays.test.tsx",
    "app-mobile/src/hooks/__tests__/issue_1902_public_brand_events.test.ts",
    "app-mobile/src/screens/__tests__/issue_1902_brand_event_routing.test.tsx",
    ".github/workflows/issue-1902-public-event-lifecycle-tests.yml",
  ])
    if (!fs.existsSync(file))
      throw new Error(`issue #1902 missing proof file ${file}`);
}

if (process.argv.includes("--self-test")) {
  const mutations = [
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
  console.log(
    `issue #1902 gate self-test: PASS (${mutations.length} mutations)`,
  );
} else {
  enforce(baseline);
  console.log("issue #1902 public event lifecycle gate: PASS");
}
