# Test Report: Onboarding Flow Overhaul — Steps 5-7
**Date:** 2026-03-14
**Spec:** FEATURE_ONBOARDING_OVERHAUL_SPEC.md
**Implementation:** IMPLEMENTATION_ONBOARDING_OVERHAUL_REPORT.md
**Tester:** Brutal Tester Skill
**Verdict:** 🔴 FAIL — 3 critical findings must be fixed before merge

---

## Executive Summary

The implementation is structurally sound and demonstrates strong architectural judgment — the 7-step state machine is clean, the path deletion is thorough, the new OnboardingFriendsAndPairingStep correctly uses production services, and the GettingExperiencesScreen animation system is well-crafted. However, **three critical defects** exist: (1) the user can navigate backward during the launch sequence after onboarding data has been permanently cleared, creating an unrecoverable dead state; (2) `clearOnboardingData()` fires before the profile update succeeds, meaning a network failure during launch permanently destroys crash-resume capability; (3) the realtime pair_requests listener is a no-op that will never surface incoming pair requests. Additionally, 5 high-severity findings require attention.

---

## Test Manifest

Total items tested: 72

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 8 | 6 | 1 | 1 |
| Pattern Compliance | 10 | 7 | 0 | 3 |
| Security | 5 | 5 | 0 | 0 |
| React Query & State | 8 | 5 | 2 | 1 |
| Edge Functions | 0 | — | — | — |
| Database & RLS | 0 | — | — | — |
| State Machine Logic | 10 | 10 | 0 | 0 |
| Component Behavior | 12 | 8 | 2 | 2 |
| Launch Sequence | 6 | 2 | 3 | 1 |
| Spec Criteria (13) | 13 | 12 | 0 | 1 |
| **TOTAL** | **72** | **55** | **8** | **9** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: Back Button Visible During GettingExperiencesScreen — Enables Catastrophic Navigation Backward During Launch

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (line 2669)
**Category:** Data Loss / Unrecoverable State

**What's Wrong:**
`hideBottomBar` is hardcoded to `false` on the OnboardingShell wrapper. During the `getting_experiences` substep, the shell renders a Back button in the fixed bottom bar (because `showBackButton={!isFirstScreen}` evaluates to `true` for step 7). The user can press Back while the launch sequence is in-flight — after `clearOnboardingData()` has already fired and the profile update may already be committed.

Pressing Back navigates to `consent` (step 7's previous substep), but:
- AsyncStorage onboarding data is already cleared (line 246)
- The profile may already be updated with `has_completed_onboarding: true` (line 248)
- The warm pool promise has already been awaited
- Re-entering `getting_experiences` would re-run the entire launch sequence, double-updating the profile

**Evidence:**
```typescript
// Line 2669 — always false, even during full-screen takeover
hideBottomBar={false}

// Line 2662 — evaluates to true for step 7
showBackButton={!isFirstScreen}

// Result: Back button is visible and pressable during launch
```

**Required Fix:**
Make `hideBottomBar` dynamic based on the current substep:
```typescript
hideBottomBar={navState.subStep === 'getting_experiences'}
```

Alternatively, also disable the Back button for `consent` to prevent navigating backward once step 7 begins (since step 7 is the terminal consent+launch sequence):
```typescript
hideBottomBar={navState.subStep === 'getting_experiences' || navState.subStep === 'consent'}
```

**Why This Matters:**
Users who press Back during launch enter an unrecoverable state: onboarding data wiped, profile partially updated, no way to resume. The app may loop or crash on next open.

---

### CRIT-002: `clearOnboardingData()` Fires Before Profile Update — Creates Unrecoverable Dead State on Network Failure

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (lines 246-255)
**Category:** Data Loss / Crash Resume Failure

**What's Wrong:**
In GettingExperiencesScreen's launch sequence, `clearOnboardingData()` (which removes all onboarding progress from AsyncStorage) is called BEFORE the profile update to Supabase. It's also not awaited, making it fire-and-forget.

If the profile update fails (network timeout, server error, auth token expired), the onboarding data is already permanently deleted from AsyncStorage. The user's DB profile still shows `has_completed_onboarding: false`, so the app will show onboarding again — but crash-resume data is gone. The user restarts onboarding from Step 1 with all progress lost.

**Evidence:**
```typescript
// Line 246 — fire-and-forget, runs BEFORE profile update
clearOnboardingData()

// Lines 248-255 — this can fail
await supabase.from('profiles').update({
  has_completed_onboarding: true,
  onboarding_step: 0,
  // ...
}).eq('id', userId)
```

**Required Fix:**
Move `clearOnboardingData()` AFTER the profile update succeeds, and await it:
```typescript
// First: update profile (can fail)
const { error } = await supabase.from('profiles').update({
  has_completed_onboarding: true,
  onboarding_step: 0,
  // ...
}).eq('id', userId)

if (error) throw error

// Only clear persistence AFTER DB confirms success
await clearOnboardingData()
```

**Why This Matters:**
Any network hiccup during launch permanently destroys the user's onboarding progress. They must restart from Step 1, re-verify phone, re-enter all preferences. This is a production data loss scenario.

---

### CRIT-003: Realtime Pair Requests Listener Is a No-Op — Incoming Pair Requests Will Never Appear in Real-Time

**File:** `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` (lines 130-152)
**Category:** Feature Failure / Broken Real-Time Updates

**What's Wrong:**
The Supabase realtime channel subscribes to `pair_requests` INSERT events, but the callback body is empty — it only contains a comment claiming "React Query will auto-refetch on invalidation from the mutation hooks." This is incorrect. React Query does NOT auto-invalidate from Supabase realtime events. Invalidation only fires from the mutation's `onSuccess` callback, which only runs when THIS user performs a mutation — not when another user sends a pair request.

If User B sends a pair request to User A while User A is on the friends_and_pairing screen, User A will never see it until they navigate away and back (triggering a React Query refetch on remount).

**Evidence:**
```typescript
// Lines 140-145 — the callback does NOTHING
.on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'pair_requests', filter: `receiver_id=eq.${userId}` },
  () => {
    // React Query will auto-refetch on invalidation from the mutation hooks
    //                    ^^^^^^^^^^^^^^^^ — THIS NEVER HAPPENS FOR EXTERNAL EVENTS
  }
)
```

Compare with the working collaboration step pattern (OnboardingCollaborationStep.tsx lines 97-119):
```typescript
// This WORKS — it calls loadUserSessions() in the callback
() => {
  loadUserSessions()  // ← actually triggers a refetch
}
```

**Required Fix:**
Destructure `refetch` from `useIncomingPairRequests` and call it in the realtime callback:
```typescript
const { data: incomingPairRequests, refetch: refetchPairRequests } = useIncomingPairRequests(userId)

// In the channel callback:
() => {
  refetchPairRequests()
}
```

**Why This Matters:**
The spec explicitly requires real-time pair requests (spec §7 "Common Mistakes to Watch For" item 3: "The pairing step should similarly subscribe to pair_requests inserts"). The implementor set up the subscription but forgot to wire the callback. This is the exact bug the spec warned about.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: GettingExperiencesScreen Uses Unnecessary Dynamic Imports for Already-Available Modules

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (lines 242-244)
**Category:** Performance / Code Correctness

**What's Wrong:**
GettingExperiencesScreen uses `await import()` for `supabase`, `useAppStore`, and `clearOnboardingData`. The implementor's rationale was: "The component is defined before OnboardingFlow and cannot access its closure."

This rationale is **incorrect**. All three are **module-level imports** (lines 26, 24, 33), not closure-scoped variables. Module-level imports are accessible to ALL code in the file, regardless of definition order. The dynamic imports add ~50-100ms of unnecessary latency during the launch sequence and could theoretically resolve different module instances in edge cases.

**Evidence:**
```typescript
// Line 26 — module-level, accessible to GettingExperiencesScreen
import { supabase } from '../services/supabase'
// Line 24
import { useAppStore } from '../store/appStore'
// Line 33
import { saveOnboardingData, clearOnboardingData } from '../utils/onboardingPersistence'

// Lines 242-244 — redundant dynamic imports
const { supabase } = await import('../services/supabase')       // ← unnecessary
const { useAppStore } = await import('../store/appStore')        // ← unnecessary
const { clearOnboardingData } = await import('../utils/onboardingPersistence')  // ← unnecessary
```

**Required Fix:**
Remove all three dynamic imports. Use the module-level imports directly:
```typescript
// Delete lines 242-244 entirely. Use supabase, useAppStore, clearOnboardingData directly.
```

**Why This Matters:**
Dynamic imports during the critical launch path add unnecessary latency. More importantly, the incorrect rationale suggests a misunderstanding of JavaScript module scope that could propagate to future code.

---

### HIGH-002: `incomingPendingRequests` Filter Uses `any` Type — Bypasses TypeScript

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (line 560)
**Category:** Type Safety

**What's Wrong:**
```typescript
(req: any) => req.type === 'incoming' && req.status === 'pending'
```
The `FriendRequest` type has `type?: "incoming" | "outgoing"` (optional). Using `any` hides this. If the `type` field is ever renamed or removed, TypeScript won't catch it.

**Required Fix:**
```typescript
(req: FriendRequest) => req.type === 'incoming' && req.status === 'pending'
```

Import `FriendRequest` from `'../services/friendsService'` if not already imported (it's imported in OnboardingFriendsAndPairingStep but not in OnboardingFlow).

---

### HIGH-003: `new Animated.Value(1)` Created on Every Render for Invited Friends

**File:** `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` (line 544)
**Category:** Performance / React Anti-Pattern

**What's Wrong:**
```typescript
const scale = friend.userId ? getPairAnimScale(friend.userId) : new Animated.Value(1)
```
For invited friends (no `userId`), a new `Animated.Value` instance is created on every render. This is wasteful and can cause animation glitches if React batches renders.

**Required Fix:**
Create a shared static value outside the component:
```typescript
// Module level, outside the component
const STATIC_SCALE = new Animated.Value(1)

// In render:
const scale = friend.userId ? getPairAnimScale(friend.userId) : STATIC_SCALE
```

---

### HIGH-004: Error State in GettingExperiencesScreen Is Dead Code — No Error UI Exists

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (lines 168, 318-336, 348-358)
**Category:** Dead Code / Spec Non-Compliance

**What's Wrong:**
The component declares `phase` state with type `'loading' | 'ready' | 'error'` and has a `handleRetry` function, but:
1. The `error` state is never set — the catch block on line 318 sets phase to `'ready'`, not `'error'`
2. The render function has no `{phase === 'error' && ...}` branch
3. `handleRetry` is never called

The design spec (ONBOARDING_UI_DESIGN_SPEC.md lines 291-294) specifies an error variant with `alert-circle` icon, "Something went wrong" headline, and retry/skip buttons. This was acknowledged as a deviation in the implementation report §6.

**Required Fix:**
Either implement the error UI per the design spec, or remove the dead code (`'error'` from the type, `handleRetry` function). Current state is misleading — it looks like error handling exists when it doesn't.

If implementing: set `setPhase('error')` in the catch block and add a render branch for the error state with retry and skip options.

---

### HIGH-005: GettingExperiencesScreen Doesn't Check Profile Update Response for Errors

**File:** `app-mobile/src/components/OnboardingFlow.tsx` (lines 248-255)
**Category:** Silent Failure / Data Integrity

**What's Wrong:**
The Supabase `.update()` call doesn't check the response for errors. Supabase client returns `{ data, error }` — if `error` is non-null, the update failed but the code proceeds as if it succeeded.

**Evidence:**
```typescript
// No error check — silently ignores failures
await supabase.from('profiles').update({
  has_completed_onboarding: true,
  onboarding_step: 0,
  // ...
}).eq('id', userId)
// ← .error is never checked
```

**Required Fix:**
```typescript
const { error } = await supabase.from('profiles').update({
  has_completed_onboarding: true,
  onboarding_step: 0,
  // ...
}).eq('id', userId)

if (error) throw error
```

**Why This Matters:**
Combined with CRIT-002, this means the launch sequence can "succeed" (show ready screen, let user enter app) while the DB still thinks onboarding isn't complete. On next app launch, the user is thrown back into onboarding.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: `console.error`/`console.warn` Used Instead of Project Logger

**Files:** Multiple
**Category:** Pattern Compliance

The project has a `logger` utility (imported in OnboardingFlow.tsx line 28). New code uses raw `console.error`/`console.warn` in several places:
- `OnboardingFriendsAndPairingStep.tsx` lines 225, 309
- `GettingExperiencesScreen` line 319
- `OnboardingCollaborationStep.tsx` lines 84, 199, 232, 258, 269

**Fix:** Replace with `logger.error()` / `logger.warn()` for consistent log formatting and future log aggregation.

---

### MED-002: Consent "Skip for Now" Label Implies Return — But Consent Is Permanent Skip

**File:** `app-mobile/src/components/onboarding/OnboardingConsentStep.tsx` (line 49)
**Category:** UX / Copy Integrity

`onDecline={() => goNext()}` advances permanently to `getting_experiences` and launches the app. The label "Skip for now" implies the user can return to consent later, which they cannot. Once onboarding completes, there's no way back.

The spec says "all substeps are skippable" which this satisfies technically. But the copy creates a false expectation.

**Fix:** Change label to "Maybe later" or "Not now" (less promissory), or add a consent prompt in app settings so users CAN return to it.

---

### MED-003: OnboardingCollaborationStep Has Dual Navigation (Own Buttons + Shell Back)

**File:** `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` (lines 498-511)
**Category:** UX Inconsistency

The collaboration step renders its own Continue and Skip buttons in scroll content, while the shell's bottom bar renders a Back button. The collaboration step's Continue and Skip buttons use `Pressable` while the rest of the onboarding uses `TouchableOpacity`. This creates a subtle difference in press feedback (Pressable has no default opacity change; TouchableOpacity does).

**Fix:** Either:
- Use `TouchableOpacity` with `activeOpacity={0.7}` for consistency, or
- Set `hideBottomBar={true}` for `collaborations` and add a Back button to the component itself

---

### MED-004: Friends Step Continue/Skip Duplicate Shell CTA Area

**File:** `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` (lines 712-723)
**Category:** UX Inconsistency

Same pattern as MED-003: The friends step has its own Continue and "I'll do this later" buttons at the bottom of scroll content, plus the shell renders a Back button in the fixed bottom bar. The Continue button in the component (orange, full-width, same height as shell CTA) looks identical to the shell's primary CTA style — the user sees what appears to be two CTAs stacked. The shell's Back button below the component's Skip text creates a 3-action stack.

**Fix:** Consider setting `hideBottomBar={true}` for `friends_and_pairing` as well, and adding a Back button to the component header or as a text link within the component.

---

### MED-005: `handleSendPairRequest` Sends Same Params for Tier 1 and Tier 2

**File:** `app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx` (lines 281-288)
**Category:** Logic Redundancy / Potential Confusion

**What's Wrong:**
```typescript
if (friend.friendshipStatus === 'friends') {
  params.friendUserId = friend.userId
} else {
  // Tier 2 — friend request pending, pair request hidden until friend
  params.friendUserId = friend.userId  // ← Same as Tier 1
}
```
Both branches set `params.friendUserId = friend.userId`. The if/else is unnecessary. The edge function determines the tier server-side based on friendship status — the client doesn't need to differentiate.

**Fix:** Simplify to:
```typescript
const result = await sendPairMutation.mutateAsync({ friendUserId: friend.userId })
```

---

## 🔵 Low Findings (Nice to Fix)

### LOW-001: Old OnboardingFriendsStep.tsx Still Exists (Confirmed Unused)

**File:** `app-mobile/src/components/onboarding/OnboardingFriendsStep.tsx`
**Category:** Cleanup

Acknowledged in implementation report. Not imported anywhere. Safe to delete.

---

### LOW-002: `fontWeight: fontWeights.bold as any` Pattern (Pre-existing)

**File:** `OnboardingFriendsAndPairingStep.tsx` (15+ instances)
**Category:** Pre-Existing Pattern

The `as any` cast on fontWeight is used throughout the codebase (OnboardingConsentStep, OnboardingShell, etc.). This is a React Native TypeScript limitation where `fontWeight` expects specific string literals. Not introduced by this change — pre-existing pattern.

---

### LOW-003: `getInitials` Returns Empty String for Empty/Undefined Names

**File:** `OnboardingFriendsAndPairingStep.tsx` (lines 391-392)
**Category:** Edge Case

If `name` is empty string, `getInitials('')` returns `''`. Not a crash, but renders an empty avatar. Consider fallback: `return initials || '?'`

---

## ✅ What Passed

### Things Done Right

1. **State machine rewrite is clean and correct.** The 7-step STEP_SUBSTEPS map is static (no dynamic path logic), the `indexOf` guard prevents the -1 bug documented in project memory, and the `stateRef` pattern correctly avoids React 18 batching traps. This is exactly the architecture the memory documents warned about needing.

2. **Production service usage is genuine.** The component imports and calls `useSendPairRequest`, `useAcceptPairRequest`, `useDeclinePairRequest`, `useIncomingPairRequests` — the same hooks used post-onboarding. No wrapper services, no onboarding-specific shortcuts. This eliminates drift risk.

3. **Backward-compatible persistence is well-implemented.** `onboardingPersistence.ts` strips 10 obsolete fields on load. Users who crash-resumed from the old version get clean data. The stripping is defensive (uses `delete` which is safe on non-existent properties).

4. **Pair pill state machine is correct.** `getPairPillState()` has clear priority: accepted/paired > sent/pending > sending > disabled > unpaired. No state can get stuck. The animation ref pattern is efficient (lazy creation).

5. **Path A/B/C removal is thorough.** Zero references to `pathA`, `pathB`, `choosePath`, `pitch`, `OnboardingSyncStep` in any onboarding file. The deletion was clean with no orphan code.

6. **Progress bar update is minimal and correct.** Only two changes: `SegmentedProgressBar` default from 5→7, `OnboardingShell` passes `7`. The type widened from literal `5` to `number` — appropriate since segments could change again.

7. **Copy deck compliance is near-perfect.** All headlines, subtitles, button labels, section labels, empty states, and skip text match the copy deck verbatim.

8. **GettingExperiencesScreen animation system is well-crafted.** Compass rotation, glow pulse, message cycling, phase transitions, spring-animated checkmark — all use `useNativeDriver: true` where possible, properly clean up with `cancelled` flag, and respect the 2500ms minimum display time.

---

## Spec Compliance Matrix

| # | Success Criterion | Tested? | Passed? | Evidence |
|---|-------------------|---------|---------|----------|
| 1 | Add friends (phone lookup → friend request) | ✅ | ✅ | `handlePhoneAction` → `supabase.from('friend_requests').upsert()` with real service |
| 2 | Invite non-Mingla friends (SMS share) | ✅ | ✅ | `createPendingInvite()` + `Share.share()` at lines 208-219 |
| 3 | Accept incoming friend requests | ✅ | ✅ | `onAcceptRequest` → `acceptFriendRequest()` (atomic RPC) |
| 4 | Send pair requests (Tier 1 and 2) | ✅ | ✅ | `sendPairMutation.mutateAsync(params)` at line 289 |
| 5 | Accept incoming pair requests | ✅ | ⚠️ | `acceptPairMutation.mutateAsync(request.id)` works, but real-time delivery is broken (CRIT-003) |
| 6 | Create collaboration sessions | ✅ | ✅ | Unchanged `createCollaborativeSessionV2` usage |
| 7 | Accept pending collaboration invites | ✅ | ✅ | Continue always enabled (line 129: `canContinue = true`) |
| 8 | All actions use real services/hooks | ✅ | ✅ | Verified: useFriends, usePairings, useSessionManagement — no wrappers |
| 9 | All substeps skippable | ✅ | ✅ | Continue always enabled, Skip on Steps 5-6, consent skip = advance |
| 10 | Path A/B/C removed | ✅ | ✅ | Zero references in onboarding files (grep verified) |
| 11 | Consent at Step 7 | ✅ | ✅ | State machine: Step 7 = ['consent', 'getting_experiences'] |
| 12 | Getting experiences screen | ✅ | ✅ | GettingExperiencesScreen renders at Step 7/getting_experiences |
| 13 | 7-segment progress bar | ✅ | ✅ | SegmentedProgressBar default=7, OnboardingShell totalSegments={7} |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Zero path code references remain" | ✅ | ✅ | grep confirms |
| "All 13 success criteria pass" | ✅ | ⚠️ | Criterion 5 partially broken due to CRIT-003 (realtime no-op) |
| "State machine transitions correctly through 7 steps" | ✅ | ✅ | Traced all transitions — correct |
| "Progress bar renders 7 segments" | ✅ | ✅ | Confirmed in SegmentedProgressBar and OnboardingShell |
| "Persistence layer strips obsolete fields" | ✅ | ✅ | 10 fields stripped in loadOnboardingData |
| "No new TypeScript errors" | ✅ | ⚠️ | No new TS errors, but `(req: any)` on line 560 is a type hole (HIGH-002) |
| "GettingExperiencesScreen encapsulates launch sequence" | ✅ | ⚠️ | Encapsulates animation, but launch logic has CRIT-001 and CRIT-002 defects |
| "Dynamic imports for modules component can't access" | ✅ | ❌ | Rationale is incorrect — module-level imports are accessible (HIGH-001) |
| "Real-time pair request listener added" | ✅ | ❌ | Listener exists but callback is empty — no-op (CRIT-003) |
| "OnboardingSyncStep.tsx deleted" | ✅ | ✅ | File removed, no dangling imports |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)
1. **CRIT-001**: Set `hideBottomBar={navState.subStep === 'getting_experiences'}` in OnboardingFlow.tsx line 2669
2. **CRIT-002**: Move `clearOnboardingData()` AFTER the profile update succeeds, await it, and check the profile update response for errors
3. **CRIT-003**: Destructure `refetch` from `useIncomingPairRequests` and call it in the realtime callback

### Strongly Recommended (merge at your own risk)
4. **HIGH-001**: Remove dynamic imports in GettingExperiencesScreen; use module-level imports
5. **HIGH-002**: Type the filter callback as `FriendRequest` instead of `any`
6. **HIGH-003**: Use shared static `Animated.Value` for invited friends
7. **HIGH-004**: Either implement error UI per design spec or remove dead code
8. **HIGH-005**: Check `.error` on the Supabase profile update response

### Technical Debt to Track
- OLD `OnboardingFriendsStep.tsx` should be deleted (LOW-001)
- `console.error`/`console.warn` should be migrated to `logger` (MED-001)
- Dual-CTA pattern (component buttons + shell back bar) on Steps 5-6 should be reviewed by design (MED-003, MED-004)

---

## Verdict Justification

**🔴 FAIL** — 3 critical findings. Do not merge. Return to implementor with this report.

The following must be fixed before re-testing:
- **CRIT-001**: Back button during launch → unrecoverable state
- **CRIT-002**: Premature data wipe → crash-resume destroyed on network failure
- **CRIT-003**: Empty realtime callback → incoming pair requests invisible

All three are straightforward fixes (5-15 minutes total). After these are resolved and HIGH-001 through HIGH-005 are addressed, a re-test limited to the launch sequence and pair request realtime flow should be sufficient — the rest of the implementation is solid and does not need re-testing.
