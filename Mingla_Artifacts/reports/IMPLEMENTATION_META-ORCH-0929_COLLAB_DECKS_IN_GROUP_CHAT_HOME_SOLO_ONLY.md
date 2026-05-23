# Implementation Report: Collab Decks In Group Chat, Home Solo-Only (META-ORCH-0929 + ORCH-0926)

> Date: 2026-05-23
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md`
> Status: implemented, partially verified

## 1. Layman Summary

Home is now a solo-only swipe surface again: the old collaboration session switcher and Home session modal path were removed. Friends `+` now opens a chooser, group chat creation lives in Connections, pending session invites show as actionable chat rows, and session-linked group chats expose compact in-chat controls for Matches, Swipe, and Plans. The operator-directed refinements added pending-host chat gating, add-by-phone inside the pending sheet, row-level invite revoke, compact swipe-down Matches/Plans sheets, and in-deck preferences. ORCH-0926 realtime scoped authenticated rebind remains folded into this same branch with its regression tests still passing.

## 2. Request And Context

- **Request:** Implement META-ORCH-0929 phases A-G in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`, preserving ORCH-0926 dirty diff and keeping backend unchanged.
- **Source:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md`
- **Fold source:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`
- **Affected surfaces:** Consumer iOS and consumer Android via shared React Native code.

## 3. Scope

- **In scope:** 5 new Connections components, Home solo-only cleanup, Connections create/invite wiring, MessageInterface collab deck CTA/sheet, i18n keys, 4 META happy-path tests, ORCH-0926 regression re-run.
- **Out of scope:** Backend, migrations, edge functions, RPC/RLS, business app, admin app, public web, native module changes, direct deploys.
- **Assumptions:** ORCH-0902/0909/0906 backend contracts are already shipped; `SwipeableCards.sessionIdOverride` remains the correct ORCH-0909 deck seam.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` | Contract | Phases A-G, exact prop names, zero backend, two deletions, ORCH-0926 fold. |
| `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` | Evidence | Correction banner confirms ORCH-0902/0909/0906 shipped; backend unchanged. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` | Fold evidence | Preserve 4-file realtime/auth dirty implementation and re-run tests. |
| `app-mobile/src/components/CollaborationSessions.tsx` | Old flow | Owned Home session creation/invite UI; deleted. |
| `app-mobile/src/components/GlassSessionSwitcher.tsx` | Old flow | Owned Home session switching/invite pills; deleted. |
| `app-mobile/src/components/HomePage.tsx` | Home surface | Session state plumbing removable; `SwipeableCards` can be solo-only. |
| `app-mobile/src/components/ConnectionsPage.tsx` | Friends/chat surface | Existing conversation transform and pair modal path can host chooser, create sheet, invite rows. |
| `app-mobile/src/components/MessageInterface.tsx` | Group chat surface | Header/menu can host compact collab controls, the swiping sheet, settings menu, and full session participant truth. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | Collab in-chat sheet source | Existing saved-card voting and locked-plan surfaces could be reused in compact bottom sheets. |
| `app-mobile/src/components/connections/PendingCollabChatSheet.tsx` | Pending host chat surface | Existing add-by-phone UI could be extended with row-level revoke. |
| `app-mobile/src/components/board/BoardSettingsDropdown.tsx` | Session management surface | Member list needed pending warm/cold invite visibility and revoke actions. |
| `app-mobile/app/index.tsx` | App router/state | Global active-session state could be removed and replaced with per-chat session context. |
| `app-mobile/src/components/SwipeableCards.tsx` | Deck seam | Existing `sessionIdOverride` drives collab deck without Home mode switching. |
| `.codex/skills/ui-ux-mingla/SKILL.md` | UI pre-flight | New touch targets should use Mingla tokens, `Pressable`, pressed states, labels, and manual visual QA when RN rendering is unavailable. |

## 5. Blast Radius

- **Direct changes:** Friends chooser/create/invite UI, group chat header deck entry, Home session UI deletion, app-level session state removal.
- **Cascade changes:** Removed stale references in nearby comments/CI guard scripts so deleted components are not re-required by static checks.
- **Parity surfaces:** Consumer iOS and Android share the same RN code path.
- **Cache impact:** Existing conversation/session refresh paths are reused; no new query key family was added.
- **State boundaries:** Removed global "active session" Home state; session context now comes from the selected conversation.
- **Auth/RLS/security:** No backend/auth/RLS contract changes; pending invite accept/decline still uses existing client/service paths.
- **Deploy path:** EAS OTA eligible React Native change; no Supabase deploy and no Vercel deploy required.

## 6. Old To New Receipts

| Area | Before | After | Why |
|---|---|---|---|
| `HomePage.tsx` | Mounted `GlassSessionSwitcher`, `CollaborationSessions`, and session-mode props. | No session switcher/modal mount; Home `SwipeableCards` runs solo with no `sessionIdOverride`. | Home becomes solo-only and no longer owns collab context. |
| `app/index.tsx` | Held global `currentSessionId`, modal triggers, pending open, invite trigger, and Home session handlers. | Creates group chats through `handleCreateGroupChat`; passes exact new Connections props; notification session links route to Connections/chat. | Group chat owns collab entry, not Home. |
| `ConnectionsPage.tsx` | Friends `+` opened old add-friend flow directly; chat list had no pending session invite rows. | Friends `+` opens chooser; rAF dismiss-before-open routes to pair/create/paywall; pending invites render newest-first with inline accept/decline. | Matches the new Friends-page collaboration entry model. |
| `MessageInterface.tsx` | Collab deck banners could mount inside chat; no header deck CTA. | Header CTA opens `CollabDeckSheet`; leave-session menu copy uses new i18n; old banner import removed. | Deck is available inside session-linked group chats only. |
| Operator UI refinement | Header initially used a separate more button and full-screen/list surfaces for saved/scheduled cards. | Collab header is a compact avatar/title/member pill plus smart action buttons: Matches, Swipe, Plans. Matches and Plans open compact swipe-down bottom sheets. | Matches requested horizontal voting/lock-in sheet, Swipe requested deck, Plans requested locked-in plans. |
| Pending creator chat | Creator could open the group chat while all invitees were still pending. | Pending creator chat is gated; tapping shows a waiting sheet with invitees, add-by-phone, cancel chat, and per-invite revoke. | Prevents empty/premature collab chat entry until at least one invitee accepts. |
| Session management pending members | Manage session showed accepted/current participants only. | Manage session also reads pending `collaboration_invites` and `pending_session_invites`, labels pending/SMS pending rows, and supports row-level revoke. | Admins/hosts can see and manage unaccepted invitees. |
| Swipe deck settings | Deck gear delegated to the parent preference path and could appear delayed until leaving the deck. | `CollabDeckSheet` owns `PreferencesSheet` locally; gear opens and closes preferences inside the same deck modal. | Keeps settings interaction in-window. |
| New components | N/A | Added `FriendsActionChooserSheet`, `CreateGroupChatSheet`, `CollabDeckSheet`, `PendingSessionInviteRow`, `StartSwipingHeaderButton`. | Small focused UI pieces replace large Home-owned session components. |
| Deleted components | `CollaborationSessions.tsx` and `GlassSessionSwitcher.tsx` owned old Home collaboration UX. | Both files removed completely. | Removes deprecated global-session UI. |
| i18n social JSON | No new chooser/create/deck/invite/leave strings. | 17 keys added across all locale social files. | Avoids hardcoded user-facing copy. |
| ORCH-0926 fold files | Dirty implementation existed in `RecommendationsContext`, `useAuthSimple`, `useBoardSession`, `realtimeService`. | Preserved as-shipped and re-tested. | Operator-approved 2-ORCH bundle. |

Tracked production diff is net negative by more than 1,000 lines when excluding test-only additions: the two deleted components remove 2,569 lines; the new production components add 1,057 lines; tracked modified production files are `+1291/-3360`.

## 7. Implementation Details

- **Architecture decisions:** Collaboration no longer has a global active session. The selected group chat provides `sessionId`; the deck sheet passes that to `SwipeableCards.sessionIdOverride`.
- **Data flow:** `CreateGroupChatSheet` collects a name and selected friends, calls `onCreateGroupChat`, then returns `{ conversationId, sessionId }` so Connections can open the new chat.
- **Mutation/query behavior:** Pending invite rows call `onAcceptPendingInvite(sessionId, inviteId)` and `onDeclinePendingInvite(sessionId, inviteId)` with optional invite id support preserved upstream.
- **Pending host gating:** Creator-owned collab chats remain pending until at least one non-creator participant accepts. The pending sheet supports add-by-phone through the existing `inviteByPhone` warm/cold path, whole-chat cancel, and row-level revoke for both `collaboration_invites` and `pending_session_invites`.
- **Session management pending visibility:** `BoardSettingsDropdown` loads pending warm invites and cold SMS invites on open, merges them into the members section as pending rows, and revokes them by deleting warm invite/participant rows or cancelling cold phone invites.
- **Collab chat header:** The session header bundles avatars, title, member count, and the collab indicator into a compact pill that opens session options. Smart actions render as `Matches`, `Swipe`, and `Plans` depending on saved/locked data availability.
- **Compact sheets:** `SavedToSessionCardsSheet` and `ScheduleSheet` now share compact `@gorhom/bottom-sheet` chrome with swipe-down dismissal. Matches keeps `SwipeableSessionCards` for horizontal voting and lock-in; Plans keeps the locked-card list.
- **In-deck preferences:** `CollabDeckSheet` opens `PreferencesSheet` locally from the gear and from deck-level preference callbacks, avoiding delayed parent routing.
- **State handling:** Friends chooser uses mandatory `requestAnimationFrame` dismiss-before-open for add friend, create group chat, and paywall routes.
- **Error handling:** Create sheet shows submit errors locally; existing toast/error helpers remain in parent flows.
- **Copy/accessibility:** New buttons/sheets have accessibility roles/labels/states; UI/UX pass replaced new touchables with `Pressable`, pressed transforms, and hit slop on compact icon buttons.
- **Analytics/notifications/realtime:** No new analytics contract; notification deep links route into Connections/chat. ORCH-0926 realtime auth rebind remains scoped to `board_session:{sessionId}`.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Home solo-only | Yes | Static grep: no `currentMode=` or `sessionIdOverride=` in `HomePage.tsx`; old components deleted. | PASS |
| Friends `+` chooser | Yes | T-IMP-1 pass; rAF negative control failed as expected. | PASS |
| Create group chat sheet | Yes | T-IMP-2 pass; trim negative control failed as expected. | PASS |
| Group-chat deck CTA/sheet | Yes | T-IMP-3 pass; `rg` shows only `CollabDeckSheet` passes `sessionIdOverride`. | PASS |
| Pending invite chat row | Yes | T-IMP-4 pass; disabled-state negative control failed as expected. | PASS |
| Pending creator chat gated until accept | Yes | Manual-code path plus T-FLY-1 utilities; realtime ready-change test passes. | PASS (manual UI pending) |
| Pending add-by-phone in waiting sheet | Yes | Existing `inviteByPhone` path reused; phone normalization utility test passes. | PASS (manual UI pending) |
| Row-level revoke of pending invitees | Yes | T-FLY-1 now asserts warm/cold pending invite revoke eligibility. | PASS |
| Manage session shows pending members | Yes | `BoardSettingsDropdown` reads pending warm and cold invites and renders them in Members. | PASS (manual UI pending) |
| Matches/Plans compact bottom sheets | Yes | Static implementation in shared RN path; targeted ESLint pass. | PASS (manual UI pending) |
| Deck gear opens preferences in-window | Yes | `CollabDeckSheet` owns local `PreferencesSheet`; targeted ESLint pass. | PASS (manual UI pending) |
| Exact new prop names | Yes | `ConnectionsPage` receives `onCreateGroupChat`, `onAcceptPendingInvite`, `onDeclinePendingInvite`, `availableFriendsForCreate`, `isCreatingGroupChat`. | PASS |
| Zero backend changes | Yes | No `supabase/` file edits; no migration/edge/RPC/db push commands run. | PASS |
| ORCH-0926 fold | Yes | Existing ORCH-0926 tests pass post-META reshape. | PASS |
| Phase F tester gates | Not implementor-owned | Must be run by Claude `mingla-tester`. | PENDING |
| Manual sim screenshots | Not run locally | Requires iOS Simulator, Android Emulator, and real-device push test. | PENDING |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Backend unchanged | Yes | Yes | No migrations, edge functions, RPC/RLS edits, Supabase deploys, or `supabase db push`. |
| Dismiss-before-open rAF | Yes | Yes | Encoded in Connections chooser callbacks and T-IMP-1. |
| No Home `sessionIdOverride` | Yes | Yes | Static guard passed. |
| `CollabDeckSheet` owns override | Yes | Yes | `rg -n "sessionIdOverride=" app-mobile/src` returns only `CollabDeckSheet.tsx`. |
| Existing ORCH-0666 callback name not collided | Yes | Yes | New create prop is `onCreateGroupChat`; existing refresh callbacks remain distinct. |
| Preserve ORCH-0926 dirty diff | Yes | Yes | Fold files left as-shipped; tests rerun. |
| User dirty work protected | Yes | Yes | No resets/checkouts; unrelated dirty artifacts left untouched. |

## 10. Parity Check

- **Mobile:** Shared React Native implementation covers iOS and Android.
- **Business app:** Out of scope; no files changed.
- **Admin:** Out of scope; no files changed.
- **Public/web:** Out of scope; no files changed.
- **Solo/collab:** Solo deck remains on Home; collab deck is available only from session-linked group chats.
- **Gaps:** Device rendering, push deep link, and platform parity remain tester manual gates.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** Existing refresh calls reused after create/accept/decline.
- **Data shape changes:** Connections creates local pending invite row objects from existing session/invite data; no backend shape change.
- **AsyncStorage/Zustand impact:** Removed Home global session routing state from app-level flow; no persisted key migration.
- **Cold start behavior:** Session notification route now lands in Connections/chat instead of opening Home session UI.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| META happy tests | `rm -rf /tmp/meta0929-tests && npx tsc ... T-IMP-1..4 && node ...` | PASS | All four tests pass on current tree. |
| On-the-fly pending sheet test | Same META harness, now including T-FLY-1 | PASS | `PendingCollabChatSheet` utility test covers phone normalization, host-ready realtime triggers, and warm/cold revoke eligibility. |
| META fails-on-revert | Temporarily broke rAF defer, trim, `sessionIdOverride`, and disabled-state behavior, then restored. | PASS | Each test failed on its relevant revert at working tree base `c9bc0e14`; tests pass after restore. |
| ORCH-0926 regression/adversarial | `rm -rf /tmp/orch0926-test && npx tsc ... realtimeService.orch-0926*.test.ts && node ...` | PASS | 4 regression + 4 adversarial tests pass. |
| Scoped ESLint new components | `npx eslint src/components/connections/FriendsActionChooserSheet.tsx ... StartSwipingHeaderButton.tsx` | PASS | 0 errors, 0 warnings after UI/UX `Pressable` polish. |
| Scoped ESLint broad files | `npx eslint app/index.tsx src/components/HomePage.tsx src/components/ConnectionsPage.tsx ...` | PASS with warnings | 0 errors, warning debt remains in large pre-existing app files. |
| On-the-fly targeted ESLint | `npx eslint src/components/ConnectionsPage.tsx src/components/MessageInterface.tsx src/components/board/BoardSettingsDropdown.tsx src/components/connections/PendingCollabChatSheet.tsx src/components/connections/pendingCollabChatUtils.ts src/components/connections/__tests__/PendingCollabChatSheet.happy.test.tsx` | PASS with warnings | 0 errors; warnings are pre-existing debt in large files plus existing BoardSettingsDropdown hook warning. |
| Full typecheck | `npx tsc --noEmit` | FAIL unrelated | Fails in `LockedPlanBanner`, `BoardDiscussion`, `TicketCartSheet`, `LockedCardSchedulingSheet`, `nativeCheckoutFlow`, and shared `packages/*`; no META-specific errors remained. |
| Home/override static guard | `rg -n "sessionIdOverride=" app-mobile/src`; `rg -n "currentMode=|sessionIdOverride=" HomePage.tsx`; deletion check | PASS | Only `CollabDeckSheet` passes `sessionIdOverride`; deleted files absent. |
| App-state static guard | `rg -n "currentSessionId|sessionModalTrigger|pendingSessionOpen|inviteModalTrigger|const \\[currentMode..." app-mobile/app/index.tsx` | PASS | Removed old global active session app state. |
| Stale reference guard | `rg -n '"Pair with a friend"|GlassSessionSwitcher|CollaborationSessions|createTriggerNonce|modalsOnlyMode' app-mobile` | PASS | No app-mobile matches. |
| Locale key guard | Node JSON parse/check for 17 social keys in all locale social files. | PASS | All locale files contain the new keys. |
| ORCH-0908 guard scripts | `node scripts/ci/orch-0908-regression-check.mjs`; `node scripts/ci/orch-0908-adversarial-check.mjs` | FAIL unrelated | Existing ORCH-0908 checks fail on locked-card/recycle/push assertions, but deleted-session-switcher assertion passes. |
| UI/UX pre-flight | `python3 .codex/skills/ui-ux-mingla/scripts/search.py "react native bottom sheet modal accessibility touch interaction" --stack react-native -p "Mingla consumer mobile collab chat sheets"` | APPLIED | Updated new components to use `Pressable`, pressed transforms, accessibility labels/states, and hit slop on compact icon actions. |

## 13. Regression Surface

1. **Conversation list ordering:** Pending invite rows now join the chat list; tester should confirm newest-first ordering and no accepted-chat duplication.
2. **Pair flow from Friends `+`:** The add-friend route now goes through chooser + rAF; tester should confirm existing PairRequestModal behavior is unchanged.
3. **Group chat creation:** Existing session/conversation creation is now invoked from Connections; tester should validate create success, failure, paywall, no friends, and navigation states.
4. **Message header density:** Start-swiping CTA appears in group chats; tester should inspect narrow devices and long chat names.
5. **Collab deck lifecycle:** Deck now mounts in a full-screen modal; tester should validate close/reopen, realtime updates, and in-window preference sheet routing on iOS and Android.
6. **Notification routes:** Session pushes should land in chat, not directly in the deck sheet.
7. **Deleted old components:** Any stale import in app code should stay absent; CI/deprecation scripts were adjusted to avoid resurrecting deleted files.
8. **Pending creator session:** Host should see waiting state until an invitee accepts; invitee acceptance should update host immediately.
9. **Pending invite revoke:** Warm Mingla invitees and cold phone invitees should be individually revocable from both pending chat and manage-session surfaces without deleting the whole chat.
10. **Matches/Plans sheets:** Matches should open horizontal vote/lock-in sheet; Plans should open locked-in plans in the same swipe-down bottom sheet style.

## 14. ORCH-0926 Fold Receipts

- **Implementation diff content preserved as-is:** Confirmed for the operator's ORCH-0926 dirty files: `app-mobile/src/contexts/RecommendationsContext.tsx`, `app-mobile/src/hooks/useAuthSimple.ts`, `app-mobile/src/hooks/useBoardSession.ts`, `app-mobile/src/services/realtimeService.ts`.
- **Happy-path regression test path:** `app-mobile/src/services/__tests__/realtimeService.orch-0926.test.ts` — passing at working tree base `c9bc0e14`.
- **Adversarial regression test path:** `app-mobile/src/services/__tests__/realtimeService.orch-0926.adversarial.test.ts` — passing at working tree base `c9bc0e14`.
- **Current passing evidence:** Tests report setAuth-before-subscribe, defer-without-auth-session, token-refresh rebind, broadcast-only immunity, concurrent rebind convergence, callback preservation, mid-subscribe rebind, and sign-out teardown all PASS.
- **Fails-on-revert:** Not re-run in this META pass because the dispatch hard-guarded preserving the operator's 4 dirty files as-is. Existing ORCH-0926 implementation/QA evidence is carried forward; tester should re-verify per TARGETED protocol.
- **QA verdict carry-forward:** `Mingla_Artifacts/reports/QA_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` remains the cited QA source for ORCH-0926; META tester must append fresh ORCH-0926 re-verification.

## 15. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Full `tsc` still red | Repo has unrelated type debt outside this META; cannot claim full typecheck green. | Owners fix pre-existing board/payment/shared-package errors. | See §12 full typecheck output. |
| Manual device flows not run | React Native modal/header layout, push deep links, and realtime deck behavior need simulator/device proof. | Claude tester runs iOS Simulator, Android Emulator, and real-device push test. | Tester handoff. |
| File-scope deviation | Spec named 4 modified files plus fold files; stale comments/CI guards were also updated to avoid deleted component references. | Orchestrator accepts as deprecation cleanup or requests rework. | `GlassBottomNav`, `GlassTopBar`, `BoardSettingsDropdown`, `designSystem`, `collaborationInviteService`, ORCH-0908 scripts. |
| Operator live refinements broadened UI scope | The on-the-fly changes added pending-chat gating, pending-member management, compact sheets, and header polish after initial spec execution. | Tester validates the expanded acceptance list before close. | `ConnectionsPage`, `MessageInterface`, `BoardSettingsDropdown`, `CollabSessionChatBanners`, `PendingCollabChatSheet`. |
| ORCH-0926 fails-on-revert not rerun | Strict preservation of dirty ORCH-0926 files conflicted with destructive re-revert simulation. | Tester performs independent reversible verification if required. | ORCH-0926 fold. |

## 16. Discoveries For Orchestrator

- ORCH-0908 regression/adversarial scripts still have unrelated failing assertions around locked-card scheduling, service exposure, recycle excludes, and notify-session-lock body consistency. The decommissioned session-switcher assertion now passes.
- `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` is no longer mounted as the old banner stack by `MessageInterface`, but its exported `SavedToSessionCardsSheet`, `ScheduleSheet`, and saved-card hook are now reused by the collab chat header actions. The stale `sessionIdOverride` prop was removed from its deck path to preserve the META guard that `CollabDeckSheet` is the sole override owner.

## 17. Deploy Notes

- **Migrations:** None. No migration created or applied.
- **Edge functions:** None. No edge function changed or deployed.
- **RPC/RLS:** None. No RPC/RLS changed.
- **Supabase commands:** No `supabase db push`, no migration deploy, no edge deploy.
- **Mobile OTA/native:** EAS OTA eligible; no native module changes.
- **Business/admin/web:** No deploy required.
- **PR title:** `Close META-ORCH-0929 + ORCH-0926: collab decks in group chat + Home solo-only + realtime scoped rebind (operator-approved 2-ORCH bundle exception)`

## Suggested Commit Message

```text
mobile: move collab decks into group chat

Resolves: META-ORCH-0929, ORCH-0926
Evidence: META T-IMP-1..4 pass with fails-on-revert; ORCH-0926 regression/adversarial tests pass; static Home solo-only guards pass.
Deploy: mobile OTA only; no backend, migration, RPC, RLS, or edge deploy.
```

## Ready-To-Test Checklist

1. Friends `+` opens chooser; Add Friend dismisses chooser and opens PairRequestModal after a frame.
2. Friends `+` Create Group Chat opens paywall when gated and create sheet when allowed.
3. Create group chat with 2 friends creates a chat/session, opens the new group chat, and does not open Home session UI.
4. Pending session invite row appears newest-first, Accept opens/creates chat, Decline silently removes row.
5. Home renders solo deck only, with no session switcher and no session modal.
6. Session-linked group chat header shows compact avatar/title/member pill plus smart `Matches`, `Swipe`, and `Plans` actions.
7. `Swipe` opens the full-screen deck, passes `sessionIdOverride`, and the gear opens/closes preferences inside that deck window.
8. `Matches` opens the compact swipe-down sheet with horizontal voting and lock-in; `Plans` opens the compact swipe-down locked-plan sheet.
9. Creator-owned pending collab chat is gated until at least one invitee accepts; tapping it shows the waiting sheet.
10. Pending waiting sheet supports add-by-phone, whole-chat cancel, and individual revoke for warm Mingla invites and cold SMS invites.
11. Manage-session dropdown shows accepted members plus pending warm/SMS invitees; admins/hosts can revoke pending rows individually.
12. Session push notification routes to group chat, not directly to deck sheet, on a real device.
13. ORCH-0926 realtime rebind is re-verified during active collab deck use after token refresh/sign-out/sign-in.
