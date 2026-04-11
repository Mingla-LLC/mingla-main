# ORCH-0386 Investigation Report: App-Wide i18n & Onboarding Resequencing

**Investigator:** Forensics Agent
**Date:** 2026-04-11
**Classification:** missing-feature
**Confidence:** HIGH (Part A), HIGH (Part B)

---

## Layman Summary

Mingla asks every user to pick their preferred language — during onboarding and again in Settings — but it's a broken promise. The app is 100% hardcoded English. Picking "Espanol" changes absolutely nothing on screen. There are roughly **3,000+ translatable strings** across 163 files, plus 32 push notification messages hardcoded in English inside edge functions. Moving the language picker to the first onboarding screen is mechanically straightforward (add one substep to the state machine), but actually translating the app is a large infrastructure project.

---

## Part A — Onboarding Resequencing

### A.1 Current Step 1 Sequence (verified)

**File:** `app-mobile/src/hooks/useOnboardingStateMachine.ts:12`
```typescript
1: ['welcome', 'phone', 'otp', 'gender_identity', 'details']
```

- `welcome` — user enters first/last name (OnboardingFlow.tsx:1920-1990)
- `phone` — phone number input + SMS consent checkbox
- `otp` — 6-digit OTP verification
- `gender_identity` — gender picker
- `details` — country, birthday, **language** (OnboardingFlow.tsx:2268-2290)

Language is the **last field on the last substep of Step 1** — the worst possible position if the goal is to translate the onboarding itself.

### A.2 Proposed Step 1 Sequence

```typescript
1: ['language', 'welcome', 'phone', 'otp', 'gender_identity', 'details']
```

A new `language` substep becomes the very first screen. The language picker UI from `details` moves here and is removed from `details`.

### A.3 Files and Line Ranges That Need Modification

| File | What Changes | Lines |
|------|-------------|-------|
| `app-mobile/src/types/onboarding.ts:5` | Add `'language'` to `Step1SubStep` union type | 5 |
| `app-mobile/src/hooks/useOnboardingStateMachine.ts:12` | Prepend `'language'` to Step 1 array | 12 |
| `app-mobile/src/hooks/useOnboardingStateMachine.ts:145` | Update `goBack` floor comment (now `language`, not `welcome`) | 145 |
| `app-mobile/src/components/OnboardingFlow.tsx` | Add `if (subStep === 'language')` render block before `welcome` block | ~1919 (new block) |
| `app-mobile/src/components/OnboardingFlow.tsx:2268-2290` | Remove language picker from `details` substep | 2268-2290 |
| `app-mobile/src/components/OnboardingFlow.tsx` | Add CTA config for `'language'` substep in `getCtaConfig` | ~1845 (new case) |
| `app-mobile/src/components/OnboardingFlow.tsx:1245` | Move `getDefaultLanguageCode()` initialization from OTP verification to data init | ~1245 |

### A.4 State Machine Navigation Analysis

**goNext() (line 80-112):** Uses `indexOf(subStep)` to find current position in sequence array, then increments. Adding `'language'` at index 0 shifts all existing substeps by +1. This is **safe** — `indexOf` is name-based, not index-based. No hardcoded indices anywhere. Confidence: **HIGH**.

**goBack() (line 115-146):** Same `indexOf` approach. When at `'language'` (index 0 of Step 1), the floor guard at line 145 fires: "already at Step 1/welcome — no-op". The comment references `welcome` but the logic checks `prev.step > 1`, which is correct regardless. Just need to update the comment. Confidence: **HIGH**.

**goToSubStep() (line 148-150):** Direct setState, no index math. Safe. Confidence: **HIGH**.

**progress calculation (line 152-157):** Uses `seq.length` and `indexOf`. Adding a substep changes `segmentFill` values (each substep fills a smaller fraction of the progress bar). This is **cosmetic only** and auto-adjusts. Confidence: **HIGH**.

### A.5 LanguagePickerModal Reusability

**File:** `app-mobile/src/components/onboarding/LanguagePickerModal.tsx`

The current component is a **full-screen modal** with search, native name display, checkmark selection, and keyboard handling. It's designed for the `details` substep where it overlays the current screen.

For the new `language` substep (first screen of onboarding), the language picker should probably be **inline content** rendered directly in the OnboardingShell, not a modal. The modal pattern (tap a button to open it) makes less sense when the entire screen's purpose is language selection.

**Recommendation:** Create a new inline `LanguageSelectionScreen` component for the `language` substep that embeds the language list directly (reusing `LANGUAGES`, search, and selection logic from `LanguagePickerModal`). Keep `LanguagePickerModal` for Settings and remove it from `details`.

Alternatively, the existing modal could be used as-is by auto-opening it, but this feels janky for a first-impression screen.

### A.6 Persistence

**File:** `app-mobile/src/utils/onboardingPersistence.ts`

`saveOnboardingData()` serializes the full `OnboardingData` object to AsyncStorage. The `userPreferredLanguage` field is a plain string — no special serialization needed. If the user picks a language, closes the app, and returns, the language will persist correctly.

**Current initialization issue:** `userPreferredLanguage` gets its default value at OTP verification (OnboardingFlow.tsx:1245), not at data initialization. If the `language` substep comes first, the default must be set when `OnboardingData` is first created. The `useOnboardingResume` hook (line 136) already handles resume: `base.userPreferredLanguage = profile.preferred_language || getDefaultLanguageCode()`.

**Risk:** The initial `data` state in OnboardingFlow must include `userPreferredLanguage: getDefaultLanguageCode()` at construction time, not deferred to OTP. Confidence: **HIGH**.

### A.7 CTA Configuration

The `getCtaConfig` function (OnboardingFlow.tsx:1840-1912) needs a new `case 'language'` that returns a CTA like "Continue" — enabled always (the default language from device locale is pre-selected, so the user can just tap Continue without changing anything).

### A.8 i18n Timing Consideration

If the `language` substep sets the i18n locale on selection, and the i18n provider wraps the onboarding, then all subsequent screens (welcome, phone, OTP, etc.) will render in the chosen language. The language substep itself must display in a **language-neutral way** (flags, native names) or in the device's detected language — this is already how `LanguagePickerModal` works (shows native names like "Espanol", "Francais").

### A.9 Risks Summary

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `goBack()` from `welcome` now goes to `language` instead of no-op | Low | Intentional — user can change language. No code change needed (floor is Step 1, not welcome). |
| Progress bar segment sizes change | Cosmetic | Auto-adjusts. No action needed. |
| `userPreferredLanguage` default timing | Medium | Move `getDefaultLanguageCode()` to data initialization. |
| First-screen UX: modal vs inline | UX | Recommend inline language list, not a modal overlay. |
| `details` substep becomes shorter (2 fields instead of 3) | Cosmetic | Acceptable. Country + Birthday is still meaningful. |

---

## Part B — i18n Infrastructure Scope

### B.1 Framework Recommendation

**Recommended:** `react-i18next` + `i18next` + `expo-localization`

**Justification:**
- De facto standard for React Native i18n (10M+ weekly npm downloads for i18next)
- `useTranslation()` hook fits Mingla's hooks-first architecture
- Built-in interpolation: `t('greeting', { name })` for template literals
- Built-in pluralization: `t('friends_count', { count: 3 })` with ICU support
- Namespace support for splitting translation files by domain
- `expo-localization` already available (used in `constants/languages.ts:51`) for device locale detection
- No existing i18n dependency conflicts (package.json has zero i18n libraries)
- `i18next-resources-to-backend` can lazy-load language files for app size control

Confidence: **HIGH**

### B.2 String Count Estimate

| Area | Files | Estimated Strings | Notes |
|------|-------|------------------|-------|
| Onboarding (OnboardingFlow + sub-components) | 8 | ~400 | Highest density — 95 Text elements in OnboardingFlow alone |
| Discover / Cards (SwipeableCards, ExpandedCard, etc.) | 12 | ~500 | Card details, actions, filters |
| Profile & Settings | 5 | ~300 | AccountSettings is 200+ strings alone |
| Activity (Calendar, Saved, Boards) | 8 | ~350 | Tab labels, empty states, modals |
| Social (Connections, Messages, Collaboration) | 10 | ~300 | Chat, invites, friend management |
| Modals & Sheets (Share, Feedback, Paywall, etc.) | 15 | ~400 | Each modal has 20-40 strings |
| Common UI (Toast messages, error states, loading) | 12 | ~200 | Scattered across hooks/services |
| Alerts (Alert.alert calls) | 41 files | ~167 | Title + message + button labels |
| Accessibility labels | 65 files | ~100 | Screen reader text |
| Placeholders | 41 files | ~50 | Input hints |
| Edge function notifications | 32 functions | ~50 | Push notification titles/bodies |
| **TOTAL** | **~163 files** | **~2,800-3,200** | |

Confidence: **HIGH** (based on systematic grep of all Text elements, Alert calls, and placeholders)

### B.3 Edge Cases Inventory

#### Dynamic Strings (Template Literals) — 51+ instances

These require i18n **interpolation** support. Key examples:

| File | Line | Pattern | i18n Key Shape |
|------|------|---------|---------------|
| `OnboardingFlow.tsx` | 1937 | `{data.firstName.trim()}.` | `t('welcome_back', { name })` |
| `DiscoverScreen.tsx` | ~712 | `` `${card.venueName}, ${card.location}` `` | `t('venue_location', { venue, location })` |
| `BoardDiscussionTab.tsx` | 312 | `` `${hours} hour${hours > 1 ? "s" : ""} ago` `` | `t('time_ago', { count: hours })` (pluralization) |
| `InviteParticipantsModal.tsx` | 230 | `` `Successfully invited ${count} friend${count > 1 ? "s" : ""}` `` | `t('invite_success', { count })` |

#### Pluralization — 20+ instances

| File | Pattern | Variables |
|------|---------|-----------|
| `dateUtils.ts:17-41` | "1 minute ago" / "5 minutes ago" (6 time units) | minutes, hours, days, weeks, months, years |
| `BoardDiscussionTab.tsx:312` | "1 hour ago" / "3 hours ago" | hours |
| `InviteParticipantsModal.tsx:230` | "1 friend" / "3 friends" | successCount |
| `FeedbackHistorySheet.tsx:178` | "1 screenshot" / "3 screenshots" | count |
| `MessageInterface.tsx:529` | "1 board" / "3 boards" | selectedBoards.length |

#### Date/Time Formatting — 43 files

- `dateUtils.ts:47-60`: Uses `toLocaleDateString('en-US')` — **hardcoded locale**
- `OnboardingFlow.tsx:99-103`: `formatBirthdayDisplay()` uses hardcoded `DD/MM/YYYY`
- 37 instances of `'en-US'` hardcoded in toLocaleDateString/toLocaleString calls
- **Risk:** Date ordering (MM/DD vs DD/MM) differs by locale. Currently always US format.

#### Currency Formatting — 38 files

- `utils/currency.ts`: `formatNumberWithCommas()` uses `toLocaleString('en-US')` — **hardcoded**
- `utils/formatters.ts:37`: `formatCurrency()` converts USD to target with symbol lookup
- Currencies without decimals (JPY, KRW, etc.) handled correctly
- **Risk:** Number formatting (1,000.50 vs 1.000,50) differs by locale. Currently always US format.

#### RTL Languages

**Arabic (`ar`) and Hebrew (`he`)** are both in the 25-language list.

- **Zero RTL infrastructure** exists. No `I18nManager` imports found anywhere in the codebase.
- React Native requires `I18nManager.forceRTL(true)` + app restart for RTL layout.
- All layouts use `flexDirection: 'row'` which won't auto-flip in RTL.
- **Recommendation:** Defer RTL support to a later phase. Supporting Arabic/Hebrew text display (font rendering) is different from full RTL layout. Start with LTR-only languages.

Confidence: **HIGH**

#### Push Notifications — 32 edge functions

Notification text is hardcoded English in edge functions. Examples:
- `send-pair-request/index.ts:240`: "Tap to accept or pass."
- `notify-lifecycle/index.ts:100-326`: Multiple lifecycle messages
- `notify-calendar-reminder/index.ts:124`: Dynamic reminder text

**These cannot be translated client-side.** The edge function must know the recipient's `preferred_language` and select the right translation server-side. This is a separate workstream.

#### Edge Function Response Messages — 60+ instances

Error messages and success messages returned from edge functions are English. Most are consumed by services that show toasts. These need either:
- Server-side translation (edge function returns translated text)
- Error code approach (edge function returns a code, client maps to translated string)

**Recommendation:** Error-code approach is more maintainable.

### B.4 Language List Discrepancy

| Source | Count | File |
|--------|-------|------|
| Onboarding `LanguagePickerModal` | 25 languages | `constants/languages.ts` (shared LANGUAGES array) |
| Settings `AccountSettings` | **10 languages** | `AccountSettings.tsx:43-54` (hardcoded LANGUAGE_OPTIONS) |

The settings picker has a **separate, smaller, hardcoded list** that doesn't import from `constants/languages.ts`. It's also missing native names and uses "Mandarin" instead of "Chinese".

**Resolution:** Settings should use the canonical `LANGUAGES` array from `constants/languages.ts` and the `LanguagePickerModal` component, not its own hardcoded list. This is a standalone fix.

### B.5 Recommended Translation File Structure

```
app-mobile/src/i18n/
  index.ts                    # i18next initialization + provider
  locales/
    en/
      common.json             # Shared: buttons, labels, errors, empty states
      onboarding.json         # All onboarding screens
      discover.json           # Discover, cards, filters
      profile.json            # Profile, settings
      social.json             # Friends, messages, collaborations
      activity.json           # Calendar, saved, boards
    es/
      common.json
      onboarding.json
      ...
    fr/
      ...
```

Namespace-per-domain keeps files manageable (~100-150 keys each instead of one 3,000-key monster).

### B.6 Recommended Phased Rollout

| Phase | Scope | Estimated Strings | Rationale |
|-------|-------|------------------|-----------|
| **Phase 0** | Infrastructure + language substep resequencing | 0 (framework only) | Wire up i18next, provider, useTranslation hook. Move language picker to first screen. No translations yet — just the plumbing. |
| **Phase 1** | Onboarding flow | ~400 | First thing new users see. Maximum impact. Proves the pattern works. |
| **Phase 2** | Home + Discover + Cards | ~500 | Core loop — where users spend 80% of time |
| **Phase 3** | Profile + Settings | ~300 | User-facing settings, already has language picker |
| **Phase 4** | Activity + Social + Modals | ~650 | Lower-traffic screens |
| **Phase 5** | Edge function notifications | ~50 | Server-side, separate deployment |
| **Phase 6** | Date/time/currency locale formatting | N/A | Replace all `'en-US'` hardcodes with user locale |
| **Phase 7** | RTL support (Arabic, Hebrew) | N/A | Layout overhaul, deferred |

**Phase 0 + Phase 1** can ship together as the MVP — onboarding fully translated.

### B.7 Server-Side String Inventory

| Category | Count | Location |
|----------|-------|----------|
| Push notification titles | 18 | `supabase/functions/notify-*/index.ts` |
| Push notification bodies | 14 | `supabase/functions/notify-*/index.ts`, `send-*/index.ts` |
| API error messages | 60+ | Various edge functions |
| OneSignal group message | 1 | `supabase/functions/_shared/push-utils.ts:73` |
| **Total server-side** | **~93** | |

Server-side translation approach: Edge functions should read `preferred_language` from the recipient's profile row and use a shared translation utility in `_shared/`.

### B.8 i18n Provider Mount Point

**File:** `app-mobile/app/_layout.tsx`

The root layout is minimal (Sentry + Stack navigator). The i18n provider should wrap the entire app here, or in the `app/index.tsx` provider tree (which already has PersistQueryClientProvider, NavigationProvider, CardsCacheProvider, etc.).

**Recommended:** Initialize i18next in `app-mobile/src/i18n/index.ts`, import and wrap in `app/_layout.tsx` (before Sentry wrap, so all screens have access).

### B.9 expo-localization Status

Already available as a transitive dependency via `expo-location`. Used in `constants/languages.ts:51` via `require('expo-localization')`. Should be added as an explicit dependency in package.json for clarity.

---

## Discoveries for Orchestrator

1. **Settings language picker uses stale hardcoded list** — `AccountSettings.tsx:43-54` has 10 languages vs canonical 25 in `constants/languages.ts`. Different names too ("Mandarin" vs "Chinese"). Should be unified regardless of i18n work. (Side issue, not blocking.)

2. **37 hardcoded `'en-US'` locale strings** in date/currency formatting — these are bugs even without i18n. A UK user sees US date format. Should be fixed independently.

3. **`preferred_language` is stored but never read at runtime** — no code path reads `profile.preferred_language` to change app behavior. It's write-only data.

4. **No `expo-localization` in explicit dependencies** — it works via transitive dependency but should be declared explicitly.

---

## Confidence Summary

| Finding | Confidence | Reasoning |
|---------|-----------|-----------|
| Onboarding resequencing is safe | HIGH | Read full state machine, traced all navigation paths, no index-based logic |
| String count estimate (~3,000) | HIGH | Systematic grep of all Text elements, Alerts, placeholders across 163 files |
| react-i18next recommendation | HIGH | Industry standard, fits hooks architecture, no conflicts |
| RTL requires deferral | HIGH | Zero RTL infrastructure, would need layout overhaul |
| Push notifications need server-side work | HIGH | Edge functions hardcode English, no language lookup |
| Language list discrepancy | HIGH | Read both files, confirmed different lists |
