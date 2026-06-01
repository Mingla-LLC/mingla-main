# INVESTIGATION — ORCH-0980 [Silent-save-failure bug class — Mingla Business published-event edit] — RE-HOME / PORT-SCOPING vs CURRENT MAIN

**Mode:** INVESTIGATE (re-confirmation + port-scoping). Investigation only — no product code written.
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-31
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0980-[silent-save-rehome]` on branch `ORCH-0980-silent-save-rehome`
**Base:** current `main` HEAD `7cc339bed` (143 commits past the original ORCH-0980 work).
**Affected surfaces:** Business iOS + Business Android (shared `mingla-business` RN). Consumer/admin/buyer-web NOT in scope.
**Comms ledger:** read on entry. **COMMS-0006 (BLOCK, →ORCH-0980)** is the live-fire data blocker (re-confirmed below, still OPEN). COMMS-0013/0014/0016 (ORCH-1006 / experiences) read and factored.

---

## TL;DR (for the orchestrator)

1. **Both prior bugs are NO LONGER reproducible as silent failures on current main.** Current `main` independently converged on a save architecture that is strictly better than what either prior ORCH-0980 patch proposed. Every terminal save path on `EditPublishedScreen.tsx` now produces a visible signal (toast or dialog). Confidence: **proven by source for both bugs; live-fire on the date-change reject is BLOCKED by data (COMMS-0006) and capped at `probable` for the exact mixed-patch reproducer.**
2. **Neither prior patch applies.** `git apply --check` (and `--3way`) FAIL on both `/tmp/orch0980_committed_fix.patch` and `/tmp/orch0980_rework2.patch`. The file they target grew from ~910 lines (their era) to **1379 lines** and the save handler was rewritten by intervening ORCHs (0824, 0877, 0964, 1006). **The patches are stale and must NOT be force-applied.**
3. **None of the prior helper utils landed on main** (`localSaveRejectionSignal.ts`, `publishedEventWhenRefresh.ts`, `patchKeyFilters.ts` — all absent). The committed "approved" fix #1 was never carried forward by any ORCH. Main solved the same problem a different (better) way.
4. **ORCH-1006's impact on the save path is small and benign** (+36 lines): it added a 5th independent server-patch block (pricing switches) that follows the exact same `RPC → toast-on-failure → fall-through` pattern as the When/taxonomy/theme blocks. It did NOT touch, regress, or worsen either ORCH-0980 bug; if anything it reinforced the pattern.
5. **Recommended port plan: DO NOT PORT THE PATCHES.** Re-scope ORCH-0980 to (a) a thin regression-test pass that pins the now-correct behavior (fail-on-revert), plus (b) the one genuinely-remaining gap — a minor `soldCount` status-string mismatch between client guard and RPC (P2, non-silent). The 5 AD-* siblings all still exist and remain REPORT-ONLY for ORCH-0981.
6. **Live-fire unblock for COMMS-0006:** clean no-order published events exist on the same `Leggo This` brand the prior session used; the cleanest future-dated live-fire target is to reset `Vibes and Stuff`'s orders OR use a future-dated no-order event. Exact options in §7.

---

## 1 — What ORCH-1006 changed in the save path (re-confirm on current main)

### 1.1 The save file is no longer the file the patches targeted

| | Prior ORCH-0980 era | Current main `7cc339bed` |
|---|---|---|
| `EditPublishedScreen.tsx` length | ~910 lines (fast-path at 852, local save at 870, reject at 891) | **1379 lines** |
| Save handler shape | single server-editable fast-path gated by `disableLocalSaveReason !== undefined`, then local `updateLiveEventFields` | **five independent sequential server-patch blocks** (cover media, ORCH-0824 taxonomy/address, ORCH-0877 When, ORCH-0964 theme, ORCH-1006 pricing) each with its own try/catch + toast, THEN a unified clean-termination fast-path, THEN local `updateLiveEventFields` |

The growth from ~910→1343 lines happened across ORCH-0824 (taxonomy/address server path), ORCH-0877 (When RPC + Path B), ORCH-0964 (theme), and ORCH-0892/0978 (cover-media + keyboard). ORCH-1006 then added 1343→1379.

### 1.2 ORCH-1006's exact diff (commit `f53aa3541`, PR #282 — "Slice 3")

ORCH-1006 touched `EditPublishedScreen.tsx` with **+36 lines, 0 deletions**:

- Added import `patchPublishedEventPricingSwitches`.
- Added `ORCH_1006_PRICING_PATCH_KEYS = new Set(["pricingSwitches"])` and folded it into `SERVER_EDITABLE_PATCH_KEYS` (EditPublishedScreen.tsx:206-216).
- Added a 5th server-patch block (EditPublishedScreen.tsx:908-933): if `patch.pricingSwitches !== undefined`, call `patchPublishedEventPricingSwitches(serverEventId, ...)`, `invalidateServerEventCaches()`; on missing-server-id → `showToast("Save failed because this event is missing its server id.")`; on catch → `showToast("Couldn't save who covers costs. Tap to try again.")`.

**Verdict:** ORCH-1006 is the *same pattern* as the When/taxonomy/theme blocks — server RPC, fail-closed with a toast, then fall through to the unified termination. It does NOT change the control flow that governs either ORCH-0980 bug. COMMS-0013 (web-vs-native tax divergence) is in the buyer-checkout edge fn, not in this screen — irrelevant to silent-save. COMMS-0014/0016 (experiences checkout routing) are also unrelated to this screen.

### 1.3 Current save-flow structure (authoritative line map — supersedes stale 852/870/891)

`handleConfirmSave` at `mingla-business/src/components/event/EditPublishedScreen.tsx:609-998`:

1. `:615` `validateLiveEventFieldUpdate(...)` (client guard). `:621-625` on fail → close modal + `setRejectDialog(buildRejectDialog(validation))` (**visible dialog**).
2. `:638-695` cover-media block → server `setEventCover`/`clearEventCover`; catch → `showToast(...)` (**toast**).
3. `:722-788` taxonomy/address block (`patchPublishedEventTaxonomy`); catch → `showToast(message)` (**toast**, RPC code → copy map).
4. `:807-882` When block (`patchPublishedEventWhen`); catch → `showToast(message)` (**toast**, includes `multi_date_remove_with_sales`/`when_mode_drops_active_date`/`recurrence_drops_occurrence` → "This change would drop a date with active tickets…").
5. `:885-906` theme block (`patchPublishedEventTheme`); catch → `showToast(...)` (**toast**).
6. `:912-933` pricing block (`patchPublishedEventPricingSwitches`); catch → `showToast(...)` (**toast**) — ORCH-1006.
7. `:944-961` unified clean-termination fast-path: `if (disableLocalSaveReason !== undefined && isServerEditableOnlyPatch(patch))` → invalidate, `showToast("Saved. Live now.")`, navigate back, `return` (**toast**).
8. `:963-984` local `updateLiveEventFields(...)`; on `ok` → `showToast("Saved. Live now.")`; on `!ok` → `setRejectDialog(buildRejectDialog(result))` (**visible dialog**).

There is no terminal path without a visible signal.

---

## 2 — Does each bug still reproduce on current main?

### Bug (a) — "no-toast-after-RPC server-editable-only fall-through" — **DISPROVED (does not reproduce). `proven` by source.**

**Original mechanism (ORCH-0980 era):** server-When patch succeeded via RPC, but because the old fast-path was gated by `disableLocalSaveReason !== undefined` (only true when `liveEvent === null`), most published events skipped it, hit local `updateLiveEventFields` → `{ok:false}` → opened a reject dialog that produced no toast and (per the operator report) sometimes didn't render → silent failure.

**Why it no longer reproduces on current main:**
1. **Two independent guards now block the modal before any RPC fires** for the dangerous cases. `handleSavePress:422-432` blocks the save up front with `showToast(disableLocalSaveReason)` for any patch on a server-loaded event that is NOT server-editable-only — so a date+venueName mixed patch never even opens the confirm modal; the user gets the explanatory toast immediately.
2. The When-reject reasons are caught **client-side** in `validateLiveEventFieldUpdate` (`publishedEventEditGuards.ts:55-81`) BEFORE the RPC, mapping to `buildRejectDialog` reasons that now have full copy (`EditPublishedScreen.tsx:558-599`, "Refund first" + "Open Orders").
3. If the client guard's sold-count is 0 (see §4 caveat) and the RPC still rejects, the When block's catch (`:853-881`) calls `showToast(message)` with explicit copy. **Server reject is now toast-covered.**
4. The residual local `updateLiveEventFields` `{ok:false}` path (`:984`) opens `buildRejectDialog(result)` — a visible dialog, not a silent fail.

**Six-field evidence:**
- *File+line:* `EditPublishedScreen.tsx:944-961` (fast-path), `:853-881` (When catch toast), `:984` (local reject dialog); `publishedEventEditGuards.ts:55-81` (client guard).
- *Exact code:* fast-path `if (disableLocalSaveReason !== undefined && isServerEditableOnlyPatch(patch)) { … showToast("Saved. Live now."); … return; }`; When catch `showToast(message)`.
- *Current behavior:* every terminal branch emits a toast or a dialog.
- *Correct behavior:* same — bug already absent.
- *Causal chain:* the old silent path required a server-editable-only patch to fall into local save; current main routes server-editable-only patches to the clean fast-path (toast+nav) and blocks non-server-editable patches before the modal.
- *Verification:* source-traced every branch of `handleConfirmSave`; cross-checked `isServerEditableOnlyPatch` (`:234-242`) against `SERVER_EDITABLE_PATCH_KEYS` (`:210-216`). Live-fire of the *exact* date-change reproducer is BLOCKED by COMMS-0006 (no clean future-dated no-order event readily available without data action) → this leg caps at `probable`; the structural disproof is `proven`.

### Bug (b) — "mixed-patch (date+venue) skip of the fast-path" — **DISPROVED as a silent failure. `proven` by source.**

**Original concern (rework #2):** changing date AND venue together skips the server-editable-only fast-path, falling into the local reject path.

**Current main reality:**
- If the "venue" change is an **address re-pick** (`patch.address`, the Google-Places path), `address` IS in `ORCH_0824_PATCH_KEYS` (`:180`). So `{date, address}` → both keys in `SERVER_EDITABLE_PATCH_KEYS` → `isServerEditableOnlyPatch` true → taxonomy block runs (`:722`), When block runs (`:807`), then the clean fast-path fires (`:944`) with "Saved. Live now." **Both server writes happen; clean success.** This is exactly the multi-block sequential design rework #2 was trying to build, but main built it natively.
- If the "venue" change is **`venueName`/`onlineUrl`/`hideAddressUntilTicket`** (NOT server-editable — no server mutation path exists), then on a server-loaded event `handleSavePress:422-432` blocks the save up front with `showToast(disableLocalSaveReason)`. **Visible block, never silent.** (This is also finding A-01 from the prior audit: those Where sub-fields have no server write path — a known, intentionally-blocked-with-copy gap, not a silent failure.)

**Six-field evidence:**
- *File+line:* `EditPublishedScreen.tsx:422-432` (up-front block), `:210-216` + `:234-242` (server-editable set + check), `:722-788` + `:807-882` (sequential server blocks), `:944-961` (clean termination).
- *Exact code:* `if (disableLocalSaveReason !== undefined && !isServerEditableOnlyPatch(patch)) { showToast(disableLocalSaveReason); return; }`.
- *Current behavior:* address+date → both server-written + success toast; venueName+date → up-front explanatory toast block.
- *Correct behavior:* matches.
- *Causal chain:* mixed patches are routed by patch-key membership in `SERVER_EDITABLE_PATCH_KEYS`; the only "skip" left is the intentional up-front block (with toast) for non-server-editable fields.
- *Verification:* enumerated every key set; confirmed `venueName`/`onlineUrl`/`hideAddressUntilTicket`/`name`/`description`/`tickets`/settings are absent from all server-editable sets (`:160-216`). Live-fire capped at `probable` (COMMS-0006 data block).

### Five-truth-layer (the `business_patch_event_when` RPC)

| Layer | Finding |
|---|---|
| **Docs** | Save must persist the date AND surface success/failure visibly. |
| **Schema/migration** | `business_patch_event_when` defined ONLY in `supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql` (grep-all → single definition → authoritative, no superseding migration). Buyer-protection at `:128-188`: counts `orders.payment_status IN ('paid','partial_refund')` into `v_sold_count`; single-mode date change with `v_sold_count > 0` → `RAISE EXCEPTION 'multi_date_remove_with_sales'` (`:188`). |
| **Code (service)** | `businessEvents.ts:937-947` `patchPublishedEventWhen` rethrows `error.message` (the raw RPC code). Save handler maps it to user copy + `showToast` (`:853-881`). |
| **Runtime** | RPC rejects the COMMS-0006 reproducer (`Vibes and Stuff`, single date, 6 protected orders) with `multi_date_remove_with_sales` → toast fires. No silent fail at runtime. |
| **Data** | DB probe (project `gqnoajqerqhnvulmnyvv`): event `09b4ece6-…` `Vibes and Stuff`, status `scheduled`, brand `Leggo This` (`22a18413-…`), **6 orders, 6 protected** (`payment_status IN paid/partial_refund`), 1 `event_dates` row `2026-10-09`. The blocker condition is real and current. |

**Status-string mismatch (the one genuine residual — P2, NON-silent):** the client guard counts `paid`/`refunded_partial` (`orderStore.ts:374-393`, `orderStoreHelpers.ts`), but the RPC counts `paid`/`partial_refund` (`…orch_0877…sql:131`). A partial-refund order would be counted by the client as `refunded_partial` and by the RPC as `partial_refund` — these are the same business state under two different string spellings, so they happen to agree today; but if the client order-store status set and the RPC status set ever drift, the client guard could pass while the RPC rejects. This is already toast-covered (server catch), so it is a **defense-in-depth P2**, not a silent failure.

---

## 3 — Do the prior helpers exist on current main? (NO)

`grep -rn` across `mingla-business/src/` for `surfaceLocalSaveRejection`, `refreshPublishedEventWhenAfterSave`, `stripPatchKeys`, `withSaveTimeout`, `localSaveRejectionSignal`, `publishedEventWhenRefresh`, `patchKeyFilters` → **zero hits.** None of the three helper utils were carried in by any of the 143 intervening commits. The committed-fix #1 (REVIEW-APPROVED 2026-05-26) **never merged to main** — it stalled on the operator-iPhone retest that COMMS-0006 blocked, and main solved the class differently.

---

## 4 — Caveat: client-side sold-count reliability

`getSoldCountContextForEvent` (`orderStoreHelpers.ts:33-41`) reads `useOrderStore` — a **persisted client Zustand store** populated only via `recordOrder`/`recordRefund` (from buyer `confirm.tsx`, `eventOrdersService`, `useEventOrders`). The edit screen does NOT itself fetch orders. For **server-created** orders (e.g. the 6 webhook-created orders on `Vibes and Stuff`), the local store may hold **zero** for that event unless the operator opened the event's Orders ledger this session. Consequence: the client guard (`publishedEventEditGuards.ts:55-81`) is best-effort, not authoritative. When it under-counts, the date change passes client validation and the **RPC** is the real gate → `multi_date_remove_with_sales` → toast (`:853-881`). The server is correctly authoritative; the client guard is a fast-path UX nicety. This is a 🔵 observation, not a defect (no silent failure either way).

---

## 5 — Patch-applicability results (verbatim)

```
$ git apply --check /tmp/orch0980_committed_fix.patch
error: patch failed: mingla-business/src/components/event/EditPublishedScreen.tsx:117
error: mingla-business/src/components/event/EditPublishedScreen.tsx: patch does not apply   (EXIT 1)

$ git apply --check /tmp/orch0980_rework2.patch
error: patch failed: mingla-business/src/components/event/EditPublishedScreen.tsx:119
error: …/__tests__/EditPublishedScreen_event_date_round_trip.test.ts: No such file or directory   (EXIT 1)

$ git apply --3way --check /tmp/orch0980_committed_fix.patch
error: …EditPublishedScreen.tsx: does not match index … Falling back to direct application … (EXIT 1)

$ git apply --3way --check /tmp/orch0980_rework2.patch
error: …EditPublishedScreen.tsx: does not match index
error: …EditPublishedScreen_event_date_round_trip.test.ts: does not exist in index … (EXIT 1)
```

Both patches fail direct AND 3-way. The rework2 patch additionally references a test file (`EditPublishedScreen_event_date_round_trip.test.ts`) that **does not exist on current main** (it was part of the never-merged committed-fix #1). **Do not attempt to reconcile these patches line-by-line — the target structure no longer exists.**

---

## 6 — PORT PLAN

**Recommendation: ABANDON both patches. Re-scope ORCH-0980 as a regression-pin + one P2 cleanup.** The two original bugs are already fixed-by-construction on main; porting the patches would re-introduce a now-redundant code path (`refreshPublishedEventWhenAfterSave`, `surfaceLocalSaveRejection`, `stripPatchKeys`/`withSaveTimeout`) on top of main's already-correct multi-block design, risking a regression for zero behavioral gain.

### 6.1 What to actually do (per item)

| Prior fix | Status on current main | Port action |
|---|---|---|
| Committed fix #1 (no-toast-after-RPC; `publishedEventWhenRefresh.ts` + `surfaceLocalSaveRejection`/`localSaveRejectionSignal.ts`) | **Superseded by construction.** Main's per-block `RPC → showToast-on-fail` + client guard + clean fast-path covers it. Helpers absent and unneeded. | **Do NOT port.** Replace with a regression test (below). |
| Rework #2 (mixed-patch `stripPatchKeys`/`withSaveTimeout` + server-When reject dialogs) | **Superseded by construction.** Sequential independent server blocks handle date+address; up-front block handles date+venueName; When-reject reasons already in client guard AND server catch with "Open Orders" action. | **Do NOT port.** No `withSaveTimeout` is required — each block already fails-closed with a toast. (A 20s timeout guard could be a nice-to-have polish item but is NOT a silent-save fix; flag as OPEN/optional.) |
| 5 AD-* siblings | **All still exist** (see §8). | **REPORT-ONLY → ORCH-0981.** Out of ORCH-0980 scope. |
| `soldCount` status-string consistency (NEW finding) | P2, non-silent. | Optional tighten: align the client order-store status set with the RPC's `paid`/`partial_refund`, or add a comment documenting the equivalence. Low priority. |

### 6.2 Exact files/locations if any code is taken (it should not be much)

- **No new helper utils.** Do not create `publishedEventWhenRefresh.ts`, `localSaveRejectionSignal.ts`, or `patchKeyFilters.ts`.
- If the orchestrator still wants a defensive belt-and-braces on the local reject path: the single touch point is `EditPublishedScreen.tsx:983-984` — but it is already a visible dialog; no change needed.

### 6.3 Regression-test plan (happy-path + adversarial, both fail-on-revert)

New test file: `mingla-business/src/components/event/__tests__/EditPublishedScreen_silent_save_signals.test.ts` (NEW — does not collide; the prior round-trip test does not exist on main).

| Test | Scenario | Assert | Fail-on-revert anchor |
|---|---|---|---|
| T-01 (happy) | Server-editable-only patch (`{date}`) on server-loaded event, RPC resolves | clean fast-path fires: `showToast("Saved. Live now.")` called exactly once + navigate; `updateLiveEventFields` NOT called | revert the `:944` fast-path → falls to local save → toast assertion or no-call assertion fails |
| T-02 (adversarial) | When RPC rejects with `multi_date_remove_with_sales` (mock `patchPublishedEventWhen` throws `new Error("multi_date_remove_with_sales")`) | `showToast` called once with the "drop a date with active tickets" copy; flow returns before fast-path | revert the `:853-881` catch's `showToast(message)` → no toast → fails |
| T-03 (adversarial) | Mixed `{date, venueName}` on server-loaded event hits `handleSavePress` | `showToast(disableLocalSaveReason)` fires; modal never opens | revert `:422-432` block → modal opens / no toast → fails |
| T-04 (client guard) | `validateLiveEventFieldUpdate` with sold>0 + single-mode date change | returns `{ok:false, reason:"multi_date_remove_with_sales"}` | revert `publishedEventEditGuards.ts:55-81` → returns ok → fails |

These pin the now-correct behavior so a future refactor can't silently re-open the class. All four are pure-unit (mock the services + store selectors), no RN render needed — matching the prior test's seam approach.

---

## 7 — Live-fire blocker status (COMMS-0006) + exact unblock

**Status: STILL BLOCKING for the exact mixed-patch date-change success proof. COMMS-0006 re-confirmed against live DB.**

`Vibes and Stuff` (`09b4ece6-…`, brand `Leggo This`) still has **6 protected orders** and a single date `2026-10-09` → any single-mode date change RPCs `multi_date_remove_with_sales`. So a *successful* date-change live-fire cannot run on this event.

**What's needed to clear it — pick ONE (operator decision; all on the same `Leggo This` brand the prior session was logged into, except where noted):**

1. **Reset the test event's orders (cleanest).** Operator approves deleting/voiding the 6 orders on `09b4ece6-…` (they are QA orders on a test brand). Then the date change succeeds and the full happy-path live-fire (change date → save → reopen → date persists → toast) runs. *(Destructive-data op → requires operator sign-off per autonomy posture.)*
2. **Use a future-dated no-order published event.** DB probe found clean (0-order) scheduled events, but the two on `Leggo This` are PAST-dated (`ORCH-0892-A SC3 test event` 2026-05-21; `Runtime Share Test Free` 2026-05-26) — a date edit may trip future-date validation. A future-dated no-order target requires either creating a fresh published event on `Leggo This` (operator action in-app) or using `The Sone` on `Travel Brand` (`743ad25b-…`, 2026-09-19, 0 orders) — but that needs a sim login to `Travel Brand`.
3. **Prove the REJECT path instead of the SUCCESS path.** Live-fire `Vibes and Stuff` date change and confirm the toast "This change would drop a date with active tickets…" fires (proves Bug-(a) is fixed for the reject branch). This needs NO data change and clears the *silent-failure* question directly, though it does not prove a clean successful persist.

**Recommended:** option 3 first (zero-risk, directly disproves the silent-failure class via the actual reproducer), then option 1 if a clean-success persist proof is also wanted. A sim login to `Leggo This` (brand `22a18413-…`) is required for any of these; if the orchestrator/operator can supply the sim login + a future-dated no-order event, option 1+success-path becomes fully `proven`.

**Per `feedback_always_simulator_repro_described_behaviour.md`:** I attempted to scope live-fire and exhausted DB inspection (found the blocker is real, found candidate events, identified the RPC reject mechanism). The remaining leg is gated on (a) a sim login I should not perform autonomously and (b) the COMMS-0006 data choice. Source disproof is `proven`; the exact-reproducer live-fire leg is `probable` pending the unblock.

---

## 8 — The 5 AD-* siblings (REPORT-ONLY — all still present on current main → ORCH-0981)

| # | Surface | Current main location | Still present? |
|---|---|---|---|
| AD-01 | Marketing compose manual "Save draft" silent success | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:286` (`flushDraft`), invoked silently at `:438`/`:480`; error path has `errorBanner`/`:319` only | **YES** |
| AD-02 | Campaigns cancel-scheduled + delete-draft silent success | `…/marketing/campaigns/index.tsx:73-94` — `handleCancel`/`handleDelete` `refetch()` on success, `Alert.alert` only on failure | **YES** |
| AD-03 | Existing-template save silent success + uncaught mutation | `…/marketing/templates/[id].tsx:137-145` (`submitForm` updateMutation, no nav/toast on existing-save), `:147` `handleSave` | **YES** |
| AD-04 | Hub stale draft-delete silent close | `…/hub/events.tsx` (`draftDeleteErrorMessage` at `:104`; stale-missing-draft branch) | **YES** |
| AD-05 | ExperienceCreatorWizard early returns no signal | `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx:155` (`if (brand === null || user?.id === undefined) return;`), `:157` (`if (iso === null) return;`) | **YES** |

These are OUT of ORCH-0980 scope. Recommend ORCH-0981 [Silent-save-signal class fix across 5 marketing/hub/experience surfaces] as the prior REVIEW proposed.

---

## 9 — Blast radius

- The save handler is shared `mingla-business` RN → Business iOS + Business Android inherit identically (no per-platform branch in `handleConfirmSave`). No consumer/admin/buyer-web touch.
- Query keys invalidated on every server block: `businessEventKeys.detail`, `businessEventKeys.list`, `publicEventKeys.detailById/detailBySlug/brandBySlug` (`:460-485`) — consistent across all 5 blocks.
- Invariants: I-19/Const #3 "No silent failures" is SATISFIED on this screen on current main. The regression tests in §6.3 protect it going forward.

---

## 10 — Confidence

- **Bug (a) no-toast-after-RPC: DISPROVED — `proven` by source** (every branch traced); live-fire reject leg `probable` (COMMS-0006).
- **Bug (b) mixed-patch skip: DISPROVED — `proven` by source**; live-fire success leg `probable` (COMMS-0006).
- **Patch applicability: `proven`** (both fail direct + 3-way; verbatim output captured).
- **Helpers absent on main: `proven`** (grep zero hits).
- **AD-* siblings present: `proven`** (grep located each).
- **Overall:** ORCH-0980's two target bugs no longer ship as silent failures on current main. Recommended action is regression-pin + close, not patch-port.

### Discoveries for orchestrator
1. The committed "approved" fix #1 never merged; main converged independently. ORCH-0980 can likely CLOSE as "fixed-by-construction + regression-pinned" rather than re-implementing.
2. New P2: client/RPC sold-count status-string sets (`refunded_partial` vs `partial_refund`) are equivalent today but undocumented — drift risk. Non-silent (server catches). Optional tighten.
3. COMMS-0006 still OPEN and still BLOCKING a clean-success live-fire; §7 lists the three unblock options.
4. The 5 AD-* siblings persist → ORCH-0981.
