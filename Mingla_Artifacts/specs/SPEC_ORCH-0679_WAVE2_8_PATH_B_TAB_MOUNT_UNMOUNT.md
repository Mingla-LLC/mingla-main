# SPEC — ORCH-0679 Wave 2.8 Path B: Tab Mount/Unmount Rearchitecture

**Status:** READY FOR IMPLEMENTOR
**Date:** 2026-04-26
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0679_WAVE2_CONTEXT_AUDIT.md` (the audit that recommended Path B)
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_DISPATCH_ORCH-0679_WAVE2_8_PATH_B_TAB_MOUNT_UNMOUNT.md`
**Predecessors:** Wave 2 + 2.5 + 2.6 + 2.7 (commit `6f2ae081` plus uncommitted Wave 2.7)

---

## §1 Layman Summary

Replace the always-mounted-6-tabs pattern in `app/index.tsx` with a `switch (currentPage)` that mounts only the active tab. Hidden tabs literally don't exist → no memo concerns, no context propagation issues, no god-hook impact. Add a small Zustand-backed scroll-position registry to preserve per-tab scroll state across remount. All Wave 2/2.5/2.6/2.7 work stays as defense-in-depth.

---

## §2 Scope and Non-Goals

### Scope
| ID | Change | File(s) |
|---|---|---|
| 2.8-A | Replace tab JSX block with switch-based active-tab-only render | `app/index.tsx` lines ~2528-2643 |
| 2.8-B | Add scroll-position registry to Zustand `appStore.ts` | `app-mobile/src/store/appStore.ts` |
| 2.8-C | Add `useTabScrollRegistry` hook | NEW `app-mobile/src/hooks/useTabScrollRegistry.ts` |
| 2.8-D | Per-tab onScroll capture + onMount restore (5 tabs that have ScrollViews/FlatLists) | 5 tab files |
| 2.8-E | Filter state preservation (Saved + Discover only — they have user-set filters) | 2 tab files |
| 2.8-F | Remove `styles.tabVisible` and `styles.tabHidden` | `app/index.tsx` styles |
| 2.8-G | Update or retire `check-no-inline-tab-props.sh` CI gate | `scripts/ci/` |

### Non-Goals (out of scope)
- **TS-1.5** (useAppHandlers god-hook stabilization) — irrelevant under Path B; god-hook still recreates handlers but no tab is around to receive them as unstable refs across renders. Kept deferred.
- **TS-2** (RecommendationsContext memoization) — irrelevant for tab-level concerns. Kept deferred.
- **ORCH-0680** (PopularityIndicators conditional `useAnimatedStyle`) — separate ORCH.
- **Wave 2/2.5/2.6/2.7 rollback** — DO NOT roll back. Memo wraps + useCallback hoists become defense-in-depth.
- **Onboarding** — design freeze.
- **`RealtimeSubscriptions.tsx`** — mounted at app shell level, survives tab unmounts. NO change.
- **Provider stabilizations** (NavigationContext, MobileFeaturesProvider, CoachMarkContext) — mounted at app shell, survive tab unmounts. NO change.
- **First-tab-visit cost optimization** — if founder reports first visit feels slow, follow-up wave (idle preload of next-likely tab). NOT in this spec.

### Assumptions Verified (per dispatch §2)
| Assumption | Verification | Result |
|---|---|---|
| React Query cache survives tab unmount | `app-mobile/src/config/queryClient.ts:189-192` — `gcTime: 24 * 60 * 60 * 1000` (24h) | ✅ Cache held 24h after last consumer unmounts. Tab switches happen in seconds. |
| Realtime subscriptions survive | `app/index.tsx:2528` — `<RealtimeSubscriptions userId={user.id} />` mounted at AppContent level (inside providers, OUTSIDE tab JSX block), wrapped in `<React.Fragment key={realtimeEpoch}>`. Survives tab swaps. | ✅ |
| `deckStateRegistry` (ORCH-0490) survives | RecommendationsProvider is at app shell level. Registry lives in that context. Tab unmounts don't affect the provider. | ✅ |
| Zustand state survives | App-global store, never unmounts | ✅ Trivially survives |

---

## §3 Per-Tab State Preservation Matrix

For each tab, every `useState` was audited. Decisions:

| Tab | useState | Decision | Reason |
|---|---|---|---|
| **HomePage** | `showNotificationsModal` | RESET | Modal flag — natural to close on tab switch |
| | `showFriendRequestsModal` | RESET | Same |
| | `inviteModalTrigger` | RESET | Internal nonce object — re-derive on remount |
| | `createTriggerNonce` | RESET | Increments on user action — start fresh |
| | `sessionModalTrigger` | RESET | Same |
| | (scroll position) | NOT APPLICABLE | HomePage has SwipeableCards, NOT a top-level ScrollView. Deck position is preserved via `deckStateRegistry` (app-shell context). No registry entry needed. |
| **DiscoverScreen** | `reduceTransparency`, `reduceMotion` | RESET | Re-fetch from `AccessibilityInfo` on mount (cheap async call) |
| | `isExpandedModalVisible`, `selectedCardForExpansion`, `expandedCardIndex` | RESET | Modal state — fine to close on tab switch |
| | `showPaywall`, `paywallFeature` | RESET | Paywall state — fine to dismiss on switch |
| | `deviceGpsLat`, `deviceGpsLng` | RESET | GPS re-fetched on mount |
| | `isFilterModalVisible` | RESET | Modal flag |
| | `selectedFilters` | **PRESERVE** | User-set filter state — losing it = bad UX |
| | `nightOutCards`, `nightOutLoading`, `nightOutError`, `isRefreshing` | RESET | Server state — refetched via React Query, cache returns instantly |
| | (scroll position) | **PRESERVE** | FlatList scroll — `discover_main` registry key |
| **ConnectionsPage** | `failedAvatar`, `reduceTransparency` | RESET | UI flag / accessibility re-derive |
| | `activePanel` | **PRESERVE** | User expects to return to same panel (friends/add/blocked) |
| | `showFriendsModal` | RESET | Modal flag |
| | `badgeDismissed` | RESET | UI dismiss state — fine to reset |
| | `searchQuery` | **PRESERVE** | User typed it — losing on tab switch is hostile |
| | `friendPickerVisible` | RESET | Modal |
| | `isRefreshing` | RESET | Pull-to-refresh state |
| | `friendsModalTab` | **PRESERVE** | Sub-tab within friends modal |
| | `mutedUserIds` | RESET | Server state — refetched on mount |
| | `conversations`, `conversationsLoading`, `error` | RESET | Server state — refetched |
| | `archivedIds`, `showArchived` | RESET | Local UI mode — fine to reset |
| | `activeChat`, `showMessageInterface`, `currentConversationId`, `messages`, `messagesCache`, `uploadingFile`, `activeChatIsBlocked`, `activeChatIsUnfriended`, `activeChatIsDeletedAccount` | RESET | Chat session state — closing on tab switch is fine; user can re-tap conversation. The `pendingOpenDmUserId` mechanism in app shell already handles "open this chat on Connections tab mount". |
| | `showAddToBoardModal`, `selectedFriendForBoard`, `showReportModal`, `selectedUserToReport`, `showBlockModal`, etc. | RESET | All action modals |
| | (scroll position) | **PRESERVE** per panel | One registry key per active panel: `connections_friends`, `connections_add`, `connections_blocked` |
| **SavedExperiencesPage** | `searchQuery` | **PRESERVE** | User typed it |
| | `selectedCategory` | **PRESERVE** | Filter |
| | `matchScoreFilter` | **PRESERVE** | Filter |
| | `dateRangeFilter` | **PRESERVE** | Filter |
| | `sortOption` | **PRESERVE** | User-chosen sort |
| | `filteredCards` | RESET (derived) | Recompute on mount from preserved filters + savedCards |
| | (scroll position) | **PRESERVE** | `saved` registry key |
| **LikesPage** | `activeTab` (saved/calendar) | **PRESERVE** | Inner tab — user expects to return to same view |
| | `reduceTransparency`, `reduceMotion` | RESET | Re-fetch |
| | `layoutTick` | RESET | Internal layout invalidation counter |
| | (scroll position) | **PRESERVE** per inner-tab | `likes_saved`, `likes_calendar` |
| **ProfilePage** | `legalBrowserVisible`, `legalBrowserUrl`, `legalBrowserTitle` | RESET | Modal |
| | `currentLocation` | RESET | Re-derive from GPS |
| | `isUploading`, `isLoadingLocation`, `locationError` | RESET | Transient async state |
| | `showBioSheet`, `showInterestsSheet`, `showAccountSettings`, `showBillingSheet` | RESET | All modal flags |
| | (scroll position) | **PRESERVE** | `profile` registry key |

**Total preserve-via-registry decisions:** scroll positions for 5 tabs + sub-keys (8 keys total), filters for Discover+Saved (6 keys), active panel/sub-tab for Connections+Likes (3 keys). **17 registry keys total**.

---

## §4 Scroll-Position + Filter Registry Contract

### Storage: extend Zustand `appStore.ts`

Add this slice to the existing store:

```ts
// app-mobile/src/store/appStore.ts (additions)

interface TabRegistryState {
  // Scroll positions (in pixels, Y offset)
  scroll: {
    discover_main: number;
    connections_friends: number;
    connections_add: number;
    connections_blocked: number;
    saved: number;
    likes_saved: number;
    likes_calendar: number;
    profile: number;
  };
  // Filter state (Discover, Saved)
  discoverFilters: NightOutFilters | null; // null = use defaults on first mount
  savedFilters: {
    searchQuery: string;
    selectedCategory: string | null;
    matchScoreFilter: number | null;
    dateRangeFilter: 'all' | '7' | '30';
    sortOption: 'newest' | 'oldest' | 'matchHigh' | 'matchLow';
  } | null;
  // Active panel/sub-tab state
  connectionsActivePanel: 'friends' | 'add' | 'blocked' | null;
  connectionsFriendsModalTab: 'friend-list' | 'requests' | 'add' | null;
  likesActiveTab: 'saved' | 'calendar';
}
```

Add setters:
```ts
setTabScroll: (key: keyof TabRegistryState['scroll'], y: number) => void;
setDiscoverFilters: (filters: NightOutFilters | null) => void;
setSavedFilters: (filters: TabRegistryState['savedFilters']) => void;
setConnectionsActivePanel: (panel: TabRegistryState['connectionsActivePanel']) => void;
setConnectionsFriendsModalTab: (tab: TabRegistryState['connectionsFriendsModalTab']) => void;
setLikesActiveTab: (tab: 'saved' | 'calendar') => void;
```

Persist scope: **NOT persisted to AsyncStorage** (intentional). These are session-scoped — fresh app session = fresh state. Don't bloat the persist payload.

Initial state (defaults):
```ts
{
  scroll: {
    discover_main: 0,
    connections_friends: 0,
    connections_add: 0,
    connections_blocked: 0,
    saved: 0,
    likes_saved: 0,
    likes_calendar: 0,
    profile: 0,
  },
  discoverFilters: null,
  savedFilters: null,
  connectionsActivePanel: null,
  connectionsFriendsModalTab: null,
  likesActiveTab: 'saved',
}
```

### Hook: `useTabScrollRegistry.ts` (NEW)

```ts
// app-mobile/src/hooks/useTabScrollRegistry.ts

import { useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import type { ScrollView, FlatList } from 'react-native';

type ScrollKey = keyof ReturnType<typeof useAppStore.getState>['scroll'];

interface UseTabScrollRegistryReturn {
  /** Pass to ScrollView/FlatList ref */
  scrollRef: React.MutableRefObject<ScrollView | FlatList | null>;
  /** Pass to onScroll prop */
  handleScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => void;
}

export function useTabScrollRegistry(key: ScrollKey): UseTabScrollRegistryReturn {
  const scrollRef = useRef<ScrollView | FlatList | null>(null);
  const setTabScroll = useAppStore((s) => s.setTabScroll);
  const initialY = useAppStore.getState().scroll[key]; // initial read only

  // Restore on mount
  useEffect(() => {
    if (initialY > 0 && scrollRef.current) {
      // Use rAF to wait for layout
      requestAnimationFrame(() => {
        const ref = scrollRef.current;
        if (!ref) return;
        if ('scrollToOffset' in ref) {
          (ref as FlatList).scrollToOffset({ offset: initialY, animated: false });
        } else if ('scrollTo' in ref) {
          (ref as ScrollView).scrollTo({ y: initialY, animated: false });
        }
      });
    }
    // Capture on unmount: latest value already in Zustand via handleScroll throttle
  }, []);

  // Throttled write: only persist every 100ms while scrolling (avoid storm)
  const lastWriteRef = useRef(0);
  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const now = Date.now();
    if (now - lastWriteRef.current < 100) return;
    lastWriteRef.current = now;
    setTabScroll(key, e.nativeEvent.contentOffset.y);
  }, [key, setTabScroll]);

  return { scrollRef, handleScroll };
}
```

**Why throttle:** ScrollView fires onScroll on every frame. Writing to Zustand 60x/sec causes its own perf issue. 100ms = 10 writes/sec which is plenty for resume-on-tab-switch fidelity.

**Why `requestAnimationFrame`:** scrollTo needs the ScrollView's content to be measured before it can scroll. rAF defers to next frame after layout.

---

## §5 Tab JSX Replacement (Component Layer)

### Current code at `app/index.tsx:2528-2643` (post-Wave-2.7)

```jsx
<View style={{ flex: 1 }}>
  <View style={currentPage === 'home' ? styles.tabVisible : styles.tabHidden}>
    <HomePage isTabVisible={currentPage === 'home'} ...32 props... />
  </View>
  <View style={currentPage === 'discover' ? styles.tabVisible : styles.tabHidden}>
    <DiscoverScreen isTabVisible={currentPage === 'discover'} ...7 props... />
  </View>
  ...repeated for connections, saved, likes, profile...
</View>
```

### Target code

```jsx
<View style={{ flex: 1 }}>
  {(() => {
    switch (currentPage) {
      case 'home':
        return (
          <HomePage
            isTabVisible={true}
            ...32 props... (unchanged)
          />
        );
      case 'discover':
        return (
          <DiscoverScreen
            isTabVisible={true}
            ...7 props... (unchanged)
          />
        );
      case 'connections':
        return (
          <ConnectionsPage
            isTabVisible={true}
            ...18 props... (unchanged)
          />
        );
      case 'saved':
        return (
          <SavedExperiencesPage
            isTabVisible={true}
            ...7 props... (unchanged)
          />
        );
      case 'likes':
        return (
          <LikesPage
            isTabVisible={true}
            ...14 props... (unchanged)
          />
        );
      case 'profile':
        return (
          <ProfilePage
            isTabVisible={true}
            ...11 props... (unchanged)
          />
        );
      default:
        return null;
    }
  })()}
</View>
```

### Decisions

- **`isTabVisible={true}`**: keep the prop for API stability. Pass `true` always. Tabs that read this prop will continue to work without internal changes.
- **IIFE switch over useMemo'd switch**: simpler. The IIFE re-evaluates on every parent render but only ONE tab's JSX is created (vs. 6). The cost is identical to inline JSX.
- **Default case returns `null`**: defensive — TypeScript should catch unhandled cases, but null protects against runtime page values not in the union (e.g., legacy 'activity' which redirects to 'likes').

### Style cleanup

Remove from `app/index.tsx` styles object:
```ts
// DELETE THESE:
tabVisible: { flex: 1 },
tabHidden: {
  position: 'absolute',
  top: 0, left: 0, right: 0, bottom: 0,
  opacity: 0,
  pointerEvents: 'none',
},
```

---

## §6 Per-Tab Integration Changes

For each tab that needs scroll/filter preservation, the implementor must add the registry usage. Below is the EXACT change for each.

### DiscoverScreen.tsx
**Add** to imports:
```ts
import { useTabScrollRegistry } from '../hooks/useTabScrollRegistry';
import { useAppStore } from '../store/appStore';
```

**Add** at the top of the component body (right after the `useTranslation` hook):
```ts
const { scrollRef, handleScroll } = useTabScrollRegistry('discover_main');
const persistedDiscoverFilters = useAppStore((s) => s.discoverFilters);
const setDiscoverFilters = useAppStore((s) => s.setDiscoverFilters);
```

**Change** the existing `selectedFilters` useState init to read from registry:
```ts
const [selectedFilters, setSelectedFilters] = useState<NightOutFilters>(
  persistedDiscoverFilters ?? { /* existing defaults */ }
);
```

**Add** an effect to sync filter changes to registry:
```ts
useEffect(() => {
  setDiscoverFilters(selectedFilters);
}, [selectedFilters, setDiscoverFilters]);
```

**Pass** `scrollRef` and `handleScroll` to the FlatList that renders the cards.

### SavedExperiencesPage.tsx
Same pattern. Registry key: `'saved'`. Filter state object stored under `savedFilters`.

### ConnectionsPage.tsx
Three scroll registry keys (one per panel: `connections_friends`, `connections_add`, `connections_blocked`). Use the active panel value to pick the correct key. Plus `connectionsActivePanel` and `connectionsFriendsModalTab` registry entries.

### LikesPage.tsx
Two scroll registry keys (`likes_saved`, `likes_calendar`). Plus `likesActiveTab` registry.

### ProfilePage.tsx
One scroll key: `'profile'`.

### HomePage.tsx
**No scroll registry needed** (no top-level ScrollView; deck position is in `deckStateRegistry`).

---

## §7 Success Criteria (numbered, observable, testable)

| # | Criterion | Verification |
|---|---|---|
| 1 | Tap any tab → exactly 1 `[render-count]` log (the new active tab's first render) | Founder dev-client console |
| 2 | Tap a tab not previously visited → 1 log; tap a tab previously visited → 1 log (it's a fresh mount) | Founder console |
| 3 | Scroll position restores on tab revisit (within ~10px tolerance) | F-RP test below |
| 4 | Set a filter on Saved → switch to Likes → switch back → filter still applied | F-PRES test |
| 5 | Active panel on Connections (e.g., 'add') survives tab switch | F-PRES test |
| 6 | Active inner tab on Likes ('saved' vs 'calendar') survives tab switch | F-PRES test |
| 7 | All Wave 1+2+2.5+2.6+2.7 invariants intact (9 CI gates green) | CI |
| 8 | Realtime DM still arrives in real-time (no regression from tab unmount) | F-REGRESSION test |
| 9 | Collab session create/accept/decline still works after tab switch | F-REGRESSION test |
| 10 | Coach mark tour can navigate between tabs (calls `setCurrentPage` and the new active tab mounts) | F-REGRESSION test |
| 11 | Onboarding flow unchanged | Sign out → sign in → onboarding |
| 12 | TypeScript clean (only the 3 pre-existing errors) | `npx tsc --noEmit` |

---

## §8 Invariants

### Preserved
- All Wave 1/2/2.5/2.6/2.7 invariants (per Wave 2.7 report §6)
- I-TAB-PROPS-STABLE — still enforced by CI gate (region scope updated; see §9)
- I-TAB-SCREENS-MEMOIZED — still in place (memo wraps stay; become defense-in-depth)
- I-NO-INLINE-MAP-IN-APPCONTENT — still enforced
- I-HOOKS-ABOVE-EARLY-RETURNS — still enforced
- I-SENTRY-SINGLE-INIT — unchanged
- I-PROVIDER-VALUE-MEMOIZED — still in place

### New (introduced by this spec)
- **I-ONLY-ACTIVE-TAB-MOUNTED** — `app/index.tsx` MUST render at most ONE tab component at a time, selected via `currentPage`. Never re-introduce the all-mounted pattern. CI gate: `check-active-tab-only.sh` (see §9).

---

## §9 CI Gates (Updates)

### `check-no-inline-tab-props.sh`
After Path B, the tab JSX block is much smaller (~30 lines, just the IIFE switch). The gate's region-scoped awk approach is still valuable but bounds need updating to match the new switch block. Implementor finds the new bounds and updates. Alternatively, retire this gate and rely on `check-active-tab-only.sh` instead.

**Recommendation:** UPDATE region bounds (don't retire). The gate still catches inline arrow fns / object literals as a class of regression for the active-tab JSX.

### `check-no-inline-map-in-appcontent.sh`
Unchanged — still scans AppContent body lines 144-2700.

### NEW: `check-active-tab-only.sh`
```bash
#!/usr/bin/env bash
# I-ONLY-ACTIVE-TAB-MOUNTED — ORCH-0679 Wave 2.8 invariant.
# Detects the all-mounted-tabs pattern (multiple tab components rendered
# inside <View style={tabVisible/tabHidden}> wrappers). Path B requires
# exactly ONE tab component rendered at a time via switch(currentPage).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_FILE="$APP_ROOT/app/index.tsx"

# Fail if styles.tabVisible or styles.tabHidden are still defined or referenced
if grep -qE "styles\.(tabVisible|tabHidden)" "$TARGET_FILE"; then
  echo "I-ONLY-ACTIVE-TAB-MOUNTED violation: legacy tabVisible/tabHidden styles still present"
  grep -nE "styles\.(tabVisible|tabHidden)" "$TARGET_FILE"
  exit 1
fi

# Fail if the all-mounted pattern (more than one tab component in the JSX
# render block at AppContent's top level) reappears.
# Heuristic: count top-level tab component invocations in the JSX after
# `<View style={{ flex: 1 }}>` wrapper. Should be 1 invocation per tab in
# a switch case, but only ONE active at runtime.
# This is hard to verify statically without an AST parser, so the gate's
# real job is to ensure the legacy style names are gone.

echo "I-ONLY-ACTIVE-TAB-MOUNTED: PASS"
exit 0
```

Total CI gates after Wave 2.8: **10** (9 existing + 1 new).

---

## §10 Test Cases

| ID | Scenario | Steps | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Render isolation | Tap each of 6 tabs in sequence | Exactly 1 `[render-count]` log per tap | Component |
| **T-02** | Revisit isolation | Tap home → tap discover → tap home | First home: 1 log; discover: 1 log; second home: 1 log (fresh mount) | Component |
| **T-03** | Scroll restore (Discover) | Scroll down on Discover → switch to Home → switch back | Discover scroll position restored within ~10px | Hook + Zustand |
| **T-04** | Scroll restore (Saved) | Scroll down on Saved → switch tabs → return | Position restored | Hook + Zustand |
| **T-05** | Filter preserve (Saved) | Type "park" in search → switch to Likes → return to Saved | Search query "park" still in input | Zustand |
| **T-06** | Filter preserve (Discover) | Open filter modal, set filters, close → switch tabs → return | Filters still applied | Zustand |
| **T-07** | Active panel preserve (Connections) | Tap "Add Friends" panel → switch tabs → return | "Add Friends" panel active | Zustand |
| **T-08** | Active inner tab preserve (Likes) | Tap "Calendar" inner tab → switch tabs → return | "Calendar" inner tab active | Zustand |
| **T-09** | Realtime DM regression | Send DM from second device → wait while on Home tab | DM arrives; Connections badge updates | Realtime |
| **T-10** | Collab create after switch | Create session → switch tabs → return → verify session in pill bar | Session present, no data loss | Realtime + Zustand |
| **T-11** | Coach mark tour | Trigger tour from settings; tour navigates Home→Profile | Each step's tab mounts correctly | Context |
| **T-12** | Onboarding regression | Sign out → sign in → run through onboarding | All animations + transitions work | Onboarding (frozen) |
| **T-13** | Wave 1 swipe smoothness | Swipe a card on Home | Native-driver gesture intact | Cross-cutting |
| **T-14** | Wave 1 language switch | Settings → switch language → switch back | <500ms switch | Cross-cutting |
| **T-15** | Cold-start state restore | Force-quit → reopen | Persisted Zustand state restores; Wave 1 invariants intact | Persist |
| **T-16** | Modal RESET semantics | Open notifications modal on Home → switch tabs → return | Modal closed on return (correct per §3 RESET decision) | Component |
| **T-17** | Chat session RESET | Open a chat in Connections → switch tabs → return | Chat closed; user can re-tap conversation. `pendingOpenDmUserId` from app shell handles deep-link case. | Component |
| **T-18** | Memo barriers preserved | All 6 tabs still wrapped in React.memo | grep CI gate still passes | CI |
| **T-19** | TypeScript clean | `npx tsc --noEmit` | Only the 3 pre-existing errors | TS |

---

## §11 Implementation Order

| Step | Action | File(s) | Time |
|---|---|---|---|
| 1 | Read all 6 tab files end-to-end (verify §3 state-preservation matrix matches actual code) | 6 tab files | 30 min |
| 2 | Add registry slice + setters to `appStore.ts` | `appStore.ts` | 15 min |
| 3 | Create `useTabScrollRegistry.ts` hook | NEW file | 15 min |
| 4 | Replace tab JSX block with switch (delete tabVisible/tabHidden styles) | `app/index.tsx` | 30 min |
| 5 | Per-tab integration: scroll registry on each ScrollView/FlatList (5 tabs × ~5 lines each) | 5 tab files | 1 hour |
| 6 | Per-tab integration: filter registry on Discover + Saved | 2 tab files | 30 min |
| 7 | Per-tab integration: active panel/inner tab registry on Connections + Likes | 2 tab files | 30 min |
| 8 | Update `check-no-inline-tab-props.sh` region bounds (or retire) | CI | 15 min |
| 9 | Add `check-active-tab-only.sh` new gate | CI | 15 min |
| 10 | Run all 10 CI gates + TypeScript | terminal | 5 min |
| 11 | Founder dev-client retest (T-01 through T-19) | dev client | 30 min |
| 12 | Write implementation report | reports | 30 min |

**Total: ~5-6 hours.**

---

## §12 Regression Prevention

| Risk | Prevention |
|---|---|
| Re-introducing all-mounted pattern | `check-active-tab-only.sh` gate |
| Inline props re-introduced in active tab JSX | `check-no-inline-tab-props.sh` (region updated) |
| Hooks placed below early returns | `check-react-hooks-rules.sh` (Wave 2.6) |
| State preservation regressions on tab additions | This spec (§3) becomes the canonical decision matrix; future tabs MUST update §3 |
| Scroll-position glitches | Test T-03 + T-04 in CI run; founder retest as final gate |

---

## §13 Founder Dev-Client Verification Protocol

After implementor returns, founder runs these on dev client (no EAS rebuild — Metro hot-reload picks up):

1. **F-01 (Render isolation):** Open dev console. Tap discover, then connections, then home. Expected: 3 logs total (one per tab). NOT 12-18 like pre-Wave-2.8.
2. **F-RP (Scroll restore):** Scroll down on Discover ~50%. Switch to Home. Switch back to Discover. Scroll should be at ~50%, not top.
3. **F-PRES (Filter preservation):** On Saved, type "park" in search. Switch to Likes. Switch back to Saved. Search field should still show "park".
4. **F-REGRESSION (Realtime + collab):** Have a second device send a DM. Confirm it arrives + Connections badge updates while you're on Home.
5. **F-WAVE1 (no regression):** Swipe a card on Home; switch language to Spanish and back.

If F-01 shows 1 log per tap → the felt win is finally landed.
If F-PRES fails → registry write/read logic broken; rework needed.
If F-RP fails → scrollTo + rAF timing issue; rework needed.

---

## §14 Discoveries Surfaced During Spec Writing

- **D-SPEC-1:** HomePage doesn't have a top-level ScrollView; its primary content is SwipeableCards (a deck). Scroll-position registry NOT NEEDED for HomePage. The deck position is already preserved via `deckStateRegistry` in RecommendationsContext (ORCH-0490). **Saves an unnecessary registry key.**
- **D-SPEC-2:** ConnectionsPage has the most local state (~40 useStates) and the most preservation decisions (chat state RESET, panel state PRESERVE). The implementor must read the full file before integrating — there's nuance.
- **D-SPEC-3:** The `pendingOpenDmUserId` mechanism (in app shell, NOT in ConnectionsPage) handles "open this specific chat" navigation. Under Path B, when ConnectionsPage unmounts and remounts, it reads pendingOpenDmUserId on mount and opens the chat. This is already in place — no change needed.
- **D-SPEC-4:** `gcTime: 24 * 60 * 60 * 1000` (24h) means React Query cache survives tab unmount essentially indefinitely for a typical app session. No worry about cache thrash.
- **D-SPEC-5:** ProfilePage's many modal-flag useStates (legalBrowser, bio, interests, accountSettings, billing) are ALL marked RESET. If a user opens a billing sheet, switches to another tab, comes back — the billing sheet is closed. This is correct UX (most users expect modals to dismiss on tab switch). Document this expectation in the implementation report.
- **D-SPEC-6:** The `check-no-inline-map-in-appcontent.sh` gate (Wave 2.7) was modified by the user/linter (per system reminder). The `useMemo` filter logic was split into separate awk blocks. Functionally equivalent, syntactically valid. No change needed in this spec.

---

## §15 What the Implementor MUST NOT Do

- DO NOT roll back any Wave 2/2.5/2.6/2.7 work
- DO NOT touch onboarding files
- DO NOT touch RealtimeSubscriptions.tsx
- DO NOT modify any of the 5 Context Providers (CoachMarkContext, NavigationContext, MobileFeaturesProvider, CardsCacheContext, RecommendationsContext)
- DO NOT touch backend, edge functions, RLS, or migrations
- DO NOT add new external dependencies
- DO NOT defer per-tab integration steps to "follow-up wave" — all 5 tabs must be done in this pass
- DO NOT skip the per-tab read in Step 1 of §11 — missing a useState decision is a regression risk
- DO NOT remove `isTabVisible` prop from tab signatures (keep prop API stable, pass `true` always)
- DO NOT add a useMemo wrapping the IIFE switch — over-engineering; the IIFE is fine

---

**End of spec. Implementor takes over next via DISPATCH from orchestrator.**
