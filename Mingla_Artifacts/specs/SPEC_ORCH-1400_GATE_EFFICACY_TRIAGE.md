# SPEC — ORCH-1400 [gate-efficacy-triage]

**Input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1400_GATE_EFFICACY.md` (findings F-1…F-5, discoveries D-1…D-6)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1400-[gate-efficacy-triage]` @ `ORCH-1400-gate-efficacy-triage`
**Contract style:** PHASED — each phase independently shippable, independently testable, each ends in its own PR/CLOSE (one PR per CLOSE rule).

---

## 1. Executive summary

ORCH-1383 proved every wired gate RUNS. This program makes gates provably CATCH. Phase 1 closes the three structural holes that let gates go dark at CLOSE (uncapped `fixture` state, unswept external gate dirs, permanently-legal `capable-unwired` self-tests) and executes the evidence-backed disposition of the 21 frozen gates + RD-1: wire 13 green gates + the orch-1369 adversarial harness + RD-1, and hold 7 red gates for reconciliation after their discoveries are routed (Rev 2: zero retirements — the 0770/0776a gates guard a LIVE TUS/Bunny surface and get expectation rewrites, not deletion). Phase 2 backfills real two-direction self-tests onto the 43 money/release/auth token gates (the class that already failed in production). Phases 3–4 finish the remaining 135 by measured mechanical class, ratcheting the floor at every merge.

## 2. Scope & non-goals

**In scope:** MANIFEST schema + ratchets; `meta-1383-manifest-parity.mjs` new rules P10–P12; `run-batch.mjs` expected sets; disposition of the 21 + RD-1; self-test backfill for the 178-gate population (+ audit pass for 19 `node --test` suites, 2 bash). Rev 2: no retirement ships in this program's Phase 1; the retirement mechanics below remain specified for any future disposition change.

**Non-goals (explicit):**
- **This program proves a gate catches its ORIGINAL defect class, not all possible defects.** No claim beyond that is made anywhere.
- Fixing product code behind the 5 red gates (D-1…D-5 route to the orchestrator as their own intake; a gate is only wired once its live run is green — we never wire a red gate to "document" a bug).
- Widening the orch-1369 BASE gate to cover track/ASC-key gaps (Open Question OQ-1, Seth's release-safety call).
- Sweeping the 185 already-wired gates for vacuous-scan tolerance (D-6 — registered follow-up ORCH; convention here applies to gates this program touches).
- Rewriting the 0770/0776a expectations against the TUS/Bunny pipeline in Phase 1 itself (D-4 routes it; the rewrite lands in a later phase or its discovery ORCH — a gate is only wired once green).
- Removing the post-META-1270 Cloudinary residue (D-7 — candidate new ORCH).
- Any workflow re-architecture: the 10-job batch layout is untouched.

**Assumptions:** main stays on the ORCH-1383 batch format; `tests-append-only.yml` token grammar unchanged.

## 3. Cross-Surface Impact Declaration

| Surface | Covered? | Reason |
|---|---|---|
| 1. Consumer iOS (`app-mobile/`) | NOT covered | CI-only program; zero runtime changes |
| 2. Consumer Android | NOT covered | same |
| 3. Buyer/anonymous Web | NOT covered | same |
| 4. Business iOS | NOT covered | same |
| 5. Business Android | NOT covered | same |
| 6. Admin Web (adjacent) | NOT covered | same |
| 7. Business Web preview (adjacent) | NOT covered | same |

All deliverables live under `.github/scripts/strict-grep/**` + `mingla-business/package.json` (script-row deletions only) + `Mingla_Artifacts/**`. Parity is automatic (single CI codepath).

## 4. Layered specification

Only the CI layer is affected. DB / edge / service / hook / component / realtime: genuinely untouched (no entries — the investigation confirms zero product-code writes).

### 4.1 Phase 1 — structural fix + disposition (ship first, alone)

**4.1.a MANIFEST schema additions** (`.github/scripts/strict-grep/MANIFEST.json`):
- New top-level ratchets: `fixtureCap: 10` (current 11 minus RD-1 which Phase 1 wires) and `capableUnwiredCap: <count at merge>` (27 minus those Phase 1 flips to wired). Both shrink-only, same append-only regime as `unenforcedCap`.
- New top-level `externalGateDirs: ["app-mobile/scripts/ci"]` — every `*.mjs` in a listed dir MUST have exactly one `gates[]` entry (extendable list; adding a dir is append-only).
- `fixture` and `unenforced` entries MUST carry a `reason` matching `/ORCH-\d{3,4}/` (the generic "Recorded by ORCH-1383…" rows get their citation appended in this phase — content edit, not row removal; no token needed).

**4.1.b Parity gate new rules** (`meta-1383-manifest-parity.mjs`) — each with self-test fixtures BOTH directions (see §9):
- **P10 (dark-file ratchet):** `count(enforcement==="fixture") <= fixtureCap` AND every `fixture`/`unenforced` `reason` matches `/ORCH-\d{3,4}/`. Raising `fixtureCap` requires the existing commit-token mechanism (`GATE-REMOVAL:`-class token, new token literal `DARK-GATE-ADD: ORCH-NNNN <reason>` enforced by `tests-append-only`'s checker via the same grammar file — if extending that checker is out of reach this phase, the cap alone still blocks silently, which is the load-bearing half).
- **P11 (external totality):** for each dir in `externalGateDirs`, every on-disk `*.mjs` appears exactly once in `gates[]` (mirrors P1). New dark files outside the strict-grep dir now fail parity by name.
- **P12 (capable-unwired ratchet):** `count(selfTest==="capable-unwired") <= capableUnwiredCap`. An unwired self-test becomes a visible, shrinking debt instead of a permanent legal state.

**4.1.c Disposition execution** (per INVESTIGATION F-1 table — the evidence column of record):
- **WIRE now (13):** F-1 rows 1, 2, 6, 7, 11, 12, 13, 14, 15, 17, 18, 19, 20 → `enforcement: "batch:A"`, `invocation: "node"`, `modes: ["plain"]` (+ `"self-test"` for rows 1, 17, 18 which are `capable-unwired` — flip to `wired`); add to `run-batch.mjs` class-A expected set (P5 forces both sides); `unenforcedCap` 21 → 7 (Rev 2).
- **WIRE special (1):** row 21 `orch-1369-release-submit-config.adversarial.mjs` — amend its exit mapping so Part 1 regression stays exit 1 (blocking) and Part 2 documented-gaps prints the gap list but exits 0 (the gap list also lands verbatim in `INVARIANT_REGISTRY.md` under I-RELEASE-SUBMIT-CONFIG as a recorded scope boundary); then wire batch:A plain. OQ-1 offers Seth the alternative (widen base gate → probes flip to guarded → mapping becomes moot).
- **WIRE RD-1:** update T-11 to assert (a) the MANIFEST rows for `orch-1385-workspace-deps-declared.mjs` (`batch:A`, modes plain+self-test) and `.adversarial.test.mjs` itself (`batch:A`, node --test), and (b) the workflow paths filter still contains the six dirs — dropping the dead per-gate-job assertion. Commit body carries `[TEST-MOD-APPROVED ORCH-1400]`. Then `fixture` → `batch:A`, `invocation: "node --test"`.
- **HOLD as `unenforced` (7):** F-1 rows 3, 4, 5, 8, 16 (reasons cite ORCH-1400 + routed discovery IDs D-1…D-3b, D-5) plus — Rev 2 — rows 9, 10 (`orch-0770`, `orch-0776a`; reasons cite D-4 + D-7: "expectations pin the pre-META-1270 client pipeline; guarded TUS/Bunny surface is LIVE — rewrite required, deletion prohibited"). Each HOLD gate wires in a later phase ONLY once its live run is green (code fixed, violation blessed via the gate's own allowlist-comment mechanism, or — for 9/10 — expectations rewritten against `eventCoverVideoTusPatch.ts` + the `event-cover-video-*` function family). Those calls belong to each discovery's ORCH, not this one. `unenforcedCap` 21 → 7; no file is deleted; `expectedStrictGrepMjsFiles` stays 405; the two `test:orch-0770`/`test:orch-0776a` package.json rows stay untouched.
- **RETIRE (0 — Rev 2):** none. The Rev-1 retirement of 0770/0776a was overturned by the liveness trace (INVESTIGATION F-1 Rev-2 note). The mechanics remain the contract for ANY future retirement: file + MANIFEST-row + package.json-row removal, `expectedStrictGrepMjsFiles` decrement, `GATE-REMOVAL: ORCH-NNNN <reason>` commit token, and a verbatim Seth-visible CLOSE notify listing.

### 4.2 Phase 2 — self-test backfill, wave 1 (money/release/auth token gates, 43 gates)

Population: the 43 `selfTest:"none"` plain-node gates whose script name matches `/stripe|paystack|checkout|payment|refund|payout|money|currency|price|pricing|tax|installment|contribution|release|submit|expo-pinned|auth|rls|admin|definer|grant/i` (query captured in the implementation report with the resolved list — the class that already failed in production per dispatch context items 2/3).

**Fixture convention (binding, decided):** fixtures are **in-source** — string literals / template heredocs inside the gate script, or `mkdtempSync` trees written at self-test runtime and removed in `finally`. **No committed fixture files, ever.** Justification: (a) board #957 — NUL-byte fixture files are grep-invisible, so on-disk fixtures cannot be reliably enumerated by sweeps; in-source fixtures are enumerated by the MANIFEST `modes` field, which the batch runner executes — nothing on disk to miss; (b) committed bad-fixtures containing banned tokens would false-trigger OTHER absence gates that walk the tree; (c) `tests-append-only` friction on fixture churn.

**Per-gate backfill contract (every gate, every phase):**
1. Factor the existing scan into a pure function over injected sources/root. **The real run's behavior must be provably unchanged:** same exit code and same violation output on the live tree before vs after the refactor (recorded in the implementation report per gate).
2. `--self-test` mode asserting, in order: (a) knowingly-good fixture → zero findings (the mandatory control — a checker that fails everything fails HERE); (b) knowingly-BAD fixture(s) reproducing the gate's ORIGINAL defect direction (from the gate's own header/ORCH doc) → detector fires; (c) for multi-file walkers: an empty-tree control plus a real-run **vacuity guard** — `scannedFiles === 0` → exit 2, killing the vacuous-scan class (F-3) for every touched gate.
3. MANIFEST row: `selfTest` → `"wired"`, `modes` += `"self-test"`; batch runner picks it up via existing modes handling.
4. At each wave's merge: `selfTestWiredFloor` rises to the new wired count (P7 enforces monotonicity thereafter).

### 4.3 Phase 3 — remaining single-file (58 left) + multi-file (78 left) + structural-parse (5) gates
Same per-gate contract. Measured rate (INVESTIGATION Q6): 12–18 gates/hour agent throughput → ~9–12 hours across Phase 3; slice into ≥3 PR waves of ~40–50 so each merge ratchets the floor.

### 4.4 Phase 4 — the hard tail
- 4 exec-behavioural gates (`i-proposed-k-require-cycles`, `i-proposed-trip-canonical-columns.test`, `orch-0948-waitlist-feature`, `regression-test-backfill-warning`): sized by inspection at 20–40 min each; subprocess fixtures via mkdtemp.
- 19 `node --test` suites + 2 bash gates: an **audit pass** (not `--self-test` retrofit) — each must be shown to contain ≥1 failing-direction case; those that don't get one added (`[TEST-MOD-APPROVED ORCH-1400]` only where lines are deleted). MANIFEST gains `selfTest:"wired"` only where a true self-test mode exists; suites that are direction-audited but mode-less keep `"none"` with an `auditedBy: "ORCH-1400"` annotation (schema addition, P6 untouched).

## 5. Success criteria (numbered, testable; single CI surface → no per-platform split)

- **SC-1:** After Phase 1, adding any new `*.mjs` under `.github/scripts/strict-grep/` or any `externalGateDirs` dir WITHOUT a manifest entry fails `meta-1383-manifest-parity` by file name (P1/P11).
- **SC-2:** After Phase 1, registering a new file as `fixture` fails parity (P10 cap) unless the commit raises `fixtureCap` via the visible token path; a `fixture`/`unenforced` reason lacking an ORCH citation fails parity by name.
- **SC-3:** After Phase 1, `count(unenforced) === 7`, every HOLD entry's reason cites ORCH-1400 + its discovery ID (the 0770/0776a reasons carry the deletion-prohibited wording), and the 14 newly wired gates (13 + 1369-adv) + RD-1 each appear in the batch run's executed list on the PR (differential check against the PR's own run log).
- **SC-4:** RD-1 passes 12/12 under `node --test` from a bracket-free path, and its T-11 fails if the MANIFEST rows for orch-1385 are removed (fails-on-revert probe recorded).
- **SC-5 (Rev 2):** Phase 1 deletes NOTHING: `expectedStrictGrepMjsFiles === 405`, all 21 gate files still on disk, both `test:orch-0770`/`test:orch-0776a` package.json rows intact, and the CLOSE note lists D-4 + D-7 (the 0770/0776a rewrite obligation and the Cloudinary residue) to Seth.
- **SC-6:** After each Phase 2/3/4 wave: every touched gate exits identically on the live tree pre/post refactor (per-gate table in the implementation report); `--self-test` exits 0; deleting any single BAD fixture assertion (spot-audit: 3 random gates per wave) makes that gate's self-test fail — proving the bad-direction is load-bearing.
- **SC-7:** `selfTestWiredFloor` strictly increases at every wave merge and equals `count(selfTest==="wired")` (185 → ≥188 after Phase 1 flips → ≥231 after wave 1 → 363 max at program end, minus audited-not-wired suites).
- **SC-8:** Every Phase 2+ multi-file gate's real run exits 2 when pointed (`--repo-root`) at an empty temp dir (vacuity guard live).

## 6. Invariants

**Preserved:** I-PROPOSED-1383-GATE-MANIFEST-TOTALITY (P11 extends totality; verified by parity self-test); I-PROPOSED-1383-NO-SILENT-SHRINK (all cap changes shrink-only or token-gated; append-only regime reused); I-RELEASE-SUBMIT-CONFIG (1369 gap list recorded, base gate untouched pending OQ-1); tests-append-only grammar (all test-file edits carry tokens).

**New (DRAFT, flip ACTIVE at each phase's CLOSE — orchestrator owns the flip):**
- **I-PROPOSED-1400-NO-DARK-GATE-STATES:** every gate file in swept dirs is enforced, or carries a capped, ORCH-cited `fixture`/`unenforced` state; caps only shrink without a visible token. (Tests: T-1…T-4)
- **I-PROPOSED-1400-SELF-TEST-BOTH-DIRECTIONS:** a `selfTest:"wired"` gate's self-test contains a good-fixture control AND ≥1 original-defect bad fixture; multi-file gates carry the vacuity guard. (Tests: T-6…T-9)
- **I-PROPOSED-1400-SELFTEST-FLOOR-MONOTONE:** `selfTestWiredFloor` equals wired count at every merge and never decreases. (Test: T-10)

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | New dark file, strict-grep dir | add `zzz.mjs`, no manifest row | parity FAIL (P1, by name) | CI |
| T-2 | New dark file, external dir | add `app-mobile/scripts/ci/zzz.mjs`, no row | parity FAIL (P11, by name) | CI |
| T-3 | Dark file laundered as fixture | 11th fixture row, no cap raise | parity FAIL (P10 cap) | CI |
| T-4 | Citation-less freeze | fixture row, reason without `ORCH-\d` | parity FAIL (P10 reason) | CI |
| T-5 | Happy path | Phase-1 tree as shipped | parity PASS; batch executes 14 new + RD-1 | CI |
| T-6 | Backfilled gate, good direction | `--self-test` | exit 0 | CI |
| T-7 | Backfilled gate, bad direction load-bearing | delete one bad-fixture assert (spot-audit) | self-test FAIL | CI |
| T-8 | Refactor safety | live-tree run pre vs post factor | identical exit + output | CI |
| T-9 | Vacuity guard | `--repo-root <empty mkdtemp>` | exit 2 | CI |
| T-10 | Floor ratchet | lower `selfTestWiredFloor` in a PR | parity FAIL (P7) | CI |
| T-11 | No-deletion + HOLD citations | Phase-1 tree | 405 files on disk; `count(unenforced)===7`; every HOLD reason matches `/ORCH-1400/` and names a D-id; CLOSE note lists D-4 + D-7 | CI/process |
| T-12 | RD-1 fails-on-revert | remove orch-1385 MANIFEST rows | RD-1 T-11 FAIL | CI |
| T-13 | 1369 harness split | plant a Part-1 strictness regression in a fixture eas.json | harness exit 1 (blocking) | CI |
| T-14 | 1369 gaps non-blocking | current tree | harness exit 0 + gap list printed | CI |

## 8. Implementation order

1. **Phase 1a:** MANIFEST schema (caps, `externalGateDirs`, citations) → parity P10/P11/P12 + their self-test fixtures → run T-1…T-4 locally (bracket-free path per #958).
2. **Phase 1b:** wire the 13 (MANIFEST + run-batch expected sets) → 1369 harness exit-mapping (`[TEST-MOD-APPROVED ORCH-1400]` if lines deleted) + wire → RD-1 T-11 update + wire → update the 7 HOLD reasons (ORCH-1400 + discovery citations, incl. the 9/10 deletion-prohibited wording) → caps: `unenforcedCap` 21→7, `fixtureCap` set 10, `capableUnwiredCap` set, floor 185→(185+3 flips) → full batch run + parity green → PR (fresh event, never a rerun — COMMS-0109).
3. **Phase 2:** wave-1 backfill (43 gates, resolved list in report) → floor bump → PR.
4. **Phase 3:** three mechanical waves (~45 each) → floor bumps → PRs.
5. **Phase 4:** exec-behavioural 4 + suite audit 21 → final floor → PR.

Files created/modified per step are exactly the §10 allowlist; anything else = stop-and-amend.

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the P10/P11/P12 rules themselves, enforced on every PR by a workflow whose paths filter already covers the gate dir, with ratchets guarded by the SEPARATE `tests-append-only.yml` (disabling parity does not disable its own guard — inherited 1383 property).
- **Both-directions proof for every new rule:** the parity gate's own `--self-test` gains fixtures where each of P10/P11/P12 (i) passes on a compliant synthetic manifest and (ii) FAILS on a violating one (T-1…T-4). Reverting any new rule makes its bad-fixture self-test case fail → the parity gate's self-test (wired in batch) goes red. Protective comments in the parity gate name this spec and the orch-1369/1385 incidents as the "why".
- **Backfill reverts:** SC-6's spot-audit (bad-direction load-bearing) + P6 (a gate with `--self-test` in source can never be recorded `"none"`) + P7 floor (un-wiring shrinks the count below floor → red).

## 10. Scoped allowlist + DO-NOT-TOUCH

**Allowlist (implementor may change ONLY):**
- `.github/scripts/strict-grep/MANIFEST.json`
- `.github/scripts/strict-grep/meta-1383-manifest-parity.mjs`
- `.github/scripts/strict-grep/run-batch.mjs` (expected-set data only)
- `.github/scripts/strict-grep/orch-1369-release-submit-config.adversarial.mjs` (exit mapping only)
- `.github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs` (T-11 only)
- The 13 wire-now gate scripts — Phase 1 expects ZERO edits (they ran clean); any needed edit is stop-and-amend
- Phase 2+: the backfilled gate scripts named in each wave's resolved list
- `Mingla_Artifacts/**` report/spec/close docs for this ORCH

**DO-NOT-TOUCH:** `orch-0770-…` and `orch-0776a-…` gate FILES and their package.json rows (Rev 2 — deletion or edit prohibited this program; MANIFEST reason rows only); all product source (`app-mobile/`, `mingla-business/`, `mingla-admin/`, `packages/`, `supabase/`); the workflow YAMLs' job structure; `tests-append-only.yml` + `test-append-only-check.js` (unless OQ-2 approves the DARK-GATE-ADD token grammar — then that checker only, via amendment); the 185 wired gates' detector logic outside declared backfill waves; the 5 HOLD gates' target files (D-1…D-5 belong to other ORCHs); `COMMS_LEDGER.md` (never staged on this branch).

## 11. Open questions

- **OQ-1 (Seth):** widen the `orch-1369` BASE gate to assert `track === "internal"` + guard consumer-iOS ASC keys (closes the harness's 3 recorded gaps), or keep the recorded-gap mapping? Release-safety call; default shipped = recorded-gap mapping.
- **OQ-2 (Seth/orchestrator):** approve the `DARK-GATE-ADD:` commit-token addition to the append-only checker grammar, or ship Phase 1 with the hard cap only (raising `fixtureCap` then requires touching a ratchet guarded by `tests-append-only`, which is already Seth-visible)? Default shipped = hard cap only.
- **OQ-3 (orchestrator):** intake D-1…D-5 + D-7 (Cloudinary residue) so the 7 HOLD gates can be reconciled and wired — the 0770/0776a reconciliation is an expectation REWRITE against the live TUS/Bunny pipeline (D-4), never a deletion; ORCH-1400's later phases will wire whichever go green in time, else they stay counted in `unenforcedCap: 7`.

## 12. Downstream routing

IMPLEMENT (mingla-implementor) per phase, starting Phase 1, in this worktree/branch; each phase → mingla-tester (adversarial: T-1…T-14 minimum, from a bracket-free path per #958) → orchestrator CLOSE (fresh PR event per COMMS-0109; D-4/D-7 notify items at Phase-1 CLOSE; invariant flips at each CLOSE). Working tree: `~/Desktop/mingla-orchs/ORCH-1400-[gate-efficacy-triage]` on branch `ORCH-1400-gate-efficacy-triage`.
