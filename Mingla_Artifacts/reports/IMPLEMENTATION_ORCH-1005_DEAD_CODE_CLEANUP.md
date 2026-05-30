# IMPLEMENTATION — ORCH-1005 Business-web dead-code cleanup

**Status:** implemented and verified (removal-only, zero behavior change)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1005-[biz-web-dead-code-cleanup]/` on branch `ORCH-1005-biz-web-dead-code-cleanup`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1005_DEAD_CODE_CLEANUP.md`
**Date:** 2026-05-29

## Headline

Of the 43 symbols in the SPEC REMOVE table, **40 were removed** and **3 were skipped** because immediate re-verification found a real reference (CI parity gate or a locked source-grep test) that the original ts-prune sweep could not see. One file was deleted wholesale. All cascade-orphaned imports/helpers were removed. tsc introduces zero new errors; the full jest suite is byte-identical to main (59 suites / 104 tests fail on BOTH — all pre-existing); web export compiles to a real routed bundle. A fails-on-revert guard test was added.

## Comms ledger

Read on entry. No `BLOCK`/`WARN` entry is addressed to ORCH-1005 or mingla-implementor that required action. COMMS-0011 (to ALL/WARN) concerns ORCH-0990 ID renumbering — unrelated, acknowledged-as-FYI only.

## Removed symbols (40) — all verified zero-reference immediately before deletion

| # | Symbol | File | Cascade removals |
|---|--------|------|------------------|
| 1 | MINGLA_BUSINESS_WEB_HOST | src/constants/platformUrl.ts | — |
| 2 | KYC_REMEDIATION_FALLBACK | src/constants/stripeKycRemediationMessages.ts | — (FALLBACK const kept — used by getKycRemediationMessage) |
| 3 | KYC_REMEDIATION_MESSAGE_COUNT | src/constants/stripeKycRemediationMessages.ts | — |
| 4 | renderTemplate | src/constants/stripeNotificationTemplates.ts | — |
| 5 | STRIPE_NOTIFICATION_TYPES | src/constants/stripeNotificationTemplates.ts | — |
| 6 | isStripeSupportedCountry | src/constants/stripeSupportedCountries.ts | — (COUNTRY_BY_CODE kept — used by getStripeSupportedCountry) |
| 7 | useEventOrderRevenue | src/hooks/useEventOrders.ts | import `EventOrderRevenue` type |
| 8 | useEventOrderActivity | src/hooks/useEventOrders.ts | imports `getEventOrderActivity`, `EventOrderActivity` type |
| 9 | useEventSoldCounts | src/hooks/useEventOrders.ts | — (getEventOrderRevenue/getEventSoldCounts kept — re-exported at file tail) |
| 10 | useTripIntakeSchemaByTier | src/hooks/useIntakeSchema.ts | import `getTripIntakeSchemaByTier` |
| 11 | useInstallmentsForOrder | src/hooks/useOrderInstallments.ts | import `fetchInstallmentsForOrder`, `OrderInstallment` type |
| 12 | PermissionStatus | src/hooks/usePermissionWithFallback.ts | — |
| 13 | useUpcomingFeed | src/hooks/useUpcomingFeed.ts | **whole file deleted** (sole export) |
| 14 | getBrandHours | src/services/brandsService.ts | local `BrandHourRow` interface, local `formatTimeForUi` helper |
| 15 | EVENT_COVER_FINAL_MAX_BYTES | src/services/eventCoverVideoProcessingService.ts | — |
| 16 | EVENT_COVER_MAX_SOURCE_VIDEO_BYTES | src/services/eventCoverVideoProcessingService.ts | — |
| 17 | EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS | src/services/eventCoverVideoProcessingService.ts | — |
| 18 | syncDraftTicketsToServerEvent | src/services/eventDrafts.ts | import `draftTicketToTicketTypeInsert`, local `resolveDraftCurrencyForPublish` helper |
| 19 | isOneSignalReady | src/services/oneSignalService.ts | — |
| 20 | normalizeEventCoverProviderMetadata | src/types/eventCoverProvider.ts | local `cleanStringOrNull` helper |
| 21 | isBrandBuyersQuery | src/types/marketing.ts | — |
| 22 | isEventBuyersQuery | src/types/marketing.ts | — |
| 23 | isEmailPayload | src/types/marketing.ts | — |
| 24 | assertNeverChannelKind | src/types/marketing.ts | — |
| 25 | assertNeverAudienceKind | src/types/marketing.ts | — |
| 26 | MarketingAudienceRow | src/types/marketing.ts | — |
| 27 | MarketingMessageRow | src/types/marketing.ts | — |
| 28 | MarketingClickRow | src/types/marketing.ts | — |
| 29 | MarketingUnsubscribeRow | src/types/marketing.ts | — |
| 30 | PoolSearchRequest | src/types/poolMatch.ts | — |
| 31 | POOL_SEARCH_MAX_LIMIT | src/types/poolMatch.ts | — |
| 32 | meetsRoleRank | src/utils/brandRole.ts | — |
| 33 | PaymentsStatusBannerConfig | src/utils/brandStripeUiState.ts | import `IconName` type |
| 34 | recurrenceRuleToRfc5545 | src/utils/recurrenceRule.ts | — (`void toIso` kept) |
| 35 | generateOrderId | src/utils/stubOrderId.ts | local `TS36`, local `RAND4` helpers |
| 36 | EventCoverProps | src/components/ui/EventCover.tsx | — (re-export shim; `EventCover` value re-export kept) |
| 37 | EventCoverMediaProps | src/components/ui/EventCoverMedia.tsx | — (`EventCoverMedia` + `EventCoverMediaErrorEvent` re-exports kept) |
| 38 | GooglePlacesAutocomplete | src/components/ui/GooglePlacesAutocomplete.tsx | — (shim; `PlaceAutocompleteSuggestion`/`PlaceDetails` type re-exports kept) |
| 39 | ctaLabelToText | src/components/marketing/ComposerV2/composerChipHtml.ts | — |
| 40 | STUB_DEFAULT_BRAND_ID | src/store/brandList.ts | — |

## Skipped symbols (3) — re-verification found a real reference

| Symbol | File | Reference that blocks removal |
|--------|------|-------------------------------|
| mapMinglaMusicGenresToTmSlugs | src/constants/eventTaxonomy.ts | **CI parity gate.** `eventTaxonomy.ts` is enforced byte-for-byte identical across 3 copies (supabase edge fn, mingla-business, app-mobile) by `.github/scripts/strict-grep/orch-0824-event-taxonomy-parity.mjs` (I-PROPOSED-EVENT-TAXONOMY-PARITY). The function is present and byte-identical in all three. Removing it from only the business copy fails the gate; removing from all three would touch the edge function + app-mobile, both forbidden by the SPEC hard guards. |
| isSubsetOf | src/constants/eventTaxonomy.ts | Same parity gate as above — same file. |
| markServerDraftPublished | src/services/eventDrafts.ts | **Locked source-grep test.** `src/utils/__tests__/serverDraftLifecycleGuards.test.ts:94` asserts `expect(source).toContain("Client-side draft promotion is disabled")` — the exact error-string body of this function. Removing the function makes that append-only (immutable) test fail. The symbol-grep in the SPEC (count=1) only scanned for the identifier, not the string-literal assertion in the test. Restored verbatim. |

## Cascade import / helper removals (summary)

Removed when their sole consumer was a deleted symbol:
- `src/hooks/useEventOrders.ts`: imports `getEventOrderActivity`, type `EventOrderActivity`, type `EventOrderRevenue`.
- `src/hooks/useIntakeSchema.ts`: import `getTripIntakeSchemaByTier`.
- `src/hooks/useOrderInstallments.ts`: import `fetchInstallmentsForOrder`, type `OrderInstallment`.
- `src/services/brandsService.ts`: local `BrandHourRow` interface + local `formatTimeForUi` helper.
- `src/services/eventDrafts.ts`: import `draftTicketToTicketTypeInsert` + local `resolveDraftCurrencyForPublish` helper.
- `src/types/eventCoverProvider.ts`: local `cleanStringOrNull` helper.
- `src/utils/brandStripeUiState.ts`: type import `IconName`.
- `src/utils/stubOrderId.ts`: local `TS36` + `RAND4` helpers.

**Not removed (scope discipline — not on the REMOVE table, exported, no tsc error):** `orderInstallmentKeys.byOrder` factory member; `EMPTY_EVENT_COVER_PROVIDER_METADATA`; `UnsubscribeScope`/`UnsubscribeChannel`; discriminated-union member interfaces in marketing.ts (`AudienceQueryBrandBuyers` etc.). These are now unused-but-exported; removing them would exceed the curated REMOVE set.

## Files deleted entirely

- `src/hooks/useUpcomingFeed.ts` — its only export was `useUpcomingFeed`. Downstream symbols it used (`fetchPublicBrandUpcoming`, `PublicUpcomingFeedPage`, `publicEventKeys.brandUpcoming`) remain in their owning modules (used elsewhere), so nothing else broke.

## Step 0.5 regression guard

- **Path:** `mingla-business/scripts/ci/orch-1005-dead-code-removed.mjs`
- **Wired into:** `package.json` script `test:orch-1005` (self-test + run).
- **What it asserts:** each of the 39 removed symbols is NOT re-exported from its former module (`export const|function|interface|type|...` declaration OR `export { ... }`/`export type { ... }` list, incl. `as <name>` re-exports), and the deleted file `src/hooks/useUpcomingFeed.ts` stays deleted. The 3 skipped symbols are intentionally excluded with inline rationale.
- **Passing run:**
  ```
  [ORCH-1005 SELF-TEST] detector OK.
  ORCH-1005 DEAD-CODE-REMOVED: clean — 39 removed symbols absent, 1 deleted file(s) stay deleted.
  ```
- **Fails-on-revert verified (two paths):**
  - Re-adding `export const generateOrderId` to `stubOrderId.ts` → guard exits 1 (`DEAD EXPORT REINTRODUCED: generateOrderId`). Restored → exits 0.
  - Recreating `src/hooks/useUpcomingFeed.ts` → guard exits 1 (`DELETED FILE REINTRODUCED`). Removed → exits 0.

## Verification matrix

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (mingla-business) | **234 errors WITH changes == 234 errors on baseline `main`.** Zero new errors. None reference any touched file's removed symbol. All 234 are pre-existing (cross-package `Cannot find module 'react'` in `packages/*`, `@mingla/payments-native` resolution, `category` not on `DraftEvent`, etc.). Touched-file filter shows only the same baseline errors. |
| Full `npx jest` (mingla-business) | **59 suites / 104 tests fail WITH changes == 59 suites / 104 tests fail on baseline `main`** (stable across repeated runs). Per-test JSON diff vs baseline: **zero regressions, zero fixes** — failing-test set is byte-identical. The broad pre-existing breakage is a worktree-environment condition present identically on main; only `eventCoverVideoProcessingService.compression.test.ts` was the SPEC-named one, the rest are this worktree's baseline. |
| `test:orch-1005` guard | PASS (self-test OK + clean) + fails-on-revert proven. |
| `npx expo export -p web --clear` | **Compiles.** Real routed bundle (4 web bundles incl. 8.79 MB index, index.html + metadata.json emitted) — not a degenerate "No routes found". Build dir `web-build-orch1005` deleted after; not committed. |

### Caught + corrected during verification (rework within this pass)

First full-suite run showed **+1** failing test vs baseline: `serverDraftLifecycleGuards.test.ts :: server autosave and discard still target draft rows while publish RPC owns promotion`. Root cause: that locked source-grep test asserts the `markServerDraftPublished` error-string is present. Per the dispatch rule ("if any other test fails, you removed something referenced — restore it and note it"), `markServerDraftPublished` was restored verbatim and moved to the skipped set. Re-run confirmed exact baseline parity (104/104).

## Hard-guard compliance

- Removal-only; zero behavior change; no new runtime dependency. ✅
- KEEP list untouched: `tripCheckoutService.ts`, `publicUrls.tripCheckoutUrl/tripPublicUrl`, `venueClaimService.fetchVenueClaimStatus` — not edited. ✅
- No `.native.*`/`.web.*` platform-variant file touched (GooglePlacesAutocomplete.tsx is the plain shim, not a variant; no variant files exist for it). ✅
- No `app/` route file, migration, or edge function touched. ✅
- Scoped commit on branch only; no PR/merge. ✅

## Discoveries for orchestrator

1. **SPEC REMOVE table had 3 false-safe entries** the ts-prune "exactly-once" heuristic could not detect: 2 are byte-parity-locked across 3 copies by the ORCH-0824 CI gate, and 1 has its string-literal body asserted by a locked source-grep test. Future dead-code sweeps should additionally grep for (a) byte-parity-gated files and (b) string-literal assertions in `*.test.ts` source-grep guards before listing a symbol as removable.
2. **This worktree's jest/tsc baseline is broadly red** (59 suites / 104 tests fail, 234 tsc errors) identically to `main`, well beyond the single failure the SPEC anticipated. This appears to be a worktree-environment condition (cross-package module resolution + a `DraftEvent.category` type drift) rather than ORCH-1005's doing — flagged for a possible separate health-check ORCH on the mingla-business test harness.
