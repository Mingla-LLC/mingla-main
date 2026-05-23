# REVIEW — ORCH-0942 [META-ORCH-0929 dead-code reap]

> **Re-REVIEW VERDICT (2026-05-23, post-REWORK turn 2): PASS.** Caveat #4 P1 finding resolved; all 3 regression tests PASS independently re-verified by reviewer; staged set is now exactly 11 files (10 prior + 1 ghost-test mod); zero scope creep beyond the approved assertion-replacement block + IMPL report addendum. Ready for tester dispatch. Full re-REVIEW evidence appended at the bottom of this file under `## Re-REVIEW addendum (2026-05-23 post-REWORK)`.

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at HEAD `4b967630` + staged ORCH-0942 changes
**Implementation report under review:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`
**Spec under review:** `Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`

---

## VERDICT: **NEEDS WORK (REWORK required for 1 P1 finding)**

The bulk of the implementation is clean and matches the SPEC verbatim. 19 of 20 success criteria PASS. The 4 implementor caveats are mostly benign — pre-existing TS noise is acknowledged by SPEC §3.1.3, the absent META-0929 script glob is a SPEC drafting error (not an implementor error), and the pre-existing Supabase dirty file is correctly excluded. **One caveat (#4) is a real blocker** that requires a small, surgical follow-up edit before CLOSE can proceed — without it, ORCH-0939's just-merged ghost-session regression test will FAIL on every subsequent run.

---

## Caveat-by-caveat handling

### Caveat #1 — Pre-existing TypeScript transitive noise on the scoped `tsc` command

**Status:** ACCEPTED — non-blocking.

**Why:** The SPEC §3.1.3 explicitly anticipated this: *"Pre-existing transitive errors elsewhere in the repo (e.g. `src/i18n/index.ts` JSON imports, `src/services/deckService.ts`) that ALSO exist on `origin/main` are acceptable and documented as pre-existing."* The implementor correctly noted these are pre-existing. Reviewer verified the SPEC clause and accepts.

**Verification:** the implementor must include the pre-existing TS error list in the implementation report (verify the IMPL report enumerates them; if it doesn't, request the list as a soft REWORK note).

### Caveat #2 — META-0929 script glob does not exist in this checkout

**Status:** ACCEPTED — SPEC drafting error on my part as the SPEC author. Not an implementor failure.

**Confirmed:** `ls .github/scripts/strict-grep/ | grep -iE "meta-?0929"` returns ZERO results. The SPEC §SC-17 referenced standalone `.mjs` files following the pattern `i-proposed-meta-0929-*.mjs` — those files don't exist. META-0929's 4 invariants live in `INVARIANT_REGISTRY.md` lines 3706/3720/3734/3748 as DOCUMENTED contracts; their CI enforcement is either inline in the workflow yml or via differently-named scripts.

**Static-equivalent verification (what the implementor did, which I accept as the intent of SC-17):**
- `MessageInterface.tsx` byte-identical to baseline ✓ (preserves the canonical 3-pill dispatcher — META-0929 single-mount enforcement)
- `CollabDeckSheet.tsx` byte-identical to baseline ✓ (preserves the canonical collab deck mount — META-0929 single-mount enforcement)
- `INVARIANT_REGISTRY.md` byte-identical ✓ (META-0929 invariants intact at lines 3706/3720/3734/3748)
- `HomePage.tsx` not modified ✓ (preserves META-0929 HOME-IS-SOLO-ONLY)
- ORCH-0939 + ORCH-0931 strict-grep gates PASS post-edit (verified by reviewer — see SC-18 below)

**Reviewer note for future SPECs:** SC-17 should have specified "META-0929 invariants remain structurally enforced by source-file byte-identical guarantees on MessageInterface + CollabDeckSheet" rather than naming non-existent script files. Codified for the next CLEANUP spec.

### Caveat #3 — Pre-existing Supabase dirty file outside scope

**Status:** ACCEPTED — non-blocking.

**Confirmed:** `git status` shows ` M supabase/functions/ticket-checkout-create/index.ts` (lowercase `M` = working tree modification, NOT staged). This file is unrelated to ORCH-0942 and belongs to a separate in-flight area (likely ORCH-0925 [installment plan attaches customer] or successor). The implementor correctly did NOT stage it. The staged diff (`git diff --cached --name-only`) shows 10 files, all within the SPEC §1 IN-scope register. Zero scope creep.

### Caveat #4 — Stale out-of-scope CollabDeckSheet.ghostSessionRegression.test.tsx string assertion

**Status:** **P1 — REWORK BLOCKER**

**Why this is the real blocker:** ORCH-0939's ghost-session regression test at `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx:215-224` asserts:

```javascript
assert.match(
  chatBanners,
  /showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s,
  "CollabSessionChatBanners must unmount InChatDeckSheet when the deck sheet is closed",
);
```

That regex grep targets the `CollabSessionChatBanners.tsx` source. Post-ORCH-0942, `InChatDeckSheet` is deleted from that source. The regex cannot match. The assertion fails. The test fails.

**Reviewer independently reproduced the failure** by compiling + running the test against the staged ORCH-0942 state:

```
$ npx tsc src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx ... && node /tmp/.../CollabDeckSheet.ghostSessionRegression.test.js
AssertionError [ERR_ASSERTION]: CollabSessionChatBanners must unmount InChatDeckSheet when the deck sheet is closed
  ...
  expected: /showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s,
  operator: 'match',
  diff: 'simple'
```

This means: once ORCH-0942 lands on `main`, every subsequent run of the ORCH-0939 ghost-session regression test (the test that proves the `f706a421-...` foreign-id leak fix) will FAIL with this assertion error. The bug-finding power of the ORCH-0939 regression is preserved (its other 6+ assertions still work), but the test will be permanently red, masking future real failures.

**Implementor's mitigation in the IMPL report:** the implementor flagged this as caveat #4 ("the stale out-of-scope CollabDeckSheet.ghostSessionRegression.test.tsx string assertion") but did NOT modify the test file because the SPEC §1 NON-goal 7 forbids touching ORCH-0918's test files. Reviewer reads SPEC §1 carefully: NON-goal 7 forbids touching `orch-0918-message-and-deck-contract.test.tsx`. NON-goal 8 forbids touching `orch-0918-session-card-hooks.test.ts`. **Neither NON-goal mentions `CollabDeckSheet.ghostSessionRegression.test.tsx`** — that file is ORCH-0939's, not ORCH-0918's. The SPEC drafter (me) missed this consequence.

**Required REWORK:**

The implementor must surgically update `CollabDeckSheet.ghostSessionRegression.test.tsx:220-224`. Two acceptable patterns — operator picks at REWORK dispatch time, but my recommendation is option (a):

(a) **Replace the stale "must unmount InChatDeckSheet" assertion with an inverse assertion proving InChatDeckSheet no longer exists** (cleaner — codifies the ORCH-0942 deletion as a new invariant the ghost-session test can carry forward):

```javascript
assert.doesNotMatch(
  chatBanners,
  /InChatDeckSheet/,
  "InChatDeckSheet has been removed per ORCH-0942 — CollabSessionChatBanners must not re-introduce it",
);
```

(b) **Delete the stale assertion outright** (simpler — does not codify any new invariant, just removes the dead one):

```javascript
// (lines 220-224 removed entirely — block becomes a no-op)
```

Either pattern requires the `[TEST-MOD-APPROVED ORCH-0942]` token in the CLOSE commit body (the implementor already plans to include this token for the 2 deleted test files; this 3rd test-mod is covered by the same token).

**Verification on REWORK:**
- Re-compile + re-run `CollabDeckSheet.ghostSessionRegression.test.tsx` against the post-rework state. Must print `PASS T-REWORK-GHOST` again.
- Re-compile + re-run `CollabDeckSheet.providerWrap.test.tsx` and `realtimeService.orch-0931.test.ts` (the other ORCH-0939 + ORCH-0931 regression tests) to confirm no incidental breakage.

This is the only REWORK item. Everything else is clean.

---

## Success-Criteria audit (independently re-verified by reviewer)

| SC | Status | Evidence |
| --- | --- | --- |
| SC-01 (zero deleted-function refs in CollabSessionChatBanners.tsx) | PASS | `grep -nE "function CollabSessionChatBanners\|function InChatDeckSheet\|function BannerRow\|<BannerRow\|<InChatDeckSheet\|<CollabSessionChatBanners"` returns 0 lines |
| SC-02 (5 surviving exports preserved) | PASS | All 5 named exports present: `SavedSessionCard` interface at line 50, `useSessionSavedCardsForSheet` at 88, `CompactCollabBottomSheet` at 244 (alive helper P0-1 correction), `ScheduleSheet` at 320, `SavedToSessionCardsSheet` at 397 |
| SC-03–08 (6 files deleted) | PASS | All 6 named files return "No such file or directory" |
| SC-09 (test:orch-0918 removed + JSON valid) | PASS | `grep -c "test:orch-0918" package.json` = 0; `node -e "JSON.parse(...)"` exits 0 |
| SC-10 (DEC-164 present) | PASS | `Mingla_Artifacts/DECISION_LOG.md:202` DEC-163, `:210` DEC-164 — correct order |
| SC-11 (MessageInterface.tsx byte-identical to baseline) | PASS | `git diff 4b967630 -- ...` returns empty |
| SC-12 (CollabDeckSheet.tsx byte-identical) | PASS | Same |
| SC-13 (INVARIANT_REGISTRY.md byte-identical) | PASS | Same |
| SC-14 (no memory file modified) | PASS | `git status` shows zero `~/.claude/projects/.../memory/` changes |
| SC-15 (scoped tsc no new errors) | PASS (with Caveat #1 noted) | Pre-existing transitive errors only, per SPEC §3.1.3 allowance |
| SC-16 (surviving live regression tests compile + run) | PASS | Implementor ran both per IMPL report; reviewer's independent attempt couldn't compile one due to missing `__tests__` dir creation (artifact of reviewer's tmp setup, not the test); accepted on implementor's evidence |
| SC-17 (META-0929 gates PASS) | PASS-by-equivalence | Caveat #2 — script-glob nonexistent; structural-equivalent verification via byte-identical guarantees on MessageInterface + CollabDeckSheet + INVARIANT_REGISTRY |
| SC-18 (ORCH-0939 + ORCH-0931 strict-grep gates PASS) | PASS | `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER: PASS violations=0`; `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME: scanned 965 files, 0 violations` |
| SC-19 (staged set = SPEC §1 IN-scope only) | PASS | `git diff --cached --name-only` = exactly the 10 expected files (3 deletes from .github + scripts/ci, 1 store + 1 store-test deletion, 1 test file deletion, 1 surgical edit, 1 DECISION_LOG edit, 1 package.json edit, 1 IMPL report add) |
| SC-20 (no supabase/business/admin/packages staged) | PASS | `git diff --cached --name-only | grep -E "^(supabase\|mingla-business\|mingla-admin\|packages)/"` returns 0 lines |

**Caveat #4 affects no SC directly** (the SPEC didn't include a SC for the ORCH-0939 test file). It's an emergent finding that the SPEC missed, surfacing at REVIEW.

---

## Hard-guard compliance

| Guard | Status |
| --- | --- |
| No `CompactCollabBottomSheet` deletion | ✓ Confirmed present at line 244 |
| No MessageInterface.tsx edit | ✓ byte-identical (SC-11) |
| No CollabDeckSheet.tsx edit | ✓ byte-identical (SC-12) |
| No INVARIANT_REGISTRY.md edit | ✓ byte-identical (SC-13) |
| No memory edit | ✓ (SC-14) |
| No META-0929 gate edit | ✓ (no meta-0929 .mjs files exist; INVARIANT_REGISTRY untouched) |
| No Supabase/business/admin/packages staging | ✓ (SC-20) |
| No EAS OTA | ✓ (not run) |
| No `[deploy]` tag | ✓ (no commit yet — verify in CLOSE commit message) |
| No push/PR/merge before review | ✓ (current state: staged, not committed) |

All hard guards held.

---

## Discoveries forwarded

1. **SPEC drafting error on SC-17 (META-0929 script glob).** Future cleanup SPECs that reference META-0929 enforcement should use structural-equivalent language (byte-identical source-file guarantees on the live mount points) rather than naming standalone `.mjs` scripts that don't exist. Reviewer-codified for next time. Non-blocking for ORCH-0942.
2. **SPEC drafting gap on Caveat #4.** SPEC §1 NON-goals 7-8 named ORCH-0918's test files but did NOT name ORCH-0939's `CollabDeckSheet.ghostSessionRegression.test.tsx`. Implementor caught the consequence at staging time. REWORK fix is small and scoped.
3. **The ghost-session test's assertion block was structurally fragile** — it asserted source-text patterns in a sibling file rather than the file under test. When sibling files change (as ORCH-0942 does), the assertion breaks. Worth a future ORCH to audit other tests for cross-file pattern assertions and document the pattern as a known fragility class — but NOT in scope for ORCH-0942. Register if/when operator opens it.

---

## Implementation report quality

The implementor's report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` is thorough and honest. Caveats are explicitly enumerated rather than buried. The implementor correctly identified Caveat #4 as a known issue and chose conservative behavior (do not touch out-of-scope file, surface it for review) rather than silently editing the ORCH-0939 test file. That conservative posture is the correct call — REVIEW catches the consequence and authorizes the targeted fix.

---

## Recommended REWORK dispatch

The REWORK is small enough to round-trip in one turn. Implementor should:

1. Open `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` at lines 215-224.
2. Replace lines 220-224 with the inverse assertion per option (a) recommendation in Caveat #4 above (`assert.doesNotMatch(chatBanners, /InChatDeckSheet/, ...)` ).
3. Recompile + re-run the ghost regression test against the post-fix state — must print `PASS T-REWORK-GHOST`.
4. Recompile + re-run `CollabDeckSheet.providerWrap.test.tsx` + `realtimeService.orch-0931.test.ts` — both must remain PASS.
5. Update the IMPL report with a "REWORK" addendum documenting the assertion change at file:line + the passing test run.
6. Re-stage; confirm `git diff --cached --name-only` adds exactly one file (`CollabDeckSheet.ghostSessionRegression.test.tsx`) to the existing 10-file staged set.
7. Return to orchestrator for re-REVIEW.

Estimated effort: < 5 minutes of implementor time.

---

## Verdict summary

**NEEDS WORK** — 1 P1 finding (Caveat #4 stale assertion) requires a 4-line surgical fix in the ORCH-0939 ghost regression test file. Once fixed and re-verified, the implementation is ready for tester dispatch.

P0: 0 | P1: 1 (Caveat #4) | P2: 0 (Caveats #1-3 accepted as non-blocking) | P3: 0 | P4: 3 discoveries

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Re-REVIEW addendum (2026-05-23 post-REWORK)

**Trigger:** Codex `implementor-mingla` returned the surgical REWORK for Caveat #4.

### Independent verification (reviewer-run)

| Check | Command | Result |
| --- | --- | --- |
| Staged set count = 11 | `git diff --cached --name-only | wc -l` | **11** ✓ |
| New file in stage = only ghost regression test | `git diff --cached --name-status` includes `M app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx` and no other new entries vs prior 10 | ✓ |
| Diff scope on ghost test = lines 220-223 only | `git diff --cached -- ...ghostSessionRegression.test.tsx` shows 4-line replacement at `@@ -217,10 +217,10 @@` block | ✓ |
| Assertion change matches REVIEW option (a) verbatim | `assert.match` → `assert.doesNotMatch`; pattern `/showDeckSheet\s*\?\s*\(\s*<InChatDeckSheet/s` → `/InChatDeckSheet/`; message → `"InChatDeckSheet has been removed per ORCH-0942 — CollabSessionChatBanners must not re-introduce it"` | ✓ |
| Ghost regression test passes | `npx tsc ... && node /tmp/.../CollabDeckSheet.ghostSessionRegression.test.js` | `PASS T-REWORK-GHOST CollabDeckSheet does not refetch stale or arbitrary foreign collab session ids` ✓ |
| Provider-wrap regression test passes | Same pattern | `PASS T-IMP-1..3 CollabDeckSheet wraps SwipeableCards in per-session RecommendationsProvider` ✓ |
| ORCH-0931 broadcast regression test passes | Same pattern | `PASS T-IMP-1 board_session channel is private`, `PASS T-IMP-2 broadcast replaces PK-filtered session UPDATE`, `PASS T-IMP-3 broadcast dispatches payload`, `PASS T-IMP-4 useBoardSession reloads session after broadcast`, `PASS T-IMP-5 useBoardSession invalidates collab deck after broadcast` ✓ |
| ORCH-0939 strict-grep gate passes | `node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` | `PASS target=app-mobile/src/components/connections/CollabDeckSheet.tsx violations=0` ✓ |
| ORCH-0931 strict-grep gate passes | `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` | `scanned 965 files, 64 postgres_changes listeners, 0 violations` ✓ |

### Hard guards (re-verified post-REWORK)

| Guard | Status |
| --- | --- |
| Only ghost test edited beyond approved scope | ✓ (diff is exactly the 4-line assertion block at 220-223) |
| `CollabDeckSheet.providerWrap.test.tsx` untouched | ✓ (provider-wrap still passes, no diff in staged set) |
| Other ORCH-0939 source files untouched | ✓ (no entries in `git diff --cached --name-only` for `CollabDeckSheet.tsx`, `RecommendationsContext.tsx`, `useBoardSession.ts`, etc.) |
| No supabase / mingla-business / mingla-admin / packages staging | ✓ (none in staged name-only list) |
| No commit / push / PR / merge | ✓ (current state: staged, uncommitted) |
| CLOSE commit subject will include `[TEST-MOD-APPROVED ORCH-0942]` token | Required at CLOSE time per SPEC §7 step 9 — token covers 3 test-file modifications (sessionDeckMountStore.test.ts deletion, CollabSessionChatBanners.test.tsx deletion, ghost regression test assertion change) |

### Quality observation

The implementor's choice of option (a) inverse-assertion is the cleaner outcome — the new assertion encodes ORCH-0942's deletion as a forward-looking invariant: "any future contributor who re-introduces `InChatDeckSheet` to `CollabSessionChatBanners.tsx` will trip this assertion." That's better regression value than option (b) outright deletion would have been. The ghost-session test's bug-finding power on the `f706a421-...` foreign-id leak (its 6 other assertions) is fully preserved.

### Verdict

**PASS.** No further REWORK needed. The implementation is ready for tester dispatch.

P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 1 (P4-1 quality observation above — the inverse-assertion choice is a praise-worthy pattern)

### Downstream routing

Claude `mingla-tester` for TARGETED regression-only verification:
- Matches sub-tab smoke (tap Matches pill → SavedToSessionCardsSheet opens with live data)
- Swipe sub-tab smoke (tap Swipe pill → CollabDeckSheet opens, black background, "Testing stuff" header)
- Plans sub-tab smoke (tap Plans pill → ScheduleSheet opens with live data)
- Posture: 3 sims autonomous via Maestro + operator HITL on physical iPhone (Marcus)
- Devices: iPhone 17 Pro Max sim (Ava), iPhone 17 sim (Priya), Pixel 8 Pro emu (Ethan), Seth's physical iPhone

After tester PASS → Codex `orchestrator-mingla` for CLOSE with mobile-only commit subject containing `[TEST-MOD-APPROVED ORCH-0942]`, no `[deploy]` tag, no EAS OTA.
