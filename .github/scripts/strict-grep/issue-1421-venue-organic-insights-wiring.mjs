#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const PATHS = {
  module: "mingla-business/src/components/venue/VenueIntelligenceModule.tsx",
  section:
    "mingla-business/src/components/venue/VenueOrganicEngagementSection.tsx",
  hook: "mingla-business/src/hooks/useVenueOrganicInsights.ts",
  service:
    "mingla-business/src/services/venueOrganicInsightsService.ts",
  capture: "supabase/functions/venue-organic-capture/index.ts",
  classifier: "supabase/functions/_shared/entrySource.ts",
  attribution: "supabase/functions/attribution-capture/index.ts",
  reservation: "supabase/functions/venue-reservation-create/index.ts",
  migration:
    "supabase/migrations/20270202001421_issue_1421_venue_organic_engagement.sql",
  buyer: "mingla-business/src/components/venue/PublicVenuePage.tsx",
  buyerAvailability:
    "mingla-business/src/components/venue/GuestVenueReservation.tsx",
  consumer: "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
};

function load() {
  return new Map(
    Object.values(PATHS).map((file) => [
      file,
      fs.readFileSync(path.join(root, file), "utf8"),
    ]),
  );
}

function validate(files) {
  const failures = [];
  const get = (file) => files.get(file) ?? "";
  const module = get(PATHS.module);
  if (/Coming soon|COMING SOON|Busy hours|Signal to bookings/.test(module)) {
    failures.push("Venue Overview still contains roadmap/foot-traffic placeholders");
  }
  const reservationsAt = module.indexOf("<VenueReservationsCard");
  const organicAt = module.indexOf("<VenueOrganicEngagementSection");
  const slowHoursAt = module.indexOf(">Slow hours<");
  if (
    reservationsAt < 0 ||
    organicAt <= reservationsAt ||
    slowHoursAt <= organicAt
  ) {
    failures.push(
      "Venue Overview order must be Reservations, Organic engagement, Slow hours",
    );
  }
  for (const copy of [
    "Venue page activity",
    "When people browse online",
    "Organic reservation journey",
    "Unpaid activity on this venue&apos;s Mingla page.",
  ]) {
    if (!get(PATHS.section).includes(copy)) {
      failures.push(`organic card contract missing: ${copy}`);
    }
  }
  if (
    !/venueOrganicInsightsKeys\.detail\(brandId,\s*venueId\)/.test(get(PATHS.hook)) ||
    !/const enabled = isAuthReady && brandId !== null && venueId !== null/.test(
      get(PATHS.hook),
    )
  ) {
    failures.push("organic query is not auth-ready and exact-brand+venue keyed");
  }
  if (
    !/supabase\.rpc\("venue_organic_engagement_rollup"/.test(
      get(PATHS.service),
    )
  ) {
    failures.push("Business service must read only the aggregate RPC");
  }
  const capture = get(PATHS.capture);
  if (
    !capture.includes('surface !== "buyer_web"') ||
    !capture.includes('reason: "source_unproven"') ||
    !capture.includes('["search", "social", "organic", "direct"]') ||
    !capture.includes('reason: "source_ineligible"')
  ) {
    failures.push("public capture source/surface allowlist is not fail-closed");
  }
  const migration = get(PATHS.migration);
  for (const required of [
    "FORCE ROW LEVEL SECURITY",
    "REVOKE ALL ON public.venue_organic_journeys FROM PUBLIC, anon, authenticated",
    "REVOKE ALL ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid)",
    "GRANT EXECUTE ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid)",
    "issue_1421_venue_organic_retention",
    "cleanup_venue_organic_engagement(5000)",
    "reservation.status NOT IN ('cancelled_by_guest','cancelled_by_venue')",
  ]) {
    if (!migration.includes(required)) failures.push(`migration contract missing: ${required}`);
  }
  if (
    !get(PATHS.attribution).includes('from "../_shared/entrySource.ts"') ||
    !get(PATHS.classifier).includes("export function classifyEntrySource")
  ) {
    failures.push("#855 classifier was not preserved through the shared owner");
  }
  if (
    !get(PATHS.reservation).includes("organic_journey_id") ||
    !get(PATHS.reservation).includes("organicJourneyToken")
  ) {
    failures.push("reservation journey token is not threaded to checkout sessions");
  }
  const interactionSources = [
    get(PATHS.buyer),
    get(PATHS.buyerAvailability),
    get(PATHS.consumer),
  ].join("\n");
  for (const eventType of [
    '"page_view"',
    '"menu_open"',
    '"reservation_start"',
    '"availability_shown"',
  ]) {
    if (!interactionSources.includes(eventType)) {
      failures.push(`capture point missing: ${eventType}`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const good = new Map(
    Object.values(PATHS).map((file) => [file, ""]),
  );
  good.set(
    PATHS.module,
    "safe <VenueReservationsCard <VenueOrganicEngagementSection >Slow hours<",
  );
  good.set(
    PATHS.section,
    "Venue page activity When people browse online Organic reservation journey Unpaid activity on this venue&apos;s Mingla page.",
  );
  good.set(
    PATHS.hook,
    "const enabled = isAuthReady && brandId !== null && venueId !== null; venueOrganicInsightsKeys.detail(brandId, venueId)",
  );
  good.set(PATHS.service, 'supabase.rpc("venue_organic_engagement_rollup"');
  good.set(
    PATHS.capture,
    'surface !== "buyer_web" reason: "source_unproven" ["search", "social", "organic", "direct"] reason: "source_ineligible"',
  );
  good.set(
    PATHS.migration,
    "FORCE ROW LEVEL SECURITY REVOKE ALL ON public.venue_organic_journeys FROM PUBLIC, anon, authenticated REVOKE ALL ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid) GRANT EXECUTE ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid) issue_1421_venue_organic_retention cleanup_venue_organic_engagement(5000) reservation.status NOT IN ('cancelled_by_guest','cancelled_by_venue')",
  );
  good.set(PATHS.attribution, 'from "../_shared/entrySource.ts"');
  good.set(PATHS.classifier, "export function classifyEntrySource");
  good.set(PATHS.reservation, "organic_journey_id organicJourneyToken");
  good.set(PATHS.buyer, '"page_view" "menu_open" "reservation_start"');
  good.set(PATHS.buyerAvailability, '"availability_shown"');
  good.set(PATHS.consumer, "");
  if (validate(good).length !== 0) throw new Error("good fixture failed");
  const bad = new Map(good);
  bad.set(PATHS.module, "Coming soon");
  bad.set(PATHS.capture, "");
  if (validate(bad).length < 2) throw new Error("bad fixture escaped");
  console.log("issue-1421 venue organic insights self-test: PASS");
  process.exit(0);
}

const failures = validate(load());
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("issue-1421 venue organic insights wiring: PASS");
