# Implementation Report: ORCH-0942 META-ORCH-0929 Dead-Code Reap

> Date: 2026-05-23
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`
> Status: implemented, partially verified

## 1. Layman Summary

Removed the dead ORCH-0918 chat-body banner/deck architecture left behind after META-ORCH-0929 moved collab deck access into the group-chat header pills. The live user surface is unchanged: `Matches`, `Swipe`, and `Plans` remain owned by `MessageInterface.tsx`, `CollabDeckSheet.tsx`, `SavedToSessionCardsSheet`, and `ScheduleSheet`.

Partial verification label is because the exact direct-file `tsc` command still exits nonzero on pre-existing repo/transitive TypeScript noise, the `i-proposed-meta-0929-*.mjs` script glob named by the SPEC does not exist in this checkout, and runtime smoke T-16/T-17/T-18 is reserved for tester/operator devices.

## 2. Request And Context

- **Request:** Implement the ORCH-0942 SPEC and produce this durable report.
- **Source:** User-dispatched `$implementor` prompt with binding SPEC and investigation.
- **Affected surfaces:** Mobile source cleanup, mobile package script cleanup, decision log.
- **Related artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`, `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`, `Mingla_Artifacts/DECISION_LOG.md`.

## 3. Scope

- **In scope:** Six whole-file deletions, one surgical component edit, one `app-mobile/package.json` script removal, DEC-164, and this implementation report.
- **Out of scope:** `MessageInterface.tsx`, `CollabDeckSheet.tsx`, `INVARIANT_REGISTRY.md`, memory files, META-0929 gates, `supabase/`, `mingla-business/`, `mingla-admin/`, `packages/`, EAS OTA, PR/push/merge.
- **Assumptions:** Investigation Verified-Dead and Verified-Alive registers are binding; `CompactCollabBottomSheet` is alive and preserved.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` | Binding contract | Exact deletion list, SC/T gates, non-goals. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` | Evidence contract | Verified-dead/verified-alive registers; two P0 hypothesis corrections. |
| `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` | Product north-star | Chat-header session architecture is canonical. |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC insertion target | DEC-163 was the latest local DEC; DEC-164 appended immediately after. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | Primary surgical edit | Dead `BannerRow`, `InChatDeckSheet`, `CollabSessionChatBanners`; live sheets preserved. |
| `app-mobile/package.json` | Dead script removal | `test:orch-0918` pointed at deleted regression script. |
| Deleted files listed below | Whole-file delete verification | All matched Verified-Dead Register. |
| `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` | Contradiction scan | Contains stale string assertion for `<InChatDeckSheet`; out of SPEC scope and left untouched. |

## 5. Blast Radius

- **Direct changes:** `CollabSessionChatBanners.tsx`, six dead files deleted, `app-mobile/package.json`, `DECISION_LOG.md`, this report.
- **Cascade changes:** `MessageInterface.tsx` still imports only surviving exports from `CollabSessionChatBanners.tsx`.
- **Parity surfaces:** Mobile-only shared RN/JS; no business/admin/web change.
- **Cache impact:** None. Query keys unchanged.
- **State boundaries:** Dead `useSessionDeckMountStore` removed; no live state owner changed.
- **Auth/RLS/security:** None.
- **Deploy path:** No Supabase push, no edge deploy, no EAS OTA, no `[deploy]` tag.

## 6. Old To New Receipts

| File | Before | After | Why |
|---|---:|---:|---|
| `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | 111 lines | Deleted | Dead/unwired gate asserting old JSX count. |
| `app-mobile/scripts/ci/orch-0918-regression-check.mjs` | 320 lines | Deleted | Assertions target dead banner/deck architecture. |
| `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` | 481 lines | Deleted | Assertions target dead banner/deck architecture. |
| `app-mobile/src/store/sessionDeckMountStore.ts` | 32 lines | Deleted | Only consumers were deleted dead functions. |
| `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` | 26 lines | Deleted | Tests deleted store; requires `[TEST-MOD-APPROVED ORCH-0942]`. |
| `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` | 38 lines | Deleted | Imports/asserts deleted exports; requires `[TEST-MOD-APPROVED ORCH-0942]`. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | 843 lines, 12 function/interface declarations | 526 lines, 9 function/interface declarations | Deleted `BannerRow`, `InChatDeckSheet`, `CollabSessionChatBanners`, dead imports, and dead style keys. |
| `app-mobile/package.json` | 134 lines; `test:orch-0918` present | 133 lines; script removed | Script pointed at deleted CI file. |
| `Mingla_Artifacts/DECISION_LOG.md` | 208 lines; DEC-163 latest | 218 lines; DEC-164 appended | Records decommission decision. |

Scoped diff stat: 9 files changed, 12 insertions, 1328 deletions.

## 7. Implementation Details

- **Architecture decisions:** No new abstraction; file name preserved; surviving sheets stay in place to avoid import churn.
- **Data flow:** No runtime data flow changes.
- **Mutation/query behavior:** `useSessionSavedCardsForSheet` and `useSessionScheduledCards` usage preserved.
- **State handling:** Removed only dead deck-mount mutex.
- **Error handling:** No async error contract changed.
- **Copy/accessibility:** No live copy changed.
- **Analytics/notifications/realtime:** No change.

## 8. Success Criteria Traceability

| SC | Status | Evidence |
|---|---|---|
| SC-01 | PASS | `grep -nE "function CollabSessionChatBanners\|function InChatDeckSheet\|function BannerRow\|<BannerRow\|<InChatDeckSheet\|<CollabSessionChatBanners" app-mobile/src/components/chat/CollabSessionChatBanners.tsx` exit 1, zero output. |
| SC-02 | PASS | Grep returned exactly 5 lines: `SavedSessionCard`, `useSessionSavedCardsForSheet`, `CompactCollabBottomSheet`, `ScheduleSheet`, `SavedToSessionCardsSheet`. |
| SC-03 | PASS | `ls app-mobile/src/store/sessionDeckMountStore.ts` -> No such file. |
| SC-04 | PASS | `ls app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` -> No such file. |
| SC-05 | PASS | `ls .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` -> No such file. |
| SC-06 | PASS | `ls app-mobile/scripts/ci/orch-0918-regression-check.mjs` -> No such file. |
| SC-07 | PASS | `ls app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` -> No such file. |
| SC-08 | PASS | `ls app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` -> No such file. |
| SC-09 | PASS | `grep -n "test:orch-0918" app-mobile/package.json` exit 1; `node -e "JSON.parse(require('fs').readFileSync('app-mobile/package.json'))"` exit 0. |
| SC-10 | PASS | `grep -nE "^## DEC-16[34]" Mingla_Artifacts/DECISION_LOG.md` -> DEC-163 line 202, DEC-164 line 210. |
| SC-11 | PASS | `git diff --name-only 4b967630 -- app-mobile/src/components/MessageInterface.tsx` empty. |
| SC-12 | PASS | `git diff --name-only 4b967630 -- app-mobile/src/components/connections/CollabDeckSheet.tsx` empty. |
| SC-13 | PASS | `git diff --name-only 4b967630 -- Mingla_Artifacts/INVARIANT_REGISTRY.md` empty. |
| SC-14 | PASS (not git-tracked) | `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/` exists with 82 files; no memory command/edit was run. `git status` cannot target it because it is outside the repo. |
| SC-15 | PARTIAL | Exact command exits 2 on pre-existing/transitive repo TS noise; no deleted-symbol/import errors. With repo TSX flags, edited targets produce no errors before unrelated package/path/type failures elsewhere. |
| SC-16 | PASS | Compile command exit 0; fixture invocation commands exit 0. |
| SC-17 | PASS via static equivalents | No `.github/scripts/strict-grep/i-proposed-meta-0929-*.mjs` files exist. Ran META-0929 static guards from QA report: single `sessionIdOverride=` in `CollabDeckSheet`, zero Home collab props, zero global active-session state, zero resurrected switcher components. |
| SC-18 | PASS | ORCH-0939 and ORCH-0931 strict-grep scripts and self-tests all exit 0. |
| SC-19 | PASS for staged ORCH scope | Post-stage status below shows scoped staged files plus pre-existing unrelated dirty/untracked files left unstaged. |
| SC-20 | PASS for staged ORCH scope; worktree caveat | `git diff --name-only origin/main -- supabase/ mingla-business/ mingla-admin/ packages/` reports pre-existing `supabase/functions/ticket-checkout-create/index.ts`. It was present before ORCH-0942, not touched or staged by this implementation. |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| `I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN` | Yes | Yes | Source untouched; static META guard path preserved. |
| `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` | Yes | Yes | Deleting `InChatDeckSheet` strengthens single-mount discipline. |
| `I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY` | Yes | Yes | HomePage untouched; grep zero collab props. |
| `I-PROPOSED-META-0929-NO-GLOBAL-ACTIVE-SESSION` | Yes | Yes | `app/index.tsx` untouched; grep zero old global state. |
| `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER` | Yes | Yes | Script and self-test pass. |
| `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` | Yes | Yes | Script and self-test pass. |

## 10. Parity Check

- **Mobile:** Shared iOS/Android RN code cleaned; live UI unchanged.
- **Business app / Admin / Public web:** Not touched.
- **Solo/collab:** Home solo-only unchanged; group-chat collab pills unchanged.
- **Gaps:** Runtime smoke T-16/T-17/T-18 remains tester/operator work.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** Deleted only the dead `useSessionDeckMountStore` mutex; no live persisted store touched.
- **Cold start behavior:** Unchanged.

## 12. Verification

| Test | Command / method | Exit | Result |
|---|---|---:|---|
| T-01 / SC-15 exact TS command | `cd app-mobile && npx tsc --noEmit src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx` | 2 | Pre-existing/transitive TS noise; no deleted-symbol breakage. |
| T-01 scoped TSX sanity | `cd app-mobile && npx tsc --noEmit --skipLibCheck --esModuleInterop --jsx react-jsx --target es2020 --module commonjs --resolveJsonModule src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx` | 2 | Edited files clean; remaining unrelated errors in `@mingla/event-rendering`, `@mingla/phone-input`, `deviceCalendarService`, `LockedCardSchedulingSheet`, `Toast`, `GlassBadge`, `deckService`, etc. |
| T-02 | `git diff 4b967630 -- app-mobile/src/components/MessageInterface.tsx` | 0 | Empty. |
| T-03 | `git diff 4b967630 -- app-mobile/src/components/connections/CollabDeckSheet.tsx` | 0 | Empty. |
| T-04 compile | `rm -rf /tmp/orch-0942-keep-tests && cd app-mobile && npx tsc src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx src/hooks/__tests__/orch-0918-session-card-hooks.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0942-keep-tests` | 0 | Compiled. |
| T-04 run | `node -e "...runOrch0918MessagePredicateFixture...runOrch0918ResolvedSessionFixture..."` | 0 | `PASS orch-0918-message-and-deck-contract fixtures`. |
| T-05 run | `node -e "...runOrch0918ScheduledOrderingFixture..."` | 0 | `PASS orch-0918-session-card-hooks fixture`. |
| T-06 | `ls` against 6 deleted paths | 1 | All report "No such file or directory". |
| T-07 | Dead-symbol grep in `CollabSessionChatBanners.tsx` | 1 | Zero output. |
| T-08 | Surviving export/helper grep | 0 | Exactly 5 lines. |
| T-09 | Package JSON parse | 0 | Valid JSON. |
| T-10 | DEC grep | 0 | DEC-163 then DEC-164. |
| T-11 | `git diff 4b967630 -- Mingla_Artifacts/INVARIANT_REGISTRY.md` | 0 | Empty. |
| T-12 | META-0929 static guard 1 | `rg -n "sessionIdOverride=" app-mobile/src` | 0 | One match: `CollabDeckSheet.tsx:127`. |
| T-12 | META-0929 static guard 2 | `rg -n "currentMode=|sessionIdOverride=" app-mobile/src/components/HomePage.tsx` | 1 | Zero output. |
| T-12 | META-0929 static guard 3 | `rg -n "const \\[currentSessionId|const \\[sessionModalTrigger|const \\[pendingSessionOpen|const \\[inviteModalTrigger|const \\[currentMode" app-mobile/app/index.tsx` | 1 | Zero output. |
| T-12 | META-0929 static guard 4 | `rg -n "GlassSessionSwitcher|CollaborationSessions" app-mobile/src app-mobile/app --glob '!**/__tests__/**'` | 1 | Zero output. |
| T-13 | `node --test .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs` | 0 | 3 pass, 0 fail. |
| T-13 | `node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | 0 | PASS, violations=0. |
| T-13 | `node --test .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.test.mjs` | 0 | 2 pass, 0 fail. |
| T-13 | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | 0 | Scanned 965 files, 64 listeners, 0 violations. |
| T-14 | Memory directory check | 0 | Directory exists; no memory edits performed. |
| T-15 | `git diff --name-only origin/main -- supabase/ mingla-business/ mingla-admin/ packages/` | 0 | Reports pre-existing `supabase/functions/ticket-checkout-create/index.ts`; not touched/staged by ORCH-0942. |
| T-16 | iOS Swipe smoke | Not run | Tester/operator manual gate. |
| T-17 | Matches smoke | Not run | Tester/operator manual gate. |
| T-18 | Plans smoke | Not run | Tester/operator manual gate. |
| Extra | `git diff --check -- <scoped files>` | 0 | No whitespace errors. |

## 13. Regression Surface

1. `MessageInterface.tsx` imports from `CollabSessionChatBanners.tsx`: protected by untouched diff and TypeScript/import checks.
2. Plans and Matches bottom sheets: protected by surviving export grep and tester smoke requirement.
3. Collab deck Swipe path: protected by untouched `CollabDeckSheet.tsx` and ORCH-0939 gate.
4. Existing test suite residue: see discovery below.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Stale ghost-session test string assertion | `CollabDeckSheet.ghostSessionRegression.test.tsx` still string-checks old `<InChatDeckSheet>` source and would fail if run. It is outside SPEC scope and has no import of deleted exports. | Orchestrator opens a follow-up cleanup/rewrite or explicitly widens ORCH-0942 before close. | `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx:108,222` |
| Exact scoped `tsc` command noise | Direct-file `tsc` ignores needed repo TSX flags and produces known transitive noise. | Standardize a repo scoped TS command or accept documented pre-existing baseline. | TypeScript tooling |
| Existing dirty Supabase file | Worktree has unrelated `supabase/functions/ticket-checkout-create/index.ts` modified before this implementation. | Owner resolves separately; not staged here. | `supabase/functions/ticket-checkout-create/index.ts` |

## 15. Discoveries For Orchestrator

- The SPEC/investigation claim 4 META-0929 strict-grep scripts exist, but no `.github/scripts/strict-grep/i-proposed-meta-0929-*.mjs` files exist in this checkout. I ran the static guards from the META-0929 QA report instead.
- The stale `CollabDeckSheet.ghostSessionRegression.test.tsx` assertion is now the only non-doc/test-receipt source reference to `InChatDeckSheet` after deletion, and it is outside this SPEC's edit scope.

## 16. Deploy Notes

- **Migrations:** None. `supabase db push` not run.
- **Edge functions:** None. No deploy.
- **Mobile OTA/native:** No EAS OTA; no user-visible change.
- **Business/admin web:** Not touched; no `[deploy]` tag.
- **Env vars/secrets:** None.

## Post-Stage Git Status

```text
D  .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs
M  Mingla_Artifacts/DECISION_LOG.md
A  Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
M  app-mobile/package.json
D  app-mobile/scripts/ci/orch-0918-adversarial-check.mjs
D  app-mobile/scripts/ci/orch-0918-regression-check.mjs
M  app-mobile/src/components/chat/CollabSessionChatBanners.tsx
D  app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx
D  app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts
D  app-mobile/src/store/sessionDeckMountStore.ts
 M supabase/functions/ticket-checkout-create/index.ts
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
?? "Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK 2.md"
?? "Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK_REWORK_2 2.md"
?? "Mingla_Artifacts/reports/REVIEW_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND 2.md"
?? Mingla_Artifacts/reports/evidence/orch0931_close_sheet.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_open_prefs_from_deck.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_open_session_options.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_open_swipe_deck.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_android_open_testing_stuff.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_open_testing_deck.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_open_testing_prefs.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_open_testing_stuff.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_open_testing_stuff_coords.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_tap_friends.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_tap_swipe_tab.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_retest2_toggle_pref_save.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_save_current_pref_diff.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_tap_dim_to_close.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_tap_testing_stuff_accessibility.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_tap_testing_stuff_simA.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_tap_testing_stuff_simB.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_tap_testing_stuff_text.yaml
?? Mingla_Artifacts/reports/evidence/orch0931_toggle_first_dates_and_save.yaml
?? Mingla_Artifacts/sim_test_reference/
?? "Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0850_CALENDAR_ARCHIVE_USES_END_NOT_START 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0863_MARKETING_HUB_PHASE_B 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0864_MARKETING_COMPOSER_V2 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0875_TR4_REFUND_TIERS_BOOKING_DEADLINE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0881_VE5_MENU_AI_PARSER 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0882_PAYMENT_PLAN_DISCLOSURE_RENDER 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0887-A_AUTH_GETSESSION_TIMEOUT 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0889_MARKETING_TAB_DESKTOP_WEB_FIT_AND_FINISH 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0891_MARKETING_HUB_PREMIUM_COMPOSER_DESKTOP_AND_MOBILE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0892-C_GATE_AND_INVARIANT_PROMOTE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0897_TRIP_EVENT_GROUP_CHAT 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0901_GET_CONVERSATIONS_4N_QUERY_PERF 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0914_TRIP_MONEY_TAB_REDESIGN 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS 2.md"
?? "Mingla_Artifacts/specs/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED 2.md"
?? Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
?? app-mobile/prefs_after_toggle.png
?? "app-mobile/src/diagnostics/silenceStripeForwardRef 2.ts"
?? "docs/runbooks/VERCEL_VERCELIGNORE_ARCHITECTURE 2.md"
?? feedback_collab_deck_must_wrap_with_provider.md
?? "mingla-admin/.vercelignore 2"
?? "mingla-business/.vercelignore 2"
?? "mingla-business/api/public-trip 2.js"
?? "mingla-marketing/.vercelignore 2"
?? supabase/migrations/20260724000001_orch_0931_realtime_broadcast_session_updated.sql
```

## Explicit Scope Declaration

No file outside SPEC §1 IN-scope was modified by this implementation, except the requested durable implementation report. Existing unrelated dirty/untracked files in the shared worktree were left untouched. The pre-existing `supabase/functions/ticket-checkout-create/index.ts` modification was not authored, edited, or staged by ORCH-0942.

## Suggested Commit Message

```text
Close ORCH-0942: META-ORCH-0929 dead-code reap [TEST-MOD-APPROVED ORCH-0942]

Delete orphaned CollabSessionChatBanners + InChatDeckSheet + BannerRow
functions, the useSessionDeckMountStore Zustand mutex + its test, the
orch-0918 strict-grep + regression + adversarial CI scripts, the
CollabSessionChatBanners.test.tsx test file, and the dead test:orch-0918
package.json script.

No user-visible change. No EAS OTA needed. Mobile-only diff; no [deploy] tag.

Spec: Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
Evidence: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
```

## Ready-To-Test Checklist

1. Verify no broken imports on Metro/app launch.
2. iOS sim and Android emulator: Friends -> Testing stuff -> Swipe opens black `CollabDeckSheet` with session header.
3. iOS sim and Android emulator: `Matches` opens `SavedToSessionCardsSheet`.
4. iOS sim and Android emulator: `Plans` opens `ScheduleSheet`.
5. Operator physical iPhone HITL repeats the three sub-tab smoke checks.

## REWORK Addendum — Caveat #4 Stale Ghost-Session Assertion

> Date: 2026-05-23
> Source: `Mingla_Artifacts/reports/REVIEW_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`
> Status: reworked and verified

### Rework Change

File: `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx:220`

**Before:**

```ts
assert.match(
  chatBanners,
  /showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s,
  "CollabSessionChatBanners must unmount InChatDeckSheet when the deck sheet is closed",
);
```

**After:**

```ts
assert.doesNotMatch(
  chatBanners,
  /InChatDeckSheet/,
  "InChatDeckSheet has been removed per ORCH-0942 — CollabSessionChatBanners must not re-introduce it",
);
```

**Why:** ORCH-0942 deletes `InChatDeckSheet`; the old ORCH-0939 ghost-session test asserted that the deleted symbol still existed in `CollabSessionChatBanners.tsx`, so it failed post-cleanup. The inverse assertion preserves the ghost-session test while encoding the new ORCH-0942 contract.

**Fails-on-revert:** Yes. Reverting this assertion to `assert.match(... /showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s ...)` reproduces the reviewer-observed failure because `InChatDeckSheet` is no longer present in `CollabSessionChatBanners.tsx`.

### Rework Verification

| Check | Command | Exit | Output |
|---|---|---:|---|
| Compile ghost + provider tests | `rm -rf /tmp/orch-0942-rework-tests && cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0942-rework-tests` | 0 | No compiler output. |
| Run ghost-session regression | `node /tmp/orch-0942-rework-tests/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.js` | 0 | `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` |
| Run provider-wrap regression | `node /tmp/orch-0942-rework-tests/components/connections/__tests__/CollabDeckSheet.providerWrap.test.js` | 0 | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| Compile realtimeService ORCH-0931 with RN global shim | `printf 'declare const __DEV__: boolean;\n' > /tmp/orch-0942-rework-globals.d.ts && rm -rf /tmp/orch-0942-rework-realtime-clean && cd app-mobile && npx tsc /tmp/orch-0942-rework-globals.d.ts src/services/realtimeService.ts src/services/__tests__/realtimeService.orch-0931.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0942-rework-realtime-clean` | 0 | No compiler output. |
| Run realtimeService ORCH-0931 | `node /tmp/orch-0942-rework-realtime-clean/services/__tests__/realtimeService.orch-0931.test.js` | 0 | `PASS T-IMP-1` through `PASS T-IMP-5`. |

### Updated Staged Files

The rework adds exactly one staged file to the prior 10-file staged set, for 11 staged files total:

```text
.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs
Mingla_Artifacts/DECISION_LOG.md
Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
app-mobile/package.json
app-mobile/scripts/ci/orch-0918-adversarial-check.mjs
app-mobile/scripts/ci/orch-0918-regression-check.mjs
app-mobile/src/components/chat/CollabSessionChatBanners.tsx
app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx
app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx
app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts
app-mobile/src/store/sessionDeckMountStore.ts
```
