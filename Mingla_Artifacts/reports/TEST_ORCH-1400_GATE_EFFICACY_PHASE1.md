# TEST — ORCH-1400 [gate-efficacy-triage] PHASE 1 — QA REPORT

**Verdict: PASS** — P0: 0 · P1: 1 (F-1, REMEDIATED on-branch by the tester adversarial test in this QA commit — no unaccepted P1 open at tip) · P2: 2 · P3: 1 · P4: 1
**Tested tree:** branch `ORCH-1400-gate-efficacy-triage` @ `b92e1355d` (implementor tip; carries `[TEST-MOD-APPROVED ORCH-1400]`), verified from a bracket-free detached worktree (board #958 honored). QA additions land in the commit carrying this report; the token is restated there with the same justification.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1400_GATE_EFFICACY_TRIAGE.md` · **Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1400_GATE_EFFICACY_PHASE1.md`
**Phase 0.A:** EXEMPT — CI/build-config only, zero UI/runtime surface (spec §3 declares all 7 product surfaces NOT covered; independently confirmed: closing diff touches only `.github/scripts/strict-grep/**` + `Mingla_Artifacts/**`).
**Environment:** scratch worktree at a bracket-free path; CI deps (`@babel/parser @babel/traverse madge typescript@~5.9.2 yaml`) installed exactly as `strict-grep-mingla-business.yml:459` installs them; every exit code read directly (`node …; echo $?`), never from a pipeline.

---

## 1. Attack-table results (spec §7 T-1…T-14 + dispatch items)

| Test | Probe (all mutations restored after; restore re-proven green) | Result | Evidence |
|---|---|---|---|
| T-1 | Planted unregistered `qa-t1-dark.mjs` in strict-grep dir | **PASS** — parity exit 1, `P1: "...qa-t1-dark.mjs" is on disk but ABSENT`; removed → exit 0 | own run |
| T-2 | Live half CANNOT fire (`externalGateDirs: []`, spec defect D-8 — accepted deviation). MECHANISM proven: listed `app-mobile/scripts/ci` + planted `qa-t2-dark.mjs` | **PASS (mechanism)** — parity exit 1, **exactly 91 P11 violations by name** incl. the planted file; restored → exit 0. Independently corroborates D-8 (100 on-disk, 10 registered, 90 dark — `ls | wc -l` = 100 re-derived) | own run |
| T-3 | Flipped a batch:A row to an 11th `fixture` (ORCH-cited reason, no cap raise) | **PASS** — exit 1, `P10: 11 gates are "fixture", above the cap 10` | own run |
| T-4 | Stripped the ORCH citation from a fixture reason | **PASS** — exit 1, `P10: "...i-1272-identity-admin-read.test.mjs" is fixture but its reason lacks an ORCH citation` | own run |
| T-5 | Clean-tree happy path | **PASS** — parity `PASS (P1–P12 + P-vacuous)` exit 0; self-test 30/30; batch A `expected 557 / executed 557 / passed 557 / failed 0 / missing 0` exit 0; **all 18 new executions found by name in MY batch log** (13 plain + 3 self-test + 1369-adv + RD-1) | own run |
| T-6 | The 3 flipped `capable-unwired → wired` gates' self-tests | **PASS** — pay-in-full / orch-1054 / orch-1148 `--self-test` each exit 0 standalone AND inside batch | own run |
| T-7/T-8/T-9 | Phase-2+ per-gate backfill contract | **N/A Phase 1** (spec §4.2; SC-8 explicitly N/A). Analogous bad-direction proof done instead via SPOT-A/B/C below | — |
| T-10 | (a) un-wired a wired self-test → `P7: count 187 BELOW floor 188` + P12, exit 1. (b) lowered the floor VALUE 188→185 → parity exit 0 AND ratchet exit 0 — **see F-2** | **PASS (a) / finding (b)** | own run |
| T-11 | No-deletion + HOLD citations | **PASS** — independent `find` = 405 on-disk `.mjs`; `count(unenforced) === 7`; all 7 reasons cite ORCH-1400; D-ids: D-1, D-2, D-3a+D-3b, D-4+D-7 (×2, both with deletion-prohibited wording), D-5; row 3 cites `INVESTIGATION_ORCH-1400 F-1#3` (no D-id exists — pre-documented impl deviation 2, orchestrator to assign at intake) | own run |
| T-12 | Removed all 3 `orch-1385` MANIFEST rows | **PASS** — RD-1 `not ok 11 — T-11 angle G`, `# pass 11 / # fail 1`, exit 1; restored → 12/12 exit 0 | own run |
| T-13 | **Independent angle** (implementor deleted the `!== "completed"` arm; I did NOT repeat that): weakened the base gate's exact-equality to `String(status).trim().toLowerCase() !== "completed"` — a realistic "helpful normalization" refactor | **PASS** — harness caught it: `REGRESSED B 'Completed' → gate exit 0`, `REGRESSED C ' completed '`, harness exit 1 (blocking); restored → exit 0 | own run |
| T-14 | Current tree | **PASS** — harness exit 0, 5× Part-1 PASS, 3× HOLE printed. The 3 gap lines in `INVARIANT_REGISTRY.md` I-RELEASE-SUBMIT-CONFIG are **character-identical** to live harness output | own run |

## 2. SC-by-SC matrix

| SC | Verdict | Independent evidence |
|---|---|---|
| SC-1 | **PASS** (P1 half live; P11 half mechanism-proven, live-inert until D-8 dispositioned — documented spec defect, accepted in dispatch) | T-1 + T-2 above |
| SC-2 | **PASS at QA tip** — cap fires (T-3), citation fires (T-4). CAVEAT: at `b92e1355d` the "visible token path" for raising `fixtureCap` did not exist ANYWHERE (F-1); the tester test in this commit creates it | T-3, T-4, F-1 |
| SC-3 | **PASS** — 7 unenforced == cap 7; citations verified per-row; 18/18 new executions in my own batch log | T-5, T-11 |
| SC-4 | **PASS** — RD-1 12/12 from bracket-free path; fails-on-deregistration proven (`not ok 11`) | T-12 |
| SC-5 | **PASS** — 405 files (independent find); `orch-0770`/`orch-0776a` gate files **0-byte diff vs origin/main**; zero `package.json` files in the closing diff; both `test:orch-0770`/`test:orch-0776a` rows present; all 17 dark files on disk; D-4+D-7 CLOSE-note obligation restated below | item-7 sweep |
| SC-6 | Phase-1 portion **PASS** — 13 wire-now gates have zero edits (closing diff lists only the 2 allowlisted script files) | diff --name-only |
| SC-7 | Phase-1 portion **PASS** — floor 188 == count(selfTest:"wired") 188 (re-derived from gates[]); equality now ENFORCED by the tester test (was unenforced — P7 is ≥-only) | ratchet arithmetic + F-1/T-2 of my suite |
| SC-8 | N/A Phase 1 | — |

**Ratchet arithmetic re-derived from the gates array, not the report:** unenforced 21−14=7 == cap · fixture 11−1=10 == cap · capable-unwired 27−(3 wired +1 RD-1→none)=23 == cap · floor 185+3=188 == wired count · executions 539+18=557. Every number matches disk.

## 3. Findings

### F-1 (P1 — REMEDIATED on-branch): raising `fixtureCap`/`capableUnwiredCap` trips NO automated gate
- **Evidence:** hand-edited `fixtureCap` 10→11 (nothing else): parity exit **0**; `tests-append-only` MANIFEST ratchet (extracted verbatim from `tests-append-only.yml:70-118`, run with `BASE_SHA=origin/main`) exit **0**. Same for `capableUnwiredCap` 23→24. The ratchet's only rules are: gates[] shrink, `selfTestWiredFloor` lowering, `unenforcedCap` raising — the two caps ORCH-1400 introduced have **no rule at all**, so this hole is permanent post-merge, not a PR-window artifact.
- **Impact:** the laundering path SC-2 closes (park an 11th dark fixture) reopens with a one-line cap bump that no gate objects to; only human diff review stands in the way. Spec §9's "ratchets guarded by the SEPARATE `tests-append-only.yml`" and OQ-2's premise are false for the new caps. Not fixable inside the impl allowlist (`tests-append-only.yml` is DO-NOT-TOUCH), so this is a spec-level defect, sibling to D-8.
- **Remediation (this commit):** tester adversarial test pins the frontier (below) — a cap raise now fails batch:A, and changing the pin requires `[TEST-MOD-APPROVED]`, restoring the visible token path SC-2 mandates.
- **Residual routing:** orchestrator — amend the ratchet with `fixtureCap`/`capableUnwiredCap` raise rules when `tests-append-only.yml` is next legally touchable (candidate rider on the OQ-2 decision).

### F-2 (P2 — discovery, pre-existing 1383 design): the base-relative ratchet is rollback-blind inside the PR window
- **Evidence:** with main still at floor 185 / unenforcedCap 21, lowering this PR's floor 188→185 → parity 0 AND ratchet 0; raising unenforcedCap 7→8 → ratchet 0 (8 < base 21). Until merge, ALL of Phase 1's ratchet gains can be silently rolled back by a later commit on the same PR.
- **Impact:** an agent amending this PR could undo the caps without any red. Post-merge the window closes (base becomes 7/10/23/188).
- **Mitigation:** the tester test pins the frontier as absolute constants, closing this window for these values. Routed as a discovery (ratchet design), not a Phase-1 defect.

### F-3 (P3): impl report §10.5 overstates the floor guard
"it hard-fails a lowering without GATE-REMOVAL" is only true for lowering BELOW the PR base value (185); rolling back this PR's own raise (188→185) passes (F-2 evidence). One-line report correction; both directions ARE protected once my test lands.

### F-4 (P4 — praise): disposition quality
HOLD reasons are exact and honest (deletion-prohibited wording on 0770/0776a verbatim); RD-1's T-11 repair asserts what CI actually executes; the 1369 exit-mapping keeps Part 1 blocking while recording the gaps verbatim in the registry (character-identical, verified); D-8 was found, measured, and loudly flagged rather than absorbed; zero-deletion honored to the byte.

## 4. Step 0.5 — implementor's fails-on-revert proofs independently re-run (at `b92e1355d`)
- **P10 block TRUE-DELETED** (28 lines): self-test `FAILED: 4 of 30` (the 4 P10 cases) — matches claim. Restored → 30/30.
- **P11 block TRUE-DELETED** (33 lines): `FAILED: 5 of 30` — matches. Restored → 30/30.
- **P12 block TRUE-DELETED** (13 lines): `FAILED: 2 of 30` — matches. Restored → 30/30, plain exit 0.
- **RD-1 T-12** re-run (see table): `not ok 11` on de-registration — matches claim verbatim.
- **Spot-prove NOT repeated** (implementor did 0891-no-tiptap / 1148 / 1054); replaced with three DIFFERENT gates:
  - **SPOT-A `orch-1187-tester-consent-gate-deletion-robust`:** deleted the REAL `opt_out_capturing_by_default: true` line from `mingla-marketing/components/marketing/posthog-provider.tsx` (comment copies left — the original blind-spot) → exit 1 naming the deletion-robust rule; restored → 0.
  - **SPOT-B `orch-0889-sticky-footer-via-hook`:** planted inline `insets.bottom + 96` in `mingla-business/app/(tabs)/marketing/_layout.tsx` → exit 1 with the wide-desktop rationale; restored → 0.
  - **SPOT-C `i-proposed-pay-in-full-opt-out-no-installment-rows`:** removed the `payment_plan_choice: input.paymentPlanChoice` body mapping from `ticketCheckoutService.ts:151` → exit 1 `missing payment_plan_choice body mapping`; restored → 0.
- **All 13 wire-now gates** run standalone in every registered mode: 13× plain exit 0 + 3× self-test exit 0 (16 executions), matching the batch.

## 5. Tester adversarial test (this commit)
- **Path:** `.github/scripts/strict-grep/__tests__/orch-1400-ratchet-frontier.adversarial.test.mjs` — registered batch:A `node --test` (MANIFEST row added; `expectedStrictGrepMjsFiles` 405→406, additive only).
- **Angle (different from all implementor proofs):** pins the ratchet VALUES the rules read — caps may only shrink from the Phase-1 frontier (7/10/23), floor ≥ 188 AND **=== count(selfTest:"wired")** (SC-7 equality, previously unenforced), counts ≤ caps (writer-independent P10/P12 witness), `externalGateDirs` stays an array.
- **Green on head:** 4/4 pass; parity PASS at 406/437; **batch A 558/558 exit 0** with the test executing inside it.
- **Fails-on-revert verified at `b92e1355d`+QA-tree, three directions:** (i) `fixtureCap` 10→11 → `not ok 1` while parity stays green — the exact F-1 hole, now closed; (ii) full MANIFEST rollback to origin/main → `not ok 1/2/3`; (iii) floor desync (185 vs 188 wired) → `not ok 2`. Restored → 4/4.
- Both the implementor's regression tests (parity self-test cases, wired batch:B; RD-1 batch:A) and this test are in `git diff origin/main...HEAD --name-only` for the closing PR.

## 6. Constitution (14-rule) matrix
CI-only diff; rules audited against the closing diff: 1 dead-taps **N/A** · 2 one-owner **PASS** (caps derived from gates[], single writer MANIFEST; run-batch derives from MANIFEST, zero drift) · 3 no-silent-failures **PASS** (every dark state capped + ORCH-cited; missing-field = fail, never a vacuous green) · 4 query-key **N/A** · 5 server-state **N/A** · 6 logout **N/A** · 7 transitional-labels **PASS** (HOLDs carry owner + exit condition) · 8 subtract-before-add **PASS** (zero deletions, caps shrink) · 9 no-fabricated-data **PASS** (report numbers re-derived true; deviation 5 wording — F-3) · 10 currency **N/A** · 11 one-auth **N/A** · 12 validate-time **N/A** · 13 exclusion-consistency **PASS** (P11 mirrors P1 exactly) · 14 hydration **N/A**.

## 7. Device / parity matrix
All 7 surfaces (Consumer iOS/Android, Buyer Web, Business iOS/Android, Admin Web, Business Web preview): **skipped — change ships to none of them** (CI-only; spec §3; independently confirmed zero product-source files in the closing diff). Physical-iPhone HITL: not applicable — no runtime surface. No edge functions touched (verified: no `supabase/` paths in diff).

## 8. Discoveries for Orchestrator
1. **F-1 residual:** add `fixtureCap`/`capableUnwiredCap` raise rules to the `tests-append-only.yml` MANIFEST ratchet (DO-NOT-TOUCH this phase; rider on OQ-2).
2. **F-2:** base-relative ratchet PR-window rollback blindness (1383 design) — consider absolute frontier pins in the ratchet itself.
3. **D-8 restated** (corroborated independently: 100/10/90): the 90 dark `app-mobile/scripts/ci` gates need their own disposition ORCH; `externalGateDirs` stays `[]` and P11 protects nothing live until then.
4. **CLOSE-note obligations (SC-5):** D-4 + D-7 (0770/0776a TUS/Bunny rewrite; Cloudinary residue) + F-1 row-3 D-id assignment + impl deviations 2–5.
5. **COMMS ledger hygiene:** 79 OPEN-status WARN broadcast rows past their 14-day expiry need the stale sweep.

## 9. Items proved by me vs inherited
- **Proved by me:** T-1…T-5, T-10…T-14 · P11+P12 failure directions · all 13 gates both modes · SPOT-A/B/C defect reintroductions · 1369 blocking arm (independent weakening) + registry verbatim check · RD-1 both directions · ratchet arithmetic + cap-raise probes (F-1/F-2) · zero-deletion sweep · Step 0.5 re-runs (P10/P11/P12 deletion, 4/5/2 of 30) · adversarial test both directions · batch A 557/557 and 558/558.
- **Inherited (orchestrator-verified, independently corroborated in passing):** clean-tree parity/batch baseline (re-ran, matched), P10 dual-assertion probe (superseded by my own T-3/T-4), D-8 counts (re-derived: 100/10/90/91).
