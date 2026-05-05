# QA REPORT — Cycle 17d Stage 2 (§F LOC decompose)

**Cycle:** 17d Stage 2 (BIZ — completes Refinement Pass mini-cycle 4)
**Mode:** TARGETED + SPEC-COMPLIANCE (combined per dispatch §2)
**Dispatch anchor:** `Mingla_Artifacts/prompts/QA_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE.md`
**SPEC anchor:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17D_PERF_PASS.md` §F
**IMPL anchor:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17D_STAGE2_LOC_DECOMPOSE_REPORT.md`
**Tested:** 2026-05-05

---

## 1. Layman summary

The implementor split 3 of mingla-business's largest screen files into 6 focused
sibling sub-components. I verified independently: tsc clean, all 3 strict-grep
CI gates green, all 3 LOC numbers match the implementor's claims exactly, and
the structural rules (sub-sheet positioning, no cross-file style imports,
ActivityEvent type completeness, no broken external consumers) all hold. Visual
identity preserved verbatim — same accessibility labels, same hitSlop values,
same conditional rendering. One non-blocking discovery: the new TicketTierCard
is wrapped in `React.memo` but the parent passes 5 inline arrow handlers, so
the memo benefit isn't realized in practice. This matches pre-Stage-2 baseline
behavior (TicketCard wasn't memoized before either), so it's not a regression
— flagging as a non-blocking discovery for a future polish cycle.

**No P0. No P1. Two P3 nits + one P2 discovery.**

---

## 2. Verdict

**Verdict: PASS**

| Severity | Count |
|---|---|
| P0 (CRITICAL) | 0 |
| P1 (HIGH) | 0 |
| P2 (MEDIUM) | 1 — D-CYCLE17D-S2-QA-1 (memo benefit defeated by inline arrows; non-regression) |
| P3 (LOW) | 2 — D-CYCLE17D-S2-QA-2 (historical comments reference old names); D-CYCLE17D-S2-QA-3 (D-CYCLE17D-S2-IMPL-3 unused-import cleanup verified) |
| P4 (NOTE) | 4 — praise items below |

Stage 2 is **GREEN-LIGHT for orchestrator CLOSE protocol**.

---

## 3. SC verification matrix

| SC | Implementor claim | Tester verification | Verdict |
|---|---|---|---|
| **SC-F1** | PARTIAL — parent at 1986 LOC; primary §F.2 recommendation extracted | `wc -l mingla-business/src/components/event/CreatorStep2When.tsx` returned **1986** ✅. Confirmed `<CreatorStep2WhenRepeatPickerSheet>` import at line 78. Confirmed PRESET_OPTS / WEEKDAY_OPTS / SETPOS_OPTS no longer in parent (grep returned no matches). Confirmed `formatDayOfMonth` import removed from parent (grep returned no matches). Other 4 sheets remain in parent — implementor's rationale (state-coupling cost > LOC-target benefit) accepted per dispatch §3 SC-F1 row "PARTIAL ACCEPTABLE if primary §F.2 recommendation extracted cleanly; FAIL only if the partial verdict masks a bug". No bug masked. | **PARTIAL ACCEPTED** |
| **SC-F2** | OVER-ACHIEVED — parent at 367 LOC | `wc -l mingla-business/src/components/event/CreatorStep5Tickets.tsx` returned **367** ✅. Read parent end-to-end. Only orchestration logic + summary card + add CTA + ConfirmDialog remain. Both `<TicketTierCard>` and `<TicketTierEditSheet>` imported and called at lines 47-48 + 238 + 295. Per dispatch §3 SC-F2: "PASS (over-achieved is stronger than in-range; SC's INTENT — orchestration shell — is met)". | **PASS** |
| **SC-F3** | PASS — parent at 877 LOC (target 800-1000) | `wc -l mingla-business/app/event/[id]/index.tsx` returned **877** ✅. Confirmed 3 imports from sibling files at lines 64-72. Confirmed `activityRowKey` + `ActivityEvent` type imported (not redefined inline) at lines 66-69. Confirmed 3 unused imports purged: `Icon`, `IconName`, `Pill` no longer in parent (grep returned only EventDetailHeroStatusPill match for Pill-prefix). | **PASS** |
| **SC-F4** | PASS — all 3 strict-grep gates green | Re-ran all 3 gates against final state. Output: `i37-topbar-cluster=0` `i38-icon-chrome-touch-target=0` `i39-pressable-label=0` ✅ | **PASS** |
| **SC-F5** | PASS — tsc clean | Re-ran `cd mingla-business && npx tsc --noEmit`. Exit 0, no error output ✅ | **PASS** |

---

## 4. Test case matrix (T-01 through T-17)

| T | Scenario | Expected | Actual | Verdict |
|---|---|---|---|---|
| **T-01** | tsc post-final | exit 0, no error output | TSC_EXIT=0, zero output | ✅ PASS |
| **T-02** | i37 gate | exit 0 | `i37-topbar-cluster=0` | ✅ PASS |
| **T-03** | i38 gate | exit 0 | `i38-icon-chrome-touch-target=0` | ✅ PASS |
| **T-04** | i39 gate | exit 0 | `i39-pressable-label=0` | ✅ PASS |
| **T-05** | LOC SC-F1 | 1986 ±2 | 1986 | ✅ PASS |
| **T-06** | LOC SC-F2 | 367 ±2 | 367 | ✅ PASS |
| **T-07** | LOC SC-F3 | 877 ±2 | 877 | ✅ PASS |
| **T-08** | TicketTierEditSheet sub-sheet positioning | Sub-sheets INSIDE parent `<Sheet>` children | Parent `<Sheet>` opens line 625, closes line 1220. `<VisibilitySheet>` line 1201, `<AvailableAtSheet>` line 1211 — both BETWEEN open and close. **Compliance with `feedback_rn_sub_sheet_must_render_inside_parent` confirmed.** | ✅ PASS |
| **T-09** | ActivityEvent type completeness | All 8 variants present + parent imports type | EventDetailActivityRow.tsx defines all 8 kinds: `purchase` (l34) `refund` (l42) `cancel` (l50) `event_edit` (l57) `event_sales_ended` (l65) `event_cancelled` (l71) `event_scan` (l79) `event_door_refund` (l94). Parent imports `ActivityEvent` from sibling (line 68); used in `useMemo<ActivityEvent[]>` (line 375). NOT redefined inline. | ✅ PASS |
| **T-10** | No cross-file style imports | New files do NOT import styles from parents | All 9 files have own `StyleSheet.create()` (verified by Glob). Pattern `import.*styles.*from.*\\.\\/(TicketTier\|EventDetail\|CreatorStep)` returned ZERO matches across the entire repo. | ✅ PASS |
| **T-11** | No external consumers of pre-Stage-2 sub-component names | grep returns 0 hits for old names as exported types/components | 4 hits found, ALL in comments (RolePickerSheet:4, InviteBrandMemberSheet:282, eventLifecycle:31, ticketDisplay:62) — NOT imports. Also checked `ToggleRow` separately: 5 file hits but each consuming file (CreatorStep6Settings, CreatorStep3Where, account/notifications) defines its OWN local ToggleRow (line 52 in CreatorStep6Settings — confirmed). No broken imports. | ✅ PASS |
| **T-12** | Preset sheet sub-pickers conditional rendering | weekly/biweekly/monthly_dow → weekday grid; monthly_dom → day-of-month; monthly_dow → which-week; daily → none | CreatorStep2WhenRepeatPickerSheet.tsx lines 137-139 (`weekly \|\| biweekly \|\| monthly_dow`), line 172 (`monthly_dom`), line 206 (`monthly_dow`). daily falls through with no sub-picker. Matches pre-Stage-2 logic verbatim. | ✅ PASS |
| **T-13** | TicketTierCard memo boundary | parent passes stable callback refs OR inline arrows noted as discovery | Parent passes 5 inline arrows (`onEdit={() => handleEditTicket(t.id)}` etc., lines 244-248). Memo defeated at prop layer. **NOT a regression** — pre-Stage-2 TicketCard was unmemoized too. Filed as **D-CYCLE17D-S2-QA-1** discovery (P2, non-blocking). | ✅ PASS (with discovery) |
| **T-14** | EventDetailTicketTypeRow memo boundary | stable refs | Parent passes `ticket={ticket}` (object ref from filter+sort+map; reference-stable when underlying ticket object unchanged) + `soldCount={soldCountByTier[ticket.id] ?? 0}` (primitive). NO inline arrows. | ✅ PASS |
| **T-15** | EventDetailActivityRow memo boundary | stable refs | Parent passes `event={a}` (object ref from `useMemo<ActivityEvent[]>` array). NO inline arrows. | ✅ PASS |
| **T-16** | activityRowKey React-key correctness | Stable + unique per variant | Lines 126-140: order-level → `${kind}-${orderId}-${at}`; event_edit → `${kind}-${editId}`; event_scan → `${kind}-${scanId}`; event_door_refund → `${kind}-${refundId}`; event_sales_ended/event_cancelled fall-through → `${kind}-${eventId}-${at}`. All 8 variants get unique stable keys. No collision risk. | ✅ PASS |
| **T-17** | CI gate scope still covers new files | All 3 gates' `SCAN_DIRS` include `mingla-business/app/` + `mingla-business/src/` | i37 line 36-39, i38 line 41-44, i39 line 41-44. All 3 gates scan both paths. All 9 touched files within scope. Empirically confirmed by gates returning 0 against final state — gates would have flagged any IconChrome/Pressable/TopBar in the new files if they had violated. | ✅ PASS |

**17/17 PASS.** No FAIL. One PASS-with-discovery (T-13).

---

## 5. Forensic findings

### Finding F-01 — Visual identity preserved verbatim

**Severity:** P4 (praise)
**Files:** `TicketTierCard.tsx` lines 76-200, `EventDetailHeroStatusPill.tsx` full,
`EventDetailTicketTypeRow.tsx` full, `EventDetailActivityRow.tsx` full,
`CreatorStep2WhenRepeatPickerSheet.tsx` full

I read each new file's JSX block end-to-end and compared against the pre-Stage-2
inline definitions (which I also read for verification). Every accessibility
label, every `hitSlop` value, every conditional rendering branch, every icon
name, every style-key reference is preserved verbatim. No drift introduced
during the move. The implementor honored the SPEC §F.1 "no behavior change"
constraint with discipline.

### Finding F-02 — TicketTierEditSheet sub-sheet positioning compliance

**Severity:** P4 (praise)
**File:** `TicketTierEditSheet.tsx` lines 625, 1201, 1211, 1220

`feedback_rn_sub_sheet_must_render_inside_parent` (codified after Cycle 13a v3
RolePickerSheet invisibility bug) requires sub-Sheet JSX to be INSIDE parent
`<Sheet>` children, NOT siblings. The implementor placed `<VisibilitySheet>`
and `<AvailableAtSheet>` correctly inside parent's children block. This is the
single highest-risk constitutional surface for this dispatch and it's clean.

### Finding F-03 — Style decomposition discipline

**Severity:** P4 (praise)
**Files:** All 9 touched files

SPEC §F.1 mandates "each new file owns the styles its sub-component uses.
Parent retains its remaining styles. Do NOT export styles between files."
Verified empirically: each of the 9 files has its own `StyleSheet.create()`,
no `import { styles }` between files exists across the entire mingla-business
codebase. Style keys are appropriately duplicated where needed (`helperError`
in 3 files, `sheetContent`/`sheetTitle`/`sheetDoneBtn`/`sheetDoneLabel` in 2
files each) — this is the SPEC's deliberate choice (cleanliness over LOC
minimization).

### Finding F-04 — ActivityEvent type extraction completeness

**Severity:** P4 (praise)
**Files:** `EventDetailActivityRow.tsx` lines 33-100, `app/event/[id]/index.tsx` line 68

All 8 discriminated-union variants moved verbatim with field shapes intact:
- order-level kinds (purchase/refund/cancel/event_door_refund) keep buyerName
  + summary fields; refund/door_refund keep amountGbp; door_refund keeps
  saleId + refundId
- event-level kinds (event_edit/event_sales_ended/event_cancelled/event_scan)
  keep their kind-specific fields (editId, severity, eventId, scanId,
  ticketId, etc.)

Parent imports `ActivityEvent` as a `type` import (treeshakeable) and uses it
in `useMemo<ActivityEvent[]>`. No inline redefinition. No type collision.

---

## 6. Constitutional compliance (14 rules)

For pure structural refactor, most rules are N/A. Verified the relevant ones:

| Rule | Status | Evidence |
|---|---|---|
| #1 No dead taps | ✅ PASS | All Pressables retain accessibility labels + handler bindings; parent handlers unchanged |
| #2 One owner per truth | ✅ PASS | Sub-components own only JSX + their styles. Parent retains all state ownership. No duplicate state authorities introduced. |
| #3 No silent failures | ✅ N/A | Pure refactor — no error-handling paths added or modified |
| #4 One key per entity | ✅ N/A | No React Query changes |
| #5 Server state server-side | ✅ N/A | No state moved into Zustand or out |
| #6 Logout clears everything | ✅ N/A | No auth surface changes |
| #7 Label temporary fixes | ✅ PASS | No new TRANSITIONAL markers introduced (per IMPL §5.1 + my grep) |
| #8 Subtract before adding | ✅ PASS (verified) | Parent files have inline JSX REMOVED before imports added. 23 unused style keys removed from CreatorStep2When. 3 unused UI imports removed from event/[id]/index.tsx (`Icon`, `IconName`, `Pill`). 1 unused util import removed (`formatDayOfMonth`). Confirmed via grep. |
| #9 No fabricated data | ✅ N/A | No data flow changes |
| #10 Currency-aware | ✅ N/A | No copy/locale changes |
| #11 One auth instance | ✅ N/A | No auth changes |
| #12 Validate at right time | ✅ N/A | No validation changes |
| #13 Exclusion consistency | ✅ N/A | No filter-rule changes |
| #14 Persisted-state startup | ✅ N/A | No persisted-state schema changes |

**No constitutional violations.**

---

## 7. UX coherence audit (per dispatch §6)

| Item | Status | Evidence |
|---|---|---|
| TicketTierCard renders with same visual order as pre-Stage-2 | ✅ PASS | Lines 76-200: reorder col → card body (header row → stats row → badges row). Verbatim match. |
| EventDetailHeroStatusPill renders identically for live/upcoming/past | ✅ PASS | Lines 23-44: live → Pill `livePulse`; upcoming → Pill accent variant; past → muted pastPill View. Same a11y label paths. |
| EventDetailActivityRow renders identically for all 8 variants | ✅ PASS | Lines 248-320: order-level kinds render `{buyerName}\n{summary}\n{relTime}`; event-level kinds render `{summary}\n{reason?}\n{relTime}`; amount line conditional on order-level + amountGbp+amountColor. Verbatim match to pre-Stage-2 logic. |
| CreatorStep2WhenRepeatPickerSheet renders identically | ✅ PASS | Lines 99-227: PRESET_OPTS map → 5 rows (daily/weekly/biweekly/monthly_dom/monthly_dow). Sub-pickers conditional. Done button. Verbatim match. |

No visual deviations. Pure structural refactor preserved UX surface 100%.

---

## 8. Cross-domain impact verification (per dispatch §5)

| Check | Result |
|---|---|
| External consumer of `CreatorStep5Tickets` sub-component names? | NO. 4 grep hits, all in comments (not imports). |
| External consumer of `ActivityEvent` type? | NO. Type defined in `EventDetailActivityRow.tsx`, imported only by `app/event/[id]/index.tsx`. |
| Wizard step routing still imports `CreatorStep5Tickets` correctly? | Indirect verification via tsc=0. If routing broke, tsc would have failed. |
| Wizard step routing still imports `CreatorStep2When` correctly? | Same — tsc=0 confirms. |
| `ToggleRow` consumers across mingla-business? | 5 files, but each has its OWN local `ToggleRow` definition (verified for CreatorStep6Settings.tsx line 52). No imports of pre-Stage-2 ToggleRow. |

---

## 9. Reproducibility checkpoint (per dispatch §7)

```
$ cd c:/Users/user/Desktop/mingla-main/mingla-business && npx tsc --noEmit; echo $?
TSC_EXIT=0

$ cd c:/Users/user/Desktop/mingla-main && for gate in i37-topbar-cluster i38-icon-chrome-touch-target i39-pressable-label; do node ".github/scripts/strict-grep/${gate}.mjs" > /dev/null 2>&1; echo "${gate}=$?"; done
i37-topbar-cluster=0
i38-icon-chrome-touch-target=0
i39-pressable-label=0
```

All 4 numbers match the IMPL claim verbatim. **Reproducibility verified.**

---

## 10. Discoveries for orchestrator

### D-CYCLE17D-S2-QA-1 — Memo benefit defeated by inline arrow handlers (P2, non-blocking)

**Severity:** P2 (medium-priority polish opportunity)
**File:** `mingla-business/src/components/event/CreatorStep5Tickets.tsx` lines 244-248
**Code:**
```tsx
onEdit={() => handleEditTicket(t.id)}
onDuplicate={() => handleDuplicateTicket(t.id)}
onDelete={() => handleRequestDelete(t.id)}
onMoveUp={() => handleMoveUp(t.id)}
onMoveDown={() => handleMoveDown(t.id)}
```

**Issue:** `TicketTierCard` is wrapped in `React.memo`, but the parent passes 5
inline arrow functions per row. Each arrow is a new reference on every parent
render → memo's reference-equality check fails → row re-renders unconditionally
→ memo benefit not realized in practice.

**Why this is NOT a regression:** Pre-Stage-2 `TicketCard` was unmemoized
inline component. Stage 2 wrapping it in memo + same inline-arrow pattern means
the runtime behavior is unchanged — same number of re-renders as before.

**Recommendation (future polish):**
1. Change row component prop signature to receive `ticketId: string` only (instead of full handler bindings).
2. Add row-level handler that calls parent handler with id: `onEdit?: (ticketId: string) => void`.
3. In parent: `onEdit={handleEditTicket}` (stable reference — `handleEditTicket` is already wrapped in `useCallback`).
4. In row: `<Pressable onPress={() => onEdit?.(ticket.id)}>...</Pressable>` (the row's local closure is stable across its own re-renders since `onEdit` is the same ref).

This pattern is a ~20-LOC change in CreatorStep5Tickets.tsx + TicketTierCard.tsx. Defer to a future polish cycle.

**Alternative interpretation:** The current code is correct; the memo wrapping is "harmless" optimization scaffolding for a future refactor when handler stability is fixed. Either way, not blocking.

### D-CYCLE17D-S2-QA-2 — Historical comments still reference pre-Stage-2 names (P3, doc-drift)

**Severity:** P3 (low — documentation drift)
**Files (4):**
- `mingla-business/src/components/team/RolePickerSheet.tsx:4` — comment "Mirrors Cycle 5 VisibilitySheet + Cycle 12 AvailableAtSheet patterns"
- `mingla-business/src/components/team/InviteBrandMemberSheet.tsx:282` — comment refs "CreatorStep5Tickets.tsx (VisibilitySheet/AvailableAtSheet at lines"
- `mingla-business/src/utils/eventLifecycle.ts:31` — comment refs "HeroStatusPill on Event Detail"
- `mingla-business/src/utils/ticketDisplay.ts:62` — comment refs "Step 5 TicketCard"

**Issue:** Comments still cite pre-Stage-2 component names. These names no
longer exist as exports — `VisibilitySheet`/`AvailableAtSheet`/`TicketCard`/
`HeroStatusPill` are now internal to their respective sibling files.

**Why non-blocking:** Comments only. No code consumers broken. Future readers
might be confused but can grep to find current locations.

**Recommendation (future polish):** Update the 4 comments to point at new
file paths in a future cycle. Do NOT spread this out — bundle into next
relevant cycle's "tidy" pass.

### D-CYCLE17D-S2-QA-3 — Implementor's unused-import cleanup verified clean (P4)

**Severity:** P4 (praise — IMPL Stage 2 §9 D-CYCLE17D-S2-IMPL-3 verified)
**Files:** `app/event/[id]/index.tsx`, `CreatorStep2When.tsx`

I verified the implementor's claim of removing 4 unused imports during the
refactor:
- `Icon` from `event/[id]/index.tsx` — confirmed removed (grep returns no `import { Icon }` in parent)
- `IconName` from same — confirmed removed
- `Pill` from same — confirmed removed (only `EventDetailHeroStatusPill` matches Pill-prefix grep)
- `formatDayOfMonth` from `CreatorStep2When.tsx` — confirmed removed (grep returned no matches in that file)

**Recommendation:** Future cycle could enable `noUnusedLocals` in tsconfig to
auto-detect these. Not blocking.

---

## 11. Stage 2 readiness for orchestrator CLOSE

**Stage 2 is READY for the 7-artifact CLOSE protocol.**

The orchestrator should now:

1. Update WORLD_MAP.md — Cycle 17d Stage 2 status → CLOSED, grade → A, evidence link to this QA report.
2. Update MASTER_BUG_LIST.md — Move 17d Stage 2 to Recently Closed; update header totals.
3. Update COVERAGE_MAP.md — recalculate surface grade distribution if applicable.
4. Update PRODUCT_SNAPSHOT.md — Cycle 17d Stage 2 closed; Refinement Pass mini-cycle 4 fully closed.
5. Update PRIORITY_BOARD.md — remove Cycle 17d Stage 2; renumber; surface 17e-A SPEC dispatch as next item.
6. Update AGENT_HANDOFFS.md — move IMPL + QA dispatches to Completed.
7. Update OPEN_INVESTIGATIONS.md — N/A (no investigation was involved in Stage 2).
8. Log DEC-106 in DECISION_LOG.md (Stage 2 CLOSE; SC-F1 PARTIAL ACCEPTED with rationale).

This dispatch did NOT trigger the DEPRECATION CLOSE PROTOCOL EXTENSION (Step 5
of orchestrator skill) — no DROP COLUMN, no DROP TABLE, no DROP FUNCTION, no
service decommission. Standard CLOSE Steps 1-4 only.

---

## 12. Operator-side reminders (per dispatch §10 + memory `feedback_eas_update_no_web` + Stage 1 §H deferral)

### Commit message draft (orchestrator already provided in IMPL §11 — verified accurate)

```
feat(business): Cycle 17d Stage 2 — §F LOC decompose 3 fattest .tsx files

Split CreatorStep5Tickets.tsx (2148→367), event/[id]/index.tsx
(1354→877), and CreatorStep2When.tsx (2271→1986) into focused
sibling sub-components with React.memo boundaries on the
mapped-array rows.

New files (6):
- TicketTierCard.tsx (memoized per-tier card)
- TicketTierEditSheet.tsx (add/edit sheet + visibility/available-at
  sub-sheets + ToggleRow)
- EventDetailHeroStatusPill.tsx
- EventDetailTicketTypeRow.tsx (memoized)
- EventDetailActivityRow.tsx (memoized; owns ActivityEvent type +
  helpers)
- CreatorStep2WhenRepeatPickerSheet.tsx (preset picker sheet
  + PRESET_OPTS / WEEKDAY_OPTS / SETPOS_OPTS option sets)

Visual UI 100% unchanged. tsc clean. 3 strict-grep CI gates green
(i37 + i38 + i39). SC-F2 over-achieved (367 LOC parent —
orchestration shell). SC-F3 in range (877 LOC). SC-F1 partial
(1986 vs 1300-1500 target — accepted; other 4 sheets too
state-coupled to extract without prop bloat).

Closes Cycle 17d Stage 2. 4-mini-cycle Refinement Pass complete.
```

### EAS dual-platform OTA (per `feedback_eas_update_no_web` — 2 SEPARATE commands, NOT comma-combined)

**IMPORTANT:** This change is in `mingla-business/`, not `app-mobile/`. Operator
should confirm whether mingla-business has its own EAS OTA channel before
running the below. If mingla-business doesn't have one yet, this OTA is N/A
for Stage 2 and the changes ship via the next mingla-business build.

If mingla-business has its own EAS:
```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17d Stage 2: §F LOC decompose"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17d Stage 2: §F LOC decompose"
```

### Bundle baseline measurement (deferred from Stage 1 §H, still pending)

```bash
cd mingla-business
npx expo export --platform ios --dump-sourcemap --output-dir dist/
npx source-map-explorer dist/_expo/static/js/ios/*.hbc.map
```

Capture top-10 largest dependencies + gzip sizes. Append to a new
`Mingla_Artifacts/PERF_BASELINE.md`. Operator-side only — implementor cannot
run `expo export` reliably without device/emulator setup. Recommend operator
runs this AFTER Stage 2 commit so the baseline reflects the post-decompose
bundle (not the pre-decompose Stage 1 state).

### Visual smoke test reminder (operator-side post-CLOSE)

The IMPL report (§10) and dispatch (§11) explicitly defer visual smoke to
operator post-CLOSE. The 3 surfaces with highest LOC delta = highest
regression risk:

1. **Wizard Step 5 (Tickets)** — densest delta (2148→367 LOC moved into 2 siblings)
2. **Event detail screen** — 3 sibling sub-components (largest LOC: ActivityRow at 372)
3. **Wizard Step 2 (When)** — repeat-pattern picker sheet (preset extraction)

If any visual regression surfaces post-OTA: revert the affected file via git, flag for retest dispatch.

---

## 13. P4 (praise) items

1. **Sub-sheet positioning rule honored** — the highest-risk constitutional
   surface for this refactor (per `feedback_rn_sub_sheet_must_render_inside_parent`)
   was implemented correctly on the first pass.

2. **No-style-export discipline** — implementor duplicated 4-5 style keys
   across files where needed (sheetContent, sheetTitle, helperError,
   sheetDoneBtn, sheetDoneLabel) instead of cross-file imports. This honors
   the SPEC's intent over arbitrary LOC-minimization.

3. **Honest partial labeling on SC-F1** — implementor explicitly marked
   SC-F1 PARTIAL with a multi-paragraph rationale instead of soft-pedaling
   to PASS. This is exactly the failure-honesty discipline the orchestrator
   skill demands. The rationale (state-coupling cost > LOC-target benefit)
   is technically sound and verified independently.

4. **Unused-import cleanup during refactor** — implementor removed 4 imports
   that became unused after extraction (Icon, IconName, Pill,
   formatDayOfMonth) instead of leaving them as dead weight. tsc didn't flag
   these (mingla-business tsconfig doesn't enforce noUnusedLocals), so this
   was discretionary cleanliness — the right call.

---

## 14. Refinement Pass closure status

After this CLOSE, the 4-mini-cycle Refinement Pass is **structurally complete**.

| Mini-cycle | Topic | Status |
|---|---|---|
| 17a | Top-bar cluster invariants | ✅ CLOSED |
| 17b | Hardening registry CI scaffold + i37 gate | ✅ CLOSED |
| 17c | WCAG AA kit (i38 + i39 gates) | ✅ CLOSED |
| 17d Stage 1 | Storage hygiene + perf trim | ✅ CLOSED commit `d30bc681` |
| **17d Stage 2** | **§F LOC decompose** | **READY FOR CLOSE — this report's PASS verdict authorizes** |

Pattern signature: 5 cycles in a row at sub-estimate effort with zero reworks.
17a 2.5h vs 6h. 17b 1.5h vs 4-5h. 17c 3h vs 7.5h. 17d Stage 1 1.5h vs 6-8h.
17d Stage 2 ~1.5-2h vs 4-5h. The Refinement Pass shipped consistently under
budget with high quality on first pass — pattern-discipline is compounding.

After Stage 2 CLOSE + commit + (optional) OTA, mingla-business launch-floor
is structurally complete. Remaining queue (different phases, NOT Refinement
Pass scope):

- **17e-A SPEC dispatch** (brand CRUD wiring, ~12-16h) — **next dispatch**
- **17e-B SPEC dispatch** (event cover media picker via Giphy/Pexels, ~10-14h Tier 1)
- **ORCH-0734 IMPL** (city-runs, ~9.6h)
- **ORCH-0735 forensics** (bouncer fast-food gap)
- **`npm audit` triage ORCH** (7 pre-existing vulnerabilities)
- **B-cycle backend wires** (operator-side, separate phase)

---

**Authored:** 2026-05-05
**Authored by:** mingla-tester (TARGETED + SPEC-COMPLIANCE combined)
**Verdict:** PASS (17/17 test cases; 0 P0; 0 P1; 1 P2 non-blocking discovery; 2 P3 doc-drift nits; 4 P4 praise items)
**Awaiting:** orchestrator CLOSE protocol (Steps 1-4 of standard CLOSE; Extension Step 5 not triggered — no decommission this cycle)
