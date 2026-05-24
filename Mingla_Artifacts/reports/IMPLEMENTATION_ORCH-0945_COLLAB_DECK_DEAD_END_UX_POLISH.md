# Implementation Report: Collab Deck Dead-End UX Polish (ORCH-0945)

> Date: 2026-05-23
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
> Status: implemented, partially verified

## 1. Layman Summary

Collab decks no longer collapse every dead end into vague copy. The mobile app now carries the server dead-end payload through the deck service/context, renders reason-specific dead-end copy, posts a token-bearing group-chat banner through the live-authorized user message path, still renders that banner as a system/token row, and can open another participant's preferences in read-only mode.

## 2. Request And Context

- **Request:** Implement ORCH-0945 mobile-only UX polish, stage 14-18 scoped files, no backend/deploy/push.
- **Source:** Spec + investigation named above; Contract 5 from `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`.
- **Affected surfaces:** Consumer mobile iOS + Android shared code.
- **Related artifacts:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`, strict-grep workflow.

## 3. Scope

- **In scope:** Collab dead-end payload propagation, per-reason deck copy, notify banner, token parser, read-only/focused `PreferencesSheet`, gates/tests/report.
- **Out of scope:** Edge function edits, migrations, message schema changes, Supabase deploy/push, Vercel deploy, PR/push/merge.
- **Assumptions:** Existing session group conversations exist via ORCH-0898; ORCH-0945 banners are now user-attributed `message_type = 'text'` rows because live `messages` RLS requires `sender_id = auth.uid()`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `SPEC_ORCH-0945...md` | Contract | 9 hard guards, T-01..T-09, 14-18 expected staged files |
| `INVESTIGATION_ORCH-0945...md` | Evidence | Client dropped rich dead-end payload; system banners must use text tokens |
| `deckService.ts`, `useDeckCards.ts`, `RecommendationsContext.tsx` | Data flow | Hook result needed additive `collabDeadEndPayload` propagation |
| `SwipeableCards.tsx` | Dead-end UI | Existing branch had only intersection/generic copy |
| `MessageBubble.tsx`, `MessageInterface.tsx` | Chat path | Live Friends-tab group chat uses `components/chat/MessageBubble.tsx` |
| `PreferencesSheet.tsx` | Deep-link target | No prior read-only participant view or section focus |

## 5. Blast Radius

- **Direct changes:** `app-mobile` deck service/hook/context/components, new banner service, focused tests.
- **Cascade changes:** Chat system token taps now open prefs sheet/composer/deck surface from `MessageInterface`.
- **Parity surfaces:** iOS and Android share the same React Native code path.
- **Cache impact:** No query key changes; only additive payload fields.
- **State boundaries:** AsyncStorage debounce key per `(sessionId,currentUserId,reason)`.
- **Auth/RLS/security:** No schema/RLS change. Banner insert uses existing `messages` table with `sender_id = currentUserId`; message enrichment classifies only recognized ORCH-0945 dead-end banner content as system-renderable.
- **Deploy path:** Mobile-only; no `[deploy]`, no edge deploy, no `supabase db push`.

## 6. Old To New Receipts

| File | Before | After |
|---|---|---|
| `deckService.ts` | Collab dead end returned only `curatedEmptyReason`. | Adds `CollabDeadEndPayload` with `reason`, `acceptedCount`, `pendingGpsUserIds`, `detail`. |
| `useDeckCards.ts` + `RecommendationsContext.tsx` | Hook/context exposed only reason. | Carries `collabDeadEndPayload` to consumers. |
| `SwipeableCards.tsx` | Two-copy dead-end branch. | Dedicated branches for all 5 reasons, notify CTA, review dismissed preservation. |
| `collabDeadEndBannerService.ts` | Did not exist. | Composes token-bearing text, writes with the authenticated sender required by live RLS, and debounces 5 minutes. |
| `messagingService.ts` | `isSystem` was true only for null-sender rows. | Preserves null-sender system rows and adds a narrow ORCH-0945 banner-content classifier so user-attributed dead-end banners render as system/token rows. |
| `chat/MessageBubble.tsx` | System text rendered inert. | Parses known tokens into accessible inline links; malformed tokens stay literal. |
| `MessageInterface.tsx` | No system token routing. | Routes prefs tokens to `PreferencesSheet`, dismissed token to deck, compose token to composer draft. |
| `PreferencesSheet.tsx` | Current-user editable only. | Adds `viewParticipantId`, `initialFocusSection`, read-only guard, hidden footer, focused section scroll. |
| Strict-grep + invariant files | No ORCH-0945 gates. | Registers reason/payload and read-only no-write gates. |

## 7. Implementation Details

- **Architecture decisions:** Used canonical `messages` substrate directly because legacy `boardDiscussionService.sendMessage` is intentionally blocked post-ORCH-0898. After live-fire RLS proved null-sender client inserts are rejected, the banner contract changed to user-attributed text rows plus narrow system rendering classification.
- **Data flow:** Server payload → `deckService.collabDeadEndPayload` → `useDeckCards` → `RecommendationsContext` → `SwipeableCards`.
- **Mutation/query behavior:** Banner insert is a single authenticated `messages` insert after resolving session conversation; no invalidation added because existing realtime handles message arrival.
- **State handling:** Duplicate notify taps no-op with "Already flagged just now." inside 5 minutes.
- **Error handling:** Failed banner insert warns and shows retryable toast; debounce key is not written on failure.
- **Copy/accessibility:** Token links get `accessibilityRole="link"` and visible labels; malformed tokens remain visible.
- **Analytics/notifications/realtime:** No Mixpanel added; no push notification path added.

## 8. Spec / Goal Traceability

| Goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-01..SC-02 payload propagation | Yes | Strict gate + source test | PASS |
| SC-03..SC-09 per-reason UI | Yes | `orch-0945-dead-end-render.test.tsx` T-01..T-07 | PASS |
| SC-10..SC-11 banner + debounce | Yes | `collabDeadEndBannerService.test.ts` T-08..T-09 | PASS |
| SC-12..SC-14 token parser/routing | Yes for live Friends chat path | Source regression + code path | PASS static |
| SC-15..SC-18 read-only/focus prefs | Yes | Source regression | PASS static |
| SC-19 solo dead-end untouched | `isBoardSession` gate preserved | Source review | PASS static |
| SC-20 backend untouched | No in-scope backend files staged | `git status` review | PASS |
| SC-21..SC-23 strict gates | New ORCH-0945 gates pass | Commands below | PASS |
| SC-24..SC-25 live-fire sims | Not run by implementor | Assigned to tester | PENDING |

## 9. Invariant Verification

| Invariant | Preserved | Notes |
|---|---|---|
| Contract 5 no backend deck changes | Yes | No `supabase/` in scoped staged files |
| No new `message_type` | Yes | Inserts `message_type: 'text'` only |
| I-PROPOSED-DEAD-END-REASON-COVERAGE | Yes | New strict-grep gate |
| I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED | Yes | New strict-grep gate |
| I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE | Yes | New strict-grep gate |

## 10. Parity Check

- **Mobile:** Shared `app-mobile` code covers iOS and Android.
- **Business app/admin/public web:** Not touched.
- **Solo/collab:** Collab branches gated by session/dead-end reason; solo dead-end copy path remains.
- **Gaps:** iOS/Android live-fire remains for tester.

## 11. Cache And Persisted State Safety

- **Query keys changed:** No.
- **Invalidations added:** No.
- **Data shape changes:** Additive `collabDeadEndPayload`; legacy `curatedEmptyReason` preserved.
- **AsyncStorage/Zustand impact:** One debounce key prefix: `orch_0945_banner_debounce:*`.
- **Cold start behavior:** No persisted deck cache contract change.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| T-01..T-07 + token/read-only source checks | `node app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` | PASS | Includes `[FAILS-ON-REVERT KEY]` T-01/T-03 |
| T-08..T-09 | `node app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | PASS | Includes `[FAILS-ON-REVERT KEY]` T-08/T-09; Node emitted typeless package warning only |
| Tester adversarial banner checks | `node app-mobile/src/services/__tests__/orch-0945-banner-adversarial.test.ts` | PASS | Existing tester adversarial file also passes after the rework; Node emitted typeless package warning only |
| New strict gates | `node .github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.mjs && node .github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs` | PASS | Both gates clean |
| Strict self-tests | `node ...dead-end-reason-coverage.test.mjs && node ...prefs-sheet-read-only-no-write.test.mjs` | PASS | Gate self-tests clean |
| Fails-on-revert T-01/T-03 | Temporarily reversed `SwipeableCards.tsx` diff, ran dead-end test, restored patch | FAIL as expected | Failed on missing `getCollabDeadEndCopy` |
| Fails-on-revert T-08/T-09 | Temporarily removed `collabDeadEndBannerService.ts`, ran service test, restored file | FAIL as expected | Failed on missing service file |
| TypeScript | `cd app-mobile && npx tsc --noEmit` | FAIL, pre-existing repo-wide errors | Re-run filtered output showed no ORCH-0945 file errors after fixes |

## 13. Regression Surface

1. Collab deck empty/exhausted state copy and CTA order.
2. Friends-tab group chat system message rendering.
3. Preferences sheet save handlers and section controls.
4. Session group conversation message insert permissions.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Direct `messages` insert | Uses canonical table directly instead of legacy blocked board discussion writer | Tester live-fire confirms user-attributed banner write succeeds on iOS + Android | `collabDeadEndBannerService.ts` |
| Content-based system render | A user-attributed row renders as a centered system/token row when it matches the narrow ORCH-0945 banner patterns | Tester verifies banner appears with tappable links; follow-up only if ordinary user messages can spoof an ORCH-0945 banner in practice | `messagingService.ts` |
| `open-dismissed` routing | Opens collab deck; dismissed sheet still requires deck UI context | Tester validates acceptable path or files follow-up | `MessageInterface.tsx` |
| TypeScript gate | Repo has unrelated pre-existing failures | Separate cleanup ORCH | See verification output |

## 15. Discoveries For Orchestrator

- The ORCH-0945 spec references `boardDiscussionService.sendMessage`, but live code marks that writer blocked post-ORCH-0898. Implementation used canonical `messages` insert to preserve Contract 5 without reviving split-brain writes.
- The active group-chat renderer is `app-mobile/src/components/chat/MessageBubble.tsx`, not only `components/discussion/MessageBubble.tsx`; implementation targeted the live path.
- Live-fire on 2026-05-23 proved authenticated clients cannot insert `messages.sender_id = null`; ORCH-0945 now uses the same sender-attributed write contract as ordinary chat messages while preserving banner rendering.

## 16. Deploy Notes

- **Migrations:** None. No `supabase db push`.
- **Edge functions:** None. No deploy.
- **Mobile OTA/native:** JS-only app-mobile changes; tester should live-fire iOS + Android before close.
- **Business/admin web:** Not touched.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
app-mobile: polish collab deck dead-end UX

Resolves: ORCH-0945
Evidence: T-01..T-09 source regressions, ORCH-0945 strict-grep gates
Deploy: mobile-only; no backend deploy
```

## Ready-To-Test Checklist

1. iOS sim: `intersection_empty` 1-outlier scenario renders outlier-specific copy, posts one banner, and token opens self editable prefs vs other read-only prefs.
2. Android emulator: same `intersection_empty` parity path.
3. Rapid-tap "Notify the group" 5x; only one banner appears and subsequent taps toast "Already flagged just now."
4. Tap malformed token in a seeded system message; token remains visible text.

## 17. Live-Fire Rework Addendum (2026-05-24)

**Input failure:** `Mingla_Artifacts/reports/QA_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH_REPORT.md` under "Live-Fire Rerun — Codex tester attempt (2026-05-23 23:10 EDT)" proved Case-B step 8 failed because ORCH-0945 inserted `messages.sender_id = null` while live RLS requires `sender_id = auth.uid()`.

**Chosen path:** Product contract changed to user-attributed ORCH-0945 banners, not a privileged null-sender RPC. This avoids a new SECURITY DEFINER surface, preserves the existing text message substrate, and keeps the read-only prefs/link/debounce contracts intact.

**Rework receipts:**

| File | Old | New |
|---|---|---|
| `app-mobile/src/services/collabDeadEndBannerService.ts` | Inserted `sender_id: null`; Supabase object errors were thrown as `[object Object]`. | Inserts `sender_id: input.currentUserId`; thrown insert failures preserve `error.message`. |
| `app-mobile/src/services/messagingService.ts` | `isSystem` depended only on `sender_id === null`. | `isSystem` remains true for null-sender rows and also for content matching narrow ORCH-0945 dead-end banner patterns. |
| `app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | Required the null-sender contract that live RLS rejected. | Requires authenticated sender insert, forbids `sender_id: null`, checks useful error messages, and verifies the ORCH-0945 system-render classifier. |

**Verification rerun:**

| Check | Result |
|---|---|
| `node app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | PASS |
| `node app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` | PASS |
| `node app-mobile/src/services/__tests__/orch-0945-banner-adversarial.test.ts` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.mjs` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs` | PASS |
| `node .github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.test.mjs && node .github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.test.mjs` | PASS |
| `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL on pre-existing broad repo errors; no touched ORCH-0945 files were listed in the TypeScript output. |

**Manual gate for tester:** Rerun the exact Case-B steps 8-12 from the QA report on iOS sim and Android emulator. Expected result is one user-attributed banner row created by step 8, rendered as a centered system/token banner in chat, with non-outlier/outlier link routing and rapid-tap debounce unchanged.
