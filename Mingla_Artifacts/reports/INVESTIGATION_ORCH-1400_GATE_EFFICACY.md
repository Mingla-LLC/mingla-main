# INVESTIGATION — ORCH-1400 [gate-efficacy-triage]

**Board:** issue #955 · **Worktree:** `~/Desktop/mingla-orchs/ORCH-1400-[gate-efficacy-triage]` @ `ORCH-1400-gate-efficacy-triage` (rebased onto `origin/main` `917d91c62`)
**Phase:** INVESTIGATE (code/CI audit only — no reproducer-bound UI bug; live-fire exemption applies per skill Prime Directive 7 exemption list)
**Date:** 2026-07-18
**Comms factored:** COMMS-0113 (ORCH-1383 in-flight → now merged), COMMS-0114 (10-job batched CI is live; MANIFEST registration is a hard rule; efficacy debt registered), COMMS-0115 (this ORCH's intake).

---

## 1. Symptom summary

**Expected:** every CI gate, if its original defect returned, would go red.
**Actual (dispatch claim):** ORCH-1383's differential parity proves every wired gate EXECUTES (0 dark — sealed, `Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md`, not re-proven here), but nothing proves any gate would CATCH. 21 gates run in no workflow at all; 168+ have no `--self-test`; RD-1 (`orch-1385-workspace-deps-declared.adversarial.test.mjs`) is wired to nothing; 8 classes of decorative guard shipped in four days.

**Investigation verdict in one line:** the dispatch is directionally right and numerically low — the no-self-test population is **199 enforced entries (178 plain gate scripts)**, not 168; the 21 frozen gates are real but **7 of them go RED today** and **2 can never pass again**; RD-1 is not just dark, it is **dark AND stale** (1/12 tests now fails for wiring-format reasons); and the wired self-tests are **healthier than feared** (16/16 sampled have failing-direction fixtures) — the real efficacy hole is **target binding and vacuous scans**, not missing bad fixtures.

---

## 2. Investigation manifest (files read / probes run, in order)

| # | File / probe | Why |
|---|---|---|
| 1 | `COMMS_LEDGER.md` (0108–0115) | Mandatory entry; frames scope |
| 2 | `.github/scripts/strict-grep/MANIFEST.json` (436 entries, parsed programmatically) | The registry of record for enforcement + selfTest state |
| 3 | `Mingla_Artifacts/specs/SPEC_ORCH-1383_CI_STRICT_GREP_CONSOLIDATION.md` §1.1-C, §5.5, §10-D1/D2 | Why the 21 were frozen; D2 wrong-baseline finding (sealed) |
| 4 | All 21 `enforcement:"unenforced"` gate scripts (read + EXECUTED, exit codes recorded) | Task 1 disposition evidence |
| 5 | `mingla-business/package.json` `test:orch-*` scripts | The "invoked only by a package.json script no CI runs" vector |
| 6 | `meta-1383-manifest-parity.mjs` (462L, P1–P9 + P-vacuous) | Where the parity holes are |
| 7 | `.github/workflows/strict-grep-mingla-business.yml` (triggers), `tests-append-only.yml` (triggers) | Whether a CLOSE-style commit even triggers parity |
| 8 | `orch-1385-workspace-deps-declared.adversarial.test.mjs` (540L) + `.test.mjs` (108L), EXECUTED via `node --test` from the bracket-free anchor | RD-1 disposition |
| 9 | `orch-1369-release-submit-config.adversarial.mjs` exit contract (lines 95–150) | Exit-2 semantics |
| 10 | 16 wired `--self-test` implementations (13 systematic every-15th sample + 3 oldest alphabetical), self-test blocks read; 6 EXECUTED | Task 3 efficacy audit |
| 11 | `i-consumer-reads-ai-signal-scores-not-trial-table.mjs`, `orch-0766f-…`, `orch-0784-…` (full reads) | Task 5 measurement subjects |
| 12 | Live-code aliveness probes: `rsvp/[id]/preview.tsx:100–125`, `BrandSwitcherSheet.tsx`, `eventCoverVideoProcessingService.ts`, `@tiptap` usage, `(tabs)/marketing/`, ComposerV2 chips, 0910 target files | RETIRE-vs-WIRE evidence |
| 13 | `git log --follow` on the 1369/1385 adversarial files | Task 4 recurrence timeline |
| 14 | Board issues #955, #957, #958 (`gh issue view`) | Known environment artifacts + hazard classes |
| 15 | 3 self-test prototypes written + executed in scratchpad (`orch1400-backfill-probe/`) | Task 5 measured rates |

Known worktree artifacts honored: gates were executed from the worktree; all 21 produced domain output (no MODULE_NOT_FOUND percent-encoding signatures — none of the 21 is a #958 victim); RD-1 was executed from the bracket-free anchor because its own fixtures exercise bracket paths.

---

## 3. Q-scorecard

**Q1 — What is the true state of the 21 frozen-unenforced gates, and what should happen to each?**
Verdict (proven): 13 exit 0 today (immediately wireable), 5 exit 1 on live code (wire-after-reconcile; 4 of the reds point at possible real product regressions — registered as discoveries), 2 exit 1 permanently (guarded implementation replaced by the TUS pipeline — retire), 1 exits 2 by design (the orch-1369 adversarial harness: its blocking half passes, its exit-2 is a documented-coverage-gap signal). **0 are SUPERSEDED** — the currency successors (`orch-1146`, `meta-orch-1236`) were checked and do NOT cover `orch-0769`'s target file. Full table §5 F-1.

**Q2 — What is the exact no-self-test population and its mechanical clustering?**
Verdict (proven, from MANIFEST + disk): 224 of 436 manifest entries are `selfTest:"none"`; removing `fixture` (4) and `unenforced` (18) leaves **199 enforced entries**: **178 plain-`node` gate scripts** (the true `--self-test` backfill population), 19 `node --test` suites, 2 bash scripts. Clustering (heuristic classifier over all 178, 3 spot-checks): single-file token gates 79 (presence 21 / absence 8 / mixed 50), multi-file scanners 90 (presence 12 / absence 31 / mixed 47), structural-parse 5, exec-behavioural 4 (`i-proposed-k-require-cycles`, `i-proposed-trip-canonical-columns.test`, `orch-0948-waitlist-feature`, `regression-test-backfill-warning`), byte-compare 0. Also: **27 `capable-unwired`** self-tests exist but CI never invokes them — 12 of these are live batch:A gates (cheapest possible ratchet raise). Dispatch's "168+" was an undercount.

**Q3 — Do existing self-tests actually include a failing-direction case?**
Verdict (proven on the sample): **16/16 sampled wired self-tests (8.6% of 185) carry both directions** — a knowingly-good fixture that must pass AND knowingly-bad fixture(s) that must fire (several also carry the exact original-defect shape, e.g. `orch-1385` reproduces the #925 buyer.tsx shape; `orch-1263` trips all four arms of the reverted fixture). The feared "self-test that cannot go red" was NOT found in the wired population. The honest caveat: these self-tests prove **detector** efficacy on synthetic fixtures — they do NOT prove **target binding** (that the real scan target still contains the region the detector was written against). The orch-1328 tab-bar `<button` failure and the orch-0770 constant-rename tombstone are both binding failures, invisible to fixture-direction self-tests. A second systemic hazard was found while reading: **vacuous-scan tolerance** — multi-file gates `continue` on `!existsSync(target)` and exit 0 with `scannedFiles === 0` (e.g. `i-consumer-reads-ai-signal-scores-not-trial-table.mjs` lines 92–113); if all its targets were renamed the gate goes green forever.

**Q4 — How do gates go dark at CLOSE, and is the path still open post-1383?**
Verdict (proven): Pre-1383 mechanism: the gate file ships in the SHIP or CLOSE commit while wiring was a **separate, manual workflow-job edit** the flow never performed, and `package.json` `test:orch-*` scripts created a local-runnability illusion. Evidence: `orch-1369-…adversarial.mjs` landed dark in its own SHIP commit `e489715ab` (#850, base gate wired, harness not); `orch-1385-…adversarial.test.mjs` (540L) landed dark in the CLOSE commit `1d1565893` ("tester PASS artifacts + doc syncs"). Post-1383, P1 totality + the paths filter (`.github/scripts/strict-grep/**` IS in the workflow triggers) close the *silent* path, **but four holes remain**: **H1** `enforcement:"fixture"` is uncapped and needs no justification (P8 caps only `unenforced`) — the legal way to land a dark file today is to register it as `fixture` with any reason string; 11 files already sit there. **H2** P1 sweeps only `.github/scripts/strict-grep/` — the 13 manifest entries whose scripts live elsewhere (`app-mobile/scripts/ci/`, `mingla-admin/src/__tests__/`) have no totality guard, and a NEW dark file there never needs registering at all. **H3** `selfTest:"capable-unwired"` is legal indefinitely (12 live batch:A cases) — a self-test can exist and never run; P7's floor counts only `"wired"`. **H4** dark suites rot: RD-1's T-11 broke silently when ORCH-1383 consolidated the workflow under it — proof that every week dark increases wiring cost.

**Q5 — What is RD-1's true state?**
Verdict (proven, executed): `node --test` from the anchor → **11/12 pass, T-11 FAILS** (`'ORCH-1385 job removed from the workflow'` — it asserts the pre-batch per-gate job format, which ORCH-1383 legitimately removed). The suite covers 11 adversarial angles far beyond the wired 5-test `.test.mjs`, including three documented known-gaps (F-1 entry/api/scripts invisibility, F-2 comment/template false-fire, F-3 backtick dynamic-import evasion) and — ironically — workflow-wiring integrity. Disposition: WIRE after a single-assertion T-11 update (assert MANIFEST `batch:A` membership + paths-filter instead of a named job). The update deletes test lines → requires `[TEST-MOD-APPROVED ORCH-1400]` per `tests-append-only.yml`.

**Q6 — What does self-test backfill actually cost per class?**
Verdict (measured, 3 prototypes in scratchpad, both directions proven green/red each): single-file token-presence (`orch-0766f`, 91L) — 36 s tool-wall; multi-file-absence with mkdtemp fixture tree + empty-tree control (`i-consumer-…trial-table`, 138L) — 29 s; structural-parse (`orch-0784` subset, JSON.parse + token arms) — 50 s. Whole probe window 136 s. Converting to honest end-to-end implementation throughput (read full gate + factor scan into a pure function + fixtures + MANIFEST `modes` edit + verify both directions + batch re-run): **~3–5 min/gate → 12–18 gates/hour** for the 169 token/multi-file/structural gates; **exec-behavioural sized by inspection (not measured) at 20–40 min each** (subprocess fixtures); the 19 `node --test` suites need an audit-for-failing-direction pass, not a `--self-test` retrofit (~5 min each). Total mechanical estimate: **~14–22 agent-hours** across the population, cleanly wave-able.

---

## 4. Five-truth-layer reconciliation

| Layer | State | Contradictions |
|---|---|---|
| Docs (dispatch, #955, COMMS-0115) | "21 frozen; 168+ no-self-test; RD-1 unwired" | **Docs vs Data:** true no-self-test = 199 enforced (178 scripts); RD-1 is unwired AND stale (T-11 red) — worse than docs say |
| Schema (MANIFEST.json) | 436 entries; caps: unenforcedCap 21, selfTestWiredFloor 185; `fixture` uncapped | **Schema vs Code:** MANIFEST `selfTest:"none"` verified honest by P6; but `fixture`/`capable-unwired` states have no ratchet or justification schema — the recurrence hole lives here |
| Code (gates + parity + workflows) | P1–P9 + P-vacuous live; paths filter covers strict-grep dir | **Code vs Docs:** SPEC-1383 froze the 21 as "protect nothing today"; code reality: 7 of them RED, meaning they'd protect (or reveal) something immediately |
| Runtime (all 21 executed; RD-1 executed; 6 self-tests executed) | 13 green / 7 red / 1 exit-2; RD-1 11/12; 6/6 self-tests pass | **Runtime vs Docs:** "wire the 21" is not a flip — 7 need reconciliation, 2 are tombstones |
| Data (git history) | 1369-adv dark since SHIP e489715ab; 1385-adv dark since CLOSE 1d1565893 | Confirms the dark-at-close class with two independent instances |

---

## 5. Findings (six-field)

### F-1 — Disposition of the 21 frozen gates + RD-1 (answers Q1, Q5) — CONFIRMED (inventory), proven
- **Symptom:** 21 gates at `enforcement:"unenforced"`; RD-1 at `enforcement:"fixture"`.
- **Layer:** code + runtime.
- **Probe:** `node .github/scripts/strict-grep/<gate>.mjs` for all 21 (worktree, no #958 signatures observed); `node --test …adversarial.test.mjs` (anchor); aliveness greps per gate.
- **Evidence:** exit codes and per-gate probes as tabled below (verbatim outputs in session log; key lines quoted).
- **Mechanism:** frozen by SPEC-1383 §5.5 as a deliberate non-goal; every one was landed with only a `package.json` `test:orch-*` invocation (e.g. `mingla-business/package.json:24,29–36,61`).
- **Severity:** CONFIRMED ROOT CAUSE (of "protection that checks nothing" for these 22 files).

| # | Gate | Runs today | Guarded code alive? | Disposition | Evidence basis |
|---|---|---|---|---|---|
| 1 | `i-proposed-pay-in-full-opt-out-no-installment-rows` | exit 0 (5 files) | Yes (trip checkout files present) | **WIRE** (also wire its self-test + companion `.test.mjs` fixture) | clean run; capable-unwired self-test |
| 2 | `i-proposed-tr2-livestore-addliveevent-owner` | exit 0 (934 files) | Yes | **WIRE** | clean run |
| 3 | `i-proposed-tr2-route-by-event-type` | **exit 1 — 6 violations** | Yes (`routeForEventRow.ts` exists) | **WIRE-AFTER-RECONCILE** — violations are sub-path pushes (`/event/${id}/scanner`, `/trip/${id}/edit|travelers`) from outside route dirs; gate's own header intends known-type sub-navigation as legal but the implementation flags it | violation list captured |
| 4 | `i-proposed-tr2-safearea-on-fullscreen-routes` | **exit 1 — 19 violations** | Yes | **WIRE-AFTER-RECONCILE** — 19 full-screen routes without SafeArea handling; ORCH-0864 class was operator-visible → Discovery D-1 | violation count |
| 5 | `orch-0756a-active-brand-recovery` | **exit 1** | Yes (`BrandSwitcherSheet.tsx` has live create mode) | **WIRE-AFTER-RECONCILE** — missing "brand create persists default brand" signature → Discovery D-2 (possible live regression or refactor drift) | run + component grep |
| 6 | `orch-0766f-event-cover-quicktime-storage` | exit 0 | Yes (migration + rules + service test) | **WIRE** | clean run |
| 7 | `orch-0768-brand-audience-identity-honesty` | exit 0 (4 files) | Yes | **WIRE** | clean run |
| 8 | `orch-0769-app-wide-currency` | **exit 1** — `rsvp/[id]/preview.tsx:112: currency: "GBP"` | Yes (live preview mapper; `tickets: []`) | **WIRE-AFTER-RECONCILE** — NOT superseded: `orch-1146` scans a TARGET_FILES list excluding this file; `meta-orch-1236` guards brands pricing_currency writes, different invariant → Discovery D-3 | file read 100–125 + successor gate reads |
| 9 | `orch-0770-event-cover-video-processing` | **exit 1 — permanent** | **No** — expects `EVENT_COVER_FINAL_MAX_BYTES = 25 * 1024 * 1024` etc.; constants gone; service now TUS-based (109 TUS refs) | **RETIRE** (decommission note; Discovery D-4: no gate guards the TUS budget) | grep: 0 hits for `MAX_BYTES` in service |
| 10 | `orch-0776a-video-upload-progress-honesty` | **exit 1 — permanent** | **No** — expects Expo `createUploadTask` path, replaced by TUS | **RETIRE** (same note as #9) | run + service grep |
| 11 | `orch-0889-disabled-query-loading-state` | exit 0 (7 files) | Yes (`(tabs)/marketing` live) | **WIRE** | clean run |
| 12 | `orch-0889-sticky-footer-via-hook` | exit 0 (8 files) | Yes | **WIRE** | clean run |
| 13 | `orch-0891-chip-backspace-via-dom-handler` | exit 0 (4 files) | Yes (ComposerV2 chips live) | **WIRE** | clean run |
| 14 | `orch-0891-chip-dom-contract` | exit 0 (3 files) | Yes | **WIRE** | clean run |
| 15 | `orch-0891-no-tiptap-in-native-bundle` | exit 0 (781 files) | Yes — tiptap alive in `.web.ts` files only; native-exclusion invariant is live, not vacuous | **WIRE** | run + `@tiptap` grep |
| 16 | `orch-0910-chat-payload-curated-aware` | **exit 1 — 1/8 checks** ("buildCardDataPayload synthesizes curated image and images from stops" FAILs) | Yes (`app-mobile` collab files present) | **WIRE-AFTER-RECONCILE** → Discovery D-5 (possible curated-card image regression — touches the collab-deck determinism contract) | run output |
| 17 | `orch-1054-partner-splits` | exit 0 | Yes (ORCH-1331 NG rail live) | **WIRE** | clean run |
| 18 | `orch-1148-no-buyer-tax-form-in-venue-settings` | exit 0 (self-test also passes) | Yes | **WIRE** | clean run |
| 19 | `orch-1162-map-single-owner` | exit 0 | Yes | **WIRE** | clean run |
| 20 | `orch-1187-tester-consent-gate-deletion-robust` | exit 0 | Yes | **WIRE** | clean run |
| 21 | `orch-1369-release-submit-config.adversarial` | **exit 2 by design** — Part 1 strictness guards HOLD; exit 2 = 3 documented coverage gaps (no `track==="internal"` assert; consumer-iOS ASC keys unguarded) | Yes (base gate `orch-1369` wired batch:A) | **WIRE Part 1 blocking** — it IS the base gate's self-test-in-exile; exit-2 policy is an open question (widen base gate vs. record gaps non-blocking) | run + exit-contract read (lines 126–146) |
| RD-1 | `orch-1385-workspace-deps-declared.adversarial.test.mjs` | **11/12 pass; T-11 red** (asserts pre-batch job format) | Yes (base gate wired batch:A) | **WIRE after one-assertion T-11 update** (`[TEST-MOD-APPROVED ORCH-1400]` needed) | node --test run from anchor |

**Tally: WIRE 13 · WIRE-AFTER-RECONCILE 5 · RETIRE 2 · WIRE-special 1 (+ RD-1 WIRE-after-fix) · SUPERSEDED 0.**

### F-2 — The post-1383 recurrence holes H1–H4 (answers Q4) — CONFIRMED ROOT CAUSE, proven
- **Symptom:** dark-at-close remains possible after ORCH-1383.
- **Layer:** code (parity gate + MANIFEST schema).
- **Probe:** read `meta-1383-manifest-parity.mjs` P1–P9; read workflow triggers; `git log --follow` both adversarial files; MANIFEST fixture-list dump.
- **Evidence:** P8 regex covers only `unenforced` (line ~317 rule table; `VALID_ENFORCEMENT` line 48 admits `fixture` freely); P1 diskFiles derive from `SG_REL` only (lines 103–112); 11 `fixture` rows exist, several with the generic reason "Recorded by ORCH-1383 so no file is unaccounted for."; 12 batch:A entries sit at `capable-unwired`; RD-1 T-11 failure output "`ORCH-1385 job removed from the workflow`".
- **Mechanism:** a new dark file today lands legally as `fixture` (H1), or lands outside the swept dir with no registration duty at all (H2); an unwired self-test stays unwired forever (H3); and while dark, suites rot against the moving repo (H4) — which is exactly the orch-1369/1385 pattern recurring in new clothes.
- **Severity:** CONFIRMED ROOT CAUSE (of the recurrence class).

### F-3 — Wired self-tests are direction-honest; the residual efficacy gap is binding + vacuity (answers Q3) — CONFIRMED, proven on sample
- **Symptom:** dispatch feared self-tests without failing-direction cases.
- **Layer:** code + runtime.
- **Probe:** self-test blocks of 16 gates read (13 systematic every-15th of the sorted 185 + 3 oldest); 6 executed with `--self-test` → all exit 0.
- **Evidence:** every sampled gate constructs bad fixtures and asserts the detector fires (e.g. `i-1272` "BAD1: one policy removed (revert) → MUST fire"; `orch-1263` reverted fixture must trip ALL FOUR arms; `orch-1385` reproduces the exact #925 shape). Honest ratio: **16/16**.
- **Mechanism:** the convention that produced the 185 is sound for detector efficacy; what it cannot see is (a) target-binding drift (orch-1328 `<button`-matched-the-tab-bar class; orch-0770 constant rename) and (b) vacuous scans (`!existsSync → continue`, `scannedFiles===0 → exit 0` — live example quoted in Q3).
- **Severity:** SECONDARY ROOT CAUSE (for the "green while defect shipped" classes 2/4/8), with the feared no-bad-fixture failure mode **RULED OUT on the sampled wired population** (sample = 8.6%; stated as sample-based, not exhaustive).

### F-4 — Population + measured backfill economics (answers Q2, Q6) — CONFIRMED, measured
As per Q2/Q6 verdicts. Prototypes (scratchpad `orch1400-backfill-probe/`, not committed): `orch-0766f.selftest-proto.mjs` (1 good + 3 bad fixtures, 36 s), `i-consumer-trial-table.selftest-proto.mjs` (good + bad + empty-tree control, mkdtemp, 29 s; also demonstrates the vacuity guard pattern `scannedFiles===0 → exit 2`), `orch-0784.selftest-proto.mjs` (structural: unparseable-package.json must fail, 50 s). All six directions verified live.

### F-5 — The `package.json test:*` illusion is the 21's common vector — CONFIRMED, proven
`mingla-business/package.json` lines 24–61 invoke the frozen gates locally, which made them look wired at every CLOSE. Any future rule must treat "invoked by an npm script" as NOT-enforced unless a workflow runs that script (the 2 legitimate `npm-script` entries are `batch:D`-wired — the distinction already exists in the MANIFEST schema and must stay).

---

## 6. Blast radius / cross-surface map

CI-only ORCH; no client surface changes in scope. In-scope: `.github/scripts/strict-grep/**` (+ MANIFEST + parity gate + run-batch), `tests-append-only` interplay, `mingla-business/package.json` test-script rows for retired gates. Out-of-scope surfaces: all 7 product surfaces (consumer iOS/Android, buyer web, business iOS/Android, admin web, business web preview) — no runtime behavior changes. HOWEVER the 5 red gates point INTO product surfaces; those are handed to the orchestrator as discoveries, not silently absorbed (below).

## 7. Invariant impact
- Preserved: I-PROPOSED-1383-GATE-MANIFEST-TOTALITY, I-PROPOSED-1383-NO-SILENT-SHRINK (all new rules must extend, not weaken, the ratchets; wiring the 21 SHRINKS unenforcedCap — allowed direction).
- Conflict flagged (not resolved here): retiring #9/#10 deletes gate files → `tests-append-only.yml` deletion rules + GATE-REMOVAL token path; deletions of guards are Seth-notify items per dispatch.
- The orch-1369 exit-2 policy touches I-RELEASE-SUBMIT-CONFIG ("governs the publish STATUS only, not the rollout track") — widening the base gate is a release-safety decision, flagged as an open question.

## 8. Discoveries for Orchestrator (register; NOT absorbed into ORCH-1400 scope)
- **D-1:** 19 full-screen business routes fail the SafeArea gate (`i-proposed-tr2-safearea-on-fullscreen-routes`) — ORCH-0864's operator-visible bug class, unaudited on live routes.
- **D-2:** `BrandSwitcherSheet.tsx` no longer carries the "brand create persists default brand" signature (orch-0756a red) — possible live default-brand-persistence regression on brand create.
- **D-3:** `mingla-business/app/rsvp/[id]/preview.tsx:112` hardcodes `currency: "GBP"` on a live preview surface — de-GBP-ify program residue; no wired gate covers this file.
- **D-4:** the TUS event-cover upload pipeline has NO gate coverage (0770/0776a tombstones retire with nothing succeeding them — successor gate is a candidate ORCH, not auto-scope).
- **D-5:** `buildCardDataPayload` no longer synthesizes top-level curated `image`/`images` from stops (orch-0910 red) — potential curated collab-card image regression in the consumer app.
- **D-6:** vacuous-scan tolerance is a live hazard class across multi-file gates (`!existsSync → continue`, zero-scanned exit 0) — Phase-2 convention addresses new self-tests; a sweep of WIRED gates for this pattern is follow-up scope.
- (Known, already boarded: #957 NUL-byte grep-invisibility; #958 bracket-path + orch-0964 `.next/` walker.)

## 9. Repro evidence
Not a UI reproducer; runtime evidence = the 21 gate executions (13/7/1 split), RD-1 `node --test` (11/12, T-11 assertion error quoted), 6 wired self-test executions (6/6 exit 0), 3 prototype self-tests (all directions proven). No simulator relevance.

## 10. Confidence
**Proven** for: the disposition inputs (every gate executed), the recurrence holes H1–H3 (code-read of the live parity gate + manifest data), RD-1 state (executed), sample self-test honesty (read + executed), measured rates (executed prototypes). **Probable** for: H4 generalization (one proven instance, RD-1), the classifier's exact class counts (heuristic, 3 spot-checks — counts are planning-grade, ±10%). **Suspected** for: whether D-2/D-5 are live regressions vs blessed refactors (needs its own investigation; deliberately not chased here — scope discipline).

## 11. Recommended next phase + scope
**SPEC (this ORCH, phased):** Phase 1 = close H1–H3 in the parity gate + MANIFEST schema, and execute the F-1 disposition (wire 13 + RD-1 + 1369-Part-1; retire 2 with Seth-visible listing; queue the 5 reconciles with their discoveries routed to the orchestrator first — a gate must not be wired red). Phase 2 = self-test backfill for the highest-risk class (single/multi-file token gates guarding money/release/auth surfaces), with the fixture convention fixed as in-source fixtures (never committed fixture files — #957 NUL hazard + absence-gate cross-trigger hazard). Phase 3+ = remaining classes by measured rates with a per-merge ratchet. Explicit non-goal: proving gates catch defects OTHER than their original class.
