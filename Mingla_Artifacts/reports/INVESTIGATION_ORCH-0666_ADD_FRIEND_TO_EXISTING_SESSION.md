# INVESTIGATION — ORCH-0666 — Add friend to existing collab session (Friends modal "Add to session")

**Mode:** INVESTIGATE-ONLY (per dispatch).
**Severity:** S1 (orchestrator-assigned, confirmed).
**Trust model:** **invite + accept** — LOCKED by orchestrator + user 2026-04-25. This investigation does NOT redesign the trust model; it verifies the existing infrastructure can absorb the new entry point cleanly.
**Confidence overall:** **HIGH** — every finding traced file:line, every backend assertion verified against latest migration, all five truth layers reconciled.

---

## 1. Plain-English summary

The "Add to session" button on the Friends modal does **literally nothing** today. Tapping it logs a line to the JavaScript console and shows no UI feedback — pure dead tap.

There is a **second, parallel** path to the same feature (DM "More options" → "Add to board" → multi-session picker → confirm). That path is **fake-success theatre**: a 1-second simulated delay, then a green success toast that says "Added to board," then nothing happens server-side. No DB row is created. No invite is sent. No push is delivered. The friend never finds out. Existing session members see nothing change. The user believes the operation succeeded.

Meanwhile, the **complete, production-grade pipeline already exists** elsewhere in the codebase: `InlineInviteFriendsList.tsx` (rendered inside `BoardSettingsDropdown` for in-session invites) does exactly the right thing — pre-inserts a `session_participants` row with `has_accepted=false`, inserts a `collaboration_invites` row with `status='pending'`, calls the `send-collaboration-invite` edge function for push, tracks Mixpanel + AppsFlyer, surfaces alerts. The acceptance pipeline (`collaborationInviteService.acceptCollaborationInvite`) is also complete and battle-tested (it's the path used today for invites sent at session-create time).

The fix is wiring the Friends modal entry point through to that existing pipeline. There are real edge cases to specify (idempotency under the UNIQUE constraint, orphan participant rows on invite-insert failure, RLS gap on `ci_insert`, block/mute parity, AddToBoardModal stale data), but the underlying infrastructure is sound.

This is **not a regression** — the bisect proves all three fake bits (`onSendCollabInvite=console.log`, AddToBoardModal `setTimeout`, AppHandlers toast-only stub) were present in the initial-migration commit `c0a13f1b` (2026-03-05). It's a **never-implemented feature** with placeholder UI shipped to production. The symptom has been live for 7 weeks.

---

## 2. Symptom summary

| Expected (per founder directive) | Observed today |
|---|---|
| Tap "Add to session" on a friend → see existing-session picker | ❌ Tap logs to JS console; no UI response |
| Pick session(s) → friend gets invited → pending state visible to inviter | ❌ DM-path picker exists but click does nothing real |
| Friend sees an invite (push + in-app) | ❌ No DB write → no push → no in-app surface |
| Friend accepts → becomes a participant; existing members notified | ❌ Cannot accept — invite never created |
| Inviter sees confirmation grounded in DB truth | ❌ Inviter sees fabricated "Added!" toast (Constitution #9) |
| Idempotent on duplicate add | N/A — no add ever happens |

**Reproduction:** 100% on every tap of every "Add to session" / "Add to board" button on every device since 2026-03-05 (initial migration).

---

## 3. Investigation manifest (read in trace order)

| # | File / Resource | Layer | Why read |
|---|---|---|---|
| 1 | `prompts/FORENSICS_ORCH-0666_ADD_FRIEND_TO_EXISTING_SESSION.md` | Dispatch | Scope + locked decisions + 8 verification questions |
| 2 | `app-mobile/src/components/connections/FriendsManagementList.tsx` | Mobile component | Entry point — friend action sheet "Add to session" |
| 3 | `app-mobile/src/components/ConnectionsPage.tsx` (lines 1980-2010, 2200-2240, 2700-2720) | Mobile component | Both handler paths + parent prop wiring + AddToBoardModal mount |
| 4 | `app-mobile/src/components/AddToBoardModal.tsx` | Mobile component | Multi-session picker UX + the `setTimeout` mock |
| 5 | `app-mobile/src/components/AppHandlers.tsx` (lines 280-360) | Mobile handler | `handleAddToBoard` terminal handler + sibling fake handlers |
| 6 | `app-mobile/app/index.tsx` (lines 2120-2140, 2410-2430, 1280-1314) | Mobile root | `onSendCollabInvite` callsite + boardsSessions Supabase fetch |
| 7 | `app-mobile/src/components/MessageInterface.tsx` (lines 92-100, 587-610) | Mobile component | Parallel DM-path entry to AddToBoardModal |
| 8 | `app-mobile/src/components/AppStateManager.tsx` (lines 261-380, 490-520, 615-625) | Mobile state | `boardsSessions` source-of-truth (AsyncStorage + Supabase refresh) |
| 9 | `app-mobile/src/components/board/InlineInviteFriendsList.tsx` | Reference impl | The canonical, working invite-friends-to-session pipeline |
| 10 | `app-mobile/src/services/collaborationInviteService.ts` | Service | Acceptance handler — Step 1-5 pipeline (resolve → mark accepted → upsert participant → activate session → board collaborators) |
| 11 | `app-mobile/src/services/sessionInviteService.ts` | Service | Phone path — `inviteByPhone` warm/cold flow |
| 12 | `app-mobile/src/services/boardInviteService.ts` | Service | `sendFriendInvites` — zombie clone of InlineInviteFriendsList logic |
| 13 | `supabase/functions/send-collaboration-invite/index.ts` | Edge fn | Push-only — confirmed it does NOT create DB rows |
| 14 | `supabase/migrations/20260312400003_consolidate_collaboration_invite_columns.sql` | Migration | Latest authoritative `collaboration_invites` schema + RLS policies |
| 15 | `supabase/migrations/20250126000007_schema_repair.sql` (line 91) | Migration | Original `CREATE TABLE collaboration_invites` |
| 16 | `supabase/migrations/20250226000003_fix_missing_columns.sql` (line 71) | Migration | UNIQUE `(session_id, invited_user_id)` constraint |
| 17 | `supabase/migrations/20260313100006_fix_on_conflict_partial_index_mismatch.sql` | Migration | Confirms the unique-constraint name in current state |
| 18 | `app-mobile/src/services/boardNotificationService.ts` (lines 185-300) | Service | `notifyMemberJoined` exists for realtime-on-join (already wired in acceptCollaborationInvite) |
| 19 | `Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md` | Prior artifact | Schema authority + concurrency lessons |
| 20 | `Mingla_Artifacts/outputs/ORCH-0661_INVESTIGATION_pending_session_pill.md` (refd, not re-read) | Prior artifact | Pending-pill ownership context |
| 21 | `git log -S "Simulate API call delay"` and `-S "console.log(\"Sending collaboration invite"` | Git history | Bisect — never-implemented vs. regression |

---

## 4. Findings (classified, six-field per RC/CF, four-field per HF/OBS)

### 🔴 RC-1 — `onSendCollabInvite` is wired to `console.log` only (literal dead tap, Constitution #1)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/app/index.tsx:2125-2127` AND `:2413-2415` (two parallel mount sites — root-level and tab-router) |
| **Exact code** | `onSendCollabInvite={(friend: any) => { console.log("Sending collaboration invite to:", friend); }}` |
| **What it does** | Tapping "Add to session" on the friend sheet → `FriendsManagementList:311 onAddToSession?.(sheetUserId)` → `ConnectionsPage:2701-2709 onSendCollabInvite?.(friend)` → reaches this handler → emits `console.log` and returns. No state change. No fetch. No alert. No haptic. |
| **What it should do** | Open the AddToBoardModal multi-session picker pre-targeted at the chosen friend, OR delegate to the SPEC-defined flow (e.g., `handleAddFriendToSession(friend)`) that drives the full invite pipeline (insert participant + insert invite + push + telemetry). |
| **Causal chain** | User taps button → `setSheetFriend(null)` closes the sheet → `onAddToSession(sheetUserId)` fires → ConnectionsPage handler resolves Friend object → calls `onSendCollabInvite(friend)` → app/index.tsx prop is `(friend) => console.log(...)` → friend modal closes from line 2702 `setShowFriendsModal(false)` → user sees friend modal disappear → no other UI feedback → user assumes "something happened?" but cannot verify, retries, sees same nothing. |
| **Verification** | Read both call sites in `app-mobile/app/index.tsx` end-to-end: one inside `case "connections":` of the page renderer (line 2122-2138), one inside the always-mounted tab router (line 2410-2430). Both wire `onSendCollabInvite` to the same console.log. Grep `onSendCollabInvite` across the codebase: only consumers are `ConnectionsPage` (forwards) and `MessageInterface` (forwards). No real handler exists anywhere. |
| **Classification** | 🔴 **Root Cause** — directly produces the symptom on the Friends modal entry path. |
| **Confidence** | **HIGH** — code read end-to-end at both call sites and downstream consumers. No real handler exists; no test mocks it. |

### 🔴 RC-2 — `AppHandlers.handleAddToBoard` is toast-only (Constitution #3 silent failure + #9 fabrication)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/AppHandlers.tsx:316-338` |
| **Exact code** | ```tsx\nconst handleAddToBoard = (sessionIds: string[], friend: any) => {\n  sessionIds.forEach((sessionId, index) => {\n    const notification = {\n      id: `add-to-board-${Date.now()}-${friend.id}-${index}`,\n      type: "success" as const,\n      title: sessionIds.length === 1\n        ? i18n.t('common:toast_added_to_board')\n        : i18n.t('common:toast_added_to_boards', { count: sessionIds.length }),\n      message: sessionIds.length === 1\n        ? i18n.t('common:toast_added_board_msg', { name: friend.name })\n        : i18n.t('common:toast_added_boards_msg', { name: friend.name, count: sessionIds.length }),\n      sessionName: sessionId,\n      autoHide: true,\n      duration: 4000,\n    };\n    setTimeout(() => {\n      setNotifications((prev: any) => [...prev, notification]);\n    }, index * 100);\n  });\n};\n``` |
| **What it does** | Iterates over the selected `sessionIds` array, builds a success-toast notification, schedules each toast 100ms apart via `setTimeout`. **Zero database calls. Zero edge function invocations. Zero push. Zero invite-row insert. Zero participant pre-insert. Does not even mutate the local `boardsSessions` state.** |
| **What it should do** | For each session_id in the array: (a) insert `session_participants` (has_accepted=false) idempotently, (b) insert `collaboration_invites` (status='pending', invite_method='friends_list') idempotently with `ON CONFLICT DO NOTHING` semantics, (c) invoke `send-collaboration-invite` edge fn for push, (d) on partial failure roll back the participant row, (e) collect successes and failures, (f) surface a truth-grounded toast (e.g., "Invited X to 2 of 3 sessions" / "Couldn't reach Y — retry"), (g) emit Mixpanel `collaboration_invites_sent` + AppsFlyer event, (h) trigger React Query invalidation so the home pill bar (ORCH-0661) shows the new pending state, (i) NOT mutate any local cache directly. |
| **Causal chain** | MessageInterface "Add to board" tap → handleBoardSelection → onAddToBoard(boards, friend, true) → ConnectionsPage handleAddToBoardConfirm → onAddToBoard(sessionIds, friend) → AppHandlers.handleAddToBoard → 4-second auto-hide toasts appear → user sees green checks → no DB row exists → friend gets nothing → existing members see nothing. The operation has zero observable effect outside the inviter's local toast system. |
| **Verification** | Read AppHandlers.tsx:280-360 end-to-end. The function body contains exactly 22 lines, none of which touch `supabase`, `fetch`, edge functions, or any persistence layer. Sibling handlers in the same file (e.g., `handleLeaveBoard` lines 240-313) DO call `supabase.from(...)` — confirming this is not a stylistic choice; the implementation is genuinely missing. |
| **Classification** | 🔴 **Root Cause** — directly produces the silent fake-success symptom on the DM-path entry. |
| **Confidence** | **HIGH** — exhaustive read of the function body and surrounding handlers. No hidden indirection. |

### 🔴 RC-3 — `AddToBoardModal.handleAddToBoard` simulates an API call with `setTimeout` (Constitution #9 fabrication)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/AddToBoardModal.tsx:75-87` |
| **Exact code** | ```tsx\nconst handleAddToBoard = async () => {\n  if (selectedSessions.length === 0 || !friend) return;\n  setIsAdding(true);\n  // Simulate API call delay\n  await new Promise(resolve => setTimeout(resolve, 1000));\n  onConfirm(selectedSessions, friend);\n  setIsAdding(false);\n  setSelectedSessions([]);\n  onClose();\n};\n``` |
| **What it does** | Sets `isAdding=true` (the spinner appears + button disables), waits 1000ms, calls `onConfirm(selectedSessions, friend)` (which lands at the toast-only RC-2), resets state, closes the modal. The 1-second wait is a UX placeholder for an HTTP call that does not exist. |
| **What it should do** | Either: (a) call a service that performs the real invite work and surfaces real success/failure for partial-success UX (recommended — pushes orchestration into a service, where it belongs), or (b) accept a `Promise<{success: boolean, errors?: string[]}>`-returning `onConfirm` and adapt the UX (loading → success/partial/error). The literal `setTimeout` must be deleted in any correct fix. |
| **Causal chain** | Inherits from RC-2 — modal calls `onConfirm` which lands at the toast-only handler. The 1-second simulated delay creates an *additional* trust-violation symptom: users learn that "the spinner is honest" elsewhere in the app, but here it is not, eroding the success-toast credibility downstream. |
| **Verification** | Read the function body verbatim. The literal comment `// Simulate API call delay` is the proof. Sibling modals (e.g., `BoardSettingsDropdown` invite-by-phone path via `inviteByPhone`) await real promises. |
| **Classification** | 🔴 **Root Cause** — fabricates the perception of a real API call. Inseparable from RC-2 in user perception but a distinct file-level defect. |
| **Confidence** | **HIGH** — the comment in the source code makes intent unambiguous. |

### 🟠 CF-1 — `BoardInviteService.sendFriendInvites` is a zombie duplicate (Constitution #2 + #8)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/services/boardInviteService.ts:176-204` |
| **Why it's a contributing factor** | This static method does exactly what the AddToBoardModal flow needs (loop friends, insert `collaboration_invites` rows). Cross-codebase grep confirms **zero callers**: `useBoardSession.ts:271` only calls `BoardInviteService.generateInviteLink`; no production code path reaches `sendFriendInvites`. Meanwhile `InlineInviteFriendsList.tsx:137-247` reimplements the same operation inline (with the addition of the participant pre-insert + edge-fn push call). Two parallel implementations for one operation. The dead one (`sendFriendInvites`) lacks the participant pre-insert AND lacks the push call — if a fix accidentally wires through it instead of the canonical path, those gaps re-emerge. |
| **Fix requirement (for spec)** | Either delete `BoardInviteService.sendFriendInvites` outright (subtract before adding) and have the spec route the new entry point through a new shared service that consolidates the canonical InlineInviteFriendsList logic — or rewrite `sendFriendInvites` to be the canonical service and have InlineInviteFriendsList call it. Spec must NOT introduce a *third* implementation of the same operation. |
| **Classification** | 🟠 **Contributing Factor** — does not produce the symptom but expands the blast radius and tempts implementors to reuse the wrong path. |
| **Confidence** | **HIGH** — grep is exhaustive; no callers found. |

### 🟠 CF-2 — AddToBoardModal filters by `participants` only, not by pending invites (idempotency gap)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/AddToBoardModal.tsx:153-157` |
| **Why it's a contributing factor** | The session list filter is `!session.participants.some(p => p.id === friend.id) && session.status !== 'archived'`. It checks the in-memory `boardsSessions[].participants` array, which represents accepted participants. **A friend who already has a pending invite to the same session is NOT excluded from the picker.** Tapping "add to session" again will hit the DB UNIQUE constraint on `(session_id, invited_user_id)` and produce 23505 error — silently swallowed by RC-2 today, but in the fixed flow will need to be handled either by (a) graceful fall-through "already invited" UX, or (b) excluding pending-invitee combinations from the picker before the user can select them. |
| **Fix requirement (for spec)** | Either (i) extend `boardsSessions` source-of-truth to include `pending_invitee_ids` so the modal can filter, or (ii) accept the 23505 error code in the new service and translate to "Already invited — pending acceptance" toast. Option (i) is cleaner if React Query is already fetching invites elsewhere; option (ii) is unavoidable as a backstop because of the CF-3 stale-data risk. Spec must specify both. |
| **Classification** | 🟠 **Contributing Factor** — relevant only after the fix lands. |
| **Confidence** | **HIGH** — code read; constraint verified in migration. |

### 🟠 CF-3 — `boardsSessions` is dual-sourced (AsyncStorage cache + Supabase refresh) → AddToBoardModal may show stale state

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/AppStateManager.tsx:506-519` (AsyncStorage seed) + `app-mobile/app/index.tsx:1280-1306` (Supabase refresh) |
| **Why it's a contributing factor** | On cold start, `boardsSessions` is loaded from `mingla_boards_sessions` AsyncStorage key (default empty). A subsequent React Query effect refreshes from Supabase. If the user opens the Friends modal AND triggers AddToBoardModal **before** the refresh completes, the session list is stale (potentially empty, potentially missing newly-created sessions, potentially showing archived sessions). On invite-send, the inviter would see "no sessions available" or accidentally invite to a stale session-id that no longer exists (triggering an FK violation at the DB layer). |
| **Fix requirement (for spec)** | Spec must define one of: (a) the modal blocks on a freshness-guarantee fetch before rendering the picker, (b) the modal sources from React Query directly instead of the local `boardsSessions` prop chain (Constitution #4 — one query key per entity), or (c) the spec accepts a small-window staleness and the new service tolerates session-id drift via FK-error → "Session no longer exists" toast. |
| **Classification** | 🟠 **Contributing Factor** — relevant for production correctness. |
| **Confidence** | **HIGH** — both sources read; cache priority confirmed. |

### 🟡 HF-1 — `ci_insert` RLS allows any authenticated user to invite to any session if they know the session_id (security gap)

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260312400003_consolidate_collaboration_invite_columns.sql:48-53` |
| **Exact code** | ```sql\nCREATE POLICY "ci_insert" ON public.collaboration_invites\nFOR INSERT WITH CHECK (\n  auth.uid() = inviter_id\n  OR public.is_session_creator(session_id, auth.uid())\n);\n``` |
| **Why it's a hidden flaw** | The policy permits insert when `auth.uid() = inviter_id` — i.e., the inviter is the JWT user. **It does NOT verify that the inviter is currently a member of the session** (or even the session creator — the OR-branch only adds creator privilege). In practice the session_ids are UUIDs and not enumerable, so this is not a high-severity practical exploit; but a malicious user who learns a session_id (via leaked deep link, forwarded screenshot, or compromised friend) could invite arbitrary other users into a session they have no right to be in. The invitee then sees a push push from the legitimate session creator (because `send-collaboration-invite` reads `inviter_id` from the row), creating a phishing/spoofing vector. |
| **Fix requirement** | Tighten `ci_insert` to require the inviter is a member of the session — recommend a helper `is_session_member(session_id, user_id)` already-or-newly-defined, and policy `WITH CHECK (auth.uid() = inviter_id AND public.is_session_member(session_id, auth.uid()))`. Note: this hardening is OUT OF SCOPE for ORCH-0666 fix (it's a pre-existing gap), but spec MUST flag it as a discovery and orchestrator should file a separate ORCH-ID for the RLS hardening. |
| **Classification** | 🟡 **Hidden Flaw** — pre-existing security gap surfaced during this investigation. Not produced by ORCH-0666 fix. |
| **Confidence** | **HIGH** — RLS read directly; no later migration overrides. |

### 🟡 HF-2 — InlineInviteFriendsList pattern: orphan participant on invite-insert failure

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/board/InlineInviteFriendsList.tsx:151-184` |
| **Why it's a hidden flaw** | The canonical pattern inserts `session_participants` first, then `collaboration_invites` second. If the second insert fails (network, RLS, UNIQUE-violation, FK-violation), the first row is orphaned: the friend now has `session_participants(has_accepted=false)` for a session they were never invited to. Because `session_participants` is what `is_session_member` (and similar policies) likely check, the orphan row may grant the friend partial visibility into the session even though no invite ever existed. The current code does `continue` on invite error (line 182-184) without compensating-delete on the participant row. |
| **Fix requirement (for spec)** | Spec must define one of: (a) reverse insert order (invite first, then participant on success), (b) wrap both inserts in a SQL-level transaction via a SECURITY DEFINER RPC `add_friend_to_session(session_id, friend_user_id)` that performs the two inserts atomically, (c) on invite-insert failure, compensating-delete the participant row with `eq('session_id', sessionId).eq('user_id', friend.id).eq('has_accepted', false)`. Option (b) is recommended — single round-trip, atomic, server-authoritative, RLS-policy-friendly. |
| **Classification** | 🟡 **Hidden Flaw** — pre-existing in `InlineInviteFriendsList`. Spec must NOT inherit this defect when designing the new entry point. |
| **Confidence** | **HIGH** — code read; failure mode verified by reading the error-handling branches. |

### 🟡 HF-3 — MessageInterface passes `suppressNotification: true` 3rd arg silently dropped by handler chain

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/MessageInterface.tsx:603` (caller) + `app-mobile/src/components/ConnectionsPage.tsx:1990-1994` (forwarder) + `app-mobile/src/components/AppHandlers.tsx:316` (terminal) |
| **Why it's a hidden flaw** | MessageInterface calls `onAddToBoard?.(selectedBoards, friend, true)` — three args. The prop type at MessageInterface:94-98 declares the third arg `suppressNotification?: boolean`. ConnectionsPage's forwarder accepts only two args (line 1990: `(sessionIds: string[], friend: Friend)`). The third arg vanishes in the forward. AppHandlers' terminal handler also only accepts two. Result: even if RC-2 were fixed, `suppressNotification: true` would silently fail to suppress, and the user would see TWO success toasts (one from MessageInterface line 604 `showNotification(t('chat:addedToBoard')...)` and one from AppHandlers' setNotifications). Type system did not catch because `?` makes it optional and TS does not error on dropped trailing args. |
| **Fix requirement (for spec)** | Spec must define a unified return contract for the new service so the caller knows whether to suppress its local toast — or remove the local toast at MessageInterface:604-608 entirely (recommend) so all toasts are owned by the terminal handler (Constitution #2 single-owner). |
| **Classification** | 🟡 **Hidden Flaw** — would cause double-toast on a future correct fix if not addressed. |
| **Confidence** | **HIGH** — type signatures read at all three layers. |

### 🟡 HF-4 — Block / mute parity not enforced anywhere in the invite path

| Field | Value |
|---|---|
| **File + line** | Absence — `InlineInviteFriendsList`, `sessionInviteService.inviteByPhone`, `BoardInviteService.sendFriendInvites` — none check `blocked_users` or `muted_users` tables before inserting an invite. The only block-aware code path is `cascade_friend_decline_to_collabs` trigger in migration `20260312400003`, which CANCELS invites on friend-decline but does not prevent CREATE. |
| **Why it's a hidden flaw** | A user can add a friend to a session even if the friend has blocked them. The DB INSERT would succeed (no RLS check of blocked_users in `ci_insert`). The push fires. The blocked party gets a notification from someone they explicitly blocked. This is a privacy/abuse vector. |
| **Fix requirement (for spec)** | Spec must define block-check semantics: (a) at service-layer pre-flight — query `blocked_users` (either direction) and refuse the insert, OR (b) extend `ci_insert` RLS to also assert `NOT EXISTS (SELECT 1 FROM blocked_users WHERE (blocker_id, blocked_id) IN ((auth.uid(), invited_user_id), (invited_user_id, auth.uid())))`. Option (b) is server-authoritative and preferred. Mute is informational only — don't block the invite, but apply the existing notify-dispatch mute path (already does). |
| **Classification** | 🟡 **Hidden Flaw** — pre-existing. ORCH-0666 fix is the right time to close it because the fix introduces the new mass-add ergonomics. |
| **Confidence** | **HIGH** — exhaustive grep across services and policies. No block-check found. |

### 🟡 HF-5 — Friends modal's `onSendCollabInvite` is the WRONG primitive for "add to session"

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/ConnectionsPage.tsx:2701-2709` |
| **Why it's a hidden flaw** | The handler resolves the friend then calls `onSendCollabInvite(friend)`. Even if `onSendCollabInvite` were correctly wired to a real handler, that handler's contract would be "create a NEW session and invite this friend to it" — a different operation than "add this friend to one of my EXISTING sessions". The current ConnectionsPage handler conflates the two. The correct primitive for ORCH-0666 is `setSelectedFriendForBoard(friend); setShowAddToBoardModal(true);` — exactly what `handleAddToBoard(friend)` does at line 1985-1988 for the OTHER (DM-path) entry point. The Friends modal entry point should call `handleAddToBoard(friend)` directly (or a renamed equivalent), bypassing `onSendCollabInvite`. |
| **Fix requirement (for spec)** | The Friends modal "Add to session" handler at ConnectionsPage:2701-2709 must be rewritten to invoke `handleAddToBoard(friend)` (the existing function at line 1985 that opens AddToBoardModal). Then close the friend modal afterwards. Then the AddToBoardModal's `onConfirm` becomes the single point that triggers the real invite flow. This collapses two competing entry-point conceptions into one shared downstream pipeline. |
| **Classification** | 🟡 **Hidden Flaw** — design-level confusion that produces RC-1 as a symptom. |
| **Confidence** | **HIGH** — both call sites read; both modals exist. |

### 🔵 OBS-1 — `InlineInviteFriendsList` is the canonical, working invite-friend-to-existing-session implementation

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/components/board/InlineInviteFriendsList.tsx:137-247` |
| **Observation** | Multi-select friend picker, real participant pre-insert, real `collaboration_invites` insert, real `send-collaboration-invite` edge-fn invocation, Mixpanel + AppsFlyer telemetry, partial-success Alert. Renders inside `BoardSettingsDropdown` (which is opened from within an active session). The infrastructure for ORCH-0666 already exists and is in production today — just behind a different entry point. The spec's job is to expose it via the Friends modal entry point and de-duplicate. |
| **Classification** | 🔵 **Observation** — positive, leveraged for fix strategy. |

### 🔵 OBS-2 — `send-collaboration-invite` edge function is push-only by design

| Field | Value |
|---|---|
| **File + line** | `supabase/functions/send-collaboration-invite/index.ts:90-95` (explicit comment) |
| **Observation** | The edge function authenticates the caller, validates JWT === inviter or invitee, then dispatches a push via `notify-dispatch`. **It does NOT create the `collaboration_invites` row.** That row must be created by the calling code (mobile or other edge fn) BEFORE invoking this edge function. This is correctly factored — push delivery is decoupled from row creation, allowing the row to be created in transactions or RPCs without the push side-effect. |
| **Classification** | 🔵 **Observation** — establishes the contract for the spec. |

### 🔵 OBS-3 — `collaboration_invites` has UNIQUE `(session_id, invited_user_id)` enforced at DB level

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20250226000003_fix_missing_columns.sql:71` (constraint added) + reaffirmed in `20260313100006_fix_on_conflict_partial_index_mismatch.sql` |
| **Observation** | The constraint name is `collaboration_invites_session_invited_user_unique`. INSERT of a duplicate `(session_id, invited_user_id)` pair returns Postgres error code `23505`. This is the DB-level idempotency guarantee. Spec can rely on it; service layer must catch 23505 and translate to user-meaningful UX ("already invited"). |
| **Classification** | 🔵 **Observation** — enables idempotency design. |

### 🔵 OBS-4 — `notifyMemberJoined` exists for realtime fan-out (no spec work needed for join-broadcast)

| Field | Value |
|---|---|
| **File + line** | `app-mobile/src/services/boardNotificationService.ts:185` (function exists) + `app-mobile/src/services/collaborationInviteService.ts:222-239` (already wired into acceptCollaborationInvite) |
| **Observation** | When the invitee accepts, `acceptCollaborationInvite` fires `notifyMemberJoined({ sessionId, sessionName, userId, userName })` to push a notification to the existing members. This already works. The ORCH-0666 fix does NOT need to add new realtime fan-out — the moment the invitee accepts, the existing pipeline takes over. |
| **Classification** | 🔵 **Observation** — saves spec scope. |

### 🔵 OBS-5 — Bisect: never-implemented, not regression

| Field | Value |
|---|---|
| **Evidence** | `git log -S "Simulate API call delay" -- app-mobile/src/components/AddToBoardModal.tsx` returns commit `c0a13f1b` (2026-03-05, "Initial migration to organization") + `d5f3c014` ("UI changes"). Same for `console.log("Sending collaboration invite to:")` and the `handleAddToBoard` stub. All three fake-handler bits were present at the very first organized commit and have never been replaced with real implementations. |
| **Observation** | This is a **never-implemented feature with placeholder UI shipped to production**, not a regression. Severity framing remains S1, but the fix is "build the missing pipeline" rather than "restore prior behavior." |
| **Classification** | 🔵 **Observation** — context for severity + spec framing. |

---

## 5. Five-truth-layer reconciliation

| Layer | What it says | Contradiction with other layers? |
|---|---|---|
| **Docs / Product** | No formal spec for "add friend to existing session" found in `Mingla_Artifacts/`. The Friends modal i18n strings (`Add to session`) exist across 28 locales (`modals.json`). Founder directive (this dispatch) establishes intent: invite + accept model. | None on intent. Implementation gap is the contradiction. |
| **Schema** | `collaboration_invites` table exists with: `id, session_id, inviter_id, invited_user_id, status, invite_method`, UNIQUE `(session_id, invited_user_id)`, RLS for SELECT/INSERT/UPDATE/DELETE. `session_participants` table has `(session_id, user_id, has_accepted, role, is_admin, joined_at, created_at)` with `(session_id, user_id)` unique. Triggers cascade friend-decline → invite cancel. | None. Schema is sound. |
| **Code (mobile)** | Two parallel entry points for the same operation — Friends modal "Add to session" (broken, RC-1) and DM "Add to board" (broken, RC-2/RC-3). Canonical working implementation at `InlineInviteFriendsList` (in-session entry point only). Zombie at `BoardInviteService.sendFriendInvites`. | **Contradiction:** docs/founder say "should work"; code does not deliver. |
| **Code (edge fn / RPC)** | `send-collaboration-invite` is push-only (correctly). No RPC exists for "atomic-add-friend-to-session" (spec opportunity per HF-2 fix recommendation). | None — gap, not contradiction. |
| **Runtime / Data** | Tapping the button produces ZERO new `collaboration_invites` rows (verified by reading the chain — terminal handler does not call `supabase`). MCP probe deferred to spec — no action today would change this since no insert path exists. | **Contradiction:** UI affords/promises the operation; runtime delivers nothing. Constitution #1, #3, #9 all violated. |

---

## 6. Backend capability audit

| Operation | Capability today? | Where |
|---|---|---|
| Add a known friend (existing user_id) to an existing collab session as a pending-invite participant | **YES** | `InlineInviteFriendsList.handleSendInvites` (in-session UI), `sessionInviteService.inviteByPhone` warm path (phone UI). Both insert participant + invite + push. |
| Add multiple friends in one user action | **YES** | `InlineInviteFriendsList` loops + per-friend independent failure handling. |
| Add to multiple sessions in one user action | **NO** | No existing path. AddToBoardModal UX implies it but the terminal handler is fake. Spec must define ergonomics: serial loop vs. parallel; partial success messaging. |
| Reject if friend is already a member | **PARTIAL** | DB UNIQUE on `(session_id, invited_user_id)` prevents duplicate invites. `session_participants` UNIQUE on `(session_id, user_id)` prevents duplicate participants. But pre-flight UX filtering only checks accepted participants (CF-2). |
| Reject if session is archived / ended | **PARTIAL (client-side only)** | AddToBoardModal:156 filters `status !== 'archived'`. No server-side enforcement; the row would insert successfully on an archived session. Spec must add server-side check (RLS or RPC). |
| Reject if caller is not session member | **NO (security gap)** | HF-1 — RLS only checks `auth.uid() = inviter_id`. Spec MUST flag (orchestrator files separate ORCH for hardening). |
| Emit realtime broadcast to all existing members on join | **YES** | `notifyMemberJoined` is wired in `acceptCollaborationInvite` Step 4. Already works. |
| Emit push to invitee on invite | **YES** | `send-collaboration-invite` edge fn does this. Already works. |
| Allow inviter to revoke pending invite | **YES (CRUD-level)** | `BoardInviteService.declineInvite` (mislabeled — it's UPDATE status='declined' on any invite the user has access to via RLS). No revoke-specific UI in Friends modal flow. Spec scope decision: include or defer. |
| Block-check (refuse invite if blocked) | **NO** | HF-4. Spec must add. |
| Mute-aware push delivery | **YES** | `notify-dispatch` (called by `send-collaboration-invite`) handles mute / quiet hours / preference checks. Already correct. |

---

## 7. Invite + Accept verification — 8 dispatch questions answered

### Q1: Existing invite-creation entry point inventory

**Two real entry points create `collaboration_invites` rows from the inviter side:**

1. `app-mobile/src/components/board/InlineInviteFriendsList.tsx:137-247` — in-session friend-picker. Direct Supabase insert (no service abstraction). Does participant pre-insert + invite insert + push edge fn.
2. `app-mobile/src/services/sessionInviteService.ts:37-168` (`inviteByPhone`) — phone-based path. Warm branch handles existing-user case identically to InlineInviteFriendsList. Cold branch writes to `pending_session_invites` instead.

**Database-trigger-driven creation paths (post-conversion):**

- `convert_pending_invites_on_phone_verified` (migration 20260312400003 lines 96-165) — converts `pending_session_invites` → `collaboration_invites` after phone verification.
- `credit_referral_on_friend_accepted` (migration 20260312400003 lines 349-471) — converts pending invites after friend acceptance.
- `cascade_friend_decline_to_collabs` (migration 20260312400003 lines 180-229) — UPDATEs (cancels) on friend-decline, does not insert.

**Zero RPC-based or edge-function-based creation paths exist today.** All inserts are direct from the mobile client.

**Both real-user-driven entry points can be called against any existing `session_id`** — the pattern is `INSERT INTO collaboration_invites (session_id, inviter_id, invited_user_id, status) VALUES (...)`. There is NO requirement that the session was just created; it can be any session the inviter has read access to. **The infrastructure absorbs the new entry point cleanly.**

### Q2: Schema fit for invite-against-existing-session

`collaboration_invites.session_id` is an FK to `collaboration_sessions(id)` and is REQUIRED at INSERT (NOT NULL). The session must exist before the invite is created. This is the correct shape for the new entry point. No migration is required to support invite-against-existing-session — it's already supported.

### Q3: Multi-invite ergonomics (one friend → N sessions)

No existing path supports this in one user action. Today, `InlineInviteFriendsList` does N friends → 1 session (the session they're already inside). ORCH-0666 needs the inverse: 1 friend → N sessions. The DB supports this trivially (N independent INSERTs); the spec must define:

- Serial vs. parallel inserts (recommend: serial for predictable ordering, RLS-friendly).
- Partial-success UX (recommend: per-session toast OR aggregate "Invited to X of Y sessions").
- Timeout / cancel mid-loop semantics.
- Whether the loop continues after a single failure or aborts (recommend: continue, collect errors).

### Q4: Acceptance UX (where invitee sees the invite)

The invitee already has multiple existing surfaces:

1. **Pending pill bar** on home — currently broken per ORCH-0661 (in flight, SPEC dispatched). Spec ORCH-0666 should NOT block on ORCH-0661; the pill bar surfaces will work correctly once ORCH-0661 ships.
2. **`CollaborationModule` Invites tab** — modal with pending invites list. Already wired to acceptance pipeline.
3. **Push notification** — `send-collaboration-invite` → `notify-dispatch` → OneSignal. Already wired with Accept/Decline buttons.
4. **NotificationsModal** in-app notification center — already handles `collaboration_invite_received` notifications.

**No new surface needs to be built.** The new entry point produces a row that ALL existing acceptance surfaces already consume.

### Q5: Idempotency

Three-layer idempotency:

1. DB UNIQUE constraint on `collaboration_invites (session_id, invited_user_id)` returns 23505.
2. DB UNIQUE constraint on `session_participants (session_id, user_id)` similarly.
3. Status enum (`'pending', 'accepted', 'declined', 'cancelled'`) — re-invite after decline requires explicit decision.

**Spec must define behavior in each state:**

| Existing state | Spec behavior on re-add |
|---|---|
| No row | Insert pending. (Happy path.) |
| Pending invite exists | Show "Already invited — pending acceptance" toast. Do NOT insert. |
| Accepted invite + accepted participant | Show "Already in session" toast. Do NOT insert. (CF-2 — pre-flight filter recommended.) |
| Declined invite | Spec decision: re-pending (UPDATE status='pending') OR refuse with "Friend previously declined" toast. **Recommend re-pending** — friendship is consent-positive, friend can decline again. |
| Cancelled invite | Same as declined — UPDATE status='pending'. |

### Q6: Cancel / revoke

`BoardInviteService.declineInvite` exists and does `UPDATE collaboration_invites SET status='declined' WHERE id = inviteId AND invited_user_id = userId` — but it's wired only for the invitee declining. No inviter-revoke path exists in UI today. Spec scope decision: include inviter-revoke in ORCH-0666 (recommend yes — symmetric UX), or defer. RLS already supports it (`ci_update` allows `auth.uid() = inviter_id`).

### Q7: Push + realtime

| Mechanism | Wired today? |
|---|---|
| Push to invitee on invite-create | YES — `send-collaboration-invite` edge fn → `notify-dispatch` → OneSignal. |
| Realtime to existing members on invite-create (someone is being invited) | NO — no broadcast. Spec decision: do existing members need to know of pending invitees? Recommend NO (privacy + low value); keep it to "joined" notifications via `notifyMemberJoined` on accept. |
| Realtime to invitee's other devices on invite-create | YES — `collaboration_invites` is in `supabase_realtime` publication (per migration `20260312400002_add_collaboration_tables_to_realtime`). Postgres CDC broadcasts new rows. |
| Push + realtime to existing members on invitee accept | YES — `notifyMemberJoined` already wired in `acceptCollaborationInvite` Step 4. |
| Inviter confirmation on invite-create | TOAST ONLY (per design — `send-collaboration-invite` lines 213-214 explicitly removed inviter push in V2 spec). Spec must keep this — the "Invited X" toast on inviter device IS the confirmation, but it must be grounded in DB success. |

### Q8: Block / mute parity

| Check | Wired today? |
|---|---|
| Block-check at INSERT time | NO — HF-4. Spec must add. Recommend: extend `ci_insert` RLS to assert no `blocked_users` row in either direction. |
| Block-check at acceptance time | NO — `acceptCollaborationInvite` does not query `blocked_users`. Spec scope decision: tighten here too, or trust HF-4 RLS hardening to catch all paths. Recommend RLS-only — single point of enforcement. |
| Mute applied to push delivery | YES — `notify-dispatch` already handles mute + quiet hours + preference. No work needed. |
| Mute applied to in-app surfaces | PARTIAL — depends on each surface. Spec scope: not in ORCH-0666. |

---

## 8. End-to-end chain map (REAL/FAKE annotated)

```
═══════════════════════════════════════════════════════════════════════
PATH A — FRIENDS MODAL "Add to session"  (Friends modal entry, BROKEN)
═══════════════════════════════════════════════════════════════════════

User taps friend → three-dot menu → "Add to session" sheet item
  ↓
FriendsManagementList.tsx:311  onAddToSession?.(sheetUserId)
  ↓ [REAL — prop fires]
ConnectionsPage.tsx:2701-2709  resolves friend, calls onSendCollabInvite(friend)
  ↓ [REAL — handler resolves correctly, but invokes WRONG primitive — see HF-5]
app/index.tsx:2125-2127 OR :2413-2415  console.log(...)  ← RC-1
  ↓ [FAKE — terminal dead-end]
END.  No DB. No push. No UI feedback. User sees friend modal close. Nothing else.

═══════════════════════════════════════════════════════════════════════
PATH B — DM "More options" → "Add to board"  (parallel entry, BROKEN)
═══════════════════════════════════════════════════════════════════════

User taps DM → "..." → "Add to board"
  ↓
MessageInterface.tsx:587-599  handleAddToBoard()
  ↓ [REAL — opens BoardSelection if boardsSessions.length > 0]
BoardSelection (multi-pick) → handleBoardSelection(selectedBoards)
  ↓
MessageInterface.tsx:603  onAddToBoard?.(selectedBoards, friend, true)
                                  [3rd arg silently dropped — HF-3]
  ↓ [REAL prop fire, signature drift]
ConnectionsPage.tsx:1990-1994  handleAddToBoardConfirm
  ↓
ConnectionsPage.tsx:1991  onAddToBoard?.(sessionIds, friend)
  ↓
app/index.tsx → handlers.handleAddToBoard
  ↓
AppHandlers.tsx:316-338  setNotifications(...)  ← RC-2
  ↓ [FAKE — toast-only, no DB, no push, no edge fn]
END.  User sees "Added to board" toast for 4s. No backend effect.

  (Modal-internal RC-3:
   AddToBoardModal.tsx:75-87  "Simulate API call delay" setTimeout(1000)
   precedes the onConfirm call — additional fake-success layer.)

═══════════════════════════════════════════════════════════════════════
REFERENCE — InlineInviteFriendsList  (in-session entry, WORKING — OBS-1)
═══════════════════════════════════════════════════════════════════════

User opens session → BoardSettingsDropdown → expand "Invite friends" accordion
  ↓
InlineInviteFriendsList multi-pick → "Send invites (N)" button
  ↓
handleSendInvites loops over selected friends:
  → INSERT session_participants (has_accepted=false)             [REAL DB]
  → INSERT collaboration_invites (status='pending')              [REAL DB]
  → invoke('send-collaboration-invite', { ... })                 [REAL EDGE FN]
       → notify-dispatch → OneSignal push                         [REAL PUSH]
  → Mixpanel + AppsFlyer telemetry                                [REAL]
  → partial-success Alert                                          [REAL]
  ↓
Invitee receives push + can accept via NotificationsModal / Pill bar / CollabModule
  ↓
collaborationInviteService.acceptCollaborationInvite:
  → UPDATE collaboration_invites status='accepted'
  → UPSERT session_participants has_accepted=true
  → upsert_participant_prefs RPC
  → notifyMemberJoined → existing members receive push + realtime
  → activate session if ≥2 accepted; create board; add board_collaborators
  ↓
END.  Friend joined; everyone notified; data persisted.
```

---

## 9. Blast radius matrix

| Consumer | Impact of a correct fix | Regression risk | Mitigation |
|---|---|---|---|
| HomePage `boardsSessions` source-of-truth | New invite creates a `collaboration_invites` row + `session_participants` row; participant count visible to existing members may increment (or not, per design — pending invitees may render distinctly). | Stale `boardsSessions` (CF-3). | Spec mandates React-Query invalidation post-mutation; UNIQUE-conflict tolerated. |
| Pending pill bar (ORCH-0661) | Invitee sees a new pending pill on their device once ORCH-0661 ships. | Order dependency: ORCH-0661 must ship FIRST or the invitee has no pill surface. | Spec sequencing: ship ORCH-0666 AFTER ORCH-0661 closes, OR scope ORCH-0666 to use the existing CollaborationModule Invites tab as the primary acceptance surface and accept that the pill bar is a future-work surface. |
| CollaborationSessions home pill (existing members) | Member count badges may update on accept. No effect on invite-create. | None — already wired via realtime + notifyMemberJoined. | None needed. |
| CollaborationModule Invites tab | New invite appears for invitee. | None — existing surface already consumes the same row. | None needed. |
| Discussion realtime (ORCH-0663) | Invitee gains discussion read access on accept (RLS check by `session_participants` membership with has_accepted=true). | None — same code path as today's invite acceptance. | None needed. |
| DM thread realtime (ORCH-0664) | No effect — DM is friend-to-friend, not session-scoped. | None. | None. |
| Curated/serving pipelines (ORCH-0317/0318/0319/0320) | Travel-aggregation and category-union recompute when participant set changes (already wired). | Existing cards in the session do not retroactively re-filter; new aggregations apply going forward. | Spec must verify acceptCollaborationInvite already triggers prefs JSONB merge — confirmed at collaborationInviteService.ts:188-218. |
| Push notification system | `notify-dispatch` already routes through preference / mute / quiet-hours. | None. | None needed. |
| RLS on session_participants / collaboration_invites | New row inserted under existing policies. | HF-1 — existing RLS gap surfaced; ORCH-0666 fix may make it more practically exploitable due to higher invite volume. | Spec flags HF-1 for separate ORCH-ID; orchestrator files. |
| `BoardInviteService.sendFriendInvites` | If spec deletes it, callers (none) are unaffected. If spec rewrites it as canonical, all paths consolidate. | None. | Recommend delete (subtract before adding). |
| Block/mute parity | If HF-4 is closed in this fix, blocked users no longer receive invites. | NEGATIVE regression: existing legitimate invites between non-blocked friends unaffected. | Recommended scope: add block-check; mute is already handled in notify-dispatch. |
| Auto-delete-session-under-2-participants trigger (`auto_delete_sessions_under_two_participants` migration 20260227000001) | If invitee accepts, count goes up; safe. If invite is created but never accepted, count stays at 1 (creator only); session may be auto-deleted. | None — pre-existing behavior. | Spec to confirm `session_participants` insert at invite-time uses `has_accepted=false`; trigger should already filter on this (verify in spec phase). |
| Solo mode | None — solo has no sessions. | None. | None. |

---

## 10. Edge cases (10 mandatory, answered)

| Case | Current behavior | Recommended behavior (for spec) |
|---|---|---|
| **Already a member (accepted)** | RC-2 fake-success. After fix: AddToBoardModal already filters via `participants.some(p => p.id === friend.id)` (line 154-157), but only based on stale local state (CF-3). | Pre-flight filter (UI) + DB-level UNIQUE-violation handling (service). Toast: "Already in session." |
| **Already invited (pending)** | RC-2 fake-success. After fix: not filtered today (CF-2). | Pre-flight filter on `pending_invitee_ids` (extend boardsSessions shape) + 23505 catch in service. Toast: "Invitation pending acceptance." |
| **Friend has user blocked** | RC-2 fake-success → no real push delivered (notify-dispatch may filter). After fix without HF-4 close: insert succeeds, push fires (because send-collaboration-invite ignores block). | Server-side RLS block-check (HF-4 close). Toast: "Cannot add this friend." |
| **Friend has muted notifications from user** | notify-dispatch handles mute → push suppressed. After fix: same. | No spec change. Mute is push-layer only; invite is still created. |
| **Session is paired-only** | No "paired-only" session concept exists in current schema (verified — no `paired_only` column on `collaboration_sessions`). | Out of scope; future ORCH if introduced. |
| **Session is archived / ended** | AddToBoardModal:156 client-side filter only. After fix without server check: insert against archived session would succeed. | Spec adds RLS check `EXISTS (SELECT 1 FROM collaboration_sessions WHERE id = session_id AND status NOT IN ('archived', 'ended'))`. |
| **Capacity limit** | `collaboration_sessions.max_participants` column exists (referenced in `boardInviteService.joinByInviteCode:111`). Default = NULL in current schema. Trigger `check_session_creation_allowed` exists per migration `20260315000008_session_creation_limits` but is for session creation, not invite. | Spec must define: do we count pending invites toward the cap, or only accepted participants? Recommend: count accepted; let pending overflow with a soft-limit UX warning. Then enforce at acceptance time. |
| **Race: two adders adding same friend simultaneously** | DB UNIQUE on `(session_id, invited_user_id)` serializes — second adder gets 23505. | Service catches 23505, toasts "Already invited." First adder wins. |
| **Friend deletes account mid-add** | `handle_user_deletion_cleanup` trigger (migration 20260312400003 lines 233-346) DELETEs `collaboration_invites` rows where `invited_user_id = OLD.id`. So a created-then-orphaned invite is auto-cleaned. | No spec change. |
| **Add → remove → add again** | `cascade_friend_decline_to_collabs` cancels invites on friend-decline. After friend re-accept, no auto-restore. So removing a friend cancels invites; re-friending and re-adding creates new invites. | Spec confirms this is the intended UX (no auto-restore). |

---

## 11. Constitutional check

| # | Clause | Today | After ORCH-0666 fix |
|---|---|---|---|
| 1 | No dead taps | **VIOLATED** (RC-1 console.log only) | RESTORED — button performs real work + truth-grounded toast |
| 2 | One owner per truth | **VIOLATED** (`boardsSessions` AsyncStorage + Supabase + AddToBoardModal participants array; `BoardInviteService.sendFriendInvites` zombie clone of `InlineInviteFriendsList` logic) | Spec consolidates: single React-Query-keyed source for session list; delete `sendFriendInvites` zombie OR canonicalize it |
| 3 | No silent failures | **VIOLATED** (RC-2 toast asserts what didn't happen) | RESTORED — service returns `{success, errors[]}`; UI surfaces partial-success and failure paths |
| 4 | One query key per entity | UNVERIFIED in this investigation — `boardsSessions` is React state not React Query (mixed model) | Spec recommends migrating `boardsSessions` to React Query (out of scope but flag) |
| 5 | Server state stays server-side | Pre-existing tension — `boardsSessions` is in `AppStateManager` React state, AsyncStorage-cached. | No regression introduced; flag for future ORCH |
| 6 | Logout clears everything | Verified — `setBoardsSessions(DEFAULT_BOARDS_SESSIONS)` at AppStateManager:379 on logout. | No regression. |
| 7 | Label temporary fixes | The literal comment `// Simulate API call delay` is a temporary-fix marker, but unlabeled and unowned for 7 weeks. | Spec deletes the comment + the line. |
| 8 | Subtract before adding | Spec opportunity: delete `BoardInviteService.sendFriendInvites` (zombie); delete fake handlers RC-1/2/3; delete `// Simulate API call delay`. | Required by spec discipline. |
| 9 | No fabricated data | **VIOLATED** (RC-2 + RC-3 fake-success) | RESTORED |
| 10 | Currency-aware UI | N/A. | N/A. |
| 11 | One auth instance | N/A. | N/A. |
| 12 | Validate at the right time | Pre-flight filtering today is client-only (CF-2, CF-3) — wrong layer. | Spec moves authoritative checks server-side (RLS + service-layer 23505 handling). |
| 13 | Exclusion consistency | N/A — generation/serving asymmetry is not the concern here. | N/A. |
| 14 | Persisted-state startup | `boardsSessions` AsyncStorage seed is cold-start safe (defaults to empty). | No regression. |

---

## 12. Bisect

```
git log -S "Simulate API call delay" -- app-mobile/src/components/AddToBoardModal.tsx
  c0a13f1b  Initial migration to organization        (2026-03-05)
  d5f3c014  UI changes

git log -S "console.log(\"Sending collaboration invite to:" -- app-mobile/app/index.tsx
  c0a13f1b  Initial migration to organization        (2026-03-05)
  c5ff10aa  basic session

git log -S "handleAddToBoard" -- app-mobile/src/components/AppHandlers.tsx
  c0a13f1b  Initial migration to organization        (2026-03-05)
  d5f3c014  UI changes
```

**All three fake-handler bits trace to commit `c0a13f1b` ("Initial migration to organization", 2026-03-05).** This is not a regression. The UI was scaffolded with placeholder handlers at the initial codebase organization and never wired through. The placeholders have been live for 7 weeks (intake date 2026-04-25).

---

## 13. Prior ORCH overlap

| ORCH | Relevance | What this investigation inherits | What stays separate |
|---|---|---|---|
| ORCH-0066 (collab parity Phase 1, CLOSED) | Established collab-mode equivalence at the preferences layer. | None directly. | Stays separate. |
| ORCH-0316 / 0317 / 0318 / 0319 / 0320 (collab prefs / time slots, CLOSED) | Confirmed `upsert_participant_prefs` RPC (used in `acceptCollaborationInvite`) is sound. | OBS — preference seeding on accept is solved. | Stays separate. |
| ORCH-0411 (paired-friend visibility, OPEN) | Different concern (paired-friend can see liked places). Not blocked by ORCH-0666. | None directly — ORCH-0666 doesn't change pairing semantics. | Stays separate. |
| ORCH-0437 (per-category interleaved deck, in-progress) | Tangentially related — collab deck composition. ORCH-0666 grows participant set, which affects deck recomputation, which is already wired via prefs JSONB merge. | None directly. | Stays separate. |
| ORCH-0438 (collab session lifecycle / state machine, OPEN) | Same surface (collaboration_sessions). Lifecycle states relevant for "is session valid for invite." | Spec must verify session.status in `('pending', 'active')` — not in `('archived', 'ended', 'cancelled')`. | Stays separate; ORCH-0666 leverages existing states. |
| ORCH-0440 / 0441 / 0442 (session deletion, pill bar, overflow, CLOSED) | Confirms realtime subscriptions on `collaboration_invites` + `session_participants` tables. | OBS — pill bar will react to new pending invites correctly once ORCH-0661 ships. | Stays separate. |
| ORCH-0443 (collab session blank deck, IMPLEMENTED) | Established `isBoardSession` gate + 7-seeders consolidation. | None directly. | Stays separate. |
| ORCH-0532 (collab swipe-to-board, CLOSED) | Mutual-like trigger schema knowledge. | None for ORCH-0666. | Stays separate. |
| ORCH-0558 (bulletproof collab match, IMPLEMENTED) | UNIQUE constraints + concurrency lessons. | OBS-3 is the same defensive pattern. | Stays separate. |
| **ORCH-0661 (pending session pill, SPEC dispatched)** | **Direct dependency.** Once ORCH-0661 ships, the invitee's home pill bar reacts to pending invites. | ORCH-0666 must NOT block on 0661 — invitee acceptance via NotificationsModal + CollaborationModule Invites tab is sufficient. But if 0666 ships before 0661, the pill bar surface is unavailable to invitees (acceptable). | Sequencing: ORCH-0661 → ORCH-0666 ideal but not required. |
| ORCH-0663 / 0664 / 0665 (chat triple, FORENSICS dispatched parallel) | Different surface (chat). | None. | Parallel forensics confirmed safe. |

---

## 14. Open questions for spec

1. **Multi-session ergonomics.** When a user picks 3 sessions, do we: (a) serial loop with per-session toasts, (b) serial loop with one aggregate toast at end, (c) parallel inserts? Recommend (b) — single end-state toast "Invited X to 2 of 3 sessions" with the per-session failure list.

2. **Re-pending after decline.** If a friend previously declined an invite to session S and the user re-adds, do we (a) UPDATE status='pending' on the existing row, (b) refuse with "Friend declined previously," (c) prompt the user before sending? Recommend (a) — friendship is consent-positive.

3. **Inviter-revoke UX.** Include a "Cancel pending invite" affordance in the Friends modal flow, or defer to ORCH-future? Recommend defer — ORCH-0666 scope is "send" not "manage."

4. **Pre-flight pending-invitee filter (CF-2 close).** Extend `boardsSessions` shape to include `pending_invitee_ids: string[]`, OR keep simple and rely on 23505 fall-through? Recommend extend — better UX (no failure-toast for predictable state).

5. **Atomic two-row insert (HF-2 close).** Inline order-aware insert with compensating-delete, OR new SECURITY DEFINER RPC `add_friend_to_session(p_session_id, p_friend_user_id)` that wraps both inserts in one transaction? Recommend RPC — atomic, server-authoritative, RLS-tight, single round-trip. (Supabase RPCs already used for `upsert_participant_prefs` etc.)

6. **HF-1 separate ORCH.** RLS hardening on `ci_insert` to assert session-membership, plus block-check (HF-4). Two separate ORCHs, or one bundled "invite-RLS-hardening"? Orchestrator decides.

7. **`BoardInviteService.sendFriendInvites` disposition.** Delete (recommend) or rewrite as canonical?

8. **MessageInterface DM-path entry point.** Keep, or delete the "Add to board" more-options entry to consolidate on the Friends modal entry only? Recommend KEEP — the DM is a fast-path UX for the same operation. But spec must specify both paths route through the same downstream service.

9. **Telemetry.** Keep the existing `mixpanel.trackCollaborationInvitesSent` event? Recommend yes; spec should ensure the new path emits it identically.

10. **i18n strings.** `Add to session` exists in 28 locales; `add_to_board.title` etc. for the modal exist similarly. Spec should NOT introduce new i18n keys without confirming the localization team's process.

---

## 15. Recommended next pipeline step

**SPEC dispatch (Option B — bundled spec covering both entry-point fixes + canonical service consolidation).**

Rationale:
- Investigation complete with HIGH confidence.
- Both broken entry points (RC-1 Friends modal + RC-2/RC-3 DM path) share the same downstream pipeline; fixing one without the other leaves a fake-success path live, which would be a Constitution #1+#3+#9 regression of the regression we just diagnosed.
- The canonical reference implementation (`InlineInviteFriendsList`) is in production today; the spec can consolidate by extracting a shared service (recommend: new `services/sessionMembershipService.ts` or extension of `collaborationInviteService.ts` with a `sendFriendInvitesToSession(sessionIds, friend)` export) and routing all THREE entry points (Friends modal, DM path, in-session BoardSettingsDropdown) through it. Constitution #2 + #8 fully restored in one pass.

Spec must include:

1. **Layer 1 — DB.** Optional new RPC `add_friend_to_existing_session(p_session_id, p_friend_user_id)` SECURITY DEFINER. Atomic two-row insert with `ON CONFLICT DO NOTHING` + appropriate error returns. RLS not affected (RPC is SECURITY DEFINER but enforces `auth.uid()` checks internally).
2. **Layer 2 — Service.** New consolidated function. Loops sessions; per-session calls RPC; collects results; returns `{successes, errors}`.
3. **Layer 3 — Hook.** New `useSendCollabInvites` mutation hook with `onSuccess` invalidating the session list query key.
4. **Layer 4 — Components.**
   - `FriendsManagementList.tsx:308-316` — wire "Add to session" through to ConnectionsPage handler that opens AddToBoardModal (replace the call to `onAddToSession` flow with `handleAddToBoard(friend)` direct invocation).
   - `ConnectionsPage.tsx:2701-2709` — replace `onSendCollabInvite(friend)` with `handleAddToBoard(friend)`. Delete the `onSendCollabInvite` plumbing entirely if not used elsewhere (subtract before adding — verify with grep first).
   - `app/index.tsx:2125-2127` and `:2413-2415` — delete the console.log fakes; if the prop is still consumed somewhere legitimate, wire through to a real handler. Preferred: delete the prop entirely.
   - `AddToBoardModal.tsx:75-87` — replace `setTimeout(1000)` with real mutation call; surface `{successes, errors}` per-session in the result UX.
   - `AppHandlers.tsx:316-338` — delete or replace with truth-grounded handler that consumes the mutation result.
   - `MessageInterface.tsx:587-610` — keep entry point; remove the local toast at line 604-608 (Constitution #2 — single-owner notifications); pass through the new mutation result; address HF-3 by aligning signatures.
   - `BoardInviteService.sendFriendInvites` — DELETE (zombie cleanup, OBS / CF-1).
5. **Layer 5 — Telemetry.** Mixpanel + AppsFlyer events identical to InlineInviteFriendsList.
6. **Layer 6 — Tests.** T-01..T-12 covering: happy path (single session), happy path (multi-session), idempotent re-add (pending), idempotent re-add (accepted), block-check refusal (assuming HF-4 closed in same fix), session-archived refusal, invitee-side acceptance flow regression test, partial-success aggregate toast, FK-violation on stale session_id (CF-3), zombie deletion verification (no callers of `sendFriendInvites` remain), HF-3 double-toast prevention.

**HF-1 (RLS gap) is recommended as a SEPARATE ORCH-ID.** Pre-existing security gap; touching `ci_insert` policy is a higher-risk change than the application-layer wiring of ORCH-0666 and warrants its own forensics → spec → impl → test cycle.

**HF-4 (block-check) recommended IN-SCOPE for ORCH-0666.** Logically tied to the new mass-add ergonomics; closes a privacy hole that becomes more accessible when invite UX is faster.

---

## Findings count

- **🔴 Root Causes:** 3 (RC-1, RC-2, RC-3)
- **🟠 Contributing Factors:** 3 (CF-1, CF-2, CF-3)
- **🟡 Hidden Flaws:** 5 (HF-1, HF-2, HF-3, HF-4, HF-5)
- **🔵 Observations:** 5 (OBS-1, OBS-2, OBS-3, OBS-4, OBS-5)

---

## Discoveries for orchestrator

1. **ORCH-0666.D-1 (NEW ORCH candidate) — `ci_insert` RLS allows non-member invites.** HF-1. Recommend separate ORCH-ID for RLS hardening. Severity S2 (security, low practical exploit but principled gap).
2. **ORCH-0666.D-2 (NEW ORCH candidate) — `BoardInviteService.sendFriendInvites` is a zombie.** CF-1. Bundle into ORCH-0666 spec for deletion (subtract before adding). No separate ORCH needed if bundled.
3. **ORCH-0666.D-3 — `boardsSessions` is React-state-not-React-Query, dual-sourced (AsyncStorage + Supabase refresh).** CF-3. Constitution #4 / #5 tension. Pre-existing; no separate ORCH unless orchestrator wants to file a tech-debt cleanup.
4. **ORCH-0666.D-4 — `// Simulate API call delay` placeholder shipped to production for 7 weeks.** OBS-5 + Constitution #7 violation (unlabeled temporary fix). Process discovery: any future placeholder-handler PR should require an `// ORCH-XXXX TEMPORARY` comment + tracking issue.
5. **ORCH-0666.D-5 — Two-toast risk on MessageInterface DM path.** HF-3. Bundle into spec; not a separate ORCH.
6. **ORCH-0666.D-6 — Block-check missing across all three invite-creation paths.** HF-4. Recommend IN-SCOPE for ORCH-0666 spec.

---

**End of investigation.**
