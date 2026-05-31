# QA — ORCH-1019 [Curated-card scheduling: honest opening-hours validation + per-stop calendar addresses]

- **Mode:** TARGETED + SPEC-COMPLIANCE (tester: Claude `mingla-tester`)
- **Date:** 2026-05-30
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1019-[curated-schedule-hours-calendar-notes]/` on branch `ORCH-1019-curated-schedule-hours-calendar-notes`
- **Tree under test:** HEAD `aa44e3fdd55d30604a159a6d1a74b56d247ec717`
- **Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`, shared RN). Verified BOTH at runtime.
- **Inputs:** SPEC (`SPEC_ORCH-1019_…`), DESIGN (`DESIGN_ORCH-1019_F5_…`), IMPLEMENTATION report, INVESTIGATION report (proven bug repro + `/tmp/orch1019_*.png`).
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets ORCH-1019, `mingla-tester`, or actionable `ALL` this turn. COMMS-0003 (external-API docs) is **N/A** — client-only change, no external-API enum/payload/endpoint introduced (the one external value `utcOffsetMinutes` is read-only and already wired; generator untouched per SPEC §11). No new cross-ORCH discovery to write.

---

## VERDICT: PASS

- P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 2
- **Every success criterion SC-1..SC-8 verified.** Both root-cause defects (false "All Stops Are Open!" + false "couldn't verify") are fixed and runtime-proven on iOS Simulator AND Android Emulator. Per-stop calendar addresses (F-5) render correctly on both platforms. Adversarial regression test written, passing, and fails-on-revert proven. Strict-grep gate passes self-test + clean tree. No regressions to the non-curated row or regular-card advisory path.

### Verdict gate (Phase 0.A) — satisfied
- PASS-level (`proven`) live-fire repro on **both** applicable platforms: iOS sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC` (iPhone 17 Pro Max, iOS 26.4) + Android emu `emulator-5554` (Pixel 8 Pro). Web leg N/A — curated-card scheduling does not ship on buyer-web/business/admin (SPEC §2.5).
- A Metro/worktree blocker WAS hit and RESOLVED (not noted) — see "Sim/Emulator legs → Blocker resolved" below.

### Regression-test gate — satisfied (all three)
1. **Tester adversarial test** committed at `app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` — 4 vectors, attacks a DIFFERENT angle than the implementor's happy-path (see §"Adversarial test"). Passing run + fails-on-revert captured below.
2. **Implementor happy-path test** `app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts` exists, runs green (3/3), fails-on-revert PROVEN at implementor commit `d2101c61a` (re-verified independently by tester, see below).
3. Both test files appear in `git diff origin/main...HEAD --name-only` (confirmed) — they ship with the fix.

---

## Sim/Emulator legs

| Leg | Device | Result |
|-----|--------|--------|
| iOS Simulator | iPhone 17 Pro Max `2C3312D9-…`, iOS 26.4 | `proven` — SC-1, SC-2 (verdict semantics), SC-5 all reproduced with the FIX. Screenshots `/tmp/orch1019_qa_04..09_*.png`. |
| Android Emulator | Pixel 8 Pro `emulator-5554`, API per AVD | `proven` — SC-1, SC-2 (verdict semantics), SC-5 all reproduced with the FIX, byte-parity with iOS. Screenshots `/tmp/orch1019_android_13..16_*.png`. |
| Web | — | N/A — surface does not ship (SPEC §2.5 rows 3–7). |

### Blocker resolved (per `feedback_sim_boot_blocker_must_resolve_not_note.md`)
The per-ORCH worktree path contains literal `[` `]` brackets (`ORCH-1019-[curated-schedule-hours-calendar-notes]`). Metro started from the worktree red-screened with `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry` (the bracketed path + symlinked `node_modules → anchor` breaks Metro's relative resolver). **Resolution:** applied the 6 changed ORCH-1019 source files onto the anchor checkout (`~/Desktop/mingla-main`, real `node_modules`, no bracket path), served from the anchor Metro, captured all live-fire evidence, then reverted the anchor to clean `main` byte-for-byte. The anchor's pre-existing dirty `ExpandedCardModal.tsx` (another session's uncommitted work) was **left untouched** — no cross-session interference (`feedback_shared_anchor_checkout_staging_hazard.md`). A dedicated Android Metro was started from the anchor on a fresh port so the parallel iOS session's Metro was never disrupted; both my Metros were killed at teardown.

---

## Per-SC evidence

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| **SC-1** | Reschedule curated entry → curated flow, NO "couldn't verify"; closed stop → "Some Stops Are Closed" (named), else commits | **PASS (proven, both platforms)** | iOS `/tmp/orch1019_qa_05_reschedmodal.png`: header "Schedule Plan", banner "2 stops · Opening hours will be validated for all stops", footer "Pick a date first" — NO "couldn't verify" banner (vs investigation's broken `/tmp/orch1019_13/14`). iOS `/tmp/orch1019_qa_09_committed.png`: validator fired → "Some Stops Are Closed · Nasher Museum of Art at Duke University — May be closed at 5:13 PM" with [Choose New Time][Cancel]. Android parity: `/tmp/orch1019_android_14_resched.png` (curated flow) + `/tmp/orch1019_android_16_alert.png` (Material "Some Stops Are Closed · …May be closed at 5:23 PM"). |
| **SC-2** | Schedule curated plan w/ stop closed at arrival → "Some Stops Are Closed" (named), NOT "All Stops Are Open!" | **PASS (unit revert-proven + runtime verdict-semantics proven)** | Implementor T-01 (Google-v1 shape) + tester T-02-A/B/C (legacy record, explicit "Closed", cumulative-close) all green; all FAIL when reverted to the bespoke `openingHours[dayName]` parser (see §Fails-on-revert). Runtime: the identical "Some Stops Are Closed" verdict + "May be closed at <time>" copy proven on both platforms via the reschedule path (same shared validator `checkAllCuratedStopsOpen`). |
| **SC-3** | Collab lock-in curated → curated flow, no warning | **PASS (source-confirmed)** | `LockedCardSchedulingSheet.tsx:197-201` passes `isCurated={Array.isArray(cardData?.stops) && length>0}` (diff verified). Identical mechanism to F-1, which is runtime-proven on both platforms. A 2-device collab session was not stood up (dispatch permits source-confirm); the curated-routing prop is the entire fix and is wired correctly. |
| **SC-4** | Reschedule curated via recreate-fallback → device-cal notes contain "Stop N / Address" for EVERY stop | **PASS (builder-output source-verified)** | `CalendarTab.tsx:680-697` branches `isCuratedEntry → createEventFromCuratedCard(cardData, date, …)` for the no-stored-ID recreate path; stored-ID patch branch untouched (diff verified). `createEventFromCuratedCard` (deviceCalendarService.ts:218-255) emits per-stop "Stop N: name / Address:" lines. The app-layer builder choice — what this SC verifies — is correct. Live OS calendar-grant not exercised (P3 note below); builder selection is the load-bearing change and is proven. |
| **SC-5** | Calendar shows every stop's address w/o second screen / per-stop expansion; missing→TBD | **PASS (proven, both platforms)** | iOS `/tmp/orch1019_qa_04_calendar.png` + Android `/tmp/orch1019_android_13_cal.png`: the "Nasher → Parizade" entry shows BOTH stops inline — ① START HERE · Nasher Museum … / 2001 Campus Dr…  ② END WITH · Parizade / 2200 W Main St… — orange numbered badges, uppercase orange labels, connector, address per stop, zero taps. Directly fixes investigation's `/tmp/orch1019_12_cal.png` (showed 1 of 2). |
| **SC-5-DESIGN** | Designer contract exists + satisfied | **PASS** | Built to `DESIGN_ORCH-1019_F5_…` §3 tokens: 20×20 `#eb7825` badge, white bold numeral, `rgba(235,120,37,0.32)` connector, 11pt/600 uppercase `#eb7825` label, middot `rgba(255,255,255,0.4)`, 13pt place name, `rgba(255,255,255,0.72)` address, `locationTBD` italic fallback. Composed `accessibilityLabel` per stop; connector `accessibilityElementsHidden`. No gradient/card-in-card/emoji/carousel/accordion (anti-slop bans honored). Rendered output matches the anatomy on both platforms. |
| **SC-6** | Advisory banner = one sentence, one period, no dup clause | **PASS (source-verified)** | `ProposeDateTimeModal.tsx` now renders `{availabilityAssumption}` alone (= i18n `hoursUnknown` = "We couldn't verify this place's hours. Please double-check before scheduling." — `activity.json:131`). The old `+ ". Please verify opening hours before scheduling."` append (which produced the doubled clause + double period captured in `/tmp/orch1019_14_warning.png`) is removed. The `assumptionWarning` key (line 132) is left in place but unused by this banner per SPEC §F-6. Banner only appears for genuine single-place cards with unparseable hours (curated cards no longer route here post-F-1/F-3). |
| **SC-7** | `CuratedStop.openingHours` typed as union; project type-checks w/o a day-key silencer cast | **PASS** | `curatedExperience.ts:18` widened to `{openNow?;periods?;weekdayDescriptions?;nextOpenTime?;nextCloseTime?} | Record<string,string> | string[] | string | null` + optional `utcOffsetMinutes?`. F-7 cascade in `ExpandedCardModal.tsx` (`StopOpenBadge` prop → `CuratedStop['openingHours']`) fixed in same commit. `tsc --noEmit` on `app-mobile`: zero NEW errors in touched files; the one hit (`LockedCardSchedulingSheet.tsx:76 Cannot find namespace 'JSX'`) is a pre-existing repo-wide baseline error — byte-identical on HEAD and `origin/main` (line 76 `JSX.Element | null`, NOT the ORCH-1019 edit at ~line 199). |
| **SC-8** | Strict-grep gate fails on a day-name index, passes on post-fix tree | **PASS** | `.github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test` → PASSED (5 would-match fixtures incl. `openingHours["Monday"]`, `openingHours?.[dayName]`; 4 must-not-match incl. `extractWeekdayText(stop.openingHours)`). Clean-tree run → PASSED (422 files, 0 violations). Workflow job `orch-1019-curated-hours-canonical-reader` wired into `strict-grep-mingla-business.yml`. |

---

## Adversarial regression test (tester-owned, CLOSE Step-0.5(b))

- **Path:** `app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` (distinct file; implementor's `curatedStopsAvailability.test.ts` left untouched/append-only).
- **Runner:** Deno (`deno test --sloppy-imports --no-check`), matching sibling `friendMenu.test.ts`.
- **Why adversarial (different angle than the implementor happy-path T-01):** T-01 attacks ONE vector — 2-stop, RAW Google-v1 `weekdayDescriptions`, stop closed because arrival is BEFORE open. The adversarial file attacks FOUR distinct vectors of the same false-OK class:
  - **T-02-A** — LEGACY lowercase-day-record shape (`{ saturday: "5:00 PM – 10:00 PM" }`), stop closed at arrival. The deleted bespoke parser indexed `openingHours["Saturday"]` (capital S) on a lowercase-keyed record → miss via **case mismatch** (a different miss mechanism than T-01's "no key at all").
  - **T-02-B** — a stop explicitly `"Saturday: Closed"` → must hit `isPlaceOpenAt`'s `/closed/` branch, not the time-range branch.
  - **T-02-C** — closes-at-arrival via the CUMULATIVE model (3 stops): a later stop whose cumulative arrival (start + Σ durations + Σ travel = ~3:30 PM) falls AFTER it closes (2:00 PM). T-01 only exercises the "before open" direction; this exercises the "after close" direction at stop 3.
  - **T-02-D** — curated stop array yields a real per-stop verdict (proves the reschedule path no longer falls through to the regular `isPlaceOpenAt(null)` "couldn't verify" flow).
- **Passing run (fix in place, HEAD `aa44e3fdd`, validator sha256 `ef6ada10…`):** `4 passed | 0 failed`. Combined with implementor test: `7 passed | 0 failed`.
- **Fails-on-revert PROVEN:** the tester temporarily replaced `checkAllCuratedStopsOpen` with the deleted bespoke `stop.openingHours?.[dayName]` parser (verbatim from the SavedTab diff), then ran both files:
  - Implementor `curatedStopsAvailability.test.ts`: **1 failed** (T-01 `allOpen` true≠false — false-OK confirmed).
  - Tester adversarial: **3 failed** (T-02-A, T-02-B, T-02-C all report false-OK; T-02-D is a structural guard and is expected to pass under the false-OK revert).
  - Validator then restored byte-identical (sha256 `ef6ada10…` re-confirmed, `git diff --quiet` clean) → `7 passed | 0 failed`.
  - **Revert proof anchored at fix commit `aa44e3fdd55d30604a159a6d1a74b56d247ec717`** (also independently confirms the implementor's `d2101c61a` fails-on-revert claim).

---

## Regression checks (dispatch-mandated)

1. **Non-curated calendar location row byte-identical:** PASS. F-5 is additive+conditional — the `!isCuratedRail` branch returns the EXACT original `eventDetailRow` (same `styles.eventDetailRow`, `Icon name="location" color="#eb7825"`, `entry.experience?.address || entry.address || locationTBD` chain). Single-place entries cannot regress.
2. **Regular single-place card scheduling availability still works:** PASS. ProposeDateTimeModal diff touches ONLY the banner text render; the `isPlaceOpenAt`/`handleCheckCompatibility` availability logic (lines 280-288) is untouched. The `null→advisory` behavior for genuine single-place cards is preserved by design (SPEC §2 Non-Goals).
3. **New strict-grep gate passes on this tree:** PASS (self-test + clean-tree, 422 files, 0 violations).
4. **Touched-package typecheck:** PASS — zero NEW tsc errors in touched files; the single hit is a pre-existing repo-wide baseline (`JSX` namespace) byte-identical on `origin/main`.

---

## Constitution check (touched rules)

| Rule | Verdict | Note |
|------|---------|------|
| #2 One owner per truth | PASS | Canonical reader (`extractWeekdayText`+`isPlaceOpenAt`) is the single hours authority; bespoke parser deleted. |
| #9 No fabricated data | PASS | F-2 no longer fabricates "open" (proven: museum correctly flagged closed at 5:13/5:23 PM); F-5 uses `locationTBD` for missing addresses, never invents. |
| #12 Validate at right time | PASS | Validation uses the chosen/estimated-arrival datetime (not `new Date()`); per-stop `utcOffsetMinutes` consumed when present, documented device-local fallback otherwise. |
| #3 No silent failures | PASS | Closed-stop reschedule shows an alert and aborts the commit — no silent schedule of a closed plan. |

All other constitution rules N/A to this change.

---

## Findings

- **P3-01 (LOW) — SC-4 live OS calendar-grant not exercised at runtime.** The F-4 builder selection (`createEventFromCuratedCard` on the recreate-fallback) is source-verified and the builder's per-stop output is proven by inspection of `deviceCalendarService.ts`, but a live device-calendar permission grant + recreate cycle was not driven on either platform this turn. Risk is minimal — the only change is which builder is called, and the curated builder is already the proven initial-schedule path. Recommend a one-time manual grant spot-check before a calendar-export-heavy release.
- **P4-01 (NOTE) — `parseTimeToMinutes` requires AM/PM on both ends.** Documented by the implementor (Discoveries §10): a Google string like `"5:00 – 10:00 PM"` (meridiem only on the close) returns `null` → honest-unknown/open. SPEC §2 forbids touching `openingHoursUtils.ts`, so this is correctly out of scope. The live museum repro ("May be closed at 5:13/5:23 PM") confirms the common fully-qualified shape parses correctly. Flagged for a possible future hardening ORCH.
- **P4-02 (NOTE) — clean shared-helper architecture.** Factoring the validator into `curatedStopsAvailability.ts` (a pure Deno-testable leaf used by SavedTab schedule + CalendarTab reschedule) is exactly the DRY, single-authority pattern the invariant demands. Good work.

---

## Discoveries for orchestrator

- **I-CURATED-HOURS-VIA-CANONICAL-READER** is ready to flip DRAFT→ACTIVE at CLOSE (gate live + green; both regression tests enforce it).
- The bracketed worktree path (`[`/`]`) breaks a worktree-local Metro's module resolver — a recurring class of worktree blocker. Tester resolved it by serving from the anchor with files applied+reverted. Worth noting for future UI-runtime test dispatches in bracketed worktrees (consider a bracket-free worktree naming convention, or always test from the anchor with a clean apply/revert).
- Deferred §11 generator `utcOffsetMinutes` enhancement remains unregistered; the client field is in place for a zero-client-change pickup.

---

## Completion condition (`/goal`) — all five clauses hold

1. ✅ Every independent test green — `7 passed | 0 failed` (implementor 3 + tester adversarial 4); output captured above.
2. ✅ `tsc --noEmit` on `app-mobile` — zero NEW errors in touched files (only pre-existing repo-wide `JSX` baseline, proven identical on `origin/main`). Gate self-test + clean-tree green.
3. ✅ Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle; implementor fails-on-revert at `d2101c61a` (independently re-confirmed by tester at `aa44e3fdd`).
4. ✅ UI/runtime change reproduced at `proven` level on iOS + Android (web N/A — surface absent). Worktree/Metro blocker RESOLVED, not noted.
5. ✅ Zero open P0, zero open P1.
