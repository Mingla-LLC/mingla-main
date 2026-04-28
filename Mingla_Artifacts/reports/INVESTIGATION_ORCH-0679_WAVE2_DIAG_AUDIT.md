# Investigation Report — ORCH-0679 Wave 2 Diagnostic Audit

**Mode:** INVESTIGATE
**Date:** 2026-04-26
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0679_ANDROID_PERF_ROUND2.md` (original) + Wave 2/2.5/2.6 implementation reports
**Trigger:** Founder dev-client diagnostic showed memo barrier busted across 5 of 6 tabs after Wave 2/2.5/2.6 landed.
**Confidence:** **HIGH** — root causes proven via direct code reading; runtime evidence from founder corroborates.

---

## §1 Layman Summary

Two separate problems are busting the memo barrier on 5 of 6 tabs, not one. The orchestrator's hypothesis ("`handlers.X` JSX props are unstable — TS-1.5") is correct but incomplete. There's also a SECOND problem: `availableFriendsForSessions` (passed to HomePage) is rebuilt as a fresh array every render via an inline `.map()` that was never wrapped in `useMemo`. Discover is the control case — it has zero `handlers.X` props AND zero inline-computed arrays, which is why its memo barrier holds correctly. The fix needs to address BOTH causes; Wave 2.7 as originally drafted would only fix one.

---

## §2 Symptom (founder dev-client diagnostic, verbatim)

```
[ACTION] Tab pressed: profile
[render-count] HomePage: 47          ← busts every tap
[render-count] ConnectionsPage: 49   ← busts every tap
[render-count] SavedExperiencesPage: 25  ← busts every tap
[render-count] LikesPage: 24         ← busts every tap
[render-count] ProfilePage: 47       ← busts every tap (becoming active)

[ACTION] Tab pressed: home
[render-count] HomePage: 48          ← busts (becoming active — expected)
[render-count] ConnectionsPage: 50   ← busts (NOT expected)
[render-count] SavedExperiencesPage: 26  ← busts (NOT expected)
[render-count] LikesPage: 25         ← busts (NOT expected)
[render-count] ProfilePage: 48       ← busts (NOT expected)

[ACTION] Tab pressed: discover
[render-count] HomePage: 49          ← busts
[render-count] DiscoverScreen: 43    ← becoming active (expected)
[render-count] ConnectionsPage: 51   ← busts
[render-count] SavedExperiencesPage: 27
[render-count] LikesPage: 26
[render-count] ProfilePage: 49
```

**Critical observation:** Discover is THE ONLY tab whose memo barrier holds correctly. It logs only when transitioning into/out of active state. The other 5 log on every tap. **This control case is the diagnostic crown jewel** — it tells us WHAT'S DIFFERENT about Discover that makes it work.

---

## §3 Investigation Manifest

| File | Read | Why | What I found |
|---|---|---|---|
| `app/index.tsx` lines 2528-2643 | YES | Live tab JSX — every prop on every tab | 6 prop tables (§4 below) |
| `app/index.tsx` lines 1009-1019 | YES | `availableFriendsForSessions` source | **Inline `.map()` NOT wrapped in useMemo** — root cause #2 |
| `app/index.tsx` lines 657-686 | YES | `collaborationSessions` source | useMemo-wrapped with `[boardsSessions, user?.id]` deps — STABLE |
| `app/index.tsx` lines 2031-2160 | Already in context | Wave 2A hoist block | All hoists verified correct |
| `src/components/AppHandlers.tsx` lines 23-58, 843+ | YES | Re-confirm Wave 2.5 audit | Confirmed: returns plain object literal at line 843; 21 handlers as plain const, NONE useCallback-wrapped. **TS-1.5 still holds**. |
| `src/components/AppStateManager.tsx` (Wave 2 context) | Already in context | Verify state values are stable refs across non-mutating renders | useState slots are independent — stable until specific setter fires. ✅ |
| 5 Context Providers | Already verified Wave 2 | Confirm useMemo wraps still in place | NavigationContext + MobileFeaturesProvider + CoachMarkContext + CardsCacheContext = wrapped. RecommendationsContext = NOT wrapped (TS-2 deferred). ✅ |
| Zustand `appStore.ts` | Already in context | Selector pattern audit | useAppStore selectors mostly use single-property reads (`useAppStore((s) => s.user)`) — stable. No problematic inline-object selectors. ✅ |

---

## §4 Per-Tab Per-Prop Audit

### HomePage props (line 2530-2562) — busts every tap

| # | Prop | Source | Classification | Notes |
|---|------|--------|----------------|-------|
| 1 | `isTabVisible={currentPage === 'home'}` | inline | STABLE-PRIMITIVE | boolean |
| 2 | `onOpenPreferences={handleOpenPreferences}` | Wave 2A hoist | STABLE-MEMOIZED | useCallback `[setShowPreferences]` |
| 3 | `onOpenCollabPreferences={handleOpenCollabPreferences}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 4 | `currentMode={currentMode ?? "solo"}` | useAppState | STABLE-PRIMITIVE | string |
| 5 | `boardsSessions={boardsSessions}` | useAppState | STABLE-FROM-HOOK | useState ref stable until setBoardsSessions fires |
| 6 | `userPreferences={userPreferences}` | useAppState | STABLE-FROM-HOOK | same |
| 7 | `accountPreferences={accountPreferencesMemo}` | Wave 2A useMemo | STABLE-MEMOIZED | |
| 8 | `onAddToCalendar={handleAddToCalendar}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 9 | `savedCards={savedCards}` | useAppState | STABLE-FROM-HOOK | |
| 10 | `onSaveCard={handlers.handleSaveCard}` | useAppHandlers | **🔴 UNSTABLE-HANDLERS** | TS-1.5 — fresh ref every render |
| 11 | `onShareCard={handlers.handleShareCard}` | useAppHandlers | **🔴 UNSTABLE-HANDLERS** | TS-1.5 |
| 12 | `onPurchaseComplete={handlePurchaseComplete}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 13 | `removedCardIds={removedCardIds}` | useAppState | STABLE-FROM-HOOK | |
| 14 | `onResetCards={handleResetCards}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 15 | `generateNewMockCard={handleGenerateNewMockCard}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 16 | `refreshKey={preferencesRefreshKey}` | useAppState | STABLE-PRIMITIVE | number |
| 17 | `collaborationSessions={collaborationSessions}` | line 657 useMemo | STABLE-MEMOIZED | deps `[boardsSessions, user?.id]` correct |
| 18 | `selectedSessionId={currentSessionId}` | local state | STABLE-PRIMITIVE | |
| 19 | `onSessionSelect={handleSessionSelect}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 20 | `onSoloSelect={handleSoloSelect}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 21 | `onCreateSession={handleCreateSession}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 22 | `onAcceptInvite={handleAcceptInvite}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 23 | `onDeclineInvite={handleDeclineInvite}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 24 | `onCancelInvite={handleCancelInvite}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 25 | `onInviteMoreToSession={handleInviteMoreToSession}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 26 | `onSessionStateChanged={handleSessionStateChangedShowLoading}` | Wave 2A hoist | STABLE-MEMOIZED | |
| 27 | `availableFriends={availableFriendsForSessions}` | line 1009 inline `.map()` | **🔴 UNSTABLE-INLINE-MAP** | **NEW finding — fresh array every render** |
| 28 | `isCreatingSession={isCreatingSession}` | local state | STABLE-PRIMITIVE | boolean |
| 29 | `onNotificationNavigate={handleNotificationNavigate}` | Wave 2.5 useCallback | STABLE-MEMOIZED | |
| 30 | `userId={user?.id}` | useAppStore | STABLE-PRIMITIVE | string |
| 31 | `openSessionId={pendingSessionOpen}` | local state | STABLE-PRIMITIVE | string\|null |
| 32 | `onOpenSessionHandled={handleOpenSessionHandled}` | Wave 2A hoist | STABLE-MEMOIZED | |

**HomePage unstable props: 3 (handlers.handleSaveCard, handlers.handleShareCard, availableFriendsForSessions)**

### DiscoverScreen props (line 2566-2573) — memo HOLDS correctly (control case)

| # | Prop | Source | Classification |
|---|------|--------|----------------|
| 1 | `isTabVisible={currentPage === 'discover'}` | inline | STABLE-PRIMITIVE |
| 2 | `onOpenChatWithUser={handleOpenChatWithUserFromDiscover}` | Wave 2A | STABLE-MEMOIZED |
| 3 | `onViewFriendProfile={handleViewFriendProfile}` | Wave 2A | STABLE-MEMOIZED |
| 4 | `accountPreferences={accountPreferencesMemo}` | Wave 2A | STABLE-MEMOIZED |
| 5 | `preferencesRefreshKey={preferencesRefreshKey}` | useAppState | STABLE-PRIMITIVE |
| 6 | `deepLinkParams={discoverDeepLinkParams}` | Wave 2A useMemo | STABLE-MEMOIZED — flips between null and deepLinkParams ref only when entering/leaving discover |
| 7 | `onDeepLinkHandled={handleDeepLinkHandled}` | Wave 2A | STABLE-MEMOIZED |

**DiscoverScreen unstable props: 0** — explains why memo correctly holds on non-discover-related taps.

### ConnectionsPage props (line 2577-2596) — busts every tap

| # | Prop | Classification |
|---|------|----------------|
| 1-2 | `isTabVisible`, `boardsSessions`, `accountPreferences`, `currentMode`, `openDirectMessageWithUserId`, `initialPanel` | STABLE-PRIMITIVE / STABLE-FROM-HOOK |
| | `onShareSavedCard={handlers.handleShareSavedCard}` | **🔴 UNSTABLE-HANDLERS** |
| | `onRemoveFriend={handlers.handleRemoveFriend}` | **🔴 UNSTABLE-HANDLERS** |
| | `onBlockUser={handlers.handleBlockUser}` | **🔴 UNSTABLE-HANDLERS** |
| | `onReportUser={handlers.handleReportUser}` | **🔴 UNSTABLE-HANDLERS** |
| | `onModeChange={handlers.handleModeChange}` | **🔴 UNSTABLE-HANDLERS** |
| | `onRefreshSessions`, `onUpdateBoardSession`, `onCreateSession`, `onUnreadCountChange`, `onNavigateToFriendProfile`, `onFriendAccepted`, `onOpenDirectMessageHandled`, `onInitialPanelHandled` | STABLE-MEMOIZED |

**ConnectionsPage unstable props: 5 — all handlers.X**

### SavedExperiencesPage props (line 2600-2607) — busts every tap

| Prop | Classification |
|---|---|
| `isTabVisible`, `savedCards`, `isLoading`, `userPreferences` | STABLE |
| `onScheduleFromSaved`, `onPurchaseFromSaved` | STABLE-MEMOIZED |
| `onShareCard={handlers.handleShareCard}` | **🔴 UNSTABLE-HANDLERS** |

**SavedExperiencesPage unstable props: 1 — sufficient to bust**

### LikesPage props (line 2611-2627) — busts every tap

| Prop | Classification |
|---|---|
| `isTabVisible`, `savedCards`, `isLoadingSavedCards`, `isSavedCardsError`, `onRetrySavedCards`, `isLoadingCalendarEntries`, `calendarEntries`, `userPreferences`, `accountPreferences`, `navigationData` | STABLE |
| `onNavigationComplete`, `onPurchaseFromSaved`, `onAddToCalendar`, `onShowQRCode` | STABLE-MEMOIZED |
| `onRemoveFromCalendar={handlers.handleRemoveFromCalendar}` | **🔴 UNSTABLE-HANDLERS** |
| `onShareCard={handlers.handleShareCard}` | **🔴 UNSTABLE-HANDLERS** |

**LikesPage unstable props: 2**

### ProfilePage props (line 2631-2641) — busts every tap

| Prop | Classification |
|---|---|
| `isTabVisible`, `notificationsEnabled`, `userIdentity`, `savedExperiences` (memo'd), `scheduledCount` (memo'd) | STABLE |
| `onSignOut`, `onUserIdentityUpdate`, `onNavigateToConnections` | STABLE-MEMOIZED |
| `onNavigateToActivity={handlers.handleNavigateToActivity}` | **🔴 UNSTABLE-HANDLERS** |
| `onNotificationsToggle={handlers.handleNotificationsToggle}` | **🔴 UNSTABLE-HANDLERS** |

**ProfilePage unstable props: 2**

---

## §5 Findings

### 🔴 RC-1 — `handlers.X` JSX props (TS-1.5)

**File + line:** `app-mobile/src/components/AppHandlers.tsx:843`

**Exact code:**
```ts
return {
  handleModeChange,
  handleSendInvite,
  // ...21 plain const handlers...
};
```

**What it does:** Plain object literal returned every render. None of the 21 contained handlers are `useCallback`-wrapped. Every render of any component that calls `useAppHandlers(state)` produces a fresh object with fresh function references.

**What it should do:** Either wrap each of the 21 handlers in `useCallback` AND wrap the return in `useMemo` (source-level fix), OR provide a stable wrapper at every consumer call site (call-site fix).

**Causal chain:**
1. AppContent re-renders (e.g., on tab tap → `currentPage` change)
2. `useAppHandlers(state)` re-runs → returns fresh object
3. JSX evaluates `<HomePage onSaveCard={handlers.handleSaveCard} ... />` with NEW function ref
4. `React.memo(HomePage)`'s shallow compare detects `onSaveCard` reference changed → bypasses memo → re-renders
5. Same for any tab with at least one `handlers.X` prop (5 of 6 tabs)
6. User-visible: render-storm continues despite Wave 2.

**Verification:** Confirmed by:
- Reading line 843 of AppHandlers.tsx — return is plain object literal (verbatim above)
- Running diagnostic: 5 tabs with `handlers.X` props log on every tap; the only tab WITHOUT `handlers.X` props (Discover) does NOT log on irrelevant taps

**Tab impact:** HomePage (2 props), Connections (5), Saved (1), Likes (2), Profile (2) = 12 instability sites across 5 tabs.

---

### 🔴 RC-2 — `availableFriendsForSessions` inline `.map()` (NEW finding)

**File + line:** `app-mobile/app/index.tsx:1009-1019`

**Exact code:**
```ts
// Transform friends to Friend format for session creation
// dbFriends from useFriends has: id, friend_user_id, username, display_name, first_name, last_name, avatar_url
const availableFriendsForSessions: Friend[] = (dbFriends || []).map((friend: any) => ({
  id: friend.friend_user_id || friend.id,
  name: friend.display_name ||
        (friend.first_name && friend.last_name ? `${friend.first_name} ${friend.last_name}` : null) ||
        friend.first_name ||
        friend.username ||
        'Unknown',
  username: friend.username,
  avatar: friend.avatar_url,
  status: 'offline' as const,
}));
```

**What it does:** Plain `const` declaration inside `AppContent` body. The `.map()` runs on every render (any state change). Returns a fresh array AND fresh object literals for each friend. Every render → new array reference → memo bust on any consumer.

**What it should do:** Wrap in `useMemo` with deps `[dbFriends]`:
```ts
const availableFriendsForSessions = useMemo<Friend[]>(
  () => (dbFriends || []).map((friend: any) => ({ ... })),
  [dbFriends]
);
```

**Causal chain:**
1. AppContent re-renders
2. Line 1009 runs unconditionally → `.map()` produces fresh array + fresh objects
3. JSX `<HomePage availableFriends={availableFriendsForSessions} />` passes new ref
4. `React.memo(HomePage)` detects `availableFriends` changed → bypasses memo → re-renders
5. Independent of RC-1 — would bust HomePage memo even if RC-1 were fixed

**Verification:** Confirmed by reading the source line directly. Wrapping in `useMemo([dbFriends])` returns same array ref when dbFriends is stable, which it is across tab taps (no friend list change).

**Tab impact:** HomePage only (the only tab receiving this prop).

---

### 🟡 HF-1 — `RecommendationsContext` provider value not memoized (TS-2 carryover)

**File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:1737-1781` (~30-property object)

**What it does:** Plain `const value: RecommendationsContextType = { ... };` with ~30 properties. New object every render. Every consumer of `useRecommendations()` re-renders on every Provider render.

**Why HIDDEN FLAW not RC:** None of the 6 tab files DIRECTLY destructure from `useRecommendations()` at the top level (verified — checked tab files in Wave 2 audit). SwipeableCards (a child of HomePage) uses it. So this affects DEEP child re-renders, not top-level tab memo.

**Risk:** Future changes that move `useRecommendations()` to a tab file would resurface this as a tab-level memo bust. Worth fixing eventually (TS-2).

**Tab impact:** Indirect — affects components inside HomePage.

---

### 🔵 OBS-1 — Discover is the diagnostic control case

**Why noteworthy:** DiscoverScreen has zero `handlers.X` props AND zero inline-recomputed array props. It's the ONLY tab whose memo barrier holds correctly across non-discover taps. This is structural confirmation that the orchestrator's hypothesis was on the right track, AND that the audit's per-prop discipline is correct: any tab with even ONE unstable prop busts every render.

**Implication:** After fixing RC-1 + RC-2, the post-fix diagnostic should show ALL 6 tabs behaving like Discover does today.

---

### 🔵 OBS-2 — `<View style={{ flex: 1 }}>` at line 2528

**Why noteworthy but not a defect:** Inline object literal style. Creates a new style ref every render. But this is on a parent View (the tab container wrapper), not on a tab. It doesn't bust tab memo — Views don't have memo barriers. Mentioning for completeness.

---

## §6 Five-Layer Cross-Check

| Layer | Result |
|---|---|
| **Docs** (INVESTIGATION_ORCH-0679_ANDROID_PERF_ROUND2.md, Wave 2.5 report) | Both predicted TS-1.5 (`handlers.X` instability) but neither flagged `availableFriendsForSessions`. Layers AGREE on RC-1, are SILENT on RC-2 → RC-2 is a missed finding from prior investigation. |
| **Schema** | N/A — pure render-tree concern. |
| **Code** | Confirmed both root causes by direct file reading. |
| **Runtime** | Founder diagnostic exactly matches theoretical prediction: 5 tabs (with handlers.X) bust every tap; 1 tab (no handlers.X, no inline maps) holds. |
| **Data** | N/A. |

No layer contradictions. RC-1 + RC-2 fully explain the observed runtime symptom.

---

## §7 Confirm or Refute Orchestrator's Hypothesis

**Orchestrator's hypothesis (Wave 2.7 dispatch):** "The cause is `handlers.X` instability (TS-1.5)."

**Verdict:** **PARTIALLY CORRECT — necessary but NOT sufficient.**

- For 4 of 5 busting tabs (Connections, Saved, Likes, Profile), `handlers.X` IS the sole unstable prop. Wave 2.7 as drafted would fully fix those.
- For HomePage, `handlers.X` is one of THREE unstable props. Even if Wave 2.7 wrapped both `handlers.handleSaveCard` and `handlers.handleShareCard` perfectly, HomePage's memo would STILL bust on every render because `availableFriendsForSessions` rebuilds inline.

**If Wave 2.7 had shipped without this audit:** founder diagnostic would have shown 4 tabs go quiet (Connections, Saved, Likes, Profile) but HomePage would still log on every tap. Orchestrator would scratch their head, do another forensic, find RC-2, ship Wave 2.8. **The audit saved one ship cycle.**

---

## §8 Fix Strategy Recommendation

**Recommended: Strategy C (Hybrid) — both root causes, fix-at-call-site for RC-1 + targeted useMemo for RC-2.**

### Strategy details

**For RC-1 (handlers.X):** Call-site `useCallback` wrappers using `handlersRef.current` pattern. Same as orchestrator's Wave 2.7 dispatch.
- ~10 wrappers to add (handleSaveCard, handleShareCard, handleShareSavedCard, handleRemoveFriend, handleBlockUser, handleReportUser, handleModeChange, handleRemoveFromCalendar, handleNavigateToActivity, handleNotificationsToggle)
- ~12 JSX prop replacements
- Empty dep arrays (handlersRef captures latest)
- Effort: ~30 min
- Risk: LOW (Wave 2.5 used this pattern successfully)

**For RC-2 (availableFriendsForSessions):** Single `useMemo` wrap at app/index.tsx:1009.
- Add `useMemo<Friend[]>(() => ..., [dbFriends])` around the existing `.map()`
- Effort: ~5 min
- Risk: LOW (mechanical change)

**Out of scope for this fix:**
- TS-1.5 source-level fix (full `useAppHandlers` stabilization) — too large for this wave; defer to follow-up
- TS-2 (RecommendationsContext memoization) — affects deep children, not tab memo
- ORCH-0680 (PopularityIndicators conditional hook) — separate file, separate concern

### Why NOT Strategy B (source-level fix)
Stabilizing `useAppHandlers` in-place requires wrapping 21 handlers + return in useMemo. Each handler has its own closure deps. ~3-5 hours of careful work. Wide blast radius (every consumer of useAppHandlers across the entire app, not just the 6 tabs). High regression risk for closure-capture mistakes. The hybrid call-site fix achieves identical user-felt behavior with 1/10 the effort and risk. The architectural debt (god-hook) remains, but is now isolated and bypassed where it matters.

### Verification gate (post-fix runtime)

Re-run founder F-01 diagnostic:
- Tap any tab → 0-1 `[render-count]` logs (was 5-6)
- Discover continues to behave correctly (control unchanged)
- Tap a tab twice (revisit) → 0 logs

If post-fix shows >1 log per tap: there's a third unstable prop I missed. Investigate further before shipping.

---

## §9 Regression Prevention

For RC-2 specifically: add a CI gate that detects `const X = (...).map(...)` or `const X = (...).filter(...)` declarations inside AppContent body that aren't wrapped in `useMemo`. Example pattern:

```bash
# check-no-inline-map-in-appcontent.sh
awk 'NR>=144 && NR<=2160 && /^  const .* = (.*\.map\(|.*\.filter\(/ && !/useMemo/ {
  print FILENAME ":" NR ": " $0
}' app/index.tsx
```

(Region scope: AppContent body lines 144-2160 — excludes the JSX render block which has many legitimate `.map()` calls.)

For RC-1: the new I-HANDLERS-X-STABLE invariant (proposed in Wave 2.7 spec) covers it.

---

## §10 Discoveries for Orchestrator

- **D-AUDIT-1 (already known):** TS-1.5 (full useAppHandlers stabilization) remains deferred. The hybrid fix bypasses but doesn't resolve this architectural debt.
- **D-AUDIT-2:** TS-2 (RecommendationsContext memoization) is a **deep-children** concern, not tab-level. Reclassify priority — it doesn't block the founder-felt win.
- **D-AUDIT-3 (NEW):** `<View style={{ flex: 1 }}>` at app/index.tsx:2528 is an inline object literal style. Doesn't bust memo (no consumer is memo-wrapped) but is a pattern violation worth cleaning up. P3.
- **D-AUDIT-4 (NEW):** Audit found ZERO Zustand selector pattern issues — all selectors use single-property reads. The Wave 2 + 2.5 + 2.6 work is structurally sound at the Zustand layer.
- **D-AUDIT-5 (NEW):** `availableFriendsForSessions` rebuild has been there since at least the original Wave 2 work and was missed in the prior audit. Suggests we should sweep AppContent for OTHER similar inline computations as a one-time hardening pass. The CI gate proposed in §9 should run on the existing code first to surface any siblings.

---

## §11 Confidence Level

**HIGH.** Why:
- Both root causes confirmed by direct file reading at exact line numbers.
- Runtime evidence (founder diagnostic) precisely matches the theoretical prediction (Discover holds, others bust).
- Per-tab per-prop audit is exhaustive — every prop classified with verification method.
- The Discover control case is structural confirmation, not just correlation.

**What would lower confidence:** if a post-fix retest shows >1 log per tap. That would mean a third unstable prop I missed. The §9 CI gate is the safety net.

---

## §12 Recommended Next Step

Hand to orchestrator. Orchestrator should:
1. Update Wave 2.7 implementor dispatch to ALSO include the RC-2 fix (one-line `useMemo` wrap at line 1009).
2. Optionally add the §9 CI gate (`check-no-inline-map-in-appcontent.sh`) to catch siblings during the same wave.
3. Skip a separate spec — the fix is mechanical enough that the augmented dispatch suffices.

---

**End of investigation. Two root causes proven. Fix strategy recommended. Confidence HIGH.**
