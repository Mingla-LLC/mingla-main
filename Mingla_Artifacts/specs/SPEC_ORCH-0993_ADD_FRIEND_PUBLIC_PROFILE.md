# SPEC — ORCH-0993 [Add Friend button on public profile]

**Mode:** SPEC (forensics)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0993-[add-friend-public-profile]/` on branch `ORCH-0993-add-friend-public-profile` (off main @ `830c52be2`)
**Author:** mingla-forensics+claude
**Date:** 2026-05-29
**Status:** READY FOR DESIGN + IMPLEMENT dispatch
**External-API:** N/A — this ORCH touches NO external API (Stripe/OpenAI/Places/OneSignal/etc.). COMMS-0003 docs-citation requirement does not apply. (Acked COMMS-0003 N/A, COMMS-0004 N/A — no INTAKE in this turn.)

---

## 1. Summary (layman)

A user looking at another person's profile they're **not yet friends with** sees an **"Add Friend"** button that sends a friend request through the existing system. The button reflects four relationship states (stranger, you-requested, they-requested-you, already-friends). The existing **Message** button stays exactly as-is — friend-only, no change. This is **frontend-only, zero backend change, zero migration**: the relationship state is derived from query data that the app already loads.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (🔒 LOCKED)
- Add a single new primary CTA — **Add Friend** — to `ViewFriendProfileScreen.tsx`, visible only to non-friend viewers of a viewable profile.
- The CTA reflects a **4-state relationship machine** (§4) with locked label/affordance/behavior per state.
- Wire the button to the **existing** `addFriend` / `acceptFriendRequest` / `cancelFriendRequest` mutations from `useFriends`.
- Truthful loading / success / error / block / self states (§7).
- Self-guard (never on own profile, §8).
- Analytics parity with existing `addFriend` flow + `source` decision (§9).

### 2.2 Non-Goals (🔒 LOCKED — do NOT build)
- **No discovery surface.** No people-search, no "People You May Know," no new entry points. Only the existing surfaces that already open `ViewFriendProfileScreen` (Your Circle tiles, group-session co-member avatars, chat avatars, friends list).
- **No stranger DM.** Message stays gated on `isFriend`; non-friends never see a Message button.
- **No privacy-settings screen.**
- **No change to `FriendActionsSheet`'s six actions** (pair/add-to-session/mute/remove/block/report). The sheet already receives `isFriend` and gates correctly. The block/report/mute path inside it is unchanged.
- **No backend / RPC / migration.** Proven in §5.

### 2.3 Assumptions (verified)
- A1 — `useFriendProfile(userId)` returns `isFriend: boolean` and renders for non-friends today (verified `useFriendProfile.ts:69`, `ViewFriendProfileScreen.tsx:417`). ✅
- A2 — `useFriends().addFriend(userId, "", username)` is the canonical "send a request by userId" call shape, already used by `AddFriendView.tsx:148` and `PendingCollabChatSheet.tsx:129`. ✅
- A3 — `useFriendRequests(userId)` (= `friendsKeys.requests`) returns BOTH incoming + outgoing pending requests, each tagged `type: "incoming" | "outgoing"` with `sender_id` / `receiver_id` (verified `friendsService.ts:119-199`). ✅
- A4 — `friend_requests.source` enum is `'app' | 'map' | 'onboarding' | 'session'` and `addFriend`'s INSERT does NOT set `source`, so it defaults to `'app'` (verified migration line 8321-8322 + `useFriends.ts:201-210`). ✅
- A5 — Viewing a non-friend profile is already possible (friend-of-friend + co-attendee tiers in Your Circle); RLS allows the profile read. The button does not change visibility/RLS. ✅

---

## 3. Data-Source Decision (the crux) — 🔒 LOCKED

### 3.1 Decision: **Client-side derivation from `useFriendRequests`. FRONTEND-ONLY. NO BACKEND CHANGE. NO MIGRATION.**

`ViewFriendProfileScreen` will read the **already-loaded** friend-requests query and derive the relationship state client-side, combined with the existing `profile.isFriend`.

### 3.2 The two options considered

**Option (a): extend `useFriendProfile` to return a richer relationship enum (backend-ish — new query columns/RPC).**
- Would mean `useFriendProfile`'s `queryFn` runs extra `friend_requests` SELECTs (or a new RPC) and returns `relationship: 'stranger' | 'outgoing_pending' | 'incoming_pending' | 'friends'` plus the pending `requestId`.
- **Rejected.** Violates Constitution #2 (one owner per truth) and #4 (one key per entity): `friend_requests` already has an owner — the `friendsKeys.requests(userId)` query in `useFriendsQuery.ts`, consumed app-wide (ConnectionsPage, notifications, pairing reveal). Duplicating that read inside `friendProfileKeys.detail` creates a **second authority** for pending-request truth with its own `staleTime` (2 min vs 30 s) and its own cache, which will drift: accept a request elsewhere and the profile's copy stays stale for up to 2 minutes. It also needs the `requestId` for cancel/accept — re-deriving that in a second place is exactly the duplication the constitution forbids.

**Option (b): derive pending state client-side from `useFriendRequests` (the existing owner).** ✅ **CHOSEN.**
- `friendsKeys.requests(userId)` is the single existing owner of pending-request truth. It already returns `type`, `sender_id`, `receiver_id`, and the request `id`. The `addFriend` / `acceptFriendRequest` / `cancelFriendRequest` mutations in the SAME `useFriends` hook already invalidate this exact key — so the button updates the instant a mutation completes, with **zero new cache wiring**.
- `profile.isFriend` (from `useFriendProfile`) remains the single owner of the friends-edge truth.
- Net: the button reads from the two existing owners and adds no third.

### 3.3 Proof it is frontend-only (no backend change)
1. **Send a request** → `addFriend(userId, "", username)` already exists, already invalidates `friendsKeys.requests` (`useFriends.ts:249`). The INSERT path, RLS (`fr_insert` policy line 15721), and unique constraint (`sender_id,receiver_id` line 10579) are all already live. ✅
2. **Cancel an outgoing request** → `cancelFriendRequest(requestId)` already exists, deletes the row, invalidates `friendsKeys.requests` (`useFriends.ts:457-474`). ✅
3. **Accept an incoming request** → `acceptFriendRequest(requestId)` already exists (atomic RPC `accept_friend_request_atomic`), invalidates `friendsKeys.all` + `circleKeys.all` + pairings (`useFriends.ts:259-366`). ✅
4. **Read pending state** → `useFriendRequests(currentUserId)` already loaded app-wide. The profile screen just calls the existing hook. ✅
5. **The `requestId`** needed for cancel/accept is already present in each `FriendRequest` row (`friendsService.ts:160,181`). ✅

No new table, column, constraint, RLS policy, RPC, or edge function. **Migration required: NONE.**

### 3.4 The derivation (exact logic — 🔒 LOCKED)
Inside `ViewFriendProfileScreen`, after `useFriendProfile` and a new `useFriendRequests(currentUserId)` call:

```
relationship =
  profile.isFriend                                   → 'friends'
  else outgoing pending row where receiver_id===userId → 'outgoing_pending' (carry requestId)
  else incoming pending row where sender_id===userId   → 'incoming_pending' (carry requestId)
  else                                                 → 'stranger'
```
- `outgoing` = `friendRequests.find(r => r.type === 'outgoing' && r.receiver_id === userId && r.status === 'pending')`
- `incoming` = `friendRequests.find(r => r.type === 'incoming' && r.sender_id === userId && r.status === 'pending')`
- `friends` wins over any pending row (defensive: if a stale pending row coexists with an accepted edge, treat as friends).
- Self-guard (§8) short-circuits to render NOTHING before this runs.

---

## 4. The 4-State Relationship Machine — 🔒 LOCKED

| State | Condition | Button shown | Label | Icon | On press | Post-action |
|-------|-----------|--------------|-------|------|----------|-------------|
| **Stranger** | not friend, no pending either way | **Add Friend** (primary, filled) | `profile:friend.add_friend` → "Add Friend" | `person-add-outline` | `addFriend(userId, "", username)` | optimistic → "Requested" (becomes outgoing_pending) |
| **Outgoing pending** | you sent a request | **Requested** (secondary/outline, tappable) | `profile:friend.requested` → "Requested" | `time-outline` | Confirm dialog → `cancelFriendRequest(requestId)` | reverts to Stranger ("Add Friend") |
| **Incoming pending** | they sent YOU a request | **Accept Request** (primary, filled, accent) | `profile:friend.accept_request` → "Accept Request" | `checkmark-outline` | `acceptFriendRequest(requestId)` | becomes Friends → Add-Friend region disappears, Message appears |
| **Friends** | accepted edge exists | NO Add-Friend button | — | — | — | existing Message button renders (unchanged, `ViewFriendProfileScreen.tsx:417`) |

### 4.1 Locked decisions on ambiguous affordances
- **Outgoing pending → "Requested" is tappable and cancels** (with a confirm dialog), 🔒 LOCKED. Rationale: matches the existing mental model where outgoing requests are cancellable (`cancelFriendRequest` exists and is wired in ConnectionsPage); a dead "Requested" pill would violate Constitution #1 (no dead taps). Confirm dialog copy in §7.4.
- **Incoming pending → "Accept Request"** is the single CTA in the primary region 🔒 LOCKED. **Decline is NOT surfaced here** (out of scope — decline lives in the requests inbox; adding it would expand the CTA region to two buttons and duplicate inbox affordances). The viewer can still ignore; accepting is the connect-first action this ORCH is about.
- **Friends** → Add-Friend region renders nothing; existing Message button is the only CTA (unchanged).

---

## 5. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---------|----------|---------------------------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ YES | Add-Friend CTA renders in `ViewFriendProfileScreen.tsx`. Parity with Android is **automatic** (single shared RN component, single shared hook). SC-1..SC-9 apply. |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ YES | Same shared component/hook as iOS — automatic parity. Tester still verifies on emulator per parity rule (haptics + press feedback are the only platform-divergent bits, both already handled by `expo-haptics` + `activeOpacity`). |
| 3 | **Buyer/anonymous Web** (`mingla-business/` buyer routes) | ❌ NO | No user-profile surface exists on buyer-web; `ViewFriendProfileScreen` is a consumer-app-only component. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ❌ NO | mingla-business has no consumer user-profile surface and no friend graph; the friend system is consumer-app-only. |
| 5 | **Business Android** (`mingla-business/` Android) | ❌ NO | Same as Business iOS — no friend graph. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ NO | Admin renders no user-to-user profile / friend CTA. |
| 7 | **Business Web preview** | ❌ NO | Same as Business iOS/Android — no friend graph. |

**Parity is automatic** (single shared component + hook), so success criteria are NOT split per-platform; the tester verifies iOS sim + Android emulator both render the same component path.

---

## 6. Layer-by-Layer Functional Contract

### 6.1 Database — 🔒 LOCKED: **NO CHANGE.** (proof §3.3) No migration file in this ORCH.

### 6.2 Edge functions — 🔒 LOCKED: **NO CHANGE.** `send-friend-request-email` / `send-friend-accepted-notification` already fire from the existing mutations.

### 6.3 Service layer — 🔒 LOCKED: **NO CHANGE.** `friendsService.fetchFriendRequests` already returns the exact shape needed.

### 6.4 Hook layer — 🔒 LOCKED
- **Consume existing hooks only.** In `ViewFriendProfileScreen`, add:
  - `const { addFriend, acceptFriendRequest, cancelFriendRequest } = useFriends();`
  - `const { data: friendRequests = [] } = useFriendRequests(currentUserId);` — query key `friendsKeys.requests(currentUserId ?? "")`, `staleTime` 30 s (existing), `enabled: !!currentUserId` (existing). NO new query key, NO new staleTime.
- **No optimistic cache write needed** beyond the existing invalidation: `addFriend`/`cancel`/`accept` already invalidate `friendsKeys.requests` (and `friendsKeys.all` for accept), so the derived state flips on settle. A local `submitting` state (§7) covers the in-flight window so the button isn't visually stale during the ~300-800ms round-trip.
- 🎨 OPEN: the implementor MAY add a `useMutation` wrapper around `addFriend` for cleaner `isPending` handling, OR use a local `useState<'idle'|'submitting'|'error'>` — either is acceptable as long as the in-flight + error states (§7) are truthful. Do NOT introduce a new persistent query key.

### 6.5 Component layer — 🔒 LOCKED (functional) + 🎨 OPEN (visual craft, see §7 + DESIGN pass)
- **File:** `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
- **Insertion point:** the CTA region currently at lines **417-428** (the `onMessage && profile.isFriend` block). The new Add-Friend CTA renders in the SAME region, BEFORE the bio→vibe content, replacing the empty space that non-friends see today.
- **Render rule (exact):**
  ```
  if (isSelf) → render nothing in CTA region
  else if relationship === 'friends' → existing Message button (unchanged, lines 417-428)
  else → <AddFriendCta state={relationship} ... /> (new)
  ```
- **Props the CTA needs:** `relationship`, `name`, `submitting`, `error`, `onAddFriend`, `onCancelRequest`, `onAcceptRequest`.
- 🎨 OPEN: the implementor decides whether `AddFriendCta` is an inline block in `ViewFriendProfileScreen` or a small co-located sub-component. Either is fine; keep it in the same file or a sibling under `profile/`. Do NOT touch `FriendActionsSheet.tsx` functionally (it already receives correct `isFriend`).
- **`FriendActionsSheet` interaction:** unchanged. The ••• menu still opens the sheet. Block/report/mute remain there.

### 6.6 Realtime — 🔒 LOCKED: **NO new subscription.** Freshness rides the existing `useFriendRequests` Realtime + focusManager + 30 s staleTime + invalidation-on-mutation (`useFriendsQuery.ts:18-26`).

---

## 7. All-States Contract (truthful in every state — Constitution #3) — 🔒 LOCKED copy, 🎨 OPEN visual feel

> Visual tokens (color/typography/spacing/safe-area/motion) are produced by the **mandatory `mingla-designer` DESIGN pass** (§11). This section locks the **functional behavior + Mingla-voice copy** of every state; the designer locks the pixels. The CTA sits in the existing primary-action region (same horizontal padding `s(20)`, same `borderRadius: s(999)` pill language as the current Message button at `styles.messageButton` lines 803-822) so it inherits the established button system.

| State | Trigger | What the user sees | Copy (i18n key → value) |
|-------|---------|--------------------|--------------------------|
| **Stranger (default)** | non-friend, no pending | Filled primary "Add Friend" pill with `person-add-outline` | `profile:friend.add_friend` = "Add Friend" |
| **Submitting (send)** | tapped Add Friend, request in flight | Same pill, disabled, spinner replaces icon, label "Sending…" | `profile:friend.sending` = "Sending…" |
| **Outgoing pending** | request sent / on load | Outline/secondary "Requested" pill with `time-outline`, tappable | `profile:friend.requested` = "Requested" |
| **Submitting (cancel)** | confirmed cancel, in flight | "Requested" pill disabled + spinner | `profile:friend.canceling` = "Canceling…" |
| **Incoming pending** | they requested you | Filled accent "Accept Request" pill with `checkmark-outline` | `profile:friend.accept_request` = "Accept Request" |
| **Submitting (accept)** | tapped accept, in flight | Disabled + spinner, "Accepting…" | `profile:friend.accepting` = "Accepting…" |
| **Friends** | accepted | NO Add-Friend pill; existing Message button | (unchanged — `profile:friend.message`) |
| **Error** | mutation throws | pill returns to its pre-action state + inline error line below the pill | see §7.3 |
| **Empty/loading profile** | `useFriendProfile` loading/error | unchanged — existing loading/error screens (lines 296-340); CTA not rendered | (unchanged) |
| **Offline** | network down on tap | Error path (§7.3) — pill stays in pre-action state, error line shown | `profile:friend.error_network` |
| **First-time / returning / degraded** | n/a | No distinct state — relationship state is the only axis; no first-run coachmark in scope | — |

### 7.1 Success (send) — 🔒 LOCKED
- `addFriend` resolves → `Haptics.notificationAsync(Success)` → query invalidation flips derived state to `outgoing_pending` → pill becomes "Requested". **No toast** (the in-place pill transition is the success signal, matching `AddFriendView`/`PendingCollabChatSheet` which also rely on state transition, not a toast). 🎨 OPEN: implementor MAY add a brief haptic-only confirmation; do NOT add a blocking modal.

### 7.2 Success (accept) — 🔒 LOCKED
- `acceptFriendRequest` resolves → `Haptics.notificationAsync(Success)` → `friendsKeys.all` invalidation flips `profile.isFriend` true → Add-Friend region disappears, Message button appears in the same region. This is the connect-first payoff and MUST be visible without a manual refresh.

### 7.3 Error — 🔒 LOCKED (Constitution #3 — no silent failure)
- Any mutation rejection → `Haptics.notificationAsync(Error)`, pill returns to its **pre-action** state (Add Friend / Requested / Accept), and an inline error line renders directly below the pill (NOT an Alert, so it doesn't steal focus). Copy:
  - Generic: `profile:friend.error_generic` = "Couldn't send that. Tap to try again."
  - Network: `profile:friend.error_network` = "You're offline. Check your connection and try again."
  - User-not-found (the `addFriend` "User not found" throw, `useFriends.ts:109`): `profile:friend.error_unavailable` = "This person isn't available right now."
- The pill itself remains the retry affordance (tapping it re-runs the action). 🎨 OPEN: implementor chooses whether to map specific `error.message` substrings to the 3 copies or show generic + log; mapping the 3 is preferred.

### 7.4 Cancel confirm dialog — 🔒 LOCKED
- Tapping "Requested" → `Alert.alert` (matches existing pattern in this file, lines 239-257):
  - Title: `profile:friend.cancel_request_title` = "Cancel friend request?"
  - Body: `profile:friend.cancel_request_body` = "{{name}} won't be notified."
  - Buttons: `common:keep` = "Keep" (cancel-style) / `profile:friend.cancel_request_confirm` = "Cancel request" (destructive) → `cancelFriendRequest(requestId)`.

### 7.5 Accessibility — 🔒 LOCKED
- Each pill: `accessibilityRole="button"`, `accessibilityLabel` reflecting state + name (e.g. `Add ${name} as a friend`, `Cancel friend request to ${name}`, `Accept friend request from ${name}`), `accessibilityState={{ disabled: submitting, busy: submitting }}`. Min target 44pt (existing `paddingVertical: vs(16)` already exceeds).

---

## 8. Self-Guard — 🔒 LOCKED
- `const isSelf = !!currentUserId && currentUserId === userId;`
- If `isSelf`, render NOTHING in the CTA region (no Add Friend, no Message). The ••• menu actions that target self are already guarded upstream (this screen is reached via others' profiles), but the self-guard is defensive and MUST exist. Tester verifies by navigating to own profile id.

---

## 9. Block / Privacy — 🔒 LOCKED
- **Fail-closed via existing machinery — verified, NO new code.**
- `addFriend` already routes block/visibility through `resolve_user_visibility_by_identifier` for the email path; for the **userId path** (which this ORCH uses), `addFriend` reads the target profile and the `fr_insert` RLS + the blocked-relationship checks already in the friend system govern the INSERT. If the viewer is blocked-by / has-blocked the target, the profile is typically not viewable in the first place (blocked users don't surface in Your Circle / co-attendee tiers per `are_friends_or_fof` + block filters).
- **UI behavior on a blocked-path rejection:** the mutation throws → §7.3 error path renders `profile:friend.error_unavailable` = "This person isn't available right now." The button does NOT optimistically flip to "Requested" on a throw (pre-action state is restored). 🔒 LOCKED: never show success when the DB write failed.
- **Out of scope:** this ORCH does not add new block-detection; it relies on the existing fail-closed behavior. If the tester finds a path where a blocked target's profile IS viewable AND `addFriend` silently succeeds, that is a **pre-existing** block-enforcement gap → register as a discovery, do not fix here.

---

## 10. Analytics + `source` — 🔒 LOCKED
- **No new analytics events.** The existing `addFriend` already fires `logAppsFlyerEvent('af_invite', { af_type: 'friend_request' })` and `mixpanelService.trackFriendRequestSent({ recipientUsername })` (`useFriends.ts:222-223`). Accept already has its own analytics in the accept flow. Reusing `addFriend` means analytics parity is automatic.
- **`friend_requests.source` decision:** keep the existing default **`'app'`**. 🔒 LOCKED — do NOT add a `'profile'` source value and do NOT pass a `source` arg.
  - Rationale: the enum is `'app' | 'map' | 'onboarding' | 'session'` (migration line 8322). `'app'` already means "in-app friend request" and is what every in-app userId-path request records today. Adding `'profile'` would require an enum migration (CHECK constraint ALTER) — explicitly out of the frontend-only scope and unjustified, since profile is just another in-app surface. The "where did this come from" signal is already covered by Mixpanel surface context if needed later; the DB `source` column distinguishes app vs map (geo) vs onboarding vs session (collab), and profile-originated requests are squarely `'app'`.
  - If product later wants per-surface attribution, that is a separate analytics ORCH (register, don't build).

---

## 11. Visual & UX Contract — DESIGN pass REQUIRED (Phase 3.6)

This spec owns the **functional contract + UX acceptance bar** (above). The **granular visual contract** (exact tokens, light+dark, contrast ratios, spacing grid, motion timing, press feedback, no-slop bans, References-examined line) MUST be produced by a **mandatory `mingla-designer` DESIGN pass** before IMPLEMENT, scoped to the Add-Friend CTA's three visible states.

### 11.1 Locked design floor the designer must honor (🔒 LOCKED)
- The CTA lives in the existing primary-action region and inherits the established pill system: `borderRadius: s(999)`, `paddingVertical: vs(16)`, full-width, `marginTop/Bottom: vs(16)` (mirrors `styles.messageButton`).
- **Stranger ("Add Friend")** = the brand-primary filled treatment. Existing brand orange `#eb7825` is the established primary accent in this screen (loading spinner, primary button). Designer confirms whether Add-Friend uses `#eb7825` filled (recommended — it's the "go" action) or the dark `#111827` Message treatment; they must NOT both look identical or the hierarchy collapses.
- **Outgoing ("Requested")** = secondary/outline (lower emphasis than primary), still ≥44pt, still obviously tappable.
- **Incoming ("Accept Request")** = highest-emphasis filled (this is the moment we most want the user to complete).
- Contrast: button label ≥ 4.5:1 on its fill, both light and dark.
- **No-AI-slop bans (🔒 LOCKED):** no generic purple→blue gradient, no emoji as the button icon (use the named Ionicons: `person-add-outline` / `time-outline` / `checkmark-outline`), no decorative glow. Restrained, one primary action.
- Safe-area: CTA is inside the existing `ScrollView` sheet with `paddingHorizontal: s(20)`; no new safe-area handling needed (sheet already handles it).

### 11.2 🎨 OPEN (designer + implementor craft)
- Exact press-state opacity/scale and the micro-transition between states (e.g. cross-fade Add→Requested), within 150-300ms, with `prefers-reduced-motion` fallback to instant.
- Whether the spinner sits inline-left or replaces the icon during submitting.
- Exact outline/secondary token for "Requested" (any token that reads as lower-emphasis and hits contrast).

**References examined (to be expanded by designer):** Instagram "Follow/Requested/Message" profile CTA state machine; Strava "Follow/Requested"; LinkedIn "Connect/Pending/Message". Synthesize the connect-first state transitions; do NOT clone visuals.

---

## 12. Success Criteria (observable / testable / unambiguous)

- **SC-1** Viewing a stranger's profile (not friends, no pending) shows a filled "Add Friend" pill in the primary CTA region; no Message button.
- **SC-2** Tapping "Add Friend" calls `addFriend(userId, "", username)`, shows a "Sending…" disabled state, then on success the pill becomes "Requested" — without a manual refresh.
- **SC-3** Viewing a profile where the viewer has an outgoing pending request shows "Requested" (tappable). Tapping it shows the cancel confirm dialog; confirming calls `cancelFriendRequest(requestId)` and the pill reverts to "Add Friend".
- **SC-4** Viewing a profile where the target sent the viewer a pending request shows "Accept Request". Tapping it calls `acceptFriendRequest(requestId)`; on success the Add-Friend region disappears and the Message button appears.
- **SC-5** Viewing a friend's profile shows the existing Message button and NO Add-Friend pill (unchanged behavior).
- **SC-6** Viewing one's own profile (currentUserId === userId) shows neither Add-Friend nor Message.
- **SC-7** When any mutation throws, the pill returns to its pre-action state, an inline error line appears with the correct copy, and error haptic fires — no toast claiming success, no Alert that steals focus, no dead/stuck pill.
- **SC-8** `friend_requests` rows created from the profile have `source = 'app'` (default); no `'profile'` value exists in the enum; no migration shipped.
- **SC-9** No new query key, no new staleTime, no new Realtime subscription, no new edge function, no backend file in the diff. (Grep gate, §15.)

---

## 13. Invariants

### 13.1 Preserved (must not break)
- **I-CONST-2 (one owner per truth):** pending-request truth stays owned by `friendsKeys.requests`; friends-edge truth stays owned by `useFriendProfile.isFriend`. The CTA reads, never writes a competing copy. Test: SC-9 grep + manual cache inspection.
- **I-CONST-3 (no silent failures):** §7.3. Test: SC-7.
- **I-CONST-4 (one key per entity):** no new key for friend_requests. Test: SC-9.
- **I-CONST-1 (no dead taps):** "Requested" is tappable (cancel); every pill responds. Test: SC-3.
- **Message-friend-gate invariant:** Message button remains gated on `profile.isFriend` (line 417 condition unchanged). Test: SC-5 + SC-1 (no Message for stranger).

### 13.2 New
- **I-PROPOSED-PROFILE-ADD-FRIEND-STATE-DERIVED (DRAFT → ACTIVE on CLOSE):** the Add-Friend CTA state is derived purely from the existing `useFriendRequests` + `useFriendProfile.isFriend`; no third owner of relationship truth may be introduced on the profile surface.

---

## 14. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (happy) | Stranger sends request | tap Add Friend | `addFriend` called → "Sending…" → "Requested"; `friend_requests` row `source='app'` | Full stack |
| T-02 (happy) | Accept incoming | tap Accept Request | `acceptFriendRequest(requestId)` → friends edge created → Message button appears | Full stack |
| T-03 (happy) | Cancel outgoing | tap Requested → confirm | `cancelFriendRequest(requestId)` → row deleted → pill reverts to Add Friend | Hook + DB |
| T-04 (state) | Friend profile | open friend | NO Add-Friend pill; Message shows | Component |
| T-05 (self) | Own profile | currentUserId===userId | neither button renders | Component |
| T-06 (error) | Network failure on send | offline + tap | error haptic, pill back to "Add Friend", inline `error_network` copy, NO "Requested" | Hook + Component |
| T-07 (error) | `addFriend` throws "User not found" | mock reject | pill restored, `error_unavailable` copy | Hook + Component |
| T-08 (edge/adversarial) | Stale pending row + accepted edge coexist | profile.isFriend=true AND outgoing pending row present | shows Friends/Message (friends wins), NOT "Requested" | Component derivation |
| T-09 (adversarial) | Rapid double-tap Add Friend | tap twice fast | disabled-during-submit prevents 2nd call; unique constraint `sender_id,receiver_id` is the DB backstop (idempotent) | Component + DB |
| T-10 (regression) | Existing Message flow | friend taps Message | `onMessage(userId)` fires exactly as before | Component |

- **Implementor regression target (Step 0.5):** T-04 + T-10 — prove the existing friend Message path is byte-for-byte unchanged.
- **Tester adversarial angle:** T-08 (stale-row vs accepted-edge race) + T-09 (double-tap idempotency) + T-06/T-07 (error truthfulness). Live-fire on iOS sim + Android emulator (parity is automatic but must be observed on both per the parity rule).

---

## 15. Implementation Order + Regression Prevention

### 15.1 Order
1. Add i18n keys to `app-mobile/src/i18n/locales/en/profile.json` under `friend.*` (`add_friend`, `requested`, `accept_request`, `sending`, `canceling`, `accepting`, `error_generic`, `error_network`, `error_unavailable`, `cancel_request_title`, `cancel_request_body`, `cancel_request_confirm`) + `common.keep`. Mirror into other locale files per the repo's i18n convention.
2. DESIGN pass (`mingla-designer`) produces the visual contract for the 3 CTA states.
3. Implement the derivation + `AddFriendCta` in `ViewFriendProfileScreen.tsx` (consume `useFriends` + `useFriendRequests`).
4. Wire self-guard, error states, cancel confirm, haptics, a11y.
5. Verify SC-9 grep gate locally.

### 15.2 Regression prevention
- Protective comment at the CTA derivation block: `// ORCH-0993: relationship state is DERIVED from useFriendRequests (one owner) — do NOT add a second pending-request read here (I-CONST-2/4).`
- The Message-gate condition (`profile.isFriend`) is NOT modified — the new CTA is an `else` branch, structurally guaranteeing Message stays friend-only.

---

## 16. File List To Be Touched

| File | Change | Backend? |
|------|--------|----------|
| `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | Add derivation + `AddFriendCta` in the CTA region (lines ~417-428 area); consume `useFriends` + `useFriendRequests`; self-guard | No |
| `app-mobile/src/i18n/locales/en/profile.json` (+ sibling locales) | New `friend.*` strings + `common.keep` | No |
| **(DESIGN)** designer artifact under `Mingla_Artifacts/` | Visual contract for 3 CTA states | No |

**NOT touched:** `useFriends.ts`, `useFriendsQuery.ts`, `useFriendProfile.ts`, `friendsService.ts`, `FriendActionsSheet.tsx`, any migration, any edge function, any RPC. (`useFriendProfile.ts` is touched ONLY if the implementor finds, during build, that `isFriend` alone is insufficient — the spec's derivation says it is NOT needed, so default = untouched. If the implementor believes it's needed, that's a spec deviation requiring orchestrator sign-off.)

---

## 17. Cross-ORCH Coordination

- **ORCH-0990 [friend-page + pills relocate]** touches `ConnectionsPage.tsx` (friend page + pills). **This ORCH does NOT touch `ConnectionsPage.tsx`** — it touches `ViewFriendProfileScreen.tsx` + `profile.json`. **Zero file overlap.** No coordination needed. (If ORCH-0990 also re-routes how profiles are opened from ConnectionsPage, that only changes the *entry* to `ViewFriendProfileScreen`, not the screen itself — still no conflict.)
- No COMMS ledger entry needed (no cross-ORCH file collision discovered).

---

## 18. Related Risk — OUT OF SCOPE (AWARE-ONLY, do NOT fix here)

**Ungated direct-conversation path.** The orchestrator INTAKE investigation found that the `get_or_create_direct_conversation` RPC / `ensureConversation()` path has **no friendship gate**, whereas the deprecated `getOrCreateDirectConversation()` did. Because this ORCH keeps Message **UI-gated** on `isFriend`, no new ungated-DM surface is introduced here. However, the latent ungated `ensureConversation()` path is a **separate security concern** (a caller could open a conversation with a non-friend by invoking the RPC directly, bypassing the UI gate). **Flag for a future security ORCH** — do NOT address in ORCH-0993. Registered here as a discovery for the orchestrator.

---

## 19. Granularity Completion Gate (self-check — all hold)
- [x] Functional contract complete for every touched layer (DB=none, edge=none, service=none, hook=consume-existing, component=specified, realtime=none). §6
- [x] UI surface visual/UX contract pinned via required DESIGN pass + locked floor §11; all 9 states with copy §7.
- [x] No-AI-slop bans stated §11.1; References-examined line §11.2.
- [x] Every requirement tagged 🔒 LOCKED or 🎨 OPEN; OPEN section present (§6.4, §7.1, §7.3, §11.2).
- [x] Success criteria observable/testable/unambiguous §12; parity automatic (single component) so not split.
- [x] Invariants named §13; test cases happy/error/edge §14; implementation order §15; regression prevention §15.2.
- [x] Zero hand-wave.
- [x] Data-source decision made + justified + proven frontend-only §3; migration = NONE.
- [x] Self/error/block/empty states covered §7-9.
- [x] Analytics + source decision §10. Cross-surface §5. Out-of-scope risk §18.
