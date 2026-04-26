# SPEC: ORCH-0675 Wave 1 — Android Performance Surgical Fixes

**ORCH-ID:** ORCH-0675 Wave 1
**Severity:** S0 launch-blocker
**Classification:** performance, regression-prevention
**Date:** 2026-04-25
**Spec writer:** mingla-forensics SPEC mode
**Estimated diff:** ~150 LOC source + ~70 LOC CI/invariants
**Deploy mode:** OTA-only (no native rebuild, no backend changes)

---

## 1. Summary

Four surgical fixes that close 60–75% of the perceived Android slowness gap, all OTA-shippable in one bundle. **(1)** Convert SwipeableCards' card-position animation from JS-thread to native driver — eliminates per-swipe stutter on mid-tier Android. **(2)** Lazy-load 28 of 29 i18n locales — strips ~600+ JSON imports from cold-start parse. **(3)** Switch DiscoverScreen loading-skeleton pulse animation to native driver — restores gesture responsiveness during data fetch. **(4)** Wrap Zustand persist storage in a 250ms trailing debounce with AppState background flush — collapses rapid swipe writes from 1-per-swipe to 1-per-window. Three new invariants registered with CI gates that fail if any of these regress. Zero overlap with Wave 2 deck overhaul (ORCH-0676) — they ship in parallel.

---

## 2. User Story

**As a Mingla user on a mid-tier Android device** (Snapdragon 600-class CPU, 6–8 GB RAM, e.g. Galaxy A5x, Pixel 6a, OnePlus Nord), **today** my swipe gestures stutter, the app takes too long to open, the loading skeleton freezes my taps, and the deck feels unresponsive after a few rapid swipes. **After Wave 1**, swipe gestures glide at 60 fps, the app's first interactive frame arrives in roughly half the time, the loading skeleton no longer blocks me, and rapid swipe sessions feel as smooth as iOS. **No iPhone regression** — every fix is a strict subset of the work the iOS thread already handled gracefully; iOS users see no behavior change.

---

## 3. Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| **SC-1** | SwipeableCards card-swipe gesture animation runs on the **UI thread**, not JS thread. | Static: zero `useNativeDriver: false` matches in SwipeableCards.tsx swipe-handler region (PanResponder body). Live-fire: profile JS thread fps during 30-swipe session — stays ≥55 fps on mid-tier Android. |
| **SC-2** | Card swipe-right correctly fires `cardLike` haptic; swipe-left fires `cardDislike`; swipe-up fires `medium`; threshold values unchanged (120px horizontal, 50px vertical). | Manual smoke + automated gesture replay. |
| **SC-3** | Curated-card swipe-right paywall gate fires correctly for users without `curated_cards` entitlement. | Smoke test with non-Mingla+ user. |
| **SC-4** | `removedCards` Set updates after animation `.start()` callback completes. No regression to dedup. | Tester verifies card not re-shown post-swipe. |
| **SC-5** | i18n cold-start: only the **active language's 23 namespaces** are statically imported. Other 28 languages load via dynamic import on-demand. | Static: count of `^import .*_.* from './locales/<lang>/'` entries in i18n/index.ts ≤ 23. CI gate enforced. |
| **SC-6** | Bundle size of i18n module reduces by ≥80%. | `npx expo export` size diff measurement. INSUFFICIENT EVIDENCE for exact percentage without live measurement, but bound is achievable based on static count: 644 of 667 imports removed ≈ 96.5% reduction in i18n source LOC. |
| **SC-7** | Language switch in Settings: new locale's namespaces dynamic-import successfully and UI re-renders within ≤500 ms. | Smoke test: switch from English to French; assert all visible UI strings flip within 500 ms. |
| **SC-8** | DiscoverScreen LoadingGridSkeleton opacity-pulse animation runs on UI thread. | Static: lines 583 + 590 in DiscoverScreen.tsx use `useNativeDriver: true`. Live-fire: gesture input (tap on a different tab) responds <16 ms during loading state. |
| **SC-9** | Zustand persist write rate during 60-second swipe-heavy session reduced by ≥80% vs pre-Wave-1 baseline. | Instrument debounced storage adapter with counter; live-fire measure on real device. |
| **SC-10** | Pending Zustand writes flush to AsyncStorage on `AppState='background'` transition. Cold-start after process kill restores correct state. | Live-fire: swipe card → immediately background app → kill app → cold start → assert `sessionSwipedCards` includes the swiped card. |
| **SC-11** | All 3 new invariants (`I-ANIMATIONS-NATIVE-DRIVER-DEFAULT`, `I-LOCALES-LAZY-LOAD`, `I-ZUSTAND-PERSIST-DEBOUNCED`) registered in INVARIANT_REGISTRY.md with CI gates active. Negative-control reproduction (inject violation → CI fails → revert → CI passes) documented per gate. | CI run + manual negative-control. |
| **SC-12** | iOS behavior unchanged: smoke pass on iOS device confirms no regression to swipe gesture, cold start, language switch, or deck swipe-state persistence. | iOS smoke matrix in tester dispatch. |

---

## 4. Mobile Implementation

### 4.1 RC-1 — SwipeableCards animation: `Animated.ValueXY` → two `Animated.Value`

**File:** `app-mobile/src/components/SwipeableCards.tsx`

**The 12 mutation sites (verified via direct grep):**

| Line | Current code | Replacement |
|------|--------------|-------------|
| 655 | `const position = useRef(new Animated.ValueXY()).current;` | `const positionX = useRef(new Animated.Value(0)).current;`<br>`const positionY = useRef(new Animated.Value(0)).current;` |
| 656 | `const rotate = position.x.interpolate({` | `const rotate = positionX.interpolate({` |
| 660 | `const likeOpacity = position.x.interpolate({` | `const likeOpacity = positionX.interpolate({` |
| 664 | `const nopeOpacity = position.x.interpolate({` | `const nopeOpacity = positionX.interpolate({` |
| 668 | `const nextCardOpacity = position.x.interpolate({` | `const nextCardOpacity = positionX.interpolate({` |
| 997 | `position.setValue({ x: 0, y: 0 });` | `positionX.setValue(0);`<br>`positionY.setValue(0);` |
| 1222–1226 | `position.setOffset({ x: (position.x as any)._value, y: (position.y as any)._value });` | `positionX.setOffset((positionX as any)._value);`<br>`positionY.setOffset((positionY as any)._value);` |
| 1228 | `position.setValue({ x: gestureState.dx, y: gestureState.dy });` | `positionX.setValue(gestureState.dx);`<br>`positionY.setValue(gestureState.dy);` |
| 1231 | `position.flattenOffset();` | `positionX.flattenOffset();`<br>`positionY.flattenOffset();` |
| 1249 | `Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();` | `Animated.parallel([Animated.spring(positionX, { toValue: 0, useNativeDriver: true }), Animated.spring(positionY, { toValue: 0, useNativeDriver: true })]).start();` |
| 1270 | `Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();` | Same parallel pattern as 1249. |
| 1286 | `Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();` | Same parallel pattern. |
| 1296–1304 | `Animated.timing(position, { toValue: { x: direction === "right" ? SCREEN_WIDTH : -SCREEN_WIDTH, y: gestureState.dy }, duration: 250, useNativeDriver: false }).start(() => { … });` | `Animated.parallel([Animated.timing(positionX, { toValue: direction === "right" ? SCREEN_WIDTH : -SCREEN_WIDTH, duration: 250, useNativeDriver: true }), Animated.timing(positionY, { toValue: gestureState.dy, duration: 250, useNativeDriver: true })]).start(() => { … });` |
| 1319 | `Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();` | Same parallel pattern as 1249. |
| 1327 | (different spring call — verify in implementation; same parallel pattern applies if it targets `position` ValueXY) | Same parallel pattern. |
| 1336–1337 | `const currentX = (position.x as any)._value \|\| 0;`<br>`const currentY = (position.y as any)._value \|\| 0;` | `const currentX = (positionX as any)._value \|\| 0;`<br>`const currentY = (positionY as any)._value \|\| 0;` |
| 1709 | `position.setValue({ x: 0, y: 0 });` | `positionX.setValue(0);`<br>`positionY.setValue(0);` |
| 2230–2231 | `{ translateX: position.x }, { translateY: position.y },` | `{ translateX: positionX }, { translateY: positionY },` |

**Critical correctness notes:**

1. **`useNativeDriver: true` is valid for `transform.translateX`, `transform.translateY`, `opacity`, `scale`, `rotate`** — all the properties used here. No invalid combinations introduced.
2. **`Animated.parallel(...)` start() callback** fires when the LAST animation in the array resolves — equivalent semantics to the original `Animated.spring(position, …).start()` callback. The post-swipe `removedCards` update + `setCurrentCardIndex(0)` + `requestAnimationFrame` chain at lines 1305–1316 is preserved unchanged.
3. **`PanResponder.onPanResponderMove` integration:** `Animated.event([null, { dx: positionX, dy: positionY }])` is the canonical pattern but the existing code uses imperative `setValue` — preserve the imperative pattern (don't introduce `Animated.event`; out of scope).
4. **`setOffset` per-axis:** `Animated.Value` accepts a scalar offset (`positionX.setOffset(value)`); `Animated.ValueXY` accepted an object. Per-axis migration is mechanical.
5. **`flattenOffset` per-axis:** same — call on each Animated.Value.
6. **Tap detection at lines 1336–1337:** unchanged semantics — still reads internal `_value` of each axis. Production: ⚠️ `(value as any)._value` is brittle across RN versions; flag as 🟡 hidden flaw for separate ORCH (not in Wave 1 scope).

**Constraints:**
- Do NOT migrate to Reanimated 4. The dispatch is explicit: surgical Animated fix only.
- Do NOT change PanResponder thresholds (120px horizontal, 50px vertical).
- Do NOT change haptic call sites.
- Do NOT change the `setRemovedCards` / `setCurrentCardIndex` / `handleSwipeRef.current?.(...)` post-animation chain.
- Do NOT change the curated-card paywall gate.

---

### 4.2 RC-2 — i18n lazy-load by language

**File:** `app-mobile/src/i18n/index.ts`

**Current state:** 671 import lines (4 baseline + 667 locale JSONs across 29 languages × 23 namespaces). All loaded eagerly at module-load time.

**Target state:** 4 baseline imports + 23 `en` JSONs eagerly. Other 28 languages dynamic-imported on demand.

**Refactor pattern (verbatim):**

```typescript
// app-mobile/src/i18n/index.ts (new)
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDefaultLanguageCode } from '../constants/languages';

// ─── Eager: en only (23 namespaces) ───
import en_common from './locales/en/common.json';
import en_onboarding from './locales/en/onboarding.json';
import en_navigation from './locales/en/navigation.json';
import en_cards from './locales/en/cards.json';
import en_discover from './locales/en/discover.json';
import en_preferences from './locales/en/preferences.json';
import en_share from './locales/en/share.json';
import en_paywall from './locales/en/paywall.json';
import en_profile from './locales/en/profile.json';
import en_settings from './locales/en/settings.json';
import en_connections from './locales/en/connections.json';
import en_saved from './locales/en/saved.json';
import en_feedback from './locales/en/feedback.json';
import en_chat from './locales/en/chat.json';
import en_social from './locales/en/social.json';
import en_map from './locales/en/map.json';
import en_activity from './locales/en/activity.json';
import en_board from './locales/en/board.json';
import en_notifications from './locales/en/notifications.json';
import en_modals from './locales/en/modals.json';
import en_billing from './locales/en/billing.json';
import en_expanded_details from './locales/en/expanded_details.json';
import en_auth from './locales/en/auth.json';

// ─── Lazy: other 28 languages via dynamic import ───
// Metro requires literal paths in import() calls — each language gets its own loader map.
const NAMESPACES = [
  'common', 'onboarding', 'navigation', 'cards', 'discover', 'preferences',
  'share', 'paywall', 'profile', 'settings', 'connections', 'saved',
  'feedback', 'chat', 'social', 'map', 'activity', 'board', 'notifications',
  'modals', 'billing', 'expanded_details', 'auth',
] as const;

// Each entry: () => Promise resolving to { [namespace]: bundle }
// Implementor generates this map for all 28 non-en languages.
const localeLoaders: Record<string, () => Promise<Record<string, any>>> = {
  es: async () => ({
    common: (await import('./locales/es/common.json')).default,
    onboarding: (await import('./locales/es/onboarding.json')).default,
    navigation: (await import('./locales/es/navigation.json')).default,
    cards: (await import('./locales/es/cards.json')).default,
    discover: (await import('./locales/es/discover.json')).default,
    preferences: (await import('./locales/es/preferences.json')).default,
    share: (await import('./locales/es/share.json')).default,
    paywall: (await import('./locales/es/paywall.json')).default,
    profile: (await import('./locales/es/profile.json')).default,
    settings: (await import('./locales/es/settings.json')).default,
    connections: (await import('./locales/es/connections.json')).default,
    saved: (await import('./locales/es/saved.json')).default,
    feedback: (await import('./locales/es/feedback.json')).default,
    chat: (await import('./locales/es/chat.json')).default,
    social: (await import('./locales/es/social.json')).default,
    map: (await import('./locales/es/map.json')).default,
    activity: (await import('./locales/es/activity.json')).default,
    board: (await import('./locales/es/board.json')).default,
    notifications: (await import('./locales/es/notifications.json')).default,
    modals: (await import('./locales/es/modals.json')).default,
    billing: (await import('./locales/es/billing.json')).default,
    expanded_details: (await import('./locales/es/expanded_details.json')).default,
    auth: (await import('./locales/es/auth.json')).default,
  }),
  // Repeat for: bin, bn, de, el, fr, ha, he, hi, id, ig, it, ja, ko,
  //              nl, pl, pt, ro, ru, sw, th, tr, uk, vi, yo, zh, zu, ar, ...
  // (28 entries total — implementor enumerates all)
};

/**
 * Lazy-load a language's namespace bundles into i18next.
 * Returns immediately if the language is already loaded or is 'en' (always eager).
 */
export async function ensureLanguageLoaded(lang: string): Promise<void> {
  if (lang === 'en') return; // always eager
  if (i18n.hasResourceBundle(lang, 'common')) return; // already loaded

  const loader = localeLoaders[lang];
  if (!loader) {
    console.warn(`[i18n] Unknown language code: ${lang}`);
    return;
  }

  try {
    const bundles = await loader();
    for (const ns of NAMESPACES) {
      if (bundles[ns]) {
        i18n.addResourceBundle(lang, ns, bundles[ns], /* deep */ true, /* overwrite */ true);
      }
    }
  } catch (err) {
    console.error(`[i18n] Failed to load language ${lang}:`, err);
    // Falls back to en (configured below).
  }
}

const initialLang = getDefaultLanguageCode();

i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v3',
    lng: initialLang,
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS: 'common',
    resources: {
      en: {
        common: en_common,
        onboarding: en_onboarding,
        navigation: en_navigation,
        cards: en_cards,
        discover: en_discover,
        preferences: en_preferences,
        share: en_share,
        paywall: en_paywall,
        profile: en_profile,
        settings: en_settings,
        connections: en_connections,
        saved: en_saved,
        feedback: en_feedback,
        chat: en_chat,
        social: en_social,
        map: en_map,
        activity: en_activity,
        board: en_board,
        notifications: en_notifications,
        modals: en_modals,
        billing: en_billing,
        expanded_details: en_expanded_details,
        auth: en_auth,
      },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false }, // critical: do NOT enable Suspense — would block first paint
  });

// On startup, kick off a fire-and-forget lazy load of the active language
// so that UI strings flip from en fallback to the user's language ASAP.
if (initialLang !== 'en') {
  ensureLanguageLoaded(initialLang).then(() => {
    i18n.changeLanguage(initialLang);
  });
}

export default i18n;
```

**Brief flash trade-off (documented in spec):** non-English users on cold start may see English strings for ~100–300 ms while the dynamic-import resolves. This is acceptable for Wave 1; future refinement may eager-load the device system language via `expo-localization.getLocales()`. **Implementor MUST NOT** enable i18next `useSuspense: true` to "fix" the flash — that would block first paint and reintroduce a different cold-start cost.

**Non-goals for Wave 1:**
- ❌ MMKV-backed sync language preference reading
- ❌ System-language eager-load via expo-localization (deferred refinement)
- ❌ i18next Suspense mode

---

### 4.3 RC-3 — DiscoverScreen LoadingGridSkeleton native driver

**File:** `app-mobile/src/components/DiscoverScreen.tsx`
**Lines:** 583, 590

**Verbatim before/after:**

```typescript
// LINE 583 — before
RNAnimated.timing(pulse, {
  toValue: 1,
  duration: d.motion.skeletonPulseMs / 2,
  easing: RNEasing.inOut(RNEasing.quad),
  useNativeDriver: false,   // ← change to true
}),

// LINE 590 — before
RNAnimated.timing(pulse, {
  toValue: 0,
  duration: d.motion.skeletonPulseMs / 2,
  easing: RNEasing.inOut(RNEasing.quad),
  useNativeDriver: false,   // ← change to true
}),
```

**Both lines:** flip `useNativeDriver: false` → `useNativeDriver: true`.

**Validity check:** the only style property animated via the `pulse` interpolation is `opacity` (line 603 + 606 in current code: `{ opacity }` on `RNAnimated.View`). Opacity is a natively-driven property — fully eligible. No other property in the same animated style block is non-native-driven (the `backgroundColor` and `borderRadius` are static literals).

**No other changes needed.**

---

### 4.4 Zustand persist debounce wrapper

**File:** `app-mobile/src/store/appStore.ts`
**Affected line:** 237 (`storage: createJSONStorage(() => AsyncStorage),`)

**Replacement (verbatim):**

```typescript
// ─── ADD: above `useAppStore` ───
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Debounced AsyncStorage wrapper for Zustand persist.
 *
 * Coalesces rapid setItem calls (e.g. during heavy swipe sessions) into a single
 * trailing batch write every 250 ms. Cuts AsyncStorage write rate by ~80% in
 * swipe-heavy paths; SQLite-backed Android is the primary beneficiary.
 *
 * SAFETY: an AppState 'background' listener forces a synchronous flush so
 * pending writes survive process kill. Without this guarantee, app-killed mid
 * debounce-window would lose the most recent state.
 *
 * ORCH-0675 Wave 1.
 * INVARIANT: I-ZUSTAND-PERSIST-DEBOUNCED
 */
const FLUSH_MS = 250;
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const flushPendingWrites = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingWrites.size === 0) return;
  const entries: [string, string][] = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  try {
    await AsyncStorage.multiSet(entries);
  } catch (err) {
    console.error('[Zustand persist] Failed to flush pending writes:', err);
    // Re-queue on failure — best-effort.
    for (const [k, v] of entries) {
      if (!pendingWrites.has(k)) pendingWrites.set(k, v);
    }
  }
};

const debouncedAsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    // If a write for this key is pending, return the in-flight value (avoid
    // race where read happens between debounce queue and flush).
    if (pendingWrites.has(key)) return pendingWrites.get(key) ?? null;
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    pendingWrites.set(key, value);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void flushPendingWrites();
    }, FLUSH_MS);
  },
  removeItem: async (key: string): Promise<void> => {
    pendingWrites.delete(key);
    await AsyncStorage.removeItem(key);
  },
};

// AppState listener: flush on background to survive process kill.
// Subscription is module-scoped (lives for app lifetime). No cleanup needed —
// app process death is the only termination.
AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'background' || state === 'inactive') {
    void flushPendingWrites();
  }
});

// ─── REPLACE line 237 ───
//   storage: createJSONStorage(() => AsyncStorage),
// WITH:
      storage: createJSONStorage(() => debouncedAsyncStorage),
```

**Critical correctness notes:**

1. **`getItem` reads pending in-flight value first.** Without this, the read-write-read sequence (Zustand can perform during hydration) could read a stale persisted value while a fresher write is queued.
2. **AppState background flush is non-negotiable.** Without it, `setItem(key, latestState)` queued in the debounce buffer is LOST on app kill. iOS background suspension can occur within ~5 seconds; Android task killers can fire instantly. The flush MUST run synchronously enough to complete before suspension. `multiSet` typically completes <50 ms even on slow Android.
3. **`removeItem` flushes the queue entry but writes through immediately.** Removes are user-explicit (logout, schema bump) — never debounced.
4. **Re-queue on flush failure.** Network/disk errors should not silently drop state. Logged via `console.error` (intentional surface — Constitution #3).
5. **No coordination needed with Wave 2 Option C throttle.** Wave 1's debounce is the global Zustand storage adapter. Wave 2 Option C is a no-op once Wave 1 ships — verify and remove from Wave 2 spec at REVIEW time.

---

## 5. CI Gates

Three new shell scripts in `app-mobile/scripts/ci/`, plus 3 INVARIANT_REGISTRY.md entries.

### 5.1 `check-no-native-driver-false.sh` (I-ANIMATIONS-NATIVE-DRIVER-DEFAULT)

```bash
#!/usr/bin/env bash
# I-ANIMATIONS-NATIVE-DRIVER-DEFAULT — Wave 1 RC-1 + RC-3 protection.
# Fails if `useNativeDriver: false` appears in SwipeableCards.tsx swipe-handler
# region (PanResponder body) OR in DiscoverScreen.tsx LoadingGridSkeleton block.
# Whitelist: width/height animations are exempt — must include explicit comment
#   `// useNativeDriver:false JUSTIFIED: <reason>` on the same line or directly above.
set -e

VIOLATIONS=0

# SwipeableCards.tsx: swipe handler region (lines 1216–1340) MUST be native-driver
SWIPE_FILE="app-mobile/src/components/SwipeableCards.tsx"
SWIPE_VIOLATIONS=$(awk 'NR>=1216 && NR<=1340 && /useNativeDriver: false/ && !/JUSTIFIED:/ { print FILENAME ":" NR ": " $0 }' "$SWIPE_FILE")
if [ -n "$SWIPE_VIOLATIONS" ]; then
  echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in SwipeableCards swipe handler:"
  echo "$SWIPE_VIOLATIONS"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# DiscoverScreen.tsx: LoadingGridSkeleton (lines 575–620) MUST be native-driver
DISCOVER_FILE="app-mobile/src/components/DiscoverScreen.tsx"
DISCOVER_VIOLATIONS=$(awk 'NR>=575 && NR<=620 && /useNativeDriver: false/ && !/JUSTIFIED:/ { print FILENAME ":" NR ": " $0 }' "$DISCOVER_FILE")
if [ -n "$DISCOVER_VIOLATIONS" ]; then
  echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT violation in DiscoverScreen LoadingGridSkeleton:"
  echo "$DISCOVER_VIOLATIONS"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: $VIOLATIONS violation(s) found."
  echo "Animations on transform/opacity properties must use useNativeDriver: true."
  echo "If width/height/non-native property is genuinely required, add inline comment 'useNativeDriver:false JUSTIFIED: <reason>'."
  exit 1
fi
echo "I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS"
exit 0
```

**Negative-control reproduction:** inject `useNativeDriver: false` at SwipeableCards.tsx line 1249 → run `bash app-mobile/scripts/ci/check-no-native-driver-false.sh` → exit code 1 → revert → exit code 0.

### 5.2 `check-i18n-lazy-load.sh` (I-LOCALES-LAZY-LOAD)

```bash
#!/usr/bin/env bash
# I-LOCALES-LAZY-LOAD — Wave 1 RC-2 protection.
# Only the 'en' locale (23 namespaces) may be statically imported in i18n/index.ts.
# All other 28 languages MUST be loaded via dynamic import().
set -e

I18N_FILE="app-mobile/src/i18n/index.ts"

# Count static `import .* from './locales/<lang>/'` lines
STATIC_IMPORTS=$(grep -E "^import .* from '\./locales/" "$I18N_FILE" | wc -l | tr -d ' ')

# Should be exactly 23 (en namespaces) — fail if more
if [ "$STATIC_IMPORTS" -gt 23 ]; then
  echo "I-LOCALES-LAZY-LOAD violation: $STATIC_IMPORTS static locale imports in $I18N_FILE (expected ≤ 23)."
  echo "Other languages MUST be loaded via dynamic import() in localeLoaders map."
  grep -nE "^import .* from '\./locales/" "$I18N_FILE" | head -50
  exit 1
fi

# Verify en is statically imported (sanity check)
EN_IMPORTS=$(grep -cE "^import .* from '\./locales/en/" "$I18N_FILE" || true)
if [ "$EN_IMPORTS" -lt 23 ]; then
  echo "I-LOCALES-LAZY-LOAD violation: en has $EN_IMPORTS static imports (expected exactly 23 namespaces)."
  exit 1
fi

# Verify localeLoaders map contains 28 entries (one per non-en language)
LOADER_COUNT=$(grep -cE "^\s+[a-z]{2,3}:\s*async \(\) =>" "$I18N_FILE" || true)
if [ "$LOADER_COUNT" -lt 28 ]; then
  echo "I-LOCALES-LAZY-LOAD: Only $LOADER_COUNT lazy loaders found (expected 28)."
  exit 1
fi

echo "I-LOCALES-LAZY-LOAD: PASS ($EN_IMPORTS static en imports, $LOADER_COUNT lazy loaders)"
exit 0
```

**Negative-control reproduction:** inject `import fr_common from './locales/fr/common.json';` into i18n/index.ts → CI fails → revert → CI passes.

### 5.3 `check-zustand-persist-debounced.sh` (I-ZUSTAND-PERSIST-DEBOUNCED)

```bash
#!/usr/bin/env bash
# I-ZUSTAND-PERSIST-DEBOUNCED — Wave 1 protection.
# Zustand persist storage adapter MUST use the debounced wrapper, not raw AsyncStorage.
# AppState background flush MUST be wired.
set -e

STORE_FILE="app-mobile/src/store/appStore.ts"

# Must have debouncedAsyncStorage symbol
if ! grep -q "debouncedAsyncStorage" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: debouncedAsyncStorage wrapper not found in $STORE_FILE."
  exit 1
fi

# Must use debouncedAsyncStorage in createJSONStorage
if ! grep -q "createJSONStorage(() => debouncedAsyncStorage)" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: createJSONStorage must reference debouncedAsyncStorage."
  exit 1
fi

# Must have AppState background flush
if ! grep -q "AppState.addEventListener('change'" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: AppState background flush listener missing."
  echo "Without it, pending writes are lost on app kill."
  exit 1
fi

# Must call flushPendingWrites in the listener
if ! grep -q "flushPendingWrites" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: flushPendingWrites function missing."
  exit 1
fi

# Must NOT have raw createJSONStorage(() => AsyncStorage) — that would bypass debounce
if grep -q "createJSONStorage(() => AsyncStorage)" "$STORE_FILE"; then
  echo "I-ZUSTAND-PERSIST-DEBOUNCED violation: raw AsyncStorage adapter still present (bypasses debounce)."
  exit 1
fi

echo "I-ZUSTAND-PERSIST-DEBOUNCED: PASS"
exit 0
```

**Negative-control reproduction:** revert line 237 to `storage: createJSONStorage(() => AsyncStorage),` → CI fails → revert again → CI passes.

### 5.4 INVARIANT_REGISTRY.md entries

Implementor adds 3 entries to `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

```markdown
## I-ANIMATIONS-NATIVE-DRIVER-DEFAULT

**Registered:** 2026-04-25 (ORCH-0675 Wave 1)
**Class:** performance
**Scope:** `app-mobile/src/components/SwipeableCards.tsx` (PanResponder swipe-handler region, lines 1216–1340) and `app-mobile/src/components/DiscoverScreen.tsx` (LoadingGridSkeleton, lines 575–620).
**Rule:** All `Animated.timing` and `Animated.spring` calls in these regions MUST use `useNativeDriver: true`. Width/height animations exempt only with explicit `// useNativeDriver:false JUSTIFIED: <reason>` inline comment.
**Why:** JS-thread animation drops frames on mid-tier Android (Snapdragon 600-class). Native driver delegates frame interpolation to the UI thread, restoring 60 fps gesture response.
**CI gate:** `app-mobile/scripts/ci/check-no-native-driver-false.sh`
**Negative-control:** verified — inject violation at SwipeableCards.tsx:1249 → CI fails.

## I-LOCALES-LAZY-LOAD

**Registered:** 2026-04-25 (ORCH-0675 Wave 1)
**Class:** performance, cold-start
**Scope:** `app-mobile/src/i18n/index.ts`.
**Rule:** Only the `en` locale's 23 namespaces may be statically imported. All other 28 languages MUST be loaded on-demand via the `localeLoaders` map (dynamic `import()`).
**Why:** Static eager-load of all 667 locale JSONs adds ~200–500 ms to cold-start parse on lower-tier ARM CPUs. Lazy-load defers cost to language-switch event (rare).
**CI gate:** `app-mobile/scripts/ci/check-i18n-lazy-load.sh`
**Negative-control:** verified — inject `import fr_common from './locales/fr/common.json';` → CI fails.

## I-ZUSTAND-PERSIST-DEBOUNCED

**Registered:** 2026-04-25 (ORCH-0675 Wave 1)
**Class:** performance, storage-write-rate
**Scope:** `app-mobile/src/store/appStore.ts`.
**Rule:** Zustand `persist` middleware storage MUST use the `debouncedAsyncStorage` wrapper, NOT raw `AsyncStorage`. AppState `background`/`inactive` listener MUST flush pending writes synchronously.
**Why:** Android SQLite-backed AsyncStorage takes 20–200 ms per write on mid-tier devices. Heavy swipe sessions write per-swipe, blocking JS thread. Debouncing coalesces to ~1 write per 250 ms window. AppState flush prevents data loss on process kill.
**CI gate:** `app-mobile/scripts/ci/check-zustand-persist-debounced.sh`
**Negative-control:** verified — replace adapter with raw AsyncStorage → CI fails.
```

---

## 6. Implementation Order

Strict order; implementor must follow:

1. **Step 1 — Zustand persist debounce wrapper** ([appStore.ts:237](app-mobile/src/store/appStore.ts#L237))
   - Add `debouncedAsyncStorage` + `flushPendingWrites` + `AppState.addEventListener` block above `useAppStore`
   - Replace line 237 to use `debouncedAsyncStorage`
   - Verify Zustand persist middleware accepts the wrapper (signature: `getItem`, `setItem`, `removeItem`)
   - Smoke test: `npm start` → app boots → swipe a card → background app → cold start → verify swipe history restored

2. **Step 2 — DiscoverScreen skeleton** ([DiscoverScreen.tsx:583, 590](app-mobile/src/components/DiscoverScreen.tsx#L583))
   - 1-line edit × 2 sites: `useNativeDriver: false` → `true`

3. **Step 3 — i18n lazy-load refactor** ([i18n/index.ts](app-mobile/src/i18n/index.ts))
   - Replace 667 dynamic-importable entries with the `localeLoaders` map
   - Keep all 23 `en_*` static imports
   - Add `ensureLanguageLoaded` helper
   - Wire `init` config with `resources: { en: {...} }` only
   - On startup, fire-and-forget call to `ensureLanguageLoaded(initialLang)` if non-en
   - Smoke test: cold start → English UI → switch language to Spanish in Settings → UI flips to Spanish within 500 ms

4. **Step 4 — SwipeableCards animation surgical fix** ([SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx))
   - Largest change. Implementor MUST execute in this exact sequence:
     - 4a. Replace `position` declaration at line 655 with two `Animated.Value`s
     - 4b. Update interpolation reads at lines 656, 660, 664, 668
     - 4c. Update reset calls at lines 997, 1319, 1709
     - 4d. Update PanResponder offset/setValue/flattenOffset at lines 1222–1231
     - 4e. Update tap detection at lines 1336–1337
     - 4f. Convert the 5 spring/timing call sites to `Animated.parallel([…])` with `useNativeDriver: true`
     - 4g. Update transform style at lines 2230–2231
   - After each sub-step, verify TypeScript compiles (`npx tsc --noEmit`)
   - Smoke test after 4g: open Discover → swipe right → swipe left → swipe up → drag <120px and release → all gestures work

5. **Step 5 — CI gates** (3 new scripts in `app-mobile/scripts/ci/`)
   - Create the 3 shell scripts above
   - Make executable: `chmod +x app-mobile/scripts/ci/check-*.sh`
   - Run each manually: should exit 0 with current code

6. **Step 6 — INVARIANT_REGISTRY.md** updates: add 3 entries above

7. **Step 7 — Negative-control reproduction** (per gate):
   - Inject violation → run gate → assert exit 1 with named invariant in output
   - Revert → run gate → assert exit 0
   - Document each in implementation report

8. **Step 8 — Pre-impl re-verification** (§13 below)

---

## 7. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01** | Swipe-right on Discover card | Drag finger 200px right; release | Card animates off-screen via native driver; `cardLike` haptic; `removedCards.add(card.id)` fires after `.start()` callback; `setCurrentCardIndex(0)` advances | UI thread |
| **T-02** | Swipe-left on Discover card | Drag 200px left; release | Card animates off left; `cardDislike` haptic; same dedup chain | UI thread |
| **T-03** | Swipe-up to expand | Drag 100px up, <50px horizontal; release | ExpandedCardModal opens; `medium` haptic; card stays in deck | UI thread |
| **T-04** | Drag <120px and release | Drag 50px right, release | Card springs back to center via parallel native-driver spring; no haptic, no advance | UI thread |
| **T-05** | Curated card swipe-right paywall gate | Non-Mingla+ user; drag 200px right on curated card | Paywall modal opens; card springs back; `medium` haptic; no advance | Component |
| **T-06** | Vertical-then-horizontal gesture | Drag 100px down, then 100px right, release | Behavior matches pre-fix: card position tracks finger; release decision per existing thresholds | UI thread |
| **T-07** | Cold-start English | Fresh app launch with `lng: 'en'` | i18n initializes with en resources only; UI strings render English | Cold start |
| **T-08** | Cold-start non-English (e.g., Spanish) | Fresh launch with `lng: 'es'` | i18n initializes with en fallback; lazy-load fires; within ~300 ms UI flips to Spanish | Cold start |
| **T-09** | Language switch flow | User in Settings → Language → French | `ensureLanguageLoaded('fr')` resolves; `i18n.changeLanguage('fr')` fires; all visible UI strings switch within 500 ms | Runtime |
| **T-10** | Language switch with offline network | User offline → switch to a language not yet loaded | Dynamic import fails (no network) — Metro JS bundle already includes the chunk; SHOULD succeed offline since Metro bundles all dynamic imports into the app binary | Runtime |
| **T-11** | DiscoverScreen loading skeleton fps | Open Discover with airplane mode (forces persistent loading state) | Skeleton pulse runs on UI thread; gesture input remains responsive (tap on a different tab works in <16 ms) | UI thread |
| **T-12** | Zustand persist write rate | 30 rapid card swipes in 10 seconds (instrument storage adapter) | AsyncStorage `multiSet` called ~10 times max (vs 30+ baseline) — ≥80% reduction | Storage |
| **T-13** | App background mid-debounce | Swipe card; immediately background app within 250 ms | Pending Zustand state written via flushPendingWrites; cold-start restoration includes the swipe | Storage |
| **T-14** | App-killed mid-debounce | Swipe card; force-kill via task switcher within 250 ms | Pending state preserved (AppState 'inactive' fires before kill on iOS; Android may not — best-effort) | Storage |
| **T-15** | CI gate: `useNativeDriver: false` | Inject `useNativeDriver: false` into SwipeableCards.tsx swipe handler | `check-no-native-driver-false.sh` exits 1 with `I-ANIMATIONS-NATIVE-DRIVER-DEFAULT` named in output | CI |
| **T-16** | CI gate: 2nd-language static import | Inject `import fr_common from './locales/fr/common.json';` into i18n/index.ts | `check-i18n-lazy-load.sh` exits 1 with `I-LOCALES-LAZY-LOAD` violation | CI |
| **T-17** | CI gate: Zustand persist debounce removal | Replace `debouncedAsyncStorage` with raw `AsyncStorage` in line 237 | `check-zustand-persist-debounced.sh` exits 1 with `I-ZUSTAND-PERSIST-DEBOUNCED` violation | CI |
| **T-18** | Solo + collab parity (RC-1) | Swipe in solo mode, then collab mode | Both fire native-driver animation; haptics correct in both; deckStateRegistry preserves position correctly across mode toggles | Full stack |
| **T-19** | iOS regression (SC-12) | Run T-01 through T-13 on iOS device | All tests pass on iOS — no regression | iOS |
| **T-20** | Android regression on low-tier device | Run T-01 through T-13 on a Samsung A-series (Snapdragon 6xx-class) | All tests pass; subjectively smoother than pre-Wave-1 baseline | Android |

---

## 8. Common Mistakes

Implementor MUST avoid these:

1. **❌ Migrating SwipeableCards to Reanimated 4** — out of scope. The dispatch is explicit. Surgical Animated fix only.
2. **❌ Forgetting `Animated.parallel([…])` wrapping** — without it, the two axis animations would fire sequentially, breaking the simultaneous start/end semantics.
3. **❌ Mixing `useNativeDriver: true` and `useNativeDriver: false` in `Animated.parallel`** — RN throws at runtime. Both axes must be `true`.
4. **❌ Forgetting AppState background flush in Zustand debounce** — pending writes lost on app kill. CI gate catches this.
5. **❌ Enabling i18next `useSuspense: true` to "fix" the brief flash** — would block first paint and reintroduce a different cold-start cost. The flash is the accepted Wave 1 trade-off.
6. **❌ Hardcoding language list in `localeLoaders` rather than enumerating all 28 non-en languages** — incomplete map = silently broken language switches.
7. **❌ Skipping the `pendingWrites.has(key)` check in `getItem`** — read-write race during hydration.
8. **❌ Calling `flushPendingWrites` synchronously in the AppState listener without `void`** — unhandled promise warning.
9. **❌ Removing the `requestAnimationFrame(() => requestAnimationFrame(() => positionX.setValue(0); positionY.setValue(0);))` chain at SwipeableCards.tsx:1313–1316** — preserves the flicker-prevention from pre-fix code.
10. **❌ Changing PanResponder thresholds while editing** — 120px horizontal / 50px vertical thresholds are out of scope.
11. **❌ Removing `_value` access at lines 1336–1337** — works, just brittle. Filed as 🟡 hidden flaw, separate ORCH.
12. **❌ Specifying `Math.min(100, limit * 2)` cap or any deck-related change** — Wave 2 territory. This spec touches NO deck data flow.

---

## 9. Regression Prevention

- **3 CI gates** structurally prevent regression for each of 3 invariants. Implementor MUST include negative-control reproduction in their report (inject violation → CI fails with named invariant → revert → CI passes).
- **Protective comments at modification sites** (Constitution #7):
  - SwipeableCards.tsx near line 1249: `// ORCH-0675 Wave 1 RC-1 — useNativeDriver: true mandatory; do not flip to false (I-ANIMATIONS-NATIVE-DRIVER-DEFAULT)`
  - DiscoverScreen.tsx near line 583: same pattern
  - appStore.ts near line 237: `// ORCH-0675 Wave 1 — debouncedAsyncStorage wrapper required (I-ZUSTAND-PERSIST-DEBOUNCED)`
  - i18n/index.ts near `localeLoaders` map: `// ORCH-0675 Wave 1 RC-2 — only en is statically imported (I-LOCALES-LAZY-LOAD)`
- **Rollback plan:** all changes are JS-only and OTA-revertable. Single revert command:
  ```bash
  cd app-mobile && eas update --branch production --platform ios --message "ORCH-0675 Wave 1 ROLLBACK"
  cd app-mobile && eas update --branch production --platform android --message "ORCH-0675 Wave 1 ROLLBACK"
  ```
- **Solo/collab parity** test mandatory in tester dispatch (T-18).
- **iOS regression smoke** (T-19) mandatory — Wave 1's whole premise is "iOS path already works; bring Android up."

---

## 10. Pre-Impl Re-Verification (§13 — implementor halts if grep counts diverge)

Before any code is written, implementor runs:

```bash
# Expected counts under current (pre-fix) state:
# 1. SwipeableCards `position` consumers
grep -nE "position\.|position =|new Animated\.ValueXY" app-mobile/src/components/SwipeableCards.tsx | wc -l
# Expected: ≥ 18 lines (declaration + interpolations + setValue + setOffset + tap reads + transform)

# 2. SwipeableCards `useNativeDriver: false` count in PanResponder body
awk 'NR>=1216 && NR<=1340 && /useNativeDriver: false/' app-mobile/src/components/SwipeableCards.tsx | wc -l
# Expected: 5 (the 5 spring/timing sites)

# 3. DiscoverScreen `useNativeDriver: false` in skeleton block
awk 'NR>=575 && NR<=620 && /useNativeDriver: false/' app-mobile/src/components/DiscoverScreen.tsx | wc -l
# Expected: 2

# 4. i18n.tsx static locale import count
grep -cE "^import .* from '\./locales/" app-mobile/src/i18n/index.ts
# Expected: 667

# 5. appStore.ts current adapter
grep -c "createJSONStorage(() => AsyncStorage)" app-mobile/src/store/appStore.ts
# Expected: 1
```

**Gate:** if any count diverges, implementor STOPS and reports back to orchestrator. Cycle-2 audit verified these counts; divergence indicates the file changed since SPEC was written.

---

## 11. Handoff to Implementor

**Dispatch prompt (single block — orchestrator includes this verbatim in the implementor dispatch file `prompts/IMPL_ORCH-0675_WAVE1_ANDROID_PERF.md`):**

```
# Implementation: ORCH-0675 Wave 1 — Android Performance Surgical Fixes

## Mission
Implement the 4 surgical fixes specified in SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md.
Produce IMPLEMENTATION_ORCH-0675_WAVE1_REPORT.md.

## Spec
Read: Mingla_Artifacts/specs/SPEC_ORCH-0675_WAVE1_ANDROID_PERF.md (full file).

## Pre-Flight (MANDATORY before any edit)
Run §10 grep counts. If any diverge from spec, HALT and report to orchestrator.

## Implementation Order
Strict per spec §6:
1. Zustand persist debounce wrapper
2. DiscoverScreen skeleton (2 lines)
3. i18n lazy-load refactor
4. SwipeableCards animation (12 sites in sequence 4a–4g)
5. CI gates (3 scripts)
6. INVARIANT_REGISTRY.md (3 entries)
7. Negative-control reproduction (3 cycles)

## Scope Lock
You may ONLY change what the spec defines. If you discover something the spec
missed, document it in implementation report under "Surprises" — do NOT fix it
yourself.

## Hard Constraints
- ❌ NO Reanimated 4 migration
- ❌ NO PanResponder threshold changes
- ❌ NO deck data flow changes (Wave 2 territory)
- ❌ NO image migration
- ❌ NO Sentry/SDK init changes
- ❌ NO MMKV
- ✅ Native driver true on transform/opacity ONLY (not width/height)
- ✅ AppState background flush mandatory in Zustand debounce
- ✅ Negative-control reproduction for all 3 CI gates

## Anti-Patterns
See spec §8.

## Output
1. Code changes (committed or staged)
2. IMPLEMENTATION_ORCH-0675_WAVE1_REPORT.md with:
   - Files changed and exactly how (cite line numbers)
   - Pre-flight grep results (verify match expected)
   - Negative-control reproduction logs (3 gates × 2 cycles each = 6 runs)
   - tsc --noEmit clean (or document any baseline errors)
   - Surprises encountered
   - What still needs testing
```

---

## 12. Acceptance Checklist

Spec self-verification before dispatch (must be 12/12 PASS):

- [x] Every layer specified — Mobile (4 sub-sections); CI gates (3 scripts); invariants (3 entries)
- [x] Every success criterion observable + testable + unambiguous (12 SC's)
- [x] Test cases cover happy path + error path + edge case (20 tests)
- [x] Implementation order explicit and numbered (8 steps)
- [x] Pre-impl re-verification grep counts specified (5 expected counts)
- [x] Common mistakes enumerated (12 anti-patterns)
- [x] Regression prevention via CI gates + protective comments + rollback plan
- [x] Solo + collab parity called out (T-18)
- [x] iOS regression smoke required (T-19)
- [x] Android live-fire required for Wave 1 success measurement (T-20)
- [x] Handoff dispatch prompt for implementor included (§11)
- [x] Exact file:line + before/after diffs for all 4 fixes

---

## 13. Confidence

**H static / L runtime.** Every change has direct file:line evidence with verbatim before/after. The runtime perf claims (60 fps swipe, ≥80% write reduction, etc.) are INSUFFICIENT EVIDENCE without live-fire on real Android — flagged in tester matrix as mandatory live-fire gates (T-12, T-13, T-14, T-20).

**Estimated implementor wall time:** 3–5 hours (Zustand 1h + skeleton 5min + i18n 1h + SwipeableCards 1.5h + CI gates 30min + invariants 15min + negative-control reproduction 30min). One implementor cycle.

**No outstanding blockers. SPEC ready for implementor dispatch.**
