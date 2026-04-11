# SPEC: ORCH-0386 — i18n Infrastructure + Onboarding Translation (Phase 0+1)

**Date:** 2026-04-11
**Investigation:** INVESTIGATION_ORCH-0386_I18N_REPORT.md (APPROVED)
**Classification:** missing-feature
**Confidence:** HIGH

---

## Layman Summary

This spec wires up translation infrastructure so the app can speak multiple languages, moves the language picker to the very first onboarding screen so users choose their language before seeing anything else, and translates every string in the entire onboarding flow into English keys (with Spanish as proof-of-concept). After this ships, a Spanish-speaking user picks "Espanol" on the first screen and sees the entire onboarding in Spanish.

---

## Scope

**In scope:**
- Install `i18next` + `react-i18next` + `expo-localization` (explicit)
- Create i18n initialization module and provider
- Add `language` substep as first screen in onboarding
- Extract all onboarding strings (~400) into translation key files
- Create `en` (English) and `es` (Spanish) translation files for onboarding
- Create `common` namespace for shared strings (buttons, alerts)
- Persist language choice to AsyncStorage for pre-auth state
- Sync language to i18next on app startup from profile or AsyncStorage

**Non-goals:**
- Translating screens beyond onboarding (Phases 2-4)
- Server-side notification translation (Phase 5)
- Date/time/currency locale-aware formatting (ORCH-0388)
- RTL layout support (Phase 7)
- Settings language picker unification (ORCH-0387)
- Admin dashboard translation

---

## 1. Dependencies

Install in `app-mobile/`:

```bash
npx expo install i18next react-i18next expo-localization
```

Packages:
- `i18next` — core translation engine
- `react-i18next` — React bindings (`useTranslation`, `I18nextProvider`)
- `expo-localization` — device locale detection (already transitive, making explicit)

No additional plugins needed for Phase 0+1. Translation files are bundled statically (no lazy loading yet).

---

## 2. i18n Initialization

### New file: `app-mobile/src/i18n/index.ts`

```typescript
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getLocales } from 'expo-localization'
import { LANGUAGES } from '../constants/languages'

// Import all translation files statically
import en_common from './locales/en/common.json'
import en_onboarding from './locales/en/onboarding.json'
import es_common from './locales/es/common.json'
import es_onboarding from './locales/es/onboarding.json'

const LANGUAGE_STORAGE_KEY = 'mingla_preferred_language'

/**
 * Detect device language. Returns ISO 639-1 code if in our supported list, else 'en'.
 */
function getDeviceLanguage(): string {
  try {
    const locales = getLocales()
    if (locales?.length > 0) {
      const code = locales[0].languageCode
      if (code && LANGUAGES.some((l) => l.code === code)) return code
    }
  } catch {}
  return 'en'
}

/**
 * Read persisted language from AsyncStorage.
 * This is the pre-auth fallback (before profile is available).
 */
export async function getPersistedLanguage(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Persist language choice to AsyncStorage.
 * Called when user selects a language in onboarding or settings.
 */
export async function persistLanguage(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code)
  } catch {}
}

i18n.use(initReactI18next).init({
  resources: {
    en: { common: en_common, onboarding: en_onboarding },
    es: { common: es_common, onboarding: es_onboarding },
  },
  lng: getDeviceLanguage(),       // Synchronous initial — updated async below
  fallbackLng: 'en',
  ns: ['common', 'onboarding'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,           // React already escapes
  },
  react: {
    useSuspense: false,           // No Suspense in RN — use loading state
  },
  compatibilityJSON: 'v4',       // Use v4 plural rules (ICU)
  pluralSeparator: '_',          // key_one, key_other
})

// Async bootstrap: read persisted language (takes priority over device locale)
getPersistedLanguage().then((stored) => {
  if (stored && stored !== i18n.language) {
    i18n.changeLanguage(stored)
  }
})

export default i18n
```

### Language Detection Cascade (priority order)

1. `AsyncStorage` persisted choice (set during onboarding or settings) — **highest priority**
2. `profile.preferred_language` from Supabase (synced post-auth) — **second**
3. Device locale via `expo-localization` — **third**
4. Fallback `'en'` — **last resort**

### Post-Auth Sync

In `app/index.tsx` (or wherever the auth-gated app content mounts), add a one-time sync effect:

```typescript
import i18n from '../src/i18n'
import { persistLanguage } from '../src/i18n'

// Inside the auth-gated component:
useEffect(() => {
  if (profile?.preferred_language && profile.preferred_language !== i18n.language) {
    i18n.changeLanguage(profile.preferred_language)
    persistLanguage(profile.preferred_language)
  }
}, [profile?.preferred_language])
```

This ensures that if a user changes language on another device (or their profile has a language set from a previous session), the app picks it up.

---

## 3. Provider Mount Point

### File: `app-mobile/app/_layout.tsx`

Import i18n initialization at the top of the file (side-effect import — initializes i18next):

```typescript
import '../src/i18n'  // Must be first — initializes i18next before any component renders
```

No `<I18nextProvider>` wrapper needed — `react-i18next` v13+ uses `initReactI18next` plugin which registers i18n globally. The `useTranslation()` hook works without a provider.

---

## 4. Translation File Structure

```
app-mobile/src/i18n/
  index.ts                          # Initialization (specified above)
  locales/
    en/
      common.json                   # Shared buttons, labels, alerts
      onboarding.json               # All onboarding strings
    es/
      common.json                   # Spanish common
      onboarding.json               # Spanish onboarding
```

---

## 5. Translation Key Convention

### Naming rules:
- **Namespace:** `common` for shared UI, `onboarding` for onboarding-specific
- **Key format:** `{substep}.{element}` (e.g., `welcome.greeting_line1`)
- **Nested keys** for grouped content (e.g., `phone.consent_text`)
- **Interpolation:** `{{variable}}` (i18next default)
- **Pluralization:** `key_one` / `key_other` (ICU via `count` parameter)

### Common namespace keys (`common.json`)

```json
{
  "continue": "Continue",
  "next": "Next",
  "back": "Back",
  "back_to_sign_in": "Back to sign in",
  "done": "Done",
  "skip": "Skip",
  "retry": "Retry",
  "saving": "Saving...",
  "error": "Error",
  "something_went_wrong": "Something went wrong",
  "lets_go": "Let's go",
  "accept": "Accept",
  "decline": "Decline",
  "join": "Join",
  "add": "Add",
  "invite": "Invite",
  "start_session": "Start session",
  "accept_all": "Accept All",
  "decline_all": "Decline All",
  "verified": "Verified",
  "sounds_good_lets_go": "Sounds good — let's go",
  "ill_do_this_later": "I'll do this later"
}
```

### Onboarding namespace keys (`onboarding.json`)

The complete key map is specified below by substep. The implementor must extract every string from these files and replace with `t()` calls.

#### `language` substep (NEW — first screen)

```json
{
  "language": {
    "search_placeholder": "Search languages..."
  }
}
```

Note: The language screen is intentionally minimal. Language names display in their native script (from `LANGUAGES` constant), not from translation files. The search placeholder is the only translatable string.

#### `welcome` substep

```json
{
  "welcome": {
    "greeting_hey": "Hey",
    "greeting_name": "{{name}}.",
    "greeting_good_taste": "Good taste",
    "greeting_walked_in": "just walked in.",
    "we_know": "We know",
    "good_taste": "good taste",
    "just_walked_in": "just walked in.",
    "name_prompt": "But we don't know your name yet.",
    "placeholder_first": "First",
    "placeholder_last": "Last",
    "cta": "Let's go"
  }
}
```

#### `phone` substep

```json
{
  "phone": {
    "headline": "What's your number?",
    "body": "We'll send a code. Takes two seconds.",
    "verified_headline": "You're all set.",
    "verified_body": "Your number's locked in. One less thing.",
    "consent_text": "I agree to receive messages from Mingla via SMS or phone call, including verification codes, friend invitations, and experience reminders. Reply STOP to opt out or HELP for help. See our ",
    "terms_of_service": "Terms of Service",
    "and": " and ",
    "privacy_policy": "Privacy Policy",
    "consent_accessibility": "Agree to receive messages from Mingla",
    "cta_send_code": "Send code",
    "placeholder_phone": "(555) 123-4567",
    "country_accessibility": "Selected country: {{name}}. Tap to change."
  }
}
```

#### `otp` substep

```json
{
  "otp": {
    "headline": "Enter the code",
    "body": "Sent to {{phone}}",
    "verifying": "Verifying...",
    "sending": "Sending...",
    "resend_countdown": "Resend in {{seconds}}s",
    "channel_label": "Didn't get it? Try another way:",
    "resend_sms": "Resend SMS",
    "resend_sms_accessibility": "Resend code via SMS",
    "call_me": "Call me instead",
    "call_me_accessibility": "Receive code via phone call",
    "error_max_attempts": "Three tries, no luck. Try a different method below.",
    "error_wrong_code": "That code didn't land. Try again.",
    "cta_verify": "Verify",
    "otp_accessibility": "One-time verification code"
  }
}
```

#### `gender_identity` substep

```json
{
  "gender": {
    "headline": "Tell us about you.",
    "body": "So we can get your picks right.",
    "man": "Man",
    "woman": "Woman",
    "non_binary": "Non-binary",
    "transgender": "Transgender",
    "genderqueer": "Genderqueer",
    "genderfluid": "Genderfluid",
    "agender": "Agender",
    "prefer_not_to_say": "Prefer not to say"
  }
}
```

Note: `GENDER_DISPLAY_LABELS` in `types/onboarding.ts` must be replaced with translation keys. The implementor should build a `getGenderLabel(key)` helper that calls `t(`gender.${key.replace(/-/g, '_')}`)`.

#### `details` substep

```json
{
  "details": {
    "headline": "Almost done.",
    "body": "Just the basics. We'll handle the rest.",
    "country_label": "Country",
    "country_helper": "Sets your currency and units of measurement",
    "dob_label": "Date of birth",
    "dob_placeholder": "When's your birthday?"
  }
}
```

Note: Language picker is REMOVED from this substep.

#### `value_prop` substep

```json
{
  "value_prop": {
    "beat1_headline": "Know exactly where to go.",
    "beat1_sub": "Stop guessing. Start going.",
    "beat2_headline": "For dates, friends & solo runs.",
    "beat2_sub": "Plans for every kind of outing.",
    "beat3_headline": "Find it fast. Go.",
    "beat3_sub": "Swipe. Save. Go."
  }
}
```

#### `intents` substep

```json
{
  "intents": {
    "headline": "Now the fun part.",
    "body": "Tap every vibe that sounds like you.",
    "caption": "Pick the one that excites you most.",
    "adventurous": "Adventurous",
    "adventurous_desc": "Explore the unexpected",
    "first_date": "First Dates",
    "first_date_desc": "Nail the first impression",
    "romantic": "Romantic",
    "romantic_desc": "Turn up the spark",
    "group_fun": "Group Fun",
    "group_fun_desc": "The more the merrier",
    "picnic_dates": "Picnic Dates",
    "picnic_dates_desc": "Sun, snacks, good times",
    "take_a_stroll": "Take a Stroll",
    "take_a_stroll_desc": "Wander with purpose"
  }
}
```

Note: `ONBOARDING_INTENTS` in `types/onboarding.ts` currently has hardcoded `label` and `description` fields. The implementor should keep the data structure but replace display strings with `t()` calls at render time, NOT modify the constant itself. The constant's `id` field remains the canonical identifier.

#### `location` substep

```json
{
  "location": {
    "granted_headline": "Locked in — {{city}}!",
    "granted_tap_hint": "Tap to continue",
    "settings_headline": "One quick toggle",
    "settings_body": "Location is off for Mingla.\nTurn it on in Settings so we can find\nthe best spots near you.",
    "open_settings": "Open Settings",
    "retry_turned_on": "I've turned it on — retry",
    "retry_finding": "Finding you...",
    "type_city": "Type my city instead",
    "error_headline": "Couldn't get your location",
    "error_body": "Weak signal or GPS still warming up.\nTry again or type your city instead.",
    "try_again": "Try Again",
    "idle_headline": "Better spots start here",
    "idle_body": "Enable GPS so we can find hidden\ngems right around the corner.",
    "enable_location": "Enable Location",
    "privacy_hint": "Your location stays private. Always.",
    "cta_enable": "Enable location"
  }
}
```

#### `celebration` substep

```json
{
  "celebration": {
    "headline": "Look at you go.",
    "body": "Four quick picks and you're done."
  }
}
```

#### `manual_location` substep

```json
{
  "manual_location": {
    "headline": "Drop your pin on the map",
    "body": "Give us your exact address — down to the street — and we'll unlock the best spots around you.",
    "search_placeholder": "Start typing your address...",
    "no_results": "Hmm, we didn't catch that. Try a nearby street or neighborhood.",
    "helper": "The more precise, the better your recommendations.",
    "privacy": "Your exact location stays between us. Always."
  }
}
```

#### `categories` substep

```json
{
  "categories": {
    "headline": "What kind of places do you love?",
    "body": "Pick up to 3 that match your vibe.",
    "cap_message": "Maximum 3 categories. Deselect one to choose another."
  }
}
```

Note: Category names (`Nature`, `Casual Eats`, etc.) come from `constants/categories.ts`. These will be translated in Phase 2, not Phase 1. For Phase 1, category names remain English.

#### `budget` substep

```json
{
  "budget": {
    "headline": "Your sweet spot",
    "body": "Pick the price ranges that work.",
    "caption": "Free stuff always shows up too."
  }
}
```

Note: Price tier labels (`Chill`, `Comfy`, etc.) come from `constants/priceTiers.ts`. These will be translated in Phase 2. For Phase 1, tier labels remain English.

#### `transport` substep

```json
{
  "transport": {
    "headline": "How do you get around?",
    "body": "Helps us nail the travel times."
  }
}
```

Note: Transport mode labels (`Walking`, `Biking`, etc.) come from `types/onboarding.ts`. Translated in Phase 2.

#### `travel_time` substep

```json
{
  "travel_time": {
    "headline": "How far will you go?",
    "body": "Set your comfort zone.",
    "custom_toggle": "Set your own",
    "custom_placeholder": "5 – 120 minutes",
    "unit": "min",
    "caption": "Up to {{minutes}} min by {{mode}}",
    "error": "Couldn't save your preferences. Tap Retry to try again."
  }
}
```

#### `friends` substep

```json
{
  "friends": {
    "headline": "Your inner circle",
    "body": "Add your closest people, then pair up. You'll discover things to do together, see what they love, and plan the good stuff side by side.",
    "waiting_header": "Waiting for you",
    "added_feedback": "Added",
    "declined_feedback": "Declined",
    "add_friends_header": "Add friends",
    "your_people_header": "Your people",
    "status_friends": "Friends",
    "status_request_sent": "Request sent",
    "status_invited": "Invited",
    "pair_paired": "Paired",
    "pair_pending": "Pending",
    "pair_queued": "Queued",
    "pair_button": "Pair",
    "pair_queued_hint": "Activates when they join",
    "empty_state": "No friends here yet. Add someone you'd actually make plans with.",
    "pair_requests_header": "Pair requests",
    "paired_feedback": "Paired!",
    "pair_wants": "Wants to pair with you",
    "pair_curated": "See experiences curated for both of you.",
    "alert_self_title": "That's you",
    "alert_self_message": "You can't add yourself as a friend.",
    "alert_duplicate_title": "Already added",
    "alert_duplicate_message": "This person is already in your list.",
    "alert_pair_error": "Could not send pair request",
    "alert_accept_error": "Couldn't accept the pair request. Try again.",
    "alert_decline_error": "Couldn't decline the pair request. Try again.",
    "alert_generic_error": "Couldn't process the request. Try again.",
    "share_message": "Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com",
    "fallback_user": "User"
  }
}
```

#### `collaborations` substep

```json
{
  "collaborations": {
    "headline": "Plan something together",
    "body": "Start a session with your crew. Discover things to do, vote on favorites, and actually make it happen.",
    "whos_in": "Who's in?",
    "session_name_label": "Session name",
    "session_name_placeholder": "e.g. Weekend plans, Date night ideas...",
    "created_header": "Created sessions ({{count}})",
    "loading_invites": "Loading invites...",
    "invited_header": "You're invited ({{count}})",
    "inviter_message": "{{name}} invited you",
    "fallback_someone": "Someone",
    "fallback_session": "Session",
    "name_taken_error": "That name's taken. Get creative!",
    "generic_error": "Hmm, that didn't work. Give it another go.",
    "join_error": "Could not join session",
    "decline_error": "Could not decline invite",
    "empty_state": "Add friends first — then you can start planning together."
  }
}
```

#### `consent` substep

```json
{
  "consent": {
    "headline": "One quick thing",
    "body": "Mingla uses what you've shared — your tastes, your vibe, your location — to find experiences you'll genuinely love. Your data stays yours. We never sell it, and you can delete it anytime."
  }
}
```

#### `getting_experiences` substep

```json
{
  "getting_experiences": {
    "loading_1": "Checking spots nearby...",
    "loading_2": "Matching your preferences...",
    "loading_3": "Finding hidden gems...",
    "loading_4": "Almost there..."
  }
}
```

#### `occasions` (used in celebration substep data)

```json
{
  "occasions": {
    "birthday": "Birthday",
    "valentines": "Valentine's Day",
    "mothers_day": "Mother's Day",
    "fathers_day": "Father's Day",
    "christmas": "Christmas"
  }
}
```

---

## 6. Onboarding Resequencing

### 6.1 Type change

**File:** `app-mobile/src/types/onboarding.ts:5`

```typescript
// BEFORE:
export type Step1SubStep = 'welcome' | 'phone' | 'otp' | 'gender_identity' | 'details'

// AFTER:
export type Step1SubStep = 'language' | 'welcome' | 'phone' | 'otp' | 'gender_identity' | 'details'
```

### 6.2 State machine change

**File:** `app-mobile/src/hooks/useOnboardingStateMachine.ts:12`

```typescript
// BEFORE:
1: ['welcome', 'phone', 'otp', 'gender_identity', 'details'],

// AFTER:
1: ['language', 'welcome', 'phone', 'otp', 'gender_identity', 'details'],
```

**Line 145 comment update:**
```typescript
// BEFORE:
// At Step 1 welcome — can't go back further

// AFTER:
// At Step 1 language — can't go back further
```

### 6.3 Data initialization

**File:** `app-mobile/src/hooks/useOnboardingResume.ts:52`

The `BASE_INITIAL_DATA` already has `userPreferredLanguage: 'en'`. This is correct as a static default.

**File:** `app-mobile/src/components/OnboardingFlow.tsx`

Find where `data` state is initialized (the `useState<OnboardingData>` call). Ensure `userPreferredLanguage` is set to `getDefaultLanguageCode()` at initialization time, NOT deferred to OTP verification.

The current code at ~line 1245 sets `userPreferredLanguage: getDefaultLanguageCode()` inside the OTP verification handler. This must be moved to initial data construction (or remain as a no-op since `useOnboardingResume` already sets it at line 136).

### 6.4 Language substep render block

**File:** `app-mobile/src/components/OnboardingFlow.tsx`

Add BEFORE the `welcome` block (before line 1920):

```typescript
if (subStep === 'language') {
  return (
    <LanguageSelectionStep
      selectedCode={data.userPreferredLanguage}
      onSelect={(code: string) => {
        setData((p) => ({ ...p, userPreferredLanguage: code }))
        i18n.changeLanguage(code)
        persistLanguage(code)
      }}
    />
  )
}
```

### 6.5 New component: `LanguageSelectionStep`

**File:** `app-mobile/src/components/onboarding/LanguageSelectionStep.tsx`

This is an **inline** language picker (NOT a modal). Renders directly inside the OnboardingShell scrollable content area.

**Props:**
```typescript
interface LanguageSelectionStepProps {
  selectedCode: string
  onSelect: (code: string) => void
}
```

**UI specification:**
- **Search bar** at top: TextInput with search icon, placeholder from `t('onboarding:language.search_placeholder')` (self-referencing — displays in whatever language is currently active, which is the device locale initially)
- **Language list** below: FlatList of `LANGUAGES` (from `constants/languages.ts`)
  - Each row shows: native name (bold), English name (lighter, smaller)
  - Selected language has checkmark icon + highlighted background
  - Row height: 52px (matches `LanguagePickerModal`)
  - `keyboardShouldPersistTaps="handled"`
- **Haptic feedback** on selection: `Haptics.impactAsync(Light)`
- **No close button** (this is inline content, not a modal)
- Reuse styles from `LanguagePickerModal` — identical row rendering, search logic, `getItemLayout` optimization

The language names are inherently multilingual (they display in native script from the `LANGUAGES` constant), so this screen works correctly regardless of the currently active i18n locale.

### 6.6 CTA config

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (in `getCtaConfig`)

Add BEFORE the `'welcome'` case:

```typescript
case 'language':
  return {
    label: t('common:continue'),
    disabled: false,
    loading: false,
    onPress: handleGoNext,
    hide: false,
  }
```

Always enabled — the device language is pre-selected, so the user can just tap Continue.

### 6.7 Remove language from details

**File:** `app-mobile/src/components/OnboardingFlow.tsx:2268-2290`

Delete the entire "Preferred Language" section from the `details` substep:
- The `<Text>` "Language" label (line 2269)
- The `<Pressable>` picker trigger (lines 2270-2282)
- The `<LanguagePickerModal>` (lines 2285-2290)

Also remove the `showLanguagePicker` state and `setShowLanguagePicker` setter since they are no longer needed.

### 6.8 Shell showBackButton logic

**File:** `app-mobile/src/components/OnboardingFlow.tsx`

Find where `showBackButton` is computed for the OnboardingShell. Currently, the first substep (`welcome`) shows no back button (shows "Back to sign in" instead). The new first substep is `language`.

The implementor must verify that:
- `language` substep shows "Back to sign in" (not a back arrow) — this is the new first screen
- `welcome` substep now shows a back arrow (not "Back to sign in") — it's the second screen

This is likely controlled by checking `navState.subStep === 'welcome'` or `step === 1 && idx === 0`. The implementor must update this to work with `'language'` as the new first substep.

---

## 7. Component Translation Pattern

### Standard pattern for all components:

```typescript
// Import
import { useTranslation } from 'react-i18next'

// Inside component:
const { t } = useTranslation('onboarding')

// Simple text:
<Text>{t('welcome.greeting_hey')}</Text>

// Interpolation:
<Text>{t('otp.body', { phone: buildE164() })}</Text>

// Pluralization (not needed in Phase 1, but establish pattern):
<Text>{t('key', { count: number })}</Text>

// Multiple namespaces:
const { t } = useTranslation(['onboarding', 'common'])
<Text>{t('onboarding:welcome.headline')}</Text>
<Text>{t('common:continue')}</Text>

// Alert.alert:
Alert.alert(t('common:error'), t('friends.alert_pair_error'))

// Placeholder:
<TextInput placeholder={t('welcome.placeholder_first')} />

// Accessibility:
<Pressable accessibilityLabel={t('phone.consent_accessibility')} />
```

### CTA labels:

CTA labels in `getCtaConfig` must use `t()`. This requires `useTranslation` in the component that calls `getCtaConfig`. Since `getCtaConfig` is a `useCallback` inside `OnboardingFlow`, `t` is available in scope.

```typescript
// Inside OnboardingFlow:
const { t } = useTranslation(['onboarding', 'common'])

// In getCtaConfig:
case 'welcome':
  return { label: t('common:lets_go'), ... }
case 'phone':
  return data.phoneVerified
    ? { label: t('common:continue'), ... }
    : { label: t('phone.cta_send_code'), ... }
// ... etc for all cases
```

### OnboardingShell strings:

The shell has two translatable strings:
- "Saving..." (line 218) → `t('common:saving')`
- "Back to sign in" / "Back" (line 177) → `t('common:back_to_sign_in')` / `t('common:back')`

---

## 8. Success Criteria

| # | Criterion | How to Test |
|---|-----------|-------------|
| SC-1 | i18n provider initializes without error on app launch | App launches, no crash, no console error from i18next |
| SC-2 | Language picker is the first screen in onboarding (before name entry) | Fresh user sees language list before "We know good taste just walked in" |
| SC-3 | Selecting Spanish on language screen causes all subsequent onboarding screens to render in Spanish | Pick "Espanol", tap Continue → "We know" becomes Spanish equivalent on welcome screen |
| SC-4 | Device locale pre-selects the correct language | Device set to Spanish → "Espanol" is pre-selected with checkmark on language screen |
| SC-5 | Closing and reopening the app preserves the language choice | Pick French, kill app, reopen → French is still the active language |
| SC-6 | English fallback works for missing keys | Set to a language with no translations (e.g., 'de') → all text renders in English, no blank strings |
| SC-7 | `details` substep no longer shows a language picker | Navigate to details → only Country and Date of Birth visible |
| SC-8 | goBack from `welcome` returns to `language` screen | On name entry screen, tap Back → language picker appears |
| SC-9 | All onboarding strings use translation keys | Grep for hardcoded English strings in onboarding components → zero results (excluding log messages and constants that will be translated in Phase 2) |
| SC-10 | Language persists to `profile.preferred_language` after onboarding completes | Complete onboarding → check Supabase profiles row → `preferred_language` matches selection |
| SC-11 | Profile language syncs to i18n on auth-gated app load | User with `preferred_language: 'es'` in profile → app loads in Spanish |
| SC-12 | Interpolated strings render correctly | `{{name}}`, `{{phone}}`, `{{city}}` variables display actual values, not raw keys |
| SC-13 | OnboardingShell CTA labels are translated | All button labels ("Let's go", "Send code", "Verify", "Next", "Continue") render in chosen language |

---

## 9. Invariants

### Preserved invariants:
- **Persisted-state startup (Constitution #14):** Language choice survives app restart via AsyncStorage
- **No silent failures (Constitution #3):** Missing translation keys fall back to English, never show blank
- **One owner per truth (Constitution #2):** Language truth cascade: AsyncStorage → profile → device → 'en'. No competing sources.

### New invariants established:
- **INV-I18N-001:** Every user-facing string in an i18n-migrated component MUST use `t()`. No hardcoded English strings in translated components.
- **INV-I18N-002:** The `common` namespace is the single source for shared strings (buttons, alerts). Never duplicate these in feature namespaces.
- **INV-I18N-003:** `i18n.changeLanguage()` and `persistLanguage()` must always be called together. Never change one without the other.

---

## 10. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Fresh user, English device | Launch app, no language change | Language screen shows, English pre-selected. All onboarding in English. | Component + i18n |
| T-02 | Fresh user, picks Spanish | Select "Espanol" on language screen, tap Continue | Welcome screen shows Spanish text. All subsequent screens in Spanish. | Component + i18n |
| T-03 | Device is Spanish | Device locale = es, launch app | Spanish pre-selected on language screen. Continue → onboarding in Spanish. | i18n + expo-localization |
| T-04 | Persistence across restart | Pick French, complete Step 1, kill app, reopen | App reopens with French active. Onboarding resumes at correct step. | AsyncStorage + i18n |
| T-05 | goBack from welcome | On welcome screen, tap Back | Returns to language picker screen. Language still selected. | State machine |
| T-06 | goBack from language | On language screen, tap back | Shows "Back to sign in" button, triggers sign-out. | State machine + Shell |
| T-07 | Missing translation fallback | Set language to German (no de.json yet) | All text renders in English. No blank strings. No crashes. | i18n fallback |
| T-08 | Details screen no language | Navigate to details substep | Only Country and Date of Birth fields visible. No language picker. | Component |
| T-09 | Profile sync post-auth | User with preferred_language='es' in Supabase | App loads, i18n switches to Spanish automatically. | Store + i18n |
| T-10 | Interpolation renders | Pick Spanish, reach OTP screen | "Sent to +1..." displays actual phone number, not "{{phone}}" | i18n interpolation |
| T-11 | CTA labels translate | Pick Spanish, navigate through all steps | All CTA buttons show Spanish text | Component + i18n |
| T-12 | OnboardingShell translates | Pick Spanish, trigger loading state | "Saving..." shows Spanish equivalent | Shell + i18n |
| T-13 | Language change mid-flow | On Step 3, go back to language screen, switch to English | All subsequent screens render in English | i18n runtime change |

---

## 11. Implementation Order

Execute in this exact sequence:

| Step | Action | Files |
|------|--------|-------|
| **1** | Install dependencies | `app-mobile/package.json` |
| **2** | Create translation files (en + es) | `app-mobile/src/i18n/locales/en/common.json`, `onboarding.json`, `es/common.json`, `es/onboarding.json` |
| **3** | Create i18n initialization module | `app-mobile/src/i18n/index.ts` |
| **4** | Import i18n in app root | `app-mobile/app/_layout.tsx` |
| **5** | Add `'language'` to types | `app-mobile/src/types/onboarding.ts` |
| **6** | Add `'language'` to state machine | `app-mobile/src/hooks/useOnboardingStateMachine.ts` |
| **7** | Create `LanguageSelectionStep` component | `app-mobile/src/components/onboarding/LanguageSelectionStep.tsx` |
| **8** | Add language substep render block + CTA config in OnboardingFlow | `app-mobile/src/components/OnboardingFlow.tsx` |
| **9** | Remove language from details substep | `app-mobile/src/components/OnboardingFlow.tsx` |
| **10** | Add `useTranslation` to OnboardingFlow + replace all hardcoded strings | `app-mobile/src/components/OnboardingFlow.tsx` |
| **11** | Add `useTranslation` to OnboardingShell + replace strings | `app-mobile/src/components/onboarding/OnboardingShell.tsx` |
| **12** | Add `useTranslation` to PhoneInput + replace strings | `app-mobile/src/components/onboarding/PhoneInput.tsx` |
| **13** | Add `useTranslation` to OTPInput + replace strings | `app-mobile/src/components/onboarding/OTPInput.tsx` |
| **14** | Add `useTranslation` to OnboardingFriendsAndPairingStep + replace strings | `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` |
| **15** | Add `useTranslation` to OnboardingCollaborationStep + replace strings | `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` |
| **16** | Add `useTranslation` to OnboardingConsentStep + replace strings | `app-mobile/src/components/onboarding/OnboardingConsentStep.tsx` |
| **17** | Add post-auth language sync effect | `app-mobile/app/index.tsx` |
| **18** | Update showBackButton logic for language substep | `app-mobile/src/components/OnboardingFlow.tsx` |
| **19** | Verify: grep onboarding components for remaining hardcoded English | All onboarding files |

---

## 12. Regression Prevention

- **Structural safeguard:** `eslint-plugin-i18next` can flag hardcoded strings in JSX. Recommend adding in a follow-up PR (not blocking for Phase 1).
- **Manual check:** After implementation, run `grep -rn ">[A-Z][a-z]" app-mobile/src/components/onboarding/` to catch any remaining hardcoded English text nodes.
- **INV-I18N-001** ensures all future onboarding changes use `t()` — the pattern is established and visible in every file.

---

## Discoveries for Orchestrator

None new (all side issues already registered as ORCH-0387, ORCH-0388).
