# SPEC — ORCH-1005 Business-web dead-code cleanup (safe set)

Operator decisions (2026-05-29): remove the **safe set only**; **KEEP all trip-checkout + venue-claim scaffolding** (both are on the roadmap). No bundle-splitting (parked).

Method: `npx --yes ts-prune` flagged 256 src/ candidates; filtered to 54 whose symbol appears EXACTLY ONCE repo-wide (definition only — zero static/dynamic/string/test references). Platform-variant false positives (`.native`/`.web`) and `default` exports excluded. From those 54, the operator KEEPS the trip-checkout + venue-claim items below.

## REMOVE (the safe set) — delete each declaration AND any imports it alone used (cascade). If a file's ONLY export is on this list, delete the whole file. Verify each symbol still has zero references (grep src+app, word-boundary, count must be 1 = definition only) immediately before removing.

| Symbol | File |
|---|---|
| mapMinglaMusicGenresToTmSlugs | src/constants/eventTaxonomy.ts |
| isSubsetOf | src/constants/eventTaxonomy.ts |
| MINGLA_BUSINESS_WEB_HOST | src/constants/platformUrl.ts |
| KYC_REMEDIATION_FALLBACK | src/constants/stripeKycRemediationMessages.ts |
| KYC_REMEDIATION_MESSAGE_COUNT | src/constants/stripeKycRemediationMessages.ts |
| renderTemplate | src/constants/stripeNotificationTemplates.ts |
| STRIPE_NOTIFICATION_TYPES | src/constants/stripeNotificationTemplates.ts |
| isStripeSupportedCountry | src/constants/stripeSupportedCountries.ts |
| useEventOrderRevenue | src/hooks/useEventOrders.ts |
| useEventOrderActivity | src/hooks/useEventOrders.ts |
| useEventSoldCounts | src/hooks/useEventOrders.ts |
| useTripIntakeSchemaByTier | src/hooks/useIntakeSchema.ts |
| useInstallmentsForOrder | src/hooks/useOrderInstallments.ts |
| PermissionStatus | src/hooks/usePermissionWithFallback.ts |
| useUpcomingFeed | src/hooks/useUpcomingFeed.ts |
| getBrandHours | src/services/brandsService.ts |
| EVENT_COVER_FINAL_MAX_BYTES | src/services/eventCoverVideoProcessingService.ts |
| EVENT_COVER_MAX_SOURCE_VIDEO_BYTES | src/services/eventCoverVideoProcessingService.ts |
| EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS | src/services/eventCoverVideoProcessingService.ts |
| syncDraftTicketsToServerEvent | src/services/eventDrafts.ts |
| markServerDraftPublished | src/services/eventDrafts.ts |
| isOneSignalReady | src/services/oneSignalService.ts |
| normalizeEventCoverProviderMetadata | src/types/eventCoverProvider.ts |
| isBrandBuyersQuery | src/types/marketing.ts |
| isEventBuyersQuery | src/types/marketing.ts |
| isEmailPayload | src/types/marketing.ts |
| assertNeverChannelKind | src/types/marketing.ts |
| assertNeverAudienceKind | src/types/marketing.ts |
| MarketingAudienceRow | src/types/marketing.ts |
| MarketingMessageRow | src/types/marketing.ts |
| MarketingClickRow | src/types/marketing.ts |
| MarketingUnsubscribeRow | src/types/marketing.ts |
| PoolSearchRequest | src/types/poolMatch.ts |
| POOL_SEARCH_MAX_LIMIT | src/types/poolMatch.ts |
| meetsRoleRank | src/utils/brandRole.ts |
| PaymentsStatusBannerConfig | src/utils/brandStripeUiState.ts |
| recurrenceRuleToRfc5545 | src/utils/recurrenceRule.ts |
| generateOrderId | src/utils/stubOrderId.ts |
| EventCoverProps | src/components/ui/EventCover.tsx |
| EventCoverMediaProps | src/components/ui/EventCoverMedia.tsx |
| GooglePlacesAutocomplete | src/components/ui/GooglePlacesAutocomplete.tsx |
| ctaLabelToText | src/components/marketing/ComposerV2/composerChipHtml.ts |
| STUB_DEFAULT_BRAND_ID | src/store/brandList.ts |

## KEEP (do NOT touch — roadmap scaffolding, operator-confirmed):
- All of `src/services/tripCheckoutService.ts` (`resendTripConfirmation` + every `TripCheckout*` type).
- `src/constants/publicUrls.ts`: `tripCheckoutUrl`, `tripPublicUrl`.
- `src/services/venueClaimService.ts`: `fetchVenueClaimStatus`.
- Every `.native.*` / `.web.*` platform-variant export ts-prune flagged (false positives — Metro resolves them at build).

## Acceptance / `/goal`
- Each removed symbol verified zero-reference immediately before deletion.
- `npx tsc --noEmit` clean for touched files (no orphaned-import errors).
- FULL existing jest suite green (only the known-baseline `eventCoverVideoProcessingService.compression.test.ts` getSession-mock failure allowed — pre-existing on main).
- `npx expo export -p web --clear` compiles (use `--clear` per reference-worktree-web-export-needs-clear).
- Step 0.5 regression: a guard test (jest or strict-grep) asserting the removed symbols are NOT re-exported (fails-on-revert: re-adding any reintroduces dead code → fails). This is the sensible regression for a deletion-only cleanup; the full green suite + tsc + build is the correctness proof that nothing referenced them.

## Hard guards
Removal-only; no behavior change, no new dependency. Do not touch the KEEP list, platform variants, app/ route files, migrations, edge functions. No `[deploy]` needed (zero runtime change; cleanup rides the next deploy). Commit scoped on branch; do NOT open PR/merge (orchestrator CLOSEs).
