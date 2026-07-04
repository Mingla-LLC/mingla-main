import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1291 [rsvp-chip-in] — gap-closure regression (report §10.A). The shared
// RsvpOfferingBody renders the guest chip-in panel ONLY when
// `config.rsvp_contribution_enabled` reaches it. The 3 config columns live on
// `events`, but the READ path never surfaced them, so the panel stayed DARK on
// consumer + buyer-web. This locks the config flow end-to-end:
//   events → business_public_events_view (the view SELECTs them)
//         → fetchRsvpMomentum (consumer read) → ConsumerEventDetailScreen config
//         → publicEventViewRowToEvent (buyer-web read) → PublicEventPage config
//         → the shared body's chip-in panel gate.
//
// rsvpDeckService / the screens / publicEventsService import RN + workspace
// packages, so per the established app-mobile service-test pattern
// (rsvpDeckService.orch1150.test.ts, orch_1157_rsvp_consumer.test.ts) we read
// the source as TEXT and assert the locked contract — no module resolution.
//
// FAILS-ON-REVERT: deleting any surfaced column / mapping / config-feed / the
// web onChipIn wiring makes the relevant assertion FAIL (proven by true
// line-deletion in the implementation report §6).

const repoRoot = new URL("../../../../", import.meta.url); // app-mobile/ root
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/20261220000000_orch_1291_rsvp_contributions.sql",
    repoRoot,
  ),
);
const svc = await Deno.readTextFile(
  new URL("../rsvpDeckService.ts", import.meta.url),
);
const screen = await Deno.readTextFile(
  new URL("../../screens/Event/ConsumerEventDetailScreen.tsx", import.meta.url),
);
const bizSvc = await Deno.readTextFile(
  new URL("mingla-business/src/services/publicEventsService.ts", repoRoot),
);
const bizPage = await Deno.readTextFile(
  new URL("mingla-business/src/components/event/PublicEventPage.tsx", repoRoot),
);
const liveStore = await Deno.readTextFile(
  new URL("mingla-business/src/store/liveEventStore.ts", repoRoot),
);

Deno.test("ORCH-1291 A1: the anon view SELECTs the 3 chip-in config columns", () => {
  // The CREATE OR REPLACE VIEW must expose the columns anon-safe (report §10.A);
  // without this the reads below have nothing to select.
  assertStringIncludes(migration, "CREATE OR REPLACE VIEW public.business_public_events_view");
  assertStringIncludes(migration, "e.rsvp_contribution_enabled");
  assertStringIncludes(migration, "e.rsvp_contribution_suggested_cents");
  assertStringIncludes(migration, "e.rsvp_contribution_min_cents");
  // Anon-safety preserved: still definer, never joins to expose owner data.
  assertStringIncludes(migration, "security_invoker = false");
});

Deno.test("ORCH-1291 A2: consumer fetchRsvpMomentum selects + maps the 3 columns", () => {
  assertStringIncludes(svc, 'from("business_public_events_view")');
  assertStringIncludes(svc, "rsvp_contribution_enabled");
  assertStringIncludes(svc, "rsvp_contribution_suggested_cents");
  assertStringIncludes(svc, "rsvp_contribution_min_cents");
  // mapped into the camelCase snapshot the consumer screen reads.
  assertStringIncludes(svc, "rsvpContributionEnabled: row.rsvp_contribution_enabled");
  assertStringIncludes(svc, "rsvpContributionSuggestedCents: row.rsvp_contribution_suggested_cents");
  assertStringIncludes(svc, "rsvpContributionMinCents: row.rsvp_contribution_min_cents");
});

Deno.test("ORCH-1291 A3: consumer screen feeds the config into RsvpOfferingConfig", () => {
  assertStringIncludes(screen, "rsvp_contribution_enabled: rsvpMomentum?.rsvpContributionEnabled");
  assertStringIncludes(screen, "rsvp_contribution_suggested_cents: rsvpMomentum?.rsvpContributionSuggestedCents");
  assertStringIncludes(screen, "rsvp_contribution_min_cents: rsvpMomentum?.rsvpContributionMinCents");
  // the panel gate also needs onChipIn wired (already present pre-gap).
  assertStringIncludes(screen, "onChipIn: handleChipIn");
});

Deno.test("ORCH-1291 A4: buyer-web read maps the 3 columns into the LiveEvent", () => {
  assertStringIncludes(bizSvc, "rsvpContributionEnabled: row.rsvp_contribution_enabled");
  assertStringIncludes(bizSvc, "rsvpContributionSuggestedCents: row.rsvp_contribution_suggested_cents");
  assertStringIncludes(bizSvc, "rsvpContributionMinCents: row.rsvp_contribution_min_cents");
  // the LiveEvent type carries the optional fields.
  assertStringIncludes(liveStore, "rsvpContributionEnabled?: boolean");
});

Deno.test("ORCH-1291 A5: buyer-web page feeds config + wires the web onChipIn", () => {
  assertStringIncludes(bizPage, "rsvp_contribution_enabled: event.rsvpContributionEnabled");
  assertStringIncludes(bizPage, "settlementCurrency: event.currency");
  assertStringIncludes(bizPage, "onChipIn={handleChipIn}");
  // onChipIn calls the contribution service on the WEB surface and redirects.
  assertStringIncludes(bizPage, "submitRsvpContribution");
  assertStringIncludes(bizPage, 'surface: "web"');
  assert(bizPage.includes("requires_web_redirect") || bizPage.includes("hostedCheckoutUrl"));
});
