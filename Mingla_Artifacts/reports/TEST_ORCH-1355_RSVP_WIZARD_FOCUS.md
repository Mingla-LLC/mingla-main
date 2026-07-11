# TEST — ORCH-1355 [RSVP create-wizard focus / toggle-snap-back]

- **Worktree:** `~/Desktop/mingla-orchs/orch-1355-[rsvp-wizard-focus-bug]/` on `orch-1355-rsvp-wizard-focus-bug`, HEAD `c4a50bc81` (no rebase).
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1355_RSVP_WIZARD_FOCUS_FIX.md` (§ all + §12).
- **Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1355_RSVP_WIZARD_FOCUS.md`.
- **Mode:** TARGETED, adversarial. Assumed broken until proven.

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 0 · P4: 2.

Both fixed symptoms verified at the JS/runtime level and adversarially hardened at angles distinct from the implementor's. Zero P0, zero unaccepted P1. The single condition is **symptom-1's native on-device keyboard eyeball (iOS TestFlight), which is PENDING Seth** — the dispatch explicitly pre-accepts this deferral ("mark symptom-1's device leg as PENDING Seth; your JS-level verdict stands on the router-mock + your adversarial suites"). Symptom 2 has no device dependency for its logic and is fully runtime-verified.

Regression gate SATISFIED for BOTH symptoms: implementor happy-path suites (render 7/7 + promotion 2/2) AND tester adversarial suites (7/7), all on-branch and in the closing diff, all fails-on-revert proven by true product-file reversion.

---

## 2. SC-by-SC matrix

| SC | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| SC-1 | Capacity ON→OFF stays OFF (`rsvpCapacity===null`), no snap-back after echo | Tester burst test: coalesced autosave `rsvpCapacity=null`; real `upsertServerDraft` echo → `getDraft().rsvpCapacity` stays null. Implementor render tests 1–2. | PASS |
| SC-2 | Autosave payload after ON→OFF carries `rsvpCapacity===null` | Tester burst payload assertion + implementor C-1-isolation. | PASS |
| SC-3 | Capacity OFF also persists `rsvpWaitlistEnabled===false` in ONE write | Tester C-2 call-count: OFF tap = exactly 1 call `{rsvpCapacity:null, rsvpWaitlistEnabled:false}`. | PASS |
| SC-4 | "Private" persists `visibility` + `rsvpDiscoverable=false` in one write; autosave carries both | Tester C-3 call-count: exactly 1 call `{visibility:"private", rsvpDiscoverable:false}`; burst payload carries both. | PASS |
| SC-5 | Single-write toggles + typing still autosave; `clientRevision` monotonic; `lastStepReached` unaffected | Tester burst monotonicity-under-burst (payload rev == store rev, ≥ +4); implementor control + revision tests. | PASS |
| SC-6 | Symptom-1 name keyboard stays up on device | JS-level: router-mock (implementor 2/2) + tester adversarial (mount=1, key k0→k0, no `router.replace`, URL reconciled, hostile keystroke survives). **Native iOS eyeball PENDING Seth TestFlight.** | PASS (JS) / PENDING (device) |
| §12.4 | Promotion no-remount, URL reconciled in place | Tester: `replaceCalls=[]`, `nav.state.key` unchanged, `setParams=[{id:srv,step:"0"}]`, `paramId=srv` — BOTH routes. | PASS |
| §12 resume | Resume/deep-link at server id resolves without promotion | Tester deep-link cold-open: mount=1, resolves server draft, `createServerDraft=0`, no replace/setParams; later edit → `autosave.saveDraft` path, no remount. | PASS |

---

## 3. Findings

### P2-1 — Implementor render suite does NOT independently guard product C-2/C-3 at the payload level (structural, disclosed)
- **Evidence:** Reverting ONLY `RsvpStep5Setup.tsx` (C-2/C-3) to `origin/main` while leaving the render harness intact → `jest.orch1355.render.cjs` stays **7/7 PASS** (verified). The render suite's fails-on-revert depends on reverting the *harness copy* of `handleUpdate` (a test file), not the shipped product. The implementor disclosed this defense-in-depth in the implementation report (Vector A/B).
- **Impact:** Low — the shipped C-1 (`RsvpCreatorWizard.handleUpdate`) is guarded by the `orch-1355-wizard-update-callback-stable` strict-grep gate (self-test 4/4, all three revert shapes caught) and C-2/C-3 by `orch-1355-toggle-single-patch`. The gap is closed at runtime by this tester's adversarial call-count tests, which DO fail on the real product C-2/C-3 revert (proven: "Received: 2").
- **Required fix:** None blocking. The tester adversarial suite + strict-grep gates cover it.
- **Retest:** `git checkout origin/main -- src/components/rsvp/RsvpStep5Setup.tsx` → `jest.orch1355.tester.cjs` tests 1–2 FAIL.

### P4-1 (praise) — Hostile mid-promotion keystroke is correctly preserved
The ORCH-0893 race-guard (re-read live draft at promotion resolve) is intact: typing "S"→"Se" while the promotion is in flight preserves "Se" on the server draft AND does not remount (tester RSVP adversarial: `serverName=Se`, `resolvedName=Se`, `mounts=1`).

### P4-2 (praise) — `router.setParams` choice reconciles the URL immediately
The `setParams` approach (vs a deferred `router.replace`) makes resume/kill trivially correct — the route params land on the server id in place (`paramId=srv`), so a cold relaunch resolves the real draft with no promotion churn (deep-link test).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proofs

Ran against true product-file reversion to `origin/main` (not comment-out), restored after each.

- **Symptom 1 (`325ffb3e9` claim):** revert `app/rsvp/[id]/edit.tsx` + `app/event/[id]/edit.tsx` → `origin/main` (eager `router.replace`), ran `jest.orch1355.promotion.cjs`:
  - RSVP: `wizardMounts=2 router.replace=["/rsvp/srv_ORCH1355/edit?step=0"]` → `expect(replacedToServer).toBe(false)` FAIL (Received: true). ✅ reproduces implementor's proof.
  - EVENT: `wizardMounts=2 router.replace=["/event/srv_ORCH1355/edit?step=0"]` → FAIL. ✅
  - Restored → 2/2 PASS.
- **Symptom 2 (`ac217d21e` claim):** revert ONLY `RsvpStep5Setup.tsx` (C-2/C-3) → `jest.orch1355.render.cjs` stays **7/7 PASS** — confirming the implementor's disclosed defense-in-depth (render-suite C-1 guard is harness-mirror-dependent). The genuine product-level C-2/C-3 fails-on-revert is carried by this tester's adversarial (§5).

---

## 5. Adversarial tests added (different angle, on-branch, in-diff, fails-on-revert)

Config: `mingla-business/jest.orch1355.tester.cjs` (NEW). Run: `npx jest --config jest.orch1355.tester.cjs --runInBand` → **4 suites, 7 tests PASS**.

### Symptom 2 — `src/components/rsvp/__tests__/RsvpWizardToggleBurst.orch1355.tester.test.tsx` (4 tests)
- **Angle (vs implementor's discrete per-tap flush):** (1) SINGLE-PATCH CALL-COUNT on the REAL `RsvpStep5Setup` — OFF tap = exactly 1 `updateDraft` call with both fields; Private pick = exactly 1 call with both fields. (2) DEBOUNCE-COALESCED BURST — ON→OFF→Private inside ONE 700ms window coalesces to ONE autosave carrying the OFF state, and the real `upsertServerDraft` echo does NOT snap back. (3) RAPID ON/OFF/ON/OFF within one window lands OFF with the payload carrying the LATEST (highest) `clientRevision` (monotonicity under burst).
- **Fails-on-revert (PRODUCT):** `git checkout origin/main -- RsvpStep5Setup.tsx` (two-write C-2/C-3) → tests 1 & 2 FAIL: `expect(spy).toHaveBeenCalledTimes(1)` → **Received: 2** (lines 192, 224). Restored → 4/4. `fails-on-revert verified at c4a50bc81`.

### Symptom 1 — `src/components/rsvp/__tests__/RsvpPromotionAdversarial.orch1355.tester.test.tsx` (RSVP route, 1 mount)
- **Angle (vs implementor "no replace to server id"):** stricter — `replaceCalls === []` (no replace AT ALL) + navigator ROUTE KEY unchanged (k0→k0) + mount stays 1 + URL/params reconciled to server id (resume-after-kill) + HOSTILE mid-promotion keystroke ("S"→"Se") survives the merge.
- **Fails-on-revert (PRODUCT):** revert route → `wizardMounts=2 keyAfter=k1 replace=["/rsvp/srv_ORCH1355/edit?step=0"]` → FAIL. `fails-on-revert verified at c4a50bc81`.

### Symptom 1 — `src/components/event/__tests__/EventPromotionAdversarial.orch1355.tester.test.tsx` (EVENT route, 1 mount)
- **Angle:** same stricter assertions on the EVENT route (create-flow-wide parity — the mandate's "for BOTH routes").
- **Fails-on-revert (PRODUCT):** revert route → `wizardMounts=2 keyAfter=k1 replace=["/event/srv_ORCH1355/edit?step=0"]` → FAIL. `fails-on-revert verified at c4a50bc81`.

### Symptom 1 — `src/components/rsvp/__tests__/RsvpDeepLinkColdOpen.orch1355.tester.test.tsx` (RSVP, server-id cold open)
- **Angle:** DEEP-LINK / RESUME cold open at `/rsvp/<serverId>/edit` — `promotedServerId` null → `effectiveDraftId=idParam=serverId` resolves; mount=1, no `createServerDraft`, no replace/setParams; a later edit autosaves via the server path (`autosave.saveDraft`) with no remount. POSITIVE/regression guard (proves the fix didn't break deep-linking/resume); not a fails-on-revert vector by design.

Both symptoms' implementor happy-path tests AND tester adversarial tests appear in `git diff origin/main...HEAD --name-only` for the closing PR.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Toggle/pick fire real store writes + autosave (runtime). |
| 2 | One owner per truth | PASS | `draftEventStore.updateDraft` is the single writer; C-1 fresh-read removes the competing stale-closure writer. |
| 3 | No silent failures | PASS | Promotion `.catch` surfaces a toast; no swallowed errors introduced. |
| 4 | One query key per entity | PASS | `eventDraftKeys.detail` unchanged. |
| 5 | Server state server-side | PASS | Zustand holds draft (client working copy); no server cache moved into Zustand by this change. |
| 6 | Logout clears everything | N/A | Not touched. |
| 7 | Label `[TRANSITIONAL]` | N/A | None introduced. |
| 8 | Subtract before adding | PASS | C-2/C-3 collapse two writes → one; `router.replace` removed, not stacked. |
| 9 | No fabricated data | PASS | No defaults invented; OFF = `null`. |
| 10 | Currency-aware | N/A | `brandDefaultCurrency` prop preserved; no currency logic changed. |
| 11 | One auth instance | PASS | Routes read `useAuth` once; unchanged. |
| 12 | Validate at the right time | PASS | `isDraftDirty`/`isAuthReady` guards preserved in promotion. |
| 13 | Exclusion consistency | PASS | Private forces `rsvpDiscoverable:false` in one write (C-3). |
| 14 | Persisted-state startup | PASS | `promotedServerId` starts null; deep-link/resume resolves via `idParam` — hydration path intact (deep-link test). |

---

## 7. Device / parity matrix

| Surface | Ships? | Result |
|---------|--------|--------|
| Consumer iOS / Android / Buyer web | No | N/A — no RSVP/event creator there. |
| **Business iOS** | Yes | Symptom 2: runtime-verified (real component + store + echo). Symptom 1: JS/navigator-verified (router-mock + adversarial). **Native keyboard eyeball PENDING Seth TestFlight.** |
| **Business Android** | Yes | Shared RN → parity automatic; same JS proof. Native eyeball PENDING Seth. |
| **Business Web preview** | Yes | Shared RN; symptom-2 toggle logic identical. |
| Admin Web | No | N/A. |

**Physical-device / native-keyboard leg (symptom 1):** BLOCKED on business-auth credentials (login-gated; not available to this sub-agent). Two iOS sims are booted but no Metro is running and the authed business RSVP/event create wizard is unreachable without business login. **PENDING Seth's TestFlight verification** — dispatch pre-accepts this. Unblock ask: Seth types the first character of the event name in the business RSVP create wizard (and the event create wizard) on TestFlight and confirms the keyboard STAYS UP after the ~700ms autosave/promotion.

**Symptom-2 files touched-only-by-5d7c8320b:** CONFIRMED — `git log origin/main..HEAD -- RsvpStep5Setup.tsx` and `-- RsvpCreatorWizard.tsx` each return ONLY `5d7c8320b`; neither `325ffb3e9` nor `c4a50bc81` touched them.

---

## 8. Pre-existing reds (D-6) — base==fix re-confirmed

Re-verified independence on `serverDraftLifecycleGuards.test.ts`:
- Fix state (`c4a50bc81`): **5 failed / 16 passed / 21 total**.
- After `git checkout origin/main -- app/rsvp/[id]/edit.tsx app/event/[id]/edit.tsx` (ORCH-1355 route changes reverted): **5 failed / 16 passed / 21 total — IDENTICAL.**
- **Conclusion:** the 5 failures are pre-existing and independent of ORCH-1355 (stale route-source-grep assertions: `router.replace("/(tabs)/events"` etc., superseded by `safeEventsExitRoute()`). ORCH-1355 introduced NO new red. The other two D-6 suites (`orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` 1 fail, `orch_0893_cycle2_adversarial_safety_belt.test.ts` TS2322) are likewise pre-existing and NOT attributable to ORCH-1355. Recommend a follow-on ORCH to refresh these stale guards.

---

## 9. Suite counts (final)

| Suite | Result |
|-------|--------|
| `jest.orch1355.render.cjs` (implementor, symptom 2) | 2 suites / **7 tests PASS** |
| `jest.orch1355.promotion.cjs` (implementor, symptom 1) | 2 suites / **2 tests PASS** |
| `jest.orch1355.tester.cjs` (tester adversarial) | 4 suites / **7 tests PASS** |
| `orch-1355-wizard-update-callback-stable.mjs` | self-test PASS (4/4) + live PASS |
| `orch-1355-toggle-single-patch.mjs` | self-test PASS (3/3) + live PASS |
| `orch-1355-draft-promotion-no-remount.mjs` | self-test PASS (4/4) + live PASS |
| `tsc --noEmit` (business) | 790 baseline errors; **0 in the 4 touched product files** (`RsvpCreatorWizard.tsx`, `RsvpStep5Setup.tsx`, `app/rsvp/[id]/edit.tsx`, `app/event/[id]/edit.tsx`). New tester test files carry only the shared `TS2307 @testing-library/react-native` overlay-baseline noise (identical to all render/promotion tests; not a regression). |

---

## 10. Discoveries for Orchestrator

- **D-1 / OQ-2 (event wizard C-1 portability):** `EventCreatorWizard.tsx` carries the byte-identical unstable `handleUpdate` (captured `liveDraft` + `liveDraft` in deps). NOT fixed here (out of scope). Follow-on ORCH recommended.
- **D-6 (stale route-source guards):** `serverDraftLifecycleGuards.test.ts` (5), `orch_0893_cycle2_legacy_loop_skips_untouched.test.ts` (1), `orch_0893_cycle2_adversarial_safety_belt.test.ts` (TS2322) are pre-existing red on `main`. Follow-on ORCH to refresh (append-only / `[TEST-MOD-APPROVED]`).
- **P2-1 (this report):** the render suite's C-1 fails-on-revert is harness-mirror-dependent; the tester adversarial + strict-grep gate close the product-level gap. No action needed unless the follow-on ORCH wants a product-mounted C-1 guard.

---

## 11. Accepted conditions (CONDITIONAL PASS)

- **Symptom-1 native keyboard eyeball (business iOS + Android, TestFlight)** — accepted-deferred to Seth per the dispatch ("mark symptom-1's device leg as PENDING Seth; your JS-level verdict stands"). SPEC §12.6 designates this as the App-Store-blocking sim/device gate. JS-level fix is proven + adversarially hardened; the residual is the native keyboard visual only.
