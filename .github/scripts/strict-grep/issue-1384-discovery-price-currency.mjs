#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const required = {
  migration: [
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
    "supported_brand_currencies c",
    "public.pg_brand_can_collect",
  ],
  discover: [
    "supportedCurrencyCodes",
    "requestedDisplayCurrency && supportedCurrencyCodes.has",
    "issue_1384_query_servable_places_by_signal",
    "p_price_filter_min_minor: priceFilterMinMinor",
    "p_fx_snapshot_id: fxSnapshotId",
    "metadata: {",
    "fxSnapshotId",
    "FX_UNAVAILABLE",
  ],
  deck: [
    "fxSnapshotId: string | null",
    "data.metadata?.fxSnapshotId",
    "displayCurrency: params.displayCurrency",
    "fxSnapshotId: params.fxSnapshotId",
  ],
  context: [
    "const [pinnedFxSnapshotId",
    "activeDeck.fxSnapshotId",
    "displayCurrency: explicitViewerCurrency",
    "fxSnapshotId: pinnedFxSnapshotId",
    "const prefetchKey = buildDeckQueryKey",
    "queryKey: prefetchKey",
    "queryClient.setQueryData(key, activeDeck.response)",
  ],
  carriers: [
    "canonicalDiscoveryPriceFields(cardData)",
    "...canonicalDiscoveryPriceFields(card)",
    "\"sourceMinMinor\"",
    "\"fxSnapshotId\"",
  ],
  renderers: [
    "canonicalDiscoveryPriceDetail",
    "Rates by ExchangeRate-API",
    "discoveryPrice={card}",
    "if (entry.experience?.cardType !== 'curated') return false",
    "Keep their legacy display isolated from createEventFromCard above",
  ],
  admin: [
    "issue_1384_admin_update_place_and_discovery_range",
    "Audit reason (required)",
    "source_type",
    "updated_by",
    "actor_id",
    "p_expected_version",
  ],
  adminRenderer: [
    "canonicalVenuePriceLabel",
    "const price = canonicalVenuePriceLabel(placeData)",
  ],
};

export function violations(files) {
  const failures = [];
  for (const [name, tokens] of Object.entries(required)) {
    const source = files[name] ?? "";
    for (const token of tokens) {
      if (!source.includes(token)) failures.push(`${name}: missing ${token}`);
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
  const prefetchBlock = (files.context ?? "").slice(
    (files.context ?? "").indexOf("const handleDeckCardProgress"),
    (files.context ?? "").indexOf("// ── Sync deck cards"),
  );
  if (/queryKey:\s*\[\s*["']deck-cards["']/.test(prefetchBlock)) {
    failures.push("context: hand-built deck prefetch/cache key reintroduced");
  }
  if (/googleLevelToTierSlug/.test(files.deviceCalendar ?? "")) {
    failures.push("deviceCalendar: live venue Google-tier money fallback reintroduced");
  }
  if (/priceRange:\s*[^,;]+\|\|\s*['"]Free['"]/.test(files.carriers ?? "")) {
    failures.push("carriers: absent canonical venue data must not become Free");
  }
  return failures;
}

function selfTest() {
  const valid = Object.fromEntries(
    Object.entries(required).map(([name, tokens]) => [name, tokens.join("\n")]),
  );
  valid.admin = `const handleSave = async () => {\n${valid.admin}\n};\n// META-ORCH-1009 Sub-D`;
  valid.context = `const handleDeckCardProgress = () => {\n${valid.context}\n};\n// ── Sync deck cards`;
  valid.deviceCalendar = "canonicalDiscoveryPriceDetail(card)";
  if (violations(valid).length !== 0) {
    throw new Error(`valid fixture rejected: ${violations(valid).join("; ")}`);
  }
  for (const [name, tokens] of Object.entries(required)) {
    for (const token of tokens) {
      const broken = { ...valid, [name]: valid[name].split(token).join("") };
      if (!violations(broken).some((item) => item.includes(`missing ${token}`))) {
        throw new Error(`controlled reversion was not caught: ${name}/${token}`);
      }
    }
  }
  const reversions = [
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
      key: "deviceCalendar",
      value: "googleLevelToTierSlug(card.priceLevel)",
      expected: "Google-tier",
    },
  ];
  for (const fixture of reversions) {
    const broken = { ...valid, [fixture.key]: fixture.value };
    if (!violations(broken).some((item) => item.includes(fixture.expected))) {
      throw new Error(`controlled pattern reversion not caught: ${fixture.expected}`);
    }
  }
  console.log("issue-1384 self-test PASS");
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = {
    migration: read("supabase/migrations/20270129001384_issue_1384_discovery_price_currency.sql"),
    discover: read("supabase/functions/discover-cards/index.ts"),
    deck: read("app-mobile/src/services/deckService.ts"),
    context: read("app-mobile/src/contexts/RecommendationsContext.tsx"),
    carriers: [
      read("app-mobile/src/utils/priceTiers.ts"),
      read("app-mobile/src/types/expandedCardTypes.ts"),
      read("app-mobile/src/components/utils/savedCardToExpandedCardData.ts"),
      read("app-mobile/src/components/utils/holidayCardToExpandedCardData.ts"),
      read("app-mobile/src/services/holidayCardsService.ts"),
      read("app-mobile/src/services/calendarService.ts"),
      read("app-mobile/src/hooks/usePairedMapSavedCards.ts"),
      read("app-mobile/src/components/helpers/collabSaveCard.ts"),
      read("app-mobile/src/components/AppStateManager.tsx"),
      read("app-mobile/src/components/activity/SavedTab.tsx"),
      read("app-mobile/src/components/activity/CalendarTab.tsx"),
      read("app-mobile/src/components/expandedCard/ActionButtons.tsx"),
    ].join("\n"),
    renderers: [
      read("app-mobile/src/components/expandedCard/CardInfoSection.tsx"),
      read("app-mobile/src/components/ShareModal.tsx"),
      read("app-mobile/src/components/ExpandedCardModal.tsx"),
      read("app-mobile/src/services/deviceCalendarService.ts"),
      read("app-mobile/src/components/activity/CalendarTab.tsx"),
    ].join("\n"),
    deviceCalendar: read("app-mobile/src/services/deviceCalendarService.ts"),
    admin: [
      read("mingla-admin/src/pages/PlacePoolManagementPage.jsx"),
      read("mingla-admin/src/services/adminClaimsService.js"),
    ].join("\n"),
    adminRenderer: [
      read("mingla-admin/src/lib/deckCardPreviewRules.js"),
      read("mingla-admin/src/components/DeckCardPreview.jsx"),
    ].join("\n"),
  };
  const failures = violations(files);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("issue-1384 discovery price currency gate PASS");
}
