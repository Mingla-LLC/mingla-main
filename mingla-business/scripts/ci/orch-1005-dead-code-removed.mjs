#!/usr/bin/env node
/**
 * ORCH-1005 [Business-web dead-code cleanup] — fails-on-revert guard.
 *
 * WHY: ORCH-1005 removed a curated "safe set" of dead exports from
 * mingla-business — symbols that ts-prune flagged as appearing EXACTLY ONCE
 * repo-wide (definition only, zero static / dynamic / string / test
 * references). The full green jest suite + clean tsc + successful web export
 * are the correctness proof that nothing referenced the removed code; THIS
 * gate is the deletion-only regression: it asserts each removed symbol is NOT
 * re-exported from its former module. Re-adding any of them reintroduces dead
 * code and fails CI (fails-on-revert).
 *
 * Scope notes:
 *  - `mapMinglaMusicGenresToTmSlugs` and `isSubsetOf` (src/constants/
 *    eventTaxonomy.ts) were in the SPEC REMOVE table but are INTENTIONALLY
 *    RETAINED: that file is byte-for-byte parity-locked across three copies by
 *    the ORCH-0824 I-PROPOSED-EVENT-TAXONOMY-PARITY gate
 *    (.github/scripts/strict-grep/orch-0824-event-taxonomy-parity.mjs).
 *    Removing them from only the business copy would break that gate. They are
 *    therefore NOT asserted-absent here. See the implementation report.
 *
 * Detection: a symbol is considered "re-exported" if the former module
 * declares it as an exported binding — i.e. matches one of:
 *    export const|function|interface|type|class <SYMBOL>
 *    export { ... <SYMBOL> ... }              (incl. `as <SYMBOL>` re-exports)
 *    export type { ... <SYMBOL> ... }
 * Comment / docstring mentions do NOT count (they carry no runtime export).
 *
 * Run from the mingla-business package root:
 *    node scripts/ci/orch-1005-dead-code-removed.mjs
 *    node scripts/ci/orch-1005-dead-code-removed.mjs --self-test
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? process.cwd()
  : path.join(process.cwd(), "mingla-business");

/** [symbol, relativeModulePath] — every entry ORCH-1005 deleted. */
const REMOVED = [
  ["MINGLA_BUSINESS_WEB_HOST", "src/constants/platformUrl.ts"],
  ["KYC_REMEDIATION_FALLBACK", "src/constants/stripeKycRemediationMessages.ts"],
  ["KYC_REMEDIATION_MESSAGE_COUNT", "src/constants/stripeKycRemediationMessages.ts"],
  ["renderTemplate", "src/constants/stripeNotificationTemplates.ts"],
  ["STRIPE_NOTIFICATION_TYPES", "src/constants/stripeNotificationTemplates.ts"],
  ["isStripeSupportedCountry", "src/constants/stripeSupportedCountries.ts"],
  ["useEventOrderRevenue", "src/hooks/useEventOrders.ts"],
  ["useEventOrderActivity", "src/hooks/useEventOrders.ts"],
  ["useEventSoldCounts", "src/hooks/useEventOrders.ts"],
  ["useTripIntakeSchemaByTier", "src/hooks/useIntakeSchema.ts"],
  ["useInstallmentsForOrder", "src/hooks/useOrderInstallments.ts"],
  ["PermissionStatus", "src/hooks/usePermissionWithFallback.ts"],
  // useUpcomingFeed.ts deleted entirely — assert the file is gone (below).
  ["getBrandHours", "src/services/brandsService.ts"],
  ["EVENT_COVER_FINAL_MAX_BYTES", "src/services/eventCoverVideoProcessingService.ts"],
  ["EVENT_COVER_MAX_SOURCE_VIDEO_BYTES", "src/services/eventCoverVideoProcessingService.ts"],
  ["EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS", "src/services/eventCoverVideoProcessingService.ts"],
  ["syncDraftTicketsToServerEvent", "src/services/eventDrafts.ts"],
  // markServerDraftPublished INTENTIONALLY RETAINED: the append-only source-grep
  // guard src/utils/__tests__/serverDraftLifecycleGuards.test.ts asserts its
  // error-string body ("Client-side draft promotion is disabled") is present.
  // Removing it fails that locked test. See implementation report (skipped set).
  ["isOneSignalReady", "src/services/oneSignalService.ts"],
  ["normalizeEventCoverProviderMetadata", "src/types/eventCoverProvider.ts"],
  ["isBrandBuyersQuery", "src/types/marketing.ts"],
  ["isEventBuyersQuery", "src/types/marketing.ts"],
  ["isEmailPayload", "src/types/marketing.ts"],
  ["assertNeverChannelKind", "src/types/marketing.ts"],
  ["assertNeverAudienceKind", "src/types/marketing.ts"],
  ["MarketingAudienceRow", "src/types/marketing.ts"],
  ["MarketingMessageRow", "src/types/marketing.ts"],
  ["MarketingClickRow", "src/types/marketing.ts"],
  ["MarketingUnsubscribeRow", "src/types/marketing.ts"],
  ["PoolSearchRequest", "src/types/poolMatch.ts"],
  ["POOL_SEARCH_MAX_LIMIT", "src/types/poolMatch.ts"],
  ["meetsRoleRank", "src/utils/brandRole.ts"],
  ["PaymentsStatusBannerConfig", "src/utils/brandStripeUiState.ts"],
  ["recurrenceRuleToRfc5545", "src/utils/recurrenceRule.ts"],
  ["generateOrderId", "src/utils/stubOrderId.ts"],
  ["EventCoverProps", "src/components/ui/EventCover.tsx"],
  ["EventCoverMediaProps", "src/components/ui/EventCoverMedia.tsx"],
  ["GooglePlacesAutocomplete", "src/components/ui/GooglePlacesAutocomplete.tsx"],
  ["ctaLabelToText", "src/components/marketing/ComposerV2/composerChipHtml.ts"],
  ["STUB_DEFAULT_BRAND_ID", "src/store/brandList.ts"],
];

/** Files ORCH-1005 deleted wholesale (only export was on the remove set). */
const DELETED_FILES = ["src/hooks/useUpcomingFeed.ts"];

/** True if `source` declares `symbol` as an exported binding. */
function isExported(source, symbol) {
  const s = escapeRe(symbol);
  // export const|let|var|function|async function|interface|type|enum|class X
  const decl = new RegExp(
    `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:const|let|var|function|interface|type|enum|class)\\s+${s}\\b`,
    "m",
  );
  if (decl.test(source)) return true;
  // export { A, X as B }  /  export type { X }  /  export { Foo as X }
  // Scan each export-list block for the symbol as a bare name or `as <symbol>`.
  const listRe = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  let m;
  while ((m = listRe.exec(source)) !== null) {
    const names = m[1].split(",").map((n) => n.trim());
    for (const n of names) {
      // forms: "X", "X as Y", "Y as X", "type X", "type Y as X"
      const parts = n.replace(/^type\s+/, "").split(/\s+as\s+/);
      const exportedName = (parts[1] ?? parts[0]).trim();
      if (exportedName === symbol) return true;
    }
  }
  return false;
}

function escapeRe(x) {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run({ selfTest = false } = {}) {
  const failures = [];

  // 1) deleted files must stay deleted
  for (const rel of DELETED_FILES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      failures.push(`DELETED FILE REINTRODUCED: ${rel} exists again.`);
    }
  }

  // 2) removed symbols must not be re-exported from their former modules
  for (const [symbol, rel] of REMOVED) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      // Module gone entirely → symbol cannot be exported. Pass.
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    if (isExported(src, symbol)) {
      failures.push(
        `DEAD EXPORT REINTRODUCED: \`${symbol}\` is exported again from ${rel}.`,
      );
    }
  }

  if (selfTest) {
    // The detector MUST flag a known-live export. Use a stable kept export.
    const keep = fs.readFileSync(
      path.join(root, "src/constants/stripeSupportedCountries.ts"),
      "utf8",
    );
    if (!isExported(keep, "getStripeSupportedCountry")) {
      console.error(
        "[ORCH-1005 SELF-TEST] detector failed to see a known-live export (getStripeSupportedCountry).",
      );
      process.exit(2);
    }
    // And it must NOT flag a removed one.
    if (isExported(keep, "isStripeSupportedCountry")) {
      console.error(
        "[ORCH-1005 SELF-TEST] detector wrongly sees removed export isStripeSupportedCountry.",
      );
      process.exit(2);
    }
    console.log("[ORCH-1005 SELF-TEST] detector OK.");
  }

  if (failures.length > 0) {
    console.error(
      `\n[ORCH-1005 DEAD-CODE-REMOVED] ${failures.length} regression(s):\n` +
        failures.map((f) => `  - ${f}`).join("\n") +
        "\n\nORCH-1005 removed these as dead code. Re-adding any reintroduces it.\n",
    );
    process.exit(1);
  }

  console.log(
    `ORCH-1005 DEAD-CODE-REMOVED: clean — ${REMOVED.length} removed symbols absent, ` +
      `${DELETED_FILES.length} deleted file(s) stay deleted.`,
  );
  process.exit(0);
}

run({ selfTest: process.argv.includes("--self-test") });
