# INVESTIGATION — ORCH-0942 [META-ORCH-0929 dead-code reap — CollabSessionChatBanners + InChatDeckSheet + orphan banners + obsolete ORCH-0918 gates/tests]

**Date:** 2026-05-23
**Mode:** INVESTIGATE-only (no fix proposed, no code touched)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at HEAD `4b967630`
**Operator directive:** chat surface must expose ONLY `Matches` / `Swipe` / `Plans` sub-tab pills in `MessageInterface` header; everything else dies.
**Confidence:** HIGH on the dead-code register. Two orchestrator-hypothesis errors corrected (one false-positive, one phantom invariant set). Live-fire runtime confirmation from Retest 4 (2026-05-23 14:06:59) on 3 sims + operator HITL physical iPhone supports the dead-code thesis.

---

## Symptom Summary

ORCH-0918 [Collab session group chat banners + in-chat deck + in-deck prefs] (PR #173, merged commit `f791d27c`, 2026-05-23 morning) shipped a 3-banner architecture mounted in the chat body — Plans / Saved-to-session / "Swipe cards together" — with an `InChatDeckSheet` (white background full-screen modal) reached through the orange "Swipe cards together" banner. Hours later, **META-ORCH-0929** [Collab decks live in group chat — Home is solo-only] (PR #179, merged commit `4693ad79`) replaced that architecture with **3 sub-tab pills in the chat header** that dispatch to `SavedToSessionCardsSheet` / `CollabDeckSheet` (black background, in `components/connections/`) / `ScheduleSheet`. META-ORCH-0929 deleted the `<CollabSessionChatBanners />` JSX render from `MessageInterface` (commit `167d4757` diff: `-<CollabSessionChatBanners`) but did NOT delete: the `CollabSessionChatBanners` component itself, the `InChatDeckSheet` it embeds, the `BannerRow` helper, the `useSessionDeckMountStore` Zustand mutex, the strict-grep script `orch-0918-banners-only-on-session-conv.mjs`, the regression/adversarial CI scripts at `app-mobile/scripts/ci/orch-0918-*-check.mjs`, the test file `CollabSessionChatBanners.test.tsx`, or the `package.json` `test:orch-0918` script entry. None of those orphans render to users today, but they live in the source tree, consume contributor attention, and the strict-grep gate would FAIL HARD if anyone ever re-wired it into the workflow (it asserts `<CollabSessionChatBanners` count `=== 1` in MessageInterface; today's count is 0). This investigation enumerates exactly what is dead, exactly what is alive that shares the same file/folder, and exactly what cleanup paths are safe.

---

## Investigation Manifest (every file/region read in trace order)

1. `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` — north-star (verifies operator's "Matches/Swipe/Plans only" end-state is the codified product direction)
2. `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md` — confirms what ORCH-0918 SHIPPED
3. `Mingla_Artifacts/specs/SPEC_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` — confirms what META-ORCH-0929 superseded
4. `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_*.md` — META rationale
5. `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0929_*.md` — what was actually built/deleted
6. `Mingla_Artifacts/reports/QA_META-ORCH-0929_*.md` — what the META QA verified
7. `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_4.md` — RUNTIME LAYER evidence (lines 7-12 + device matrix)
8. `Mingla_Artifacts/INVARIANT_REGISTRY.md` lines 3706, 3720, 3734, 3748 — META-0929 invariants
9. `Mingla_Artifacts/DECISION_LOG.md` lines 192-208 — DEC-162 + DEC-163
10. `git show 167d4757 -- ...` — META-ORCH-0929 close diff (confirms `<CollabSessionChatBanners` JSX deleted, file kept)
11. `git show f791d27c -- ...` — ORCH-0918 close diff (verbatim file list created)
12. `app-mobile/src/components/MessageInterface.tsx` lines 38-41, 45, 293-295, 354, 1162-1173, 1363, 2182-2218 — current canonical mount points
13. `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 1-712 + style block ~782-844 — full file: 7 top-level exports + 2 helpers + ~63 style entries
14. `app-mobile/src/components/connections/CollabDeckSheet.tsx` — the canonical Swipe sub-tab sheet (just-PASSed Retest 4)
15. `app-mobile/src/store/sessionDeckMountStore.ts` + `__tests__/sessionDeckMountStore.test.ts`
16. `app-mobile/src/hooks/useSessionScheduledCards.ts`
17. `app-mobile/src/components/board/LockedPlanBanner.tsx` + `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` — carry-forward verify
18. `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` (full file)
19. `.github/workflows/strict-grep-mingla-business.yml` — confirm ORCH-0918 job NOT wired
20. `app-mobile/scripts/ci/orch-0918-regression-check.mjs` — 13 assertions targeted
21. `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` — 16 assertions targeted
22. `app-mobile/package.json` line 56 — dead `test:orch-0918` script
23. `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx`
24. `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts`
25. `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`
26. `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/*.md` — searched for dead-code refs
27. `find app-mobile/src -name "*Collab*.tsx" -o -name "*Deck*Sheet*"` — broader orphan scan

---

## Five-Truth-Layer Cross-Check

| Layer | Truth |
| --- | --- |
| **Docs** | `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` (lines 16-19): "Collab sessions live inside group chats. A session IS the chat." `SPEC_META-ORCH-0929_*.md` §2.1 + §3 Q9 + §5.4.1 lock the 3-pill header architecture and the single CollabDeckSheet mount. ORCH-0918's banner-row architecture is explicitly superseded. |
| **Schema** | N/A — no DB tables/RLS touched in this audit scope. `board_user_swipe_states` / `board_saved_cards` RLS supports `SavedToSessionCardsSheet` (live) — unchanged. |
| **Code** | `<CollabSessionChatBanners />` JSX render: **0 sites repo-wide** (only test/CI grep). `<InChatDeckSheet />`: 1 site, inside the dead `CollabSessionChatBanners` function (line 703). `<BannerRow />`: 3 sites, all inside the dead function (lines 648, 662, 675). `MessageInterface.tsx` has the 3-action dispatcher `handleOpenCollabDeckView(view: CollabChatHeaderActionId)` at line 1162 firing `setShowCollabMatchesSheet` (matches) / `setShowCollabPlansSheet` (plans) / `setShowCollabDeckSheet` (else=swipe), wired to `action.id` at line 1363, mounting `<SavedToSessionCardsSheet>` (line 2201) / `<ScheduleSheet>` (line 2212) / `<CollabDeckSheet>` (line 2183). Exactly the operator's required end-state. |
| **Runtime** | Retest 4 QA report (2026-05-23 14:00-14:09): 3 sims + operator's physical iPhone all reached the full deck sheet via the "Swipe" sub-tab pill at the chat header → `<CollabDeckSheet>` (black background, "Testing stuff" title). Screenshots at `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/*_post.png` confirm. The orange "Swipe cards together" banner is NOT in any screenshot — operator and tester explicitly verified the live chat surface has only the 3 sub-tab pills. |
| **Data** | N/A — no DB rows affected. |

**Verdict:** All five layers agree. The dead architecture is provably unreachable in production code paths.

---

## Findings — Verified-Dead Register

### 🔴 ROOT — `CollabSessionChatBanners` function and the 3 BannerRow children + `openDeck` callback

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`
- **Lines:** 612-712 (the `CollabSessionChatBanners` export) + 624 (`showDeckSheet` state) + 632-643 (`openDeck` callback) + 648-684 (3 `<BannerRow>` renders for Plans / Matches / Swipe-cards-together) + 685-700 (the IN-FILE `<ScheduleSheet>` + `<SavedToSessionCardsSheet>` mounts that duplicate the live MessageInterface mounts at 2201/2212) + 702-710 (the `<InChatDeckSheet>` mount).
- **Dead-because:** Zero JSX render sites outside of dead code itself. META-ORCH-0929 commit `167d4757` removed the `<CollabSessionChatBanners` from MessageInterface. Only test/CI grep refs remain.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES. No live consumer.

### 🔴 ROOT — `InChatDeckSheet` function

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 511-606
- **Lines:** Export function declaration + Modal-wrapped layout (`deckSheet` white background) + nested `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` + `<SwipeableCards>` mount + in-modal `<PreferencesSheet>`
- **Dead-because:** Single JSX render at line 703 inside the dead `CollabSessionChatBanners` function. No other consumers; no other imports.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.

### 🔴 ROOT — `BannerRow` internal helper

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 255-296
- **Dead-because:** Only consumers are 3 `<BannerRow>` calls inside the dead `CollabSessionChatBanners` (lines 648, 662, 675). No external imports.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.

### 🔴 ROOT — `useSessionDeckMountStore` Zustand mutex + its test

- **Files:** `app-mobile/src/store/sessionDeckMountStore.ts` (whole file) + `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` (whole file)
- **Dead-because:** Only consumers are inside the dead `InChatDeckSheet` (line 525, `release`) + dead `CollabSessionChatBanners` (line 630, `acquire`). The orchestrator's brutal handoff hypothesized residual `acquire/release` calls in `HomePage.tsx` + `app/index.tsx` + `useAuthSimple.ts` — **all three confirmed ZERO matches by repo-wide grep.** Cleaner than the hypothesis.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.
- **Test deletion:** requires append-only override token `[TEST-MOD-APPROVED ORCH-0942]` in CLOSE commit body per `tests-append-only.yml`.

### 🔴 ROOT — strict-grep script `orch-0918-banners-only-on-session-conv.mjs`

- **File:** `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` (whole file, 4233 bytes)
- **Dead-because:** Workflow yml `.github/workflows/strict-grep-mingla-business.yml` has **zero** references to `orch-0918`, `orch_0918`, or `collab-session-chat-banners` (verified by grep). The script is not wired into any GitHub Actions job, so it never runs in CI. If it ever ran, its first non-trivial assertion would FAIL HARD: `(message.match(/<CollabSessionChatBanners/g) ?? []).length === 1` — today's count is **0**. The script enforces a post-META-0929 contradiction.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.

### 🔴 ROOT — regression check `orch-0918-regression-check.mjs` (13 assertions)

- **File:** `app-mobile/scripts/ci/orch-0918-regression-check.mjs`
- **Dead-because:** Every assertion text references `<CollabSessionChatBanners` / `InChatDeckSheet` patterns in MessageInterface (e.g. line 42-43: `/<CollabSessionChatBanners/g, "<CollabSessionChatBanners_REMOVED"`; line 270: `"PreferencesSheet must be rendered inside InChatDeckSheet Modal children"`; line 283: `"InChatDeckSheet must wrap SwipeableCards in a nested RecommendationsProvider..."`). All target dead JSX patterns.
- **Wiring:** `package.json` line 56 — `"test:orch-0918": "node ./scripts/ci/orch-0918-regression-check.mjs"` is the only orchestration entry. Not invoked by any GitHub Actions workflow.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES. Plus delete the `test:orch-0918` package.json script entry.

### 🔴 ROOT — adversarial check `orch-0918-adversarial-check.mjs` (16 assertions)

- **File:** `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`
- **Dead-because:** Same — every assertion targets dead `CollabSessionChatBanners` / `InChatDeckSheet` patterns (e.g. line 41: `"T-A14 Mongrel-prop prevention — InChatDeckSheet MUST pass currentMode"`).
- **Wiring:** No package.json script invokes it; no workflow job runs it.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.

### 🔴 ROOT — `CollabSessionChatBanners.test.tsx`

- **File:** `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`
- **Dead-because:** Imports `CollabSessionChatBanners` + `InChatDeckSheet` (both dead) at lines 2-3. `runOrch0918BannerExportFixture` runtime-checks `typeof InChatDeckSheet === "function"` — once `InChatDeckSheet` is deleted, this fixture asserts an undefined name and the test file errors at runtime. `runOrch0918BannerVisibilityFixture` tests render conditions for the dead banner rows.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES (with `[TEST-MOD-APPROVED ORCH-0942]` token).

### 🔴 ROOT — `package.json` `test:orch-0918` script entry

- **File:** `app-mobile/package.json` line 56: `"test:orch-0918": "node ./scripts/ci/orch-0918-regression-check.mjs"`
- **Dead-because:** Points at the dead regression script.
- **Classification:** 🔴 Confirmed-dead.
- **Safe to delete:** YES.

---

## Findings — Verified-Alive Register (DO NOT DELETE)

### 🔵 ALIVE — `ScheduleSheet` (export)

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 373-448
- **Live consumer:** `MessageInterface.tsx:2212` mounts `<ScheduleSheet visible={showCollabPlansSheet} ...>` — the Plans sub-tab handler.
- **Verdict:** Must stay in the file (or be moved cleanly to a new home). Internal helper `CompactCollabBottomSheet` is used here at line 381.

### 🔵 ALIVE — `SavedToSessionCardsSheet` (export)

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 450-509
- **Live consumer:** `MessageInterface.tsx:2201` mounts `<SavedToSessionCardsSheet visible={showCollabMatchesSheet} ...>` — the Matches sub-tab handler.
- **Verdict:** Must stay. Internal helper `CompactCollabBottomSheet` is used here at line 479.

### 🔵 ALIVE — `useSessionSavedCardsForSheet` (hook export)

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 99-158
- **Live consumer:** `MessageInterface.tsx:354` (feeds `matchedSessionCards` + `matchedSessionCardsLoading` for the Matches sheet).
- **Verdict:** Must stay.

### 🔵 ALIVE — `CompactCollabBottomSheet` (internal helper)

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` lines 297-371
- **Live consumers:** lines 381 (inside live `ScheduleSheet`) + 479 (inside live `SavedToSessionCardsSheet`).
- **Verdict:** **The orchestrator's brutal handoff incorrectly flagged this as dead** in claim #3 ("`BannerRow` helper at lines 255-296 + `CompactCollabBottomSheet` at line 297 — only consumed by dead functions"). REALITY: `CompactCollabBottomSheet` has 2 live consumers. DO NOT DELETE.
- **Classification:** 🔵 Observation (orchestrator hypothesis correction).

### 🔵 ALIVE — `SavedSessionCard` interface

- **File:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` line 61 (`export interface SavedSessionCard`)
- **Live consumer:** type usage in `useSessionSavedCardsForSheet` return value, consumed by MessageInterface.
- **Verdict:** Keep.

### 🔵 ALIVE — `useSessionScheduledCards` hook

- **File:** `app-mobile/src/hooks/useSessionScheduledCards.ts`
- **Live consumer:** `MessageInterface.tsx:315` (feeds `scheduledCardsQuery` for the Plans sub-tab badge count).
- **Verdict:** KEEP. Orchestrator hypothesis hedged ("possibly reused by ScheduleSheet"); verified ALIVE via MessageInterface direct import at line 56.

### 🔵 ALIVE — `LockedPlanBanner.tsx` + `LockedCardSchedulingSheet.tsx`

- **Files:** `app-mobile/src/components/board/LockedPlanBanner.tsx` + `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx`
- **Live consumers:** `BoardDiscussionTab.tsx:682` mounts `<LockedPlanBanner>`; `SwipeableSessionCards.tsx:593` mounts `<LockedCardSchedulingSheet>`. Both ship with ORCH-0918 but are NOT in the dead banner chain.
- **Verdict:** KEEP (orchestrator hypothesis correctly hedged).

### 🔵 ALIVE — `orch-0918-message-and-deck-contract.test.tsx` + `orch-0918-session-card-hooks.test.ts` fixture functions

- **Files:** `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx` + `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts`
- **What they test:** `runOrch0918MessagePredicateFixture` tests `isCollabSessionGroupChat` discriminator (`conversationType === 'group' && linkedEntityType === 'session' && !!sessionId`) — **logic still live in `MessageInterface.tsx`**. `runOrch0918ResolvedSessionFixture` tests `sessionIdOverride` resolution — live. `runOrch0918ScheduledOrderingFixture` tests calendar entry sort — live alongside `useSessionScheduledCards`.
- **Verdict:** KEEP test files (logic tested is still active). Optional: rename `ORCH-0918`-prefixed identifiers to something neutral, but this is purely cosmetic and not required.
- **Append-only impact:** because the test files themselves stay, no `[TEST-MOD-APPROVED]` token needed for these.

### 🔵 ALIVE — META-ORCH-0929 strict-grep gates + invariants

- **Files:** `.github/scripts/strict-grep/` (4 gates from META-ORCH-0929) + `INVARIANT_REGISTRY.md` lines 3706/3720/3734/3748 (4 META-0929 invariants).
- **Verdict:** UNTOUCHED. These enforce the NEW architecture and stay.

---

## Findings — P0 Orchestrator Hypothesis Errors (per handoff Rule)

### P0-1 — `CompactCollabBottomSheet` is ALIVE, not dead

- **Orchestrator claim:** "BannerRow helper at lines 255-296 + CompactCollabBottomSheet at line 297 — only consumed by dead functions" (Brutal handoff, item 3).
- **Reality:** `CompactCollabBottomSheet` has 2 live consumers — line 381 inside `ScheduleSheet` (alive, MessageInterface.tsx:2212) and line 479 inside `SavedToSessionCardsSheet` (alive, MessageInterface.tsx:2201).
- **Why this matters:** If the implementor follows the orchestrator's verbatim deletion list, deleting `CompactCollabBottomSheet` breaks both Plans and Matches sub-tabs. This is the EXACT P0 the handoff warned about: "If you discover a code path I claimed was dead but is actually live, that is a P0 finding and MUST be called out at the top of the report — the cleanup ORCH cannot ship if my dead-code list contains live code."
- **Classification:** 🔴 P0 — must override the orchestrator hypothesis in the SPEC.

### P0-2 — The 3 ORCH-0918 invariants the orchestrator claimed exist do not exist

- **Orchestrator claim:** "3 ACTIVE invariants in `INVARIANT_REGISTRY.md` — `I-PROPOSED-COLLAB-SESSION-CHAT-BANNERS-ONLY-ON-SESSION-CONV`, `I-PROPOSED-IN-CHAT-DECK-SINGLE-MOUNT`, `I-PROPOSED-IN-DECK-PREFS-SUB-SHEET-INSIDE-PARENT` — all enforce the dead architecture" (Brutal handoff, item 9).
- **Reality:** `grep -nE "ORCH-0918|COLLAB-SESSION-CHAT-BANNERS|IN-CHAT-DECK|IN-DECK-PREFS"` against `INVARIANT_REGISTRY.md` returns **ZERO** matches. The 3 named invariants are not in the registry. Either they were never added by the ORCH-0918 close (despite the WORLD_MAP entry claiming they were flipped ACTIVE), or META-ORCH-0929's close removed them along with the JSX render. Either way, **nothing to deprecate.**
- **Why this matters:** The cleanup ORCH does NOT need to write any `INVARIANT_REGISTRY.md` deprecation entries. The orchestrator's planned scope for that section is empty.
- **Classification:** 🔴 P0 — registers a 0-line SPEC §X (invariant deprecation) instead of a multi-line one.

---

## Findings — Cleaner-than-feared Confirmations

### 🔵 OBS-1 — `useSessionDeckMountStore` mutex is fully isolated

- **Orchestrator hedge:** "possibly all dead now" (HomePage / app/index.tsx / useAuthSimple references).
- **Reality:** ZERO matches in `HomePage.tsx`, `app/index.tsx`, or `useAuthSimple.ts`. Only consumers are inside the dead `CollabSessionChatBanners.tsx` (lines 525 + 630). The mutex was never wired into the broader app — it lived entirely inside the now-dead component chain. Delete is surgical.

### 🔵 OBS-2 — No memory file references the dead code

- **Orchestrator hedge:** "Hunt for memory entries under `~/.claude/projects/.../memory/` referencing ORCH-0918 banners or InChatDeckSheet, esp. `feedback_collab_deck_lives_in_group_chat.md` — flag any that contradict the current state."
- **Reality:** `grep -rln "ORCH-0918\|InChatDeckSheet\|CollabSessionChatBanners\|Swipe cards together"` against the memory directory returns **ZERO** matches. The active memory file `feedback_collab_deck_lives_in_group_chat.md` correctly describes the META-ORCH-0929 architecture without referencing the dead ORCH-0918 surfaces. Nothing to update.

### 🔵 OBS-3 — DEC-162 + DEC-163 cover GlassSessionSwitcher/CollaborationSessions but NOT CollabSessionChatBanners/InChatDeckSheet

- **`DECISION_LOG.md` lines 192-208:** DEC-162 decommissions `GlassSessionSwitcher` + `CollaborationSessions`; DEC-163 decommissions "global active-session concept." Neither names `CollabSessionChatBanners` or `InChatDeckSheet`.
- **Implication:** Cleanup ORCH should add **DEC-164** explicitly decommissioning these surfaces, supersession by META-ORCH-0929 + this ORCH.

### 🔵 OBS-4 — No other orphaned collab UI surfaces

- Component-name scan found only: `CollabDeckSheet.tsx` (alive — META-ORCH-0929), `CollabSessionChatBanners.tsx` (partial dead per this report), `PendingCollabChatSheet.tsx` (alive — META-ORCH-0929 on-the-fly), `OnboardingCollaborationStep.tsx` (onboarding, unrelated).
- No third orphan ORCH to chase.

---

## Cleanup-Scope Register (consolidated)

### Files to delete entirely

1. `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` — dead gate, unwireable
2. `app-mobile/scripts/ci/orch-0918-regression-check.mjs` — 13 assertions all target dead JSX
3. `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` — 16 assertions all target dead JSX
4. `app-mobile/src/store/sessionDeckMountStore.ts` — only-dead-consumer
5. `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` — tests dead store (needs `[TEST-MOD-APPROVED ORCH-0942]`)
6. `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` — imports dead exports (needs `[TEST-MOD-APPROVED ORCH-0942]`)

### Files to surgically edit

7. `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`:
   - DELETE lines 511-606 (`InChatDeckSheet` function)
   - DELETE lines 612-712 (`CollabSessionChatBanners` function)
   - DELETE lines 255-296 (`BannerRow` helper)
   - DELETE the import on line 35 of `useSessionDeckMountStore` (after store deletion)
   - DELETE the duplicate import in the same file of `useSessionScheduledCards` if only used by dead code (verify — line 32-34) — note that one consumer at line 375 is inside the live `ScheduleSheet`, so KEEP the import
   - DELETE the import of `RecommendationsProvider` if no live consumer remains (verify — only the dead `InChatDeckSheet` uses it in this file; the live ScheduleSheet/SavedToSessionCardsSheet don't)
   - DELETE style-block entries that are referenced only by deleted functions: `stack`, `banner`, `iconShell`, `bannerText`, `bannerTitle`, `bannerSubtitle`, plus any `deckSheet` / `deckHeader` / `deckTitle` / `deckBody` / `headerButton` blocks used only by InChatDeckSheet (audit before deletion)
   - KEEP everything else (the 3 alive exports + `CompactCollabBottomSheet` + `SavedSessionCard` interface + the styles used by the alive surfaces)
   - File shrinks from ~840 lines to ~450 lines, name stays (no import-path churn)

8. `app-mobile/package.json`:
   - DELETE line 56: `"test:orch-0918": "node ./scripts/ci/orch-0918-regression-check.mjs"`

9. `Mingla_Artifacts/DECISION_LOG.md`:
   - ADD DEC-164: "ORCH-0918 banner architecture + InChatDeckSheet + useSessionDeckMountStore decommissioned per ORCH-0942 (supersession by META-ORCH-0929)"

### Files to keep untouched

- `app-mobile/src/components/MessageInterface.tsx` — already correct; the 3 sub-tab dispatch + 3 sheet mounts at lines 1162-1173 / 2183 / 2201 / 2212 are the canonical end-state
- `app-mobile/src/components/connections/CollabDeckSheet.tsx` — Swipe sub-tab target, just-PASSed Retest 4
- `app-mobile/src/hooks/useSessionScheduledCards.ts` — live consumer in MessageInterface.tsx:315
- `app-mobile/src/components/board/LockedPlanBanner.tsx` + `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` — alive, unrelated to dead banners
- `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx` — tests live predicates
- `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts` — tests live hook logic
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — 0 ORCH-0918 invariants to remove (none exist)
- `~/.claude/projects/.../memory/*.md` — 0 dead-code memory refs to update
- 4 META-ORCH-0929 strict-grep gates — alive, untouched

### Append-only test-deletion impact

Two test files require deletion with `[TEST-MOD-APPROVED ORCH-0942]` token in the CLOSE commit body per `.github/workflows/tests-append-only.yml`:

| File | `it()` / `describe()` blocks | Test value as regression for live architecture |
| --- | --- | --- |
| `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` | 2 (mutex acquire-release + dedicated-screen owner) | ZERO — tests a dead store |
| `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` | 2 fixture exports (`runOrch0918BannerExportFixture`, `runOrch0918BannerVisibilityFixture`) | ZERO — both fixtures check dead behaviour |

Both files contribute zero regression value to the live architecture; deletion is the honest choice.

---

## Blast Radius Map

- **MessageInterface (live):** unaffected — its 3 sub-tab dispatch path doesn't touch any deleted file beyond the imports at line 38-41 (which keep `ScheduleSheet`, `SavedToSessionCardsSheet`, `useSessionSavedCardsForSheet` — all alive).
- **CollabDeckSheet (live):** unaffected — different file (`connections/`), different mount path.
- **HomePage / app/index.tsx:** unaffected — confirmed zero references to `useSessionDeckMountStore` / `CollabSessionChatBanners` / `InChatDeckSheet`.
- **useAuthSimple:** unaffected.
- **Other strict-grep gates:** META-ORCH-0929's 4 gates (`I-PROPOSED-META-0929-*`) untouched; cleanup does not change them.
- **CI workflow:** the workflow yml already doesn't reference `orch-0918-banners-only`; deletion of the script file is a no-op on CI scheduling.
- **EAS OTA / Vercel:** no user-visible change. Mobile-only diff. No `[deploy]` tag needed.

---

## Invariant Violations

None. The dead code is dead, the live code is correct, and META-ORCH-0929's 4 invariants (`I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN`, `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT`, `I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY`, `I-PROPOSED-META-0929-NO-GLOBAL-ACTIVE-SESSION`) remain enforced.

Constitution rule #8 (subtract before adding) is actually *violated* by the current state — META-ORCH-0929 added new architecture without subtracting the old. ORCH-0942 closes that violation.

---

## Fix Strategy (direction only — SPEC follows)

1. **Surgical edits in `CollabSessionChatBanners.tsx`** — delete 3 dead functions + 1 helper + 1 import + ~12 style entries; keep 3 export functions + 1 helper + 1 type + ~50 style entries. File renames optional, recommended NO rename to avoid import-path churn.
2. **Whole-file deletes** — 6 files (3 CI scripts/gates + 1 Zustand store + 2 test files).
3. **package.json edit** — 1 line removed.
4. **DECISION_LOG.md** — add DEC-164.
5. **INVARIANT_REGISTRY.md** — no change.
6. **Memory files** — no change.
7. **Test override token** — 2 test files require `[TEST-MOD-APPROVED ORCH-0942]` in CLOSE commit body.
8. **CI verification post-delete** — every existing strict-grep gate continues to pass; live regression tests at `orch-0918-message-and-deck-contract.test.tsx` + `orch-0918-session-card-hooks.test.ts` continue to pass (they test live behavior).
9. **No EAS OTA needed** — no user-visible change (the dead banners weren't visible).
10. **No `[deploy]` tag** — mobile-only diff, no Vercel-built surface touched.

---

## Regression Prevention

The cleanup does not require a new strict-grep gate. The dead architecture is being deleted, not renamed; it cannot resurface accidentally because the operator's product direction has codified the 3-pill header as canonical, and META-ORCH-0929's `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` invariant + CI gate already enforces single-mount discipline.

If future contributors re-introduce a chat-body-mounted deck/banner pattern, the META-0929 gates will fail. The ORCH-0942 deletion is structural — no new test required to prove it stays dead.

---

## Discoveries for Orchestrator

1. **`package.json` script `test:orch-0918`** — wasn't flagged in the orchestrator's brutal handoff hypothesis but is a real orphan; verbatim deletion line documented above (cleanup-scope register item 8).
2. **Two ORCH-0918 test fixture files test LIVE behaviour** despite having "ORCH-0918" in their identifier prefixes. Keep both files. Optional cosmetic rename pass to neutralize the ORCH-ID prefix on the helper functions, but not required for cleanup correctness.
3. **DEC-162 + DEC-163 did NOT name `CollabSessionChatBanners`/`InChatDeckSheet`** — they only named `GlassSessionSwitcher` + `CollaborationSessions`. The cleanup ORCH should write DEC-164 to fully document the decommission.
4. **WORLD_MAP.md ORCH-0918 close banner contradicts INVARIANT_REGISTRY.md reality** — the banner claims "Three new DRAFT invariants flipped ACTIVE" but those invariants don't exist in the registry. Either the close report overclaimed or META-ORCH-0929 silently removed them. Worth a one-line note in the cleanup ORCH's close banner clarifying that the 3 invariants the WORLD_MAP claimed were never landed (or were already removed). No action required beyond documentation honesty.
5. **`SwipeableSessionCards.tsx`** at `app-mobile/src/components/board/` — heavily used by `LockedCardSchedulingSheet` AND `SavedToSessionCardsSheet`. Out of scope for this cleanup but worth a future audit pass to confirm it's not silently orphaned.

---

## Confidence Level

**HIGH** on the dead-code register and the 2 orchestrator-hypothesis corrections (P0-1, P0-2).

**HIGH** on the alive register — every kept item has a cited live consumer (file:line).

**HIGH** on the cleanup safety — no migration, no edge function, no user-visible change, mobile-only diff, append-only token grammar known.

**MEDIUM** on the exact style-block dead-vs-alive split inside `CollabSessionChatBanners.tsx` — I enumerated the style top-level keys but didn't trace every `styles.X` reference. The SPEC phase will need to enumerate this precisely before the implementor's diff. (Or the implementor can use a one-pass `grep "styles\." -o app-mobile/src/components/chat/CollabSessionChatBanners.tsx | sort -u` against the surviving function bodies to determine which keys survive.)

---

## Live-fire Confirmation Note

Retest 4 (today, 2026-05-23 14:06:59) live-mounted the chat surface on iPhone 17 Pro Max sim (Ava), iPhone 17 sim (Priya), Pixel 8 Pro emulator (Ethan), and operator's physical iPhone (Marcus). All 4 devices navigated via the chat-header "Swipe" sub-tab pill → `<CollabDeckSheet>` (black background, "Testing stuff" title). Zero exercised the dead "Swipe cards together" banner; zero rendered `<InChatDeckSheet>`. Source-code analysis aligns with runtime observation. Live-fire confidence label: `proven` for the current chat-surface state; `inferred-from-source` for the dead-code claims (which do not require a runtime check because the JSX render sites are provably absent — there is no surface to reproduce).

QA report: `Mingla_Artifacts/reports/QA_ORCH-0939_ORCH-0931_FOUR_DEVICE_LIVE_MATRIX_RETEST_4.md` (PASS verdict).
Evidence directory: `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/`.

---

## End of investigation. Next phase: SPEC.
