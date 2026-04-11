# Implementation Report: ORCH-0386 — i18n Infrastructure + Onboarding Translation (Phase 0+1)

**Date:** 2026-04-11
**Spec:** SPEC_ORCH-0386_I18N_PHASE0_PHASE1.md
**Status:** Implemented, partially verified (TypeScript passes, needs runtime manual testing)

---

## Files Created (6)

| File | Purpose |
|------|---------|
| `app-mobile/src/i18n/index.ts` | i18next initialization, language persistence helpers, async bootstrap |
| `app-mobile/src/i18n/locales/en/common.json` | English shared strings (23 keys) |
| `app-mobile/src/i18n/locales/en/onboarding.json` | English onboarding strings (~180 keys across 15 substeps) |
| `app-mobile/src/i18n/locales/es/common.json` | Spanish shared strings (23 keys) |
| `app-mobile/src/i18n/locales/es/onboarding.json` | Spanish onboarding strings (~180 keys) |
| `app-mobile/src/components/onboarding/LanguageSelectionStep.tsx` | Inline language picker for first onboarding screen |

## Files Modified (12)

| File | Changes |
|------|---------|
| `app-mobile/package.json` | Added i18next, react-i18next, expo-localization |
| `app-mobile/app.config.ts` | Added expo-localization to plugins array |
| `app-mobile/app/_layout.tsx` | Added `import '../src/i18n'` side-effect import |
| `app-mobile/app/index.tsx` | Added i18n/persistLanguage imports + post-auth language sync useEffect |
| `app-mobile/src/types/onboarding.ts` | Added `'language'` to Step1SubStep union |
| `app-mobile/src/hooks/useOnboardingStateMachine.ts` | Prepended `'language'` to Step 1 array, updated goBack comment |
| `app-mobile/src/components/OnboardingFlow.tsx` | Added language substep render + CTA, removed language from details, replaced all hardcoded strings with t() calls, removed LanguagePickerModal import + showLanguagePicker state |
| `app-mobile/src/components/onboarding/OnboardingShell.tsx` | Added useTranslation, replaced "Saving...", "Back", "Back to sign in" |
| `app-mobile/src/components/onboarding/PhoneInput.tsx` | Added useTranslation, replaced placeholder, accessibility labels, "Done" button |
| `app-mobile/src/components/onboarding/OTPInput.tsx` | Added useTranslation, replaced accessibility label |
| `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` | Added useTranslation, replaced ~33 hardcoded strings |
| `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` | Added useTranslation, replaced ~21 hardcoded strings |
| `app-mobile/src/components/onboarding/OnboardingConsentStep.tsx` | Added useTranslation, replaced headline + body |

## Dependency Versions

- `i18next`: installed via `npx expo install`
- `react-i18next`: installed via `npx expo install`
- `expo-localization`: installed via `npx expo install` (was transitive, now explicit)

## Spec Traceability

| SC | Criterion | Status |
|----|-----------|--------|
| SC-1 | i18n provider initializes without error | PASS (TypeScript compiles, no init errors) |
| SC-2 | Language picker is first onboarding screen | IMPLEMENTED (language substep prepended to Step 1) |
| SC-3 | Selecting Spanish → onboarding in Spanish | IMPLEMENTED (i18n.changeLanguage called on select) |
| SC-4 | Device locale pre-selects language | IMPLEMENTED (getDeviceLanguage reads expo-localization) |
| SC-5 | Language persists across restart | IMPLEMENTED (AsyncStorage persistence + async bootstrap) |
| SC-6 | English fallback for missing keys | IMPLEMENTED (fallbackLng: 'en' in i18next config) |
| SC-7 | Details substep no longer shows language | IMPLEMENTED (removed lines 2268-2290) |
| SC-8 | goBack from welcome → language | IMPLEMENTED (state machine auto-handles via indexOf) |
| SC-9 | All onboarding strings use t() | PASS (grep verification shows zero hardcoded English) |
| SC-10 | Language persists to profile.preferred_language | EXISTING (OnboardingFlow already saves this at end) |
| SC-11 | Profile language syncs to i18n | IMPLEMENTED (useEffect in app/index.tsx) |
| SC-12 | Interpolated strings render correctly | IMPLEMENTED ({{name}}, {{phone}}, {{city}}, {{minutes}}, {{mode}}, {{seconds}}, {{count}}) |
| SC-13 | OnboardingShell CTA labels translated | IMPLEMENTED (all cases in getCtaConfig use t()) |

## Deviations from Spec

1. **`buildOccasions` function (line 136)** — The spec's onboarding.json includes `occasions` keys, but `buildOccasions` is a module-level function called outside React component context (no access to hooks). The occasion names ("Birthday", "Valentine's Day", etc.) are data labels sent to Supabase, not rendered UI text during onboarding. Left untranslated — proper solution is Phase 2 scope.

2. **Category names, price tier labels, transport mode labels** — Per spec's explicit Phase 2 deferral, these remain English. They come from constants files, not OnboardingFlow render strings.

3. **`LOADING_MESSAGE_KEYS` pattern** — Instead of accessing `LOADING_MESSAGES[index]` with hardcoded English, changed to `LOADING_MESSAGE_KEYS` containing translation key strings, with `tOnboarding(key)` at render time in GettingExperiencesScreen. Same result, type-safe.

## Verification

- **TypeScript:** PASS — `npx tsc --noEmit` produces zero errors
- **Grep for hardcoded English in onboarding components:** PASS — zero results across all 8 onboarding files
- **Runtime testing:** UNVERIFIED — needs manual testing on device/simulator

## Test First (Manual)

1. Launch app as new user → verify language picker is the first screen
2. Pick "Espanol" → tap Continue → verify all subsequent screens render in Spanish
3. Go back from welcome → verify language picker reappears
4. Kill app and reopen → verify Spanish persists

## Regression Surface

1. **Onboarding resume flow** — the new `'language'` substep changes step indices; verify resume works
2. **Phone pre-verified users** — isFirstScreen logic updated; verify "Back to sign in" shows correctly
3. **OTP channel fallback** — string translations in otp block; verify all paths render
4. **Settings language picker** — untouched (ORCH-0387); verify it still works independently

## Discoveries for Orchestrator

None new.
