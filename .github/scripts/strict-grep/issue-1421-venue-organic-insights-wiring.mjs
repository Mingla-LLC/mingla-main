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
  // #1559 — the buyer venue BODY moved to packages/brand-rendering; the ROUTE
  // is now the adapter that owns every analytics effect. `buyer` therefore
  // points at the shared screen (which must stay analytics-free, so nothing can
  // bypass the buyer_web policy from inside a package both apps render) and the
  // capture wiring is asserted on `buyerRoute`.
  buyer: "packages/brand-rendering/PublicVenueScreen.tsx",
  buyerRoute:
    "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  buyerAvailability:
    "mingla-business/src/components/venue/GuestVenueReservation.tsx",
  buyerPolicy:
    "mingla-business/src/services/venueOrganicCapturePolicy.ts",
  buyerCapture:
    "mingla-business/src/services/venueOrganicCaptureService.web.ts",
  buyerCaptureTest:
    "mingla-business/src/services/__tests__/venueOrganicCaptureConsent.issue1421.test.ts",
  edgeTest:
    "supabase/functions/venue-organic-capture/__tests__/issue1421_source_contract.test.ts",
  sqlTest:
    "supabase/migrations/__tests__/issue_1421_venue_organic_engagement.test.sql",
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

function functionBody(source, functionName) {
  const declaration = source.indexOf(`function ${functionName}`);
  if (declaration < 0) return "";
  const open = source.indexOf("{", declaration);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
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
  const buyer = get(PATHS.buyer);
  const buyerRoute = get(PATHS.buyerRoute);
  const buyerPolicy = get(PATHS.buyerPolicy);
  const eventPolicyBody = functionBody(
    buyerPolicy,
    "runBuyerVenueOrganicCapture",
  );
  const settlementPolicyBody = functionBody(
    buyerPolicy,
    "settleBuyerVenueOrganicCapture",
  );
  // #1559 — the buyer venue page has exactly ONE mount, and it is this route,
  // so the surface is NAMED here instead of defaulting inside a component.
  // Both capture entry points must still go through the policy, by surface.
  if (
    !buyerRoute.includes(
      'const analyticsSurface: VenueOrganicAnalyticsSurface = "buyer_web"',
    ) ||
    !buyerRoute.includes("runBuyerVenueOrganicCapture(analyticsSurface") ||
    !buyerRoute.includes("settleBuyerVenueOrganicCapture(analyticsSurface") ||
    !get(PATHS.buyerAvailability).includes(
      "runBuyerVenueOrganicCapture(analyticsSurface",
    )
  ) {
    failures.push("buyer organic capture is not fail-closed for Business preview");
  }
  // The shared screen is rendered by BOTH apps (#1560). If it reached the
  // buyer-web analytics modules directly it would fire nothing on consumer AND
  // route around `venueOrganicCapturePolicy` on web — the policy would still
  // exist and simply stop being on the path. It emits through an injected
  // callback instead, and this asserts that structurally.
  // Comments stripped first: the rule is about what the module CALLS, and the
  // module's own header explains why it must not call these by name.
  const buyerCode = buyer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const forbidden of [
    "captureWeb",
    "captureVenueOrganicEvent",
    "runBuyerVenueOrganicCapture",
    "analyticsSurface",
  ]) {
    if (buyerCode.includes(forbidden)) {
      failures.push(
        `${PATHS.buyer} references ${forbidden} — the shared venue screen must emit ` +
          "through its injected onAnalytics callback so every surface keeps its own " +
          "fail-closed capture policy.",
      );
    }
  }
  if (!eventPolicyBody.includes('surface !== "buyer_web"')) {
    failures.push("buyer event capture function lost its preview guard");
  }
  if (!settlementPolicyBody.includes('surface !== "buyer_web"')) {
    failures.push("buyer settlement function lost its preview guard");
  }
  if (
    !get(PATHS.buyerCapture).includes(
      "settleVenueOrganicJourneyOnConsent",
    ) ||
    !get(PATHS.buyerCapture).includes("pendingStarts") ||
    !get(PATHS.buyerCaptureTest).includes("toHaveBeenCalledTimes(1)") ||
    !get(PATHS.buyerCaptureTest).includes("never before")
  ) {
    failures.push("post-consent page journey is not exact-once executable");
  }
  if (
    !get(PATHS.edgeTest).includes("handleVenueOrganicCapture") ||
    !get(PATHS.edgeTest).includes('reason: "source_ineligible"') ||
    !get(PATHS.edgeTest).includes('reason: "journey_invalid"')
  ) {
    failures.push("public capture handler lacks executable source/mismatch proof");
  }
  for (const proof of [
    "venue_organic_engagement_rollup(",
    "dayparts",
    "cancelled_by_guest",
    "reservation_checkout_sessions",
    "cleanup_venue_organic_engagement(1)",
    "window_complete",
    "raw privilege denial",
  ]) {
    if (!get(PATHS.sqlTest).includes(proof)) {
      failures.push(`PG17 executable proof missing: ${proof}`);
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
  if (
    !capture.includes("journeyTokenForEventId") ||
    !capture.includes('onConflict: "token_hash"') ||
    !get(PATHS.edgeTest).includes(
      "lost initial response reuses one journey and later stages",
    ) ||
    !get(PATHS.edgeTest).includes("assertEquals(firstBody, secondBody)")
  ) {
    failures.push("initial page settlement retry is not journey-idempotent");
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
    buyerRoute,
    get(PATHS.buyerAvailability),
    get(PATHS.buyerCapture),
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
  // The shared screen carries NO analytics tokens at all — that is the rule.
  good.set(PATHS.buyer, "onAnalytics(\"public_venue_menu_viewed\"");
  good.set(
    PATHS.buyerRoute,
    'const analyticsSurface: VenueOrganicAnalyticsSurface = "buyer_web" runBuyerVenueOrganicCapture(analyticsSurface settleBuyerVenueOrganicCapture(analyticsSurface "page_view" "menu_open" "reservation_start"',
  );
  good.set(
    PATHS.buyerAvailability,
    'runBuyerVenueOrganicCapture(analyticsSurface "availability_shown"',
  );
  good.set(
    PATHS.buyerPolicy,
    'export function runBuyerVenueOrganicCapture() { if (surface !== "buyer_web") return; } export function settleBuyerVenueOrganicCapture() { if (surface !== "buyer_web") return; }',
  );
  good.set(
    PATHS.buyerCapture,
    'settleVenueOrganicJourneyOnConsent pendingStarts "page_view"',
  );
  good.set(
    PATHS.buyerCaptureTest,
    "toHaveBeenCalledTimes(1) never before",
  );
  good.set(
    PATHS.edgeTest,
    'handleVenueOrganicCapture reason: "source_ineligible" reason: "journey_invalid"',
  );
  good.set(
    PATHS.sqlTest,
    "venue_organic_engagement_rollup( dayparts cancelled_by_guest reservation_checkout_sessions cleanup_venue_organic_engagement(1) window_complete raw privilege denial",
  );
  good.set(
    PATHS.hook,
    "const enabled = isAuthReady && brandId !== null && venueId !== null; venueOrganicInsightsKeys.detail(brandId, venueId)",
  );
  good.set(PATHS.service, 'supabase.rpc("venue_organic_engagement_rollup"');
  good.set(
    PATHS.capture,
    'surface !== "buyer_web" reason: "source_unproven" ["search", "social", "organic", "direct"] reason: "source_ineligible" journeyTokenForEventId onConflict: "token_hash"',
  );
  good.set(
    PATHS.edgeTest,
    'handleVenueOrganicCapture reason: "source_ineligible" reason: "journey_invalid" lost initial response reuses one journey and later stages assertEquals(firstBody, secondBody)',
  );
  good.set(
    PATHS.migration,
    "FORCE ROW LEVEL SECURITY REVOKE ALL ON public.venue_organic_journeys FROM PUBLIC, anon, authenticated REVOKE ALL ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid) GRANT EXECUTE ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid) issue_1421_venue_organic_retention cleanup_venue_organic_engagement(5000) reservation.status NOT IN ('cancelled_by_guest','cancelled_by_venue')",
  );
  good.set(PATHS.attribution, 'from "../_shared/entrySource.ts"');
  good.set(PATHS.classifier, "export function classifyEntrySource");
  good.set(PATHS.reservation, "organic_journey_id organicJourneyToken");
  good.set(PATHS.consumer, "");
  if (validate(good).length !== 0) throw new Error("good fixture failed");
  const bad = new Map(good);
  bad.set(PATHS.module, "Coming soon");
  bad.set(PATHS.capture, "");
  if (validate(bad).length < 2) throw new Error("bad fixture escaped");
  const missingEventGuard = new Map(good);
  missingEventGuard.set(
    PATHS.buyerPolicy,
    'export function runBuyerVenueOrganicCapture() { capture(); } export function settleBuyerVenueOrganicCapture() { if (surface !== "buyer_web") return; }',
  );
  if (
    !validate(missingEventGuard).includes(
      "buyer event capture function lost its preview guard",
    )
  ) {
    throw new Error("event preview guard revert escaped");
  }
  const missingSettlementGuard = new Map(good);
  missingSettlementGuard.set(
    PATHS.buyerPolicy,
    'export function runBuyerVenueOrganicCapture() { if (surface !== "buyer_web") return; } export function settleBuyerVenueOrganicCapture() { settle(); }',
  );
  if (
    !validate(missingSettlementGuard).includes(
      "buyer settlement function lost its preview guard",
    )
  ) {
    throw new Error("settlement preview guard revert escaped");
  }
  // #1559 — the shared screen reaching analytics directly must FAIL.
  const leakyScreen = new Map(good);
  leakyScreen.set(
    PATHS.buyer,
    'captureWeb("public_venue_menu_viewed", { surface: analyticsSurface })',
  );
  if (
    !validate(leakyScreen).some((f) => f.includes("must emit"))
  ) {
    throw new Error("shared-screen analytics leak escaped");
  }
  // #1559 — dropping the route's named surface must FAIL.
  const unnamedSurface = new Map(good);
  unnamedSurface.set(
    PATHS.buyerRoute,
    'runBuyerVenueOrganicCapture(analyticsSurface settleBuyerVenueOrganicCapture(analyticsSurface "page_view" "menu_open" "reservation_start"',
  );
  if (
    !validate(unnamedSurface).includes(
      "buyer organic capture is not fail-closed for Business preview",
    )
  ) {
    throw new Error("unnamed analytics surface escaped");
  }
  console.log("issue-1421 venue organic insights self-test: PASS");
  process.exit(0);
}

const failures = validate(load());
if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("issue-1421 venue organic insights wiring: PASS");
