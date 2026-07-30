#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const rules = {
  migration: {
    required: [
      "ALTER FUNCTION public.is_admin_user()",
      "SET search_path TO pg_catalog, public",
      "CREATE TABLE public.place_discovery_price_ranges",
      "CREATE TABLE public.fx_rate_snapshots",
      "CREATE OR REPLACE FUNCTION public.issue_1384_query_servable_places_by_signal",
      "p_price_filter_currency character(3) DEFAULT NULL",
      "ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST",
      "LIMIT p_limit",
      "CREATE OR REPLACE FUNCTION public.issue_1384_admin_update_place_and_discovery_range",
      "admin_reason_required",
      "WHEN default_currency IS NULL",
      "THEN v_rec.to_currency_code",
      "public.pg_brand_can_collect",
    ],
  },
  discover: {
    required: [
      "supportedCurrencyCodes",
      "supportedCurrencyCodes.has(input.requestedDisplayCurrency)",
      "issue_1384_query_servable_places_by_signal",
      "p_price_filter_min_minor: priceFilterMinMinor",
      "p_fx_snapshot_id: fxSnapshotId",
      "fxSnapshotId",
      "FX_UNAVAILABLE",
      "export async function handleDiscoverCards",
      "await resolveDiscoveryFxContext(",
      "const fxError = discoveryFxErrorResponse(err)",
      "if (import.meta.main)",
      "serve((req) => handleDiscoverCards(req))",
    ],
  },
  adminHandler: {
    required: [
      "export async function handleAdminReviewVenueClaim",
      "await approveGoLiveWithAuthoredApply(",
      "if (import.meta.main)",
      "serve(handleAdminReviewVenueClaim)",
    ],
  },
  deck: {
    required: [
      "fxSnapshotId: string | null",
      "data.metadata?.fxSnapshotId",
      "displayCurrency: params.displayCurrency",
      "fxSnapshotId: params.fxSnapshotId",
      "priceTier: undefined",
    ],
  },
  recommendationType: {
    required: ["sourceMinMinor?: number | null", "fxSnapshotId?: string | null"],
  },
  expandedType: {
    required: ["Partial<CanonicalDiscoveryPrice>"],
  },
  priceHelper: {
    required: [
      "canonicalDiscoveryPriceFields",
      "canonicalDiscoveryPriceDetail",
      "https://www.exchangerate-api.com/",
      "sourceMinMinor",
      "fxSnapshotId",
    ],
  },
  savedMapper: {
    required: ["...canonicalDiscoveryPriceFields(c)"],
  },
  holidayMapper: {
    required: ["...canonicalDiscoveryPriceFields(c)"],
  },
  holidayService: {
    required: ["CanonicalDiscoveryPrice", "Partial<CanonicalDiscoveryPrice>"],
  },
  calendarService: {
    required: [
      "\"sourceMinMinor\"",
      "\"fxSnapshotId\"",
      "(card as any).cardType === 'curated'",
    ],
  },
  pairedMap: {
    required: ["...canonicalDiscoveryPriceFields(cardData)"],
  },
  collabSave: {
    required: ["...canonicalDiscoveryPriceFields(card)"],
  },
  appState: {
    required: ["...canonicalDiscoveryPriceFields(cardData)"],
  },
  savedTab: {
    required: [
      "...canonicalDiscoveryPriceFields(card)",
      "priceTier: isCurated ? card.priceTier : undefined",
    ],
  },
  calendarTab: {
    required: [
      "...canonicalDiscoveryPriceFields(",
      "if (entry.experience?.cardType !== 'curated') return false",
      "priceTier: isCurated ?",
    ],
  },
  actionButtons: {
    required: ["...canonicalDiscoveryPriceFields(card)"],
  },
  deckHook: {
    required: ["fxSnapshotId: query.data?.fxSnapshotId ?? null"],
  },
  context: {
    required: [
      "const [pinnedFxSnapshotId",
      "activeDeck.fxSnapshotId",
      "displayCurrency: explicitViewerCurrency",
      "fxSnapshotId: pinnedFxSnapshotId",
      "prefetchDeckPageController",
      "persistFirstDeckPageController",
    ],
  },
  cardInfo: {
    required: [
      "canonicalDiscoveryPriceDetail(",
      "discoveryPrice as CanonicalDiscoveryPrice | undefined",
      "Rates by ExchangeRate-API",
    ],
    venueOnly: true,
  },
  share: {
    required: [
      "canonicalDiscoveryPriceDetail(experienceData)",
      "Rates by ExchangeRate-API",
    ],
    venueOnly: true,
  },
  expandedModal: {
    required: [
      "discoveryPrice={card}",
      "priceRange={canonicalDiscoveryPriceDetail(card)?.source}",
    ],
    scope: [
      "/* Timeline Section (for Take a Stroll cards) */",
      "{/* Action Buttons */}",
    ],
    exclusion:
      "Curated stop/alternative and event/experience branches outside this named venue timeline scope retain their separate pricing domain.",
  },
  deviceCalendar: {
    required: [
      "canonicalDiscoveryPriceDetail(card)",
      "Rates by ExchangeRate-API",
      "Keep their legacy display isolated from createEventFromCard above",
    ],
    scope: [
      "static createEventFromCard(",
      "static createEventFromCuratedCard(",
    ],
    exclusion:
      "createEventFromCuratedExperience is explicitly excluded: it owns curated itinerary estimates, not single-venue discovery money.",
  },
  personGrid: {
    required: ["{priceRange ? (", "{priceRange}"],
    venueOnly: true,
  },
  holidayView: {
    required: [
      "priceRange={c.priceRange ?? null}",
      "holidayCardToExpandedCardData(c",
    ],
    venueOnly: true,
  },
  swipeable: {
    required: [
      "{nextCard.priceRange ? (",
      "{currentRec.priceRange ? (",
    ],
    venueOnly: true,
    forbid: [
      "fabricated dollar/pound literal",
      "device/client FX authority",
      "rate-one fallback",
      "tier threshold money",
      "tier/Google ordinal venue money",
    ],
    exclusion:
      "Brand experience and curated branches are explicitly excluded and may retain their separate event/itinerary currency arguments.",
  },
  board: {
    required: ["{cardData.priceRange ? (", "{cardData.priceRange}"],
    venueOnly: true,
    forbid: [
      "fabricated dollar/pound literal",
      "hardcoded USD/GBP authority",
      "rate-one fallback",
      "tier threshold money",
      "tier/Google ordinal venue money",
    ],
    exclusion:
      "The earlier isCurated branch is explicitly excluded and retains curated itinerary estimates.",
  },
  admin: {
    required: [
      "issue_1384_admin_update_place_and_discovery_range",
      "Audit reason (required)",
      "source_type",
      "updated_by",
      "actor_id",
    ],
  },
  adminRules: {
    required: [
      "canonicalVenuePriceLabel",
      "buildAdminDiscoveryRangeUpdate",
      "p_expected_version",
      "p_actor_reason",
    ],
  },
  adminPreview: {
    required: [
      "canonicalVenuePriceLabel",
      "const price = canonicalVenuePriceLabel(placeData)",
    ],
    venueOnly: true,
  },
  buyerService: {
    required: [
      "place_discovery_range_for_viewer",
      "source_min_minor",
      "source_currency_code",
    ],
  },
  buyerPage: {
    required: ["formatSourceRange({", "discoveryPrice.minMinor"],
    venueOnly: true,
  },
  buyerRoute: {
    required: [
      "usePublicVenueDiscoveryPrice(",
      "discoveryPrice={discoveryPriceQuery.data ?? null}",
    ],
  },
  businessCurrency: {
    required: [
      "parseMajorToMinor",
      "formatSourceRange",
      "minorUnitExponent",
    ],
  },
  businessAuthoring: {
    required: [
      "saveDiscoveryPriceRange",
      "sourceMinMinor",
      "currencyCode",
      "expectedVersion",
      "commitNewVenueDiscoveryRange",
      "commitExistingVenueDiscoveryRange",
    ],
  },
  venueWizard: {
    required: [
      "const handleSubmit = useCallback(async (): Promise<void> =>",
      "await commitNewVenueDiscoveryRange({",
      "if (tier1.place_pool_id.length === 0)",
      "if (venueId === null)",
    ],
  },
  venueReadiness: {
    required: [
      "const handleSaveChanges = useCallback(async (): Promise<void> =>",
      "await commitExistingVenueDiscoveryRange({",
      "onDone();",
    ],
  },
};

const forbiddenVenueAuthority = [
  {
    label: "fabricated dollar/pound literal",
    pattern: /(["'])(?:[$£]{1,4}|[^"'\n]*[$£]\s?\d[^"'\n]*)\1/,
  },
  {
    label: "hardcoded USD/GBP authority",
    pattern: /(?:currency|currencyCode|sourceCurrency|displayCurrency)\s*[:=]\s*(["'])(?:USD|GBP)\1/,
  },
  {
    label: "device/client FX authority",
    pattern: /(?:currencyService|getCurrencyRate|getRate\(|convertBetween\()/,
  },
  {
    label: "rate-one fallback",
    pattern: /\brate\b\s*(?:\|\||\?\?)\s*1(?:\.0)?\b/,
  },
  {
    label: "tier threshold money",
    pattern: /\b(?:min|max)\s*:\s*(?:0|50|150|300)\b/,
  },
  {
    label: "tier/Google ordinal venue money",
    pattern:
      /(?:tierRangeLabel|formatTierLabel|googleLevelToTierSlug)\(\s*(?:card|cardData|currentRec|nextCard|entry|experience|discoveryPrice)\b/,
  },
];

function scopedSource(name, source, rule, failures) {
  if (!rule.scope) return source;
  const [startToken, endToken] = rule.scope;
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) {
    failures.push(`${name}: venue scope markers missing`);
    return "";
  }
  return source.slice(start, end);
}

function boundedSource(source, startToken, endToken, label, failures) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) {
    failures.push(`${label}: callsite scope markers missing`);
    return "";
  }
  return source.slice(start, end);
}

function occurrenceCount(source, token) {
  return source.split(token).length - 1;
}

export function violations(files) {
  const failures = [];
  for (const [name, rule] of Object.entries(rules)) {
    const source = files[name] ?? "";
    for (const token of rule.required) {
      if (!source.includes(token)) failures.push(`${name}: missing ${token}`);
    }
    if (rule.venueOnly || rule.scope) {
      const venueSource = scopedSource(name, source, rule, failures);
      const applicable = rule.forbid ??
        forbiddenVenueAuthority.map((forbidden) => forbidden.label);
      for (const forbidden of forbiddenVenueAuthority) {
        if (!applicable.includes(forbidden.label)) continue;
        if (forbidden.pattern.test(venueSource)) {
          failures.push(`${name}: ${forbidden.label} reintroduced`);
        }
      }
    }
  }

  const adminSave = (files.admin ?? "").slice(
    (files.admin ?? "").indexOf("const handleSave"),
    (files.admin ?? "").indexOf("// META-ORCH-1009 Sub-D"),
  );
  if (/rpc\(["']admin_edit_place["']/.test(adminSave)) {
    failures.push("admin: partial legacy place mutation reintroduced");
  }
  if (/from\(["']place_pool["']\)\.update/.test(adminSave)) {
    failures.push("admin: partial AI category mutation reintroduced");
  }
  const discoverHandler = boundedSource(
    files.discover ?? "",
    "export async function handleDiscoverCards",
    "if (import.meta.main)",
    "discover",
    failures,
  );
  if (!discoverHandler.includes("await resolveDiscoveryFxContext(")) {
    failures.push("discover: live handler disconnected from FX resolver");
  }
  if (!discoverHandler.includes("discoveryFxErrorResponse(err)")) {
    failures.push("discover: live handler disconnected from FX error mapper");
  }

  const adminHandler = boundedSource(
    files.adminHandler ?? "",
    "export async function handleAdminReviewVenueClaim",
    "if (import.meta.main)",
    "adminHandler",
    failures,
  );
  if (!adminHandler.includes("await approveGoLiveWithAuthoredApply(")) {
    failures.push("adminHandler: live approve branch disconnected from wrapper");
  }

  const context = files.context ?? "";
  const persistBlock = boundedSource(
    context,
    "// ── ORCH-0391: Persist deck key + location on first successful solo load",
    "// ORCH-0446:",
    "context persistence",
    failures,
  );
  if (!persistBlock.includes("persistFirstDeckPageController(")) {
    failures.push("context: first-success persistence controller disconnected");
  }
  if (
    persistBlock.includes("setQueryData(") ||
    persistBlock.includes("buildDeckQueryKey(") ||
    persistBlock.includes("DECK_LAST_KEY") ||
    persistBlock.includes("DECK_LAST_LOCATION_KEY")
  ) {
    failures.push("context: manual first-success deck persistence reintroduced");
  }
  const prefetchBlock = boundedSource(
    context,
    "const handleDeckCardProgress",
    "// ── Sync deck cards",
    "context prefetch",
    failures,
  );
  if (!prefetchBlock.includes("prefetchDeckPageController(")) {
    failures.push("context: next-page prefetch controller disconnected");
  }
  if (
    prefetchBlock.includes("prefetchQuery(") ||
    prefetchBlock.includes("buildDeckQueryKey(") ||
    /queryKey:\s*\[\s*["']deck-cards["']/.test(prefetchBlock)
  ) {
    failures.push("context: hand-built deck prefetch/cache key reintroduced");
  }

  const wizard = files.venueWizard ?? "";
  const wizardSubmit = boundedSource(
    wizard,
    "const handleSubmit = useCallback(async (): Promise<void> =>",
    "const body =",
    "venueWizard",
    failures,
  );
  const newCommit = "await commitNewVenueDiscoveryRange({";
  const commitIndex = wizardSubmit.indexOf(newCommit);
  const placeCheckIndex = wizardSubmit.indexOf(
    "if (tier1.place_pool_id.length === 0)",
  );
  const venueCheckIndex = wizardSubmit.indexOf("if (venueId === null)");
  const resetAfterIndex = wizardSubmit.indexOf(
    "useDraftVenueStore.getState().reset(",
    commitIndex,
  );
  const doneAfterIndex = wizardSubmit.indexOf("onDone(", commitIndex);
  if (
    occurrenceCount(wizardSubmit, newCommit) !== 1 ||
    commitIndex <= placeCheckIndex ||
    commitIndex <= venueCheckIndex ||
    resetAfterIndex <= commitIndex ||
    doneAfterIndex <= commitIndex
  ) {
    failures.push(
      "venueWizard: canonical new-range commit order/await cardinality drifted",
    );
  }
  const tierOneStage = boundedSource(
    wizardSubmit,
    "const tier1 = await upsertTier1Place({",
    "if (tier1.place_pool_id.length === 0)",
    "venueWizard tier-one",
    failures,
  );
  if (
    /discoveryPrice|priceMinInput|priceMaxInput|priceTiers/.test(tierOneStage)
  ) {
    failures.push("venueWizard: discovery money restaged in tier one");
  }

  const readiness = boundedSource(
    files.venueReadiness ?? "",
    "const handleSaveChanges = useCallback(async (): Promise<void> =>",
    "const handleRefresh =",
    "venueReadiness",
    failures,
  );
  const existingCommit = "await commitExistingVenueDiscoveryRange({";
  if (
    occurrenceCount(readiness, existingCommit) !== 1 ||
    readiness.indexOf(existingCommit) < 0 ||
    readiness.indexOf("onDone();") <= readiness.indexOf(existingCommit)
  ) {
    failures.push(
      "venueReadiness: canonical existing-range commit order/await cardinality drifted",
    );
  }
  return failures;
}

function selfTest() {
  const valid = {};
  for (const [name, rule] of Object.entries(rules)) {
    const required = rule.required.join("\n");
    valid[name] = rule.scope
      ? `${rule.scope[0]}\n${required}\n${rule.scope[1]}`
      : required;
  }
  valid.admin = `const handleSave = async () => {\n${valid.admin}\n};\n// META-ORCH-1009 Sub-D`;
  valid.discover =
    `${valid.discover}\nexport async function handleDiscoverCards() {\n` +
    "await resolveDiscoveryFxContext();\n" +
    "discoveryFxErrorResponse(err);\n}\nif (import.meta.main) {}";
  valid.adminHandler =
    `${valid.adminHandler}\nexport async function handleAdminReviewVenueClaim() {\n` +
    "await approveGoLiveWithAuthoredApply();\n}\nif (import.meta.main) {}";
  valid.context =
    `${valid.context}\n` +
    "// ── ORCH-0391: Persist deck key + location on first successful solo load\n" +
    "persistFirstDeckPageController();\n// ORCH-0446:\n" +
    "const handleDeckCardProgress = () => {\nprefetchDeckPageController();\n};\n" +
    "// ── Sync deck cards";
  valid.venueWizard =
    "const handleSubmit = useCallback(async (): Promise<void> => {\n" +
    "const tier1 = await upsertTier1Place({});\n" +
    "if (tier1.place_pool_id.length === 0) {}\n" +
    "if (venueId === null) {}\n" +
    "await commitNewVenueDiscoveryRange({});\n" +
    "useDraftVenueStore.getState().reset();\nonDone();\n});\n" +
    "const body = () => {};";
  valid.venueReadiness =
    "const handleSaveChanges = useCallback(async (): Promise<void> => {\n" +
    "await commitExistingVenueDiscoveryRange({});\nonDone();\n});\n" +
    "const handleRefresh = () => {};";
  const baseline = violations(valid);
  if (baseline.length !== 0) {
    throw new Error(`valid fixture rejected: ${baseline.join("; ")}`);
  }
  for (const [name, rule] of Object.entries(rules)) {
    for (const token of rule.required) {
      const broken = {
        ...valid,
        [name]: valid[name].split(token).join(""),
      };
      if (!violations(broken).some((item) => item === `${name}: missing ${token}`)) {
        throw new Error(`controlled reversion not caught: ${name}/${token}`);
      }
    }
  }

  const sourceReversions = [
    {
      key: "cardInfo",
      value: `${valid.cardInfo}\nconst priceDetail = { source: "$$", approximate: null };`,
      expected: "fabricated dollar/pound",
    },
    {
      key: "deviceCalendar",
      value: valid.deviceCalendar.replace(
        "canonicalDiscoveryPriceDetail(card)",
        "canonicalDiscoveryPriceDetail(card)\ngetCurrencyRate(card.currency)",
      ),
      expected: "device/client FX",
    },
    {
      key: "share",
      value: `${valid.share}\nconst rate = input.rate || 1;`,
      expected: "rate-one",
    },
    {
      key: "personGrid",
      value: `${valid.personGrid}\nconst tier = { min: 50, max: 150 };`,
      expected: "tier threshold",
    },
    {
      key: "admin",
      value: valid.admin.replace(
        "// META-ORCH-1009 Sub-D",
        'rpc("admin_edit_place", {});\n// META-ORCH-1009 Sub-D',
      ),
      expected: "partial legacy",
    },
    {
      key: "context",
      value: valid.context.replace(
        "// ── Sync deck cards",
        "queryKey: ['deck-cards', 1];\n// ── Sync deck cards",
      ),
      expected: "hand-built",
    },
    {
      key: "discover",
      value: valid.discover.replace(
        "await resolveDiscoveryFxContext(",
        "await disconnectedFxContext(",
      ),
      expected: "live handler disconnected from FX resolver",
    },
    {
      key: "discover",
      value: valid.discover.replace(
        "discoveryFxErrorResponse(err)",
        "disconnectedFxErrorResponse(err)",
      ),
      expected: "live handler disconnected from FX error mapper",
    },
    {
      key: "adminHandler",
      value: valid.adminHandler.replace(
        "await approveGoLiveWithAuthoredApply(",
        "await disconnectedApprovalWrapper(",
      ),
      expected: "live approve branch disconnected from wrapper",
    },
    {
      key: "context",
      value: valid.context.replace(
        "const handleDeckCardProgress = () => {\nprefetchDeckPageController();",
        "const handleDeckCardProgress = () => {\ndisconnectedPrefetch();",
      ),
      expected: "next-page prefetch controller disconnected",
    },
    {
      key: "context",
      value: valid.context.replace(
        "// ── ORCH-0391: Persist deck key + location on first successful solo load\npersistFirstDeckPageController();",
        "// ── ORCH-0391: Persist deck key + location on first successful solo load\ndisconnectedPersistence();",
      ),
      expected: "first-success persistence controller disconnected",
    },
    {
      key: "venueWizard",
      value: valid.venueWizard.replace(
        "await commitNewVenueDiscoveryRange({});",
        "commitNewVenueDiscoveryRange({});",
      ),
      expected: "canonical new-range commit order/await cardinality drifted",
    },
    {
      key: "venueWizard",
      value: valid.venueWizard.replace(
        "await commitNewVenueDiscoveryRange({});\nuseDraftVenueStore.getState().reset();\nonDone();",
        "useDraftVenueStore.getState().reset();\nonDone();\nawait commitNewVenueDiscoveryRange({});",
      ),
      expected: "canonical new-range commit order/await cardinality drifted",
    },
    {
      key: "venueReadiness",
      value: valid.venueReadiness.replace(
        "await commitExistingVenueDiscoveryRange({});",
        "commitExistingVenueDiscoveryRange({});",
      ),
      expected: "canonical existing-range commit order/await cardinality drifted",
    },
    {
      key: "venueReadiness",
      value: valid.venueReadiness.replace(
        "await commitExistingVenueDiscoveryRange({});\nonDone();",
        "onDone();\nawait commitExistingVenueDiscoveryRange({});",
      ),
      expected: "canonical existing-range commit order/await cardinality drifted",
    },
  ];
  for (const fixture of sourceReversions) {
    const broken = { ...valid, [fixture.key]: fixture.value };
    if (!violations(broken).some((item) => item.includes(fixture.expected))) {
      throw new Error(`source reversion not caught: ${fixture.expected}`);
    }
  }
  console.log(
    `issue-1384 self-test PASS (${sourceReversions.length} true-source reversions)`,
  );
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const paths = {
  migration: "supabase/migrations/20270129001384_issue_1384_discovery_price_currency.sql",
  discover: "supabase/functions/discover-cards/index.ts",
  deck: "app-mobile/src/services/deckService.ts",
  recommendationType: "app-mobile/src/types/recommendation.ts",
  expandedType: "app-mobile/src/types/expandedCardTypes.ts",
  priceHelper: "app-mobile/src/utils/priceTiers.ts",
  savedMapper: "app-mobile/src/components/utils/savedCardToExpandedCardData.ts",
  holidayMapper: "app-mobile/src/components/utils/holidayCardToExpandedCardData.ts",
  holidayService: "app-mobile/src/services/holidayCardsService.ts",
  calendarService: "app-mobile/src/services/calendarService.ts",
  pairedMap: "app-mobile/src/hooks/usePairedMapSavedCards.ts",
  collabSave: "app-mobile/src/components/helpers/collabSaveCard.ts",
  appState: "app-mobile/src/components/AppStateManager.tsx",
  savedTab: "app-mobile/src/components/activity/SavedTab.tsx",
  calendarTab: "app-mobile/src/components/activity/CalendarTab.tsx",
  actionButtons: "app-mobile/src/components/expandedCard/ActionButtons.tsx",
  deckHook: "app-mobile/src/hooks/useDeckCards.ts",
  context: "app-mobile/src/contexts/RecommendationsContext.tsx",
  cardInfo: "app-mobile/src/components/expandedCard/CardInfoSection.tsx",
  share: "app-mobile/src/components/ShareModal.tsx",
  expandedModal: "app-mobile/src/components/ExpandedCardModal.tsx",
  deviceCalendar: "app-mobile/src/services/deviceCalendarService.ts",
  personGrid: "app-mobile/src/components/PersonGridCard.tsx",
  holidayView: "app-mobile/src/components/PersonHolidayView.tsx",
  swipeable: "app-mobile/src/components/SwipeableCards.tsx",
  board: "app-mobile/src/components/board/SwipeableSessionCards.tsx",
  admin: "mingla-admin/src/pages/PlacePoolManagementPage.jsx",
  adminHandler: "supabase/functions/admin-review-venue-claim/index.ts",
  adminRules: "mingla-admin/src/lib/deckCardPreviewRules.js",
  adminPreview: "mingla-admin/src/components/DeckCardPreview.jsx",
  buyerService: "mingla-business/src/services/publicEventsService.ts",
  buyerPage: "mingla-business/src/components/venue/PublicVenuePage.tsx",
  buyerRoute: "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  businessCurrency: "mingla-business/src/utils/currencyFormatter.ts",
  businessAuthoring: "mingla-business/src/services/businessPlaceAuthoringService.ts",
  venueWizard: "mingla-business/src/components/venue/VenueCreatorWizard.tsx",
  venueReadiness: "mingla-business/src/components/venue/VenueDeckReadinessSetup.tsx",
};

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = Object.fromEntries(
    Object.entries(paths).map(([name, relative]) => [name, read(relative)]),
  );
  const failures = violations(files);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(
    `issue-1384 discovery price currency gate PASS (${Object.keys(paths).length} independently enforced files)`,
  );
}
