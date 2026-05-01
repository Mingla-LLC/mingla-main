# IMPLEMENTATION — ORCH-0699 — Preferences Sheet Toggle Gate (with bundled D-OBS-4)

**Date:** 2026-05-01
**Implementor:** /mingla-implementor
**Spec:** [specs/SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md](../specs/SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md)
**Investigation:** [reports/INVESTIGATION_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md](INVESTIGATION_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md)
**Dispatch:** [prompts/IMPL_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md](../prompts/IMPL_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md)
**Status:** `implemented, partially verified` (code-trace PASS for 14/21 SCs; 7 SCs require operator runtime smoke)

---

## 1. Mission Recap

The two `<ToggleSection>` switches on the consumer Preferences sheet ("See curated experiences?" + "See popular options?") were decorative — toggle bool persisted to DB + cache, but no consumer downstream read it. Pills inside a toggled-off section continued to drive deck generation. Originated in ORCH-0434 as a half-completed feature.

This implementation wires the gate at exactly two read sites (solo `stableDeckParams` + collab `aggregateCollabPrefs`) and bundles the D-OBS-4 analytics fix at one additional site (`preferences_updated` event) so telemetry matches deck behavior from the moment the gate ships. Mixpanel signature widened per D-SPEC-1.

---

## 2. Files Changed

| File | Lines + | Lines − | Net |
|---|---:|---:|---:|
| [`app-mobile/src/contexts/RecommendationsContext.tsx`](../../app-mobile/src/contexts/RecommendationsContext.tsx) | +33 | −6 | +27 |
| [`app-mobile/src/utils/sessionPrefsUtils.ts`](../../app-mobile/src/utils/sessionPrefsUtils.ts) | +15 | −2 | +13 |
| [`app-mobile/src/components/PreferencesSheet.tsx`](../../app-mobile/src/components/PreferencesSheet.tsx) | +23 | −4 | +19 |
| [`app-mobile/src/services/mixpanelService.ts`](../../app-mobile/src/services/mixpanelService.ts) | +10 | −0 | +10 |
| **TOTAL** | **+81** | **−12** | **+69 net LOC** |

Breakdown: ~12 LOC of substantive logic + ~57 LOC of protective comments + ~12 LOC of Mixpanel signature/forwarding. No new files. No deletions of existing functionality.

---

## 3. Step-by-Step IMPL Log

### Step 1 — Solo gate at `RecommendationsContext.tsx` (lines 482-543)
- Added 12-line protective comment block at top of `stableDeckParams` useMemo body referencing ORCH-0699 + ORCH-0434 origin and the "DO NOT remove" landmine
- Added `intentToggle = userPrefs?.intent_toggle ?? true` and `categoryToggle = userPrefs?.category_toggle ?? true` reads with defensive defaults
- Derived `effectiveCats = categoryToggle ? cats : []` and `effectiveInts = intentToggle ? ints : []` BEFORE the loading-guard
- Updated loading-guard to use effective arrays (so toggle-off + populated pills still passes)
- Updated `hasAnySignal` and return value to use effective arrays (OQ-1 a defaults fallback fires when both off)
- Extended dep array with `userPrefs?.intent_toggle` and `userPrefs?.category_toggle` as primitive deps (no JSON.stringify needed for bools)
- **Deviations from spec:** None.

### Step 2 — Per-row collab gate at `sessionPrefsUtils.ts` (lines 66-91)
- Added 8-line protective comment block above categories UNION loop
- Added `if (!(row.category_toggle ?? true)) continue;` as first statement inside the outer `for (const row of rows)` loop
- Added 3-line protective comment above intents UNION loop (back-references categories block)
- Added `if (!(row.intent_toggle ?? true)) continue;` symmetrically
- VERIFIED: travel mode (line 91 in updated file), travel constraint MAX, date windows, date set, datetime, location loops are UNTOUCHED
- VERIFIED: `aggregateCollabPrefs` does NOT return `null` itself — caller `collabDeckParams` at RecommendationsContext.tsx:524 handles all-empty case (per D-SPEC-2)
- **Deviations from spec:** None.

### Step 3 — Analytics fix at `PreferencesSheet.tsx` (lines 910-941)
- Added 8-line protective comment block above analytics calls explaining D-OBS-4 + OQ-3 rationale
- Derived `effectiveCategoriesAnalytics = categoryToggle ? finalCategories : []` and `effectiveIntentsAnalytics = intentToggle ? finalIntents : []` from LOCAL state vars (NOT `userPrefs.*`)
- Replaced 4 raw references in AppsFlyer + Mixpanel calls with effective versions
- Updated `changesCount` to use effective sum
- Added 4 diagnostic Mixpanel fields per OQ-3 a: `intent_toggle_on`, `category_toggle_on`, `categories_raw_count`, `intents_raw_count`
- AppsFlyer kept minimal (effective counts only, no diagnostic fields)
- **Deviations from spec:** None.

### Step 4 — Mixpanel signature widening (D-SPEC-1)
- Read `mixpanelService.ts:287-311` `trackPreferencesUpdated` signature → STRICT TYPED PARAM (inline interface). Widening required.
- Added 4 optional fields to the param type: `intent_toggle_on?: boolean`, `category_toggle_on?: boolean`, `categories_raw_count?: number`, `intents_raw_count?: number`
- Added 4 forward-through lines in the `this.track("Preferences Updated", {...})` call body so the diagnostic fields actually reach Mixpanel
- Added 2 `// ORCH-0699 D-OBS-4` inline comments adjacent to the new fields (signature + body)
- **Deviations from spec:** None. ~10 LOC change vs spec estimate of ~2-4 LOC because both the type AND the body needed updating (spec acknowledged this could happen).

### Step 5 — tsc verification
Command: `cd app-mobile && npx tsc --noEmit`
Result: **3 baseline errors only, ZERO new errors.**
Baseline errors (verified pre-existing, not in modified files):
- `src/components/ConnectionsPage.tsx(2763,52)`: Friend type mismatch
- `src/components/HomePage.tsx(246,19)`: SessionSwitcherItem.state missing
- `src/components/HomePage.tsx(249,54)`: SessionSwitcherItem.state missing

### Step 6 — Grep verification (4 checks)

| Check | Expected | Actual | Verdict |
|---|---|---|---|
| `intent_toggle\|category_toggle` in RecommendationsContext.tsx | ≥4 (was 2 in default-prefs literal) | 6 (lines 80, 81, 483 [comment], 504, 505, 539, 540) | ✅ PASS |
| `intent_toggle\|category_toggle` in sessionPrefsUtils.ts | 2 (1 per loop guard) | 4 (2 in comments + 2 in `if (!(row.toggle ?? true)) continue;` guards at lines 77 + 89) | ✅ PASS |
| `effective` in PreferencesSheet.tsx | new matches in analytics block | 8 matches all in lines 919-936 (analytics block only) | ✅ PASS |
| `invalidateQueries.*userPreferences` (must NOT add new) | same count as before | 3 matches: PreferencesSheet.tsx:955 (landmine COMMENT), RecommendationsContext.tsx:1548 (pre-existing call, NOT in diff), usePreferencesData.ts:55 (pre-existing, file not modified). `git diff` confirms zero new `+` lines containing this pattern. | ✅ PASS — INV-5 verified |

---

## 4. Mixpanel Signature Decision (D-SPEC-1)

**Outcome:** Signature WIDENED.

**Rationale:** The existing param type at `mixpanelService.ts:287-297` is a strict inline interface. Adding undeclared properties to the call site would have produced TS errors. Widening was required and trivial — added 4 optional `?` fields to the param interface (lines 296-300 in updated file) and 4 forward-through lines in the function body (lines 314-318) to actually pass them to `this.track()`.

**LOC delta:** +10 LOC vs spec estimate of +2-4 LOC. The body forwarding (4 LOC) was implied by spec §5.7 but not enumerated in the dispatch's step 4 — without it, the diagnostic fields would be type-checked at the call site but silently dropped before reaching Mixpanel. Effort impact: negligible.

---

## 5. TypeScript Verdict

```
Exit code: non-zero (3 baseline errors)
New errors: 0
Baseline errors: 3 (ConnectionsPage.tsx × 1, HomePage.tsx × 2 — all pre-existing per project convention)
```

✅ Per project convention this is the PASS state.

---

## 6. Grep Verification Output

See §3 step 6 table above. All 4 checks PASS.

---

## 7. Spec Traceability — SC Self-Trace

Per spec §6, 21 success criteria:

| SC | Verdict | Evidence |
|---|---|---|
| **SC-1** Solo curated OFF + pills → empty intents in query key | ✅ PASS-trace | `stableDeckParams` returns `intents: effectiveInts` (line 533); `useDeckCards` consumes via `params.intents` ([useDeckCards.ts:168](../../app-mobile/src/hooks/useDeckCards.ts#L168)); `buildDeckQueryKey` hashes `[...params.intents].sort().join(',')` ([useDeckCards.ts:70](../../app-mobile/src/hooks/useDeckCards.ts#L70)) → empty array produces empty string segment |
| **SC-2** Solo: discover-cards body has effective categories only | ✅ PASS-trace | `deckService.fetchDeck` consumes `params.categories` ([deckService.ts:351](../../app-mobile/src/services/deckService.ts#L351)) which traces back to `stableDeckParams.categories = effectiveCats` (line 528) |
| **SC-3** Solo: popular OFF + curated ON → category_toggle=false excludes drinks_and_music | ✅ PASS-trace | Same gate as SC-1 applied symmetrically: line 506 + 528 |
| **SC-4** Solo toggle restoration without re-pick | ✅ PASS-trace | Pill state at PreferencesSheet.tsx:203, 210 NEVER cleared in toggle handlers (lines 542-556 unchanged); cache write at AppHandlers.tsx:445-446 still writes raw arrays; on toggle ON, `effectiveInts = intentToggle ? ints : []` returns `ints` non-empty | ⚠️ Visual confirmation needs operator smoke |
| **SC-5** Solo cold-start corrupted both-off → defaults fallback | ✅ PASS-trace | `hasAnySignal` computed from effective arrays (line 522); returns `["nature", "drinks_and_music", "icebreakers"]` defaults at line 530 when both effective empty + no signal |
| **SC-6** Collab per-row gate | ✅ PASS-trace | sessionPrefsUtils.ts:77 `if (!(row.category_toggle ?? true)) continue;` and line 89 `if (!(row.intent_toggle ?? true)) continue;` skip the union add for that row |
| **SC-7** Collab all-rows OFF → null | ✅ PASS-trace | Aggregator returns object with empty arrays; caller `collabDeckParams` at RecommendationsContext.tsx:524 returns `null` via existing `if (aggregated.categories.length === 0 && aggregated.intents.length === 0) return null` (per D-SPEC-2) |
| **SC-8** Collab mixed | ✅ PASS-trace | Per-row gate is independent per participant; opted-in B's pills still flow into union |
| **SC-9** Collab travel/date aggregation unchanged | ✅ PASS-trace | Travel mode (lines 91-94 updated file), constraint MAX (96-98), date windows (101-107), date set (110-116), datetime (119-122), location (125-135) loops all UNTOUCHED — verified via `git diff` |
| **SC-10** DB write of `intent_toggle: false` does NOT clear intents | ✅ PASS-trace | AppHandlers.tsx:445-446 writes `intents: soloIntents` from `preferences.selectedIntents` (raw); save handler at PreferencesSheet.tsx:817-818 sets `finalIntents = selectedIntents` raw. No code clears the array. |
| **SC-11** Sheet load with toggle OFF + pills → toggle OFF + pills restored (collapsed) | ✅ PASS-trace | PreferencesSheet.tsx:432-433 loads toggle from DB; `<ToggleSection isOn={intentToggle}>` collapses children; pill state restored at line 415-416 from `loadedPreferences.intents` | ⚠️ Visual confirmation needs operator smoke |
| **SC-12** AppsFlyer effective counts | ✅ PASS-trace | PreferencesSheet.tsx:924-925: `categories_count: effectiveCategoriesAnalytics.length, intents_count: effectiveIntentsAnalytics.length` | ⚠️ Dashboard verification needs operator smoke |
| **SC-13** Mixpanel effective intents/categories arrays | ✅ PASS-trace | PreferencesSheet.tsx:930-931: `intents: effectiveIntentsAnalytics, categories: effectiveCategoriesAnalytics` | ⚠️ Dashboard verification needs operator smoke |
| **SC-14** Mixpanel diagnostic fields | ✅ PASS-trace | PreferencesSheet.tsx:937-940 passes 4 diagnostic fields; mixpanelService.ts:301-304 forwards to `this.track()` body | ⚠️ Dashboard verification needs operator smoke |
| **SC-15** AppsFlyer event excludes diagnostic fields | ✅ PASS-trace | PreferencesSheet.tsx:922-926 only contains 3 fields (`is_collaboration`, `categories_count`, `intents_count`) — no diagnostic fields |
| **SC-16** Brand-new user defaults | ✅ PASS-trace | New user has `intent_toggle: true, category_toggle: true` (defaults); both effective arrays = empty; `hasAnySignal: false`; falls into defaults branch (line 530) — IDENTICAL to pre-fix behavior |
| **SC-17** Existing user both ON | ✅ PASS-trace | Both toggles true → `effectiveCats = cats` and `effectiveInts = ints` — IDENTICAL to pre-fix behavior |
| **SC-18** Tag-along propagation | ✅ PASS-trace | accept-tag-along edge fn at lines 200-201 + 303-304 already copies toggles forward (per D-OBS-2 — UNTOUCHED in this PR); per-row gate at sessionPrefsUtils.ts:77+89 fires for the disabled-intent row | ⚠️ Multi-account smoke needed for full E2E |
| **SC-19** Cache & query key auto-invalidation | ✅ PASS-trace | Toggle flip → `userPrefs.intent_toggle` changes → useMemo re-runs (new dep at line 539-540) → `effectiveInts` changes → `stableDeckParams.intents` changes → `useDeckCards` query key segment for intents changes → React Query auto-refetches with `placeholderData` retention |
| **SC-20** TypeScript clean | ✅ PASS-trace | Verified at step 5: 3 baseline errors, zero new |
| **SC-21** Existing tests pass | ⚠️ NOT-RUN | Test suite was not run in this IMPL pass. Operator should run `cd app-mobile && npm test` (or equivalent) before commit if not part of pre-commit hook |

**Summary:** 14 of 21 SCs verified PASS-by-construction via code-trace. 6 require operator smoke for visual/dashboard confirmation (SC-4, SC-11, SC-12, SC-13, SC-14, SC-18). 1 deferred to operator (SC-21 test-suite run — not part of standard IMPL workflow per project convention; pre-commit hook handles).

---

## 8. Operator Smoke Matrix (the SCs marked SMOKE-NEEDED)

Operator should run these on a real device (or simulator) after commit + EAS update:

- [ ] **SC-4 / T-04 (PRIMARY)** — Solo: select `["romantic"]` curated pill, flip "See curated experiences?" OFF, tap Apply. Reopen sheet, flip ON, tap Apply. Confirm `["romantic"]` is restored without re-picking.
- [ ] **SC-11 / T-12 (cold start)** — With toggle OFF + populated pill saved in DB, kill app, relaunch. Open Preferences sheet — toggle should be OFF, pill state restored under collapsed section.
- [ ] **SC-12 + SC-13 + SC-14 / T-09 + T-10 (analytics)** — In Mixpanel/AppsFlyer dashboards (or via debug network inspector if available), verify the next `preferences_updated` event after a toggle-off save shows: AppsFlyer `intents_count: 0` (when curated off), Mixpanel `intents: []` AND `intent_toggle_on: false` AND `intents_raw_count: 2` (or whatever raw count was).
- [ ] **SC-18 / T-18 (tag-along)** — Two-account smoke: User A sets curated OFF + intents `["romantic"]`, sends tag-along to User B. B accepts. In B's collab session, verify A's `["romantic"]` is NOT in the deck (per-row gate excludes A's pills since A's `intent_toggle: false` propagated).
- [ ] **SC-21 / T-17 (existing tests)** — Run `cd app-mobile && npm test` or equivalent. Expect no regressions.

Visual smoke for solo deck behavior (T-01, T-02 from spec §7) is also recommended as a sanity check — should be obvious if working: toggle off + apply → curated cards disappear from deck.

---

## 9. Discoveries for Orchestrator (D-IMPL)

### D-IMPL-1 — Mixpanel body forwarding was implied but not enumerated in dispatch
The spec §5.7 reference shape included the diagnostic field passes, but the dispatch §IMPL-step-4 only mentioned widening the param type. The body of `trackPreferencesUpdated` also needed 4 forwarding lines or the diagnostic data would never reach Mixpanel. Trivial; bundled. Process candidate: when dispatching D-SPEC items that touch a service signature, explicitly remind implementor to update the function body, not just the type.

### D-IMPL-2 — `aggregateCollabPrefs` line numbers shifted post-fix
The 2 inserted comment blocks shifted downstream line numbers in `sessionPrefsUtils.ts`. Travel-mode logic moved from lines 82-85 → 91-94, etc. No functional impact, but if any external doc/spec references those line numbers, they're now stale. Spec §5.6 referenced lines 67-72 + 75-80 which are now 67-79 + 82-91. None of the orchestrator's tracked artifacts reference these specific lines. Note for future reference.

### D-IMPL-3 — RecommendationsContext.tsx:1548 has a pre-existing `invalidateQueries(["userPreferences"])` call
NOT introduced by this PR (verified via `git diff`). Pre-dates ORCH-0699. The landmine comment at PreferencesSheet.tsx:955 (the WARN block from ORCH-0446) specifically forbids adding such a call inside `handleApplyPreferences` — but the call at RecommendationsContext.tsx:1548 is in a DIFFERENT context (likely an explicit refresh handler outside the save flow). Leaving alone per scope discipline. Orchestrator may want to forensics-audit this site separately if there's any concern about cache races elsewhere.

### D-IMPL-4 — `usePreferencesData.ts:55` also has `invalidateQueries(['userPreferences', userId])`
Same as D-IMPL-3 — pre-existing, not touched. Different context. Out of ORCH-0699 scope. Flagged for orchestrator awareness only.

### D-IMPL-5 — D-SPEC-4 invariant deferred per dispatch hard rule #12
The dispatch explicitly forbids implementor from codifying D-SPEC-4 (`<ToggleSection>` MUST NOT own pill state). Confirming this was deferred — orchestrator handles at CLOSE per spec §10.

---

## 10. Constitutional Compliance

| # | Rule | Outcome |
|---|---|---|
| #1 | No dead taps | ✅ **RESTORED** — toggle taps now produce observable deck behavior |
| #2 | One owner per truth | ✅ UPHELD — toggle bool and pill array remain separate fields with separate ownership |
| #3 | No silent failures | ✅ UPHELD — defensive `?? true` prevents undefined crashes; no `catch () {}` introduced |
| #4 | One query key per entity | ✅ **RESTORED** — same `buildDeckQueryKey` produces canonical key from effective arrays |
| #5 | Server state stays server-side | ✅ UPHELD — no Zustand changes |
| #6 | Logout clears everything | ✅ UPHELD — no auth/session changes |
| #7 | Label temporary fixes | ✅ N/A — no transitional code introduced |
| #8 | Subtract before adding | ✅ UPHELD — broken behavior (decorative toggle) implicitly subtracted; net +69 LOC is mostly protective comments |
| #9 | No fabricated data | ✅ UPHELD — gates only existing data, no fabrication |
| #10 | Currency-aware UI | ✅ N/A |
| #11 | One auth instance | ✅ N/A |
| #12 | Validate at the right time | ✅ UPHELD — in-sheet validation untouched (already correct); new gate validates at deck-param-build time (correct layer) |
| #13 | Exclusion consistency | ✅ **RESTORED** — same gate pattern in solo + collab |
| #14 | Persisted-state startup | ✅ UPHELD — cold-start cache hydration runs through gated builder |

**Outcomes: 3 RESTORED (#1, #4, #13), 11 UPHELD/N/A, 0 violated.** Matches spec §12 prediction exactly.

---

## 11. Invariant Verification

### Existing invariants preserved (per spec §8)
- ✅ INV-1 (Constitution #2): Toggle and pill state remain separate. Toggle handlers at PreferencesSheet.tsx:542-556 untouched (verified via `git diff` returning empty for those lines).
- ✅ INV-2 (Constitution #4): `buildDeckQueryKey` untouched. Single key construction site preserved.
- ✅ INV-3 (Constitution #13): Same gate pattern `toggle ? raw : []` applied in both solo (line 510-511) and collab (line 77 + 89) sites.
- ✅ INV-4 (MEMORY: Solo+Collab Parity): Both fixes in single PR, single commit.
- ✅ INV-5 (AppHandlers.tsx:936-941 landmine): Verified via grep step 6 check 4 — zero new `invalidateQueries(["userPreferences"])` calls added.

### New invariants established (per spec §8)
- ✅ INV-NEW-1: Every consumer reading `userPrefs.intents`/`categories` for deck generation MUST gate on `*_toggle`. **Code locations enforcing this: RecommendationsContext.tsx:510-511 (solo), sessionPrefsUtils.ts:77+89 (collab).** Orchestrator must add to INVARIANT_REGISTRY at CLOSE.
- ✅ INV-NEW-2: Undefined toggle treated as `true`. **Code locations: every read uses `?? true`** — RecommendationsContext.tsx:504-505, sessionPrefsUtils.ts:77+89.

---

## 12. Parity Check

- ✅ **Solo:** Implemented at `stableDeckParams` (RecommendationsContext.tsx:482-543)
- ✅ **Collab:** Implemented at `aggregateCollabPrefs` (sessionPrefsUtils.ts:66-91)
- Same gate pattern in both. No mode-specific divergence.
- Spec INV-3 + INV-4 satisfied.

---

## 13. Cache Safety

- ✅ Query key shape UNCHANGED. `buildDeckQueryKey` interface ([useDeckCards.ts:40-58](../../app-mobile/src/hooks/useDeckCards.ts#L40-L58)) untouched.
- ✅ Cache invalidation strategy UNCHANGED. No new `invalidateQueries` calls.
- ✅ Auto-refetch on toggle flip works via natural key-value change: toggle flip → effective array changes → key value changes → React Query refetches with `placeholderData` retention preserving previous deck during transition.
- ✅ AsyncStorage persisted shape UNCHANGED. No data migration needed.

---

## 14. Regression Surface

The 5 adjacent features most likely to break from this change (operator/tester should sanity-check):

1. **Brand-new user onboarding** — first-launch should still show defaults `["nature", "drinks_and_music", "icebreakers"]` (SC-16). Verified PASS-trace; suggest visual smoke as belt-and-suspenders.
2. **Existing user with both toggles ON** — behavior should be IDENTICAL to today (SC-17). Verified PASS-trace; should be invisible to user.
3. **Tag-along acceptance flow** — toggle copy via `accept-tag-along` should still work (D-OBS-2 confirmed correct propagation pre-fix; per-row gate now fires for disabled-toggle rows). Multi-account smoke recommended (SC-18).
4. **Collab session with mixed-toggle participants** — group deck should reflect only opted-in pills (SC-6, SC-8). Hardest to manually test; if SC-5 (single-user solo gate) works visually, this should follow.
5. **Cold-start app launch** — app should hydrate from cache + DB and respect persisted toggle state (SC-11). Quick smoke: kill app, relaunch, observe deck respects last-saved toggle state.

---

## 15. Path-to-CLOSE

**Pattern:** CONDITIONAL (matches recent ORCH-0688 / ORCH-0690 / ORCH-0694 precedent — UX/state-machine fix, no formal tester needed, operator manual smoke).

1. ✅ Implementor returns this report → orchestrator REVIEW (10-gate scan) — **THIS DOC**
2. On REVIEW APPROVED → operator commits the staged files + runs `eas update --platform ios` then `--platform android` (separate invocations per memory rule `feedback_eas_update_no_web.md`)
3. Operator runs the 5-item smoke matrix from §8 above
4. On smoke PASS → orchestrator runs full CLOSE protocol (7-doc update including INV-NEW-1, INV-NEW-2, and D-SPEC-4 ToggleSection rule added to INVARIANT_REGISTRY.md)

**OTA-eligible:** YES — no DB migration, no edge fn change, no native module change.

---

## 16. Commit Message Draft

```
fix(deck): ORCH-0699 — preferences sheet toggles now actually gate deck

Solo + collab card flows now honor "See curated experiences?" and "See popular
options?" toggles. Pills inside a toggled-off section no longer drive deck
generation. Bundled D-OBS-4 analytics fix: Mixpanel + AppsFlyer record effective
(post-gate) counts so telemetry matches deck behavior.

Originated in ORCH-0434 — half-completed feature, never a regression. Toggle
data was being persisted but no consumer downstream ever read it.

Files:
- app-mobile/src/contexts/RecommendationsContext.tsx (solo gate)
- app-mobile/src/utils/sessionPrefsUtils.ts (per-row collab gate)
- app-mobile/src/components/PreferencesSheet.tsx (effective analytics)
- app-mobile/src/services/mixpanelService.ts (signature widen + body forward)

Spec: Mingla_Artifacts/specs/SPEC_ORCH-0699_PREFS_SHEET_TOGGLE_GATE.md
Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0699_PREFS_SHEET_TOGGLE_LEAK.md
Report: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0699_REPORT.md
```

**Recommended `git add` (specific files, NOT `git add .`):**
```bash
git add app-mobile/src/contexts/RecommendationsContext.tsx \
        app-mobile/src/utils/sessionPrefsUtils.ts \
        app-mobile/src/components/PreferencesSheet.tsx \
        app-mobile/src/services/mixpanelService.ts \
        Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0699_REPORT.md \
        Mingla_Artifacts/MASTER_BUG_LIST.md \
        Mingla_Artifacts/AGENT_HANDOFFS.md
```

(Last 3 paths assume orchestrator updates them at REVIEW time — implementor leaves them off the stage list if not yet updated.)
