# IMPLEMENTATION — ORCH-0993 [Add Friend button on public profile]

**Skill:** mingla-implementor+claude
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0993-[add-friend-public-profile]/` on branch `ORCH-0993-add-friend-public-profile` (off main @ `830c52be2`)
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-0993_ADD_FRIEND_PUBLIC_PROFILE.md` + `Mingla_Artifacts/design/DESIGN_ORCH-0993_ADD_FRIEND_CTA.md`
**Status:** implemented and verified (frontend-only; sim/device UX verification deferred to tester per parity rule)
**External-API:** N/A — touches no external API. COMMS-0003 docs-citation N/A.

---

## 1. Comms Ledger
Read on entry. COMMS-0001/0005/0006/0007/0008/0009/0010 are scoped to other ORCH-IDs → not applicable. COMMS-0002 (strict-grep backend gate), COMMS-0003 (external-API docs), COMMS-0004 (INTAKE numbering) are `ALL` WARN but all concern backend/strict-grep/external-API/INTAKE — ORCH-0993 is frontend-only, zero backend touch, no INTAKE → N/A for all three. No BLOCK entry targets this skill or ORCH-0993. No new ledger entry needed (no cross-ORCH file collision discovered; zero overlap with ORCH-0990's `ConnectionsPage.tsx` lane).

---

## 2. What was built (layman)
A user viewing someone they're not yet friends with now sees an Add-Friend CTA in the same spot the Message button sits for friends. It reflects four states — Add Friend / Requested / Accept Request / (friends → Message). Sending, accepting, and cancelling all use the friend system already in the app; nothing new on the backend.

---

## 3. Old → New Receipts

### `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
**Before:** Non-friend viewers saw NO primary CTA (the `onMessage && profile.isFriend` block rendered nothing for them); only friends saw the Message button.
**Now:**
- New `AddFriendCta` presenter sub-component (state-driven single `TouchableOpacity` chassis + inline error row) implementing all 3 visible states + submitting/disabled/error per DESIGN §1–§5, with the 200ms cross-fade + 0.98→1.0 scale transition (§4) gated behind `AccessibilityInfo.isReduceMotionEnabled()` (reduced-motion → instant swap).
- Relationship derivation in the parent: `friends` (from `profile.isFriend`, wins over stale pending rows) → `outgoing_pending` → `incoming_pending` → `stranger`, derived from the existing `useFriendRequests(currentUserId)` owner. Protective comment added per SPEC §15.2.
- Self-guard `isSelf`; the CTA region renders nothing on own profile.
- CTA region is now `isSelf ? null : relationship === 'friends' ? <existing Message, gate unchanged> : <AddFriendCta>` — the new CTA is the `else` branch, so the friend-only Message gate (`onMessage && profile.isFriend`) is structurally untouched.
- Handlers `handleAddFriend` / `handleAcceptRequest` / `doCancelRequest` call the existing `addFriend(userId, "", username)` / `acceptFriendRequest(id)` / `cancelFriendRequest(id)` from `useFriends`; success + error haptics; inline 3-way error classification (network / unavailable / generic); cancel via `Alert.alert` (SPEC §7.4) using `common:keep` + `profile:friend.cancel_request_confirm`.
- `CTA_LIGHT` built live; `CTA_DARK` map present as drop-in (no `useColorScheme` hook added per SPEC §16). `ctaStyles` StyleSheet added.
**Why:** SPEC §4 state machine + §6.5 render rule + §7 states + §8 self-guard; DESIGN §1–§7 tokens.
**Lines changed:** ~+260.

### `app-mobile/src/i18n/locales/{29 locales}/profile.json`
**Before:** `friend.*` block had no Add-Friend strings.
**Now:** added `add_friend`, `requested`, `accept_request`, `sending`, `canceling`, `accepting`, `error_generic`, `error_network`, `error_unavailable`, `cancel_request_title`, `cancel_request_body`, `cancel_request_confirm` — properly translated per locale (SPEC §15.1).
**Why:** SPEC §7 copy + §15.1. **Lines changed:** +12 keys × 29 files.

### `app-mobile/src/i18n/locales/{29 locales}/common.json`
**Before:** no `keep` key.
**Now:** added `keep` (the cancel-confirm "Keep" button), translated per locale.
**Why:** SPEC §7.4 (`common:keep`). **Lines changed:** +1 key × 29 files.

### `app-mobile/src/components/profile/__tests__/orch-0993-add-friend-cta.happy.test.tsx` (NEW)
Implementor happy-path regression (T-04 + T-10). See §6.

> Note: the only incidental change in the en/es/etc profile.json diffs is a single pre-existing `loading_profile` value where `…` normalized to a literal `…` (same JSON value, consistent with siblings that already store literal accented chars). Trailing-newline state preserved per file.

---

## 4. Spec Traceability (Success Criteria)

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 stranger → filled Add Friend, no Message | PASS | `relationship === 'stranger'` → `AddFriendCta` (else branch); Message only under `'friends'`. |
| SC-2 tap → Sending… → Requested w/o refresh | PASS | `handleAddFriend` sets `ctaInFlight='send'`; `addFriend` invalidates `friendsKeys.requests` → derived state flips to `outgoing_pending`. |
| SC-3 outgoing → Requested tappable → confirm → cancel → Add Friend | PASS | `onCancelRequest` → `Alert.alert` (keep/cancel) → `doCancelRequest` → `cancelFriendRequest`. |
| SC-4 incoming → Accept → friends → Message appears | PASS | `handleAcceptRequest` → `acceptFriendRequest` invalidates `friendsKeys.all` → `isFriend` true → Message renders. |
| SC-5 friend → Message, no Add-Friend | PASS | gate unchanged; regression test T-04. |
| SC-6 self → neither | PASS | `isSelf ? null`; regression test asserts. |
| SC-7 error → pre-action state + inline error + error haptic, no toast/Alert | PASS | catch → error haptic + `setCtaError`; pill restored via `finally setCtaInFlight(null)`; inline `errorRow`. |
| SC-8 `source='app'` default, no enum, no migration | PASS | reuses `addFriend` (no `source` arg); zero migration in diff. |
| SC-9 no new key/staleTime/Realtime/edge/backend in diff | PASS | grep gate (§7) — NONE. |

---

## 5. Invariants
- **I-CONST-2 / I-CONST-4 (one owner / one key):** PRESERVED. Derivation reads existing `useFriendRequests` + `useFriendProfile.isFriend`; no third owner, no new query key. Protective comment at the block.
- **I-CONST-3 (no silent failure):** PRESERVED. Every mutation catch surfaces an inline error + error haptic.
- **I-CONST-1 (no dead taps):** PRESERVED. "Requested" cancels; every pill responds.
- **Message-friend-gate invariant:** PRESERVED. `onMessage && profile.isFriend` condition byte-unchanged; CTA is `else`.
- **I-PROPOSED-PROFILE-ADD-FRIEND-STATE-DERIVED (DRAFT):** satisfied — state derived purely client-side.

---

## 6. Regression Test
- **Path:** `app-mobile/src/components/profile/__tests__/orch-0993-add-friend-cta.happy.test.tsx`
- **Runner:** `node` source-assertion (app-mobile has no jest/RTL; matches repo convention, e.g. `YourCircleSection.happy.test.tsx`).
- **Covers:** T-04 (Message renders only under `relationship === 'friends'`; Add-Friend is the else branch → stranger never sees Message) + T-10 (`onPress={() => onMessage(userId)}` unchanged); plus self-guard + derivation owner assertions.
- **Passing run:** `PASS ORCH-0993 Add-Friend CTA happy-path regression (T-04 + T-10)`
- **fails-on-revert verified at `ee8bbdab9`** — `git stash` of `ViewFriendProfileScreen.tsx` → test FAILS (`Message must render only under relationship === 'friends' (T-04)`); `git stash pop` → PASS.
- Ships in the same branch/PR as the fix.

(Tester writes the adversarial T-06/T-07/T-08/T-09 separately.)

---

## 7. SC-9 Grep Gate (run locally)
```
migrations / edge functions added:  NONE
screen diff new staleTime/.channel/queryKey/useQuery/supabase./.rpc/.from(/invoke:  NONE
```
PASS — zero backend in the diff.

---

## 8. Cross-Surface Impact (Step 3.5)
- **Consumer iOS / Android (1,2):** AFFECTED — single shared RN component + hook → parity automatic. Tester verifies both per parity rule.
- **Buyer-anon Web (3), Business iOS/Android (4,5), Admin (6), Business Web preview (7):** NOT AFFECTED — no consumer user-profile / friend graph on those surfaces.

---

## 9. Typecheck / Lint
- `npx tsc --noEmit`: **0 errors in `ViewFriendProfileScreen.tsx`** (245 pre-existing repo-baseline errors in unrelated test files/packages — none in touched files). No errors in `useFriends`/`useFriendsQuery`/`useFriendProfile`.
- `npx eslint src/components/profile/ViewFriendProfileScreen.tsx`: clean (see chat for captured exit).

---

## 10. Discoveries for Orchestrator
- **None new.** SPEC §18 already registered the latent ungated `get_or_create_direct_conversation` / `ensureConversation()` path (out of scope here; Message stays UI-gated on `isFriend`). No code touched it.
- No `useFriendProfile.ts` change was needed — `isFriend` + `useFriendRequests` derivation was sufficient (no spec deviation).

---

## 11. Deviations
None. Build matches SPEC + DESIGN exactly. Designer's contrast correction honored: Add-Friend/Accept fill is `#c2410c` (white 5.94:1), NOT SPEC §11's `#eb7825`.
