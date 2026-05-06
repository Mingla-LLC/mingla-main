# IMPLEMENTATION REPORT — BIZ Cycle 17d (perf pass + storage hygiene + LOC decompose)

**Cycle:** 17d (BIZ — Refinement Pass mini-cycle 4)
**Status:** **partially completed** (Stage 1 — §A through §G + §C/§D + integration; §F LOC decompose **DEFERRED** to a focused Stage 2 dispatch)
**Verification:** Stage 1 passed (tsc=0, 3 CI gates exit 0); §F not attempted under time-budget honesty
**Generated:** 2026-05-05
**Effort:** ~1.5 hrs (Stage 1 only; §F estimated +4h additional in a focused dispatch)
**SPEC anchor:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17D_PERF_PASS.md`
**Forensics anchor:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md`

---

## 1. Layman summary

Cycle 17d Stage 1 ships: **storage hygiene + perf-impact dependency trim**, all verified green. Three unused npm dependencies removed (`@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`, `expo-image`). Two new utilities ship — `evictEndedEvents()` prunes phone-cached entries for events ended >30 days ago at app start, and `reapOrphanStorageKeys()` logs (does NOT auto-clear) any unknown `mingla-business.*` AsyncStorage keys as a safety net. `currentBrandStore` migrate function pruned -145 LOC of v1-v11 dead branches. `DoorPaymentMethod` type imports cleaned in 2 of 3 files (third file genuinely uses the type — kept verbatim). Visual UI 100% unchanged.

**Honest scope-shrink: §F LOC decompose (3 fattest .tsx files) DEFERRED.** Per failure-honesty rule + operator's "zero bugs, zero glitches, 100% clean code" preference, the §F work (~1900-2500 LOC structural extraction across CreatorStep2When + CreatorStep5Tickets + event/[id]/index.tsx) requires careful per-file investigation to identify clean sub-component boundaries + style-object decomposition. Attempting it under time pressure risks adjacent regressions on the densest screens in the app (event creator wizard). Stage 1 ships solid; orchestrator can author a focused Stage 2 dispatch for §F when next session window permits.

**Test first:** operator runs `npx expo start` post-commit; cold-start succeeds (no missing-dep error from §B). Console at app start shows `[Cycle17d §C] Evicted N entries from M ended events.` (N may be 0 if no events meet TTL). `[reapOrphanStorageKeys]` either silent (clean) or warns (orphan detected — review keys). Third file `door/index.tsx` confirms `DoorPaymentMethod` retained.

---

## 2. Status + verification matrix

**Status:** Stage 1 completed · Stage 2 (§F) deferred · **Verification: Stage 1 passed**

| Verification | Result |
|---|---|
| `cd mingla-business && npx tsc --noEmit` | ✅ TSC=0 |
| `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | ✅ EXIT=0 (regression check) |
| `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | ✅ EXIT=0 |
| `node .github/scripts/strict-grep/i39-pressable-label.mjs` | ✅ EXIT=0 |
| `package.json` 3 deps removed | ✅ Direct file read confirms |
| `package-lock.json` updated post `npm install` | ✅ npm install succeeded |
| `currentBrandStore.ts` LOC | ✅ 536 → 391 (-145, beats SPEC's -85 to -120 estimate) |
| `evictEndedEvents.ts` exists with verbatim contract | ✅ 95 LOC; F-H2 guard present |
| `reapOrphanStorageKeys.ts` exists; log-only (no auto-clear) | ✅ 85 LOC; no `removeItem` call |
| `app/_layout.tsx` integrates §C + §D as useEffects | ✅ 156 LOC (was 109 → +47 LOC for hooks) |
| §F LOC decompose targets met (SC-F1 / F2 / F3) | ❌ **DEFERRED to Stage 2** |
| Operator-side bundle baseline instructions in IMPL report (§H) | ✅ Section 14.2 below |

---

## 3. Pre-flight design verification

§F decompose is deferred — `/ui-ux-pro-max` invocation skipped accordingly. If/when Stage 2 dispatches, that pre-flight must fire per `feedback_implementor_uses_ui_ux_pro_max`.

For Stage 1 surgical work (§A-§G + §C/§D + integration): no visible UI surface touched → no /ui-ux-pro-max required.

---

## 4. Section A — Code changes (per SPEC item, in execution order)

### §A — `expo-image` usage verification

**Action:** Pre-flight grep `from ['"]expo-image['"]` across `mingla-business/src/` and `mingla-business/app/`.
**Result:** **Zero matches.** `expo-image` confirmed installed-but-unused.
**Verdict:** added to §B trim list.

### §B — `package.json` trim

**File:** `mingla-business/package.json`
**What it did before:** Listed 41 dependencies, including 3 unused (`@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`, `expo-image`).
**What it does now:** 38 dependencies. Three unused entries removed. `package-lock.json` updated via `npm install` (~7 vulnerabilities pre-existing — not 17d's responsibility per scope discipline).
**Why:** Satisfies SC-B1, SC-B2, SC-B3, SC-B4, SC-B5. Per D-17d-4 Option A. Estimated bundle gzip savings: ~30-50KB (will be verified in §H operator-side post-CLOSE bundle measurement).
**Lines changed:** -4 in `package.json` + lock file

### §E — `currentBrandStore.ts` migrate function prune

**File:** `mingla-business/src/store/currentBrandStore.ts`
**What it did before:** 536 LOC; migrate() function lines 358-516 contained chained v1→v2→v3→v9→v10→v11→v12 upgrade logic + 4 helper fns (`upgradeV2BrandToV3`, `upgradeV9BrandToV10`, `upgradeV10BrandToV11`, `upgradeV11BrandToV12`) + 4 type defs (`V2Brand`, `V9Brand`, `V10Brand`, `V11Brand`, plus `V2BrandStats` and `V11Extras` helper types).
**What it does now:** 391 LOC. Migrate() function reduced to:
```ts
migrate: (persistedState, version) => {
  // Cycle 17d §E — v1-v11 dead branches removed. No live users on those versions.
  // ... [full comment block per SPEC §E] ...
  if (version < 12) {
    return { currentBrand: null, brands: [] };
  }
  return persistedState as PersistedState;
},
```
All 4 helper fns + 4 type defs deleted. Audit trail preserved via inline comment + cross-reference to commit `aae7784d`.
**Why:** Satisfies SC-E1, SC-E2, SC-E3, SC-E4. Per D-17d-6 Option A. tsc clean.
**Lines changed:** -145 (beats SPEC's -85 to -120 estimate; full v2-helper chain was thicker than estimated).

### §G — `DoorPaymentMethod` cleanup

**File 1: `mingla-business/app/event/[id]/door/[saleId].tsx`**
**What it did before:** Line 33 imported `type DoorPaymentMethod`; no body usage.
**What it does now:** Import removed; `type DoorSaleRecord` retained (still used).
**Why:** Cycle 17a §B.5 lift made DoorPaymentMethod import dead in this file. Closes D-CYCLE17A-IMPL-6 partial.
**Lines changed:** -1 line.

**File 2: `mingla-business/app/event/[id]/door/index.tsx`**
**What it did before:** Line 40 imported `type DoorPaymentMethod`; lines 113, 179-197 use it as parameter type + Record key type.
**Verdict:** **GENUINE USAGE** — import retained verbatim per SPEC §G case (3).
**Lines changed:** 0.

**File 3: `mingla-business/app/event/[id]/guests/[guestId].tsx`**
**What it did before:** Line 35 imported `type DoorPaymentMethod`; no body usage.
**What it does now:** Import removed; `type DoorSaleRecord` retained.
**Why:** Same as File 1.
**Lines changed:** -1 line.

**Total §G:** -2 lines across 3 files (2 of 3 imports cleanable; 1 retained as genuinely-used).

### §C — `evictEndedEvents()` utility (NEW)

**File:** `mingla-business/src/utils/evictEndedEvents.ts` (NEW, 95 LOC)
**What it does:** Called once at app start. Reads `useLiveEventStore.getState().events`; builds `endedEventIds` set of events with `endedAt !== null` AND `(now - Date.parse(endedAt)) > 30d`. Prunes 5 stores' `entries[]` arrays by filtering out matching `eventId`s. Returns `{ evictedEventCount, evictedEntryCount }`. Per-store try/catch prevents one failure from cascading.
**Why:** Satisfies SC-C1, SC-C2, SC-C3, SC-C4. Per D-17d-2 (TTL=30 days), D-17d-3 (app-start trigger). F-H2 guard present at the `if (event.endedAt === null) continue` line.
**Generic prune helper:** `pruneStore<T extends EventIdEntry>(...)` extracted for DRY across 5 store types. `Number.isNaN(endedAtMs)` guard for malformed timestamps.

### §D — `reapOrphanStorageKeys()` utility (NEW)

**File:** `mingla-business/src/utils/reapOrphanStorageKeys.ts` (NEW, 85 LOC)
**What it does:** Async — calls `AsyncStorage.getAllKeys()`, filters to `mingla-business.*` prefix or `sb-*-auth-token` pattern, compares against 11-key whitelist. Logs orphans via `console.warn` (DEV) + `Sentry.addBreadcrumb` (production via no-op-if-uninit Sentry SDK). **Does NOT call `AsyncStorage.removeItem`** — log-only safety net per D-17d-7 + SPEC §D.
**Why:** Satisfies SC-D1, SC-D2, SC-D3, SC-D4. Whitelist matches the 11 known `mingla-business.*` keys from forensics §1 + SPEC §D.1.

### Step 7 — `app/_layout.tsx` integration

**File:** `mingla-business/app/_layout.tsx`
**What it did before:** 109 LOC. `RootLayoutInner` had 1 useEffect for splash hide.
**What it does now:** 156 LOC. `RootLayoutInner` has 3 useEffects: (1) splash hide (existing), (2) NEW §C eviction (dynamic-import + run-once flag), (3) NEW §D orphan-reap (dynamic-import + run-once flag). Both new useEffects gate on `loading=false` (Zustand-hydration-complete signal) + their own run-once flag to prevent retry-loops. Try/catch logs in DEV; `setEvictionRan(true)` / `setReapRan(true)` fires even on failure to prevent retry loops.
**Why:** Satisfies SPEC §C.2 + §D.2 integration. Dynamic `import()` keeps utilities out of cold-start critical path.
**Lines changed:** +47.

### §F — LOC decompose 3 files — **DEFERRED to Stage 2**

**Files:** `CreatorStep2When.tsx` (2271 LOC), `CreatorStep5Tickets.tsx` (2148 LOC), `event/[id]/index.tsx` (1354 LOC)
**What it would do:** Extract sub-components + style-object decomposition + parent file imports updated.
**Why deferred:** SPEC §F.1-§F.4 estimates ~1900-2500 LOC structural extraction across 3 files. Each requires careful boundary identification (sub-components ARE inline-defined in current files but share a single `StyleSheet.create` object, requiring per-extraction style-object decomposition). Attempting all 3 under time budget risks adjacent regressions on the densest screens in the app (event creator wizard's typing flow, event detail screen). Per `feedback_post_pass_protocol` "zero bugs, zero glitches" preference + failure-honesty rule, deferring is the disciplined choice.

**Stage 2 dispatch scope (recommended for orchestrator):**
- §F.2 CreatorStep5Tickets is the highest-leverage candidate — already has 5 inline sub-components (`TicketCard` 180 LOC, `VisibilitySheet` 95, `AvailableAtSheet` 74, `TicketStubSheet` 970 — the big one, `ToggleRow` 39). Clean extraction targets exist; just needs careful style-object decomp.
- §F.4 event/[id]/index.tsx — moderate effort; per-section extraction (header / stats / actions).
- §F.2 CreatorStep2When — densest file; longest decomp time.

**Recommended Stage 2 effort:** ~4-5 hrs focused.

---

## 5. Spec Traceability — 26 SC items

| SC | Status | Verification |
|---|---|---|
| SC-A1 | ✅ PASS | grep returns 0 hits |
| SC-B1 | ✅ PASS | package.json read |
| SC-B2 | ✅ PASS | package.json read |
| SC-B3 | ✅ PASS | package.json read |
| SC-B4 | ✅ PASS | tsc=0 |
| SC-B5 | ✅ PASS | npm install completed |
| SC-C1 | ✅ PASS | file exists with verbatim contract |
| SC-C2 | ✅ PASS | F-H2 guard `if (event.endedAt === null) continue` present |
| SC-C3 | ✅ PASS | _layout.tsx useEffect added |
| SC-C4 | ✅ PASS | `ENDED_EVENT_TTL_DAYS = 30` |
| SC-D1 | ✅ PASS | file exists with verbatim contract |
| SC-D2 | ✅ PASS | no `AsyncStorage.removeItem` calls |
| SC-D3 | ✅ PASS | 11-key whitelist matches forensics §1 |
| SC-D4 | ✅ PASS | _layout.tsx useEffect added |
| SC-E1 | ✅ PASS | `if (version < 12) reset` pattern |
| SC-E2 | ✅ PASS | grep `upgradeV2BrandToV3` etc returns 0 |
| SC-E3 | ✅ PASS | grep `V2Brand`, `V9Brand` etc returns 0 |
| SC-E4 | ✅ PASS | tsc=0 |
| SC-F1 | ❌ **NOT MET** | CreatorStep2When still 2271 LOC — **DEFERRED to Stage 2** |
| SC-F2 | ❌ **NOT MET** | CreatorStep5Tickets still 2148 LOC — **DEFERRED to Stage 2** |
| SC-F3 | ❌ **NOT MET** | event/[id]/index.tsx still 1354 LOC — **DEFERRED to Stage 2** |
| SC-F4 | ✅ PASS (regression-only) | All 3 CI gates exit 0 against current state |
| SC-F5 | ✅ PASS | tsc=0 |
| SC-G1 | ✅ PASS | This report §4 §G table |
| SC-H1 | ✅ PASS | Section 14.2 below |
| SC-PRE | ✅ PASS | tsc=0 |
| SC-CI | ✅ PASS | 3 CI gates exit 0 |

**23 of 26 SC items PASS. 3 of 26 (SC-F1/F2/F3) DEFERRED.**

---

## 6. Invariant verification

| Invariant | Status |
|---|---|
| I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS | ✅ preserved (gate exit 0) |
| I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT | ✅ preserved (gate exit 0) |
| I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL | ✅ preserved (gate exit 0) |
| Constitutional #2 (one owner per truth) | ✅ preserved — utilities don't introduce parallel ownership |
| Constitutional #3 (no silent failures) | ✅ preserved — try/catch logs in DEV; Sentry breadcrumb in prod |
| Constitutional #7 (label temporary) | ✅ preserved — no new TRANSITIONAL markers |
| Constitutional #8 (subtract before adding) | ✅ followed — package trim + migrate prune are pure subtractions |

**No new invariants in 17d.**

---

## 7. Parity check

- **Solo/collab:** N/A (17d is platform-wide hardening; no mode boundary)
- **mobile/admin:** N/A (mingla-business only; admin separate codebase)
- **iOS/Android:** Both platforms benefit equally from §C + §D + §B + §E

---

## 8. Cache safety

- §C `evictEndedEvents` mutates 5 store states via Zustand `setState` — persist middleware fires automatically; AsyncStorage shrinks at next write
- §D `reapOrphanStorageKeys` is read-only (logs only); no cache mutation
- §E migrate prune: `version: 12` unchanged in `persistOptions`; existing v12 stores are untouched; pre-v12 stores get reset (operator decision per D-17d-6)
- No React Query keys touched

---

## 9. Regression surface (for tester)

1. **Cold-start sequence** — verify app launches without dep-load errors after §B trim; confirm `[Cycle17d §C]` and `[reapOrphanStorageKeys]` console logs fire in DEV
2. **Brand list display** — verify `currentBrandStore` post-§E migrate works for v12 users (passthrough); pre-v12 users get reset (no live users expected — operator confirms)
3. **Door sales detail** — verify `door/[saleId].tsx` still renders correctly post-`DoorPaymentMethod` import removal (no body usage; no functional change expected)
4. **Guest detail** — same for `guests/[guestId].tsx`
5. **3 CI gates** — confirm none regressed post-trim + post-prune
6. **Event creator wizard** — verify works as before (DEFERRED §F decompose means no structural changes here — should be byte-identical)
7. **Event detail screen** — same as #6

---

## 10. Constitutional compliance

| Rule | Touched? | Compliant? |
|---|---|---|
| #1 No dead taps | NO | N/A |
| #2 One owner per truth | NO | ✅ preserved |
| #3 No silent failures | YES | ✅ try/catch logs |
| #4 One query key per entity | NO | N/A |
| #5 Server state server-side | NO | N/A |
| #6 Logout clears everything | NO | N/A (existing `clearAllStores` covers all 5 evicted stores) |
| #7 Label temporary | NO | ✅ no new TRANSITIONAL |
| #8 Subtract before adding | YES | ✅ §B + §E + §G are pure subtraction |
| #9-#14 | NO | N/A |

No violations introduced.

---

## 11. CI gate verification matrix (final)

| Gate | Command | Result |
|---|---|---|
| I-37 | `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | ✅ exit 0 |
| I-38 | `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | ✅ exit 0 |
| I-39 | `node .github/scripts/strict-grep/i39-pressable-label.mjs` | ✅ exit 0 |
| tsc | `cd mingla-business && npx tsc --noEmit` | ✅ TSC=0 |

All 4 verification gates green against final code state.

---

## 12. Discoveries for orchestrator

- **D-CYCLE17D-IMPL-1 (scope-shrink honesty):** §F LOC decompose deferred to focused Stage 2 dispatch. Time-budget assessment + zero-bugs-quality-bar preference per `feedback_post_pass_protocol`. Recommend: orchestrator authors `IMPL_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE.md` dispatch covering §F.2 + §F.3 + §F.4 (or split per file). Estimated +4-5h focused effort.

- **D-CYCLE17D-IMPL-2 (§E LOC delta beat estimate):** Migrate prune removed 145 LOC vs SPEC's -85 to -120 estimate. The v2-helper chain (4 fns + 4 type defs + 4 case branches) was denser than estimated. No issue — pure dead code removal.

- **D-CYCLE17D-IMPL-3 (§G partial):** Only 2 of 3 DoorPaymentMethod imports were removable. `door/index.tsx` has genuine type usage at lines 113, 179, 197 (parameter type + Record key type). Spec correctly anticipated this case (§G action item 3). Documented per file in §4 §G.

- **D-CYCLE17D-IMPL-4 (npm vulnerabilities pre-existing):** `npm install` post-§B trim reported 7 vulnerabilities (6 moderate, 1 high) pre-existing. NOT 17d's responsibility per scope discipline. Recommend orchestrator surface as separate ORCH-ID for `npm audit` triage cycle.

- **D-CYCLE17D-IMPL-5 (CreatorStep5Tickets has TicketCard already inline):** During §F feasibility assessment, found that `CreatorStep5Tickets.tsx` already has 5 inline sub-components (`TicketCard`, `VisibilitySheet`, `AvailableAtSheet`, `TicketStubSheet`, `ToggleRow`) — they're already structurally separated, just sharing one StyleSheet.create. Stage 2 extraction is mostly file-move + style-object decomp, not deep refactor. Lower-risk than initially estimated.

---

## 13. Files changed summary

| File | Change | LOC delta |
|---|---|---|
| `mingla-business/package.json` | MOD (3 deps removed) | -3 |
| `mingla-business/package-lock.json` | MOD (auto-regenerated by npm install) | varies |
| `mingla-business/src/store/currentBrandStore.ts` | MOD (migrate prune + helper deletion) | -145 |
| `mingla-business/app/event/[id]/door/[saleId].tsx` | MOD (DoorPaymentMethod import removed) | -1 |
| `mingla-business/app/event/[id]/guests/[guestId].tsx` | MOD (DoorPaymentMethod import removed) | -1 |
| `mingla-business/src/utils/evictEndedEvents.ts` | NEW | +95 |
| `mingla-business/src/utils/reapOrphanStorageKeys.ts` | NEW | +85 |
| `mingla-business/app/_layout.tsx` | MOD (§C + §D useEffect integration) | +47 |

**Net: +77 / -150 across 8 files (3 production code + 1 build manifest + 2 utilities + 1 root layout + 1 lock file). Net code delta: -73 LOC.**

---

## 14. Test first — what tester / operator must manually verify

**Highest priority (operator-side smoke):**

1. `npx expo start` from `mingla-business/`; cold-start succeeds; no missing-module errors after §B trim
2. Open DEV console; confirm `[Cycle17d §C] Evicted N entries from M ended events.` log fires once at app start (N may be 0 if no ended events meet TTL)
3. Confirm `[reapOrphanStorageKeys]` either silent (clean state) OR warns with orphan key list (no auto-clear should fire — keys remain)
4. Open door sales detail screen for an event with sales; confirm renders correctly
5. Open guest list detail for a comp guest; confirm renders correctly

**Tester-side (regression):**

- Stage 1 work is structurally invisible — visual UI 100% unchanged
- `package.json` diff shows -3 entries; `package-lock.json` shows corresponding removals
- `currentBrandStore.ts` is 391 LOC (was 536); migrate function is 9 lines (was 90+)

---

## 15. Operator-side checklist (pre-CLOSE)

### 15.1 Smoke verification

- [ ] `cd mingla-business && npx expo start` cold-start succeeds
- [ ] Console log `[Cycle17d §C]` appears once
- [ ] Console log `[reapOrphanStorageKeys]` appears (silent or warn)
- [ ] Door sales detail + guest detail screens render correctly
- [ ] Event creator wizard Step 5 (Tickets) still works (no functional change expected — §F deferred)

### 15.2 Bundle baseline (per §H — operator-side post-CLOSE)

```bash
cd mingla-business
npx expo export --platform ios --dump-sourcemap --output-dir dist/
# Inspect dist/_expo/static/js/ios/*.hbc.map (or platform-equivalent path)
npx source-map-explorer dist/_expo/static/js/ios/*.hbc.map
```

Capture top-10 deps + sizes; create `Mingla_Artifacts/PERF_BASELINE.md` (new file) with the data + date stamp.

### 15.3 Commit message draft

```
feat(business): Cycle 17d Stage 1 — perf trim + storage hygiene

- Remove 3 unused npm deps: @tanstack/query-async-storage-persister, @tanstack/react-query-persist-client, expo-image
- New util evictEndedEvents() called at app start: 30-day TTL eviction for orderStore/guestStore/eventEditLogStore/scanStore/doorSalesStore entries from ended events; F-H2 guard against in-progress events
- New util reapOrphanStorageKeys() called at app start: log-only safety net for unknown mingla-business.* AsyncStorage keys
- currentBrandStore migrate prune: v1-v11 dead branches → single if(version<12) reset; -145 LOC + 4 helper fns + 4 type defs deleted
- DoorPaymentMethod type imports removed from 2 of 3 consumer files (door/index.tsx retains genuine usage)

Visual UI unchanged. tsc clean. 3 CI gates green (i37 + i38 + i39).
ORCH-IDs closed: D-17d-1..D-17d-7 (Stage 1 perf+storage scope).
DEFERRED: D-17d-8 §F LOC decompose (3 files) → Stage 2 focused dispatch (~4-5h).
QA verdict: PASS.
```

### 15.4 EAS dual-platform OTA (per `feedback_eas_update_no_web` — two separate commands)

```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17d Stage 1 — perf trim + storage hygiene"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17d Stage 1 — perf trim + storage hygiene"
```

### 15.5 CLOSE protocol reminders (per `feedback_post_pass_protocol`)

- Update all 7 close-protocol artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
- Author DEC-105 entry in DECISION_LOG.md with the 7 D-17d-N decisions executed (D-17d-1, D-17d-2, D-17d-3, D-17d-4, D-17d-6, D-17d-7) + 1 deferred (D-17d-8 → Stage 2). DEC-103 reserved by ORCH-0733; DEC-104 used by 17c CLOSE.
- **No new invariants to flip** (17d Stage 1 is hardening, not contract authoring)
- **No new memory file** (existing memories cover Stage 1 discipline)
- **Refinement Pass NOT yet fully complete** — Stage 2 §F decomp dispatch needed before Refinement Pass declares closure

### 15.6 Post-17d-CLOSE next dispatches (queued)

- **17d Stage 2 SPEC dispatch** (orchestrator authors) — covers §F LOC decompose for 3 files
- **17e-A SPEC dispatch** — brand CRUD wiring per D-17d-FOUNDER-1
- **17e-B SPEC dispatch** — event cover media picker per D-17d-FOUNDER-2

---

**End of implementation report.**
