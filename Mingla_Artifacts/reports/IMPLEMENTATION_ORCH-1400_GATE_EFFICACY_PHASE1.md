# IMPLEMENTATION — ORCH-1400 [gate-efficacy-triage] PHASE 1

**Spec (binding, Rev 2):** `Mingla_Artifacts/specs/SPEC_ORCH-1400_GATE_EFFICACY_TRIAGE.md` (branch commit `49642f6b6`, formerly `dfa0e3e39` pre-rebase)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1400_GATE_EFFICACY.md`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1400-[gate-efficacy-triage]` @ `ORCH-1400-gate-efficacy-triage`, rebased onto `origin/main` (`21432dd3e`)
**Commits:** Phase 1a `22562c879` · Phase 1b `aa4df26d2` · registry + report (tip, carries `[TEST-MOD-APPROVED ORCH-1400]`)
**Comms factored:** COMMS-0114 (10-job batched CI; MANIFEST registration hard rule), COMMS-0115 (this ORCH), COMMS-0105 (no `git stash` — none used; `COMMS_LEDGER.md` never staged)
**Verification path:** every runtime proof executed from a bracket-free local clone at `<scratchpad>/orch1400-verify` (board #958 bracket-path artifact honored); worktree used only for edits + commits.

---

## 1. Summary

CI gates can no longer go dark silently. Three new parity rules (P10–P12) close the three structural holes that produced the orch-1369/orch-1385 "dark at CLOSE" recurrences: `fixture` rows are now capped and every dark state must cite its owning ORCH (P10), dirs outside `.github/scripts/strict-grep/` can be swept for totality (P11), and self-tests that exist but never run are a capped shrinking debt (P12). The 13 proven-green frozen gates + the orch-1369 adversarial harness (Part 1 now blocking, Part 2 a recorded non-blocking scope boundary) + the repaired RD-1 suite (T-11 fixed, 12/12) are wired into batch:A — class A grew 539 → 557 executions, all green. The 7 red gates are HELD `unenforced` with ORCH-1400 + discovery citations (`unenforcedCap` 21 → 7). Zero files deleted; zero gate-detector logic touched outside the two explicitly allowlisted files.

**One spec collision found (build decision, flagged loudly):** the spec's `externalGateDirs: ["app-mobile/scripts/ci"]` is IMPOSSIBLE as written — that dir holds **100** `.mjs` gate scripts, only **10** registered; the other **90 are dark** (run only by `app-mobile/package.json` `test:*` scripts no CI workflow invokes — the F-5 illusion at consumer scale, which the investigation did not count). Registering 90 dark files would blow the negotiated caps (7 unenforced / 10 fixture), so P11 shipped fully built and proven both directions with `externalGateDirs: []` (the spec itself defines the list as extendable/append-only). Populating it is blocked on dispositioning the 90 — routed as **D-8** below. Live-fire evidence: listing the dir makes parity fail with **91 P11 violations by name** (§9 PROOF-4).

## 2. SPEC success-criteria coverage

| SC | Status | Evidence / commit |
|---|---|---|
| SC-1 (new dark file fails parity by name, P1/P11) | ✓ P1 half; ✓ P11 mechanism (self-test + live-fire proof); **inert live until externalGateDirs is populated (D-8)** | `22562c879`; §9 PROOF-1 (P1 by name), PROOF-4 (P11 by name, planted file caught), parity self-test "P11: unregistered external-dir file fails by name" |
| SC-2 (fixture laundering fails: cap + citation) | ✓ | `22562c879` + `aa4df26d2`; §9 PROOF-2 (11th fixture → P10 cap), PROOF-3 (citation-less reason → P10 by name). No token path exists (OQ-2 default: hard caps only) |
| SC-3 (`count(unenforced)===7`; HOLD reasons cite ORCH-1400 + D-id; 14 new + RD-1 in batch executed list) | ✓ (one nuance: F-1 row 3 has NO routed D-id in the investigation — its reason cites `INVESTIGATION_ORCH-1400 F-1#3`; see §10) | `aa4df26d2`; §9: parity green at 7/10/23/188; batch A post log shows all 18 new executions ok, 557/557 |
| SC-4 (RD-1 12/12 bracket-free; T-11 fails-on-revert) | ✓ | `aa4df26d2`; §9: `# pass 12 / # fail 0`; T-12 probe: rows removed → `not ok 11`, restored → 12/12 |
| SC-5 (zero deletions; 405 files; 0770/0776a rows + package.json intact; D-4+D-7 in CLOSE note) | ✓ | `expectedStrictGrepMjsFiles === 405` asserted by live parity PASS; all 17 dark files verified on disk; `mingla-business/package.json` NOT in the closing diff (both `test:orch-0770`/`test:orch-0776a` rows present); D-4 + D-7 CLOSE-note obligation recorded in §12 for the orchestrator |
| SC-6/SC-7 (Phase-2+ per-gate contract; floor strictly rises per wave) | Phase 1 portion ✓: floor 185 → 188 == `count(selfTest:"wired")` (derived, not hand-typed) | `aa4df26d2` |
| SC-8 (vacuity guard) | N/A Phase 1 (Phase 2+ backfill contract) | — |

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `.github/scripts/strict-grep/MANIFEST.json` | ~+80/−40 lines across 2 commits | 3 new top-level fields; 13+2 rows wired; 7 HOLD reasons rewritten; 10 fixture reasons ORCH-1400-cited; caps 21→7 / 11→10 / 27→23; floor 185→188; `$comment` modes-count line derived (2/229/186) |
| `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs` | +~150 | P10/P11/P12 rules; `walkMjsUnder` helper; `externalDiskFiles` injection; 14 new self-test cases (30/30); header doc |
| `.github/scripts/strict-grep/orch-1369-release-submit-config.adversarial.mjs` | ±~20 | exit mapping: holes → exit 0 recorded-gap (was exit 2); header EXIT CODES rewritten; wired-into-CI header note |
| `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs` | ±~60 | T-11: dead per-gate-job assertions → MANIFEST-row assertions (base gate batch:A plain+self-test wired; suite batch:A node --test); same four path-filter assertions kept; header ANGLE-G note; one comment reword to drop a stray `--self-test` literal (P6 honesty) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +6 | I-RELEASE-SUBMIT-CONFIG: the 3-gap list verbatim as a recorded scope boundary (non-blocking per OQ-1 default) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1400_GATE_EFFICACY_PHASE1.md` | new | this report |

`run-batch.mjs` needed **zero** changes: its expected sets derive from MANIFEST (P5 keeps both views welded), so the wiring is pure MANIFEST data. The 13 wire-now gate scripts: **zero edits**, as the spec demands.

## 4. Data-model changes applied

None. CI-only ORCH; no migrations, no schema, no RLS.

## 5. Edge functions touched

None. (SPOT-3's temporary mutation of `_shared/partnerSplits.ts` happened only in the throwaway verification clone and was restored; the branch never touched it.)

## 6. Regression tests added

- **Happy-path + both-direction regression tests: the 14 new parity self-test cases** in `meta-1383-manifest-parity.mjs` (real repo path; wired in CI — the parity gate's MANIFEST row is `batch:B`, modes `["self-test","plain"]`, so every PR runs them). 30/30 PASS.
- **RD-1 re-wired as a CI test:** `orch-1385-workspace-deps-declared.adversarial.test.mjs` → batch:A `node --test`, 12/12.
- **fails-on-revert verified at `aa4df26d2`** by TRUE LINE DELETION, three times (§9): deleting the P10 block → self-test FAILS 4 cases; P11 block → FAILS 5 cases; P12 block → FAILS 2 cases; each restored → 30/30. RD-1's T-11 fails-on-revert: removing the orch-1385 MANIFEST rows → `not ok 11`; restored → 12/12.
- Append-only: no test file deleted; the single test-file modification (T-11) carries `[TEST-MOD-APPROVED ORCH-1400]`; checker run locally vs `origin/main`: `1 passed, 0 failed` with token honored. MANIFEST ratchet replica vs `origin/main`: 0 entries removed, floor RAISED, cap LOWERED → PASS (no `GATE-REMOVAL:` token needed).

## 7. Old → New receipts

### MANIFEST.json
**Before:** 21 `unenforced` + 11 `fixture` rows with generic ORCH-1383 freeze reasons; no cap on fixtures or capable-unwired; nothing swept outside the strict-grep dir; floor 185.
**Now:** 384 batch:A gates (`+15` rows / `+18` executions); 7 `unenforced` (each reason names ORCH-1400 + its routed discovery, 0770/0776a carry the deletion-prohibited wording); 10 `fixture` (all ORCH-cited); `fixtureCap: 10`, `capableUnwiredCap: 23`, `externalGateDirs: []`, `unenforcedCap: 7`, `selfTestWiredFloor: 188` — every number derived from the registry at write time, never hand-typed.
**Why:** SPEC §4.1.a/§4.1.c. **Lines:** ~120.

### meta-1383-manifest-parity.mjs
**Before:** P1–P9 + P-vacuous; `fixture` uncapped and reason-free (H1); only `SG_REL` swept (H2); `capable-unwired` legal forever (H3).
**Now:** P10 (cap + mandatory ORCH citation on every fixture/unenforced reason, missing-field = fail), P11 (extendable external-dir totality, missing/empty dir = fail — never a vacuous green), P12 (capable-unwired cap, missing-field = fail); each proven both directions in the wired self-test.
**Why:** SPEC §4.1.b; INVESTIGATION F-2. **Lines:** ~150.

### orch-1369-release-submit-config.adversarial.mjs
**Before:** dark since its own SHIP commit `e489715ab`; exit 2 on the 3 recorded coverage gaps made it unwireable.
**Now:** wired batch:A; Part 1 strictness regressions still exit 1 (PR-blocking); the 3 gaps print on every run and exit 0 as a recorded scope boundary mirrored verbatim in `INVARIANT_REGISTRY.md` under I-RELEASE-SUBMIT-CONFIG (OQ-1 default: no base-gate widening).
**Why:** SPEC §4.1.c WIRE-special. **Lines:** ~20.

### orch-1385-workspace-deps-declared.adversarial.test.mjs (RD-1)
**Before:** `fixture` (dark) since CLOSE commit `1d1565893`; T-11 red — asserted the pre-batch per-gate job format ORCH-1383 legitimately removed (dark AND stale).
**Now:** batch:A `node --test`, 12/12; T-11 asserts the MANIFEST rows run-batch actually executes + the same four workflow path filters; de-registration reds T-11 (proven).
**Why:** SPEC §4.1.c WIRE RD-1. **Lines:** ~60.

## 8. Cross-surface impact

CI-only. All 5 primary + 2 adjacent product surfaces (Consumer iOS/Android, Buyer Web, Business iOS/Android, Admin Web, Business Web preview): **unaffected — zero runtime code changed**; single CI codepath, parity automatic. The 7 HOLD gates point INTO product surfaces; those go to the orchestrator as discoveries (D-1…D-5, D-7 already routed by the investigation; D-8 new, below), not absorbed here.

## 9. Smoke / proof battery (all from the bracket-free clone; full outputs in session log, key lines verbatim)

**Green path:**
- Parity real run: `META-1383 manifest parity: 405 on-disk .mjs, 436 manifest entries.` → `PASS (P1–P12 + P-vacuous)` (exit 0), pre-1b and post-1b.
- Parity self-test: `30/30 PASS` (16 inherited + 14 new).
- Batch A baseline `539/539` → post-1b `expected: 557 / executed: 557 / passed: 557 / failed: 0 / missing: 0`, exit 0 — R4 `executed === expected` holds; all 18 new executions individually `ok`.
- Differential vs origin/main manifest: class A +18/−0 (exactly the 13 gates incl. 3 self-test modes + 1369-adv + RD-1); classes B/C/D/E identical (10/1/2/3, +0/−0). Nothing went dark.
- RD-1: `# pass 12 / # fail 0` (was 11/12 with T-11 red at baseline — captured pre-fix).
- 1369 harness: 5× Part-1 `PASS`, 3× `HOLE` printed, `harness exit=0` (baseline was exit 2).
- 13 wire-now gates: all `plain exit=0`; rows 1/17/18 `self-test exit=0` (pre-wiring baseline AND inside the post-1b batch).
- Append-only checker vs origin/main: `1 passed, 0 failed` (token honored); MANIFEST ratchet replica: `RATCHET: PASS`.

**Red path (every rule/wire proven to fire):**
- PROOF-1 (T-1): planted `zzz-orch1400-proof.mjs` in strict-grep dir → `P1: "...zzz-orch1400-proof.mjs" is on disk but ABSENT...` exit 1; removed → PASS.
- PROOF-2 (T-3): 11th fixture row, no cap raise → `P10: 11 gates are "fixture", above the cap 10...` exit 1.
- PROOF-3 (T-4): citation stripped from orch-0769 reason → `P10: "...orch-0769-app-wide-currency.mjs" ... reason lacks an ORCH citation` exit 1.
- PROOF-4 (T-2 + D-8 evidence): `externalGateDirs=["app-mobile/scripts/ci"]` + planted file → `FAILED — 91 violation(s)`, every dark file named incl. the planted `zzz-orch1400-proof.mjs`; exit 1.
- PROOF-5: 24th capable-unwired → `P12: 24 ... above the cap 23` exit 1.
- PROOF-6: un-wiring a wired self-test → `P7: ... 187 is BELOW the floor 188` + P12, exit 1. (Spec T-10 nuance: LOWERING the floor value itself is caught by the `tests-append-only` ratchet, not P7 — see §10.)
- T-12: orch-1385 MANIFEST rows deleted → RD-1 `not ok 11 ... 'ORCH-1385 gate row missing from MANIFEST.json'`; restored → 12/12.
- T-13: base gate's `else if (status !== "completed")` arm deleted (true deletion) → harness `REGRESSED` A/B/C, `harness real exit=1`; restored → exit 0. T-14 = the green-path harness run above.
- Rule-revert (fails-on-revert): P10 block deleted → self-test `FAILED: 4 of 30`; P11 → `5 of 30`; P12 → `2 of 30`; restored → 30/30.
- **Spot-prove (3 of 13, as required — orch-0891-no-tiptap, orch-1148-no-buyer-tax-form, orch-1054-partner-splits):**
  - `orch-0891-no-tiptap-in-native-bundle`: `@tiptap/core` import planted in a non-`.web` file → `found 1 violation(s)` exit 1; removed → 0.
  - `orch-1148-no-buyer-tax-form-in-venue-settings`: `"Calculate tax"` planted in a live venue component → exit 1 naming the file; restored → 0.
  - `orch-1054-partner-splits`: idempotency-key token `partner_split_${applicationFeeId}` removed from `_shared/partnerSplits.ts` → `FAIL ... missing required tokens` exit 1; restored → 0. (First attempt renamed the `Idempotency-Key` HTTP-header literal instead — gate stayed green: the detector binds the key-template token, not the header name. Recorded as a target-binding datum, F-3 class.)

## 10. Known issues / deferred / spec deviations (all flagged, none silent)

1. **SPEC DEFECT (blocking for SC-1's live half): `externalGateDirs: ["app-mobile/scripts/ci"]` is impossible as written.** 100 on-disk `.mjs`, 10 registered, 90 dark → listing the dir fails parity with 91 violations while `unenforcedCap 7` + `fixtureCap 10` make registration impossible without breaking the Rev-2 numbers. Shipped `externalGateDirs: []` with the P11 machinery fully proven; populating the list = append-only data change once D-8 is dispositioned. The spec's own T-2 will not fire live until then (it fires the moment the dir is listed — proven).
2. **F-1 row 3 has no routed discovery ID** (`i-proposed-tr2-route-by-event-type` — detector-vs-intent mismatch was never assigned a D-number). Its HOLD reason cites `ORCH-1400` + `INVESTIGATION_ORCH-1400 F-1#3`. SC-3's "names a D-id" is satisfiable for the other 6 only; orchestrator should assign an ID at intake.
3. **Spec T-11 says "the six dirs" in the workflow paths filter — the suite asserts four** (`mingla-business/**`, `app-mobile/**`, `packages/**`, `.github/scripts/strict-grep/**`), which is what the pre-existing test asserted and what is load-bearing for orch-1385. No dir assertion was deleted; none of the filter's 11 entries maps to "six". Kept the four; flagging the count as a spec typo.
4. **Spec F-1 row 1 note "(also wire its self-test + companion `.test.mjs` fixture)" contradicts §4.1.a's binding `fixtureCap: 10` (= 11 − RD-1 only).** Followed the binding number: the companion `i-proposed-pay-in-full-opt-out-no-installment-rows.test.mjs` stays `fixture` (ORCH-1400-cited). Wiring it is a later-phase one-row change.
5. **Spec T-10 ("lower selfTestWiredFloor → parity FAIL (P7)") is mechanically inexact:** P7 fires when the WIRED COUNT drops below the floor (proven, PROOF-6); lowering the floor VALUE is caught by the separate `tests-append-only` MANIFEST ratchet (replicated: PASS on our raise; it hard-fails a lowering without `GATE-REMOVAL:`). Both directions of protection exist; the spec attributes one to the wrong guard.
6. **Pre-existing doc drift fixed in passing:** MANIFEST `$comment` said "182 run both" while main's true count was 183; the line is now derived (2 self-test-only / 229 plain-only / 186 both).
7. `.github/scripts/strict-grep/README.md` documents the gate states but is NOT in the §10 allowlist — it now lags the new P10–P12/cap schema. One-paragraph doc follow-up for a later phase.

## 11. Operator action required

None for Phase 1 runtime: no migration, no edge deploy, no OTA. The PR (fresh event per COMMS-0109) and merge belong to the orchestrator at CLOSE; the tip commit carries `[TEST-MOD-APPROVED ORCH-1400]` for the T-11 modification and must remain the PR head (the append-only checker reads the PR head commit body). At CLOSE, the Seth-visible note MUST list D-4 + D-7 (0770/0776a rewrite obligation + Cloudinary residue) per SC-5, plus D-8 below.

## 12. Discoveries for Orchestrator

- **D-8 (NEW, measured): 90 dark consumer gate scripts in `app-mobile/scripts/ci/`** — real gates with exit contracts, invoked only by `app-mobile/package.json` `test:*` npm scripts no CI workflow runs (the F-5 package.json illusion at ~9× the scale of the 21 this ORCH triaged; the investigation's H2 named the dir but never counted it). They need their own triage/disposition ORCH (or an ORCH-1400 phase); until then `externalGateDirs` stays `[]` and P11 protects nothing live. Evidence: PROOF-4 (91 violations by name); registered/on-disk split verified programmatically.
- **Deviations 2–5 in §10** need spec-side acknowledgment (row-3 D-id assignment; T-11 "six dirs" typo; row-1 companion-fixture contradiction; T-10 guard attribution).
- **SPOT-3 target-binding datum:** orch-1054's header claims it checks "Idempotency-Key partner_split_<application_fee_id>" but binds only the key-template token — the header-vs-detector gap is exactly the F-3 binding class Phase 2's per-gate contract will surface gate-by-gate.
- Already routed by the investigation, restated for the CLOSE note: D-1 (19 SafeArea routes), D-2 (brand-create default-brand signature), D-3a/D-3b (GBP hardcode + consumer coverage gap), D-4 (TUS/Bunny rewrite for 0770/0776a), D-5 (curated card payload), D-7 (Cloudinary residue).
