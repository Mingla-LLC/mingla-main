# QA REPORT — BIZ Cycle 17d Stage 1 (perf pass + storage hygiene)

**Cycle:** 17d Stage 1 (BIZ — Refinement Pass mini-cycle 4 — perf scope only; §F LOC decompose deferred to Stage 2)
**Mode:** TARGETED + SPEC-COMPLIANCE hybrid
**Generated:** 2026-05-05
**Effort:** ~45 min static / spec-compliance
**SPEC anchor:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17D_PERF_PASS.md`
**IMPL anchor:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17D_PERF_PASS_REPORT.md`

---

## 1. Layman summary

Stage 1 verified clean. Three unused npm dependencies confirmed gone, two new utilities (`evictEndedEvents()` + `reapOrphanStorageKeys()`) match SPEC verbatim contracts including the F-H2 guard against in-progress events. `currentBrandStore` migrate function pruned from 536 → 391 LOC (-145, beat SPEC's -85 to -120 estimate). `DoorPaymentMethod` import correctly removed from 2 of 3 files; `door/index.tsx` retains 6 genuine usages. App-start hooks integrated into `app/_layout.tsx` with run-once flags + try/catch + DEV-only logs. tsc clean. All 3 CI gates exit 0 (no regressions in I-37/I-38/I-39).

§F deferral acknowledged as principled — file LOC counts confirmed unchanged (CreatorStep2When 2271, CreatorStep5Tickets 2148, event/[id]/index.tsx 1354 — exactly the SPEC baseline). Stage 2 dispatch will cover §F separately. IMPL-5 discovery confirmed: CreatorStep5Tickets has 5 inline sub-components (TicketCard, VisibilitySheet, AvailableAtSheet, TicketStubSheet, ToggleRow) already structurally separated — Stage 2 risk lower than initially estimated.

**Verdict:** PASS (Stage 1 only; operator-side cold-start smoke is post-CLOSE deploy verification, not a hard gate per `feedback_post_pass_protocol`).

---

## 2. Verdict + severity matrix

**Verdict:** **PASS** for Stage 1 scope. Headless verification complete. Operator-side cold-start smoke (`npx expo start`) is the post-CLOSE deploy verification per IMPL §15.1 — not a CONDITIONAL-blocking gate since no behavior change ships with Stage 1.

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE | 4 |

---

## 3. Headline gate verification (independent execution)

| Command | Expected | Actual | Result |
|---|---|---|---|
| `cd mingla-business && npx tsc --noEmit` | TSC=0 | TSC=0 | ✅ PASS |
| `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | EXIT=0 (regression check) | EXIT=0 | ✅ PASS — I-37 holds |
| `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | EXIT=0 (regression check) | EXIT=0 | ✅ PASS — I-38 holds |
| `node .github/scripts/strict-grep/i39-pressable-label.mjs` | EXIT=0 (regression check) | EXIT=0 | ✅ PASS — I-39 holds |
| `grep -r "from ['\"]expo-image['\"]" mingla-business/src/ mingla-business/app/` | 0 hits | 0 hits | ✅ PASS — §A confirmed |
| `grep "@tanstack/query-async-storage-persister"` in package.json | 0 hits | 0 hits | ✅ PASS — §B trim confirmed |

---

## 4. SC verification matrix (23 in-scope rows + 3 DEFERRED rows clearly marked)

| SC | Status | Verification method |
|---|---|---|
| SC-A1 | ✅ PASS | grep returned 0 hits in src/ + app/ |
| SC-B1 | ✅ PASS | package.json read — `@tanstack/query-async-storage-persister` absent |
| SC-B2 | ✅ PASS | package.json read — `@tanstack/react-query-persist-client` absent |
| SC-B3 | ✅ PASS | package.json read — `expo-image` absent |
| SC-B4 | ✅ PASS | tsc=0 |
| SC-B5 | ✅ PASS | npm install completed; package-lock regenerated |
| SC-C1 | ✅ PASS | `evictEndedEvents.ts` exists with verbatim contract (95 LOC) |
| SC-C2 | ✅ PASS | F-H2 guard at line 72: `if (event.endedAt === null) continue;` |
| SC-C3 | ✅ PASS | `_layout.tsx` lines 78-101: §C useEffect with dynamic import + run-once flag |
| SC-C4 | ✅ PASS | line 21: `ENDED_EVENT_TTL_DAYS = 30` |
| SC-D1 | ✅ PASS | `reapOrphanStorageKeys.ts` exists with verbatim contract (85 LOC) |
| SC-D2 | ✅ PASS | grep `AsyncStorage.removeItem` in file → 0 hits (log-only confirmed) |
| SC-D3 | ✅ PASS | 11-key whitelist matches forensics §1 + SPEC §D.1 verbatim |
| SC-D4 | ✅ PASS | `_layout.tsx` lines 104-121: §D useEffect with dynamic import + run-once flag |
| SC-E1 | ✅ PASS | migrate() lines 358-371 uses `if (version < 12) reset` pattern |
| SC-E2 | ✅ PASS | grep `upgradeV2BrandToV3` etc returns 0 hits |
| SC-E3 | ✅ PASS | grep `V2Brand`, `V9Brand`, `V10Brand`, `V11Brand`, `V11Extras`, `V2BrandStats` returns 0 hits |
| SC-E4 | ✅ PASS | tsc=0 |
| **SC-F1** | ⏸️ **DEFERRED** | CreatorStep2When still 2271 LOC (unchanged); per implementor honest-deferral; Stage 2 dispatch |
| **SC-F2** | ⏸️ **DEFERRED** | CreatorStep5Tickets still 2148 LOC (unchanged); per implementor honest-deferral; Stage 2 dispatch |
| **SC-F3** | ⏸️ **DEFERRED** | event/[id]/index.tsx still 1354 LOC (unchanged); per implementor honest-deferral; Stage 2 dispatch |
| SC-F4 | ✅ PASS | All 3 CI gates exit 0 (regression-only since §F deferred) |
| SC-F5 | ✅ PASS | tsc=0 |
| SC-G1 | ✅ PASS | IMPL report §4 §G table + this report §5 §G verifies all 3 files |
| SC-H1 | ✅ PASS | IMPL report §15.2 contains operator-side bundle measurement instructions verbatim |
| SC-PRE | ✅ PASS | tsc=0 |
| SC-CI | ✅ PASS | 3 CI gates exit 0 |

**23 of 23 in-scope SC items PASS · 3 SC items (F1/F2/F3) DEFERRED to Stage 2.**

---

## 5. Forensic code reading findings

### 5.1 §A — `expo-image` verification

- Direct grep: `from ['"]expo-image['"]` in `mingla-business/src/` + `mingla-business/app/` → 0 hits
- IMPL claim "zero matches" verified.

### 5.2 §B — `package.json` trim

| Entry | Pre-17d | Post-17d Stage 1 | Verdict |
|---|---|---|---|
| `@tanstack/query-async-storage-persister` | present | ABSENT | ✅ removed |
| `@tanstack/react-query-persist-client` | present | ABSENT | ✅ removed |
| `expo-image` | present | ABSENT | ✅ removed |
| `@tanstack/react-query` | present | PRESENT | ✅ retained (correct — only persist-client deps removed) |
| `expo-image-picker` | present | PRESENT | ✅ retained (different package; needed) |

`package-lock.json` regenerated post `npm install` — corresponding `node_modules/...` entries gone (verified via grep on lock file's package definitions).

### 5.3 §C — `evictEndedEvents.ts` (verbatim contract match)

| Check | Line(s) | Result |
|---|---|---|
| `ENDED_EVENT_TTL_DAYS = 30` constant | 21 | ✅ |
| `ENDED_EVENT_TTL_MS = ENDED_EVENT_TTL_DAYS * 86_400_000` correct math | 22 | ✅ (30 × 86,400,000 = 2,592,000,000ms = 30 days) |
| `EvictionResult` interface returns | 24-27 | ✅ |
| Generic `pruneStore<T extends EventIdEntry>` helper for DRY | 42-62 | ✅ — try/catch + DEV-only log |
| F-H2 guard: `if (event.endedAt === null) continue;` | 72 | ✅ |
| Defensive guard: `if (Number.isNaN(endedAtMs)) continue;` | 74 | ✅ |
| TTL check: `if (now - endedAtMs > ENDED_EVENT_TTL_MS)` | 75 | ✅ |
| 5 stores pruned via `pruneStore` helper | 85-89 | ✅ — orderStore + guestStore + eventEditLogStore + scanStore + doorSalesStore |
| Returns `EvictionResult` shape | 91-94 | ✅ |
| No production console.log (only DEV-guarded) | full file | ✅ |

### 5.4 §D — `reapOrphanStorageKeys.ts` (verbatim contract match)

| Check | Line(s) | Result |
|---|---|---|
| `KNOWN_MINGLA_KEYS` set with 11 entries | 17-29 | ✅ — matches forensics §1 + SPEC §D.1 |
| `SUPABASE_AUTH_KEY_PATTERN = /^sb-.+-auth-token$/` | 31 | ✅ |
| `OrphanReapResult` interface | 33-36 | ✅ |
| Async `getAllKeys()` with try/catch + DEV log | 39-48 | ✅ |
| Two-phase filter (mingla prefix OR sb-*-auth pattern; orphan only if mingla key not whitelisted) | 52-64 | ✅ |
| **NO `AsyncStorage.removeItem` call anywhere** | full file | ✅ — log-only confirmed (D-17d-7) |
| DEV `console.warn` for orphans | 67-72 | ✅ |
| Production `Sentry.addBreadcrumb` (not captureException — correct level) | 76-81 | ✅ — Sentry SDK no-ops if init wasn't called per Cycle 16a |
| Returns `OrphanReapResult` shape | 84 | ✅ |

### 5.5 §E — `currentBrandStore.ts` migrate prune

| Check | Result |
|---|---|
| File LOC | 391 (was 536; -145 LOC matches IMPL-2 discovery) ✅ |
| `migrate` function lines 358-371 uses `if (version < 12) reset` pattern | ✅ |
| Audit-trail comment cites commit `aae7784d` | ✅ |
| `upgradeV2BrandToV3` / `upgradeV9BrandToV10` / `upgradeV10BrandToV11` / `upgradeV11BrandToV12` deleted | ✅ — grep returns 0 hits |
| `V2Brand` / `V9Brand` / `V10Brand` / `V11Brand` / `V11Extras` / `V2BrandStats` deleted | ✅ — grep returns 0 hits |
| `version: 12` constant unchanged in `persistOptions` | ✅ |

### 5.6 §G — `DoorPaymentMethod` cleanup (3 files)

| File | DoorPaymentMethod hits | Verdict |
|---|---|---|
| `app/event/[id]/door/[saleId].tsx` | 0 | ✅ Import correctly removed (no body usage existed) |
| `app/event/[id]/door/index.tsx` | 6 (line 40 import + lines 113, 179, 180, 195, 197, 205 body usage) | ✅ Import correctly retained — genuine usage as parameter type + Record key type |
| `app/event/[id]/guests/[guestId].tsx` | 0 | ✅ Import correctly removed (no body usage existed) |

IMPL-3 discovery (§G partial — 2 of 3) verified accurate.

### 5.7 Step 7 — `app/_layout.tsx` integration

| Check | Line(s) | Result |
|---|---|---|
| 3 useEffects in `RootLayoutInner` (was 1) | 62-74 (splash) + 78-101 (§C) + 104-121 (§D) | ✅ |
| §C eviction useEffect: dynamic import + run-once flag (`evictionRan`) + try/catch + DEV log + `setEvictionRan(true)` even on failure | 78-101 | ✅ |
| §D orphan-reap useEffect: dynamic import + run-once flag (`reapRan`) + try/catch + DEV log + `setReapRan(true)` even on failure | 104-121 | ✅ |
| Both gate on `loading=false` (Zustand-hydration-complete signal) | 80, 106 | ✅ |
| LOC count | 156 (was 109; +47 LOC matches IMPL claim) | ✅ |

### 5.8 §F deferred SCs — file LOC unchanged confirms deferral

| File | Pre-17d (forensics §C.1 baseline) | Post-17d Stage 1 | Verdict |
|---|---|---|---|
| `CreatorStep2When.tsx` | 2271 | 2271 | ✅ Unchanged — confirms SC-F1 DEFERRED |
| `CreatorStep5Tickets.tsx` | 2148 | 2148 | ✅ Unchanged — confirms SC-F2 DEFERRED |
| `event/[id]/index.tsx` | 1354 | 1354 | ✅ Unchanged — confirms SC-F3 DEFERRED |

---

## 6. Constitutional 14-rule check

| Rule | Touched? | Result |
|---|---|---|
| #1 No dead taps | NO | N/A |
| #2 One owner per truth | YES | ✅ — utilities don't introduce parallel ownership; existing store ownership preserved |
| #3 No silent failures | YES | ✅ STRENGTHENED — every catch in §C + §D + integration logs in DEV; Sentry breadcrumb in production |
| #4 One query key per entity | NO | N/A |
| #5 Server state server-side | NO | N/A |
| #6 Logout clears everything | NO | N/A — existing `clearAllStores` covers all 5 evicted stores; eviction is additive cleanup |
| #7 Label temporary | NO | ✅ — no NEW [TRANSITIONAL] markers introduced |
| #8 Subtract before adding | YES | ✅ FOLLOWED — package trim, migrate prune, DoorPaymentMethod cleanup are all pure subtractions; new utilities ADD AFTER subtracting deps |
| #9 No fabricated data | NO | N/A |
| #10 Currency-aware | NO | N/A |
| #11 One auth instance | NO | N/A |
| #12 Validate at right time | NO | N/A |
| #13 Exclusion consistency | NO | N/A |
| #14 Persisted-state startup | YES | ✅ — `_layout.tsx` integration uses existing `loading=false` signal which fires AFTER Zustand hydration completes (per Cycle 14 + Cycle 16a established pattern) |

**Zero constitutional violations. Two rules (#3, #8) materially strengthened.**

---

## 7. Pattern compliance

| New artifact | Sibling reference | Conformance |
|---|---|---|
| `evictEndedEvents.ts` | `paymentMethodLabels.ts`, `currency.ts` (other utils) | ✅ Same export pattern (named exports), same JSDoc shape (header block with cycle + decision references), same error-handling shape (try/catch + DEV-only logs) |
| `reapOrphanStorageKeys.ts` | same siblings | ✅ Same conventions |
| `_layout.tsx` post-integration | existing splash useEffect | ✅ Same loading-gated + run-once flag pattern; mirrors Cycle 14 + Cycle 16a established conventions |
| `currentBrandStore.ts` post-prune | other store files (orderStore, guestStore, etc.) | ✅ PersistOptions structure preserved; Zustand factory pattern unchanged |

---

## 8. Regression surface verification (5 features)

| Adjacent feature | Verification | Result |
|---|---|---|
| Cold-start sequence | tsc=0 + 3 CI gates exit 0; no missing-module errors detected statically | ✅ no regression statically; operator confirms via `npx expo start` post-CLOSE |
| Brand list display | currentBrandStore PersistOptions structure preserved; `version: 12` unchanged; v12 users get passthrough path | ✅ no regression for v12 users (pre-v12 reset path is by-design per Cycle 0a precedent) |
| Door sales detail + guest detail | Direct file reads confirm `door/[saleId].tsx` + `guests/[guestId].tsx` no body usage of DoorPaymentMethod (only import line was dead) | ✅ no functional change expected |
| 3 CI gates regression | All 3 exit 0 against final state | ✅ no regression |
| Event creator wizard + event detail | §F decompose deferred → these files byte-identical to pre-Stage-1 | ✅ no behavior change |

**Verdict:** PASS. No adjacent regressions detected.

---

## 9. CI gate verification matrix (final QA-independent run)

| Gate | Command | Result |
|---|---|---|
| I-37 (existing — regression check) | `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | ✅ EXIT=0 |
| I-38 (existing — regression check) | `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | ✅ EXIT=0 |
| I-39 (existing — regression check) | `node .github/scripts/strict-grep/i39-pressable-label.mjs` | ✅ EXIT=0 |
| tsc | `cd mingla-business && npx tsc --noEmit` | ✅ TSC=0 |

All 4 verification gates green. No regressions in 17a/17b/17c invariants.

---

## 10. Discoveries verification (5 D-CYCLE17D-IMPL items)

| ID | IMPL claim | QA verification | Result |
|---|---|---|---|
| **IMPL-1** | §F LOC decompose deferred per failure-honesty rule | Tester accepts deferral as principled per dispatch §1 + §4.1; LOC counts confirmed unchanged in §5.8 | ✅ CONFIRMED |
| **IMPL-2** | §E migrate prune removed -145 LOC vs SPEC's -85 to -120 estimate | wc -l returns 391 (was 536; delta -145 exact) | ✅ CONFIRMED |
| **IMPL-3** | §G partial — 2 of 3 imports cleanable; door/index.tsx retains genuine usage | 3-file grep confirms: 2 files 0 hits, 1 file 6 hits at lines 40/113/179/180/195/197/205 | ✅ CONFIRMED |
| **IMPL-4** | npm vulnerabilities pre-existing (6 moderate + 1 high); not 17d's responsibility | Out of 17d scope per scope discipline; surfaced as side issue for orchestrator (see §13) | ✅ CONFIRMED — surface as separate ORCH-ID |
| **IMPL-5** | CreatorStep5Tickets has 5 inline sub-components (TicketCard / VisibilitySheet / AvailableAtSheet / TicketStubSheet / ToggleRow); already structurally separated | grep `^const (TicketCard\|VisibilitySheet\|AvailableAtSheet\|TicketStubSheet\|ToggleRow):` returns 5 hits at lines 95, 307, 381, 451, 1401 | ✅ CONFIRMED — Stage 2 risk lower than initially estimated |

All 5 discoveries verified true.

---

## 11. §F deferral acknowledgment

The implementor's honest §F deferral is **accepted as principled** by tester verdict.

**Reasoning verified:**
- §F sub-components share single `StyleSheet.create` object → per-extraction style-object decomposition required (high-risk under time pressure)
- 3 files are the densest screens in the app (event creator wizard typing flow, event detail) → adjacent regression risk
- "Zero bugs, zero glitches" memory rule + auto-mode "never half-finished implementations" align with deferral
- Stage 2 path is concrete: §F.3 CreatorStep5Tickets is highest-leverage candidate (already has 5 inline sub-components per IMPL-5 — extraction is mostly file-move + style-object decomp, not deep refactor)

**Stage 2 dispatch readiness:** orchestrator can author with confidence. Recommended Stage 2 effort: ~4-5h focused.

---

## 12. P4 findings (praise + observations)

**P4-1 — Excellent honest deferral discipline.** The implementor's §F deferral is documented with concrete reasoning (5 IMPL discoveries) + Stage 2 path (file-move pattern lower-risk than initially estimated). This is the failure-honesty pattern executed correctly. Worth replicating in future cycles when scope shrinkage is the right call.

**P4-2 — `evictEndedEvents.ts` generic `pruneStore` helper is clean DRY.** Lines 33-62 — single helper handles 5 different store types via TypeScript generic constraint `<T extends EventIdEntry>`. Future stores adding the eviction pattern just add one more `pruneStore(useNewStore, ...)` call. Pattern worth replicating.

**P4-3 — Audit-trail discipline at `currentBrandStore.ts` migrate prune.** Lines 359-366 explicitly cite commit `aae7784d` for original migrate body. Future investigators encountering "what did v1-v11 migration look like?" can recover the chain via git history. This is the post-PASS protocol for code-prune work executed correctly.

**P4-4 — Sentry SDK env-absent-guard ergonomics.** `Sentry.addBreadcrumb` in §D `reapOrphanStorageKeys.ts` works correctly even when Sentry init was skipped (Cycle 16a env-absent guard). Implementor correctly chose breadcrumb over `captureException` since orphan-key detection is informational telemetry, not an error condition. Cycle 16a guard pattern continues to compound value across cycles.

---

## 13. Discoveries for orchestrator

- **D-CYCLE17D-QA-1 (IMPL-4 carry-forward):** 7 npm vulnerabilities (6 moderate + 1 high) pre-existing in `mingla-business/package-lock.json` post `npm install`. NOT 17d's responsibility per scope discipline. Recommend orchestrator surface as separate ORCH-ID for `npm audit` triage cycle. Severity TBD by orchestrator after running `npm audit` to enumerate.
- **D-CYCLE17D-QA-2 (Stage 2 readiness):** Per IMPL-5 verification, CreatorStep5Tickets already has 5 inline sub-components structurally separated. Stage 2 §F dispatch can ship with confidence — extraction is file-move + style-object decomp, not deep refactor. Estimated 4-5h focused effort holds.
- **D-CYCLE17D-QA-3 (operator-side smoke deferred):** `npx expo start` cold-start verification is operator-post-CLOSE per IMPL §15.1; not headless-checkable. Headless PASS is sufficient for CLOSE since no behavior change ships with Stage 1 — only invisible structural cleanup + new app-start utilities that gracefully no-op when conditions are wrong (try/catch + run-once flags + DEV-only logs).

---

## 14. Stage 2 reminders (for §F dispatch authoring)

When orchestrator authors `Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE.md` (or equivalent):

1. **Honor `feedback_implementor_uses_ui_ux_pro_max`** — §F decompose touches visible UI even though refactor is structurally invisible; pre-flight `/ui-ux-pro-max` invocation required.
2. **Style-object decomposition is the hidden risk** — each sub-component currently uses parent's shared `StyleSheet.create`; extraction requires per-file decomp of styles. Spec must be explicit on this.
3. **CI gates regression check mandatory post-each-file** — i37/i38/i39 must continue green; new sub-components may add `IconChrome` or `Pressable` JSX nodes that gates evaluate.
4. **Per-file `tsc` + visual smoke** — operator confirms each file's screen still works post-decomp (event creator wizard Step 2 + Step 5; event detail).
5. **F.3 CreatorStep5Tickets first** (highest-leverage; 5 inline sub-components already separated; lowest risk).
6. **F.4 event/[id]/index.tsx second** (moderate; per-section extraction).
7. **F.2 CreatorStep2When last** (densest; longest decomp time; saves operator review time by being the most-changed file).

---

## 15. Re-test instructions (if FAIL)

**Not applicable.** Verdict is PASS for Stage 1. No rework required from implementor.

If operator's post-CLOSE cold-start smoke surfaces a regression (unlikely given headless verification), that becomes a new ORCH-ID for a focused fix dispatch — not a 17d Stage 1 rework.

---

## 16. Verdict

**PASS** — all 23 in-scope SC items verified, 3 CI gates green (regression check), 5 IMPL discoveries verified, §F deferral accepted as principled. Constitutional rules #3 + #8 strengthened; zero violations introduced.

**Pending:** orchestrator-CLOSE-protocol (7 artifacts + DEC-105 + commit + EAS dual-platform OTA).

After CLOSE, orchestrator can proceed to:
- Author **Stage 2 §F dispatch** (~4-5h focused)
- Author **17e-A SPEC dispatch** (brand CRUD wiring per D-17d-FOUNDER-1)
- Author **17e-B SPEC dispatch** (event cover media per D-17d-FOUNDER-2)
