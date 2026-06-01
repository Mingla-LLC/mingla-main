# IMPLEMENTATION — ORCH-1019 [Curated-card scheduling: false "could not verify opening hours" warning + missing per-stop addresses in calendar]

- **Mode:** IMPLEMENT (Claude `mingla-implementor`, parity mirror)
- **Date:** 2026-05-30
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1019-[curated-schedule-hours-calendar-notes]/` on branch `ORCH-1019-curated-schedule-hours-calendar-notes`
- **Commit:** `d2101c61a610b340ac7d31652119c5512281eead`
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1019_CURATED_SCHEDULE_HOURS_AND_CALENDAR_ADDRESSES.md`
- **DESIGN (F-5):** `Mingla_Artifacts/designs/DESIGN_ORCH-1019_F5_CALENDAR_STOP_ADDRESSES.md`
- **Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`, shared RN → automatic parity). NOT business/admin/buyer-web.
- **Status:** implemented and verified (gate + unit-level + typecheck/lint). Runtime sim/emulator verification of SC-1/SC-3/SC-5/SC-6 is the tester's TEST phase (T-02..T-07).
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets ORCH-1019, `mingla-implementor`, or actionable `ALL`. COMMS-0003 (external-API docs) is N/A — this change introduces no external-API enum/payload/endpoint; the one external value (`utcOffsetMinutes`) is read-only and already wired, and the generator is NOT touched (§11 deferred). No new cross-ORCH discovery to write.

---

## 1. Build sequence honored (SPEC §9)

F-7 (type) was implemented FIRST so the deleted bespoke parser would no longer typecheck against the corrected union — confirming F-2's deletion at compile time. Then F-2 → F-1 → F-3 → F-4 → F-6 → F-5 → gate → test, per §9.

---

## 2. Cross-Surface Impact (Phase 2.5)

| Surface | Affected | What changes | Files | Parity |
|---|---|---|---|---|
| Consumer iOS | YES | Honest curated open/closed verdict; reschedule shows curated flow (no false "couldn't verify"); per-stop calendar addresses; device-cal keeps every stop address on reschedule; advisory copy fixed. | All files below | Shared RN |
| Consumer Android | YES | Identical. | Same | **Automatic** — single shared RN path, no `Platform.select`, no `.ios/.android` split in any touched file. |
| Buyer-web / Business iOS / Business Android / Admin / Business-web preview | NO | No curated-card scheduling on those surfaces. | — | — |

Parity for iOS vs Android is automatic (one code path per finding). Tester verifies on iOS sim + Android emulator (F-4 device-calendar permission flow differs at the OS layer only).

---

## 3. Old → New Receipts

### `app-mobile/src/types/curatedExperience.ts` (F-7)
- **Before:** `openingHours: Record<string, string>;` (a type lie — runtime value is the raw Google-v1 object).
- **After:** the LOCKED union `{ openNow?; periods?; weekdayDescriptions?; nextOpenTime?; nextCloseTime? } | Record<string,string> | string[] | string | null`, matching `extractWeekdayText`'s accepted input. Also added optional `utcOffsetMinutes?: number | null` (forward-compat with the deferred §11 generator enhancement; reads `null` today).
- **Why:** SC-7. Makes the canonical reader the only consumer; the deleted `openingHours[dayName]` lookup no longer typechecks.
- **Lines:** ~+25.

### `app-mobile/src/utils/curatedStopsAvailability.ts` (NEW — shared validator for F-2 + F-1(c))
- **What it does:** `checkAllCuratedStopsOpen(stops, startTime, locale?)` — the single canonical curated all-stops validator. Preserves the existing cumulative-arrival model (duration + travel) and routes every open/closed decision through `extractWeekdayText` + `isPlaceOpenAt` (per-stop `utcOffsetMinutes ?? utc_offset_minutes ?? null`). Verdict semantics LOCKED: `false`→closed (counts toward "Some Stops Are Closed"); `true`→open; `null`→honest-unknown, non-blocking. Pure leaf (no RN deps) → Deno-testable.
- **Why:** §B-F1 + §10 (DRY shared helper); SC-2 + SC-1.
- **Lines:** ~110 (new file).

### `app-mobile/src/components/activity/SavedTab.tsx` (F-2)
- **Before:** bespoke `to24Hour` + `checkSingleStopOpen` (used `stop.openingHours?.[dayName]`) + `checkAllStopsOpen` + a local `StopAvailability` interface (~104 lines). The day-key lookup against the Google-v1 `{ weekdayDescriptions }` object was always `undefined` → "no hours → assume open" → false "All Stops Are Open!".
- **After:** the bespoke block DELETED; `checkAllStopsOpen` is now a thin wrapper over `checkAllCuratedStopsOpen(stops, startTime, getUserLocale())`. The existing alert UX (lines 1237-1276, "All Stops Are Open!" / "Some Stops Are Closed", same buttons/handlers) is preserved unchanged — only the verdict is now correct. Added import of the shared helper + its result type.
- **Why:** SC-2; Constitution #9 (no fabricated "open") + #2 (one hours authority).
- **Lines:** ~−95 net.

### `app-mobile/src/components/activity/CalendarTab.tsx` (F-1 a/b/c, F-4, F-5)
- **F-1(a) `entryToCard`:** carries `stops`, `cardType`, `tagline`, `pairingKey`, `experienceType`, `totalPriceMin/Max`, `estimatedDurationMinutes` from `entry.experience`. Drives `isCurated` downstream.
- **F-1(b) reschedule `<ProposeDateTimeModal>`:** added `isCurated={Array.isArray(experience?.stops) && length>0}`. Modal now opens in the curated flow (curated header/footer, no regular "Check Availability" → no `isPlaceOpenAt(null)` → no "couldn't verify" banner).
- **F-1(c) `handleProposeDateTime`:** for curated entries, runs `checkAllCuratedStopsOpen` at the chosen datetime BEFORE committing; on any closed stop shows "Some Stops Are Closed" (named) and aborts the commit. Regular entries unchanged.
- **F-4 device-cal recreate fallback:** the no-stored-ID branch now uses `createEventFromCuratedCard` when `cardData.stops?.length>0` (per-stop "Stop N / Address" lines survive). The stored-ID patch branch is untouched.
- **F-5 location row:** the single location `eventDetailRow` is now conditional — curated entries render an inline numbered per-stop address rail (numbered orange badge + connector + uppercase stop label + place name + address, missing→`locationTBD`), per the DESIGN doc tokens; non-curated entries render the existing single line byte-for-byte. Added `curatedStop*` styles + imports (`checkAllCuratedStopsOpen`, `getUserLocale`).
- **Why:** SC-1, SC-4, SC-5.
- **Lines:** ~+170.

### `app-mobile/src/components/activity/ProposeDateTimeModal.tsx` (F-6)
- **Before:** `{availabilityAssumption}. Please verify opening hours before scheduling.` — `availabilityAssumption` is already the full sentence (`hoursUnknown`), so the screen showed a double period + duplicated clause.
- **After:** renders `{availabilityAssumption}` alone. `hoursUnknown`'s value is unchanged; the `assumptionWarning` i18n key is left untouched but no longer used by this banner.
- **Why:** SC-6.
- **Lines:** ~+4 (added explanatory comment), −2.

### `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` (F-3)
- **Before:** `<ProposeDateTimeModal … />` with no `isCurated`.
- **After:** added `isCurated={Array.isArray(cardData?.stops) && length>0}`. `cardForModal` already spreads `...cardData`, so `stops` was present; only the prop was missing. Collab lock-in now matches SC-1 behaviour.
- **Why:** SC-3.
- **Lines:** ~+4.

### `app-mobile/src/components/ExpandedCardModal.tsx` (F-7 cascade)
- **Before:** `function StopOpenBadge({ openingHours }: { openingHours: Record<string,string> | null | undefined })`.
- **After:** prop typed `CuratedStop['openingHours'] | undefined` (the widened union). `useIsPlaceOpen` already accepts this union and routes through `extractWeekdayText`. Fixes the one TS2322 the F-7 widening introduced.
- **Why:** F-7 cascade — keep the project type-clean with no new error.
- **Lines:** ~+4 (comment), 1 type change.

### `.github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` (NEW — gate, SC-8)
- Scans `app-mobile/src` (`.ts`/`.tsx`), skipping `__tests__`, `node_modules`, and `openingHoursUtils.ts`. Forbids day-key lookups on an `openingHours`-named receiver (string-literal weekday, optional-chained day property, and `[dayName]`/`[weekday]`/`[day]` variable index). `--self-test` plants 5 would-match + 4 must-not-match fixtures.

### `.github/workflows/strict-grep-mingla-business.yml` (gate wiring)
- Added job `orch-1019-curated-hours-canonical-reader` (self-test step + real-run step), modeled on the `orch-0975-notifications-sheet` block. The `app-mobile/**` path filter already triggers the workflow. No untrusted input in the job (static `node` invocations only).

### `app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts` (NEW — T-01 happy-path, implementor-owned)
- Deno-runnable (matches sibling `friendMenu.test.ts`). T-01 (the proven adversarial fixture), T-04 (null-hours non-blocking), T-03 (all-open).

---

## 4. Verification Matrix

| SC | Criterion | How verified | Verdict |
|---|---|---|---|
| SC-1 | Reschedule curated entry → curated flow, no "couldn't verify"; closed stop → "Some Stops Are Closed" (named) | Code: F-1(a/b/c) wired; `isCurated` derived from canonical predicate; reschedule submit runs `checkAllCuratedStopsOpen`. Runtime repro = tester T-02(b). | implemented; runtime UNVERIFIED → tester T-02(b) |
| SC-2 | Schedule curated plan w/ closed stop → "Some Stops Are Closed" (named), NOT "All Stops Are Open!" | Unit T-01 PASS + fails-on-revert PROVEN (see §5). | implemented + verified (unit) |
| SC-3 | Collab lock-in curated → curated flow, no warning | Code: F-3 `isCurated` wired. Runtime = tester. | implemented; runtime UNVERIFIED → tester |
| SC-4 | Reschedule curated via recreate-fallback → device event notes contain "Stop N / Address" for EVERY stop | Code: F-4 branches to `createEventFromCuratedCard` (emits per-stop lines, deviceCalendarService.ts:230). Stored-ID branch untouched. Live grant = tester T-05. | implemented; live-grant UNVERIFIED → tester T-05 |
| SC-5 | Calendar shows every stop's address w/o second screen / per-stop expansion; missing→TBD | Code: F-5 rail renders one always-visible row per stop; missing→`locationTBD`; non-curated unchanged. Runtime = tester T-07. | implemented; runtime UNVERIFIED → tester T-07 |
| SC-5-DESIGN | Designer contract exists + satisfied | Built to DESIGN doc tokens (§3 color/typo/spacing), numbered badge + connector + label + name + address, a11y composed label, TBD fallback, no-slop (no gradient/card-in-card/emoji/carousel/accordion). | implemented (matches DESIGN) |
| SC-6 | Advisory banner = one sentence, one period, no dup clause | Code: F-6 renders `availabilityAssumption` alone. Runtime = tester T-06. | implemented; runtime UNVERIFIED → tester T-06 |
| SC-7 | `CuratedStop.openingHours` is the union; project type-checks w/o a day-key silencer cast | tsc: zero NEW errors in touched files (only baseline repo-wide `JSX` namespace error on a pre-existing line; F-7 cascade in ExpandedCardModal fixed). | implemented + verified |
| SC-8 | Gate fails on a day-name index, passes on post-fix tree | `--self-test` PASSED; clean-tree run PASSED (422 files, 0 violations). | implemented + verified |

**UNVERIFIED rationale:** SC-1/3/5/6 and the SC-4 live grant require the iOS sim + Android emulator runtime flows the tester owns (T-02..T-07). The validator logic (the root cause of SC-1/SC-2/SC-3) is exercised and revert-proven at unit level via the shared helper. No shippable criterion is left unverified at the *logic* layer.

---

## 5. Regression Test (CLOSE Step-0.5 gate)

- **Path:** `app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts`
- **Runner:** Deno (`deno test --sloppy-imports --no-check`), matching the sibling `friendMenu.test.ts` / `discoverEventsCache.test.ts` pattern (app-mobile has no jest preset; pure-logic units are Deno-tested).
- **Passing run (fix in place, commit `d2101c61a`):**
  ```
  ORCH-1019 T-01: dinner stop closed at arrival → not all open, names the stop (Google-v1 shape) ... ok
  ORCH-1019 T-04: stop with no parseable hours is non-blocking (honest-unknown ≠ closed) ... ok
  ORCH-1019 T-03: all stops open at the chosen time → allOpen true ... ok
  ok | 3 passed | 0 failed
  ```
- **Fails-on-revert PROVEN:** temporarily reverted `checkAllCuratedStopsOpen` to the deleted bespoke `stop.openingHours?.[dayName]` lookup against the Google-v1 fixture → T-01 FAILED (`allOpen` actual `true` vs expected `false`):
  ```
  FAILURES — ORCH-1019 T-01 ... => curatedStopsAvailability.test.ts:27:6
  FAILED | 2 passed | 1 failed
  ```
  Then restored the fix (helper byte-identical to committed `d2101c61a`, `git diff --quiet` clean) → 3 passed, 0 failed.
  - Fails-on-revert verified at fixed commit **`d2101c61a610b340ac7d31652119c5512281eead`**.
- **Gate (SC-8) is itself a revert guard (T-08):** `--self-test` plants `openingHours["Monday"]` → matches (would exit 1); canonical `extractWeekdayText(openingHours)` → does not match. Self-test PASSED, clean-tree PASSED.

---

## 6. Local checks captured

- **Strict-grep gate:** `--self-test` PASSED; clean-tree run PASSED (`scanned 422 file(s) under app-mobile/src; no direct openingHours day-key lookup found`).
- **Regression test:** 3 passed / 0 failed (fix in place); 1 failed (reverted) — fails-on-revert proven.
- **tsc (`app-mobile`, `tsc --noEmit -p tsconfig.json`):** repo has ~260 pre-existing baseline errors (Deno-test URL imports, repo-wide `JSX` namespace, brand-rendering package, etc. — all on `main`). My touched files introduce **zero NEW** errors. The one F-7 cascade (ExpandedCardModal TS2322) was fixed in the same commit. The only remaining error in a touched file, `LockedCardSchedulingSheet.tsx:76 Cannot find namespace 'JSX'`, is a pre-existing baseline error on HEAD (the `JSX.Element` return annotation at line 76, not my edit at ~199 — confirmed via `git show HEAD:`).
- **eslint (touched files):** net-new helper `curatedStopsAvailability.ts` → **0 problems**. The 3 eslint *errors* in the touched-file set are all baseline patterns: the Deno-URL `import/no-unresolved` on the new test (identical on sibling `friendMenu.test.ts` — these run under Deno, not eslint) and `@/src/services/deviceCalendarService` unresolved (pre-existing on HEAD's SavedTab). No new lint error introduced.

---

## 7. Invariant Preservation

- **I-CURATED-HOURS-VIA-CANONICAL-READER (DRAFT→ACTIVE on CLOSE):** PRESERVED. Bespoke parser deleted; all curated call-sites (SavedTab schedule, CalendarTab reschedule, ActionButtons reference) route through `extractWeekdayText`+`isPlaceOpenAt`. Gate + test enforce it. (Orchestrator adds the registry entry at CLOSE per SPEC §6.)
- **Constitution #9 (no fabricated data):** PRESERVED — F-2 no longer fabricates "open"; F-5 shows `locationTBD` for missing addresses, never invents.
- **Constitution #12 (validate at right time):** PRESERVED — validation uses the chosen/estimated-arrival datetime and per-stop `utcOffsetMinutes` when present (device-local fallback otherwise, the reader's documented behaviour).
- **Constitution #2 (one owner per truth):** PRESERVED — the canonical reader is the single hours authority; the competing bespoke parser is gone.

---

## 8. Parity / Cache / Regression Surface

- **Parity:** solo (SavedTab) + collab (LockedCardSchedulingSheet) + reschedule (CalendarTab) all route through the same shared validator → no drift. iOS/Android automatic (shared RN).
- **Cache:** no query keys, no data-shape change to persisted rows (the F-7 union DESCRIBES existing persisted shapes; it does not migrate them). No AsyncStorage impact.
- **Regression surface (tester should re-check):** (1) regular single-place card scheduling advisory path (unchanged); (2) curated initial schedule from Saved "All Stops Are Open!"/"Some Stops Are Closed" verdict + alert buttons; (3) non-curated calendar entry single location row (must be byte-identical); (4) ExpandedCardModal `StopOpenBadge` + today's-hours rendering (F-7 type cascade); (5) device-calendar reschedule for entries WITH a stored `device_calendar_event_id` (must still patch dates + preserve notes).

---

## 9. Deviations from spec

None. The SPEC encouraged (not mandated) a shared helper for F-1(c)/F-2 (§10, §B-F1) — implemented as `curatedStopsAvailability.ts`. The §B-F2 data-source decision (no offset today, forward-compatible read) is honored verbatim; the §11 generator enhancement remains deferred and untouched. The closed-reason wording uses the SPEC's example "May be closed at <time>" (a 🎨-OPEN choice).

---

## 10. Discoveries for Orchestrator

- **Canonical reader parse limitation (non-blocking, FYI):** `parseTimeToMinutes` in `openingHoursUtils.ts` requires an explicit AM/PM on BOTH ends of a range; a Google string like `"5:00 – 10:00 PM"` (meridiem only on the close) fails to parse → returns `null` → treated as honest-unknown/open. The T-01 fixture uses the fully-qualified `"5:00 PM – 10:00 PM"` form to exercise the bug deterministically. SPEC §2 forbids touching the reader, so this is left as-is. If real Google-v1 `weekdayDescriptions` commonly omit the open-side meridiem, a future hardening of `parseTimeToMinutes` (infer the open meridiem from the close) would make more closed-at-arrival cases honest. Out of ORCH-1019 scope — flagging for a possible follow-up.
- **Deferred §11 generator enhancement** (per-stop `utcOffsetMinutes` emission from `place_pool.utc_offset_minutes`) remains unregistered as its own ORCH — the type field is now in place client-side so it's a zero-client-change pickup when the generator starts emitting it.
- **Repo tsc/eslint baseline is not clean** (~260 tsc errors, repo-wide `JSX` namespace + Deno-URL imports). Not introduced here, but worth a baseline-cleanup ORCH eventually so future implementors can use a green tsc as a gate rather than a diff.
