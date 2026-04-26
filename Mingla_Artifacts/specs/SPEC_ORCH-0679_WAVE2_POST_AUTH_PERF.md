# SPEC — ORCH-0679 Wave 2: Post-Auth Performance Bundle

**Status:** READY FOR IMPLEMENTOR
**Date:** 2026-04-26
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0679_ANDROID_PERF_ROUND2.md`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_DISPATCH_ORCH-0679_WAVE2_POST_AUTH_PERF.md`
**Predecessor:** ORCH-0675 Wave 1 (staged, uncommitted)
**Bundles:** Wave 2A (render-storm core) + Wave 2B (cold-start defer + Sentry tune + PreferencesSheet primitive swap)

---

## §1 Scope and Non-Goals

### Scope (4 sub-sections)

| ID | Sub-section | What | Files |
|---|---|---|---|
| 2A | Render-storm core | Hoist all inline props in tab JSX → `useCallback`/`useMemo`. Wrap 6 tab screens in `React.memo`. Add CI gates + dev render counter. | `app/index.tsx`, `HomePage.tsx`, `DiscoverScreen.tsx`, `ConnectionsPage.tsx`, `SavedExperiencesPage.tsx`, `LikesPage.tsx`, `ProfilePage.tsx`, 3 new CI scripts |
| 2B-1 | Cold-start defer | Defer non-critical SDK init via `InteractionManager.runAfterInteractions`. | `app/index.tsx` lines 278-385 |
| 2B-2 | Sentry tune | Single source of truth, drop Replay sample to 1%, keep PII as-is pending founder confirmation. | `app/_layout.tsx`, `app/index.tsx` lines 141-150 |
| 2B-3 | PreferencesSheet primitive swap | RN `Modal` → `@gorhom/bottom-sheet`. Verify keyboard + backdrop + stagger animations. | `PreferencesSheet.tsx` |

### Non-Goals (explicit out-of-scope)

| Item | Why deferred | Where it goes |
|---|---|---|
| `useAppState` 50-value god-hook split (RC-4) | Large blast radius, post-launch | Wave 2C |
| PreferencesSheet `useState` consolidation → `useReducer` | High risk per file size (1613 lines) | Wave 2C |
| `LayoutAnimation` removal in PreferencesSheet | Coupled to 2C state refactor | Wave 2C |
| `refreshAllSessions` 5-roundtrip RPC consolidation (HF-9) | Backend change, separate domain | Separate ORCH (TBD) |
| Audit other `*Sheet.tsx` / `*Modal.tsx` files for Modal misuse (D-2) | Out-of-scope discovery | Separate audit ORCH |
| ShareModal, PostExperienceModal inline props (`app/index.tsx` 2560-2582) | Not tab screens, low frequency | Optional 2A bonus, see §2.A.5 |
| Reanimated migration for SwipeableCards | Wave 1 already converted to native-driver | N/A |
| Onboarding files | Design freeze per ORCH-0672 | Permanently out |

### Assumptions

- Wave 1 staged code (`SwipeableCards.tsx`, `DiscoverScreen.tsx`, `i18n/index.ts`, `appStore.ts`) is in place and either committed or staged. Implementor MUST integrate Wave 2 changes on top of staged Wave 1 changes; no Wave 1 code is reverted.
- New Architecture is enabled (verified `app.json:9`).
- Hermes is the JS engine (Expo SDK 54 default).
- `@gorhom/bottom-sheet@5.2.8` is installed (verified `package.json:21`).
- `react-native-gesture-handler@2.28.0` is installed and `<GestureHandlerRootView>` already wraps the root in `_layout.tsx:28`.

---

## §2 Per-Layer Specification

### §2.A — Render-Storm Core (Wave 2A)

#### §2.A.1 — Hoist inline props in `app/index.tsx` lines 2362-2525

**Decision:** Keep all-tabs-mounted (preserves scroll position for free, simpler than registry pattern). Memo properly so hidden tabs cost nothing.

For EACH of the 6 tabs at the line ranges below, every inline arrow function and inline object literal in the JSX must be replaced with a stable reference. Stable references are declared as named `useCallback` / `useMemo` constants at the **top of `AppContent`**, immediately AFTER the destructure of `useAppState()` (line 235) and BEFORE the `useEffect` blocks.

**Naming convention:** `memoXxxProps` for object literals, `handleXxx` for callbacks. Keep names descriptive (`memoizedAccountPreferences`, not `memoAP`).

**Per-tab inline-prop inventory and required hoists:**

##### HomePage tab — `app/index.tsx:2367-2413`

| Inline prop (current) | Replacement | Dependencies |
|---|---|---|
| `accountPreferences={{ currency: ..., measurementSystem: ... }}` | `const accountPreferencesMemo = useMemo(() => ({ currency: accountPreferences?.currency \|\| "USD", measurementSystem: ... }), [accountPreferences?.currency, accountPreferences?.measurementSystem])` | `accountPreferences?.currency`, `accountPreferences?.measurementSystem` |
| `onAddToCalendar={(experienceData: any) => console.log(...)}` | `const handleAddToCalendar = useCallback((experienceData: any) => { console.log("Add to calendar:", experienceData); }, [])` | none |
| `onPurchaseComplete={(experienceData: any, purchaseOption: any) => console.log(...)}` | `const handlePurchaseComplete = useCallback((...) => { console.log(...); }, [])` | none |
| `onResetCards={() => setRemovedCardIds([])}` | `const handleResetCards = useCallback(() => setRemovedCardIds([]), [setRemovedCardIds])` | `setRemovedCardIds` |
| `generateNewMockCard={() => console.log("Generate new card")}` | `const handleGenerateNewMockCard = useCallback(() => console.log("Generate new card"), [])` | none |
| `onSessionStateChanged={() => refreshAllSessions({ showLoading: true })}` | `const handleSessionStateChangedShowLoading = useCallback(() => refreshAllSessions({ showLoading: true }), [refreshAllSessions])` | `refreshAllSessions` (must itself be `useCallback`-wrapped — see §2.A.6) |
| `onOpenSessionHandled={() => setPendingSessionOpen(null)}` | `const handleOpenSessionHandled = useCallback(() => setPendingSessionOpen(null), [setPendingSessionOpen])` | `setPendingSessionOpen` |
| `onOpenPreferences={() => { logger.action(...); setShowPreferences(true); }}` | `const handleOpenPreferences = useCallback(() => { logger.action('Open preferences pressed'); setShowPreferences(true); }, [setShowPreferences])` | `setShowPreferences` |
| `onOpenCollabPreferences={() => { logger.action(...); setShowCollabPreferences(true); }}` | `const handleOpenCollabPreferences = useCallback(() => { logger.action('Open collab preferences pressed'); setShowCollabPreferences(true); }, [setShowCollabPreferences])` | `setShowCollabPreferences` |

Existing already-stable props (DO NOT touch): `currentMode`, `boardsSessions`, `userPreferences`, `savedCards`, `removedCardIds`, `refreshKey`, `collaborationSessions`, `currentSessionId`, `isCreatingSession`, `userId`, `pendingSessionOpen`, `availableFriendsForSessions`, `handleSessionSelect`, `handleSoloSelect`, `handleCreateSession`, `handleAcceptInvite`, `handleDeclineInvite`, `handleCancelInvite`, `handleInviteMoreToSession`, `handleNotificationNavigate`, `handlers.handleSaveCard`, `handlers.handleShareCard`. **Verify these are in fact stable** by reading their declaration sites — if any handler is declared inline within `AppContent` body (not via `useCallback`), wrap it.

##### DiscoverScreen tab — `app/index.tsx:2416-2435`

| Inline prop | Replacement | Dependencies |
|---|---|---|
| `onOpenChatWithUser={(friendUserId) => { setPendingOpenDmUserId(friendUserId); setCurrentPage("connections"); }}` | `const handleOpenChatWithUserFromDiscover = useCallback((friendUserId: string) => { setPendingOpenDmUserId(friendUserId); setCurrentPage("connections"); }, [setPendingOpenDmUserId, setCurrentPage])` | `setPendingOpenDmUserId`, `setCurrentPage` |
| `onViewFriendProfile={(friendUserId) => setViewingFriendProfileId(friendUserId)}` | `const handleViewFriendProfile = useCallback((id: string) => setViewingFriendProfileId(id), [setViewingFriendProfileId])` | `setViewingFriendProfileId` |
| `accountPreferences={{ ... }}` | Reuse `accountPreferencesMemo` from HomePage hoist (single source) | same |
| `deepLinkParams={currentPage === 'discover' ? deepLinkParams : null}` | `const discoverDeepLinkParams = useMemo(() => currentPage === 'discover' ? deepLinkParams : null, [currentPage, deepLinkParams])` | `currentPage`, `deepLinkParams` |
| `onDeepLinkHandled={() => setDeepLinkParams(null)}` | `const handleDeepLinkHandled = useCallback(() => setDeepLinkParams(null), [setDeepLinkParams])` | `setDeepLinkParams` |

##### ConnectionsPage tab — `app/index.tsx:2438-2462`

| Inline prop | Replacement | Dependencies |
|---|---|---|
| `onUpdateBoardSession={(board: any) => { console.log(...); }}` | `const handleUpdateBoardSession = useCallback((board: any) => { console.log("Updating board session:", board); }, [])` | none |
| `onCreateSession={async () => { await refreshAllSessions({ showLoading: true }); }}` | `const handleCreateSessionFromConnections = useCallback(async () => { await refreshAllSessions({ showLoading: true }); }, [refreshAllSessions])` | `refreshAllSessions` |
| `onUnreadCountChange={setTotalUnreadMessages}` | already stable (setState identity) — leave |
| `onNavigateToFriendProfile={(userId: string) => setViewingFriendProfileId(userId)}` | Reuse `handleViewFriendProfile` from Discover hoist (same closure) | same |
| `onFriendAccepted={() => refreshAllSessions({ showLoading: false })}` | `const handleFriendAccepted = useCallback(() => refreshAllSessions({ showLoading: false }), [refreshAllSessions])` | `refreshAllSessions` |
| `onOpenDirectMessageHandled={() => setPendingOpenDmUserId(null)}` | `const handleOpenDirectMessageHandled = useCallback(() => setPendingOpenDmUserId(null), [setPendingOpenDmUserId])` | `setPendingOpenDmUserId` |
| `onInitialPanelHandled={() => setPendingConnectionsPanel(null)}` | `const handleInitialPanelHandled = useCallback(() => setPendingConnectionsPanel(null), [setPendingConnectionsPanel])` | `setPendingConnectionsPanel` |

##### SavedExperiencesPage tab — `app/index.tsx:2465-2477`

| Inline prop | Replacement | Dependencies |
|---|---|---|
| `onScheduleFromSaved={(card: any) => { console.log(...); }}` | `const handleScheduleFromSaved = useCallback((card: any) => { console.log("Scheduling from saved:", card); }, [])` | none |
| `onPurchaseFromSaved={(card: any, option: any) => { console.log(...); }}` | `const handlePurchaseFromSavedSaved = useCallback((card: any, option: any) => { console.log("Purchasing from saved:", card, option); }, [])` | none |

##### LikesPage tab — `app/index.tsx:2480-2503`

| Inline prop | Replacement | Dependencies |
|---|---|---|
| `onNavigationComplete={() => setActivityNavigation(null)}` | `const handleNavigationComplete = useCallback(() => setActivityNavigation(null), [setActivityNavigation])` | `setActivityNavigation` |
| `onPurchaseFromSaved={(card: any, purchaseOption: any) => { console.log(...); }}` | Reuse `handlePurchaseFromSaved` from Saved tab hoist if signature matches; else create `handlePurchaseFromSavedLikes`. Check signature compat first. | none |
| `onAddToCalendar={(entry: any) => { console.log(...); }}` | `const handleAddToCalendarFromLikes = useCallback((entry: any) => { console.log("Adding to calendar:", entry); }, [])` (signature differs from HomePage's `handleAddToCalendar` — keep separate) | none |
| `onShowQRCode={(entryId: string) => { console.log(...); }}` | `const handleShowQRCode = useCallback((entryId: string) => { console.log("Showing QR code for:", entryId); }, [])` | none |

##### ProfilePage tab — `app/index.tsx:2506-2524`

| Inline prop | Replacement | Dependencies |
|---|---|---|
| `onSignOut={async () => { logger.action(...); await handleSignOut(); }}` | `const handleSignOutFromProfile = useCallback(async () => { logger.action('Sign out pressed'); await handleSignOut(); }, [handleSignOut])` | `handleSignOut` |
| `onNavigateToConnections={() => { logger.action(...); setPendingConnectionsPanel("friends"); setCurrentPage("connections"); }}` | `const handleNavigateToConnectionsFromProfile = useCallback(() => { logger.action('Navigate to connections from profile'); setPendingConnectionsPanel("friends"); setCurrentPage("connections"); }, [setPendingConnectionsPanel, setCurrentPage])` | `setPendingConnectionsPanel`, `setCurrentPage` |
| `savedExperiences={savedCards?.length \|\| 0}` | `const savedExperiencesCount = useMemo(() => savedCards?.length ?? 0, [savedCards])` | `savedCards` |
| `scheduledCount={calendarEntries?.length \|\| 0}` | `const scheduledCount = useMemo(() => calendarEntries?.length ?? 0, [calendarEntries])` | `calendarEntries` |

#### §2.A.2 — `React.memo` wrap for 6 tab screens

Each of the 6 tab files must change its export from `export default function X(...) {}` to:

```ts
function X(...) { /* unchanged body */ }
export default React.memo(X);
```

For files that already use a different export pattern (e.g. `SavedExperiencesPage.tsx:548 — export default SavedExperiencesPage;`), wrap the component variable:

```ts
const SavedExperiencesPage = function SavedExperiencesPage(...) { /* unchanged */ };
export default React.memo(SavedExperiencesPage);
```

**Memo equality:** **Default `Object.is` shallow compare is sufficient** for all 6 tabs IF §2.A.1 is implemented correctly. Reasoning: every prop received by each tab is now either (a) a stable primitive (string, number, boolean), (b) a `useCallback`-stabilized function, or (c) a `useMemo`-stabilized object/array, or (d) state directly from `useAppState`/`useAppStore` (which is identity-stable when its underlying value hasn't changed). **DO NOT write a custom `arePropsEqual` function** — if shallow compare fails, the bug is upstream in §2.A.1, not in the memo barrier.

**Live-data prop handling:** When a prop legitimately changes (e.g. `boardsSessions` after a Realtime event), shallow compare correctly detects it and the active tab re-renders. Hidden tabs that don't actually receive that updated prop (because their JSX doesn't read it) won't re-render — this is the correct behavior.

#### §2.A.3 — Dev-mode render-count instrument

Add to **each of the 6 tab files**, near the top of the component body (after the props destructure, before any hook calls):

```ts
if (__DEV__) {
  // ORCH-0679 Wave 2A: Dev-only render counter to verify memo barrier holds.
  // Tap a different tab — only that tab should log. Hidden tabs MUST NOT log.
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  console.log(`[render-count] HomePage: ${renderCountRef.current}`);
}
```

Replace `HomePage` with the actual component name in each file. **Do not** wrap this in a `useEffect` — it must execute in render so it counts re-renders, not effect runs. The `__DEV__` guard means this code is dead-stripped from release builds (Hermes constant-fold).

#### §2.A.4 — Helper handlers in `app/index.tsx` that are themselves inline

`refreshAllSessions` (declared as `const refreshAllSessions = async (options?: { showLoading?: boolean }) => { ... }` at line 1122) is currently a re-declared function on every render. It must be wrapped in `useCallback` with these dependencies: `[user?.id, setIsLoadingBoards, updateBoardsSessions]`. **Verification:** read `refreshAllSessions` body — if it accesses any state values directly (not via setter), those must be in the dep array.

Same for `handleSessionSelect`, `handleSoloSelect`, `handleCreateSession`, `handleAcceptInvite`, `handleDeclineInvite`, `handleCancelInvite`, `handleInviteMoreToSession`, `handleNotificationNavigate`, `closeProfileOverlays` — every helper declared in `AppContent` body that's passed to a memoized tab must itself be `useCallback`-wrapped, otherwise the inline-prop fix is partially defeated.

**Rule:** if a function declared inside `AppContent` is passed as a prop to ANY of the 6 tabs, it must be `useCallback`-wrapped.

#### §2.A.5 — Optional bonus (low priority): hoist non-tab inline props

`app/index.tsx:2560-2567` (ShareModal) and `2572-2582` (PostExperienceModal) and `2587-2627` (PreferencesSheet two mount sites) also have inline `onClose` lambdas and inline `accountPreferences={{...}}`. Since these modals are not always mounted, the perceived perf impact is lower. Implementor may hoist these IF time allows and IF the changes don't bloat the diff beyond review-friendly size. If skipped, leave a `// [TRANSITIONAL] inline prop — Wave 2A scope was tab-only; hoisting deferred` comment at each site.

#### §2.A.6 — Wave 2A Acceptance criteria

- AC-2A-1: Every prop passed to `<HomePage>`, `<DiscoverScreen>`, `<ConnectionsPage>`, `<SavedExperiencesPage>`, `<LikesPage>`, `<ProfilePage>` in `app/index.tsx` is either a primitive, a `useCallback`-stabilized function, a `useMemo`-stabilized object/array, or a directly-passed reference from a hook (no inline `=>` or inline `={{`)
- AC-2A-2: All 6 tab files default-export `React.memo(...)` (default shallow compare, no custom equality fn)
- AC-2A-3: Dev render-count log for each tab is in place and gated by `__DEV__`
- AC-2A-4: 3 CI gates exist in `app-mobile/scripts/ci/`:
  - `check-no-inline-tab-props.sh` — fails if `=>` OR `={{` appears within line range 2362-2525 of `app/index.tsx` (use `awk` for region scope)
  - `check-tabs-memo-wrapped.sh` — fails if any of the 6 tab files lacks `React.memo` on its default export (regex: `export default React\.memo\(`)
  - `check-render-counter-present.sh` — fails if any of the 6 tab files lacks the `__DEV__` render-counter block
- AC-2A-5: Founder dev-build verification (per §8): switching tabs in dev shows ONLY the new active tab logging a render-count increment; previously-active tab does NOT log

---

### §2.B — Cold-Start Side-Effect Defer (Wave 2B-1)

#### §2.B.1.1 — Side-effect classification

The `useEffect` blocks in `app/index.tsx:278-385` are classified as follows. Each block is identified by its starting line:

| Line | Side effect | Classification | Defer? |
|---|---|---|---|
| 278-282 | `mixpanelService.initialize()` + `trackAppOpened({ source: 'cold' })` | Deferrable | YES — defer 1500ms |
| 288-290 | `configureRevenueCat(user?.id ?? null)` | Critical (RevenueCat must be configured before paywall renders) | NO — keep on mount |
| 293-302 | `loginRevenueCat(user.id)` / `logoutRevenueCat()` | Critical (auth-tied) | NO |
| 305 | `useCustomerInfoListener()` | Critical (subscription state) | NO |
| 311-313 | `initializeOneSignal()` | Deferrable (push permission is deferred to post-coach-mark anyway) | YES — defer 1500ms |
| 319-328 | `loginToOneSignal(user.id)` / `logoutOneSignal()` | Conditional (only if OneSignal init has completed) | DEPENDENT — wait for init |
| 334-336 | `initializeAppsFlyer()` | Deferrable | YES — defer 2000ms |
| 341-363 | `setAppsFlyerUserId` + `registerAppsFlyerDevice` + `logAppsFlyerEvent('af_login' \| 'af_complete_registration')` | Deferrable (attribution can fire 1-3s late without business impact) | YES — defer 2500ms (after AppsFlyer init) |
| 366 | `useTrialExpiryTracking(user?.id)` | Hook — runs on mount, internal logic. Read the hook to determine if it can defer. If it does network work, defer the network work inside the hook. | INSPECT |
| 370-378 | Profile timezone update (`UPDATE profiles SET timezone`) | Deferrable | YES — defer 3000ms |
| 385+ | V2 push notification listeners (`onForegroundNotification`, `onNotificationClicked`) | Critical (must be registered to receive pushes) | NO |

#### §2.B.1.2 — Defer mechanism

**Pattern (use this exact shape):**

```ts
useEffect(() => {
  if (isLoadingAuth) return;
  if (!user?.id) return;

  // ORCH-0679 Wave 2B-1: Defer non-critical SDK init until after first interactive frame
  // to keep cold-start JS thread free for navigation + initial render.
  const handle = InteractionManager.runAfterInteractions(() => {
    setTimeout(() => {
      mixpanelService.initialize().then(() => {
        mixpanelService.trackAppOpened({ source: 'cold' });
      });
    }, 1500);
  });

  return () => handle.cancel();
}, [user?.id, isLoadingAuth]);
```

**Defer schedule (post-`runAfterInteractions`):**

- Mixpanel init: +1500ms
- OneSignal init: +1500ms (parallel with Mixpanel — both fire simultaneously after 1.5s)
- AppsFlyer init: +2000ms
- AppsFlyer user ID/device/attribution event: +2500ms (chained after AppsFlyer init — must wait)
- Profile timezone update: +3000ms

**Dependency rule:** `loginToOneSignal(user.id)` must NOT fire before `initializeOneSignal()` completes. Implementor must use a ref flag or promise to gate this:

```ts
const oneSignalInitializedRef = useRef(false);
// In the deferred OneSignal init effect:
//   await initializeOneSignal();
//   oneSignalInitializedRef.current = true;
// In the OneSignal login effect:
//   if (!oneSignalInitializedRef.current) return; // wait for init
//   loginToOneSignal(user.id);
```

#### §2.B.1.3 — Sentry Replay rate (covered separately in §2.C)

#### §2.B.1.4 — `useTrialExpiryTracking` hook inspection

Implementor MUST read `app-mobile/src/hooks/useSubscription.ts` (where `useTrialExpiryTracking` lives) and verify whether its body does network work. If it does:
- Wrap the network work in `InteractionManager.runAfterInteractions` inside the hook
- Add a `// ORCH-0679 Wave 2B-1: deferred network — does not block first paint` comment

If the hook only does in-memory work (e.g. reading from Zustand and a `useEffect`), leave it alone.

#### §2.B.1.5 — Acceptance criteria

- AC-2B1-1: Mixpanel, OneSignal init, AppsFlyer init+events, profile timezone update are all wrapped in `InteractionManager.runAfterInteractions(() => setTimeout(...))` with the specified delays
- AC-2B1-2: RevenueCat config/login, useCustomerInfoListener, push notification listeners remain on mount (NOT deferred)
- AC-2B1-3: Dependency gate exists: `loginToOneSignal` does not fire before `initializeOneSignal` completes
- AC-2B1-4: No critical-path UX regression (paywall still works, push routing still works, RevenueCat still gates features)
- AC-2B1-5: Founder dev-build verification: cold-start to first interactive tap is faster (subjective; founder reports "feels alive sooner")

---

### §2.C — Sentry Tune (Wave 2B-2)

#### §2.C.1 — Single source of truth

DELETE the `Sentry.init({...})` block at `app/index.tsx:141-150`. Keep ONLY the one at `app/_layout.tsx:6-23`.

Merge the configs. Final `_layout.tsx` Sentry init:

```ts
Sentry.init({
  dsn: 'https://5bb11663dddc2efc612498d7a14b70f4@o4511136062701568.ingest.us.sentry.io/4511136064012288',
  // From _layout.tsx (kept):
  sendDefaultPii: true,           // see §2.C.3 — pending founder confirmation
  enableLogs: true,               // see §2.C.3 — pending founder confirmation
  // ORCH-0679 Wave 2B-2: drop session-replay sample from 0.1 → 0.01
  // 1% session coverage is plenty for diagnostic sampling pre-launch.
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration()],
  // From app/index.tsx (merged in):
  enableNativeFramesTracking: true,
  enableAutoSessionTracking: true,
  tracesSampleRate: 0,
  maxBreadcrumbs: 50,
  enabled: !__DEV__,              // disabled in dev — was ONLY in app/index.tsx — preserve in merged config
});
```

The `enabled: !__DEV__` flag is critical — it disables Sentry entirely in development. Without merging this from `app/index.tsx`, the `_layout.tsx` init would run Sentry in dev too (currently it does, because `_layout.tsx` doesn't gate). **Adding `enabled: !__DEV__` is a behavioral change for dev builds — Sentry will no longer collect from dev. This is the desired behavior** (consistent with `app/index.tsx`'s prior intent).

#### §2.C.2 — Replay sample rate

Drop from `0.1` (10% of sessions) → `0.01` (1% of sessions). Rationale: pre-launch user count is small enough that 1% sampling still surfaces issues, and 10% on Android Snapdragon 6xx-class devices is documented to cause ~5-15% sustained CPU overhead during scroll.

`replaysOnErrorSampleRate: 1` is preserved (only fires on error — cheap).

#### §2.C.3 — `sendDefaultPii` + `enableLogs` privacy review (deferred to founder)

Per investigation D-3, `sendDefaultPii: true` + `enableLogs: true` may capture more user data than intended for production. **This spec leaves both as-is** but adds a `// TODO ORCH-0679-D3: privacy review — confirm sendDefaultPii intent` comment at the line. Founder confirms in a follow-up; if they want them removed, that's a one-line edit in a separate ORCH.

#### §2.C.4 — Acceptance criteria

- AC-2C-1: Exactly one `Sentry.init(...)` call exists in the entire `app-mobile/` codebase (verify via `grep -r "Sentry.init"`)
- AC-2C-2: `replaysSessionSampleRate` is `0.01`
- AC-2C-3: `enabled: !__DEV__` is preserved in the merged config
- AC-2C-4: Sentry still captures errors in production (smoke test: throw inside a try-catch wrapped in `if (!__DEV__)`, verify Sentry captures)
- AC-2C-5: CI gate `check-single-sentry-init.sh` fails if more than one `Sentry.init` call is found

---

### §2.D — PreferencesSheet Primitive Swap (Wave 2B-3)

#### §2.D.1 — Current state

`PreferencesSheet.tsx:13` imports `Modal` from `react-native`. Lines 1255-1272 wrap `sheetContent` in:

```jsx
<Modal
  visible={visible ?? false}
  animationType="slide"
  transparent={true}
  onRequestClose={onClose}
>
  <View style={styles.modalBackdrop}>
    {sheetContent}
  </View>
</Modal>
```

#### §2.D.2 — Target state — `@gorhom/bottom-sheet`

Replace with `BottomSheet` from `@gorhom/bottom-sheet` (already in `package.json:21`):

```jsx
<BottomSheet
  ref={bottomSheetRef}
  index={visible ? 0 : -1}
  snapPoints={['88%']}
  enablePanDownToClose={true}
  onClose={onClose}
  backdropComponent={renderBackdrop}
  keyboardBehavior="interactive"
  keyboardBlurBehavior="restore"
  android_keyboardInputMode="adjustResize"
>
  <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
    {sheetContent}
  </BottomSheetScrollView>
</BottomSheet>
```

#### §2.D.3 — Detailed swap requirements

**1. Imports (top of file):**
- ADD: `import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';`
- ADD: `import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';`
- REMOVE: `Modal` from the `react-native` import block at line 13

**2. Refs (in component body):**
- ADD: `const bottomSheetRef = useRef<BottomSheet>(null);`

**3. Snap points:**
- Use `useMemo(() => ['88%'], [])` for `snapPoints` — matches the current 88% sheet height implied by existing styles. Verify by reading `styles.modalBackdrop` and the current sheet's content layout — if the visible-area is different, adjust the snap point string accordingly. **Document the chosen snap point in a comment.**

**4. Backdrop:**
- Provide a `renderBackdrop` callback:
  ```tsx
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );
  ```
- This matches the current behavior: backdrop visible when sheet is open, tap-to-close.

**5. Visibility control:**
- Replace `visible={visible ?? false}` with `index={visible ? 0 : -1}`. `BottomSheet` uses index-based visibility (`-1` = closed, `0` = first snap point).
- ADD a `useEffect` that responds to `visible` prop changes:
  ```tsx
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);
  ```

**6. Close handling:**
- `onClose` is BottomSheet's callback when sheet fully closes. Pass `onClose` directly (already provided as a prop).
- The `enablePanDownToClose` prop allows pan-down-to-dismiss gesture (matches modal swipe-down).

**7. ScrollView replacement:**
- Replace the existing `<KeyboardAwareScrollView>` (line ~992) with `<BottomSheetScrollView>` — required for proper gesture interop within `BottomSheet`. **Critical:** `KeyboardAwareScrollView` from `keyboard-controller` (or whatever `./ui/KeyboardAwareScrollView` wraps) does NOT compose with BottomSheet's gesture handler — must use `BottomSheetScrollView`.
- Verify `keyboardShouldPersistTaps="handled"` and `contentContainerStyle={styles.scrollContent}` are preserved on `BottomSheetScrollView` (it accepts the same props as RN ScrollView).
- For keyboard-aware behavior, use BottomSheet's built-in `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"` props instead of `KeyboardAwareScrollView`.

**8. Stagger animations (lines 287-311):**
- `Animated.timing` with `useNativeDriver: true` continues to work inside BottomSheet (BottomSheet doesn't interfere with Animated values).
- Verify the 5 stagger animations still trigger when `visible` flips to `true`. The existing `useEffect` at line 287 watches `[visible, preferencesLoading]` — preserve this. The animations should fire when BottomSheet snaps to index 0.

**9. SafeAreaView handling:**
- Current code wraps content in `<SafeAreaView style={styles.container} edges={[]}>` (line 972). BottomSheet handles its own safe-area; verify by testing on iPhone notch + Android edge-to-edge. If issues arise, change `edges` to `['bottom']` or remove the `SafeAreaView` wrapper inside the sheet (BottomSheet's `topInset` prop can substitute).

**10. StatusBar:**
- Current code has `<StatusBar barStyle="dark-content" />` at line 973. Modal-on-Android sometimes needs explicit StatusBar control because it creates a new window. BottomSheet does NOT create a new window — it's an in-tree overlay — so the StatusBar component inside the sheet may have no effect. **Verify status-bar style on Android** when sheet is open. If broken, hoist StatusBar outside the sheet to the parent.

**11. GestureHandler verification:**
- `_layout.tsx:28` already wraps the root in `<GestureHandlerRootView>`. **Verify** by reading `_layout.tsx` — confirmed during ingestion.

#### §2.D.4 — Out of scope (do NOT touch in this spec)

- 25 useState calls in PreferencesSheet body (Wave 2C — useReducer migration)
- The 150-line load `useEffect` at lines 332-485 (Wave 2C)
- `LayoutAnimation` import at line 19 (Wave 2C — Reanimated layout animations)
- The duplicate state-init logic across solo/collab branches in the load effect (Wave 2C)

#### §2.D.5 — Acceptance criteria

- AC-2D-1: `PreferencesSheet.tsx` no longer imports `Modal` from `react-native`
- AC-2D-2: `PreferencesSheet.tsx` imports `BottomSheet`, `BottomSheetBackdrop`, `BottomSheetScrollView` from `@gorhom/bottom-sheet`
- AC-2D-3: Sheet opens/closes via BottomSheet's index-based API (visible→snap, !visible→close)
- AC-2D-4: Pan-down-to-close gesture works
- AC-2D-5: Backdrop tap closes the sheet
- AC-2D-6: Keyboard-aware behavior preserved (keyboard pushes content correctly when location search input is focused)
- AC-2D-7: Stagger animation sequence on open still fires (visible flips → 5 sections fade in with 70ms stagger)
- AC-2D-8: Save button still saves; cancel still cancels; collab + solo modes both work identically to pre-change behavior
- AC-2D-9: Visual parity — sheet looks the same as before (snap height, header, backdrop opacity, scroll content, footer)
- AC-2D-10: No Android-specific StatusBar regression
- AC-2D-11: CI gate `check-prefs-sheet-bottom-sheet.sh` fails if `PreferencesSheet.tsx` imports `Modal` from `react-native`

---

## §3 Success Criteria (numbered, observable, testable)

| # | Criterion | Verification |
|---|---|---|
| 1 | Tapping any tab pill causes ONLY the new active tab to log a render-count increment in dev | Founder dev-build: switch Home→Discover, see only Discover log; switch Discover→Likes, see only Likes log |
| 2 | A Realtime save event causes ONLY the active tab to re-render (if the active tab consumes saves) | Add a save in another device, observe render-count log on phone |
| 3 | Opening the preferences sheet from Home does NOT trigger a render-count increment on any tab | Founder dev-build: tap "Preferences", check console — no tab logs |
| 4 | Cold-start (post-auth landing) is interactive (first user tap is responsive) within 2.5s in dev mode (was 4-5s) | Founder dev-build with stopwatch: from auth complete → first responsive tap |
| 5 | Sentry captures a thrown error in production but is disabled in dev | `if (!__DEV__) throw new Error('test')` then check Sentry dashboard |
| 6 | Exactly one `Sentry.init` call exists in `app-mobile/` | `grep -r "Sentry.init" app-mobile/` returns one match |
| 7 | PreferencesSheet opens via pan-up gesture and closes via pan-down gesture | Manual test: pan down on open sheet — sheet closes |
| 8 | PreferencesSheet backdrop tap closes the sheet | Tap outside sheet — sheet closes |
| 9 | Wave 1 swipe smoothness preserved (no regression) | Swipe a card — gesture is fluid (Wave 1 native-driver intact) |
| 10 | Wave 1 lazy-load i18n preserved (no regression) | Switch language at runtime — switch completes in <500ms |
| 11 | Solo + collab parity for tab nav and prefs sheet | Switch to a collab session, then switch tabs and open prefs sheet — same behavior as solo |
| 12 | Onboarding unchanged | Sign out, sign back in, run through onboarding — no visual or perf regression |
| 13 | Build passes lint, type-check, and the 6+3 new CI gates (3 from Wave 1 + 3 new render gates + 1 Sentry gate + 1 prefs-sheet gate + 1 render-counter gate = 9 total) | CI run green |

---

## §4 Invariants Preserved + Introduced

### Preserved (must not break)

| ID | Invariant | Preservation strategy |
|---|---|---|
| I-ANIMATIONS-NATIVE-DRIVER-DEFAULT (Wave 1) | All transform/opacity animations use `useNativeDriver: true` | No animation code modified; verify post-change |
| I-LOCALES-LAZY-LOAD (Wave 1) | Only `en` is statically imported; 28 others lazy-load | No i18n code modified |
| I-ZUSTAND-PERSIST-DEBOUNCED (Wave 1) | Zustand persist coalesces writes via 250ms debounce | No appStore.ts changes |
| Constitution #2 (one owner per truth) | No duplicate state authorities | Memo doesn't change state ownership |
| Constitution #3 (no silent failures) | Errors surface | Sentry merge preserves error capture |
| Constitution #5 (server state stays server-side) | Zustand holds only client state | Memo doesn't affect this |
| Constitution #6 (logout clears everything) | No private data survives sign-out | Memo doesn't affect this |
| Constitution #14 (persisted-state startup) | App works correctly from cold cache | No persist changes |
| Onboarding design freeze (ORCH-0672) | No onboarding files touched | Spec scope explicitly excludes |
| Solo + collab parity | Same fix applies to both modes | All tab fixes are mode-agnostic |

### New invariants introduced (add to `INVARIANT_REGISTRY.md` post-merge)

**I-TAB-PROPS-STABLE** (NEW)
*Description:* Every prop passed to a tab screen component (HomePage, DiscoverScreen, ConnectionsPage, SavedExperiencesPage, LikesPage, ProfilePage) in `app/index.tsx` MUST be a stable reference: a primitive, a `useCallback`-stabilized function, a `useMemo`-stabilized object/array, or a directly-passed reference from a hook. Inline arrow functions and inline object literals are forbidden in tab JSX.
*Rationale:* Inline props bust `React.memo` shallow compare, recreating the render-storm bug.
*CI gate:* `check-no-inline-tab-props.sh`.

**I-TAB-SCREENS-MEMOIZED** (NEW)
*Description:* All 6 tab screen files default-export `React.memo(...)`. No tab screen exports a raw function component as default.
*Rationale:* Without memo, hidden tabs re-render on every parent state change, even with stable props.
*CI gate:* `check-tabs-memo-wrapped.sh`.

**I-SENTRY-SINGLE-INIT** (NEW)
*Description:* `Sentry.init(...)` is called exactly once in the `app-mobile/` codebase, in `app/_layout.tsx`. Duplicate init calls are forbidden.
*Rationale:* Double-init has undefined merge semantics across SDK versions.
*CI gate:* `check-single-sentry-init.sh`.

**I-PREFS-SHEET-USES-BOTTOM-SHEET** (NEW)
*Description:* `PreferencesSheet.tsx` MUST use `@gorhom/bottom-sheet`, NOT RN's `Modal`.
*Rationale:* RN `Modal` creates a heavy native window on Android (50-200ms mount cost).
*CI gate:* `check-prefs-sheet-bottom-sheet.sh`.

---

## §5 Test Cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| **T-01** | Tap any tab pill | Only the new active tab logs a render-count increment in dev | RC-1 (2A) |
| **T-02** | Realtime save event arrives while user is on Saved tab | Saved tab updates; Home, Discover, Connections, Likes, Profile do NOT log re-render | RC-1 + RC-4 (2A) |
| **T-03** | Open PreferencesSheet from Home tab | Sheet opens. NO tab logs a re-render during open. Sheet's BottomSheet animation runs smoothly. | RC-1 + RC-3 (2A + 2D) |
| **T-04** | Cold-start (post-auth) | Tab nav is responsive within 2.5s in dev. Mixpanel/AppsFlyer/OneSignal events fire 1.5-3s late (verify by checking Mixpanel dashboard). RevenueCat is configured immediately. | RC-2 (2B-1) |
| **T-05** | Switch language at runtime | Wave 1 lazy-load works; <500ms switch | Cross-cutting (no regression) |
| **T-06** | Swipe a card in Discover | Wave 1 native-driver works; gesture smooth | Cross-cutting (no regression) |
| **T-07** | Switch from solo to collab session | Position preserved (deckStateRegistry from ORCH-0490 still works). Tab re-render scope unchanged after switch. | RC-1 parity |
| **T-08** | Throw an error in dev | Sentry does NOT capture (because `enabled: !__DEV__`) | CF-6 (2C) |
| **T-09** | Throw an error in production | Sentry captures via the single init point | CF-6 (2C) |
| **T-10** | PreferencesSheet — backdrop tap | Sheet closes | RC-3 (2D) |
| **T-11** | PreferencesSheet — pan-down gesture | Sheet closes | RC-3 (2D) |
| **T-12** | PreferencesSheet — keyboard appears for location search | Content scrolls/resizes; input remains visible | RC-3 (2D) |
| **T-13** | PreferencesSheet — stagger animation | 5 sections fade in with 70ms stagger when sheet opens | RC-3 (2D) |
| **T-14** | PreferencesSheet — save in solo mode | Save fires, sheet closes, recommendations refresh | RC-3 (2D) |
| **T-15** | PreferencesSheet — save in collab mode | Save fires, sheet closes (after collab persistence completes per ORCH-0446) | RC-3 (2D) |
| **T-16** | Onboarding regression smoke | Sign out → sign back in → run onboarding → all animations smooth, no visual change | Onboarding freeze |
| **T-17** | OneSignal foreground push | Push received while app is foreground → notification displayed (per ORCH `feedback_onesignal_sdk_v5_display`) | RC-2 (2B-1) — verifies deferred OneSignal init still completes |
| **T-18** | Paywall trigger | RevenueCat-gated feature triggers paywall correctly (RevenueCat NOT deferred) | RC-2 (2B-1) — verifies critical path preserved |
| **T-19** | CI gates | All 9 gates pass on green PR; each gate has a negative-control test (deliberately violate, see gate fail) | CI |

---

## §6 Implementation Order

Sequenced to minimize merge conflicts and allow incremental verification.

| Step | What | File(s) | Estimated time | Verification |
|---|---|---|---|---|
| **1** | Read all 6 tab files to inventory existing exports + identify any internal pattern that prevents `React.memo` (e.g. defaultProps, displayName conventions) | All 6 tab files | 30 min | Note observations |
| **2** | Wrap 6 tab files in `React.memo` (one-line change per file) — establishes the barrier | All 6 tab files | 30 min | Type-check passes; tabs still render |
| **3** | Add `__DEV__` render-count instrument to each of 6 tab files | All 6 tab files | 30 min | Console shows render counts on tab switch (will show ALL 6 logging until step 4 completes) |
| **4** | Hoist all inline props in `app/index.tsx` lines 2362-2525 per §2.A.1 (6 tabs × ~5-9 props each = ~40 hoists) | `app/index.tsx` | 3-4 hours | Render counts now show only active tab logging |
| **5** | Wrap helper handlers (`refreshAllSessions`, `handleSessionSelect`, etc.) in `useCallback` per §2.A.4 | `app/index.tsx` | 1 hour | Inline-prop hoists from step 4 are not defeated by unstable handler refs |
| **6** | Add 3 CI gates for render-storm: `check-no-inline-tab-props.sh`, `check-tabs-memo-wrapped.sh`, `check-render-counter-present.sh` | `app-mobile/scripts/ci/` | 1 hour | Run each gate manually; deliberately introduce a violation to confirm fail |
| **7** | Optional: hoist non-tab inline props per §2.A.5 (ShareModal, PostExperienceModal, PreferencesSheet 2 mount sites) | `app/index.tsx` | 30 min | Optional — skip if time-pressured |
| **8** | Defer side-effect SDKs per §2.B.1 (Mixpanel, OneSignal, AppsFlyer, profile timezone update) | `app/index.tsx` lines 278-385 | 2 hours | Verify each SDK still fires (just later); add console.time markers in dev |
| **9** | Add OneSignal init→login dependency gate per §2.B.1.2 | `app/index.tsx` | 30 min | OneSignal login does not race init |
| **10** | Inspect `useTrialExpiryTracking` hook per §2.B.1.4 — if it does network work, defer that work | `app-mobile/src/hooks/useSubscription.ts` | 30 min (read-only if no network) | Inspection note in implementation report |
| **11** | Sentry merge: delete `app/index.tsx:141-150`, update `_layout.tsx` config per §2.C.1 | `app/_layout.tsx`, `app/index.tsx` | 30 min | `grep -r "Sentry.init" app-mobile/` returns 1 match; type-check passes |
| **12** | Add Sentry CI gate `check-single-sentry-init.sh` | `app-mobile/scripts/ci/` | 15 min | Gate fails when given a fake duplicate; passes when single |
| **13** | PreferencesSheet primitive swap per §2.D | `PreferencesSheet.tsx` | 4-6 hours | All 11 AC-2D-* criteria verified manually + type-check |
| **14** | Add prefs-sheet CI gate `check-prefs-sheet-bottom-sheet.sh` | `app-mobile/scripts/ci/` | 15 min | Gate fails when `Modal` re-introduced; passes after swap |
| **15** | Run all 9 CI gates locally + lint + type-check | repo | 30 min | All green |
| **16** | Founder dev-build verification per §8 | Phone | 15 min | Founder confirms tab nav and prefs sheet feel faster |

**Total estimated time:** 16-20 hours implementor + 4-6 hours tester. **2-3 day implementor wall-clock.**

---

## §7 Regression Prevention

| Regression class | Prevention |
|---|---|
| Inline prop reintroduced in tab JSX | CI gate `check-no-inline-tab-props.sh` (region-scoped lines 2362-2525) |
| Tab screen un-memoized | CI gate `check-tabs-memo-wrapped.sh` |
| Render-counter removed | CI gate `check-render-counter-present.sh` |
| Sentry init duplicated | CI gate `check-single-sentry-init.sh` |
| PreferencesSheet uses RN `Modal` again | CI gate `check-prefs-sheet-bottom-sheet.sh` |
| Side-effect SDK reverts to mount-time | Code comments at each `runAfterInteractions` site explaining why deferred + linking ORCH-0679. (No CI gate — would over-constrain future SDK additions.) |
| Sentry sample rate bumped back to 0.1 | Code comment at the rate config: `// ORCH-0679 Wave 2B-2: 0.01 = 1% sessions. DO NOT raise without ORCH approval — Android perf cost.` |

---

## §8 Founder Dev-Build Verification

After implementor returns the work and tester PASSes, founder runs these tests in their dev client (no EAS rebuild required — Metro hot-reload is sufficient):

### Test pack (5 tests, ~10 minutes total)

**Setup:** open dev console (Chrome DevTools attached to Metro, or Logcat on Android, or React Native Debugger).

| Test | Steps | Pass = | Fail = |
|---|---|---|---|
| **F-01: Tab render isolation** | Open app, sign in, land on Home. Tap Discover. Tap Likes. Tap Profile. Tap Home again. | Console shows ONLY one `[render-count] X: N` line per tap, where X is the new active tab and N is the per-tab counter. Hidden tabs do NOT log. | Multiple tabs log on a single tap → memo barrier broken |
| **F-02: Prefs sheet open feel** | From Home, tap "Preferences" button. Stopwatch from tap to sheet fully visible. | <300ms felt on dev. NO `[render-count]` log fires for any tab during open. | >500ms or any tab logs during open |
| **F-03: Realtime event isolation** | Open app on two phones with same account. On phone A, save a card. Watch console on phone B. | Only `[render-count] LikesPage` (or wherever saves are consumed) logs. Other tabs silent. | Multiple tabs log → state ownership leak |
| **F-04: Cold-start feel** | Force-quit the app. Reopen. Stopwatch from splash→first interactive tap. | <2.5s in dev (was 4-5s). | >3s |
| **F-05: Wave 1 regression check** | Swipe 10 cards. Switch language to Spanish. Switch back. | Wave 1 wins still felt (smooth swipes, fast language switch). | Either feels regressed → Wave 2 broke Wave 1 |

If F-01 through F-05 are all green, founder reports `"Wave 2 live-fire green"` and orchestrator runs CLOSE protocol.

### What founder should NOT expect from Wave 2

- **Swipe smoothness changes** — that's Wave 1, already done. Wave 2 doesn't touch swipe gestures.
- **Onboarding changes** — out of scope.
- **First cold-start being instantaneous** — JS bundle parse + auth resolution + first render still takes 1-2s in dev. The "feels alive" improvement is from cutting the side-effect storm, not from teleportation.
- **All bottom sheets in the app feeling new** — only PreferencesSheet was swapped. ShareModal, PostExperienceModal, BillingSheet, AccountSettings still use whatever they used before (out of scope, separate audit).

---

## §9 Effort + Risk Per Sub-Section

| Sub-section | Effort | Risk | Mitigation |
|---|---|---|---|
| 2A render-storm | 6-8 hours | MEDIUM — possible to break a hook closure assumption when memoizing | Step 1 inspection of each tab file; preserve any prop deliberately left identity-unstable with explicit comment |
| 2B-1 cold-start defer | 3-4 hours | LOW-MEDIUM — risk of breaking SDK init chain (e.g. OneSignal login before init) | Explicit dependency gate in §2.B.1.2; tester verifies all SDK events still fire |
| 2B-2 Sentry tune | 1 hour | LOW — config consolidation is mechanical | Type-check + smoke-test error capture |
| 2B-3 prefs sheet | 4-6 hours | MEDIUM — keyboard interop with BottomSheet on Android can have edge cases | Use `keyboardBehavior="interactive"` per Bottom Sheet docs; tester explicitly tests keyboard scroll |
| Total | **14-19 hours** | **MEDIUM bundle** | Stage in 2A → 2B-2 → 2B-1 → 2B-3 order so smallest-risk changes ship first if time-pressured |

---

## §10 Discoveries surfaced during spec writing

- **D-WAVE2-1:** `app/index.tsx` has TWO PreferencesSheet mount sites at lines 2587-2609 (collab) and 2610-2627 (solo). Both have inline `accountPreferences={{...}}` and inline `onClose` lambdas. §2.A.5 covers them as optional bonus. If skipped in Wave 2, they remain HF for future.
- **D-WAVE2-2:** `app/index.tsx:1122` declares `refreshAllSessions` as a plain `const fn = async (...)` — recreated every render. This is referenced by tab props AND by useEffects. Wrapping in `useCallback` (per §2.A.4) is non-trivial because its body uses many closure values. Implementor must read body carefully. Listed as MEDIUM risk task in step 5.
- **D-WAVE2-3:** `_hasHydrated` is destructured from `useAppStore()` in `AppStateManager.tsx:94` AND in app/index.tsx via the `state` destructure. Both paths funnel through the same Zustand store. Memo barrier interaction with `_hasHydrated` flips needs verification (it should re-render correctly since `_hasHydrated: false → true` is a real change).
- **D-WAVE2-4:** `<MobileFeaturesProvider>`, `<CardsCacheProvider>`, `<RecommendationsProvider>`, `<NavigationProvider>`, `<CoachMarkProvider>` all wrap the tab subtree. Each provider's value, if recreated every render of `AppContent`, defeats the memo barrier for any descendant that consumes its context. Implementor MUST verify each provider's `value` prop is stable (or wrapped in `useMemo`). If any is unstable, that's an additional fix in this wave.
- **D-WAVE2-5:** `KeyboardAwareScrollView` in `PreferencesSheet.tsx:992` is a custom local component (`./ui/KeyboardAwareScrollView`). When swapping to `BottomSheetScrollView`, implementor should read this local component to understand what behavior is being lost (auto-scroll-to-focused-input?) and verify BottomSheet's keyboard props give equivalent UX.

---

## §11 What the implementor must NOT do

- Do NOT touch onboarding files (design freeze)
- Do NOT touch SwipeableCards.tsx, DiscoverScreen lines 575-620, i18n/index.ts, appStore.ts (Wave 1 staged code — preserve untouched)
- Do NOT consolidate PreferencesSheet useState into useReducer (Wave 2C)
- Do NOT remove `LayoutAnimation` from PreferencesSheet (Wave 2C)
- Do NOT split `useAppState` into multiple hooks (Wave 2C)
- Do NOT propose a custom `arePropsEqual` for any tab's `React.memo` — if shallow compare fails, fix the upstream prop instability
- Do NOT add `useMemo` for primitives (numbers, strings, booleans) — only for objects, arrays, and functions
- Do NOT add `useCallback` for handlers that are never passed as props
- Do NOT introduce new dependencies — `@gorhom/bottom-sheet` is already installed
- Do NOT skip the founder dev-build verification section in the implementation report — every founder verification step F-01 through F-05 must be addressed by the implementation

---

**End of spec. Implementor takes over next via DISPATCH from orchestrator.**
