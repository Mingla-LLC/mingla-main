# IMPLEMENTATION — META-ORCH-1002 Sub-D — Business app Android glass sweep

**Date:** 2026-05-29
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-d-business-glass-sweep]/` on branch `META-ORCH-1002-sub-d-business-glass-sweep`.
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-D_BUSINESS_GLASS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md` §3.3 + §4.2
**External APIs touched:** NONE. Pure RN style/`Platform`. No backend/migration/edge/dependency.
**Status:** implemented, partially verified (source + Platform-guard + style assertions verified GREEN with fails-on-revert; tsc 0-new + lint 0-new; on-device pixel verification is the tester's live-fire job).

---

## 1. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`OPEN` row targets `mingla-implementor`, this ORCH-ID, or `ALL` requiring action. COMMS-0002 (backend strict-grep), COMMS-0003 (external API docs), COMMS-0004 (INTAKE) are N/A — no `supabase/functions` touch, no external API, no INTAKE. No new ledger entry written (no cross-ORCH discovery).

## 2. Layman summary

On Android, ~200 of the business app's rounded "glass" cards, pills, inputs and banners had their fill stopping short of the rounded corner (a faint taupe ring), and three surfaces (the global toast, the AI-disclosure sheet, the marketing "Send Blast" capsule) rendered see-through over busy content. All are now solid frosted panels with fills that reach the corner. iOS is byte-identical. The dark-canvas glass look is preserved — the fix clips the surfaces, it does not flatten them.

## 3. What was done (DONE) vs what remains (REMAINING)

### 3.1 Symptom-B stragglers — DONE (3/3)

| File | Change |
|---|---|
| `mingla-business/src/components/ui/Toast.tsx` | Fixed the inverted `blurOk` guard. Was `Platform.OS !== "web" \|\| supportsBackdropFilter` (→ `true` on Android, washed-out toast). Now mirrors `GlassChrome.shouldUseRealBlur()`: iOS `true`, Android `false`, web by backdrop-filter. Android takes the opaque `FALLBACK_BACKGROUND` (`rgba(20,22,26,0.92)`). |
| `mingla-business/src/components/ari/AiDisclosureModal.tsx` | Added `Platform` import + a `BlurViewOrOpaque` wrapper: Android renders an opaque `#1a1416` frosted sheet (`opaqueSheet` style); iOS keeps the real `<BlurView intensity={40}>`. |
| `mingla-business/src/components/marketing/BlastCustomersCta.tsx` | Added `Platform` import + guarded the L1 BlurView: Android renders an opaque `rgba(20,22,26,0.92)` base so the L2 accent tint floor composites over a solid capsule; iOS keeps real blur. |

### 3.2 Symptom-A sweep — DONE (204 of 205 catalog targets clipped)

Mechanical recipe per surface: add `overflow:'hidden'` so the rounded fill+border composite to the radius on Android (kills the inset-ring). Dark-canvas translucent fill **preserved** (judgment rule). No Android-elevation change — machine-verified that all 218 Symptom-A catalog instances are `shadow=false`; the two raw `elevation:8` tab-bars + the list-card `host` were already fixed in Sub-1 (on main) and were NOT redone.

**Total `overflow:'hidden'` additions:** 202 (Phase 1: 118 sweep + Phase 2: 84 sweep). The remaining catalog entries were already clipped (13 `ovfHidden` in the catalog) or excluded (`*.web.tsx` — 4 web-only entries).

**Phase 1 (committed `f9ab9b952`) — event/trip/marketing creators + composer, 57 files:**
- `event/`: ActionTile, AddressAutocompleteInput, ChangeSummaryModal, CreatorStep1Basics, CreatorStep2When, CreatorStep2WhenRepeatPickerSheet, CreatorStep3Where, CreatorStep5Tickets, CreatorStep6Settings, CreatorStep7Preview, EditAfterPublishBanner, EditPublishedScreen, EventDetailTicketTypeRow, EventListCard, MultiDateOverrideSheet, PreviewEventView, PublishErrorsSheet, TicketTierCard, TicketTierEditSheet.
- `trip/`: BookingDeadlinePicker, EditAfterPublishTripBanner, EditPublishedTripIntakeAccordion, EditPublishedTripScreen, IntakeQuestionEditor, IntakeQuestionPreview, IntakeQuestionTypePill, IntakeSchemaBuilder, PaymentPlanEditor, RefundPolicyEditor, RefundPreviewSheet, TravelerIntakeAnswerCard, TripCreatorStep1Basics, TripCreatorStep3Inclusions, TripCreatorStep4Pricing, TripCreatorStep6Intake, TripDayEditor, TripListCard.
- `marketing/`: AudienceCard, AudiencePickerSheet, BlastCustomersCta (straggler), CampaignCard, CampaignFilterPills, ChannelTabs, ComposerFooter, ComposerHeader, ComposerReviewSheet, ComposerStepCompliance, ComposerStepWhen, ComposerV2/ComposerV2Editor, ComposerV2/InsertionBar, ComposerV2/SchedulePickerSheet, ComposerV2/SelectionFormattingTooltip, ComposerV2/TemplatePreviewDrawer, MarketingSubNav, OverviewMetricCard, TemplateCard, TemplateEditor.
- `ui/Toast.tsx` (straggler), `ari/AiDisclosureModal.tsx` (straggler), test file.

**Phase 2 (this commit) — brand/door/ari/orders/experience/etc, 45 files:**
- `ari/`: ConversationDrawer, InputBar, MessageList, QuickReplyChips. `screens/ari/AriSettingsScreen.tsx`.
- `brand/`: BrandCreationFlow, BrandDeleteSheet, BrandFinanceReportsView, BrandPaymentsView, BrandProfileView, BrandStripeCountryPicker, BrandStripeDetachConfirmSheet, BrandSwitcherSheet, PublicBrandNotFound.
- `checkout/`: DownloadMinglaCta, intake/IntakeFilePickerChooserSheet, intake/IntakeQuestionRenderers.
- `door/`: DoorRefundSheet, DoorSaleNewSheet.
- `experience/`: ActivitiesSnapInput, ExperienceCreatorWizard (4 single-line blocks done manually), MenuSnapInput.
- `groupChat/`: GroupChatModerationSheet, GroupChatPanel. `guests/AddCompGuestSheet`.
- `home/`: HomeTripRow, UpcomingListItem. `hub/HubSubNav`. `notifications/BusinessNotificationsScreen`. `onboarding/MinglaToSAcceptanceGate`.
- `orders/`: CancelOrderDialog, MaterialChangeBanner, OrderListCard, RefundSheet.
- `scanners/InviteScannerSheet`. `team/`: InviteBrandMemberSheet, MemberDetailSheet, RolePickerSheet. `theme/ThemeEditorSection`.
- `ui/`: CoverPicker, ShareModal, UniversalCreatorSheet. `venue/`: VenueStep4Hours, VenueStep6Description. `waitlist/JoinWaitlistSheet`.

### 3.3 REMAINING / intentionally excluded

| Item | Why |
|---|---|
| `ui/BottomNav.tsx` `spotlight` (1 catalog target) | The active-tab spotlight applies `shadows.glassChromeActive` at the JSX `style` array. On iOS, `overflow:'hidden'` on a shadowed view clips the glow (`masksToBounds`). To preserve iOS exactly (policy), the clip was NOT applied — its Android elevation is already zeroed by `androidSafeElevation` via the shadow token, so there is no Android rectangle to fix. |
| 4 `*.web.tsx` catalog entries (`ComposerCanvas.web.tsx` ×3 — already clipped; `TemplatePreviewDrawer.web.tsx` ×1) | Hard-guard: Next.js web-only files NOT touched. |
| 13 already-`ovfHidden` catalog entries | Already correctly clipped; no action. |
| Consumer app, `packages/`, `mingla-admin`, backend | Out of Sub-D scope (other sub-tracks). |

**Net: every business RN-mobile Symptom-A catalog target that needed clipping is clipped, except the one documented iOS-shadow exclusion. Nothing silently skipped.**

## 4. Old → New receipts (the 3 manually-edited stragglers)

### `ui/Toast.tsx`
**Before:** `const blurOk = Platform.OS !== "web" || supportsBackdropFilter;` → `true` on Android → thin real BlurView, opaque fallback unreachable.
**Now:** ternary `iOS ? true : Android ? false : supportsBackdropFilter`. Android takes the opaque `FALLBACK_BACKGROUND`. **Lines:** ~+13.

### `ari/AiDisclosureModal.tsx`
**Before:** sheet wrapped in raw `<BlurView intensity={40}>` (thin on Android, leaked busy content through the 0.78 tint).
**Now:** `Platform` imported; `BlurViewOrOpaque` helper renders an opaque `#1a1416` sheet on Android, real BlurView on iOS. **Lines:** ~+18.

### `marketing/BlastCustomersCta.tsx`
**Before:** L1 `<BlurView>` rendered on all platforms (near-transparent on Android under the accent tint).
**Now:** `Platform` imported; Android renders an opaque `rgba(20,22,26,0.92)` L1 base, iOS/web keep BlurView. **Lines:** ~+14.

### Sweep receipt (×202)
**Before:** rounded surface = `borderRadius` + `borderWidth` + translucent `glass.tint.*`/`accent.tint`/`semantic.*Tint`/`INPUT_BG` fill, no `overflow`.
**Now:** same block + `overflow:'hidden'` inserted after `borderRadius`. Fill, border, radius, padding all unchanged. iOS unaffected (these surfaces composite correctly on iOS; `overflow:'hidden'` is a no-op there as none carry an in-block shadow — verified). **Lines:** +1 each.

## 5. Spec traceability

| SC | Implemented | Verification |
|---|---|---|
| SC-B1/B2/B3 (stragglers opaque on Android, iOS blur, web preserved) | Toast ternary, AiDisclosure opaqueSheet, Blast L1 guard | Test groups 1–3 GREEN; fails-on-revert |
| SC-A (sweep clips, fill preserved, no elevation) | 202 `overflow:'hidden'` adds; no fill/elevation change | Test "swept surfaces carry overflow" (17 samples) + "fill PRESERVED" GREEN; completeness audit 204/205 |
| SC-iOS-frozen | every straggler behind `Platform`; sweep is a no-op on iOS (no in-block shadows; BottomNav shadow case excluded) | tsc 0-new; iOS branches byte-identical |
| SC-scope | only `mingla-business/` RN-mobile; no web/packages/admin/backend | `git diff --name-only` confined to `mingla-business/src` |

## 6. Regression test (mandatory gate)

**Path:** `mingla-business/src/components/__tests__/metaOrch1002SubDBusinessGlass.test.ts` (NEW file — append-only safe; not a modification of the Sub-1 test).
**Run:** `npx jest metaOrch1002SubDBusinessGlass --runInBand` → **29 passed, 29 total**.
**Covers:** the 3 stragglers (inverted-guard removed, Android opaque branch, web preserved, opaque-hex assertions) + 17 swept surfaces across event/trip/marketing/ari/brand/door/orders + a "dark-canvas translucent fill PRESERVED, not flattened" guard.
**fails-on-revert verified at commit `53e28e712`** (the branch HEAD before Phase 1): reverting the Toast guard + `countInputWrap` clip + the AiDisclosure `opaqueSheet` → **4 failed, 20 passed**, then restore → 29/29. Captured.
**Adversarial angles for the tester** (noted in the test header): iOS-frozen (real BlurView on iOS), no-over-opaque-ification (fills stay translucent on dark canvas), web path preserved, Android-specific branch (not all-non-iOS), and the `BottomNav spotlight` iOS-shadow exclusion.

## 7. Typecheck + lint

- **tsc (`tsc --noEmit`):** 234 errors WITH and WITHOUT changes (stash-verified) → **0 new errors**, none in any touched file's added lines. The 234 are pre-existing `packages/phone-input/*` worktree-resolution + app strictness debt (documented in the Sub-1 report).
- **lint (`eslint`):** swept-file set = 30 errors WITH = 30 WITHOUT (Phase 1) and 24 = 24 (Phase 2) → **0 new errors**. All are pre-existing `react/no-unescaped-entities` + `react-hooks/rules-of-hooks` baseline. The new test file is lint-clean.

## 8. Cross-surface impact (Phase 2.5)

- **Business Android (`mingla-business`)** — TARGET: ~200 rounded glass surfaces clip to the corner; 3 stragglers render solid frosted.
- **Business iOS (`mingla-business`)** — NO-OP: straggler changes behind `Platform`; sweep `overflow:'hidden'` is a no-op on these correctly-compositing, shadow-free iOS surfaces (BottomNav shadow case excluded to be safe).
- **Buyer/anon Web + Business Web preview** — UNAFFECTED: `*.web.tsx` not touched; web glass path (`GlassBlur.tsx`/public pages) is deferred Sub-C.
- **Consumer iOS/Android, Admin Web** — UNAFFECTED: no `app-mobile`/`mingla-admin` touch.
- Parity automatic on iOS (shared component, iOS branch unchanged).

## 9. Invariants

- **I-ANDROID-ROUNDED-FILL-CLIPPED (DRAFT, business Symptom-A):** PRESERVED — 204/205 targets clipped, asserted by the test.
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** PRESERVED — 3 stragglers route to opaque on Android.
- **iOS-render-frozen:** PRESERVED.
- **mingla-business desktop-web 16 contracts:** PRESERVED — `wizardDesktopLayout` (4 tests) GREEN; the marketing-composer contract assertions in `desktopWebLayoutContracts` GREEN; no `.web.tsx` / desktop-rail-elevation touched.
- **TopSheet/UniversalCreatorSheet (DEC-152):** `UniversalCreatorSheet` row got a benign clip on a glass row; the sheet's height-mode/structure untouched.

## 10. Discoveries for orchestrator

- **Pre-existing desktop-web contract failure (NOT caused by Sub-D):** `desktopWebLayoutContracts.test.ts` › "keeps Home desktop KPIs fixed…" fails on this branch because `app/(tabs)/home.tsx` lacks `scrollEnabled={!isWideDesktop}`. Verified it fails identically with all Sub-D changes stashed; Sub-D does not touch `app/(tabs)/home.tsx`. Flag for a separate fix.
- **Pre-existing tsc/lint debt** (234 tsc + `react/no-unescaped-entities` + conditional-hooks) is branch baseline, unrelated to Sub-D — not fixed (scope discipline).
- **Token triplication** (consumer/business/packages designSystem) remains; Sub-D edited only `mingla-business`. Sub-C (shared `GlassBlur.tsx`) and Sub-F (token consolidation) remain open per investigation §6.

## 11. Spec deviations

One documented exclusion: `BottomNav spotlight` was NOT clipped to preserve the iOS shadow glow (the one swept surface with an inline shadow token). All other recipe choices match the spec.
