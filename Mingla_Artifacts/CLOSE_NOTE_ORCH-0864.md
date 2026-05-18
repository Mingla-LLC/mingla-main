# CLOSE_NOTE — ORCH-0864 [Marketing Composer V2]

**Closed:** 2026-05-18
**Merge commit:** `9d7dbd6f` (PR #131 squash-merged to `main` at 2026-05-18T18:16:54Z)
**Verdict:** PASS (proven on live iOS sim)
**Affected surfaces:** business-iOS, business-Android, business-web-preview (NOT consumer-iOS/Android — no Marketing Hub on consumer; NOT buyer-anon-web — no composer there; NOT admin-web — no marketing tools there)

## What shipped

The full pell-rich-text rewrite of the Marketing Hub email composer. The compose screen at `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` now hosts:

- **ComposerV2** — pell `RichEditor` body + canonical `Input` subject + inline chip rendering (event chips + personalization tokens) with backspace-atomic deletion
- **Inline insertion toolbar** — Bold / Italic / Link / +Event / Personalize / ⋮ overflow (template / link / image / divider)
- **3-button floating footer** — Preview (ghost) · Send Now (light) · Schedule (primary)
- **Inbox Preview modal** — mirrors the server-side Resend render (FROM/SUBJECT chrome, brand cover banner OR Mingla logo, variable-substituted body, inline event cards on cream-to-orange gradient, unsubscribe footer)
- **SchedulePickerSheet** — half-sheet with pinned Cancel/Continue header + Date/Time pill toggle + iOS spinner
- **ComposerReviewSheet** — existing component, dual-mode via `isSendNow` flag (CTA reads "Send now" or "Schedule")
- **Modal-race fix** — 350ms defer between picker close and review-sheet open so iOS doesn't trap the user behind an invisible backdrop
- **Hard-guard validation** — Send Now / Schedule callbacks refuse to open if audience + subject + body aren't filled; toast names what's missing
- **react-native-webview** bumped 13.13.5 → 13.16.1 (the actual unblock — see Root Cause)

## Root cause of the long iteration

Four prior JS-layer "fixes" (F.7 ScrollView removal, F.7b explicit height, F.9 Pressable+focusContentEditor wrapper, F.9n plain View wrapper) all failed because the WebView never mounted. Live-fire forensic on iPhone 17 Pro iOS 26.4 sim found `Uncaught Error: TurboModuleRegistry.getEnforcing(...): 'RNCWebViewModule' could not be found` on bundle eval. Diagnosis:

`react-native-webview@13.13.5/package.json` was missing the `codegenConfig.ios.modulesProvider` block. Expo SDK 54's codegen runner therefore excluded `RNCWebViewModule` from the generated `ios/build/generated/ios/RCTModuleProviders.mm` registry. At runtime the New-Arch TurboModuleRegistry table contained only OneSignal. Any import of `react-native-webview` (transitively via `react-native-pell-rich-editor`) threw at module eval. React's error boundary swallowed the throw and the composer rendered with no WebView child — the "opaque grey box that won't accept taps" symptom that survived four prior fixes.

Upgrading to `react-native-webview@13.16.1` (which declares the missing `ios.componentProvider` + `ios.modulesProvider`) fixed the codegen output. After `pod install`, `RCTModuleProviders.mm` correctly contains `@"RNCWebViewModule": @"RNCWebViewModule"`, and the composer became fully functional with no JS-layer changes — every F.9n-and-prior wiring was already correct.

Full forensic at [`Mingla_Artifacts/reports/QA_ORCH-0864_F9N_BODY_TAP_FORENSICS_REPORT.md`](reports/QA_ORCH-0864_F9N_BODY_TAP_FORENSICS_REPORT.md).

## Evidence

- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0864_MARKETING_COMPOSER_V2.md`
- **Design:** `Mingla_Artifacts/design/DESIGN_ORCH-0864_MARKETING_COMPOSER_V2.md`
- **Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0864_MARKETING_COMPOSER_V2.md`
- **QA verdict:** `Mingla_Artifacts/reports/QA_ORCH-0864_F9N_BODY_TAP_FORENSICS_REPORT.md` (PASS, `proven`)
- **CI gate:** `.github/scripts/strict-grep/orch-0864-composer-v2.mjs` — 6 checks pass on every PR
- **Maestro flows:** `mingla-business/maestro/orch-0864-composer-v2-ios.yaml` + `mingla-business/maestro/orch-0864-composer-v2-android.yaml`
- **Jest:** 40/40 across `tenTapTokenBridge.test.ts` + `InsertionBar.test.ts` + `templateDrawerHelpers.test.ts`
- **Live-fire on iPhone 17 Pro sim iOS 26.4:** tap → caret + keyboard → type → text renders → +Event chip insert → Personalize token insert → backspace atomic delete → Preview modal opens with full inbox render (FROM, brand banner, body, event card with cover + date pill + title + CTA, unsubscribe) → Send Now opens review sheet with "Send now" CTA → Schedule opens picker → Continue opens review sheet with "Schedule" CTA → hard-guard fires toast when audience/subject/body missing. Operator confirmed "All passes" 2026-05-18.

## ORCH-0840 §0.5 regression-test gate — CONDITIONAL

The 40 unit tests cover the bridge logic + insertion-bar state + template-drawer helpers but do not carry explicit `fails-on-revert verified at <commit>` stamps because the actual root-cause fix is a build-pipeline issue (codegen registry) not unit-testable via Jest. The codegen output `grep "RNCWebViewModule" ios/build/generated/ios/RCTModuleProviders.mm` IS the post-build assertion, but lives outside the Jest harness. The live-fire sim verification + screenshots in the QA report serve as the regression evidence. Operator explicitly accepted PASS with "All passes" — treating Step 0.5 as a documented CONDITIONAL CLOSE deviation rather than a strict satisfaction.

[TEST-MOD-APPROVED ORCH-0864] marker was included in the squash commit body for the InsertionBar `OVERFLOW_ITEM_IDS` test that was edited (transient F.10 5-item state reverted to canonical 4-item set when "preview" moved from overflow menu to a dedicated footer button per operator directive 2026-05-18).

## Step 1.5 DIAG-marker reap

`grep -rn "\[ORCH-0864-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/` → zero matches. Clean.

## Deploy notes

**NATIVE-MODULE upgrade — NOT OTA-safe.** `react-native-webview` 13.13.5 → 13.16.1 changes the iOS codegen registry. `eas update` will NOT deliver the new `RNCWebViewModule` registration into the shipped binary. Production users need a full `eas build --profile production --platform ios` followed by App Store / TestFlight submission. Same constraint applies to Android.

No database migrations. No edge function deploys.

## Follow-up registered

- **ORCH-0870** [App-wide Lucide icon replacement] — already registered in WORLD_MAP, was gated on ORCH-0864 close. Now unblocked.

## Artifact-sync note

Per the velocity precedent set by ORCH-0859 close: this CLOSE note + WORLD_MAP banner is the primary update. Full per-section index sync (COVERAGE_MAP grade-distribution, PRIORITY_BOARD removal/renumber, PRODUCT_SNAPSHOT counts, MASTER_BUG_LIST move, AGENT_HANDOFFS dispatch closure, OPEN_INVESTIGATIONS resolution) is deferred to a follow-up sync pass. Operator may request immediate sync or accept the deferral.
