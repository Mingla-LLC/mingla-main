# Implementation ORCH-0939 — CollabDeckSheet Provider Wrap

> Date: 2026-05-23  
> Mode: Codex `implementor-mingla`  
> Status: implemented, partially verified  
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md`  
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0939_COLLAB_DECK_SHEET_SOLO_LEAK.md`

## 1. Summary

Implemented the ORCH-0939 client-only rendering fix: `CollabDeckSheet` now wraps its existing `SwipeableCards` mount in a per-session `RecommendationsProvider` keyed by `sessionId`.

This makes the sheet read from the collab session deck context instead of falling through to the global `currentMode="solo"` provider that serves Home Explore. No backend, migration, RPC, edge function, realtime code, ORCH-0931 code, or ORCH-0926 scaffolding was changed.

## 2. Mandatory Ingest

Read before implementation:

| Artifact | Purpose |
|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md` §1-§11 | Source of truth for scope, edit shape, tests, invariant, report, and hard guards. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0939_COLLAB_DECK_SHEET_SOLO_LEAK.md` | Proven root cause: missing provider lets `SwipeableCards` consume the global solo context. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0931_REALTIME_BROADCAST_SESSION_UPDATED_REWORK_2.md` | Confirmed ORCH-0931 invalidates collab deck-cards on broadcast and is blocked only because the renderer was reading the wrong context. |
| `Mingla_Artifacts/reports/QA_ORCH-0931_POST_META_COLLAB_REALTIME_MATRIX.md` | Confirmed prior visible matrix failure and why ORCH-0931 live retest depends on this fix landing first. |

## 3. Files Changed

| File | Change |
|---|---|
| `app-mobile/src/components/connections/CollabDeckSheet.tsx` | Added `RecommendationsProvider` import and wrapped existing `SwipeableCards` with `currentMode={sessionId}`, `refreshKey={0}`, `persistedSessionId={sessionId}`, `onSessionLost={onClose}`, and `key={sessionId}`. |
| `app-mobile/src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx` | Added repo-running source regression for T-IMP-1..3 and fail-on-revert behavior. |
| `.github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | Added CI gate enforcing the per-session provider invariant. |
| `.github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs` | Added positive/negative fixture self-tests for the gate. |
| `.github/workflows/strict-grep-mingla-business.yml` | Registered the ORCH-0939 gate as a dedicated Node 20 workflow job. |
| `feedback_collab_deck_must_wrap_with_provider.md` | Added memory note documenting that collab deck surfaces must own their session-scoped provider. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0939_COLLAB_DECK_SHEET_PROVIDER_WRAP.md` | This implementation report. |

## 4. Old To New Receipt

| Before | After |
|---|---|
| `CollabDeckSheet` rendered `<SwipeableCards ... currentMode={sessionId} sessionIdOverride={sessionId} />` directly under `<View style={styles.deck}>`. | `CollabDeckSheet` renders the same `SwipeableCards` inside `<RecommendationsProvider currentMode={sessionId} refreshKey={0} persistedSessionId={sessionId} onSessionLost={onClose} key={sessionId}>`. |
| `SwipeableCards` resolved `useRecommendations()` from the ambient global solo provider in `app/index.tsx`. | `SwipeableCards` resolves `useRecommendations()` from the nearest sheet-local provider for the active session UUID. |
| Session switch could reuse provider state if a future wrapper lacked a key. | `key={sessionId}` forces clean remount when a different chat/session deck opens. |
| No CI invariant pinned this surface. | Strict-grep gate fails when the provider wrap is removed or no longer uses the required session-scoped props. |

## 5. Verification

| Check | Command | Result |
|---|---|---|
| Provider-wrap test compile | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0939-provider-test` | PASS |
| Provider-wrap regression | `cd app-mobile && node /tmp/orch-0939-provider-test/CollabDeckSheet.providerWrap.test.js` | PASS: `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` |
| Fail-on-revert | Temporarily removed the provider wrapper from `CollabDeckSheet.tsx`, then ran `cd app-mobile && node /tmp/orch-0939-provider-test/CollabDeckSheet.providerWrap.test.js` | EXPECTED FAIL: `AssertionError [ERR_ASSERTION]: expected RecommendationsProvider ancestor, found none` |
| Restore check | Re-applied the provider wrapper and reran `cd app-mobile && node /tmp/orch-0939-provider-test/CollabDeckSheet.providerWrap.test.js` | PASS |
| Fails-on-revert commit hash | `git rev-parse HEAD` | `81e4fbc01055371f39e64174501d3b86a0365dc6` |
| Strict-grep self-test | `node --test .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs` | PASS: 3/3 |
| Strict-grep gate | `node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | PASS: `violations=0` |
| Test-only typecheck | `cd app-mobile && npx tsc src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --noEmit` | PASS |
| Scoped ESLint | `cd app-mobile && npx eslint src/components/connections/CollabDeckSheet.tsx src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx` | PASS, 0 output |
| Diff whitespace | `git diff --check -- app-mobile/src/components/connections/CollabDeckSheet.tsx app-mobile/src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs .github/workflows/strict-grep-mingla-business.yml feedback_collab_deck_must_wrap_with_provider.md` | PASS |

### TypeScript caveat

The attempted component-inclusive scoped TypeScript command:

```bash
cd app-mobile && npx tsc src/components/connections/CollabDeckSheet.tsx src/components/connections/__tests__/CollabDeckSheet.providerWrap.test.tsx --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --allowSyntheticDefaultImports --moduleResolution node --skipLibCheck --noEmit
```

failed by pulling in pre-existing transitive app errors outside this change, including unresolved `@mingla/event-rendering`, unresolved `@mingla/payments-native`, JSON module resolution errors in `src/i18n/index.ts`, and existing React Native animated transform typing errors. No failure cited `CollabDeckSheet.tsx` or `CollabDeckSheet.providerWrap.test.tsx` directly.

## 6. Spec Traceability

| Spec item | Status |
|---|---|
| §3.1 add `RecommendationsProvider` import | Implemented. |
| §3.1 wrap existing `SwipeableCards` with session-scoped provider props | Implemented. |
| §3.2 no backend/service/hook/realtime changes | Preserved. |
| §5 new invariant gate | Implemented and registered in workflow. |
| §6 T-IMP-1..3 | Implemented in `CollabDeckSheet.providerWrap.test.tsx`; PASS. |
| §6 T-IMP-FAIL-ON-REVERT | Verified; failure captured above. |
| §7 memory file | Implemented as `feedback_collab_deck_must_wrap_with_provider.md`. |
| §7 report | Implemented as this file. |

## 7. Hard Guards

| Guard | Status |
|---|---|
| Do not modify global `RecommendationsProvider currentMode="solo"` in `app/index.tsx` | Preserved; file untouched. |
| Do not touch backend, migrations, edge functions, RPCs, or live SQL data | Preserved. |
| Do not mutate live `daadd454-...` test session via SQL | Preserved. |
| Preserve ORCH-0931 broadcast code and migration as-is | Preserved; no ORCH-0931 files edited. |
| Preserve ORCH-0926 four-file diff and diag scaffolding as-is | Preserved; no ORCH-0926 files edited. |
| Do not push, open PR, or merge | Preserved. |

## 8. Deploy Notes

No deploy step is needed from implementor. This is a client-only JavaScript change and should ship via EAS Update during orchestrator CLOSE:

```bash
cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0939: CollabDeckSheet reads collab session deck, not solo"
```

## 9. Remaining Tester Gates

Claude `mingla-tester` should run the live four-device matrix from SPEC §6 T-TESTER-A1..A4:

| Gate | Expected proof |
|---|---|
| T-TESTER-A1 | Two iOS sims in the same session see the same card at the same position. |
| T-TESTER-A2 | Remote pref change broadcasts, invalidates/refetches collab deck-cards, and visibly updates within 2 seconds. |
| T-TESTER-A3 | Home Explore solo deck still works from the global solo provider. |
| T-TESTER-A4 | Closing session A and opening session B shows session B cards, not stale A cards. |

After tester PASS, Codex `orchestrator-mingla` can close ORCH-0939 and ORCH-0931 in the approved bundled PR path.
