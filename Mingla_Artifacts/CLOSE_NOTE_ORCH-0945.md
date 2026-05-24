# CLOSE NOTE — ORCH-0945 [Collab deck dead-end UX polish]

**Closed:** 2026-05-24
**Verdict:** PASS (Codex `tester-mingla`)
**Severity counts:** P0 = 0 · P1 = 0 · P2 = 0 · P3 = 0 · P4 = 4
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Surfaces touched:** Consumer iOS + Consumer Android (mobile-only — `app-mobile/` + `.github/scripts/strict-grep/` + `.github/workflows/`). Not touched: buyer-web, business iOS/Android, admin-web, business-web-preview, Supabase migrations, edge functions.

---

## Plain-English impact

When a collab deck hits a dead end, every participant now sees the specific reason the group is blocked — `intersection_empty` (someone's circle is too far), `no_matching_candidates` (waiting on GPS or categories), `no_unswiped_candidates` (everything already swiped), `quorum_not_met` (not enough accepts), or `all_pools_exhausted` (no fresh inventory) — instead of one generic "nothing matched." Each reason renders with first-name attribution where applicable. From the dead-end card, a participant can tap **Notify the group**, which inserts a user-attributed system-style banner into the session group chat with a tappable **Open travel picks** token; tapping that token opens the named participant's preferences either editable (it's you) or read-only (it's someone else). Rapid notify taps are debounced to 5 minutes per session to prevent banner spam.

## Inputs (evidence chain)

| Artifact | Path |
|---|---|
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` |
| Implementation report (initial) | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` |
| Implementation report (LF-2 rework) | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH_REWORK_LF2.md` |
| QA report (PASS) | `Mingla_Artifacts/reports/QA_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH_REPORT.md` |
| LF-2 live-fire evidence | `Mingla_Artifacts/evidence/orch-0945-live-fire/rerun-20260524-lf2-*.png` (14 screenshots) |

## Hard guards verified intact

- No `supabase/migrations/` or `supabase/functions/` files touched (`git status` clean on those paths).
- No schema, RLS, or new `message_type` value. The Notify-the-group banner inserts `message_type: 'text'` only.
- Read-only contract preserved: `PreferencesSheet` with `viewParticipantId` short-circuits every write path through `isEditable` (16 guards + `handleApplyPreferences` first-line guard).
- User-attributed banner write path preserved: `messages.insert({ sender_id: currentUserId, message_type: 'text', content })` rather than null-sender system insert.
- 5-minute debounce per session-per-user via AsyncStorage.

## Regression-test gate (Step 0.5)

| Test | Path | Author | Verified |
|---|---|---|---|
| Happy-path render coverage | `app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` | implementor | `fails-on-revert` cited in IMPL report §12 (T-01/T-03) |
| iOS token routing | `app-mobile/src/components/__tests__/orch-0945-system-token-ios-routing.test.tsx` | implementor (LF-2 rework) | passing on Seth |
| Banner debounce / write path | `app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | implementor | `fails-on-revert` cited (T-08/T-09) |
| Adversarial banner attacks | `app-mobile/src/services/__tests__/orch-0945-banner-adversarial.test.ts` | tester | T-AT-01..T-AT-07, distinct angles (privacy invariant, NaN defense, regex security, isEditable position, fallback names, majority-connected guard, 2-participant boundary) |

Gate passes: implementor happy-path with fails-on-revert + tester adversarial at a different angle. Both ship in this CLOSE PR.

## DIAG-marker reap (Step 1.5)

`grep -rn "\[ORCH-0945-DIAG\]"` across `mingla-business/`, `app-mobile/`, `supabase/functions/`, `mingla-admin/` → **0 matches.** Clean.

## New invariants (status flipped to ACTIVE in registry)

- `I-PROPOSED-DEAD-END-REASON-COVERAGE` — 5 collab dead-end reasons each get a dedicated client render branch.
- `I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED` — `deckService` collab-v2 surfaces `acceptedCount` + `pendingGpsUserIds` beside `curatedEmptyReason`.
- `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE` — `viewParticipantId` mode never writes prefs.

CI enforcement: 2 new strict-grep gates registered in `.github/workflows/strict-grep-mingla-business.yml`:
- `.github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.mjs`
- `.github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs`

## P4 follow-ups (not blockers, queue for next polish touch)

1. **2-participant `intersection_empty` copy variant.** With current implementation, 2-person sessions get the multi-outlier copy ("No location overlap yet. Seth in DC · Marcus in Queens."). Operator may want a tailored 2-person variant — register only if operator decides so.
2. **`collabDeadEndBannerService.ts` line 69 `throw new Error(error)`** stringifies Supabase errors as `[object Object]`. Fix on next touch: `throw new Error((error as any).message ?? String(error))`.
3. **Investigation SPEC path drift.** SPEC cited `discussion/MessageBubble.tsx`; live file is `chat/MessageBubble.tsx` post-ORCH-0898. Investigation hygiene — low priority.
4. **Android dev-build `Unable to activate keep awake` redbox** during LF-2 — unrelated to ORCH-0945, dismissed before parity step proceeded. Only register a follow-up if it recurs outside this dispatch.

## Vercel `[deploy]` decision

Touched paths: `app-mobile/`, `.github/`, `Mingla_Artifacts/`. No `mingla-business/`, `mingla-admin/`, or marketing-site changes. **`[deploy]` tag NOT required.**

## Post-CLOSE operator action

EAS OTA so existing iOS + Android users get the new dead-end copy + banner UX without an App Store review:

```bash
cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0945: Collab deck dead-end UX polish — per-reason copy + notify banner + read-only prefs link"
```

No native modules added; no `eas build` required. No Supabase migration; no edge-function deploy.

## Documentation gap routing

The orchestrator side has zero outstanding documentation gap from this close: `INVARIANT_REGISTRY.md` updated with 3 ACTIVE-flips, `PRIORITY_BOARD.md` adds the closing banner, `CLOSE_NOTE_ORCH-0945.md` (this file) created. No prior `WORLD_MAP.md` / `MASTER_BUG_LIST.md` / `OPEN_INVESTIGATIONS.md` row existed for ORCH-0945 (single-cycle execution), so nothing to flip in those ledgers. No downstream skill routing needed — pipeline is done.
