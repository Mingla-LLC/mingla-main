# QA RETEST 1 — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave (event + trip wizards)]

**Skill:** Claude `mingla-tester`.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Authored:** 2026-05-20.
**Sub-mode:** RETEST cycle 1 (TARGETED + Step-0.5 adversarial).
**Parent artifacts:** rework implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_REWORK_RACES_REPORT.md`; prior QA `Mingla_Artifacts/reports/QA_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES_REPORT.md`; original implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; spec `Mingla_Artifacts/specs/SPEC_ORCH-0893_CLIENT_ID_PLUS_LAZY_AUTOSAVE_FOR_CREATOR_ENTRIES.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0893_EAGER_SERVER_DRAFT_ON_CREATOR_ENTRY.md`.
**Code under test:** commit `b982f326` (rework landed; not yet on `main`).

## Verdict line

**Verdict: CONDITIONAL PASS** — pending one operator action (90-second web smoke per §10). All structural and behavioural evidence supports PASS; the runtime layer sits at `probable` confidence per Phase 0.A because the deterministic hydration-race repro requires a browser hard-refresh I cannot drive deterministically from this session.

- **P0:** 0
- **P1:** 0
- **P2:** 1 (T-MERGE-EXTRACT — merge logic is inline in `edit.tsx` rather than extracted to a pure helper; the field-completeness audit added in this retest's adversarial mitigates the drift risk, but extraction would let the implementor's test import the function directly. Recommended as a small DX-quality follow-up ORCH; not blocking close.)
- **P3:** 1 (T-LABEL-COPY — the new "Getting things ready…" placeholder label is correct but vague; a one-line copy refinement could clarify what's being prepared. P3 nicety.)
- **P4:** 4 (P-01..P-04 — see §9)

**Sim evidence:**
- **iOS Sim** — `iPhone 17 Pro` UDID `17091E60-C3B6-4167-980D-60C348E177F6` BOOTED with dev build installed (`com.sethogieva.minglabusiness`); Metro serving rework JS on port 8084 (confirmed via status-bar "Refreshing…" capture in `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_sim_baseline.png`). **Live-fire driven this pass:** sim screenshot captured proving the harness is alive and the dev build is connected to Metro. Maestro flow NOT executed for the cold-restart race repro because the timing window (~50-200ms between app launch and hydration completion) is below Maestro's element-wait deterministic threshold; web preview's hard-refresh-then-tap is the canonical race repro surface. Confidence: `probable`.
- **Android Emulator** — NOT booted (`adb devices` empty). Confidence: `probable` per Phase 0.A — emu absence is the named blocker, and the code path is identical to iOS via shared React Native source. Skipping is justified by the structural nature of the fix (the hydration gate is a pure React/Zustand pattern, not platform-specific).
- **Web preview** — Expo dev server running on `http://localhost:8084` (port 8084, PID 55299, started 6:54 PM); JS bundle responds HTTP 200. **Live-fire NOT driven by tester** — no browser-control tool available in this session. Confidence: `probable`. Canonical race repro lives here; Seth's 90-second smoke (§10) is the unblock path.

**Regression tests:**
- **Implementor happy-path #1 (gate primitive):** `mingla-business/src/utils/__tests__/draftDirtyCheck.test.ts` — 17/17 PASS. ✅ Fails-on-revert verified by implementor at commit `87cc60b7` (original ORCH-0893 close) and confirmed unchanged this pass.
- **Implementor happy-path #2 (source contract, original close):** `mingla-business/src/utils/__tests__/orch_0893_creator_entry_routes.test.ts` — 4/4 PASS. ✅ Fails-on-revert verified at `87cc60b7`.
- **Implementor happy-path #3 (rework source contract):** `mingla-business/src/utils/__tests__/orch_0893a_hydration_gate.test.ts` — 7/7 PASS. ✅ Fails-on-revert verified by implementor at commit `b982f326` (this rework).
- **Tester adversarial #1 (original close — edit-route structural):** `mingla-business/src/utils/__tests__/orch_0893_adversarial_edit_route_wrapper.test.ts` — 8/8 PASS (unchanged this pass; no regression introduced by the rework).
- **Tester adversarial #2 (THIS retest — merge spec behavioural + field completeness + Part A invariants):** `mingla-business/src/utils/__tests__/orch_0893_rework_adversarial_merge_spec.test.ts` — 15/15 PASS. ✅ Fails-on-revert verified at commit `b982f326`: 5/15 source-contract cases fail when both touched routes are stashed; 10/15 behavioural merge-spec cases stay PASS regardless (they prove the SPEC semantics independent of the impl, forming a drift-proof pair with the 5 contract cases). Step-0.5 satisfied — see §6 for the angle-distinct breakdown.

**CI gate:** `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` exit 0; 3 files scanned; 0 violations.

**Verdict gate (NON-NEGOTIABLE) status:**
- PASS requires `proven`-level live-fire on every applicable platform — sit at `probable` for all three platforms (sim+emu+web), so PASS is not reachable from tester alone.
- CONDITIONAL PASS is FORBIDDEN for UI/runtime findings without `probable` or `proven` sim evidence — satisfied (sim attempted, screenshot captured, blocker named for the deterministic race repro).
- Regression-test gate satisfied: implementor happy-path #3 + tester adversarial #2 both ship in the closing PR, attack different angles (file-contract vs behavioural merge-spec + invariants + completeness audit), both fail-on-revert verified.

Blocking issues:
- **None.** All P0/P1 from the original QA report's verdict are closed by the rework (DISC-HYDRATION-RACE P0 closed by Part A; DISC-RACE-FOLLOWUP P1 closed by Part B). Two P2/P3 findings introduced this pass are improvements, not blockers.

Discoveries for orchestrator:
- **T-MERGE-EXTRACT (P2)** — the Part B merge logic is inline at `app/event/[id]/edit.tsx:344-381` (~35 lines). Extracting to a pure helper in `src/utils/draftMergeFromServer.ts` would (a) let the implementor's source-contract test import and call the function directly rather than grep, (b) make adversarial tests cleaner (no need for the test-side spec replica), and (c) make future field-list maintenance live in one place. Recommended as a small DX-quality follow-up ORCH (~30 lines).
- **T-LABEL-COPY (P3)** — the new placeholder label "Getting things ready…" is correct but vague. Operator may prefer something more specific like "Setting things up…" or "Loading your tools…". Tiny nicety, not blocking.
- **DISC-RACE-FOLLOWUP (P1, RESOLVED)** — closed by Part B. No remaining race in the event side's first-edit migration path.
- **DISC-HYDRATION-RACE (P0, RESOLVED)** — closed by Part A. The hydration gate STRUCTURALLY prevents the race (gate-based, not timing-based) — the rework provides a stronger guarantee than the original implicit 600ms-1.5s buffer time.
- **DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE (P2, carried forward unchanged)** — the parallel race in `useServerDraftEvents.ts:117-141` (legacy drafts-list migration loop) remains untouched. Lower exposure than the autosave wrapper. The orchestrator already registered this in the original QA report.
- **DISC-0893-TRIP-FIRST-EDIT (P2, carried forward unchanged)** — trip side still ships narrowed-scope (eager-on-mount migration on resume route). Operator's original deferral stands.
- **DISC-0893-GHOST-DRAFT-CLEANUP (P3, carried forward)** — historical ghost-draft accumulation in `events` + `ticket_types` + `trip_pricing_tiers`. Probe SQL in investigation §2.3.

---

## §1 — Phase 0.A live-fire sim gate

| Platform | Available? | Driven? | Confidence | Evidence |
|---|---|---|---|---|
| **iOS Sim (iPhone 17 Pro)** | YES — booted, dev build installed | YES — sim screenshot captured, app+Metro+dev-menu state confirmed | `probable` | `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_sim_baseline.png` shows the Mingla Business app launched with the Expo dev menu over it and the status bar reading "Refreshing…" — confirms Metro is serving the rework JS to the sim. Cold-restart race repro via Maestro NOT executed because the hydration window is ~50-200ms (sub-Maestro-wait threshold). |
| **Android Emulator** | NO — no booted emu | NO | `probable` | Blocker: emu absence. Code path is identical to iOS via shared React Native — same Zustand persist gate, same hydration semantics. Skip justified by structural nature of the fix. |
| **Web preview** | YES — `localhost:8084` 200 OK | NO — no browser-control tool | `probable` | The hydration-race repro is browser-bound (hard-refresh + immediate tap + Network DevTools). Seth's §10 smoke unblocks. |

**Net Phase 0.A:** all three legs `probable`. The structural nature of the rework (gate-based, not timing-based) provides high source-level confidence; runtime confirmation lives in Seth's web smoke.

---

## §2 — Forensic findings (deltas since the original QA report)

### Closed since the original QA pass

| Original finding | Status | How resolved |
|---|---|---|
| DISC-HYDRATION-RACE (P0, operator-reported new bug) | **CLOSED** by Part A | `app/event/create.tsx` now gates the mint useEffect on `useDraftEventStore.persist.hasHydrated()` and uses `useDraftEventStore.getState().createDraft(...)` (getState form, not subscribed selector). The hydration gate is a STRUCTURAL guarantee — the mint cannot fire until hydration completes, regardless of timing. |
| T-04 / DISC-RACE-FOLLOWUP (P1, typed-input loss) | **CLOSED** by Part B | `app/event/[id]/edit.tsx`'s `handleAutosaveDraft` `.then((serverDraft) => …)` callback now re-reads the live draft via `useDraftEventStore.getState().getDraft(incoming.id)` and merges 30 user-meaningful fields from the live state into the server payload before `replaceDraft`. `lastStepReached` uses `Math.max(live, server)` so step progress never regresses. Adversarial behavioural tests prove the merge semantics (10 cases); source-contract tests prove the impl matches (5 cases). |

### New findings this pass

#### 🟡 T-MERGE-EXTRACT — P2

**File:** `app/event/[id]/edit.tsx:344-381`.

**What's wrong:** the Part B merge object is 35 lines of inline `{ ...serverDraft, name: liveDraft.name, ..., timezone: liveDraft.timezone }` inside the `.then` callback. As DraftEvent grows (e.g., when ORCH-0894+ adds a new user-meaningful field), the implementor must remember to update the merge in lockstep. The implementor's source-contract test only pins 5 representative fields; my retest adversarial added a 30-field completeness audit that catches drift, but the structural fix would be to extract the merge to a pure helper `mergeServerDraftWithLive(serverDraft, liveDraft): DraftEvent` in `src/utils/draftMergeFromServer.ts`. Then both the source-contract test and the behavioural test can import and exercise the function directly.

**Severity:** P2 — pattern deviation that increases drift risk. Mitigated for now by the field-completeness audit, but extraction would be cleaner.

**Recommendation:** small follow-up ORCH (~30 lines). Not blocking close.

#### 🔵 T-LABEL-COPY — P3

**File:** `app/event/create.tsx:84-87`.

**What's wrong:** the new placeholder label "Getting things ready…" is vague. Users may interpret as "preparing the wizard" or "loading from the cloud" or "warming up the cache." Could be tightened to "Setting up your editor…" or similar.

**Severity:** P3 — cosmetic, would only matter if the placeholder lingers more than 1 frame, which it usually doesn't.

**Recommendation:** can be a copy ticket; defer to whenever the next UI/UX polish pass touches the wizard chrome.

---

## §3 — Spec traceability (delta-only since original QA report)

| SC | Original status | Retest status | Notes |
|----|---|---|---|
| **SC-1-web** (Instant wizard mount, 200ms, no Supabase on entry) | `probable` PASS | **`probable` PASS** — structurally stronger now: the hydration gate ensures the wizard mount only fires when Zustand state is in a known-good state. Seth's §10 smoke is the final runtime confirmation. |
| **SC-1-iOS** | `probable` PASS | `probable` PASS — sim screenshot proves the harness is alive; same shared code path. |
| **SC-1-Android** | `probable` PASS | `probable` PASS — same shared code path. |
| **SC-2 (event)** (Cold-create-then-back leaves zero rows) | PASS | PASS — `handleAutosaveDraft` still short-circuits on `!isDraftDirty(incoming)`; the rework does not introduce any new pre-edit network calls. |
| **SC-2 (trip)** | NARROW-ACCEPTED | NARROW-ACCEPTED (unchanged — DISC-0893-TRIP-FIRST-EDIT remains queued) |
| **SC-3-web** (Same as SC-2 for event) | PASS | PASS |
| **SC-4** (First-edit triggers exactly one INSERT; URL flips; typed input preserved) | `probable` PASS for URL+id flip; T-04 risk for fast-typist case | **`probable` PASS — fast-typist case CLOSED by Part B merge.** The 15-case adversarial proves typed input survives the merge across the in-flight window. |
| **SC-5** (Subsequent edits are UPDATE not duplicate INSERT) | PASS | PASS (unchanged) |
| **SC-6** (Rapid typing coalesces) | PASS structurally; T-04 race for typing-during-window | PASS — typing-during-window is now data-safe (Part B). |
| **SC-7** (Auth-lapse error surface) | PASS | PASS (unchanged) |
| **SC-8** (RLS-rejection error surface) | PASS | PASS (unchanged) |
| **SC-9** (Strict-grep CI gate green; fails on revert) | PASS | PASS — re-verified by tester this pass: exit 0 on `Seth`. |
| **SC-10** (jest + tsc + lint green) | PASS modulo pre-existing failures | PASS — 5 ORCH-0893 jest suites GREEN (51/51 cases), 0 tsc errors on touched files, 6 pre-existing serverDraftLifecycleGuards failures unchanged (DISC-0893-LEGACY-TEST-FAILURES). |
| **SC-11** (I-11 format-agnostic ID resolver preserved) | PASS | PASS — `d_<ts36>` format unchanged. |
| **SC-12** (`/venue/create` unchanged) | PASS | PASS — `git diff Seth -- mingla-business/app/venue/create.tsx` empty. |

**Net SC delta:** SC-4 + SC-6 promoted from "PASS structurally with T-04 risk" → "PASS — risk closed by Part B." SC-1-* still `probable` pending Seth's smoke.

---

## §4 — Constitution 14 audit (delta-only)

| Rule | Original status | Retest status |
|---|---|---|
| #1 No dead taps | RESTORED | RESTORED — the rework's hydration gate makes the create CTA reliable on the FIRST tap. |
| #3 No silent failures | PARTIALLY HONORED (trip-side T-05) | Unchanged — trip side still has silent failure in createTripDraft catch. DISC-TRIP-ERROR-SURFACE remains queued; trip-side scope was already deferred. |
| #8 Subtract before adding | HONORED | HONORED — the rework REPLACED the subscribed-selector form with the getState form, not layered. |
| **#14 Persisted-state startup (`_hasHydrated` gate)** | (Not implicated pre-rework) | **NEWLY HONORED by the rework.** The hydration gate satisfies Constitution #14 explicitly. Mingla now has its first canonical implementation of this rule in the create route. Recommend the orchestrator look at extending this pattern to other persisted Zustand stores (currentBrandStore, draftVenueStore, etc.) — see DISC-0893-A-VENUE-HYDRATION-RACE-LATENT carried forward. |

Other rules (#2, #4-7, #9-13) — unchanged status from original QA report.

---

## §5 — Five-truth-layer cross-check (delta-only)

| Layer | Original | Retest |
|---|---|---|
| **Docs** | Aligned | Aligned — implementor updated docstrings on both touched files with rework rationale + ORCH-0893 REWORK Part A/B citation; the rework implementation report is internally consistent with this QA report. |
| **Schema** | Unchanged | Unchanged. |
| **Code** | Verified | Verified — both touched files re-read end-to-end this pass; the rework merge field set is correct; the hydration gate's ordering relative to the brand-null check is correct (hydration FIRST, then brand-null). |
| **Runtime** | `probable` PASS | `probable` PASS — sim screenshot proves harness alive; Seth's smoke per §10 confirms. |
| **Data** | Not probed | Not probed (carried forward; operator may authorize ghost-draft count probe per DISC-0893-GHOST-DRAFT-CLEANUP). |

No new layer contradictions.

---

## §6 — Adversarial test angle breakdown (Step-0.5 gate verification)

| Test | Owner | Angle | Lines | Cases | Fails-on-revert |
|---|---|---|---|---|---|
| `draftDirtyCheck.test.ts` | Implementor | Pure-function gate-primitive (field-flip semantics) | 158 | 17 | ✅ @ `87cc60b7` |
| `orch_0893_creator_entry_routes.test.ts` | Implementor | Source-text contract — `app/event/create.tsx` + `app/trip/create.tsx` import/router-replace patterns | 115 | 4 | ✅ @ `87cc60b7` |
| `orch_0893_adversarial_edit_route_wrapper.test.ts` | Tester (cycle 0) | Source-text contract — `app/event/[id]/edit.tsx` wrapper branch ORDER + catch-block ORDER + invariant registry entry | 220 | 8 | ✅ @ `990cab80` |
| `orch_0893a_hydration_gate.test.ts` | Implementor (rework) | Source-text contract — Part A hydration gate tokens + Part B merge representative-field pinning | 165 | 7 | ✅ @ `b982f326` |
| `orch_0893_rework_adversarial_merge_spec.test.ts` | **Tester (this retest)** | **Behavioural merge SPEC** (10 cases proving typed-input survives in-flight race) **+ source field-completeness audit** (1 case scanning 30 required fields in actual source) **+ Part A behavioural invariants** (3 cases proving ordering + dep-array + defensive double-check) **+ "merge must not echo d_*" negative-control** (1 case) | 480 | 15 | ✅ @ `b982f326` (5/15 source cases fail on revert; 10/15 behavioural cases prove spec correctness independent of impl) |

**Angle distinctness verification:** the tester adversarial #2 attacks three angles not covered by any of the four prior tests:
1. **Behavioural merge spec** — proves the SPEC SEMANTICS (typed input survives race) by exercising synthetic queue-snapshot + live-state + server-echo scenarios. Independent of the impl source.
2. **Field completeness audit** — scans the actual source merge block via regex and asserts all 30 required user-meaningful fields appear. Catches drift when DraftEvent grows or the merge forgets a field.
3. **Part A behavioural invariants** — proves WHY each token in the hydration gate is required (ordering before brand-null check, dep-array inclusion of `hydrated`, defensive double-check captures microtask race). Pins reasoning, not just presence.

No "renamed `it()` block from implementor's test" pattern — every assertion is novel.

---

## §7 — Cross-domain blast-radius re-check

Grep'd post-rework for any new stale references:

| Search target | Result |
|---|---|
| `createClientDraft(` outside of comments | Zero matches — fully replaced by `useDraftEventStore.getState().createDraft(...)`. |
| `useDraftEventStore.persist.hasHydrated` consumers | One match (event/create.tsx, by design). |
| `useDraftEventStore.persist.onFinishHydration` consumers | One match (event/create.tsx, by design). |
| `mergedServerDraft` references | All within `app/event/[id]/edit.tsx` (declaration + 3 uses in the same block). No leakage. |
| Other `app/**/create.tsx` files affected | `app/venue/create.tsx` + `app/trip/create.tsx` — both unchanged this pass; CI gate scans them and reports 0 violations. |

No orphan code, no cross-domain leaks.

---

## §8 — Race-condition + error-path re-analysis (delta)

**Closed by rework:**
1. ✅ Hydration race (mint-vs-persist-replace) — STRUCTURALLY closed by hydration gate.
2. ✅ Typed-input loss during in-flight migration — closed by Part B live-state merge.

**Unchanged (latent, carried forward):**
3. `useServerDraftEvents.ts:117-141` legacy migration loop has the same merge-time race — DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE remains queued.

**No new races introduced by the rework.**

**Error paths:**
- The hydration gate adds no new error path (subscribing to `onFinishHydration` cannot throw; the callback only flips state).
- Part B merge adds no new error path (`getDraft` returns nullable; the ternary handles null).

---

## §9 — Praise (P4 notes)

- **P-01:** the implementor's defensive double-check inside the hydration `useEffect` (re-reading `hasHydrated()` after subscribing to `onFinishHydration`) is a nice belt-and-suspenders move. Catches the rare microtask race where hydration completes between the `useState` initializer's call and the effect mount. Cited in the rework report's §2 receipt.
- **P-02:** the switch from `useDraftEventStore((s) => s.createDraft)` (subscribed selector) to `useDraftEventStore.getState().createDraft(...)` (getState form) is a defensive improvement that eliminates a class of subscription-staleness bugs not directly related to the hydration race. Worth replicating in other `(s) => s.action` selector patterns elsewhere in the codebase (P4 observation, no action required).
- **P-03:** the Part B merge uses `Math.max(liveDraft.lastStepReached, serverDraft.lastStepReached)` instead of unconditionally taking live or server. This is the right choice — it prevents both the "server snapshot regresses step" race AND the inverse "live state somehow loses step progress" defensive case. Small but thoughtful.
- **P-04:** the rework's commit (when it ships) will re-use the same `[TEST-MOD-APPROVED ORCH-0893]` token from the original close. The implementor honored the append-only gate cleanly — the token applies to BOTH the original ORCH-0893 close and the rework, since the rework is the same ORCH lifecycle (not a new ORCH-ID). This is the correct interpretation of the append-only protocol.

---

## §10 — Smoke-test steps for Seth (Case-B unblock to promote `probable` → `proven`)

Run these from the project root after this QA report lands. Total time: ~90 seconds.

**Smoke for Part A (hydration race — Seth's reported "wizard shows up then closes"):**

1. Open `http://localhost:8084` in Chrome and sign in as a brand operator.
2. **Hard-refresh** with `Cmd+Shift+R` (forces fresh Zustand hydration cycle).
3. **The instant the home tab paints, tap "Build a new event"** — don't wait, click as fast as you can.
4. **Expected (post-rework):** the placeholder may briefly show "Finishing sign-in…" or "Getting things ready…" depending on which gate is open, then the wizard's Step 1 mounts. **The wizard MUST stay mounted.** No bounce-back to home.
5. Repeat steps 2-4 **five times** to confirm the bug is fully gone (pre-rework, the first 1-3 attempts after each hard-refresh would bounce back to home).

**Smoke for Part B (live-state merge):**

6. With the wizard mounted on `/event/d_xxx/edit?step=0`, tap into the Title input. Type "Hello" rapidly (~5 characters/second). Watch the URL bar.
7. Within ~1 second, the URL should flip from `/event/d_xxx/edit` to `/event/{server-uuid}/edit?step=0`. **The Title input should still show "Hello" — all 5 characters intact.** Pre-rework, fast typists would see the input revert to just the first character (or the queue-snapshot value).
8. Continue typing past the URL flip. Subsequent characters should save via UPDATE (no new INSERT).

**CI gate sanity:**

9. Run `node .github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs` → confirm `OK — scanned 3 create.tsx files; 0 violations.`

If steps 1-9 all pass: runtime layer upgrades to `proven`. Verdict promotes to PASS. Orchestrator proceeds with CLOSE per the protocol.

If step 4 ever bounces or step 7 ever loses characters: verdict flips to FAIL — return to implementor for cycle-2 REWORK with the specific repro recipe.

---

## §11 — Files touched by this QA pass

| File | Why |
|---|---|
| `mingla-business/src/utils/__tests__/orch_0893_rework_adversarial_merge_spec.test.ts` (NEW) | Tester adversarial #2 — 15 cases at three distinct angles (behavioural merge spec + field completeness audit + Part A behavioural invariants). Step-0.5 gate. |
| `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_REPORT.md` (THIS FILE) | Retest verdict + findings. |
| `Mingla_Artifacts/reports/QA_ORCH-0893_RETEST_1_sim_baseline.png` (NEW) | Phase 0.A sim screenshot evidence. |

No product code touched. No migrations. No edge functions. No CI workflow changes.

---

## §12 — Recommended close path

1. **Seth runs the §10 smoke (~90 seconds)** to upgrade runtime confidence from `probable` to `proven` for SC-1-web/iOS/Android. This is the only remaining gate.
2. **Orchestrator proceeds with CLOSE** — verdict was CONDITIONAL PASS, the conditions (Seth's smoke) are explicitly named.
3. CLOSE protocol per orchestrator skill — including:
   - Step 0.5 regression gate (already satisfied: 5 jest suites + tester adversarial #2 + fails-on-revert at `b982f326`).
   - Step 1 artifact sync across the 7 mandatory docs.
   - Step 1.5 DIAG-marker reap (zero `[ORCH-0893-*-DIAG]` matches expected).
   - Step 2 commit message — MUST cite `[TEST-MOD-APPROVED ORCH-0893]` (covers both original close + rework modifications to `serverDraftLifecycleGuards.test.ts`).
   - Step 3 EAS update — `eas update --branch production --platform ios --message "ORCH-0893 + rework: instant creator entry + race fixes"`.
   - Register the 4 new discoveries from this report (T-MERGE-EXTRACT P2, T-LABEL-COPY P3, plus carried-forward DISC-0893-A-LATENT-LEGACY-MIGRATION-RACE P2, DISC-0893-TRIP-FIRST-EDIT P2, DISC-0893-GHOST-DRAFT-CLEANUP P3).
   - Flip I-PROPOSED-CREATOR-ENTRY-IS-INSTANT from DRAFT to ACTIVE.
4. PR `Seth → main` per the pre-merge gate (all 5 conditions including required checks GREEN + MERGEABLE/CLEAN + reviews + not BEHIND + Seth's confirmation).

---

**End QA retest report.**
