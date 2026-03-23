# Launch Hardening Execution Plan — V3 (Permanent-Solutions Standard)

> **Date:** 2026-03-23
> **Revision:** V3 — final tightening: Pass 5 tier exception list, Pass 6 repo-wide verification gate, Pass 10 exit criterion
> **Source evidence:** ARCHITECTURE_REVIEW_BLOCK_STATE.md, INVESTIGATION_ASYNC_BLOCKING_UI.md, INVESTIGATION_STATE_OWNERSHIP_AUDIT.md
> **Total issues tracked:** 42
> **Passes:** 12 (Pass 0 through Pass 10)
> **Standard:** Permanent architectural correction — not "good enough for launch"

---

## 1. Executive Summary: What Was Weak in V1

The original plan was operationally correct — every issue was assigned to a pass and the fixes were sound. But it had five structural weaknesses:

**1. No invariants.** Passes described what to change but not what contract they enforce. Without a stated invariant, there's no way to certify "this domain is permanently correct" — only "the bug I tested seems gone."

**2. Additive bias.** The plan added utilities, handlers, and subscriptions but didn't explicitly require removal of the old code paths, dead state, and duplicate ownership that caused the problems. Layering new logic on bad architecture is how you get the next round of bugs.

**3. Passes too broad.** Pass 7 (notifications/badges/realtime) and Pass 9 (25+ mutations + offline queue + dead store) were too large to certify confidently. A failure in the offline queue fix would block shipping the mutation error sweep — different blast radii, different rollback units.

**4. No certification gates.** A pass was "done" when the bug disappeared. But "bug gone" is not "domain correct." Missing: source-of-truth verification, competing-owner removal, logout/user-switch cleanup, race-condition audit, background/resume validation.

**5. Ambiguity about what's permanent vs. transitional.** Some fixes (like "reduce staleTime to 60s" for subscription tier) are bounded tactical improvements, not full architectural corrections. V1 didn't label these honestly. Stale time reduction buys time; it doesn't eliminate the root cause.

**6. Service-layer masking unaddressed.** The `null/[]` return pattern across 6+ services was left as "remaining risk" with no clear disposition. This is the deepest silent-failure vector in the app and needs an explicit decision.

**7. Missing lifecycle audits.** Passes touching realtime subscriptions, persisted state, and cached data didn't explicitly require logout, user-switch, background/resume, and reconnect validation.

---

## 2. Revised Pass Structure

| Pass | Domain | Issues | Shippable Independently? |
|------|--------|--------|--------------------------|
| 0 | Shared infrastructure | 3 | Yes — pure utilities, no behavioral change |
| 1 | Chat & conversation responsiveness | 3 | Yes — scoped to ConnectionsPage + blockService |
| 2 | Board exit, friend accept, onboarding skip | 3 | Yes — three independent interaction fixes |
| 3 | Discover retry, pull-to-refresh, session expiry | 3 | Yes — three independent fixes |
| 4 | Onboarding preferences atomic save | 1 (large) | Yes — scoped to OnboardingFlow + preferencesService |
| 5 | Subscription tier + purchase hardening | 3 | Yes — scoped to subscription/RevenueCat domain |
| 6 | Query key consolidation + dead ownership removal | 4 | Yes — but must ship as one unit (keys + invalidation) |
| 7 | Realtime subscriptions, badges, unread counts + lifecycle | 5 | Yes — but requires lifecycle audit before code |
| 8 | Preferences, profile, filter authority + authority map | 5 | Yes — but authority map is a gate before code |
| 9A | Mutation error handling sweep | 2 (25+ mutations + 35+ catches) | Yes — additive onError handlers, low blast radius |
| 9B | Offline queue + dead store cleanup | 2 | Yes — scoped to realtimeService + appStore |
| 10 | Service-layer masked error containment | 1 (systemic) | Transitional — partial fix with documented remainder |

---

## 2.1. Universal Pass Stop Condition

**This rule applies to every pass without exception.**

When the Implementor begins a pass, the first required action is a forensic code read of every file in that pass's scope. If that read reveals that the actual source-of-truth model, ownership model, data flow, or failure behavior **differs materially** from what this plan assumes, the Implementor must:

1. **Stop implementation immediately.** Do not force execution against a broken mental model.
2. **Produce a correction note** to `outputs/CORRECTION_NOTE_PASS_<N>.md` documenting:
   - What the plan assumed
   - What the code actually does
   - Why the difference is material (not just a naming discrepancy)
   - Whether the pass's fix approach is still valid, needs adjustment, or is invalid
   - Recommended revised approach (if the original is invalid)
3. **Return the correction note to Launch Hardener for review.** Do not proceed with code changes until Launch Hardener reviews and either:
   - Confirms the original approach is still valid (with explanation), or
   - Issues a revised pass specification

**"Material difference" means:** The plan says state is owned by X, but it's actually owned by Y. The plan says data flows through path A, but it actually flows through path B. The plan says a function is called in context C, but it's actually called in context D. The plan says a file/hook/field exists, but it doesn't (or vice versa).

**"Non-material difference" means:** A variable is named differently than expected. A line number has shifted. An implementation detail differs but the ownership model and data flow match the plan.

The Implementor should use judgment but err on the side of stopping. A correction note that turns out to be unnecessary costs 10 minutes. Forcing execution against a wrong mental model costs a broken pass and a rollback.

---

## 3. Detailed Pass Specifications

---

### Pass 0: Shared Infrastructure

**Goal:** Build the three utilities that all subsequent passes depend on. No behavioral changes to the app.

**Issues included:**
- 0a: No reusable `withTimeout()` utility
- 0b: No shared mutation error toast
- 0c: No centralized query-key factory pattern

**Invariant before:** No standard patterns for timeouts, mutation errors, or query keys. Each developer invents their own.
**Invariant after:** Every RPC/function call near a user action MUST use `withTimeout()`. Every mutation MUST use the standard error contract. Every domain entity MUST have one query-key factory.

**Authority / source-of-truth model:** N/A — these are utilities, not state owners.

**Code to remove:** None in this pass. Removal of old patterns happens in the passes that adopt these utilities.

**Migration shape:**
- Create `app-mobile/src/utils/withTimeout.ts`
- Create or extend toast utility for mutation errors (must first audit existing toast system)
- Create `app-mobile/src/hooks/queryKeys.ts` — audit existing `useFriendsQuery.ts` key factory first; extend if it exists, don't duplicate
- No components change in this pass

**Risk / blast radius:** Zero — pure additions. No existing code changes.
**Rollback unit:** Revert the 2-3 new files.
**Highest-risk regression:** None.
**Required smoke tests:** Import and call each utility in isolation. Verify TypeScript compiles.

**Certification gates:**
- [ ] `withTimeout` handles resolve, reject, and timeout cases
- [ ] Error toast extracts user-friendly messages from Supabase, RPC, and network errors
- [ ] Query-key factories cover: savedCards, personCards, friends (including blocked, requests)
- [ ] Existing `useFriendsQuery.ts` key factory audited — extended or replaced, not duplicated
- [ ] No existing code modified

**Why this is permanent:**
- **Before:** No patterns. Each call site invents timeout, error handling, and key structure.
- **After:** Three enforced contracts. Future code uses these or violates the standard.
- **Root cause removed:** Inconsistent infrastructure that enabled the 25+ missing onError, the 0/42 timeouts, and the 3-key-for-one-entity problems.
- **Not symptom treatment because:** These are the building blocks. Without them, every subsequent pass would re-invent solutions.

**Race-condition audit:** N/A — no async state.
**Logout/user-switch check:** N/A.
**Background/resume check:** N/A.
**Depends on refetch as consistency tool:** No.

---

### Pass 1: Chat & Conversation Responsiveness

**Goal:** Eliminate all remaining network-gated delays in the conversation open flow. The block-state chat-tap fix is already applied — this pass handles new-conversation open and first-time message fetch.

**Issues included:**
- 1a: New conversation open blocked on getOrCreate + block check (P0)
- 1b: First-time chat open blocked on message fetch — no cache (P0)
- 1c: Block-status RPC has no timeout (P2)

**Invariant before:** Opening a conversation requires 1-3 network calls to complete before the user sees anything.
**Invariant after:** No conversation open flow waits on any network call before showing the chat UI. All network work happens after the UI transition.

**Authority / source-of-truth model:**
- Block state authority: React Query cache (synchronous lookup). Server is enforcement authority (RLS).
- Conversation existence authority: Server. Client uses optimistic/loading UI while creation is in-flight.
- Message content authority: Server via React Query. Client shows empty/loading state while fetching.

**Code to remove:**
- Remove the `await blockService.hasBlockBetween()` call from `handlePickFriend` (line 718) — replace with cached lookup
- Remove the `await messagingService.getMessages()` from the critical path before `setShowMessageInterface(true)` (line 664-683)
- Remove any remaining `await` calls that gate `setShowMessageInterface(true)`

**Migration shape:**
- **Current:** `handlePickFriend`: close picker → await block check → await getOrCreate → show chat
- **Target:** `handlePickFriend`: close picker → show chat with loading skeleton → fire block check (cached) + getOrCreate (background) → update state when resolved → error toast if failed
- **Current:** `handleSelectConversation` (no cache): await message fetch → show chat
- **Target:** show chat immediately → fetch messages in background → populate when ready
- **Cleanup:** Apply `withTimeout(5000)` to `hasBlockBetween()` and `isBlockedByUser()` in `blockService.ts`

**Risk / blast radius:** Scoped to `ConnectionsPage.tsx` and `blockService.ts`. Does not touch MessageInterface internals.
**Rollback unit:** Revert ConnectionsPage.tsx + blockService.ts changes.
**Highest-risk regression:** Chat opens with stale or missing block state. Mitigated by: server RLS enforces at send time regardless.
**Required smoke tests:**
1. Open existing conversation (cached messages) — instant
2. Open existing conversation (no cache) — instant with loading
3. Start new conversation from friend picker — instant with loading
4. Start new conversation on slow network — loading state visible, error toast if fails
5. Open conversation with a blocked user — banner appears (from cache or background check)

**Certification gates:**
- [ ] Source of truth identified: block = RQ cache, conversation = server, messages = server
- [ ] Competing owners removed: no `await` on block RPC in any UI-gating path
- [ ] Failure path modeled: getOrCreate fails → error toast + close chat; message fetch fails → empty chat with retry
- [ ] Regression surface checked: existing chat-tap fix still works, block banner still appears
- [ ] Background/resume: conversation open works after app resume (no stale connection blocking)
- [ ] Cross-screen consistency: N/A for this pass
- [ ] Stale async / race conditions: block check background result arriving after user already navigated away — must check component still mounted
- [ ] Code removal completed: all pre-UI `await` calls removed from conversation open paths

**Why this is permanent:**
- **Before:** UI transition gated on 1-3 network calls. Dead taps when network is slow/stale.
- **After:** UI transition is synchronous. Network work is background-only. Timeouts prevent indefinite hangs.
- **Root cause removed:** The architectural pattern of "check-then-act" in tap handlers. Not patched — eliminated.
- **Competing ownership eliminated:** Block status no longer has two paths (cached vs. RPC at tap time).

**Race-condition audit:** Background block check result arriving after component unmount — must guard with mounted check or cleanup.
**Logout/user-switch check:** Block cache is per-user via React Query key — switches correctly.
**Background/resume check:** This is the primary scenario. Verified by smoke test #5 from existing fix.
**Depends on refetch as consistency tool:** No — uses cached state for UI, server for enforcement.
**Independently shippable:** Yes.

---

### Pass 2: Board Exit, Friend Accept, Onboarding Skip

**Goal:** Eliminate frozen-button behavior on three critical user actions.

**Issues included:**
- 2a: Board exit blocked on 4 sequential DB operations (P1)
- 2b: Friend accept blocked on 3 sequential fetches (P1)
- 2c: Onboarding skip blocked on Supabase write (P1)

**Invariant before:** Tapping these buttons awaits network work before any visual feedback. Buttons freeze for 1-5 seconds.
**Invariant after:** Every primary action button produces immediate visual feedback (optimistic UI or modal close) within one frame. Network work happens after.

**Authority / source-of-truth model:**
- Board participation: Server (via `session_participants`, `board_collaborators`, `collaboration_invites`). Client uses optimistic removal.
- Friend list: Server (via `friends` table). Client uses optimistic removal of request + background refetch.
- Onboarding completion: Server (via `profiles` table). Skip action proceeds locally; server sync is fire-and-forget with retry.

**Code to remove:**
- Remove sequential `await` chain in `SessionViewModal.tsx:315-367` — replace with modal close + background `Promise.all`
- Remove sequential `await loadFriendRequests()` + `await fetchFriends()` from `handleAcceptRequest` — replace with optimistic update + parallel background refetch
- Remove `await supabase.from('profiles').update()` from skip button critical path — move to background

**Migration shape:**
- **Board exit current:** Alert onPress → await delete participant → await lookup board → await delete collaborator → await update invites
- **Board exit target:** Alert onPress → close modal immediately → background Promise.all([all 4 ops wrapped in withTimeout]) → toast on success/failure
- **Friend accept current:** await accept → await loadRequests → await fetchFriends
- **Friend accept target:** optimistic remove from list → await accept → parallel [loadRequests, fetchFriends] in background → on error: rollback + toast
- **Onboarding skip current:** await profile update → clearOnboardingData → onComplete
- **Onboarding skip target:** onComplete immediately → background profile update with withTimeout + 1 retry

**Risk / blast radius:** Three independent fixes in three files. Each can be rolled back independently.
**Rollback unit:** Per-file revert.
**Highest-risk regression:**
- Board exit: cleanup fails silently → user still appears as participant to others. Mitigated by error toast.
- Friend accept: optimistic removal then server rejects → must rollback UI. Mitigated by `onError` rollback.
- Skip: profile update fails → user has default preferences. Acceptable for skip path.

**Required smoke tests:**
1. Exit board on good network → instant close, cleanup completes
2. Exit board on slow network → instant close, toast appears later
3. Accept friend request → request disappears immediately, friend appears in list
4. Accept friend request offline → request disappears, then reappears with error toast
5. Skip onboarding → proceeds immediately regardless of network

**Certification gates:**
- [ ] Source of truth: server for all three. Client is optimistic only.
- [ ] Competing owners removed: no dual await-then-update paths
- [ ] Failure path modeled: each background operation has error toast
- [ ] Regression surface: board exit still removes participant; friend accept still adds friend; skip still completes onboarding
- [ ] Background/resume: N/A (these are user-initiated actions, not resume-dependent)
- [ ] Cross-screen consistency: friend accept must invalidate `friendsKeys.all` (entire family, not partial)
- [ ] Stale async / race conditions: optimistic update then error → rollback timing
- [ ] Code removal: sequential await chains removed from all three handlers

**Why this is permanent:**
- **Before:** Alert/button handlers await network work. No loading state possible in Alert.alert.
- **After:** Handlers produce immediate UI change. Network work is decoupled.
- **Root cause removed:** The pattern of "do everything synchronously in the tap handler." Replaced with "optimistic UI + background work."
- **Not symptom treatment because:** The sequential-await pattern is eliminated, not wrapped in a timeout.

**Race-condition audit:** Optimistic removal of friend request + server rejection = must rollback. Board exit optimistic close + 4-op failure = must show error toast (user already left the screen).
**Logout/user-switch check:** N/A — these are user-initiated actions within a session.
**Depends on refetch as consistency tool:** Friend accept uses `invalidateQueries` for cross-screen sync after background work. This is acceptable because the optimistic update provides immediate correctness, and invalidation is a consistency guarantee, not the primary mechanism.
**Independently shippable:** Yes.

---

### Pass 3: Discover Retry, Pull-to-Refresh, Session Expiry

**Goal:** Fix three independent interaction/lifecycle issues.

**Issues included:**
- 3a: Discover retry blocked on GPS + cache clear before loading shows (P3)
- 3b: Pull-to-refresh silently broken — stale closure in CalendarTab + SavedTab (P1)
- 3c: Silent forced sign-out after long background (P2)

**Invariant before:** Loading states appear after slow work starts. Stale closures silently break refresh. Session expiry dumps user to login with no explanation.
**Invariant after:** Loading states appear before any async work. All useCallback/useMemo dependency arrays are complete. Session expiry always shows a user-facing message before sign-out.

**Authority / source-of-truth model:**
- Discover loading state: Component-local. Must be set FIRST in handler.
- Calendar/saved query keys: React Query. User ID must be current (not stale closure).
- Auth session: Supabase Auth. 401 counter is a heuristic detector, not a source of truth.

**Code to remove:**
- Remove the ordering that puts `await clearNightOutCache()` before `setNightOutLoading(true)` in DiscoverScreen retry handler
- No code removal for 3b — this is a dependency array fix
- No code removal for 3c — this is additive (toast + grace period)

**Migration shape:**
- **Discover retry:** Move `setNightOutLoading(true)` to line 1 of handler. Move cache clear after.
- **Pull-to-refresh:** Add `user?.id` to both useCallback dependency arrays. Audit both files for other missing deps.
- **Session expiry:** Before `supabase.auth.signOut()` in queryClient.ts:69-76, show toast "Session expired — please sign in again." Add 3-second grace period after resume before counting 401s. Hold query refetches until auth refresh attempt completes (or times out).

**Risk / blast radius:** Three independent changes in three different files.
**Rollback unit:** Per-file revert.
**Highest-risk regression:** 3c — changing the 401 counter logic could prevent legitimate zombie-auth detection. Must preserve the counter's purpose while making it smarter.

**Required smoke tests:**
1. Discover retry → spinner appears immediately
2. Pull-to-refresh Calendar tab → data actually updates
3. Pull-to-refresh Saved tab → data actually updates
4. Background app 30+ minutes, resume on good network → normal operation
5. Background app 30+ minutes, resume on bad network → "Session expired" message before sign-out
6. Background app 5 minutes, resume → no forced sign-out (transient 401s don't trigger)

**Certification gates:**
- [ ] Source of truth: auth = Supabase Auth, not 401 counter heuristic
- [ ] Failure path modeled: session truly expired → toast → sign-out. Session temporarily stale → grace period → recovery.
- [ ] Regression: zombie auth detection still works (just smarter)
- [ ] Background/resume: primary scenario for 3c. Tested explicitly.
- [ ] Stale async / race conditions: 3b stale closure eliminated. 3c race between auth refresh and query refetch addressed by holding queries.
- [ ] Code removal: stale ordering in discover retry removed

**Why this is permanent:**
- **3a:** Loading-state-first is a rule, not a fix. The ordering is corrected.
- **3b:** Dependency arrays are correct. Would be permanently enforced if `exhaustive-deps` lint rule is enabled (recommended but not required in this pass).
- **3c:** Session expiry UX is a permanent architectural decision: always tell the user before signing them out. Grace period prevents the specific race condition.

**Race-condition audit:** 3c — auth refresh racing with focusManager query refetches. Fix: hold refetches until auth refresh completes or times out.
**Logout/user-switch check:** 3c directly involves sign-out. Must verify toast appears before navigation to login.
**Depends on refetch as consistency tool:** 3b depends on `invalidateQueries` for refresh — but this is the correct use (user-initiated refresh). The fix ensures it targets the right query key.
**Independently shippable:** Yes.

---

### Pass 4: Onboarding Preferences — Atomic Save

**Goal:** Replace 13 silent fire-and-forget preference writes with one atomic save that the user can see succeed or fail.

**Issues included:**
- 4a: 13 onboarding preference writes silently swallow failures (P0)

**Invariant before:** Preference writes during onboarding can fail silently. User arrives at Discover with defaults, no indication anything went wrong.
**Invariant after:** Onboarding preferences are saved exactly once, atomically, at completion. If the save fails, the user sees a retry prompt and does NOT proceed to Discover. No preference write may fail silently during onboarding.

**Authority / source-of-truth model:**
- During onboarding: local component state is the working copy. No server writes until completion.
- At completion: single atomic server write. Server becomes the authority.
- After completion: React Query fetches from server. AsyncStorage caches for offline fallback.

**Code to remove:**
- Remove all 13 `.catch(() => {})` preference writes from `OnboardingFlow.tsx` (lines 1240, 1245, 1299, 1403, 1430, 1460, 1530, 1596, 1719, 1722, 1736, 1749, 1757)
- Remove any mid-flow calls to `PreferencesService.updateUserPreferences()` — they all go
- Fix `PreferencesService.updateUserPreferences()` inner try/catch that returns `true` on error — this masked error must surface

**Migration shape:**
- **Current:** Each onboarding step writes preferences to server immediately via `PreferencesService.updateUserPreferences().catch(() => {})`. 13 writes, 13 silent failures possible.
- **Target:**
  1. Each onboarding step updates local state only (React state or ref)
  2. At the final completion step, collect all preferences into one object
  3. Call a new `saveAllOnboardingPreferences(prefs)` method — single server write
  4. If it fails: show error UI with retry button. Block progression.
  5. If it succeeds: proceed to Discover. Invalidate preference React Query cache.
- **Cleanup:**
  1. Remove all 13 mid-flow server writes
  2. Fix `PreferencesService.updateUserPreferences()` to throw on error (or return `{success: false, error}`) instead of silently returning `true`
  3. Verify no onboarding step reads server preferences mid-flow (if so, use local state)
- **Verification:** Complete onboarding → preferences match selections in Discover. Kill app mid-onboarding → resume from correct step with local state intact.

**Risk / blast radius:** Scoped to `OnboardingFlow.tsx` and `preferencesService.ts`. High importance — first-use experience.
**Rollback unit:** Revert both files.
**Highest-risk regression:** Onboarding flow breaks entirely if the new atomic save has a bug. Must test every step permutation.

**Required smoke tests:**
1. Complete full onboarding with all preferences set → arrive at Discover with correct cards
2. Complete onboarding with network failure at save step → retry prompt appears, does not proceed
3. Complete onboarding, retry succeeds → proceeds normally
4. Kill app mid-onboarding, reopen → resumes from correct step
5. Skip a preference step → default value used, still saves atomically

**Certification gates:**
- [ ] Source of truth: local state during onboarding, server after completion
- [ ] Competing owners removed: no more 13 independent server writes
- [ ] Failure path modeled: save fails → retry UI → user cannot proceed with stale defaults
- [ ] Regression: every onboarding step still works, preferences still save
- [ ] Background/resume: app kill mid-onboarding → correct resume behavior
- [ ] Stale async / race conditions: no race — single write at completion
- [ ] Code removal: 13 `.catch(() => {})` calls removed. `PreferencesService` masked error fixed.

**Why this is permanent:**
- **Before:** 13 independent writes, each silently swallowable. Failure probability compounds.
- **After:** 1 atomic write with error UI. Binary outcome: saved or not, user knows which.
- **Root cause removed:** The pattern of "write eagerly, swallow errors." Replaced with "collect locally, write once, confirm."
- **Not symptom treatment because:** The 13 individual writes are gone, not wrapped in better error handling.

**Race-condition audit:** None — single write at a defined point.
**Logout/user-switch check:** N/A — onboarding is a one-time flow per account.
**Depends on refetch as consistency tool:** After save, invalidates preference React Query cache. This is correct — the server write just happened, so refetch gets the confirmed truth.
**Independently shippable:** Yes.

---

### Pass 5: Subscription Tier & Purchase Hardening

**Goal:** Ensure the subscription tier is never wrong for more than 60 seconds, and purchase/sync flows handle failure visibly.

**Issues included:**
- 5a: Subscription tier 5-min stale window — expired trial shows Elite UI (P0)
- 5b: RevenueCat purchase mutations missing onError (P0)
- 5c: Subscription sync after purchase is fire-and-forget (P0)

**Invariant before:** Tier can be wrong for 5 minutes. Purchase failures are invisible. Sync failures are swallowed.
**Invariant after:** Tier staleness is bounded to 60 seconds. Purchase failures show user feedback. Sync failures retry with user-visible "verifying" state. No gated action proceeds on stale tier without revalidation.

**Authority / source-of-truth model:**
- Subscription tier authority: Server (edge function checks). RevenueCat is the payment authority. Supabase `subscriptions` table is the persisted record.
- Client tier: `useEffectiveTier()` — takes highest of 3 sources. This "take highest" model is a **known transitional weakness**. The permanent fix would be a single server RPC that returns the canonical tier. For this pass: reduce staleTime to 60s + add expiry-aware revalidation. **Label: Transitional** for the multi-source model, **Permanent** for the staleTime + expiry + error handling.

**Code to remove:**
- Remove `.catch(() => {})` from `CustomPaywallScreen.tsx:159,176` — replace with tracked sync
- No removal for onError additions (additive)

**Migration shape:**
- **5a Current:** Three 5-min caches, take highest, no expiry awareness
- **5a Target:** Three 60-sec caches, take highest, BUT: if any source includes `expires_at` and `now > expires_at`, force immediate refetch before returning. Add `tier_expires_at` to the unified result.
- **5b Current:** 4 mutations with no onError
- **5b Target:** 4 mutations with onError using shared toast. User-cancel detection (RevenueCat error code) → no toast.
- **5c Current:** `syncSubscriptionFromRC().catch(() => {})`
- **5c Target:** Tracked sync with "Verifying purchase..." UI. 3 retries. If all fail: "Purchase successful — please restart if features don't appear."

**Risk / blast radius:** Subscription domain only. Does not touch card serving, onboarding, or social features.
**Rollback unit:** Revert subscription hooks + CustomPaywallScreen.
**Highest-risk regression:** StaleTime reduction causes excessive API calls to RevenueCat. Must verify RC SDK has its own caching layer.

**Required smoke tests:**
1. Active subscription → correct tier shown
2. Trial expires → tier downgrades within 60s (not 5 min)
3. Purchase succeeds + sync succeeds → paid features available
4. Purchase succeeds + sync fails → "Verifying..." shown, retry works
5. Purchase cancelled by user → no error toast
6. Purchase fails (payment issue) → error toast shown
7. Gated action on expired trial → revalidation fires, action rejected

**REQUIRED ARTIFACT: Tier Authority Exception List**

Before this pass is certified, the Implementor must produce `outputs/TIER_AUTHORITY_EXCEPTION_LIST.md` documenting:

1. **Where stale tier can still mislead UI.** List every screen, component, or gated action that reads `useEffectiveTier()` and could show paid UI to a free/expired user during the 60-second stale window. For each, state whether the misleading UI is cosmetic-only (e.g., badge color) or actionable (e.g., button that leads to a server-rejected action).

2. **Which actions MUST force revalidation before proceeding.** List every user action that is gated by tier (e.g., "start collab session," "generate cards," "access Elite filter") and state whether it currently forces a fresh tier check or relies on cache. Any action that could result in a server rejection after the client showed a green light MUST force revalidation. This list is exhaustive — if an action is not listed, it is assumed to not be tier-gated.

3. **Which screens may temporarily show optimistic paid state.** After a purchase, the client may show paid UI before server sync confirms. List which screens show this optimistic state and how long the window lasts. For each, state what happens if sync fails (does the UI revert? does it stay wrong?).

4. **Exact remaining risk until a single server-authoritative tier RPC exists.** In plain English, describe the worst-case user experience that is still possible after this pass. Example: "A user whose trial expired 45 seconds ago taps Generate Cards. The client shows the generation UI. The edge function rejects. The user sees an error toast. This window is 60 seconds maximum, down from 5 minutes."

This artifact is a **certification gate**. Launch Hardener reviews it before Pass 5 is certified complete.

**Certification gates:**
- [ ] Source of truth: server edge function is the ultimate authority
- [ ] Competing owners: three sources remain (transitional) but bounded to 60s staleness
- [ ] Failure path modeled: purchase fail → toast; sync fail → retry + message; expired tier → revalidation
- [ ] Background/resume: tier refetches on resume (already in CRITICAL_QUERY_KEYS)
- [ ] Logout/user-switch: RevenueCat logout mutation now has onError; subscription cache invalidated on logout
- [ ] Code removal: silent catches removed from sync
- [ ] Tier Authority Exception List completed (`outputs/TIER_AUTHORITY_EXCEPTION_LIST.md`) and reviewed

**Why this is permanent (and what isn't):**
- **Permanent:** Error handling on purchase/sync flows. Expiry-aware revalidation. 60s staleTime.
- **Transitional:** The "take highest of 3 sources" model. True permanent fix = single server-authoritative tier RPC. This is documented as a future architecture item.
- **Root cause partially removed:** The 5-min stale window is reduced to 60s and expiry-aware. The multi-source authority confusion is contained but not eliminated.

**Race-condition audit:** Purchase mutation firing while sync is in-flight → sync should be sequenced after purchase completes.
**Logout/user-switch check:** RevenueCat logout + subscription cache invalidation required.
**Depends on refetch as consistency tool:** Yes — staleTime + refetch is still the consistency mechanism. Transitional. Event-driven invalidation (webhook or realtime) would be the permanent solution.
**Independently shippable:** Yes.

---

### Pass 6: Query Key Consolidation + Dead Ownership Removal

**Goal:** Ensure every important domain entity has exactly one query-key family and one invalidation target. Remove all duplicate ownership.

**Issues included:**
- 6a: Saved cards cached under 3 different query keys (P1)
- 6b: Person hero cards cached under 2 different keys (P1)
- 6c: Blocked users — two implementations coexist (P1)
- 6d: Friends list partial invalidation on accept/decline (P2)

**Invariant before:** Same entity cached under multiple unrelated keys. Mutation invalidates one, others stay stale. Screens disagree.
**Invariant after:** One entity = one key factory. Every mutation that changes an entity invalidates the shared key prefix. No duplicate ownership for any entity.

**Authority / source-of-truth model:**
- Saved cards: Server → React Query under `savedCardKeys.all` prefix → consumed by all components
- Person hero cards: Server → React Query under `personCardKeys.all` prefix → consumed by all components
- Blocked users: Server → React Query under `friendsKeys.blocked()` → consumed by all components. No other implementation.
- Friends: Server → React Query under `friendsKeys.all` prefix → consumed by all components

**Code to remove:**
- Old `useBlockedUsers.ts` (useState + AsyncStorage based) — DELETE ENTIRE FILE if no remaining consumers (migrate consumers first)
- `blockedUsers: []` from Zustand store initial state in `appStore.ts`
- Old query key string literals that are now replaced by factory functions (in all hook files + all mutation invalidation calls)
- Any direct `queryClient.invalidateQueries({queryKey: ["savedCards", ...]})` that doesn't use the factory

**Migration shape:**

**Saved cards:**
- Current: 3 keys — `["savedCards", userId]`, `["pairedSaves", pairedId, cat]`, `["saves", "list", userId]`
- Target: `savedCardKeys.all` prefix. `useSavedCards`, `usePairedSaves`, `useSaveQueries` all use factory.
- Steps: (1) Update each hook's queryKey to use factory. (2) Update all mutation `invalidateQueries` calls to invalidate `savedCardKeys.all`. (3) Verify no component manually constructs the old key strings. (4) Remove old key string literals.

**Person hero cards:**
- Current: 2 keys — `["person-hero-cards", "v1", ...]`, `["paired-cards", ...]`
- Target: `personCardKeys.all` prefix. Both hooks share factory.
- Steps: Same pattern as saved cards.

**Blocked users:**
- Current: old `useBlockedUsers.ts` (useState) + `useFriendsQuery.ts` (React Query)
- Target: React Query version only via `friendsKeys.blocked()`.
- Steps: (1) Find all imports of old `useBlockedUsers`. (2) Migrate to React Query version. (3) Delete old file. (4) Remove Zustand `blockedUsers: []`.

**Friends:**
- Current: Partial invalidation — some accept/decline flows invalidate specific sub-keys
- Target: All friend-mutating operations invalidate `friendsKeys.all`.
- Steps: (1) Audit every mutation that touches friends/requests/blocked. (2) Change invalidation to `friendsKeys.all`. (3) Verify no stale sub-key survives.

**Risk / blast radius:** Medium. Touches multiple hook files and their consumers. All changes must ship together — partial migration creates worse split-brain than before.
**Rollback unit:** Revert all files in this pass as one unit.
**Highest-risk regression:** A component that cached data under the old key now finds nothing under the new key → empty screen. Must verify every consumer.

**Required smoke tests:**
1. Save card on SavedTab → appears on PersonHolidayView immediately
2. Unsave on PersonHolidayView → disappears from SavedTab immediately
3. Shuffle in HolidayRow → PersonHolidayView shows same cards
4. Block user → reflected everywhere (chat, discover, friends)
5. Unblock user → reflected everywhere
6. Accept friend → appears on all screens immediately
7. Remove friend → removed from all screens immediately

**REQUIRED VERIFICATION GATE: Repo-Wide Grep Proof**

Before this pass is certified, the Implementor must produce grep/search evidence proving complete removal. This is not optional — "I updated the files" is not sufficient. The evidence must be included in the implementation report.

**Required searches and expected results:**

1. **Old saved-card key literals fully removed:**
   - `grep -r '"savedCards"' --include='*.ts' --include='*.tsx' app-mobile/src/` → Only hits should be inside `queryKeys.ts` factory definition. Zero hits in hooks, components, or mutation invalidation calls.
   - `grep -r '"pairedSaves"' --include='*.ts' --include='*.tsx' app-mobile/src/` → Zero hits anywhere. This key family is eliminated.
   - `grep -r '"saves"' --include='*.ts' --include='*.tsx' app-mobile/src/hooks/ app-mobile/src/components/` → Zero hits as a query key. (May hit unrelated variable names — Implementor must distinguish.)

2. **Old person-card key literals fully removed:**
   - `grep -r '"person-hero-cards"' --include='*.ts' --include='*.tsx' app-mobile/src/` → Only hits in `queryKeys.ts`. Zero in hooks or components.
   - `grep -r '"paired-cards"' --include='*.ts' --include='*.tsx' app-mobile/src/` → Zero hits anywhere.

3. **Old blocked-user hook/store fully removed:**
   - `grep -r 'useBlockedUsers' --include='*.ts' --include='*.tsx' app-mobile/src/` → Zero hits. File deleted, all imports removed.
   - `grep -r 'blockedUsers' --include='*.ts' --include='*.tsx' app-mobile/src/stores/ app-mobile/src/hooks/` → Zero hits in stores. Only hit in hooks should be inside `useFriendsQuery.ts` (the React Query version).

4. **No duplicate ownership paths remain:**
   - `grep -rn 'invalidateQueries.*savedCard\|invalidateQueries.*pairedSave\|invalidateQueries.*saves' --include='*.ts' --include='*.tsx' app-mobile/src/` → Every invalidation call uses `savedCardKeys.all` or a factory sub-key. Zero raw string literals.
   - `grep -rn 'invalidateQueries.*person-hero\|invalidateQueries.*paired-cards' --include='*.ts' --include='*.tsx' app-mobile/src/` → Every invalidation call uses `personCardKeys.all` or a factory sub-key. Zero raw string literals.
   - `grep -rn 'invalidateQueries.*friends\|invalidateQueries.*blocked\|invalidateQueries.*requests' --include='*.ts' --include='*.tsx' app-mobile/src/` → Every invalidation call uses `friendsKeys.*` factory. Zero raw string literals.

The Implementor must run these searches and include the output (or "zero results" confirmation) in the implementation report. Any unexpected hit must be explained or fixed.

**Certification gates:**
- [ ] Source of truth: server for all four entities. React Query as single cache layer.
- [ ] Competing owners removed: old useBlockedUsers deleted, old key literals gone, Zustand blockedUsers gone
- [ ] No duplicate query keys remain for any entity
- [ ] Every mutation that changes these entities invalidates the correct factory prefix
- [ ] No component manually constructs query key strings (all use factory)
- [ ] Cross-screen consistency verified for all four entities
- [ ] Logout/user-switch: React Query cache clears on logout (verify queryClient.clear() is called)
- [ ] Code removal completed: old files deleted, old key literals removed, dead Zustand fields removed
- [ ] **Repo-wide grep proof included in implementation report** — all searches above return expected results

**Why this is permanent:**
- **Before:** Same fact cached 2-3 times under unrelated keys. Invalidation can't reach all copies.
- **After:** One factory per entity. Invalidation reaches all queries via shared prefix. The structure makes split-brain impossible for these entities.
- **Root cause removed:** The ability to create a new query key for an existing entity without going through the factory.
- **Not symptom treatment because:** We're not adding cross-key invalidation — we're eliminating the multiple keys.

**Race-condition audit:** Two mutations for the same entity firing simultaneously → both invalidate the same prefix → React Query deduplicates refetches. Safe.
**Logout/user-switch check:** React Query cache must be cleared on logout. Verify `queryClient.clear()` or equivalent is called. New user login starts with empty cache.
**Background/resume check:** Resume invalidates CRITICAL_QUERY_KEYS which should include the new factory prefixes.
**Depends on refetch as consistency tool:** Yes — invalidation triggers refetch. This is the correct and standard React Query pattern. Not a weakness here because the key structure guarantees all queries for an entity are reached.
**Independently shippable:** Yes, but must ship as one atomic unit (all four entity migrations together).

---

### Pass 7: Realtime Subscriptions, Badges, Unread Counts + Lifecycle Audit

**Goal:** Fix badge/unread drift AND ensure all realtime subscriptions have correct lifecycle management across sign-out, user-switch, background/resume, and reconnect.

**Issues included:**
- 7a: iOS badge count never decremented on single notification read (P1)
- 7b: DM unread count not subscribed to realtime (P1)
- 7c: Board read receipts have no realtime subscription (P1)
- 7d: Fire-and-forget notifications/counters (P2)
- 7e: **NEW — Realtime subscription lifecycle audit** (required before any subscription code changes)

**Invariant before:** Badge counts drift. Unread counts never auto-update. Board read receipts are stale. Subscription lifecycle (setup, teardown, reconnect, user-switch) is unaudited.
**Invariant after:** Badge count updates on every notification read. Unread counts update via realtime. Board read receipts update via realtime. All subscriptions are torn down on sign-out, re-established on user-switch, and reconnected on resume.

**GATE: Before any code changes in this pass, the Implementor must produce a written realtime subscription audit covering:**

1. **Current subscriptions inventory:** Every `supabase.channel()` or `.on()` call in the codebase. What table, what filter, what component/hook owns it.
2. **Lifecycle for each subscription:**
   - When is it created?
   - When is it torn down?
   - What happens on sign-out? (Must be torn down)
   - What happens on user-switch? (Must be torn down + re-created with new user ID)
   - What happens on background? (Should be paused or reconnected)
   - What happens on resume/foreground? (Must reconnect)
   - What happens on network reconnect? (Must resubscribe)
3. **Channel naming:** Do channel names include userId? If user A signs out and user B signs in, do old channels leak?
4. **Missing subscriptions:** What tables need realtime but don't have it (message_reads, board_message_reads)?

This audit is a **certification gate**. The Implementor writes it to `outputs/AUDIT_REALTIME_SUBSCRIPTIONS.md`. Launch Hardener reviews before code proceeds.

**Authority / source-of-truth model:**
- Badge count authority: Server (notification count) → OneSignal SDK (badge display). Must update OneSignal on every read.
- DM unread count authority: Server (`messages` + `message_reads` tables). Client: React Query cache, invalidated by realtime subscription.
- Board read receipts authority: Server (`board_message_reads` table). Client: React Query cache, invalidated by realtime subscription.
- Subscription lifecycle authority: App lifecycle (AppState) + auth state. Subscriptions live/die with the authenticated session.

**Code to remove:**
- Any subscription setup that doesn't have matching teardown
- Any subscription channel name that doesn't include the current user's ID (if it should be per-user)
- Fire-and-forget `.catch(() => {})` on notification sends in `AppHandlers.tsx` — replace with `withTimeout` + console.warn minimum

**Migration shape:**

**Badge (7a):**
- Current: `markAsRead()` updates DB + React Query. Only `markAllAsRead()` calls OneSignal.
- Target: After `markAsRead()`, compute new unread count, call `OneSignal.setBadgeCount(newCount)`.
- Verification: Read one notification → badge decrements by 1.

**DM unread (7b):**
- Current: Computed on demand by fetching all messages + all read receipts. No caching. No realtime.
- Target: Add realtime subscription on `message_reads` for current user. On INSERT, invalidate conversation unread count query. Cache unread counts in React Query (30s staleTime).
- Verification: Receive message → unread increments. Read message → unread decrements.

**Board read receipts (7c):**
- Current: No realtime subscription on `board_message_reads`.
- Target: Add realtime subscription. On INSERT, invalidate board discussion queries.
- Verification: Board member reads message → other members see updated read state.

**Notifications fire-and-forget (7d):**
- Current: `.catch(() => {})` on board notifications, pair activity, engagement counters
- Target: Wrap in `withTimeout(5000)`. Add console.warn on failure. For engagement counters that affect user-visible state, add 1 retry.
- This is **Transitional** — proper fix would be a managed background job queue. Acceptable for now because these are secondary notifications, not primary state.

**Lifecycle (7e):**
- Current: Unknown — needs audit
- Target: Every subscription created → teardown registered on sign-out AND user-switch. Resume → reconnect all.

**Risk / blast radius:** Medium-high. Realtime subscriptions touch the entire app's live-update behavior. The lifecycle audit gates the code changes.
**Rollback unit:** Revert all Pass 7 files as one unit.
**Highest-risk regression:** New realtime subscriptions cause excessive server load or battery drain. Must verify subscription filters are narrow.

**Required smoke tests:**
1. Read one notification → iOS badge decrements by 1
2. Mark all read → badge shows 0
3. Receive DM → unread count updates without manual refresh
4. Read DM → unread count decrements
5. Board member reads message → other member sees read state update
6. Sign out → all realtime channels disconnected (verify via Supabase dashboard or logs)
7. Sign in as different user → subscriptions re-established with new user ID, no leakage
8. Background app 5 minutes → resume → subscriptions reconnect → data current

**Certification gates:**
- [ ] Realtime subscription audit completed (AUDIT_REALTIME_SUBSCRIPTIONS.md)
- [ ] Every subscription has matching teardown on sign-out
- [ ] Every subscription has matching teardown + re-creation on user-switch
- [ ] Every subscription reconnects on resume/foreground
- [ ] Channel names include user ID where required
- [ ] No leaked channels after sign-out
- [ ] Badge count updates on every single read (not just bulk)
- [ ] DM unread counts update via realtime
- [ ] Board read receipts update via realtime
- [ ] Fire-and-forget paths have at minimum console.warn + withTimeout
- [ ] Background/resume: subscriptions reconnect, data refreshes
- [ ] Logout/user-switch: all private subscriptions torn down

**Why this is permanent:**
- **Badge:** The OneSignal update call is added to every read path. Not a workaround.
- **Unread/read:** Realtime subscriptions replace on-demand computation. The data now flows, not polls.
- **Lifecycle:** Subscription lifecycle is audited and contracted. Future subscriptions must follow the pattern.
- **Notifications (7d):** **Transitional** — timeout + warning, not a managed queue.

**Race-condition audit:** Realtime event arriving while query is in-flight → React Query handles this (deduplication). Realtime event arriving after component unmounts → subscription teardown must be in useEffect cleanup.
**Logout/user-switch check:** PRIMARY CONCERN for this pass. Explicitly gated.
**Depends on refetch as consistency tool:** Partially — realtime invalidates React Query, which then refetches. This is the standard Supabase Realtime + React Query pattern. The realtime event is the trigger; refetch is the mechanism. Acceptable.
**Independently shippable:** Yes, but lifecycle audit is a gate.

---

### Pass 8: Preferences, Profile, Filter Authority + Authority Map

**Goal:** Establish clear ownership for preferences, profile, and filter state. Remove triple-caching. Remove persisted server state from client stores. Fix filter→recommendation disconnect.

**Issues included:**
- 8a: User preferences triple-cached with no sync contract (P2)
- 8b: Server-owned profile persisted in Zustand — stale on cold start (P2)
- 8c: Category filter change doesn't invalidate recommendation query (P1)
- 8d: Collaboration filter changes take 5 min to reach other participants (P1)
- 8e: Offline preference cache not cleared on logout (P2)

**GATE: Before any code changes in this pass, the Implementor must produce a written authority map covering:**

| State | Server-Authoritative? | React Query? | Offline Fallback? | Persisted Locally? | Cleared on Logout? | Invalidation / Realtime Rule |
|-------|----------------------|-------------|-------------------|--------------------|--------------------|------------------------------|
| User preferences | ? | ? | ? | ? | ? | ? |
| User profile | ? | ? | ? | ? | ? | ? |
| Category filters | ? | ? | ? | ? | ? | ? |
| Board session prefs | ? | ? | ? | ? | ? | ? |
| Currency/measurement | ? | ? | ? | ? | ? | ? |

This authority map is written to `outputs/AUTHORITY_MAP_PREFERENCES_PROFILE.md`. Launch Hardener reviews before code proceeds.

**Invariant before:** Preferences live in 3 places with no sync rule. Profile is persisted locally even though it's server-owned. Filter changes don't propagate to recommendations. Collaboration filters are stale for 5 minutes. Offline cache survives logout.
**Invariant after:** Every state in this domain has one authoritative owner, one cache path, one reconciliation rule, and is cleared on logout.

**Authority / source-of-truth model (target — to be confirmed by authority map):**
- User preferences: Server → React Query (60s staleTime) → AsyncStorage (offline-only fallback, read-only). One direction. AsyncStorage never writes back to server.
- User profile: Server → React Query (realtime listener updates cache). NOT persisted in Zustand. Cold start shows loading until fresh fetch.
- Category filters: Part of preferences. Filter change → immediate invalidation of recommendation/discover query keys.
- Board session preferences: Server → React Query (30s staleTime OR realtime subscription for near-instant sync).
- Currency/measurement: Part of profile. Follows profile authority chain.

**Code to remove:**
- `profile` from Zustand persist whitelist (keep in runtime store, stop persisting to AsyncStorage)
- Dead `preferences` field from `AppState` interface in `appStore.ts`
- Any direct Zustand reads of `preferences` that bypass React Query
- Old 5-minute staleTime values for preferences and board session preferences

**Migration shape:**

**Preferences (8a):**
- Current: Server + React Query (5-min) + AsyncStorage offline cache + dead Zustand field
- Target: Server → React Query (60s) → AsyncStorage (offline read-only fallback)
- Steps: (1) Reduce staleTime to 60s. (2) On write: update server → invalidate RQ → update AsyncStorage. (3) On read: RQ first → AsyncStorage fallback → defaults. (4) Remove dead Zustand `preferences` field. (5) Clear AsyncStorage prefs on logout.

**Profile (8b):**
- Current: Server + Zustand (persisted) + Realtime listener
- Target: Server → React Query (with realtime invalidation) OR Zustand (runtime only, not persisted)
- Steps: (1) Remove `profile` from Zustand persist config. (2) On cold start, show loading for profile-dependent UI. (3) Realtime listener updates runtime store. (4) Verify no component crashes without persisted profile on cold start.

**Category filter → recommendations (8c):**
- Current: PreferencesSheet saves categories. Recommendation queries not invalidated.
- Target: After category preference save, immediately invalidate recommendation/discover query keys.
- Steps: (1) Identify which query keys serve recommendations. (2) Add invalidation call after preference save.

**Collaboration filters (8d):**
- Current: 5-min staleTime
- Target: 30-sec staleTime OR realtime subscription on session preference changes
- Steps: Reduce staleTime. If realtime subscription exists for the session, piggyback on it.

**Offline logout (8e):**
- Current: AsyncStorage preference cache not cleared on logout
- Target: `AsyncStorage.multiRemove(preferenceKeys)` in logout flow
- Steps: (1) Identify all preference-related AsyncStorage keys. (2) Add removal to logout handler.

**Risk / blast radius:** Medium. Profile persistence removal could cause brief loading flash on cold start. Authority map gates the work.
**Rollback unit:** Revert all Pass 8 files.
**Highest-risk regression:** Removing profile from Zustand persist → cold start shows no name/avatar for 1-2s until fetch completes. This is the correct behavior (showing stale data was worse) but must be UX-acceptable.

**Required smoke tests:**
1. Change preference → reflected immediately in Discover
2. Cold start → preferences load from server (brief loading if needed), not stale AsyncStorage
3. Cold start → profile shows loading, then real data (no stale avatar/name flash)
4. Change category filters → new cards on next deck load
5. Collaborator changes board filter → other participants see within 30s
6. Logout → login as different user → no stale preferences/profile from previous account
7. Offline → preferences show last known values from AsyncStorage
8. Come online → preferences update from server

**Certification gates:**
- [ ] Authority map completed (AUTHORITY_MAP_PREFERENCES_PROFILE.md) and reviewed
- [ ] Every state has one authoritative owner documented
- [ ] Competing owners removed: no triple-cache, no persisted server state
- [ ] Offline fallback is read-only — never writes back
- [ ] Logout clears all private offline data
- [ ] User-switch: new user gets fresh data, not previous user's cache
- [ ] Category filter change invalidates recommendations
- [ ] Collaboration filter staleTime reduced
- [ ] Dead Zustand fields removed
- [ ] Code removal: persist config cleaned, dead fields removed, old staleTime values replaced

**Why this is permanent:**
- **Before:** 3 caches, no rule for which wins. Server state persisted as client truth.
- **After:** One authority chain documented and enforced. Offline fallback is explicitly read-only. Logout clears private data.
- **Root cause removed:** The absence of an authority contract. The map IS the fix — code changes enforce it.
- **Not symptom treatment because:** We're not adding more sync — we're removing layers and defining ownership.

**Race-condition audit:** Preference write + realtime update arriving simultaneously → React Query deduplicates. Cold start reading AsyncStorage while fetch in-flight → fetch result overwrites stale AsyncStorage value.
**Logout/user-switch check:** PRIMARY CONCERN. AsyncStorage cleared. React Query cleared. Zustand runtime profile cleared.
**Depends on refetch as consistency tool:** For preference/profile freshness after cache — yes. For category→recommendation sync — invalidation (correct use). For collaboration — staleTime reduction (transitional; realtime would be permanent).
**Independently shippable:** Yes, with authority map as gate.

---

### Pass 9A: Mutation Error Handling Sweep

**Goal:** Add `onError` handlers to all mutations that lack them. Replace silent catches on state-changing paths with visible error handling.

**Issues included:**
- 9Aa: 25+ mutations missing `onError` handlers (P2)
- 9Ab: 35+ silent `.catch(() => {})` on state-changing paths (P2)

**Invariant before:** Server rejections on 25+ mutations are invisible to the user. 35+ state-changing operations swallow errors.
**Invariant after:** No mutation may fail without user-visible feedback (error toast, rollback, or retry prompt). No state-changing `.catch(() => {})` may exist unless explicitly justified as a non-critical secondary effect.

**Authority / source-of-truth model:** N/A — this pass is about error visibility, not ownership.

**Code to remove:**
- Every `.catch(() => {})` on a state-changing operation — replaced with error handling
- Every empty `catch {}` block on a state-changing operation — replaced with error handling

**What is explicitly NOT in scope:** Catches on truly non-critical, non-state-changing operations (e.g., analytics logging, non-essential cache warming) may remain with a code comment explaining why. The Implementor must justify each retained silent catch.

**Migration shape:**
- For each of the 25+ mutations: add `onError: (error) => showMutationError(error, 'Description')` using the Pass 0 utility
- For each of the 35+ silent catches: replace `.catch(() => {})` with `.catch((e) => showMutationError(e, 'Description'))` or `.catch((e) => { console.warn('Non-critical:', e); })` with justification
- **Exceptions already handled in other passes:** OnboardingFlow catches (Pass 4), CustomPaywallScreen sync (Pass 5), AppHandlers notifications (Pass 7). These are NOT re-done here.

**Grouping by hook file:**
1. `useCustomHolidays.ts` — 7 mutations
2. `usePairings.ts` — 4 mutations
3. `useSessionDiscussion.ts` — 2 mutations
4. `useVisits.ts` — 2 mutations
5. `useGenerateMoreCards.ts` — 1 mutation
6. Remaining direct service calls in components — ~10-15

**Risk / blast radius:** Low. Adding `onError` is additive. No behavioral change on success paths.
**Rollback unit:** Per-file revert. Each hook file is independent.
**Highest-risk regression:** Error toast appearing on expected/handled errors (e.g., duplicate key violations that the app already handles). Must verify each mutation's success/error paths.

**Required smoke tests:**
1. Trigger 5 different mutations with network error → toast appears for each
2. Trigger same 5 mutations with valid data → no toast, normal behavior
3. Verify previously-silent catches now show feedback or have justified comments

**Certification gates:**
- [ ] Every `useMutation` in the codebase has an `onError` handler
- [ ] Every `.catch(() => {})` on a state-changing path is either replaced with error handling or has a justifying comment
- [ ] Shared error toast utility is used consistently
- [ ] No new silent catches introduced
- [ ] User-cancel scenarios (RevenueCat, etc.) don't show error toast
- [ ] Code removal: empty catch blocks gone, replaced with handlers

**Why this is permanent:**
- **Before:** Errors vanish. User's mental model diverges from reality.
- **After:** Errors are visible. The mutation contract is: mutate → pending → success OR error → user knows.
- **Root cause removed:** The practice of `.catch(() => {})` on state-changing operations.
- **Not symptom treatment because:** The rule is enforced per-mutation, not per-bug.

**Race-condition audit:** N/A — error handlers are synchronous callbacks.
**Logout/user-switch check:** N/A.
**Depends on refetch as consistency tool:** No.
**Independently shippable:** Yes. Each hook file can even ship independently.

---

### Pass 9B: Offline Queue Hardening + Dead Store Cleanup

**Goal:** Ensure the offline message queue never silently discards user content. Clean up dead Zustand state.

**Issues included:**
- 9Ba: Offline message queue silently discards after 5 retries (P2)
- 9Bb: Dead Zustand store fields cleanup — `preferences`, `blockedUsers`, `currentSession`/`isInSolo` persist confusion (P3)

**Invariant before:** Queued messages can be silently dropped. User thinks message will send but it's gone. Dead fields create confusing store contract.
**Invariant after:** No queued user content is silently discarded. Failed messages show a visible "failed to send" state with retry. Zustand store contains only fields that are actively used and correctly configured for persistence.

**Authority / source-of-truth model:**
- Offline message queue: Client-local (AsyncStorage or in-memory). Authority for "was this message sent?" is the server (message exists in DB). Client must surface uncertainty.
- Zustand store: Client state only. Server-authoritative data must NOT be persisted here (profile handled in Pass 8).

**Code to remove:**
- Silent discard logic in `realtimeService.ts:903-963` after max retries — replace with "failed" state
- Dead `preferences` field from `AppState` interface (if not already removed in Pass 8)
- Dead `blockedUsers: []` from initial state (if not already removed in Pass 6)
- Confusing persist config for `currentSession`/`isInSolo` — either persist them properly or move to a non-persisted slice

**Migration shape:**

**Offline queue (9Ba):**
- Current: Message queued → retry up to 5 times → silently dropped
- Target: Message queued → retry up to 5 times → on max retries, mark as "failed" in local state → show "Failed to send" indicator on message bubble → provide "Retry" button → user can manually retry or dismiss
- Steps: (1) Add `status: 'pending' | 'sent' | 'failed'` to queued message model. (2) After max retries, set status to 'failed' instead of removing. (3) Render "failed to send" indicator in message bubble component. (4) Add retry handler on tap. (5) Add dismiss/delete handler.

**Dead store (9Bb):**
- Current: `preferences` field declared, never written. `blockedUsers: []` not in TypeScript interface. `currentSession`/`isInSolo` in interface but excluded from persist.
- Target: Remove dead fields. Document or fix persist exclusions.
- Steps: (1) Verify no code reads these fields. (2) Remove from interface + initial state. (3) For `currentSession`/`isInSolo` — determine if exclusion from persist is intentional (likely yes — session state shouldn't survive app restart). Add code comment explaining why.

**Risk / blast radius:** Low. Offline queue change is scoped to `realtimeService.ts` + message rendering. Dead store cleanup is removal-only.
**Rollback unit:** Revert realtimeService.ts + appStore.ts + message component.
**Highest-risk regression:** "Failed to send" indicator rendering incorrectly or appearing on messages that actually sent (race between retry and server confirmation).

**Required smoke tests:**
1. Send message offline → shows "pending" indicator
2. Come online → message sends, indicator clears
3. Send message offline, stay offline through 5 retries → shows "failed to send" with retry button
4. Tap retry → message attempts again
5. App restart → failed messages persist (not silently dropped)
6. Verify no TypeScript errors after dead field removal

**Certification gates:**
- [ ] No queued user content is ever silently discarded
- [ ] "Failed to send" state is visible to the user
- [ ] Retry mechanism works on failed messages
- [ ] Dead Zustand fields removed
- [ ] Persist config is clean — every persisted field is justified
- [ ] Logout: offline queue cleared (private messages must not survive logout)
- [ ] User-switch: offline queue cleared
- [ ] Code removal: silent discard logic gone, dead fields gone

**Why this is permanent:**
- **Before:** User content silently dropped. Dead state confuses developers.
- **After:** Failed messages are surfaced. Store contract is clean.
- **Root cause removed:** The "discard after max retries" behavior. Replaced with "surface failure."
- **Not symptom treatment because:** The discard logic is gone, not wrapped in more retries.

**Race-condition audit:** Retry firing while a new message is being queued → must not corrupt queue ordering. "Failed" status being set while a late-arriving success response comes back → must check server confirmation before marking failed.
**Logout/user-switch check:** Offline queue must be cleared on logout (private messages). Dead store fields must not leak across users.
**Depends on refetch as consistency tool:** No.
**Independently shippable:** Yes.

---

### Pass 10: Service-Layer Masked Error Containment

**Goal:** Make an explicit architectural decision about the service-layer `null/[]` masking pattern and implement the first containment step.

**Issues included:**
- 10a: Services return `null`/`[]` on error — masked failures across 6+ services (P3 individually, systemic risk)

**Affected services:**
| Service | Function | Returns on Error | Consumers |
|---------|----------|-----------------|-----------|
| preferencesService | `getUserPreferences()` | `null` | useUserPreferences, OnboardingFlow |
| preferencesService | `getUserProfile()` | `null` | useUserProfile |
| connectionsService | `getFriends()` | `[]` | useFriends |
| connectionsService | `getMessages()` | `[]` | ConnectionsPage |
| experienceService | `searchExperiences()` | `[]` | DiscoverScreen |
| experienceService | `fetchAllExperiences()` | mock data | DiscoverScreen |

**Architectural decision — THIS IS NOT FULLY FIXED IN THIS HARDENING EFFORT.**

**Disposition: Partially contained. The full fix is a separate architecture program.**

**Rationale:** Fully fixing this requires changing the return type of every service function from `T | null` to `{data: T | null, error: Error | null}` (or making them throw). This is a breaking change to every consumer — 60+ call sites. It's the right thing to do, but it's a separate program with its own testing pass, not a bolt-on to this hardening effort.

**What IS done in this hardening effort:**
1. **Pass 4** fixes the most critical instance (`PreferencesService.updateUserPreferences` masked error) by removing the silent catch and making failure visible during onboarding.
2. **Pass 9A** adds `onError` handlers to all React Query mutations, so mutation-path errors are visible even if the underlying service masks them.
3. **This pass (10)** adds a **containment layer**: for the 6 critical service functions listed above, add a `console.error` + error reporting call BEFORE returning the masked value. This doesn't change the return type (no breaking change) but makes the failure observable in logs and crash reporting.

**What is DEFERRED:**
- Full service-layer return type migration to `{data, error}` tuples
- Component-level error/empty state distinction
- Elimination of mock data fallback in `fetchAllExperiences`

**Remaining risk:** Screens can still show "empty" when they should show "error." The user thinks they have no saved cards, no friends, no preferences — when actually the fetch failed. This is contained (errors are now logged) but not eliminated (UI still shows empty).

**Next-step architecture work:** A dedicated "Service Error Contract" program that:
1. Defines a standard `ServiceResult<T>` return type
2. Migrates all services to throw or return error tuples
3. Updates all consumers to handle error vs. empty distinctly
4. Adds error/retry UI to all list screens

**Invariant before:** Service errors are indistinguishable from empty data.
**Invariant after (this pass):** Service errors are logged and reported, even though the UI still shows empty. Future observability exists.
**Invariant after (future program):** Service errors are surfaced to the user as distinct from empty data.

**Code to remove:** None in this pass — purely additive logging.

**This pass is explicitly labeled: TRANSITIONAL.**

**EXIT CRITERION — No Critical List Screen May Silently Map Failure to Empty**

This pass is NOT certified complete until:

1. **Every service function in the affected list** (getUserPreferences, getUserProfile, getFriends, getMessages, searchExperiences, fetchAllExperiences) has, at minimum:
   - A `console.error` call with the original error before returning the masked value
   - An error reporting call (e.g., Sentry, crashlytics, or whatever the app uses) so failures are observable in production
   - A code comment: `// TRANSITIONAL: masked error — see Service Error Contract program`

2. **No new masked-error service functions may be added** without the same minimum logging. This rule is documented in a code comment at the top of each affected service file:
   ```
   // SERVICE ERROR CONTRACT (transitional):
   // All functions in this file return null/[] on error instead of throwing.
   // This is a known architectural weakness. Every catch block MUST log the error
   // via console.error + error reporting before returning the masked value.
   // Full fix: migrate to ServiceResult<T> return type (see HARDENING_EXECUTION_PLAN_V3.md, Deferred items).
   ```

3. **A named owner is assigned for the future full Service Error Contract migration.** The implementation report must state:
   - Who (role or person) owns the future migration
   - What the migration scope is (estimated number of service functions + consumers)
   - When it should be prioritized (e.g., "post-launch stabilization phase" or "next hardening cycle")
   - Where the tracking item lives (e.g., "added to LAUNCH_READINESS_TRACKER.md as a deferred item")

   If no specific person can be named, the owner is "the team's next hardening cycle" and the tracking item must be added to the tracker with grade F and a clear description.

4. **The `fetchAllExperiences` mock data fallback is documented explicitly.** The implementation report must state that this function returns fake data on error, not just empty data, and flag it as the single worst masked-error case in the codebase. It must be added to the deferred items in the tracker.

**Risk / blast radius:** Very low. Adding console.error + error reporting before existing return statements.
**Rollback unit:** Revert the 4-5 service files.
**Independently shippable:** Yes.

**Certification gates:**
- [ ] All 6 service functions have console.error + error reporting before masked return
- [ ] All 6 service functions have `// TRANSITIONAL` code comment
- [ ] All affected service files have the Service Error Contract header comment
- [ ] Named owner assigned for future full migration (in implementation report)
- [ ] Migration scope estimated (in implementation report)
- [ ] Tracking item added to LAUNCH_READINESS_TRACKER.md
- [ ] `fetchAllExperiences` mock data fallback explicitly documented and flagged
- [ ] No new masked-error functions introduced without logging

---

## 4. Explicit Disposition of All Work

### Permanent Fixes (root cause removed)

| Pass | Fix | Why Permanent |
|------|-----|---------------|
| 0 | withTimeout, error toast, key factories | Infrastructure contracts — future code must use them |
| 1 | Chat/conversation open responsiveness | await-before-UI pattern eliminated, not timeout-wrapped |
| 2 | Board exit, friend accept, skip responsiveness | Sequential await chains eliminated, not parallelized |
| 3a | Discover retry loading order | Loading state before async work — structural |
| 3b | Pull-to-refresh stale closure | Dependency array corrected — structural |
| 4 | Onboarding preferences atomic save | 13 fire-and-forget writes eliminated, one atomic write |
| 6 | Query key consolidation | Split-brain impossible — one factory per entity |
| 7a | Badge count on every read | OneSignal update in every read path |
| 7b,c | Realtime subscriptions for unread/read | Event-driven — replaces on-demand computation |
| 8a | Preferences authority chain | Triple cache eliminated, one authority documented |
| 8b | Profile not persisted in Zustand | Server state stays in server layer |
| 8c | Category filter → recommendation invalidation | Invalidation wired — structural |
| 8e | Offline cache cleared on logout | Privacy fix — structural |
| 9A | Mutation error handling sweep | Every mutation has onError — contract enforced |
| 9B-queue | Offline queue surfaces failures | Silent discard eliminated |
| 9B-store | Dead Zustand cleanup | Dead code removed |

### Transitional Fixes (contained, not cured)

| Pass | Fix | What's Transitional | What Would Be Permanent |
|------|-----|---------------------|------------------------|
| 3c | Session expiry UX | Toast + grace period. Root cause (401 counter heuristic) remains. | Server-pushed session expiry event. |
| 5a | Subscription tier staleTime 60s + expiry check | "Take highest of 3" model remains. | Single server-authoritative tier RPC. |
| 7d | Notification fire-and-forget → withTimeout + warn | Still fire-and-forget, just observable. | Managed background job queue. |
| 8d | Collaboration filter 30s staleTime | Still polling, just faster. | Realtime subscription on session prefs. |
| 10 | Service-layer masked error logging | UI still shows empty for errors. | Service error contract + error UI. |

### Deferred (not in this hardening effort)

| Item | Why Deferred | Risk if Unaddressed |
|------|-------------|---------------------|
| Full service-layer `{data, error}` migration | 60+ call sites, separate program | Screens show empty instead of error |
| Single server-authoritative tier RPC | Requires new edge function + client refactor | Tier confusion in edge cases |
| Managed background job queue | Architecture program, not a pass | Secondary notifications can fail silently |
| Realtime subscription on session preferences | Requires Supabase Realtime config + testing | Collaboration filters lag 30s |
| Realtime channel cleanup audit (user A→B) | Needs dedicated investigation per V1 | Theoretical data leak on user switch |
| `exhaustive-deps` ESLint rule enforcement | Config change, needs team buy-in | Future stale closures possible |
| `fetchAllExperiences` mock data fallback | Needs real empty-state design | Fake data shown on error |

---

## 5. Cross-Cutting Audit Questions (Answered)

**Do any passes still rely too much on refetch/invalidate as the main correctness mechanism?**
Yes — Pass 5 (subscription tier) and Pass 8d (collaboration filters) still use staleTime + refetch as the primary freshness mechanism. Both are labeled **Transitional**. The permanent fix is event-driven (realtime or webhook). All other passes use invalidation as a secondary mechanism after a concrete trigger (mutation, realtime event, user action).

**Are any passes still mixing server-authoritative state with persisted client state?**
After Pass 8, no. Profile is removed from Zustand persist. Preferences have a defined authority chain. The one remaining area is subscription tier (3 sources with "take highest"), which is labeled **Transitional** in Pass 5.

**Are any passes missing explicit race-condition audits?**
No — every pass now includes a race-condition audit section. Highest-risk areas: Pass 1 (background block check vs. component unmount), Pass 7 (realtime events vs. in-flight queries), Pass 9B (retry vs. late success response).

**Are any passes missing logout/privacy cleanup?**
No — Passes 6, 7, 8, 9B all explicitly certify logout behavior. Pass 8e specifically addresses offline cache cleanup.

**Are any passes missing user-switch/account-switch validation?**
Passes 6 (query key consolidation), 7 (realtime subscriptions), 8 (preferences/profile), and 9B (offline queue) all explicitly certify user-switch behavior.

**Are any passes missing background/foreground validation?**
Passes 1, 3, 7, and 8 all explicitly certify background/resume behavior. Pass 7 requires a full lifecycle audit as a gate.

**Are any passes too broad to certify confidently?**
After splitting Pass 9 → 9A + 9B and adding the lifecycle audit gate to Pass 7, no. The largest pass is 9A (25+ mutations) but it's low blast radius (additive onError handlers) and can be rolled back per-file.

**Are there any domains where duplicate query keys may still remain after the current plan?**
After Pass 6, no — all identified split-key entities are consolidated. If the Implementor discovers additional split keys during execution, they must flag them.

**Are there any "silent success" cases left, where UI may appear correct without confirmed truth?**
After all passes: the remaining "silent success" risk is the service-layer masked errors (Pass 10 — Transitional). The UI may show "empty" instead of "error" for list queries. This is contained by logging but not eliminated.

---

## 6. Final Recommendation

**The plan is ready to execute at permanent-solutions standard.**

Every issue is tracked, assigned, and has a permanent or honestly-labeled-transitional fix. Every pass has invariants, certification gates, code removal lists, lifecycle checks, and race-condition audits. The two broadest passes (7 and 9) have been gated or split. The five transitional fixes are labeled with what permanent would look like.

**V3 additions over V2:**
- **Pass 5** now requires a Tier Authority Exception List artifact before certification — documenting exactly where stale tier can still mislead, which actions force revalidation, and the remaining risk window.
- **Pass 6** now requires repo-wide grep proof that old key literals, old hooks, and duplicate ownership paths are fully removed — not just "I updated the files."
- **Pass 10** now has a strict exit criterion: no critical list screen may silently map failure to empty without logging, error reporting, and a transitional code comment. A named owner must be assigned for the future full Service Error Contract migration, and the tracking item must be added to the tracker.

**Required artifacts across all passes:**
| Pass | Required Artifact | Gate Type |
|------|------------------|-----------|
| 5 | `outputs/TIER_AUTHORITY_EXCEPTION_LIST.md` | Pre-certification |
| 6 | Repo-wide grep proof in implementation report | Pre-certification |
| 7 | `outputs/AUDIT_REALTIME_SUBSCRIPTIONS.md` | Pre-code |
| 8 | `outputs/AUTHORITY_MAP_PREFERENCES_PROFILE.md` | Pre-code |
| 10 | Service Error Contract owner + tracker item | Pre-certification |

**Execution order:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9A → 9B → 10.

Passes 0-3 build infrastructure and fix the "app feels dead" class. Passes 4-6 fix the "truth is shaky" class for the highest-risk domains. Passes 7-8 harden the remaining state domains with audits as gates. Passes 9A-9B sweep residual error handling and dead state. Pass 10 contains the service-layer masking with an honest "transitional" label and a named owner for the permanent fix.

Every pass is independently shippable. Every pass can be rolled back independently (Pass 6 as one unit). Every pass has smoke tests the Tester can verify.

**Start with Pass 0 when ready.**

---

## 7. Final Program Certification

After all passes (0 through 10) are complete, the Launch Hardener must produce a **Final Hardening Certification Report** to `outputs/HARDENING_CERTIFICATION_REPORT.md`.

This report is the program's exit gate. It is not a summary of what was done — it is a certification of what is now true about the app.

**The report must confirm or deny each of the following:**

### A. All Pass Certification Gates Met

For each pass (0 through 10), state:
- **Pass N: CERTIFIED** — all certification gates met, implementation report reviewed, tester report reviewed (where applicable)
- **Pass N: CERTIFIED WITH EXCEPTIONS** — all gates met except [named exception with justification]
- **Pass N: NOT CERTIFIED** — [reason, required remediation]

No pass may be listed as "CERTIFIED" without the Tester having verified the smoke tests. "Implementation complete" is not "certified."

### B. No Known Dead-Tap / Frozen-Primary-Action Issues Remain

Confirm that within the audited domains (chat, board exit, friend accept, onboarding skip, discover retry, pull-to-refresh):
- No user interaction waits on non-critical network work before visible UI response
- Every primary action button produces visual feedback within one frame
- Every network-dependent handler has a timeout via `withTimeout()`

If any known dead-tap issue remains, list it with severity and justification for why it was not fixed.

### C. No Known Duplicate Ownership Remains

Confirm that within the audited domains (saved cards, person hero cards, blocked users, friends, preferences, profile, subscription tier):
- Every domain entity has exactly one query-key factory
- Every domain entity has one documented authoritative owner
- No duplicate hook/store/cache implementations exist for the same entity

If any known duplicate ownership remains, list it with justification.

### D. All Transitional Items Have Named Owners and Tracker Entries

For each transitional fix (3c session expiry, 5a subscription tier model, 7d notification fire-and-forget, 8d collaboration filter polling, 10 service-layer masking):
- Confirm a named owner (person or role) is assigned for the permanent fix
- Confirm a tracking item exists in `LAUNCH_READINESS_TRACKER.md` with grade and description
- State the estimated priority window (e.g., "post-launch stabilization," "next hardening cycle," "Q3")

If any transitional item lacks an owner or tracker entry, flag it as an open action.

### E. All Deferred Items Have Explicit Launch-Risk Acceptance

For each deferred item (full service error contract, single tier RPC, managed background job queue, realtime session preferences, realtime channel cleanup, exhaustive-deps enforcement, fetchAllExperiences mock data):
- State the remaining launch risk in one sentence of plain English
- State whether this risk is **accepted for launch** or **requires pre-launch remediation**
- If accepted: state who accepted it (user/team decision, not Launch Hardener's unilateral call)

If any deferred item's launch risk has not been explicitly accepted, flag it as requiring a decision before launch.

### F. Launch Readiness Judgment

Based on sections A-E, state one of:
- **LAUNCH-READY within audited scope.** All passes certified. Remaining risks are transitional/deferred with named owners and accepted risk. The app no longer has the two classes of defect (dead taps + split truth) that this program targeted.
- **CONDITIONALLY LAUNCH-READY.** All passes certified, but [named conditions] must be met before launch.
- **NOT LAUNCH-READY.** [Named passes] are not certified. [Named issues] remain unresolved.

This judgment covers ONLY the domains audited by this hardening program. It does not certify unaudited domains (authentication, collaboration sessions, session voting, etc. — these remain at their current tracker grades).
