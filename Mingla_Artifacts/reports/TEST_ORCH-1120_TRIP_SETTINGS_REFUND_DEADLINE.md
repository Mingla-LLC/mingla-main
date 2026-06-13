# TEST — ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking deadline + bookings-closed (sales-gated)]

**Skill:** mingla-tester (business side). **Date:** 2026-06-12.
**Worktree:** `~/Desktop/mingla-orchs/orch-1120-[trip-settings-refund-deadline]/` on branch `orch-1120-trip-settings-refund-deadline` (rebased on origin/main at entry: was 7 ahead / 4 behind → rebased clean).
**Mode:** TARGETED + SPEC-COMPLIANCE.
**Comms ledger:** read on entry. No `BLOCK`-open row targets `mingla-tester` or `ORCH-1120`. COMMS-0024 (1116/1117 ID-collision WARN/ALL) is an FYI for this ORCH — 1120 owns its number cleanly per the dispatch; no ack required (factored, not a code concern). Nothing else pending.

---

## 1. VERDICT

### CONDITIONAL PASS — 0 P0 · 0 P1 · 1 P2 · 2 P3 · 1 P4

The backend sales-gate (the load-bearing buyer-protection logic) is **PROVEN correct end-to-end against the REAL `biz_update_live_trip` RPC** on a faithful non-prod stack — all 11 SPEC test cases (T-1..T-11) plus 12 tester-authored adversarial boundary cases (ADV-1..ADV-12) return the exact `{ok, reason, affected_order_count}` and the correct write/no-write side-effect, and the gate is proven to **fail-on-revert**. The DISC-1120-A landmine (zero `refundPolicyService` on the published path) is **PROVEN closed**. The migration is a verified verbatim re-emission of the 1075 body (only the severity line modified, +166 lines = the new blocks). SC-9 Android opaque-glass is proven at the shared-primitive level.

**The single reason this is CONDITIONAL and not full PASS:** the **business-app UI runtime / dead-tap proof is login-gated** (the documented prior-ORCH blocker) — I could not log into the business app on the sim to drive the Bookings-closed Switch + the two editors and observe them FIRE + PERSIST at runtime. Per the I-INTERACTIVE-ELEMENTS-MUST-FIRE invariant and the confidence ladder, the UI-fires claim (SC-1 control firing, SC-2 save round-trip, T-14) is capped at **suspected** (source wiring is correct and complete, but a logged-in device tap was not performed). The CONDITIONAL-PASS condition is the device-step checklist in §9 that Seth must run before CLOSE.

This is exactly the runtime gap the SPEC (Q-3) and the dispatch anticipated; it is surfaced as an explicit condition, **not** a silent gap.

---

## 2. SC-by-SC matrix

| SC | Claim | Verdict | Evidence (proven/suspected) |
|----|-------|---------|------------------------------|
| SC-1 | Settings shows editable refund block + deadline picker + LIVE switch; no read-only snapshot, no "use the wizard" hint | **PASS (structure proven) / control-fires suspected** | Source: accordion mounts `RefundPolicyEditor` + `BookingDeadlinePicker` + live `Switch` (`onValueChange={setClosed}`, no hardcoded `disabled`); dead-end hint + dead styles deleted (`EditPublishedTripScreen.tsx` diff). Runtime tap = **suspected** (login-gated, §9). |
| SC-2 | Edit → dirty → Save → reason ≥10 → commit via `biz_update_live_trip` → "Settings saved. Live now." | **PASS (wiring proven) / round-trip suspected** | Source: `dirty` JSON-compare, `onDirtyChange`→`settingsDirty`→`editedSectionKeys.add("settings")`, `onConfirmSave` builds dirty-only patch → `useUpdateLiveTripFields` → success Toast copy verbatim. End-to-end RPC commit **proven** (T-2/T-7/T-10 wrote rows); the on-device button→toast leg = suspected (login-gated). |
| SC-3 | Every save routes through `updateLiveTripFields`→`biz_update_live_trip`; ZERO `refundPolicyService` on published path | **PASS (proven)** | grep+trace §5: only `TripCreatorWizard` + `useRefundPolicy.ts` + `refundPolicyService.ts` call the writers; published files reference them only in comments + a `type`-only `RefundPolicy` import. Strict-grep gate runs green (EXIT=0). |
| SC-4 | Paid orders + buyer-UNFAVORABLE edit HARD-BLOCKED, nothing written, parent "Refund first" dialog | **PASS (RPC proven; dialog wiring proven)** | T-1/T-4/T-6/T-9 + ADV-3/ADV-4/ADV-6/ADV-7/ADV-8/ADV-11/ADV-12 all returned `ok:false`+correct reason+count AND the events row was unwritten (side-effect asserted). Parent `buildRejectDialog` has all 4 "Refund first" cases before `_exhaust:never` (source). |
| SC-5 | Paid orders + buyer-FAVORABLE edit ALWAYS applies | **PASS (proven)** | T-2/T-3/T-7/T-8/T-10 + ADV-1/ADV-2/ADV-5/ADV-9 returned `ok:true` and wrote the row (side-effect asserted). |
| SC-6 | NO sales → all edits apply freely | **PASS (proven)** | T-5 (no order) + ADV-10 (only a cancelled order → sold=0) applied an unfavorable downgrade with `ok:true`. |
| SC-7 | On `ok:false`, banner stays open, reason + edit state preserved, submitting clears | **PASS (source proven) / runtime suspected** | FORK-1: `ok:false`→`onReject(result)` only (banner not closed), `finally setSubmitting(false)`; thrown→local `reasonError`. Behavioral preserve-on-reject = suspected (login-gated). |
| SC-8 | Submit disables editors (0.6/pointerEvents:none) + Switch; network error → inline copy | **PASS (source proven) / runtime suspected** | FORK-2 wrappers + `disabled={submitting}`; catch → `reasonError` "Couldn't save. Try again." Runtime = suspected. |
| SC-9 | Android opaque ≥0.92 `GlassCard` fallback; web preview editable | **PASS (static proven)** | `GlassChrome.tsx` `FALLBACK_BACKGROUND="rgba(20,22,26,0.92)"` + `overflow:"hidden"`; accordion banners use `GlassCard`→`GlassChrome` (no hand-rolled translucent fill). Web preview = same RN component (suspected-render, acceptable static per dispatch #5). |

---

## 3. Findings (P-numbered)

### P2-1 — UI runtime / dead-tap proof not performed (login-gated) — CONDITIONAL-PASS condition
- **Evidence:** Business app is installed on the booted iPhone 17 Pro sim (`com.sethogieva.minglabusiness`), but (a) the Metro on :8081 is serving the default Expo template ("Welcome to Expo"), not this worktree's business bundle, and (b) the business root layout (`mingla-business/app/_layout.tsx:212`) gates authenticated routes behind `useAuth().user`. Reaching a PUBLISHED trip **with paid sales** → Edit → Settings requires real credentials + seeded backend data. `@testing-library/react-native` is NOT installed and the trip suite has no `render()` precedent, so an isolated behavioral render test is not a supported pattern here.
- **Impact:** SC-1 (Switch + editors fire), SC-2 (save→toast round-trip), SC-7/SC-8 runtime legs are capped at **suspected**. Source wiring is complete and correct (`onValueChange={setClosed}`, `onPress`, FORK-1/FORK-2), so the dead-tap risk is LOW, but the I-INTERACTIVE-ELEMENTS-MUST-FIRE invariant requires a logged-in device tap.
- **Required fix:** none in code — Seth runs the §9 device checklist.
- **Retest:** §9 steps; confirm the Switch flips + Save enables + a favorable edit shows "Settings saved. Live now." + an unfavorable edit on a sold trip shows the "Refund first" dialog.

### P3-1 — proactive-banner count semantics differ from the server gate count (graceful, by design)
- **Evidence:** `EditPublishedTripScreen.tsx` passes `affectedOrderCount={totalConfirmedOrders}` where `totalConfirmedOrders = Σ soldCountByTier` (L628). The server gate uses `v_total_sold` from `biz_trip_sold_count_by_tier` (paid non-cancelled `order_line_items` quantity). These are computed from different client/server sources and could momentarily diverge.
- **Impact:** The banner is a *proactive teach* only; the SERVER is the source of truth for the actual block (SPEC §4.4.5 LOCKED graceful approach). A divergence shows a slightly-off banner number, never a wrong gate decision. Acceptable per the locked decision; flagged for awareness.
- **Required fix:** none (matches SPEC Q-2 default). Optional future: a single live sold-count query for the banner.
- **Retest:** n/a.

### P3-2 — reserved-but-unused reason `refund_tier_removed_with_sales` (Q-1 default, documented)
- **Evidence:** The realized-% classifier emits `refund_policy_downgrade_with_sales` for ALL refund downgrades incl. tier removal (proven: T-4 + ADV-3 returned `refund_policy_downgrade_with_sales`, not `refund_tier_removed_with_sales`). The reason exists in the union + `buildRejectDialog` for type-exhaustiveness + design-table fidelity but is never emitted by the RPC.
- **Impact:** none functional — the type stays exhaustive and the build compiles. It is dead-but-honest per the SPEC Q-1 default. Flagged so the orchestrator knows the design's two-reason table collapsed to one reason at runtime (the money-accurate reading).
- **Required fix:** none unless Seth flips Q-1 to a literal-tier-count branch.
- **Retest:** n/a.

### P4-1 — praise: verbatim 1075 re-emission + real-RPC-mirroring classifier
- The migration re-emits the entire 1075 `biz_update_live_trip` body byte-identical except the single severity line (correctly extended) — diff proves exactly 1 removed line / 166 added (all new-block). The §4g realized-% classifier mirrors `biz_compute_refund_for_cancel` tier selection exactly, and the gate RETURNs before any write so a mixed favorable+unfavorable patch blocks atomically (ADV-11 proven: neither field persisted). Clean, surgical, correct.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

**Implementor's claim:** happy-path test `EditPublishedTripSettings_orch_1120_regression.test.ts` (22 tests) "fails-on-revert verified at `b9e7990a4`" against component `8bed59509`; deleting `onReject(result);` (line 170) fails the FORK-1 test.

**My independent re-run (this session):**
- Checked out branch HEAD (rebased). Ran the suite → **22 passed, 22 total** (PASS).
- True line-edit: commented `onReject(result);` in `EditPublishedTripSettingsAccordion.tsx` → re-ran → **1 failed, 21 passed**. Exact failing assertion at `EditPublishedTripSettings_orch_1120_regression.test.ts:99`: `expect(code).toMatch(/onReject\(result\)/)` — the FORK-1 routing assertion. Matches the implementor's claim.
- Restored the line → **22 passed** again, clean tree.

**Caveat (recorded, not a finding):** the implementor's happy-path test is **entirely source-text grep assertions** (it `readFileSync`s the files and regex-matches), not a behavioral render or RPC execution. It pins structure, not behavior. This is why the tester adversarial test (§5) attacks the *behavioral* gate against the real RPC — the genuinely different angle.

---

## 5. Adversarial test added (tester, different angle)

**Path:** `supabase/migrations/__tests__/orch_1120_trip_settings_refund_deadline_tester_e2e.test.sql` (NEW, append-only).
**Commit:** `9f50ede78` (on branch `orch-1120-trip-settings-refund-deadline`).
**Both tests in the closing diff** (`git diff origin/main...HEAD --name-only`): implementor `EditPublishedTripSettings_orch_1120_regression.test.ts` + implementor `orch_1120_*.test.sql` + tester `orch_1120_*_tester_e2e.test.sql`. ✓

**Different angle (vs both implementor tests):** the implementor's `.test.sql` tests a `pg_temp` **re-implementation** of the classifier (M-11..M-16) + a `pg_get_functiondef` **string-marker** check (M-10); it never executes the real RPC. The implementor's jest test is source-grep. **My test drives the live `biz_update_live_trip(uuid,jsonb,text)` RPC end-to-end** — seeds `creator_account` + brand (`account_id`=owner) + a `live` trip + paid/partial/cancelled orders, sets `auth.uid()` via `request.jwt.claims`, and calls the RPC, asserting both the returned JSON AND the `events`-row write/no-write side-effect.

**Cases driven against the REAL RPC (all PASS, proven on the local stack 2026-06-12):**
- **SPEC T-1..T-11:** every one returned the exact expected `{ok, reason, affected_order_count}`; blocks verified to NOT write the row; bad ascending policy (T-11) raised the monotonicity exception.
- **ADV-1** identical-policy = neutral → ALLOW. **ADV-2** insert a tier raising a previously-uncovered band (non-matching union) → ALLOW. **ADV-3** drop a MID-band tier (d=60..89 50→0) → BLOCK. **ADV-4** lower one band while others unchanged → BLOCK. **ADV-5** deadline set EXACTLY equal → ALLOW (`<` boundary). **ADV-6** deadline 1-minute earlier → BLOCK (opposite boundary). **ADV-7** NULL→deadline (window shrinks) → BLOCK. **ADV-8** `partial_refund` order counts as a sale → BLOCK. **ADV-9** `true→true` no-flip → ALLOW. **ADV-10** only a cancelled order (sold=0) → unfavorable ALLOWED. **ADV-11** mixed patch (favorable later-deadline + harmful close) → BLOCK WHOLLY, **neither field persisted** (atomic-block invariant). **ADV-12** clear policy to NULL with sales → BLOCK.

**fails-on-revert (PROVEN by me on the live RPC):** neutered the three §4g gate `IF` conditions (forced them `false`) and re-applied the RPC → re-ran the driver → **T-1 flipped `ok:false`→`ok:true`** and the script ERRORed: `T-1 FAIL: expected ok=f got ok=t (full={"ok": true, ...})`. Restored the gate → all 22 cases passed again. The adversarial test is a genuine regression tripwire on the live gate logic, not just on source text.

**Run instructions (non-prod ONLY):** `supabase start` (or a Supabase branch) → `docker exec <db> psql -U postgres -d postgres -v ON_ERROR_STOP=on -f <file>`. Expect zero ERROR + the final "ALL ... PASSED" line. Header in the file documents this + the fails-on-revert recipe.

---

## 6. T-1..T-11 live SQL results (real RPC, non-prod local stack)

Target: local Supabase stack (`supabase start`, project ref local container) — ALL 207 migrations incl. `20260929000000_orch_1120` applied cleanly; gate confirmed live in the RPC body. **NOT production** (Hard Guard honored — the migration is not on prod; the orchestrator applies it at CLOSE).

| # | Scenario | Returned JSON | Side-effect | Verdict |
|---|----------|---------------|-------------|---------|
| T-1 | Flexible→Strict + 2 sales | `{ok:false, reason:refund_policy_downgrade_with_sales, affected_order_count:2}` | policy unchanged | PASS |
| T-2 | raise 14→80 + 1 sale | `{ok:true, severity:material, changed_keys:[refund_policy]}` | raise written | PASS |
| T-3 | add 30→50 tier + 1 sale | `{ok:true, …}` | written | PASS |
| T-4 | remove 14 tier (lowers realized %) + 1 sale | `{ok:false, reason:refund_policy_downgrade_with_sales, affected_order_count:1}` | unchanged | PASS |
| T-5 | unfavorable, NO sales | `{ok:true, affected_order_count:0}` | downgrade applied | PASS |
| T-6 | deadline earlier (Aug→Jul) + 1 sale | `{ok:false, reason:booking_deadline_earlier_with_sales, affected_order_count:1}` | deadline unchanged | PASS |
| T-7 | deadline later (Jul→Aug) + 1 sale | `{ok:true, changed_keys:[booking_deadline]}` | written | PASS |
| T-8 | clear deadline (NULL) + 1 sale | `{ok:true, …}` | deadline cleared to NULL | PASS |
| T-9 | close bookings (f→t) + 1 sale | `{ok:false, reason:bookings_closed_harms_active, affected_order_count:1}` | bookings_closed unchanged | PASS |
| T-10 | reopen (t→f) + 1 sale | `{ok:true, changed_keys:[bookings_closed]}` | closed=false + bookings_closed_at=NULL | PASS |
| T-11 | bad policy (ascending days) | RAISE `tier days_before_start must be strictly descending (0 then 30)` | no write | PASS |

All 11 SPEC test cases **proven** end-to-end against the live `biz_update_live_trip` RPC. (Implementor's own `.test.sql` probe M-10..M-16 also re-run and passed, but that tests a `pg_temp` re-impl, not the RPC — noted in §4/§5.)

---

## 7. Constitution 14-rule matrix (vs the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS (source) / suspected (runtime) | Switch `onValueChange={setClosed}`, Save `onPress`; runtime tap login-gated (§9) |
| 2 | One owner per truth | PASS | published refund/deadline/closed writes route ONLY through `biz_update_live_trip` (grep gate green) |
| 3 | No silent failures | PASS | catch → `reasonError` (6 setters); `ok:false` → parent dialog; nothing swallowed |
| 4 | One query key per entity | PASS | reuses `useUpdateLiveTripFields` (existing key/invalidation); no new key |
| 5 | Server state server-side | PASS | local `useState` for edit buffer only; server truth via React Query mutation |
| 6 | Logout clears everything | N/A | no new persisted/global state |
| 7 | Label `[TRANSITIONAL]` + exit | PASS | inherited `closeAndOpenOrders` stub already labelled (report §10); not newly introduced |
| 8 | Subtract before adding | PASS | dead-end hint + 5 dead styles + `Switch` import removed; verbatim 1075 re-emit (no logic dup) |
| 9 | No fabricated data | PASS | banner hidden when count 0/undefined (graceful), never faked |
| 10 | Currency-aware | N/A | no money formatting in this surface |
| 11 | One auth instance | PASS | RPC `auth.uid()`; no new auth client |
| 12 | Validate at the right time | PASS | deadline future-bound client-side + server defensive clamp (`v_new_deadline <= v_now`); refund shape via `validate_refund_policy` + CHECK |
| 13 | Exclusion consistency | PASS | sold-count excludes `failed`/`cancelled` consistently (ADV-8 partial_refund counts, ADV-10 cancelled doesn't) |
| 14 | Persisted-state startup | N/A | synchronous prop-seed; no hydration gate |

Zero violations.

---

## 8. Device / parity matrix

| Surface | Verdict | Note |
|---------|---------|------|
| Consumer iOS | N/A | no trip authoring (SPEC §3) |
| Consumer Android | N/A | — |
| Buyer/anon Web (`/t/...`) | N/A (display-only) | refund policy displayed read-only; gate only blocks worsening edits → correctness preserved |
| Business iOS | **BLOCKED (login-gated) → suspected** | app installed on iPhone 17 Pro sim; Metro :8081 served the Expo template, business routes gated behind `useAuth().user`. Source wiring complete. Device steps in §9. |
| Business Android | **BLOCKED (login-gated) → suspected** | shared RN component → automatic parity; Samsung A72 (`R58R54YV7JT`) attached but same login gate. SC-9 Android opaque-glass proven static (`GlassChrome` 0.92 fallback) |
| Admin Web | N/A | no trip editor |
| Business Web preview | suspected | same RN component; editable; iOS translucent glass path acceptable per design §8 |

**Physical-iPhone HITL:** not driven this turn — the runtime path is login-gated and requires Seth's credentials + a published trip with paid sales (§9). Captured as a CONDITIONAL-PASS device checklist rather than a silent skip.

---

## 9. CONDITIONAL-PASS condition — device steps for Seth (closes SC-1/SC-2/SC-7/SC-8 runtime)

Run on a logged-in business app build (iOS sim or the Samsung A72), pointed at a backend where the 1120 migration is live and you have a PUBLISHED trip:

1. **Start this worktree's Metro** (so the device loads 1120 code): from `mingla-business/`, run the business dev client; foreground-close + relaunch the app on the booted device (load-latest-bundle rule).
2. **Log into the business app** and open a **PUBLISHED trip** (status live/scheduled) → **Edit** → **Settings**.
3. **No-sales path (any trip with 0 paid orders):**
   - Toggle the **"Bookings closed"** switch → confirm it FLIPS (not a dead tap) and "Save changes" ENABLES + the Settings header shows the "Edited" badge.
   - Change a refund tier % (or the booking deadline) → Save → type ≥10 chars → Save → confirm the **"Settings saved. Live now."** toast and the change persists on reload.
4. **With-sales path (a trip that HAS at least one paid/non-cancelled order):**
   - Confirm the proactive banner "{n} traveler… already booked…" renders.
   - Make a **buyer-FAVORABLE** edit (raise a refund %, push the deadline later) → Save → confirm it SAVES.
   - Make a **buyer-UNFAVORABLE** edit (lower a refund %, remove a tier, pull the deadline earlier, or flip Bookings-closed ON) → Save → confirm the **"Refund first"** dialog appears with the affected-order count, the reason banner STAYS OPEN, and your typed reason + edits are preserved (you can dial it back to favorable and retry).
5. Report whether each control FIRED + PERSISTED. If all pass, the CONDITIONAL-PASS condition is satisfied → CLOSE.

(The backend decision logic behind every one of these is already PROVEN in §5/§6 — these steps only confirm the controls fire and the wiring reaches the proven RPC.)

---

## 10. Regression — pre-existing trip-suite failures (implementor claim verified)

- **Full trip suite WITH 1120:** 27 failed / 282 passed / 309 total (19 suites).
- **Baseline (origin/main screen+service, 1120 accordion+test removed):** 27 failed / 260 passed / 287 total (18 suites).
- **Identical 27 failure count** → 1120 broke ZERO pre-existing tests and added 22 passing. Implementor's claim **verified**.
- Two failing suites touch `EditPublishedTripScreen.tsx`; I confirmed both are **stale assertions predating 1120**:
  - `EditPublishedTripScreen.refundGate.test.ts` — asserts a single-line `import { UpdateLiveTripPermissionError } from "../../services/tripsService"`; on origin/main that import is already **multi-line** (line 100, closing `}` 102), so the regex never matched on main either. Pre-existing.
  - `EditPublishedTripScreen.save.test.ts` — asserts exactly 6 sections; ORCH-0880 added `intake` (7). Pre-existing stale ORCH-0880 regression.
- `tsc --noEmit`: ZERO errors in the 4 1120 files (exhaustive `_exhaust:never` compiles → all 4 reasons handled, T-15). Strict-grep gate green (EXIT=0), registered in `strict-grep-mingla-business.yml`.

---

## 11. Discoveries for Orchestrator

1. **The 2 stale `EditPublishedTripScreen` test suites** (`refundGate`, `save`) are failing on origin/main and need an orchestrator-approved `[TEST-MOD-APPROVED ORCH-NNNN]` to fix (out of 1120 scope — append-only protected). Confirms implementor Discovery #1.
2. **Implementor's `.test.sql` tests a `pg_temp` re-implementation + a body-marker string-match, not the live RPC.** It is correct as far as it goes but is NOT a real-RPC drive — the tester's new `_tester_e2e.test.sql` (committed `9f50ede78`) provides the real-RPC end-to-end coverage. Recommend treating the tester file as the canonical 1120 SQL regression.
3. **Both 1120 invariants are ready to flip ACTIVE on CLOSE:** `I-PROPOSED-1120-PUBLISHED-REFUND-DEADLINE-VIA-GATED-RPC` (proven via grep gate) and `I-PROPOSED-1120-UNFAVORABLE-EDIT-HARD-BLOCKS-WITH-SALES` (proven via the live-RPC drive).
4. **Migration apply at CLOSE:** version `20260929000000` confirmed strictly greater than every in-flight version; re-emission from 1075 is correct (no 1118 `biz_update_live_trip` rewrite has merged). Apply via `supabase db push --linked` (or Management API per the drift-wedged-CLI hazard) — orchestrator's CLOSE step, not done here.

---

## 12. Accepted conditions (CONDITIONAL PASS)

- **P2-1 (UI runtime / dead-tap proof, login-gated)** — must be closed by Seth running the §9 device checklist before CLOSE. The backend logic it gates is already PROVEN (§5/§6), so risk is LOW; this is a wiring-fires confirmation, not a logic re-test.

No P0/P1. P3-1, P3-2 are documented design-accepted (SPEC Q-1/Q-2 defaults) and need no action.
