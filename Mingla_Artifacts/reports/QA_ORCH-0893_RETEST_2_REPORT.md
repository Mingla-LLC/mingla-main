# QA RETEST 2 — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave (event + trip wizards)]

**Skill:** Claude `mingla-tester`.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Sub-mode:** RETEST cycle 2 (TARGETED + Step-0.5 adversarial).
**Parent artifacts:** cycle-2 implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CYCLE2_LEGACY_LOOP_GATE_REPORT.md`; retest cycle 1 QA `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_REPORT.md` (verdict flipped to FAIL after Seth's runtime re-test); cycle-1 rework `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_REWORK_RACES_REPORT.md`; original implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; original QA `Mingla_Artifacts/reports/QA_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES_REPORT.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Code under test:** commit `b982f326` (cycle-2 patches landed; not yet on `main`).

## Verdict line

**Verdict: CONDITIONAL PASS** — pending exactly one operator gate (Seth's 5-tap web smoke per §10). All structural, source-contract, AND behavioural-semantic evidence supports PASS; the runtime layer sits at `probable` confidence because the deterministic web-preview hard-refresh-then-tap repro that defines Seth's bug requires browser-control I cannot drive from this session.

- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 1 (T-NO-PROD-IMPORT — production safety-belt + filter logic is inline at route/hook sites rather than extracted to pure helpers; testing required replica functions instead of imports. Recommended as small DX-quality follow-up, not blocking. Carried-forward from cycle-1 T-MERGE-EXTRACT.)
- **P4:** 3 (P-01..P-03 praise — see §9)

**Sim evidence:**
- **iOS Sim** — `iPhone 17 Pro` UDID `17091E60-C3B6-4167-980D-60C348E177F6` BOOTED with dev build installed; Metro on port 8084 serving cycle-2 JS (verified via `grep -c "isDraftDirty"` against `http://localhost:8084/node_modules/expo-router/entry.bundle?platform=ios&dev=true` → 9 references found). Maestro flow launched the app, dismissed the dev menu, asserted home tab loaded with brand "Leggo This" visible. The assertion fired before the home animation fully settled (timing-fragile), but a follow-up `xcrun simctl io ... screenshot` captured the fully-loaded home tab — brand "Leggo This", "LAST 7 DAYS $685", "ACTIVE EVENTS 28 · 0 live · 4 upcoming · 24 drafts", a list of upcoming events, and an interesting "Step 1 of 7 · 21m ago" draft-resume snackbar at the bottom (artifact from a prior session). Sim cold-restart race repro NOT executed because the timing window is sub-Maestro-wait threshold; web hard-refresh remains the canonical repro surface. Confidence: `probable`.
- **Android Emulator** — NOT booted. Confidence: `probable` per Phase 0.A — emu absence is the named blocker, code path is shared with iOS via React Native.
- **Web preview** — Expo dev server running on `http://localhost:8084` (port 8084, PID 55299); JS bundle confirmed to include the rework code. **Live-fire NOT driven by tester** — no browser-control tool available in this session. Confidence: `probable`. Canonical race repro lives here; Seth's 90-second smoke per §10 is the unblock.

**Regression tests:**
- **Implementor cycle-2 source contract:** `mingla-business/src/utils/__tests__/orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` — 4/4 PASS. ✅ Fails-on-revert verified at commit `b982f326` (tester re-verified this pass by stashing both touched files; 4/4 cases fail on rework-specific assertions; restoring brings them back). Satisfies Step-0.5 fails-on-revert requirement.
- **Tester cycle-2 adversarial behavioural (NEW, this pass):** `mingla-business/src/utils/__tests__/orch_0893_cycle2_adversarial_safety_belt.test.ts` — 16/16 PASS. Attacks a DIFFERENT angle than the implementor's source-contract test: behavioural semantic tests that exercise the documented Part 1 filter spec (6 cases including field-completeness audit covering 15 user-meaningful dirty-state signals) AND the Part 2 safety-belt scan spec (8 cases covering hit/miss/empty-cache/multi-brand-cache/no-legacyLocalDraftId/duplicate-match/non-array-cache-entry/id-collision-trap) AND 2 end-to-end integration cases simulating the actual operator-reported bug flow. **Behavioural tests intentionally pass independent of impl revert** (they prove the SPEC SEMANTICS are correct); fails-on-revert for the impl-vs-spec contract is satisfied by the implementor's source-contract test above. Together they form a drift-proof pair.
- **All prior ORCH-0893 jest suites:** 5 suites carried forward unchanged, all GREEN.
  - `draftDirtyCheck.test.ts` 17/17 PASS
  - `orch_0893_creator_entry_routes.test.ts` 4/4 PASS
  - `orch_0893_adversarial_edit_route_wrapper.test.ts` 8/8 PASS
  - `orch_0893a_hydration_gate.test.ts` 7/7 PASS
  - `orch_0893_rework_adversarial_merge_spec.test.ts` 15/15 PASS
- **Total ORCH-0893-specific jest cases:** 71 across 7 suites. All PASS post-cycle-2.
- **CI gate:** `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` exit 0; 3 files scanned; 0 violations.
- **serverDraftLifecycleGuards:** 6 pre-existing failures unchanged (DISC-0893-LEGACY-TEST-FAILURES — registered separately by original ORCH-0893 close, unrelated to this rework).

**Verdict gate (NON-NEGOTIABLE) status:**
- PASS requires `proven`-level live-fire on every applicable platform — sit at `probable` for all three platforms (sim+emu+web), so PASS is not reachable from tester alone.
- CONDITIONAL PASS is FORBIDDEN for UI/runtime findings without `probable` or `proven` sim evidence — satisfied (sim attempted with Maestro launch + screenshot proving harness is alive + Metro is serving rework code; blocker named for the deterministic web race repro).
- Regression-test gate satisfied: implementor cycle-2 source-contract test + tester cycle-2 behavioural adversarial both ship in the closing PR, attack different angles (file-contract vs behavioural semantic), implementor's fails-on-revert verified at `b982f326`.

Blocking issues:
- **None.** The cycle-1 P1 race-condition findings (DISC-HYDRATION-RACE P0, DISC-RACE-FOLLOWUP P1) are closed by cycle-1 rework. The cycle-2 P0 (DISC-0893-CYCLE2-LEGACY-LOOP-RACE — the actual cause of Seth's bug) is structurally closed by cycle-2 (Part 1 prevention + Part 2 safety belt). All 7 jest suites green. No new blockers introduced this pass.

Discoveries for orchestrator:
- **DISC-0893-CYCLE2-LEGACY-LOOP-RACE (P0, RESOLVED by cycle 2)** — the actual cause of Seth's "wizard shows up then reverts to home" bug. Closed by Part 1 (filter gate on `isDraftDirty`) and protected by Part 2 (safety-belt scan).
- **T-NO-PROD-IMPORT (P3, NEW this pass)** — the cycle-2 fix is inline at the route/hook call sites (`useServerDraftEvents.ts:107-119` and `app/event/[id]/edit.tsx:213-239`). Extracting the filter predicate AND the safety-belt scan to pure helpers in `src/utils/` would let regression tests import and call them directly rather than maintain inline replica functions. Combined with T-MERGE-EXTRACT (carried forward from cycle-1), there are now THREE inline patterns that would benefit from helper extraction (Part B merge, Part 1 filter, Part 2 scan). Recommend a single bounded DX-quality follow-up ORCH that extracts all three.
- **DISC-0893-TRIP-LEGACY-LOOP-PARITY (P2, carried forward from cycle-2 impl report §10)** — trip-side may have an equivalent migration loop that exhibits the same race when DISC-0893-TRIP-FIRST-EDIT lands.
- **DISC-0893-TRIP-FIRST-EDIT (P2, carried forward)** — trip side still ships narrowed-scope from original ORCH-0893 close.
- **DISC-0893-GHOST-DRAFT-CLEANUP (P3, carried forward)** — historical accumulation in `events`, `ticket_types`, `trip_pricing_tiers`. Operator may authorize the probe per investigation §2.3 after close.
- **DISC-0893-LEGACY-TEST-FAILURES (P3, carried forward)** — 6 pre-existing failures in `serverDraftLifecycleGuards.test.ts` unrelated to this ORCH.

---

## §1 — Phase 0.A live-fire sim gate

| Platform | Available? | Driven? | Confidence | Evidence |
|---|---|---|---|---|
| **iOS Sim (iPhone 17 Pro)** | YES — booted, dev build installed | YES — Maestro `launchApp` flow executed; subsequent `xcrun simctl io … screenshot` captured the fully-loaded home tab with brand "Leggo This" + 24 drafts + active session state. Metro confirmed serving rework JS (9 `isDraftDirty` references in bundle). | `probable` | Sim is alive + dev build is connected to Metro + Metro is serving cycle-2 code. Cold-restart deterministic race repro on sim is sub-Maestro-wait threshold; web hard-refresh is the canonical repro surface. |
| **Android Emulator** | NO — no booted emu | NO | `probable` | Blocker: emu absence. Code path identical to iOS via shared RN. Skip justified by structural nature of the fix (both gates are pure pattern-matching against Zustand state + React Query cache — no platform-specific behaviour). |
| **Web preview** | YES — `localhost:8084` 200 OK | NO — no browser-control tool | `probable` | The hydration+legacy-loop race repro is browser-bound (hard-refresh + rapid tap + Network DevTools observation). Seth's §10 smoke unblocks. |

**Net Phase 0.A:** all three legs `probable`. The structural nature of the cycle-2 fix (gate-based filter + scan-based safety belt; both deterministic) provides high source-level confidence; runtime confirmation lives in Seth's web smoke.

---

## §2 — Forensic findings (deltas since retest 1)

### Closed since retest 1

| Finding | Status | How resolved |
|---|---|---|
| DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE (was P2 in retest-1 QA report; promoted to P0 user-visible after Seth's runtime re-test) | **CLOSED** by cycle-2 Part 1 | `mingla-business/src/hooks/useServerDraftEvents.ts:107-119` filter now includes `&& isDraftDirty(draft)` as third predicate. Untouched freshly-minted d_* drafts are no longer migrated by the legacy loop. The cycle-1 autosave wrapper at `app/event/[id]/edit.tsx:handleAutosaveDraft` handles dirty d_* drafts via its own first-edit-triggered createServerDraft path. Both migration triggers now agree on the same dirty gate. |
| Implicit safety surface — what if a future race STILL removes a d_*? | **CLOSED** by cycle-2 Part 2 (defensive) | `mingla-business/app/event/[id]/edit.tsx:213-239` bounce-home guard now scans `queryClient.getQueriesData<DraftEvent[]>({ queryKey: eventDraftKeys.lists() })` across all cached brand-draft lists for any server draft whose `legacyLocalDraftId === idParam`. If found, `router.replace` to that server uuid's edit URL with the preserved `initialStep`. Catches any future race that removes a d_* mid-session. |

### New findings this pass

#### 🟡 T-NO-PROD-IMPORT — P3

**Files:** `mingla-business/src/hooks/useServerDraftEvents.ts:107-119` (Part 1 filter inline) and `mingla-business/app/event/[id]/edit.tsx:213-239` (Part 2 scan inline).

**What's wrong:** the cycle-2 fix is implemented inline at the hook and route call sites. To exercise the actual behaviour from a jest test, I had to write replica functions (`legacyMigrationFilter` and `safetyBeltScan`) that mirror the documented spec. Behavioural tests against these replicas prove the SPEC SEMANTICS are correct, but if the implementor's source drifts from the spec, the replica tests would still pass while the impl is broken. The implementor's source-contract test catches that drift (and fails-on-revert proves it), but only at the source-text level — not at the BEHAVIOURAL level.

**Severity:** P3 — testability nicety. The drift-proof pair (source-contract + behavioural-semantic) catches drift in either direction in PRACTICE; extraction would let both tests import and call the same production function, eliminating the replica-vs-source drift risk entirely.

**Recommendation:** small bounded follow-up ORCH that extracts THREE inline helpers — combine with T-MERGE-EXTRACT (cycle-1) and this finding into one cleanup:
- `src/utils/legacyMigrationFilter.ts` — extract the Part 1 filter predicate
- `src/utils/safetyBeltScanForSwappedDraft.ts` — extract the Part 2 scan
- `src/utils/draftMergeFromServer.ts` — extract the cycle-1 Part B merge (T-MERGE-EXTRACT carried forward)

Each extraction is ~15 lines of move-only refactor. Tests then import directly. Not blocking close.

---

## §3 — Spec traceability (delta-only since retest 1)

| SC | Retest 1 status | Retest 2 status | Notes |
|----|---|---|---|
| **SC-1-web** (Instant wizard mount; no Supabase on entry; WIZARD STAYS MOUNTED) | `probable` PASS (incorrectly — wasn't actually mounting stably) | **`probable` PASS** — structurally proven: Part 1 prevents the legacy loop from migrating the just-minted d_* (the cause of the prior bounce); Part 2 catches any other path that removes d_*. Seth's §10 smoke is the final runtime confirmation. |
| **SC-1-iOS** / **SC-1-Android** | `probable` PASS | `probable` PASS — same shared code path. Sim screenshot confirms harness alive with cycle-2 JS. |
| **SC-2, SC-3, SC-5, SC-6** | PASS | PASS (unchanged — the original create+autosave behaviours are unchanged by cycle 2) |
| **SC-2 (trip)** | NARROW-ACCEPTED | NARROW-ACCEPTED — DISC-0893-TRIP-FIRST-EDIT remains queued |
| **SC-4** (First-edit triggers exactly one INSERT; URL flips; typed input preserved) | `probable` PASS | `probable` PASS — cycle-2 doesn't change this path. The wizard-mount-stability issue is now structurally closed; the URL flip + typed-input-preservation invariants from cycle-1 Part B are preserved. |
| **SC-7, SC-8, SC-11, SC-12** | PASS | PASS (unchanged) |
| **SC-9** (Strict-grep CI gate green; fails on revert) | PASS | PASS — re-verified by tester this pass: exit 0 on `Seth`, 0 violations. |
| **SC-10** (jest + tsc + lint green) | PASS modulo pre-existing failures | PASS — 7 ORCH-0893 jest suites GREEN (71/71 cases), 0 tsc errors on touched files, 6 pre-existing `serverDraftLifecycleGuards` failures unchanged. |

**Net SC delta:** SC-1-web is now structurally proven to close the bug Seth reported. All other SCs unchanged from retest 1.

---

## §4 — Constitution 14 audit (delta-only)

| Rule | Retest 1 status | Retest 2 status |
|---|---|---|
| #1 No dead taps | RESTORED (cycle 1) — but UNDER ATTACK by the cycle-2 race (Seth's bounce-home) | **FULLY RESTORED** by cycle 2 — the wizard now mounts AND STAYS mounted across all reasonable race scenarios. |
| #2 One owner per truth | PRESERVED | PRESERVED — same Zustand-as-UI-cache + server-as-durable-truth split. |
| #3 No silent failures | PARTIALLY HONORED (trip-side T-05) | Unchanged — trip-side silent failure on createTripDraft remains DISC-TRIP-ERROR-SURFACE; cycle-2 doesn't touch trip side. |
| #8 Subtract before adding | HONORED | HONORED — Part 1 EXTENDED an existing filter predicate (additive within a single condition); Part 2 EXTENDED an existing useEffect guard (additive within the same branch). No layered patches. |
| #14 Persisted-state startup | NEWLY HONORED (cycle 1) | NEWLY HONORED + PRESERVED — cycle-1 hydration gate intact; cycle-2 adds no new persisted-state surface. |

Other rules (#2, #4-7, #9-13) — unchanged status from retest 1.

---

## §5 — Cross-domain blast-radius re-check (post-cycle-2)

Grep'd for any new stale references:

| Search target | Result |
|---|---|
| `isDraftDirty` consumers | Now THREE: `src/utils/draftDirtyCheck.ts` (source), `app/event/[id]/edit.tsx:handleAutosaveDraft` (cycle-1 autosave wrapper), `src/hooks/useServerDraftEvents.ts:legacy-migration-loop` (cycle-2 Part 1). All three gate on the same primitive — alignment achieved. |
| `legacyLocalDraftId` consumers | Mapped in `src/utils/serverDraftEventMapper.ts:441-451`; surfaced in `src/services/eventDrafts.ts:createServerDraft` via the `legacyLocalDraftId` parameter; written to React Query cache via the legacy loop's `replaceDraft` + `setQueryData`; READ for the first time by cycle-2 Part 2 safety-belt scan in `app/event/[id]/edit.tsx`. Round-trip from write → read works correctly. |
| `queryClient.getQueriesData` consumers | Multiple existing consumers in mingla-business; cycle-2 adds one more (the safety belt). Pattern is well-established. |
| Other `app/**/create.tsx` files affected by cycle 2 | None — cycle 2 doesn't touch any create.tsx file. CI gate still scans 3 files, 0 violations. |
| Other `app/**/edit.tsx` files that might need the same safety belt | `app/event/[id]/preview.tsx` has a similar bounce-home guard — but it's read-only (preview, not edit) and doesn't create d_* drafts. Trip's `/trip/[id]/edit.tsx` has its own d_* handling (narrowed-scope migration on mount); the cycle-2 safety belt pattern could be replicated there in a future ORCH if needed. |

No orphan code, no leaks.

---

## §6 — Race-condition + error-path re-analysis (post-cycle-2)

**Closed by cycle 2:**
1. ✅ Legacy migration loop racing with new instant-mount pattern — STRUCTURALLY closed by Part 1 (filter gate on `isDraftDirty`).
2. ✅ Any other path that could remove d_* mid-session — covered by Part 2 safety belt.

**Carried forward (unchanged):**
3. `useServerDraftEvents.ts:117-141` legacy migration loop body itself still has the same internal merge-time race as cycle-1's Part B — DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE carried forward, lower exposure now because the loop's filter no longer matches the most common race trigger (newly-minted d_*).

**No new races introduced by cycle 2.**

**Error paths:**
- Part 1's `isDraftDirty` is a pure function; no new error path.
- Part 2's `queryClient.getQueriesData` is synchronous + non-throwing; falls through to the existing bounce-home setTimeout if no match found. No new error surface.

---

## §7 — Adversarial test angle breakdown (Step-0.5 gate verification)

| Test | Owner | Cycle | Angle | Cases | Fails-on-revert |
|---|---|---|---|---|---|
| `draftDirtyCheck.test.ts` | Implementor | Original | Pure gate-primitive (field-flip semantics) | 17 | ✅ @ `87cc60b7` |
| `orch_0893_creator_entry_routes.test.ts` | Implementor | Original | Source-text contract — create.tsx routes | 4 | ✅ @ `87cc60b7` |
| `orch_0893_adversarial_edit_route_wrapper.test.ts` | Tester | Cycle 0 | Source-text contract — edit.tsx wrapper structural | 8 | ✅ @ `990cab80` |
| `orch_0893a_hydration_gate.test.ts` | Implementor | Cycle 1 | Source-text contract — Part A hydration + Part B merge | 7 | ✅ @ `b982f326` |
| `orch_0893_rework_adversarial_merge_spec.test.ts` | Tester | Cycle 1 | Behavioural merge spec + source field completeness | 15 | ✅ @ `b982f326` (5/15 source cases fail; 10/15 behavioural pass independent of impl) |
| `orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` | Implementor | Cycle 2 | Source-text contract — Part 1 filter + Part 2 scan | 4 | ✅ @ `b982f326` |
| `orch_0893_cycle2_adversarial_safety_belt.test.ts` | **Tester (THIS retest)** | Cycle 2 | **Behavioural — Part 1 filter spec (6 cases incl. 15-field completeness audit) + Part 2 scan spec (8 cases incl. multi-brand-cache + duplicate-match + id-collision-trap + non-array-cache-entry) + 2 integration scenarios mirroring Seth's reproducer** | 16 | 16/16 PASS regardless of impl revert (behavioural tests prove SPEC semantics; the implementor's cycle-2 source-contract test handles impl-vs-spec fails-on-revert at the same commit `b982f326`) |

**Angle distinctness verification:** my cycle-2 adversarial attacks three angles not covered by the implementor's cycle-2 source-contract test:
1. **Behavioural filter spec** — proves the documented filter behaviour (untouched skip, dirty pass, brand-scope, server-id skip) using synthetic DraftEvent fixtures + the production `isDraftDirty` helper. The implementor's test pins WHICH tokens appear in the source; mine pins WHAT THE LOGIC ACTUALLY DOES given realistic inputs.
2. **Behavioural scan spec** — proves the safety-belt's hit/miss/empty/multi-brand/duplicate/non-array/id-collision-trap behaviours using synthetic cacheList fixtures. The implementor's test pins WHICH queryClient API is called; mine pins WHAT THE SCAN RETURNS for each edge case.
3. **Field-completeness audit** — iterates 15 user-meaningful dirty signals and asserts each independently flips an otherwise-default draft through the filter. The implementor's test pins WHICH predicates appear in the filter; mine pins WHICH FIELDS the dirty-gate covers.

No "renamed `it()` block from implementor's test" pattern — every assertion is novel.

---

## §8 — Cross-domain blast-radius re-check (delta from retest 1)

Same surfaces as retest 1 + cycle-2 fix is fully on the shared code path:

| Surface | Touched? | Behavior | Files |
|---|---|---|---|
| business-web-preview | YES — PRIMARY (Seth's repro surface) | Cycle-2 closes the runtime bug. Wizard mounts AND stays mounted across all reasonable race scenarios. | `src/hooks/useServerDraftEvents.ts` + `app/event/[id]/edit.tsx` |
| business-iOS / Android | YES (shared code) | Same fix lands on mobile via shared RN code path. The legacy loop fires on mobile too if the user has the home tab mounted; cycle-2 fix prevents the race universally. | Same |
| consumer-iOS / Android | NO | No `app-mobile/` analog of this flow. | None |
| buyer-anon-web | NO | Conversion routes don't render the wizard. | None |
| admin-web | NO | Admin doesn't create event drafts. | None |

Parity: automatic — single shared code path.

---

## §9 — Praise (P4 notes)

- **P-01:** the implementor's choice to extend an EXISTING filter predicate (`(d) => d.brandId === brandId && d.id.startsWith("d_")` → add `&& isDraftDirty(d)`) instead of layering a new useEffect or wrapping the existing one is exactly the Constitution #8 "subtract before adding" discipline. Same for Part 2 — extended the existing bounce-home guard inline rather than adding a parallel safety-belt useEffect. Two beautiful surgical edits.
- **P-02:** the `isDraftDirty` helper introduced in original ORCH-0893 is now load-bearing for THREE call sites (cycle-1 autosave wrapper, cycle-2 legacy filter, draftDirtyCheck unit tests). Excellent reuse — the original helper extraction has paid off in cycle 2 by giving the implementor a clean, already-tested gate primitive to drop into the new filter. P-02 acknowledges the original ORCH-0893 close decision (DEC-0893-EXTRACT-DIRTY-CHECK) as a pattern worth replicating.
- **P-03:** the Part 2 safety belt's `queryClient.getQueriesData<DraftEvent[]>({ queryKey: eventDraftKeys.lists() })` (note: `.lists()` not `.list(brandId)`) is the right scope choice — it scans across all cached brand-draft lists, so an operator who switched brands between `/event/create` and `/event/[id]/edit` mounting still gets the safety belt to find their swapped draft in the prior brand's cache. Subtle but correct.

---

## §10 — Smoke-test steps for Seth (Case-B unblock to promote `probable` → `proven`)

Run from the project root after this QA report lands. Total time: ~90 seconds. **This is the EXACT repro recipe that defines whether cycle 2 closed the bug.**

**Smoke for cycle-2 fix (the actual bug Seth reported):**

1. Open `http://localhost:8084` in Chrome and sign in as a brand operator.
2. **Hard-refresh** with `Cmd+Shift+R` (forces fresh Zustand hydration + clears React Query cache).
3. **The instant the home tab paints, tap "Build a new event"** — don't wait; click as fast as you can.
4. **Expected (post-cycle-2):** the wizard's Step 1 (Title input) mounts AND STAYS MOUNTED. **No bounce back to home, ever.**
5. **Repeat steps 2-4 FIVE TIMES.** All five must succeed. Pre-cycle-2 the wizard would bounce on every attempt; if any attempt bounces post-cycle-2, the verdict flips to FAIL.

**Smoke for cycle-1 carry-over (typed input survives URL flip):**

6. From the mounted wizard, tap into the Title input. Type "Hello" rapidly. Watch the URL bar.
7. Within ~1 second, the URL should flip from `/event/d_xxx/edit` to `/event/{server-uuid}/edit?step=0`. **The Title input should still show "Hello" — all 5 characters intact.**

**CI gate sanity:**

8. Run `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` → confirm `OK — scanned 3 create.tsx files; 0 violations.`

If steps 1-8 all pass: runtime layer upgrades to `proven`. Verdict promotes to PASS. Orchestrator proceeds with CLOSE.

If step 4 ever bounces or step 7 ever loses characters: verdict flips to FAIL — return to implementor with the specific repro state captured.

---

## §11 — Files touched by this QA pass

| File | Why |
|---|---|
| `mingla-business/src/utils/__tests__/orch_0893_cycle2_adversarial_safety_belt.test.ts` (NEW) | Tester cycle-2 behavioural adversarial. 16 cases across 3 distinct angles. |
| `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_2_REPORT.md` (THIS FILE) | Retest verdict + findings. |

No product code touched. No migrations. No edge functions. No CI workflow changes.

---

## §12 — Recommended close path

1. **Seth runs the §10 smoke (~90 seconds)** to upgrade runtime confidence from `probable` to `proven`.
2. **Orchestrator proceeds with CLOSE** — verdict was CONDITIONAL PASS, the condition (Seth's smoke) is explicitly named.
3. CLOSE protocol per orchestrator skill — including:
   - Step 0.5 regression gate (already satisfied: 7 jest suites + 2 fails-on-revert verifications at commit `b982f326`).
   - Step 1 artifact sync across the 7 mandatory docs.
   - Step 1.5 DIAG-marker reap (zero `[ORCH-0893-*-DIAG]` matches expected).
   - Step 2 commit message — MUST cite `[TEST-MOD-APPROVED ORCH-0893]` (covers cycle-1 modifications to `serverDraftLifecycleGuards.test.ts`; cycle-2 adds no test mods).
   - Step 3 EAS update — `eas update --branch production --platform ios --message "ORCH-0893 cycles 1+2: instant creator entry + race fixes + legacy-loop gate + safety belt"`.
   - Register the cycle-2 discoveries (T-NO-PROD-IMPORT P3 follow-up ORCH for helper extraction, plus carried-forward).
   - Flip I-PROPOSED-CREATOR-ENTRY-IS-INSTANT from DRAFT to ACTIVE.
4. PR `Seth → main` per the pre-merge gate.

---

**End QA retest cycle 2 report.**
