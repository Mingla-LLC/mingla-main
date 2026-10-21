#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const PATHS = {
  venue:
    "mingla-business/src/components/venue/VenueIntelligenceModule.tsx",
  offering:
    "mingla-business/src/components/offering/offeringDashboardTiles.ts",
  event: "mingla-business/app/event/[id]/index.tsx",
  trip: "mingla-business/app/trip/[id]/index.tsx",
  experience: "mingla-business/app/experience/[id]/index.tsx",
  rsvp: "mingla-business/app/rsvp/[id]/index.tsx",
  route: "mingla-business/app/insights/[id].tsx",
  screen:
    "mingla-business/src/components/analytics/ListingInsightsScreen.tsx",
  // #4037 — the live listing Insights screen renders the traffic dashboard;
  // the #1403 promises (what Mingla drove, where customers came from, honest
  // empty states) are enforced where they now render.
  dashboard:
    "mingla-business/src/components/analytics/TrafficAnalyticsDashboard.tsx",
  listingService:
    "mingla-business/src/services/listingInsightsService.ts",
  listingHook: "mingla-business/src/hooks/useListingInsights.ts",
  reservationService:
    "mingla-business/src/services/reservationMetricsService.ts",
  reservationHook:
    "mingla-business/src/hooks/useVenueReservationMetrics.ts",
  reservationCard:
    "mingla-business/src/components/venue/VenueReservationsCard.tsx",
  authGates: "mingla-business/src/utils/coldLoadAuthGates.ts",
};

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const requirePattern = (source, pattern, message, failures) => {
  if (!pattern.test(source)) failures.push(message);
};

const requireOrder = (source, labels, message, failures) => {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    if (next < 0 || next <= cursor) {
      failures.push(message);
      return;
    }
    cursor = next;
  }
};

const check = (files) => {
  const failures = [];
  for (const required of Object.values(PATHS)) {
    if (!files.has(required)) failures.push(`${required}: required file missing`);
  }
  if (failures.length > 0) return failures;

  const venue = stripComments(files.get(PATHS.venue));
  if (
    /Customers your ads drove|useBrandConversionRollup|adsRollup|adsTopCampaign|adsTopPlatforms/.test(
      venue,
    )
  ) {
    failures.push(
      `${PATHS.venue}: obsolete brand ad tile/query remains in Venue Overview`,
    );
  }
  requirePattern(
    venue,
    /useVenueReservationMetrics\s*\(\s*brandId\s*,\s*venueId\s*,\s*isAuthReady\s*,?\s*\)/,
    `${PATHS.venue}: exact brand+venue auth-ready reservation query missing`,
    failures,
  );
  requireOrder(
    venue,
    [
      "reservationsQuery.data?.authorized !== true",
      "trackedReservationScope.current = scope",
      "captureBusinessVenueReservationsViewed",
    ],
    `${PATHS.venue}: reservation viewed analytics must wait for an authorized envelope`,
    failures,
  );
  requirePattern(
    venue,
    /setReservationRefreshStatus\("updating"\)[\s\S]*setReservationRefreshStatus\(succeeded \? "success" : "error"\)/,
    `${PATHS.venue}: reservation refresh live status lifecycle missing`,
    failures,
  );
  requireOrder(
    venue,
    [">Revenue<", "<VenueReservationsCard", ">Slow hours<"],
    `${PATHS.venue}: required Revenue < Reservations < Slow hours order missing`,
    failures,
  );
  requirePattern(
    venue,
    /Promise\.allSettled\s*\(\s*\[\s*query\.refetch\(\)\s*,\s*reservationsQuery\.refetch\(\)/,
    `${PATHS.venue}: Overview refresh must refetch both modules`,
    failures,
  );

  const offering = stripComments(files.get(PATHS.offering));
  requirePattern(
    offering,
    /tiles\.slice\(0,\s*guestsIndex \+ 1\)[\s\S]*LISTING_INSIGHTS_TILE[\s\S]*tiles\.slice\(guestsIndex \+ 1\)/,
    `${PATHS.offering}: Insights must be inserted immediately after shared Guests/Travelers/Spots`,
    failures,
  );
  const insightsInsertions =
    offering.match(/^\s*LISTING_INSIGHTS_TILE,\s*$/gm)?.length ?? 0;
  if (insightsInsertions !== 1) {
    failures.push(
      `${PATHS.offering}: wrapper must insert exactly one LISTING_INSIGHTS_TILE`,
    );
  }
  if (/\.splice\s*\(|tiles\s*\[[^\]]+\]\s*=/.test(offering)) {
    failures.push(`${PATHS.offering}: wrapper must not mutate its input array`);
  }
  requirePattern(
    offering,
    /route:\s*\(\{\s*id\s*\}\)\s*=>\s*`\/insights\/\$\{id\}\?entry=detail_action`/,
    `${PATHS.offering}: canonical Insights detail-action route missing`,
    failures,
  );

  const authGates = stripComments(files.get(PATHS.authGates));
  if (/["'`]\/insights(?:\/|["'`])/.test(authGates)) {
    failures.push(
      `${PATHS.authGates}: authenticated Insights route must not be public/connect/invite exempt`,
    );
  }

  for (const manualPath of [PATHS.event, PATHS.rsvp]) {
    const source = stripComments(files.get(manualPath));
    requireOrder(
      source,
      ['label="Guests"', 'label="Insights"'],
      `${manualPath}: Insights must follow Guests`,
      failures,
    );
    requirePattern(
      source,
      /sub="Customers Mingla drove"/,
      `${manualPath}: exact Insights supporting copy missing`,
      failures,
    );
    requirePattern(
      source,
      /const canShowListingInsights\s*=\s*!currentBrandRole\.isLoading\s*&&\s*!currentBrandRole\.isError\s*&&\s*currentBrandRole\.role !== null\s*&&\s*!isScannerOnlyRank\s*\(\s*currentBrandRole\.rank\s*\)/,
      `${manualPath}: role loading/error/scanner fail-closed entry gate missing`,
      failures,
    );
    requirePattern(
      source,
      /\{\s*canShowListingInsights\s*\?\s*\(\s*<ActionTile[\s\S]*?label="Insights"/,
      `${manualPath}: Insights tile does not consume the fail-closed role gate`,
      failures,
    );
    requirePattern(
      source,
      /\/insights\/\$\{event\.id\}\?entry=detail_action/,
      `${manualPath}: canonical Insights route missing`,
      failures,
    );
  }

  for (const [consumerPath, kind, titleExpression] of [
    [PATHS.trip, "trip", "trip.title"],
    [PATHS.experience, "experience", "experience.title"],
  ]) {
    const source = stripComments(files.get(consumerPath));
    requirePattern(
      source,
      new RegExp(
        `withListingInsights\\s*\\(\\s*buildOfferingDashboardTiles\\s*\\(\\s*"${kind}"\\s*\\)\\s*\\)`,
      ),
      `${consumerPath}: approved shared Insights wrapper is not consumed`,
      failures,
    );
    requirePattern(
      source,
      /const canShowListingInsights\s*=\s*!currentBrandRole\.isLoading\s*&&\s*!currentBrandRole\.isError\s*&&\s*currentBrandRole\.role !== null\s*&&\s*!isScannerOnlyRank\s*\(\s*currentBrandRole\.rank\s*\)/,
      `${consumerPath}: role loading/error/scanner fail-closed entry gate missing`,
      failures,
    );
    requirePattern(
      source,
      /tile\.key === "insights"\s*&&\s*!canShowListingInsights/,
      `${consumerPath}: composed Insights tile does not consume the fail-closed role gate`,
      failures,
    );
    requirePattern(
      source,
      new RegExp(
        'tile\\.key === "insights"[\\s\\S]*?\\? `Open Insights for \\$\\{' +
          titleExpression.replace(".", "\\.") +
          '\\}`',
      ),
      `${consumerPath}: title-bearing Insights accessibility label missing`,
      failures,
    );
  }

  const route = stripComments(files.get(PATHS.route));
  requirePattern(
    route,
    /currentBrand\?\.id === identityProbe\.data\.brandId/,
    `${PATHS.route}: server identity/current-brand match guard missing`,
    failures,
  );
  requirePattern(
    route,
    /scannerDenied/,
    `${PATHS.route}: scanner direct-load denial missing`,
    failures,
  );
  requirePattern(
    route,
    /const rankSettled\s*=\s*hasCurrentBrandHydrated\s*&&\s*currentBrand !== null\s*&&\s*!role\.isLoading\s*&&\s*!role\.isError\s*&&\s*role\.role !== null/,
    `${PATHS.route}: hydration/brand/role settlement gate missing`,
    failures,
  );
  requirePattern(
    route,
    /accessError=\{\s*hasCurrentBrandHydrated[\s\S]*role\.isError[\s\S]*onRetryAccess=\{\(\) => \{[\s\S]*role\.refetch\(\)/,
    `${PATHS.route}: retryable role request failure wiring missing`,
    failures,
  );
  requirePattern(
    route,
    /const membershipDenied\s*=[\s\S]*role\.role === null[\s\S]*forceUnavailable=\{[\s\S]*membershipDenied/,
    `${PATHS.route}: successful no-membership direct-load denial missing`,
    failures,
  );
  requirePattern(
    route,
    /const CANONICAL_UUID\s*=[\s\S]*CANONICAL_UUID\.test\(value\)[\s\S]*forceUnavailable=\{\s*id === null \|\|/,
    `${PATHS.route}: malformed/missing listing IDs must fail before reads`,
    failures,
  );
  requirePattern(
    route,
    /router\.replace\(identityProbe\.data\.detailRoute/,
    `${PATHS.route}: direct-load canonical detail fallback missing`,
    failures,
  );

  // #4037 re-scope (approved by Seth in chat 2026-10-21): the live route mounts
  // the traffic screen, never the pre-traffic compatibility screen.
  requirePattern(
    route,
    /<ListingInsightsScreen[\s\S]*?allowed=\{allowed\}/,
    `${PATHS.route}: live route must pass the member gate to the traffic screen`,
    failures,
  );
  if (/<ListingInsightsScreen[^>]*\brollup=/.test(route)) {
    failures.push(
      `${PATHS.route}: live route passes a pre-traffic rollup, which mounts the legacy screen`,
    );
  }

  const screen = stripComments(files.get(PATHS.screen));
  for (const exactCopy of [
    "Couldn&apos;t load listing insights",
    "Insights unavailable",
  ]) {
    if (!screen.includes(exactCopy)) {
      failures.push(`${PATHS.screen}: exact copy missing: ${exactCopy}`);
    }
  }
  requirePattern(
    screen,
    /const rollup = useEntityTrafficRollup\(/,
    `${PATHS.screen}: server traffic rollup query missing`,
    failures,
  );
  requirePattern(
    screen,
    /<TrafficAnalyticsDashboard[\s\S]*?data=\{rollup\.data\}/,
    `${PATHS.screen}: traffic dashboard is not rendered from the server rollup`,
    failures,
  );
  requirePattern(
    screen,
    /rollup\.data\.totals\.minglaCustomers/,
    `${PATHS.screen}: server-authoritative total missing`,
    failures,
  );

  const dashboard = stripComments(files.get(PATHS.dashboard));
  // The source-mix component alone, so a later card cannot satisfy its promises.
  const sourceCardStart = dashboard.indexOf("const SourceCard: React.FC");
  const sourceCardEnd =
    sourceCardStart < 0
      ? -1
      : dashboard.slice(sourceCardStart + 1).search(/\nconst [A-Z]\w*: React\.FC/);
  const sourceCard =
    sourceCardStart < 0 || sourceCardEnd < 0
      ? ""
      : dashboard.slice(sourceCardStart, sourceCardStart + 1 + sourceCardEnd);
  if (sourceCard === "") {
    failures.push(`${PATHS.dashboard}: SourceCard component not found`);
  }
  // Promise 1 — what Mingla drove: the server's Mingla-attributed value and
  // customer count, never a client-side estimate.
  requirePattern(
    dashboard,
    /VALUE MINGLA BROUGHT[\s\S]*?money\(current\.cents, current\.currency\)/,
    `${PATHS.dashboard}: what Mingla drove (value Mingla brought) missing`,
    failures,
  );
  requirePattern(
    dashboard,
    /label="Customers from Mingla"\s*value=\{count\(data\.totals\.minglaCustomers\)\}/,
    `${PATHS.dashboard}: what Mingla drove (customers from Mingla) missing`,
    failures,
  );
  // Promise 2 — where customers came from: a per-source mix from the server rows.
  requirePattern(
    sourceCard,
    /Where visitors came from[\s\S]*?\{data\.sources\.map\(\(row\)/,
    `${PATHS.dashboard}: where customers came from (source mix) missing`,
    failures,
  );
  requirePattern(
    dashboard,
    /const sources = <SourceCard data=\{data\}/,
    `${PATHS.dashboard}: source mix card is not rendered`,
    failures,
  );
  // Promise 3 — honest empty states instead of fabricated zeros.
  requirePattern(
    sourceCard,
    /Where visitors came from\s*<\/Text>\s*\{!hasTraffic \? \(\s*<Text[^>]*>\s*\{collectingCopy\(data\.captureStartedAt\)\}/,
    `${PATHS.dashboard}: honest no-source-mix-yet state missing`,
    failures,
  );
  requirePattern(
    dashboard,
    /data\.totals\.pageViews < 30\s*\?\s*"Collecting"/,
    `${PATHS.dashboard}: honest collecting state for Mingla visitors missing`,
    failures,
  );
  requirePattern(
    dashboard,
    /currency === null \? "—"/,
    `${PATHS.dashboard}: honest no-booking-value state missing`,
    failures,
  );
  if (!dashboard.includes("Visits show here as people open your pages.")) {
    failures.push(`${PATHS.dashboard}: exact copy missing: collecting-state explanation`);
  }
  requirePattern(
    screen,
    /rollup\.data\?\.authorized !== true[\s\S]*trackedId\.current = identity\.data\.id[\s\S]*captureBusinessListingInsightsOpened/,
    `${PATHS.screen}: listing-opened analytics must wait for an authorized envelope`,
    failures,
  );
  requirePattern(
    screen,
    /accessError[\s\S]*onRetryAccess\?\.\(\)/,
    `${PATHS.screen}: role request error Retry handler missing`,
    failures,
  );
  if (/byPlatform|by_platform|campaign/i.test(screen)) {
    failures.push(`${PATHS.screen}: forbidden platform/campaign surface present`);
  }

  const listingService = stripComments(files.get(PATHS.listingService));
  requirePattern(
    listingService,
    /entity_conversion_rollup/,
    `${PATHS.listingService}: deployed listing RPC missing`,
    failures,
  );
  requirePattern(
    listingService,
    /eventId !== expectedId/,
    `${PATHS.listingService}: exact returned event ID validation missing`,
    failures,
  );

  const listingHook = stripComments(files.get(PATHS.listingHook));
  requirePattern(
    listingHook,
    /const enabledIdentity = isAuthReady && allowed && id !== null/,
    `${PATHS.listingHook}: auth/member readiness gate missing`,
    failures,
  );
  requirePattern(
    listingHook,
    /listingInsightsKeys\.rollup\(id\)/,
    `${PATHS.listingHook}: ID-bearing rollup key missing`,
    failures,
  );

  const reservationService = stripComments(files.get(PATHS.reservationService));
  requirePattern(
    reservationService,
    /p_brand_id:\s*brandId[\s\S]*p_venue_id:\s*venueId/,
    `${PATHS.reservationService}: named two-argument overload call missing`,
    failures,
  );
  requirePattern(
    reservationService,
    /brandId !== expectedBrandId[\s\S]*venueId !== expectedVenueId/,
    `${PATHS.reservationService}: exact returned IDs validation missing`,
    failures,
  );

  const reservationHook = stripComments(files.get(PATHS.reservationHook));
  requirePattern(
    reservationHook,
    /const enabled = isAuthReady && brandId !== null && venueId !== null/,
    `${PATHS.reservationHook}: auth-ready two-ID gate missing`,
    failures,
  );
  requirePattern(
    reservationHook,
    /detail\(brandId,\s*venueId\)/,
    `${PATHS.reservationHook}: brand+venue query key missing`,
    failures,
  );

  const reservationCard = stripComments(files.get(PATHS.reservationCard));
  for (const exactCopy of [
    "Reservations",
    "Performance for this venue.",
    "Not enough completed visits yet",
    "Paid reservation fees",
    "Where reservations came from",
  ]) {
    if (!reservationCard.includes(exactCopy)) {
      failures.push(`${PATHS.reservationCard}: exact copy missing: ${exactCopy}`);
    }
  }
  return failures;
};

const diskFiles = () =>
  new Map(
    Object.values(PATHS).map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(root, relativePath), "utf8"),
    ]),
  );

if (process.argv.includes("--self-test")) {
  const good = diskFiles();
  const goodFailures = check(good);
  const selfFailures = [];
  if (goodFailures.length > 0) {
    selfFailures.push(`current good tree rejected: ${goodFailures.join("; ")}`);
  }

  const oldTile = new Map(good);
  oldTile.set(
    PATHS.venue,
    `${oldTile.get(PATHS.venue)}\nconst adsRollup = useBrandConversionRollup(brandId);\n`,
  );
  if (
    !check(oldTile).some((failure) =>
      failure.includes("obsolete brand ad tile/query"),
    )
  ) {
    selfFailures.push("reintroduced brand ad query was not detected");
  }

  const missingVenueScope = new Map(good);
  missingVenueScope.set(
    PATHS.reservationService,
    missingVenueScope
      .get(PATHS.reservationService)
      .replace("p_venue_id: venueId", "p_venue_id: brandId"),
  );
  if (
    !check(missingVenueScope).some((failure) =>
      failure.includes("two-argument overload"),
    )
  ) {
    selfFailures.push("wrong venue RPC argument was not detected");
  }

  const wrongOrder = new Map(good);
  wrongOrder.set(
    PATHS.offering,
    wrongOrder
      .get(PATHS.offering)
      .replace("guestsIndex + 1", "guestsIndex"),
  );
  if (
    !check(wrongOrder).some((failure) =>
      failure.includes("immediately after shared Guests"),
    )
  ) {
    selfFailures.push("removed shared Insights tile was not detected");
  }

  const publicInsights = new Map(good);
  publicInsights.set(
    PATHS.authGates,
    `${publicInsights.get(PATHS.authGates)}\nconst badExemption = "/insights/";\n`,
  );
  if (
    !check(publicInsights).some((failure) =>
      failure.includes("must not be public/connect/invite exempt"),
    )
  ) {
    selfFailures.push("public Insights route exemption was not detected");
  }

  const wrapperNotConsumed = new Map(good);
  wrapperNotConsumed.set(
    PATHS.trip,
    wrapperNotConsumed
      .get(PATHS.trip)
      .replace(
        'withListingInsights(buildOfferingDashboardTiles("trip"))',
        'buildOfferingDashboardTiles("trip")',
      ),
  );
  if (
    !check(wrapperNotConsumed).some((failure) =>
      failure.includes("shared Insights wrapper is not consumed"),
    )
  ) {
    selfFailures.push("missing route wrapper consumption was not detected");
  }

  const duplicateInsights = new Map(good);
  duplicateInsights.set(
    PATHS.offering,
    duplicateInsights
      .get(PATHS.offering)
      .replace(
        "    LISTING_INSIGHTS_TILE,\n",
        "    LISTING_INSIGHTS_TILE,\n    LISTING_INSIGHTS_TILE,\n",
      ),
  );
  if (
    !check(duplicateInsights).some((failure) =>
      failure.includes("insert exactly one LISTING_INSIGHTS_TILE"),
    )
  ) {
    selfFailures.push("duplicate Insights insertion was not detected");
  }

  const scannerLeak = new Map(good);
  scannerLeak.set(
    PATHS.experience,
    scannerLeak
      .get(PATHS.experience)
      .replace(
        "isScannerOnlyRank(currentBrandRole.rank)",
        "false",
      ),
  );
  if (
    !check(scannerLeak).some((failure) =>
      failure.includes("role loading/error/scanner fail-closed entry gate missing"),
    )
  ) {
    selfFailures.push("scanner-only Insights leak was not detected");
  }

  const coldLoadLeak = new Map(good);
  coldLoadLeak.set(
    PATHS.event,
    coldLoadLeak
      .get(PATHS.event)
      .replace("!currentBrandRole.isLoading &&\n    ", ""),
  );
  if (
    !check(coldLoadLeak).some((failure) =>
      failure.includes("role loading/error/scanner fail-closed entry gate missing"),
    )
  ) {
    selfFailures.push("cold-loading role Insights leak was not detected");
  }

  const roleErrorLeak = new Map(good);
  roleErrorLeak.set(
    PATHS.rsvp,
    roleErrorLeak
      .get(PATHS.rsvp)
      .replace("!currentBrandRole.isError &&\n    ", ""),
  );
  if (
    !check(roleErrorLeak).some((failure) =>
      failure.includes("role loading/error/scanner fail-closed entry gate missing"),
    )
  ) {
    selfFailures.push("role-query-error Insights leak was not detected");
  }

  const staticAccessibility = new Map(good);
  staticAccessibility.set(
    PATHS.trip,
    staticAccessibility
      .get(PATHS.trip)
      .replace(
        "`Open Insights for ${trip.title}`",
        '"Open Insights"',
      ),
  );
  if (
    !check(staticAccessibility).some((failure) =>
      failure.includes("title-bearing Insights accessibility label missing"),
    )
  ) {
    selfFailures.push("static Insights accessibility copy was not detected");
  }

  const hydrationLeak = new Map(good);
  hydrationLeak.set(
    PATHS.route,
    hydrationLeak
      .get(PATHS.route)
      .replace("hasCurrentBrandHydrated &&\n    currentBrand !== null &&\n    ", ""),
  );
  if (
    !check(hydrationLeak).some((failure) =>
      failure.includes("hydration/brand/role settlement gate missing"),
    )
  ) {
    selfFailures.push("pre-hydration listing read was not detected");
  }

  const malformedIdLeak = new Map(good);
  malformedIdLeak.set(
    PATHS.route,
    malformedIdLeak
      .get(PATHS.route)
      .replace("CANONICAL_UUID.test(value)", "value.trim().length > 0"),
  );
  if (
    !check(malformedIdLeak).some((failure) =>
      failure.includes("malformed/missing listing IDs"),
    )
  ) {
    selfFailures.push("malformed listing ID leak was not detected");
  }

  const unauthorizedListingAnalytics = new Map(good);
  unauthorizedListingAnalytics.set(
    PATHS.screen,
    unauthorizedListingAnalytics
      .get(PATHS.screen)
      .replace("rollup.data?.authorized !== true", "rollup.data === undefined"),
  );
  if (
    !check(unauthorizedListingAnalytics).some((failure) =>
      failure.includes("listing-opened analytics must wait"),
    )
  ) {
    selfFailures.push("unauthorized listing analytics leak was not detected");
  }

  const unauthorizedVenueAnalytics = new Map(good);
  unauthorizedVenueAnalytics.set(
    PATHS.venue,
    unauthorizedVenueAnalytics
      .get(PATHS.venue)
      .replace(
        "reservationsQuery.data?.authorized !== true",
        "reservationsQuery.data === undefined",
      ),
  );
  if (
    !check(unauthorizedVenueAnalytics).some((failure) =>
      failure.includes("reservation viewed analytics must wait"),
    )
  ) {
    selfFailures.push("unauthorized venue analytics leak was not detected");
  }

  // #4037 re-scope — each traffic-dashboard promise must still catch a regression.
  const dashboardCases = [
    [
      "dropped Mingla value",
      PATHS.dashboard,
      (source) => source.replace("VALUE MINGLA BROUGHT", "VALUE"),
      "value Mingla brought",
    ],
    [
      "dropped Mingla customer count",
      PATHS.dashboard,
      (source) =>
        source.replace(
          "value={count(data.totals.minglaCustomers)}",
          "value={count(data.totals.bookings)}",
        ),
      "customers from Mingla",
    ],
    [
      "dropped source mix",
      PATHS.dashboard,
      (source) => source.replace("{data.sources.map((row)", "{[].map((row)"),
      "source mix) missing",
    ],
    [
      "unrendered source card",
      PATHS.dashboard,
      (source) =>
        source.replace("const sources = <SourceCard data={data}", "const sources = <View data={data}"),
      "source mix card is not rendered",
    ],
    [
      "fabricated source mix before traffic",
      PATHS.dashboard,
      (source) =>
        source.replace(
          /(Where visitors came from[\s\S]*?)\{!hasTraffic \? \(/,
          "$1{false ? (",
        ),
      "honest no-source-mix-yet state",
    ],
    [
      "fabricated Mingla visitors before traffic",
      PATHS.dashboard,
      (source) =>
        source.replace(
          /data\.totals\.pageViews < 30\s*\?\s*"Collecting"/,
          'data.totals.pageViews < 0 ? "0"',
        ),
      "honest collecting state for Mingla visitors",
    ],
    [
      "fabricated zero booking value",
      PATHS.dashboard,
      (source) => source.replace('currency === null ? "—"', 'currency === null ? "0"'),
      "honest no-booking-value state",
    ],
    [
      "screen not rendering the dashboard",
      PATHS.screen,
      (source) =>
        source.replace(/<TrafficAnalyticsDashboard(\s)/, "<View$1"),
      "traffic dashboard is not rendered",
    ],
    [
      "client-side Mingla total",
      PATHS.screen,
      (source) =>
        source.replaceAll("rollup.data.totals.minglaCustomers", "rollup.data.totals.bookings"),
      "server-authoritative total missing",
    ],
    [
      "route mounting the legacy screen",
      PATHS.route,
      (source) =>
        source.replace("<ListingInsightsScreen", "<ListingInsightsScreen\n        rollup={legacyRollup}"),
      "mounts the legacy screen",
    ],
  ];
  for (const [label, file, mutate, expected] of dashboardCases) {
    const mutated = new Map(good);
    const next = mutate(mutated.get(file));
    if (next === mutated.get(file)) {
      selfFailures.push(`${label}: fixture mutation did not apply`);
      continue;
    }
    mutated.set(file, next);
    if (!check(mutated).some((failure) => failure.includes(expected))) {
      selfFailures.push(`${label} was not detected`);
    }
  }

  if (selfFailures.length > 0) {
    console.error("issue #1403 wiring self-test failed");
    selfFailures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log("issue #1403 wiring self-test PASS (25/25 cases)");
  process.exit(0);
}

const failures = check(diskFiles());
if (failures.length > 0) {
  console.error("issue #1403 listing Insights wiring gate failed");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("issue #1403 listing Insights wiring gate PASS");
