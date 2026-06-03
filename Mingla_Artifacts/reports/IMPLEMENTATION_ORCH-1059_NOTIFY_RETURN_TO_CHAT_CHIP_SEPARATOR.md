# IMPLEMENTATION — ORCH-1059 [collab notify → return-to-chat + chip-separator removal]

**Date:** 2026-06-03
**Skill:** mingla-implementor (Claude, parity mirror)
**Branch:** `ORCH-1059-collab-notify-return-to-chat-chip-separator`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1059-[collab-notify-return-to-chat-chip-separator]/`
**Scope:** Client-only. No migration / edge / backend / RPC / `card_payload`-shape change.
**Status:** implemented and verified (regression green + fails-on-revert; tsc clean on touched files). Live collab-session QA needs an operator-assisted multi-participant session.

---

## 0. Pre-flight finding — branch was stale; ORCH-1058 had to land first

This ORCH builds directly on ORCH-1058/1058B [collab location chips + notify-group banner], which merged to `origin/main` as PR #331 (merge commit `b20af8e42`, mergedAt 2026-06-03T04:15Z) AFTER this worktree's branch was cut. The branch sat on the old local `main` (`d0a6e08c1`, an ORCH-1061 registration commit) where `CollabLocationChips.tsx`, the RPC-backed `postCollabDeadEndBanner`, and the `handleNotifyGroup`/`postNotifyGroup` flow did NOT yet exist — the dispatch's cited files/lines were absent.

**Resolution:** `git fetch origin main` then rebased the branch onto `origin/main` (`f8b222b81`). The only conflicting commit was the ORCH-1061 WORLD_MAP registration (an orchestrator artifact unrelated to this ORCH); skipped it. Branch now sits cleanly on `f8b222b81` with all ORCH-1058 code present. All four dispatch targets then matched the real code.

---

## 1. The two fixes

### Fix 1 — return to the group chat after a successful notify

Before: tapping "Notify the group" (collab deck dead-end empty state) posted the banner but left the user stranded on the deck / prefs sheet. `postCollabDeadEndBanner` returned `void` and the caller had no signal to navigate.

After: on a **successful** post only (a real banner row landed), the deck and any open prefs sub-sheet dismiss and the user lands back on the group chat, where the global success toast ("Group notified") and the posted banner are in context. Debounce / cancel / failure keep the user on the deck so they can retry.

### Fix 2 — remove the bullet/period separator between location chips

Before: `CollabLocationChips` rendered a `•` `BulletSeparator` between each chip. After: chips are separated by spacing only (a `columnGap` + `rowGap` on the row container). Chip styling (`glass.discover.chip` tokens), the GPS-resolved City/ST labels, and the "Getting a fix…" pending state are all intact.

---

## 2. Old → New Receipts

### `app-mobile/src/services/collabDeadEndBannerService.ts`
**Before:** `postCollabDeadEndBanner(input): Promise<void>` — returned nothing; debounce branch `return;`; success path ended after `toastManager.success(...)`; catch ended after `toastManager.error(...)`.
**After:** `postCollabDeadEndBanner(input): Promise<boolean>`. Returns `true` ONLY after the RPC returns a real message id (immediately after the success toast). Returns `false` on the debounce branch and in the catch block. Toasts are unchanged (still surfaced internally via the global `toastManager`).
**Why:** Fix 1 — gives the caller a precise success signal to gate the return-to-chat navigation.
**Lines changed:** ~12 (1 signature, 1 doc-block, 3 `return` statements).

### `app-mobile/src/components/SwipeableCards.tsx`
**Before:** `SwipeableCardsProps` had no notify-complete callback; `postNotifyGroup` awaited `postCollabDeadEndBanner(...)` and discarded the result.
**After:** added optional prop `onAfterNotify?: () => void` (declared + destructured). `postNotifyGroup` captures the boolean (`const posted = await postCollabDeadEndBanner(...)`) and calls `onAfterNotify?.()` ONLY inside `if (posted)`. `onAfterNotify` added to the `useCallback` dep array.
**Why:** Fix 1 — propagates the success-only dismiss request up to the owning sheet. Deliberately a NEW dedicated prop, NOT a reuse of `onSessionLost` (distinct semantic: intentional success return vs lost-session teardown).
**Lines changed:** ~14.

### `app-mobile/src/components/connections/CollabDeckSheet.tsx`
**Before:** owned `onClose` (returns to chat) + a `showPrefsSheet` sub-sheet; SwipeableCards received no notify-complete callback.
**After:** added `handleAfterNotify = useCallback(() => { setShowPrefsSheet(false); onClose(); }, [onClose])` and passed it as `onAfterNotify={handleAfterNotify}` to `<SwipeableCards>`. It dismisses any open prefs sub-sheet, then closes the deck via the same `onClose` path the back button uses. No haptic (the toast already confirms).
**Why:** Fix 1 — lands the user back on the group chat with the prefs sub-sheet closed.
**Lines changed:** ~10.

### `app-mobile/src/components/collab/CollabLocationChips.tsx`
**Before:** rendered a `BulletSeparator` (`•`, a11y-hidden) before every chip after the first, wrapped each `bullet+chip` pair in a `pairGroup` non-wrapping inner row; had a `bullet` style; header comment + a11y note said chips are "separated by a bullet `•`".
**After:** `BulletSeparator`, the `pairGroup` wrapper, and the `bullet` style are removed. Chips render in a flat `chips.map(...)`; the container gains `columnGap: spacing.sm` (alongside the existing `rowGap`) for gap-only horizontal + wrapped-line spacing. Header comment + inline note updated to "separated by SPACING ONLY … no bullet glyph, no period separator." No `•` glyph remains anywhere in the file.
**Why:** Fix 2.
**Lines changed:** ~30 (deletions + comment edits + 1 style line added).

---

## 3. Spec / completion-criteria traceability

| Criterion | Implemented | Verification |
|---|---|---|
| `postCollabDeadEndBanner` returns a success boolean (true only when a row posts; false on debounce/error) | Yes | tsc + regression T-01, T-02 |
| Successful notify dismisses deck + any prefs sub-sheet → user lands on group chat | Yes | source wiring T-03/T-04/T-05; runtime needs collab-session QA |
| Dedicated prop (`onAfterNotify`), NOT `onSessionLost` abuse | Yes | T-03/T-05 (asserts distinct wiring) |
| Failure / cancel / debounce keeps user in place (no dismiss) | Yes | `if (posted)` guard (T-04) + `false` returns (T-02) |
| Success toast is global and survives the navigation | Yes | `toastManager.success` (global singleton) fires before return; navigation does not dismiss it |
| Chip row has NO `•` / `.` separator (spacing only) | Yes | T-06 (no `•`, no `BulletSeparator`, no `bullet` style, `columnGap` present) |
| Chip styling + GPS City/ST + "Getting a fix…" preserved | Yes | T-07 (glass tokens + gps/place/pending glyphs preserved) |
| Header comment + a11y note updated | Yes | source diff |
| iOS + Android | Yes | shared RN code path; Android opaque-glass fallback in chip style untouched |
| No RPC / migration / recognizer / `card_payload` change | Yes | only the 4 client files touched |

---

## 4. Regression Test

**Path:** `app-mobile/src/components/collab/__tests__/orch_1059_notify_return_to_chat_chip_separator.test.mjs`
**Runner:** `node --test` (the established `.mjs` source-static gate pattern, e.g. `orch_1041_your_circle_copy.test.mjs`).

Passing run (fix in place):
```
# tests 7
# pass 7
# fail 0
```

Fails-on-revert verified at commit **`f8b222b81`** (pre-fix HEAD): `git stash push` of the 4 source files (test retained) →
```
not ok 1 ORCH-1059 T-01 …  not ok 2 T-02  not ok 3 T-03
not ok 4 T-04  not ok 5 T-05  not ok 6 T-06
# tests 7  # pass 1  # fail 6
```
(T-07 is a no-regression preservation assertion — it legitimately passes on both pre- and post-fix code, by design. The six behavior-asserting tests all fail on revert.) `git stash pop` → back to 7/7 green.

Test ships in the same branch/PR as the fix.

---

## 5. Cross-Surface Impact

- **Consumer iOS / Consumer Android (1 + 2):** AFFECTED. Both fixes are in `app-mobile/` shared RN code (collab deck empty state + chip row). Parity is automatic (single code path; chip Android opaque-glass fallback already handled in `styles.chip`).
- **Buyer/anon Web (3), Business iOS/Android (4/5), Admin (6), Business Web (7):** UNAFFECTED — the collab deck + "Notify the group" flow + `CollabLocationChips` are consumer-app-only; no `mingla-business`/admin analog exists.

Count of affected surfaces = 2, parity automatic. No manual-parity drift to register.

---

## 6. Invariant / Constitution check

- No new `any`, no `@ts-ignore`, explicit return types preserved; `onAfterNotify` is typed `() => void`.
- No silent failures introduced: failure path still toasts (`toastManager.error`) and now also returns `false`; success path toasts + returns `true`.
- No query-key / Zustand / cache change (no React Query touched).
- `card_payload` shape, the RPC contract, and the dead-end recognizer logic are untouched.
- Android glass policy preserved (`isAndroidOpaque ? fallbackSolid : bg` unchanged).
- MessageBubble reuses `CollabLocationChips` verbatim, so the chat-surface banner inherits the bullet removal automatically — no separate bullet renderer exists there (verified).

All N/A or PASS. No external API touched (COMMS-0003 N/A). No backend file added (COMMS-0002 N/A). No new ORCH-ID intake (COMMS-0004 N/A).

---

## 7. Regression Surface (for the tester)

1. The other dead-end reasons that also reach `postNotifyGroup` (`no_matching_candidates`, `quorum_not_met`, `all_pools_exhausted`, `no_unswiped_candidates`) — confirm a successful notify on any of them also returns to chat, and a debounced repeat (within 5 min) keeps the user put.
2. Cancel on the `Alert.alert` confirm — must NOT dismiss the deck (no post attempted).
3. Prefs sub-sheet open at the moment of a successful notify — must close along with the deck.
4. The MessageBubble system-row chip rendering in the chat — confirm the posted banner's chips show with spacing only, no bullet.
5. Multi-participant collab session, two devices — the poster returns to chat; other participants see the system banner row.

---

## 8. Discoveries for Orchestrator

- **Stale branch base (handled, not a code issue):** this worktree's branch was cut before ORCH-1058 (PR #331) merged; rebased onto `origin/main` to pick it up. Future ORCHs that build on a just-merged predecessor should be spawned/rebased after the predecessor lands on `origin/main`, not off a stale local `main`.
- No other side issues found.

---

## 9. Live QA flag

Runtime confirmation of the return-to-chat navigation requires an actual collab session reaching a dead-end empty state (≥2 participants, non-overlapping locations) on a booted sim or device. That is operator-assisted multi-participant QA — not reproducible from a single source-static run. The wiring is fully proven statically (tsc + 7-test regression + fails-on-revert); the only UNVERIFIED-at-implement piece is the on-device navigation animation, which the tester/operator should exercise in a live session.
