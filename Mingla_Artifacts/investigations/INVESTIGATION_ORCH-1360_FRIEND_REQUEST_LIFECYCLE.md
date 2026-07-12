# INVESTIGATION — ORCH-1360 [guest-sheet-friend-request-no-confirm-no-cancel]

**Phase:** INVESTIGATE · **Skill:** mingla-forensics · **Date:** 2026-07-12
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` · branch `ORCH-1359-guest-sheet-polish` (HEAD `3ccfc6118`; rebased on origin/main — up to date)
**Folds into:** the ORCH-1358/1359 guest-sheet polish batch (same OTA/PR). ORCH-1360 must NOT disturb the committed 1358/1359 product code.
**Confidence:** `proven` (defects are absence-of-code, definitive from source; runtime symptom operator-reported by Seth on the LIVE 1.1.1 build; a fresh sim repro is blocked by a Seth-gated login/seed-data dependency — see §Repro).

---

## 1. Symptom summary (expected vs actual)

Reported by Seth on the live 1.1.1 consumer guest sheet ("Who's going"), two defects in `app-mobile/src/components/EventGuestListSheet.tsx` (shipped in ORCH-1341):

| # | Expected | Actual (live 1.1.1) |
|---|----------|---------------------|
| **D1 — no cancel** | After sending a friend request, the user can withdraw it. | The "Requested" state is a dead end — no way to cancel/withdraw a sent request. |
| **D2 — no confirmation** | Tapping "Add friend" should not silently fire a real request on a mis-tap; the user should be asked to confirm, and know it was sent. | Tapping "Add friend" immediately fires the request with no guard; a mis-tap sends a real request. No pre-action confirmation prompt; no clear "sent" feedback. |

**Scope refinement (Seth, mid-investigation):** the D2 "confirmation" is a **PRE-ACTION confirm dialog** ("Send a friend request to `<name>`?" → Confirm / Cancel), not a post-send toast. The request must fire ONLY on confirm. This makes the earlier "no-toasts DESIGN §2.5" question moot for the send path — it is a confirm dialog, not a toast. A subtle post-confirm "Requested" state is still fine.

ORCH-1360 therefore has **three parts**, all inside `EventGuestListSheet.tsx`:
1. **Confirm-BEFORE-add** — tap "Add friend" → confirm dialog naming the person → request fires only on confirm.
2. **Cancel/withdraw AFTER sent** — the inert "Requested" chip becomes cancellable → `cancelFriendRequest` → reverts to "Add friend".
3. **Send feedback** — verify what (if anything) fires on send today (resolved at source: nothing but the chip swap; PRIMARY confirmation is now the pre-add prompt).

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` (Active entries) | Mandatory ingest. COMMS-0093 (META-ORCH-1337 CLOSE) documents the sheet's sealed patterns (BaseBottomSheet, add-friend + friend-gated message, `mingla://` unregistered → never `Linking.openURL`, private ≡ no-photo). WARN→ALL; factored. No BLOCK targets forensics/1360. |
| 2 | `app-mobile/src/components/EventGuestListSheet.tsx` (all 1032 lines) | The subject. Both defects live here. |
| 3 | `app-mobile/src/hooks/useFriends.ts` (all 496 lines) | `cancelFriendRequest` signature + `addFriend` + invalidation. |
| 4 | `app-mobile/src/hooks/useFriendsQuery.ts` | Query keys + `useFriendRequests` config (staleTime/enabled/refetch). |
| 5 | `app-mobile/src/services/friendsService.ts` (24-199) | `FriendRequest` type, status enum (`cancelled` present), and `fetchFriendRequests` (incoming **and** outgoing). |
| 6 | `packages/offering-rendering/RsvpGoingConfirmDialog.tsx` (all) | Candidate confirm primitive — is it an RN `<Modal>`? (Yes → disqualified inside the sheet.) |
| 7 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` (overlay slot region) | The sanctioned "layer above the sheet" seam (COMMS-0084). |
| 8 | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` (340-746) | The gold-standard analog: derives `outgoingRequest`, `cancelFriendRequest(outgoingRequest.id)`, `Alert.alert` withdraw confirm. |
| 9 | `app-mobile/src/components/ConnectionsPage.tsx` (cancel/withdraw sites) | Second precedent: `cancelFriendRequest(req.id)` + `Alert.alert('Cancel …', …, [Keep, destructive])`. |
| 10 | `app-mobile/src/i18n/locales/en/{profile,common}.json` | Canonical withdraw copy. |
| 11 | `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` + `…_adversarial.test.ts` | Committed regression guards I must not break (T-01 no `<Modal>`; T-04 overlay-slot-unused; T-10 Pressable whitelist; T-11b exact addFriend string; A-3 null guard). |
| 12 | 3 consumer detail screens (Event/Trip/Experience) | Blast radius — mount sites. Confirms no screen change is needed (sheet is self-contained for the friend lifecycle). |

---

## 3. Q-scorecard

**Q1 — Is the "Requested" chip a dead end (no cancel)?**
Verdict: **YES — proven.** Lines 604-612 render an inert `<View style={styles.requestedChip}>` containing `<Text>Requested</Text>`, `accessibilityState={{ disabled: true }}`, and **no `onPress`**. It is a `<View>`, not a `<Pressable>` — structurally incapable of responding to a tap. There is no withdraw affordance anywhere in the file. Borderline Constitution #1 (dead element). → F-1.

**Q2 — Does `cancelFriendRequest` already exist, and what is its exact signature?**
Verdict: **YES — `cancelFriendRequest(requestId: string): Promise<void>`.** `useFriends.ts:457-474`. It hard-DELETEs `friend_requests` by `id` then invalidates `friendsKeys.requests(userId)`. It takes a **requestId**, NOT a profileId. → F-2.

**Q3 — The sheet only has `profileId`. How does it get the `requestId`?**
Verdict: **Derive it from `friendRequests`** (already read via `useFriends()` in the sheet). `fetchFriendRequests` returns OUTGOING pending rows carrying `id`, `sender_id`, `receiver_id`, `status:'pending'`, `type:'outgoing'` (`friendsService.ts:178-196`). The requestId = `friendRequests.find(r => r.status==='pending' && r.sender_id===viewerId && r.receiver_id===profileId)?.id` — the SAME predicate the sheet's existing `hasPendingOutgoing` scan uses (lines 512-520). The canonical analog `ViewFriendProfileScreen.tsx:415` does exactly this: `cancelFriendRequest(outgoingRequest.id)`. → F-2.

**Q4 — Does any "request sent" confirmation fire today?**
Verdict: **NO — proven.** `handleAddFriendPress` (356-377) on the SUCCESS branch (362-366) sets `addStates[key]="requested"` and returns — it calls `showHint` ONLY on the `catch` path ("Couldn't send — try again"). There is no success-path feedback anywhere. The dispatch's premise ("fires a transient line-2 hint via showHint" on send) is **factually incorrect** — the only send confirmation is the chip swapping from the orange add-friend icon button to a low-contrast grey "Requested" pill. This is why Seth perceives "no confirmation." → F-3.

**Q5 — Does the request fire with no guard on tap (mis-tap risk)?**
Verdict: **YES — proven.** `handleAddFriendPress` calls `await addFriend(...)` directly on press (365) with no confirmation gate. A single mis-tap on the add-friend button sends a real friend request immediately. → F-3.

**Q6 — What confirm-dialog primitive should the fix reuse (respecting the sheet's sealed z-index/overlay rules)?**
Verdict: **Native `Alert.alert`.** It is (a) the app's EXISTING friend-request-withdraw confirm primitive (`ViewFriendProfileScreen.tsx:733`, `ConnectionsPage.tsx:3304`), (b) an OS alert — NOT a React-Native `<Modal>` — so it does NOT violate the sheet's SEALED "no second RN Modal" contract (COMMS-0084; sheet header comment 24-26) and does NOT trip test T-01, and (c) does NOT use the overlay slot, so it does NOT trip test T-04. `RsvpGoingConfirmDialog` is **disqualified** — it is a raw RN `<Modal>` (line 64). A branded overlay-slot card is possible but invents new UI + requires modifying T-04 → rejected against Seth's "don't invent a new dialog primitive" constraint. → F-4.

**Q7 — Is the fix frontend-only + OTA-safe?**
Verdict: **YES — proven.** `cancelFriendRequest` and `addFriend` already exist (no backend/migration). All three parts are pure-JS edits inside one component + `Alert.alert` (RN built-in). No native module, no new dependency. OTA-safe. → F-5.

**Q8 — Blast radius: which surfaces?**
Verdict: **Consumer iOS + Android only.** The sheet mounts in 3 consumer detail screens (`ConsumerEventDetailScreen`, `ConsumerTripDetailScreen`, `ConsumerExperienceDetailScreen`) — shared RN code → automatic iOS/Android parity. No business app, no buyer-web equivalent (web install-gate shows no names). → §6.

**Q9 — Which committed 1358/1359/1341 tests would the change trip?**
Verdict: **Only T-10** (the Pressable whitelist) needs a `[TEST-MOD-APPROVED ORCH-1360]` clause — making the "Requested" chip a `<Pressable>` adds a 4th sanctioned Pressable. T-11b, A-3, T-01, T-04 all stay GREEN if the fix preserves the exact `addFriend` call string and the `if (profileId === null) return;` guard, uses `Alert.alert` (not `<Modal>`/overlay), and keeps the row container non-pressable. → F-6.

---

## 4. Findings (six-field evidence)

### F-1 — The "Requested" chip is an inert dead end (no withdraw). `CONFIRMED ROOT CAUSE` (D1)
1. **Symptom:** After sending a request, tapping "Requested" does nothing; there is no way to withdraw.
2. **Layer:** Code (component).
3. **Probe:** Read `EventGuestListSheet.tsx:604-612`; `grep -n "requestedChip\|cancelFriendRequest" EventGuestListSheet.tsx`.
4. **Evidence:**
```tsx
// lines 604-612 — showRequestedChip branch
<View
  style={styles.requestedChip}
  accessibilityLabel={`Friend request sent to ${name}`}
  accessibilityState={{ disabled: true }}
  testID={`orch-1341-guest-sheet-requested-${item.key}`}
>
  <Text style={styles.requestedChipText}>Requested</Text>
</View>
```
It is a `<View>` (not `<Pressable>`) with no `onPress`. The file imports/uses `useFriends({...})` but destructures only `{ friends, friendRequests, addFriend }` (line 169) — `cancelFriendRequest` is NEVER pulled or called (`grep` returns zero hits in the sheet). The withdraw capability exists in the hook but is not wired.
5. **Mechanism:** No `onPress` handler + `cancelFriendRequest` never imported into the sheet → the "Requested" state has no exit → dead end.
6. **Severity:** `CONFIRMED ROOT CAUSE` for D1.

### F-2 — `cancelFriendRequest` exists and is wireable from the sheet's own data. `RULED OUT (as blocker)` / enabling evidence
1. **Symptom:** N/A — this proves the fix needs no backend.
2. **Layer:** Code (hook) + Schema (status enum).
3. **Probe:** Read `useFriends.ts:457-474`, `friendsService.ts:40,119-198`.
4. **Evidence:**
```ts
// useFriends.ts:457-474 — EXACT signature
const cancelFriendRequest = useCallback(
  async (requestId: string) => {
    const { error } = await supabase
      .from("friend_requests").delete().eq("id", requestId);
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: friendsKeys.requests(userId ?? "") });
  }, [queryClient, userId]);
```
```ts
// friendsService.ts:40 — status enum already includes cancelled
status: "pending" | "accepted" | "declined" | "cancelled";
// friendsService.ts:178-196 — outgoing pending rows returned with id/sender_id/receiver_id
for (const request of outgoingRequests) { ... transformed.push({ id: request.id, sender_id, receiver_id, status, type:"outgoing" }); }
```
5. **Mechanism:** The sheet's `friendRequests` (from `useFriends()`) already contains the outgoing pending row and its `id`. Passing that `id` to `cancelFriendRequest` deletes the request and invalidates `friendsKeys.requests`, which the sheet's own `hasPendingOutgoing` scan reads → the row reverts to "Add friend" automatically.
6. **Severity:** enabling finding — confirms **no backend/migration** is needed. (Note: the hook does a hard DELETE, not a status→`cancelled` update; the `cancelled` enum value is legacy and unused by this path. Immaterial to the fix.)

### F-3 — No pre-action confirm + no send feedback: a mis-tap fires a real request silently. `CONFIRMED ROOT CAUSE` (D2)
1. **Symptom:** Tapping "Add friend" immediately sends a real request; nothing textual confirms it.
2. **Layer:** Code (component).
3. **Probe:** Read `EventGuestListSheet.tsx:356-377`; `grep -n "showHint" EventGuestListSheet.tsx`.
4. **Evidence:**
```tsx
// lines 356-377 — the ENTIRE add flow
const handleAddFriendPress = useCallback(async (row) => {
  const profileId = row.guest.profileId;
  if (profileId === null) return;
  HapticFeedback.medium();
  setAddStates((prev) => ({ ...prev, [row.key]: "inflight" }));
  try {
    await addFriend(profileId, "", row.guest.username ?? undefined);
    setAddStates((prev) => ({ ...prev, [row.key]: "requested" }));   // ← no showHint here
  } catch {
    setAddStates(/* clear */);
    showHint(row.key, "Couldn't send — try again");                  // ← hint only on FAILURE
  }
}, [addFriend, showHint]);
```
`grep -n "showHint(" EventGuestListSheet.tsx` → all call sites are error/gate paths ("Couldn't send — try again", "Add them as a friend to message", "Couldn't open the chat — try again"). **None fire on send success.** There is no confirmation gate before `addFriend`.
5. **Mechanism:** No confirm dialog before the write → a mis-tap sends a real request. No success `showHint` → the only "sent" signal is the subtle chip swap (orange icon button → grey "Requested" pill). Both combine to Seth's "no confirmation."
6. **Severity:** `CONFIRMED ROOT CAUSE` for D2. **Corrects the dispatch premise** that a success hint fires today — it does not.

### F-4 — `Alert.alert` is the correct confirm primitive; `RsvpGoingConfirmDialog` is disqualified. `CONFIRMED (design constraint)`
1. **Symptom:** N/A — governs the fix design.
2. **Layer:** Code (cross-file convention) + Docs (COMMS-0084, sheet sealed contract, tests).
3. **Probe:** Read `RsvpGoingConfirmDialog.tsx:64`, `ViewFriendProfileScreen.tsx:732-745`, `ConnectionsPage.tsx:3304-3318`, `EventGuestListSheet.tsx:24-26`, `orch_1341_…test.ts:81-86,120-126,194-215`.
4. **Evidence:**
```tsx
// RsvpGoingConfirmDialog.tsx:64 — it IS a raw RN <Modal> → banned inside the sheet
return (<Modal visible={visible} transparent animationType="fade" …>
```
```tsx
// ViewFriendProfileScreen.tsx:732-745 — the app's canonical withdraw confirm (native Alert)
onCancelRequest={() => { Alert.alert(
  t('profile:friend.cancel_request_title'),           // "Cancel friend request?"
  t('profile:friend.cancel_request_body', { name }),  // "{{name}} won't be notified."
  [ { text: t('common:keep'), style: 'cancel' },      // "Keep"
    { text: t('profile:friend.cancel_request_confirm'), style: 'destructive', onPress: doCancelRequest } ]); }} // "Cancel request"
```
```
// orch_1341_guest_list_sheet.test.ts — committed guards Alert.alert satisfies for free:
T-01 (81): assert !/<Modal\b/  — Alert.alert is a fn call, NOT <Modal>. PASS.
T-04 (125): assert !/\boverlay\s*=/ ("overlay slot unused in v1") — Alert uses no overlay. PASS.
```
5. **Mechanism:** `Alert.alert` renders in a separate OS window above the sheet's `wrapInRNModal` window — no modal-over-modal, no z-index regression, no overlay-slot use. `RsvpGoingConfirmDialog`, being a real `<Modal>`, would trip T-01 and re-introduce the exact COMMS-0084 footgun the sheet's sealed contract forbids.
6. **Severity:** `CONFIRMED` — binds the SPEC to `Alert.alert`.

### F-5 — Fix is frontend-only + OTA-safe. `CONFIRMED`
`cancelFriendRequest`/`addFriend` already exist (F-2). All three parts are pure-JS edits in one `.tsx` + `Alert` (RN built-in). No migration, no edge function, no native module, no new dependency. → OTA-publishable per-platform.

### F-6 — Only test T-10 needs a `[TEST-MOD-APPROVED ORCH-1360]` clause. `CONFIRMED`
Making "Requested" a `<Pressable>` adds a Pressable whose testID is not in T-10's whitelist (`orch_1341_…test.ts:194-215`, which currently allows only `add-friend|message`, `error-retry`, and the ORCH-1359 `open-profile` target). T-10 must be extended for the new withdraw-chip testID — exact precedent: ORCH-1359 already added a `[TEST-MOD-APPROVED ORCH-1359]` clause here (lines 204-211). All other committed guards (T-01, T-04, T-11b exact `await addFriend(profileId, "", row.guest.username ?? undefined)` string, A-3 `if (profileId === null) return;` guard) stay GREEN provided the fix preserves those exact strings and keeps the row container non-pressable.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | SPEC_ORCH-1341 §2.5 chose "NO TOASTS"; sheet comment 198 reiterates. COMMS-0093 documents the sealed sheet posture. | The "no toasts" rule is **not violated** by ORCH-1360 — Seth's confirmation is a pre-action `Alert.alert` (a native dialog, not a toast). The rule stands. |
| **Schema** | `friend_requests` status enum includes `pending`/`accepted`/`declined`/`cancelled`; `cancelFriendRequest` hard-DELETEs by `id`. | None. No schema change. |
| **Code** | Sheet imports `useFriends` but omits `cancelFriendRequest`; add flow fires directly, no success hint. | **The gap IS the bug** — the capability exists in the hook but the sheet doesn't wire it (D1) and doesn't gate the write (D2). |
| **Runtime** | Operator-reported on live 1.1.1: no cancel, no confirmation. | Matches Code. |
| **Data** | `friendRequests` (outgoing pending) already carries the `id` needed to cancel. | None — the data to fix D1 is already in the component's hands. |

No layer contradictions that hide a deeper bug; the defects are direct, provable absences.

---

## 6. Repro evidence

- **Runtime symptom source:** operator-reported by Seth on the LIVE 1.1.1 consumer build (both defects). This is a real, named runtime data point on shipped code.
- **Fresh sim repro: NOT run — named blocker.** Reaching the "Requested" state requires (a) a logged-in consumer account (a Seth-gated credential per the skill's STOP-and-ASK list) and (b) a seeded event with a NAMED, non-friend, Mingla-user going-guest so the add-friend button renders. Two iOS sims are booted (`17091E60…`, `2C3312D9…`) but Metro is not running and the dev build + account login + seeded guest composition cannot be provisioned without Seth.
- **Why source is authoritative here:** both defects are ABSENCE-of-code (an inert `<View>` with no `onPress` cannot respond to a tap; a success branch with no `showHint` cannot render feedback). A sim run can only observe "nothing happens," which the source structure already entails — there is no present-code behavior to observe. Confidence is therefore `proven` on the source-structure facts, corroborated by the operator's live-1.1.1 report. The send-feedback question (dispatch part 3) is fully resolved at source: **no success feedback exists today** (only the chip swap).

---

## 7. Blast radius / cross-surface map

| Surface | In scope? | Reason |
|---------|-----------|--------|
| Consumer iOS (`app-mobile`) | **YES** | Sheet mounts in 3 consumer detail screens. |
| Consumer Android (`app-mobile`) | **YES** | Shared RN code → automatic parity. |
| Buyer/anonymous Web (`mingla-business`) | No | Web guest funnel is an install-gate; shows no names, no add-friend. |
| Business iOS/Android | No | No guest-list sheet in the business app. |
| Admin Web | No | Unrelated. |
| Business Web preview | No | Unrelated. |

Mount sites confirmed: `ConsumerEventDetailScreen.tsx`, `ConsumerTripDetailScreen.tsx`, `ConsumerExperienceDetailScreen.tsx`. **No screen change needed** — the sheet is self-contained for the friend lifecycle (`useFriends()` lives inside it). Fix is entirely within `EventGuestListSheet.tsx`.

---

## 8. Invariant impact (flagged, not resolved)

- **I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY** (row container never pressable; only sanctioned action controls are interactive) — **preserved.** The withdraw affordance is a NEW sanctioned action control (the "Requested" chip becomes pressable); the row CONTAINER stays a non-pressable `Animated.View`. This mirrors the ORCH-1359 supersession that added the name-open target. The SPEC should extend the invariant's "sanctioned controls" set to include the withdraw chip and add a `[TEST-MOD-APPROVED ORCH-1360]` clause to T-10.
- **COMMS-0084 / "no second RN `<Modal>`"** (sheet sealed contract) — **preserved** by using `Alert.alert` (OS alert, not `<Modal>`, not overlay slot).
- **SPEC_ORCH-1341 §2.5 "NO TOASTS"** — **not violated**; the confirmation is a pre-action native dialog, not a toast. (If a designer later wants a branded in-sheet card, that WOULD engage the overlay slot + a T-04 mod — out of scope here.)
- **D8 anonymity seal** — **preserved.** Anonymous/unlinked rows carry `profileId === null`, expose no actions, and both new handlers must hard-return on null profileId (parity with the existing guards; A-3 enforces this for the add handler).

Proposed new invariant (DRAFT, flips ACTIVE on CLOSE — orchestrator owns the flip): **I-PROPOSED-1360-FRIEND-REQUEST-CONFIRM-AND-CANCEL** — in the guest sheet, sending a friend request is gated by a pre-action confirm, and a sent request is always withdrawable; the "Requested" state is never a dead end.

---

## 9. Discoveries for Orchestrator (side issues)

- **D-i (pattern, not a bug):** `ViewFriendProfileScreen` confirms the WITHDRAW but fires ADD directly (no pre-add confirm). Seth's pre-add confirm is net-new to the guest sheet only. If the product wants confirm-before-add everywhere, that's a separate, larger ORCH — do NOT widen 1360 to touch ViewFriendProfileScreen/ConnectionsPage.
- **D-ii (minor):** `cancelFriendRequest` hard-DELETEs the row rather than setting `status='cancelled'`; the `cancelled` enum value is effectively dead code. Immaterial to 1360; noting for schema hygiene.
- **D-iii:** the guest sheet uses hardcoded English strings (no `useTranslation`); the canonical withdraw copy exists as i18n keys used by ViewFriendProfileScreen. 1360 should stay hardcoded-English (sheet convention); full i18n of the sheet is a separate concern.

---

## 10. Confidence + recommended next phase

**Confidence: `proven`** — both defects are definitive source-structure absences, corroborated by Seth's live-1.1.1 report; the `cancelFriendRequest` signature and wiring path are traced end-to-end; the confirm-primitive decision is bound by the committed tests + cross-file convention. The only unrun step (fresh sim repro) is a Seth-gated login/seed-data blocker and does not gate an absence finding.

**Recommended next phase:** SPEC (this dispatch is IA — SPEC follows in `specs/SPEC_ORCH-1360_FRIEND_REQUEST_LIFECYCLE.md`). Recommended scope: exactly the three parts above, `Alert.alert` primitive, inside `EventGuestListSheet.tsx` only, plus the new ORCH-1360 test file and the single `[TEST-MOD-APPROVED ORCH-1360]` T-10 whitelist clause. Frontend-only, OTA-safe. Do NOT widen to ViewFriendProfileScreen/ConnectionsPage; do NOT disturb 1358/1359 product code.
