# ORCH-1212 [today-curated-hours] — BUILD CONTRACT (SPEC)

**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-06-22
**Status:** READY FOR IMPLEMENT
**Branch / worktree:** `ORCH-1212-today-curated-hours` @ `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1212-[today-curated-hours]`
**Mode:** server-side only (Supabase edge fns). No client/native change → no consumer OTA.

---

## 0. PROBLEM (runtime-proven, do not re-investigate)

The consumer deck's AI-curated **"Today"** filter uses a point-in-time **instant arrival-cascade**: every non-optional stop must be open *starting from the current wall-clock minute*, walking forward by per-stop duration + travel. At off-hours (proven live 4:15 AM Raleigh: 6 of 5,995 places open right-now vs 4,039 open at some point that day) every multi-stop curated itinerary collapses → `emptyReason: 'all_closed_at_time'` → deck shows only brand experiences.

`'this_weekend'` and `'pick_dates'→today` use the permissive `anyHourOnDays` policy and survive. Single real-venue cards on `'today'` already use a permissive "open from now through end of day" filter — `discover-cards/index.ts` `isOpenFromHourOnwards` (`supabase/functions/discover-cards/index.ts:688-694`), applied in the `today` branch at `:746-757` (`isOpenFromHourOnwards(place, targetDay, currentHour)`).

**The curated `today` policy must stop collapsing overnight while the pool has venues open later today.**

---

## 1. DECIDED POLICY VARIANT FOR `'today'` — **FROM-NOW-ONWARD (recommended, chosen)**

`'today'` becomes: **a curated itinerary QUALIFIES if it can be completed starting at some hour from `floor(currentLocalHour)` through end of the local day, with every non-optional stop open at its computed arrival time on that schedule.** This mirrors the single-venue `isOpenFromHourOnwards` intent (open from now through end of today) extended to the multi-stop arrival cascade.

### Why FROM-NOW-ONWARD and not full `anyHourOnDays`-for-today

| | FROM-NOW-ONWARD (CHOSEN) | anyHourOnDays-for-today (rejected) |
|---|---|---|
| Respects "rest of today" intent | YES — a place that already closed this morning (e.g. brunch spot 8–11, now 14:00) does not falsely qualify | NO — would qualify a venue only open earlier today |
| Mirrors single-venue `today` (`isOpenFromHourOnwards`) | YES — exact parity, "from now through end of day" | NO — single-venue `today` deliberately does NOT use `isOpenAnyTimeOnDay`; that's reserved for weekend/pick_dates |
| Fixes the 4 AM collapse | YES — at 04:00, a 9–17 venue is open "from floor(4) onward today" | YES |
| Surprise for the user | Low — everything offered is doable later today | Higher — could offer a plan whose only stop already closed |

FROM-NOW-ONWARD is strictly the better contract: it both fixes the overnight collapse AND preserves the from-now bias that single cards already enforce. It is the minimal, parity-preserving change. **CHOSEN.**

### Semantics that replace the instant cascade for `today`

The existing instant cascade anchors arrival of stop 0 to `currentHour` and walks forward. Under FROM-NOW-ONWARD we keep the SAME forward arrival cascade but probe a set of candidate START hours from `floor(currentLocalHour)` to `23`, and the itinerary QUALIFIES if **ANY** integer start hour `s ∈ [floor(currentLocalHour), 23]` yields a schedule where every non-optional stop is open at its arrival time on the local day. (Stop 0 arrives at `s`; each subsequent stop arrives at `prevArrival + prevDuration + travel`.)

- This is the multi-stop generalization of `isOpenFromHourOnwards`'s `for (h = floor(start); h < 24; h++)` loop (`discover-cards/index.ts:690`).
- Day stays the single local "today" weekday (no spill into tomorrow — see §3 multi-day).
- Honest-unknown (`{}`/no data) stops still read OPEN at every probe → never block qualification (Constitution #9, LOCKED).
- ALWAYS_OPEN_TYPES still short-circuit OPEN.

> **Behavioral net effect:** at 04:00 local, a single-stop curated card whose restaurant is open 9–17 now qualifies (probe `s=9` succeeds). At 18:00 local the same card still qualifies (probe never finds an open hour ≥18 → DROPPED), exactly as `isOpenFromHourOnwards` would drop a single venue whose hours ended at 17:00. A genuinely all-day-closed pool still yields empty.

---

## 2. EXACT POLICY MAPPING AFTER THE CHANGE

| `date_option` (normalized: lowercase, `-`/space→`_`) | Policy mode AFTER fix | Clock / day basis | Per-stop predicate |
|---|---|---|---|
| `today` / `now` / `''` / `undefined` | **`instantFromNowOnward`** (NEW) | LIVE clock `now` (never stale `datetime_pref`); place-local day from `utcOffsetMinutes` | itinerary passes if ∃ start hour `s ∈ [floor(localNowHour), 23]` s.t. the forward arrival cascade has every non-optional stop open on the local day |
| `this_weekend` / `weekend` | `anyHourOnDays` (UNCHANGED) | days `[6,0]` (Sat, Sun) | each non-optional stop open at ANY hour on Sat OR Sun |
| `pick_dates` / `custom` | `anyHourOnDays` (UNCHANGED) | each selected date's weekday (noon-UTC derivation), fallback `[datetimePref]`→`[now]` | each non-optional stop open at ANY hour on any selected weekday |
| anything else (unknown) | **`instantFromNowOnward`** (NEW default) | LIVE clock `now` | same as `today` (never trust stale pref) |

**Only the `today`/`now`/`''`/`undefined`/unknown rows change.** `this_weekend` and `pick_dates` are byte-identical to today's behavior.

---

## 3. FILES + FUNCTIONS TO CHANGE — BEFORE/AFTER CONTRACT

### 3.1 `supabase/functions/_shared/curatedStopHours.ts` (THE ONLY production code change)

**A. `CuratedHoursPolicy` type (`:271-273`)** — add the new mode.

- BEFORE: `{ mode:'instant'; utcNow:Date } | { mode:'anyHourOnDays'; days:number[] }`
- AFTER: add a third member `| { mode:'instantFromNowOnward'; utcNow:Date }`.
- The legacy bare-`Date` back-compat in `filterCuratedByStopHours` (`:338-340`) **stays mapped to `{mode:'instant', ...}`** — do NOT change it (T-2-01, T-12, and the adversarial T-2-04 fails-on-revert all pass a bare Date and rely on the exact-arrival instant cascade). The bare-Date path is a distinct internal contract from the `today` user-facing path.

**B. `resolveCuratedHoursPolicy` (`:275-313`)** — the `today` branch returns the new mode.

- BEFORE (`:285-287`):
  ```
  if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
    return { mode: 'instant', utcNow: now };
  }
  ```
- AFTER: same condition, return `{ mode: 'instantFromNowOnward', utcNow: now }`.
- The final unknown-fallback (`:311-312`) ALSO changes `'instant'` → `'instantFromNowOnward'` (an unknown user-supplied option should be as permissive as `today`, never the harsh exact-arrival instant).
- `this_weekend` (`:289-291`) and `pick_dates` (`:293-309`) branches: **NO CHANGE.**
- Keep the live-clock derivation (`const now = opts.now ?? new Date()`) and the normalization at `:283` exactly as-is. Do NOT reintroduce any `datetime_pref` parse into the `today` clock (preserves I-CURATED-DATE-OPTION-HONORS-LIVE-CLOCK / ROOT-CAUSE-v4).

**C. `filterCuratedByStopHours` (`:334-382`)** — implement the `instantFromNowOnward` branch.

- BEFORE: two branches — `anyHourOnDays` (`:342-355`) and the fall-through `instant` exact-arrival cascade (`:357-381`).
- AFTER: keep both unchanged, ADD a branch for `instantFromNowOnward` BEFORE the `instant` fall-through. Contract of the new branch:
  1. `if (card.cardType !== 'curated' || !card.stops?.length) return true;` (same passthrough as the other modes).
  2. Compute the place-local `now` exactly as the instant branch (`:362-366`): `offsetMin = card.utcOffsetMinutes ?? (card.lng != null ? Math.round(card.lng/15)*60 : 0)`; `localDate = new Date(utcNow.getTime() + offsetMin*60000)`; `localDay = localDate.getUTCDay()`; `nowHour = localDate.getUTCHours() + localDate.getUTCMinutes()/60`. **PRESERVE place-local derivation — no UTC-vs-local drift (constitution rule 12).**
  3. The card QUALIFIES (`return true`) iff **∃ integer start hour `s` with `floor(nowHour) ≤ s ≤ 23`** such that the forward arrival cascade succeeds for ALL non-optional stops on `localDay`:
     - arrival of stop 0 = `s`;
     - for each non-optional stop `i`, require `isStopOpenAtHour(stop_i, arrival_i, localDay)`;
     - advance `arrival_{i+1} = arrival_i + (CURATED_STOP_DURATION[stop_i.placeType] || 45)/60 + travelToNext/60`, where `travelToNext = (i < lastIndex) ? (stops[i+1].travelTimeFromPreviousStopMin || 15) : 0` — **identical duration/travel math to the existing instant cascade (`:374-378`)**; optional stops are skipped for the open-check but still consume their duration+travel in the cascade exactly as the instant branch already does (loop over ALL stops, `if (stop.optional) continue;` for the open-check, but the advance happens for every stop — match the existing instant loop structure precisely).
     - If the cascade for start `s` reaches the end with no closed non-optional stop → that `s` works → card qualifies, break.
  4. If no `s` in `[floor(nowHour), 23]` works → `return false` (DROP).
  - **Idempotence:** re-filtering an already-passing card is a no-op (a passing card still has a working `s`). The fail set is monotone — preserves the collab double-filter no-op contract (T-11).
  - **Implementation note (non-binding, the contract above is binding):** the simplest correct loop is an outer `for (let s = Math.floor(nowHour); s < 24; s++)` that runs the inner arrival cascade (a helper or inlined) and returns `true` on the first `s` whose cascade has zero closed non-optional stops; falls through to `false`. The inner cascade is the existing `:368-379` loop with `currentHour` initialized to `s` instead of the live `nowHour`.

- Update the doc-comment block (`:315-333`) to document the third mode and the from-now-onward semantics; reference ORCH-1212 and the `isOpenFromHourOnwards` parity. Keep ORCH-1061 / ORCH-1113 history lines.

### 3.2 Call sites — NO LOGIC CHANGE (they inherit the fix)

Both curated paths already compute the policy through `resolveCuratedHoursPolicy` and apply `filterCuratedByStopHours`, so the fix propagates automatically. Verify (do NOT edit logic):

- `supabase/functions/generate-curated-experiences/index.ts:1765` — `resolveCuratedHoursPolicy({ dateOption, datetimePref, selectedDates })` then `:1770` filter. The empty-reason emission at `:1773-1777` (`'all_closed_at_time'` when `builtCount>0` but post-filter empty) **stays as-is** — it is still the honest verdict when even the permissive from-now-onward policy empties the deck (genuinely all closed for the rest of today).
- `supabase/functions/discover-cards/index.ts:1652-1657` (collab aggregate path, hardcoded `dateOption:'today'`) and `:2499-2500` (deterministic handler path). Both pick up `instantFromNowOnward` for `today`. **This is correct and in-scope** — it makes collab `today` curated cards as permissive as solo, with zero new aggregation field. It does NOT touch D2 (the no-real-venue-fetch rule for curated-only decks).

> **D2 (Seth: leave as-is) is untouched:** nothing in this change makes a curated-only deck fetch real venues. The change is purely the hours predicate.

---

## 4. EDGE CASES — INTENDED BEHAVIOR

1. **First stop opens later today** (e.g. now 04:00, stop 0 opens 09:00): QUALIFIES — probe `s=9` (or earliest open hour) succeeds. This is the core fix.
2. **Last stop closes before you'd arrive given travel time:** the cascade for a given `s` FAILS at that stop (arrival > close). But a LATER or EARLIER `s` may still work if the whole chain fits in an open window. If NO `s ∈ [floor(now),23]` makes every stop's arrival fall in its open window → card DROPPED. **The arrival cascade still applies within the day** — we are not loosening to "any stop open at any hour"; we are sliding the start time. This keeps the itinerary physically doable.
3. **Multi-day (stop arrival rolls past 24:00):** out of scope to introduce. The cascade evaluates all stops on the single `localDay`. If accumulated duration pushes an arrival ≥ 24, the existing `evalPeriods` overnight-wrap handling (`isStopOpenAtHour`/`evalPeriods` already add 24 to close for overnight venues) governs per-stop; we do NOT advance `localDay`. Same as the current instant cascade — no regression, no new multi-day logic.
4. **Optional stops:** skipped for the open-check (`if (stop.optional) continue;`) but their duration+travel still advance the cascade clock — IDENTICAL to the existing instant branch. Do not change optional handling.
5. **Timezone / `utcOffsetMinutes` null:** fallback `card.lng != null ? Math.round(card.lng/15)*60 : 0` — IDENTICAL to the instant branch (`:362`). Place-local derivation preserved; no UTC drift (constitution rule 12).
6. **No-hours / honest-unknown stop (`{}`, absent):** reads OPEN at every probe hour → never blocks qualification. Constitution #9 (LOCKED) preserved.
7. **`now` is exactly 23:30 local:** `floor(nowHour)=23`, single probe `s=23`. A venue open until 22:00 → DROPPED (correct; nothing doable for the rest of today). A 24h venue / always-open type → QUALIFIES.
8. **Already-closed-this-morning venue** (open 8–11, now 14:00): probe set `s ∈ [14,23]`; venue not open at any → DROPPED. Correctly NOT offered (the from-now bias the variant exists to preserve).

---

## 5. REGRESSION-TEST CONTRACT (REQUIRED FOR CLOSE)

Existing test files (EXTEND, do not recreate):
- Implementor: `supabase/functions/_shared/__tests__/curatedStopHours.test.ts`
- Tester (adversarial): `supabase/functions/_shared/__tests__/curatedStopHours.adversarial.test.ts`

Run command (Deno, as the file headers document): `cd supabase && deno test --allow-read functions/_shared/__tests__/curatedStopHours.test.ts`

### 5.1 MANDATORY EDIT to an existing test (BEHAVIOR CHANGE — implementor owns)

`curatedStopHours.test.ts` **T-02 (`:164-173`)** currently asserts that `today` at 03:00 Brussels-local DROPS a restaurant open 11:00–23:00 (`assertEquals(result.length, 0, ...)`). Under FROM-NOW-ONWARD this card now QUALIFIES (probe `s=11` succeeds). **T-02 MUST be updated** to assert `result.length === 1` and its name/comment reworded to: *"'today' (from-now-onward) RETAINS a stop open later today"*. This is the intended behavior change, not a regression. (Leaving T-02 unchanged is a CLOSE blocker — it will fail.) Confirm no OTHER existing assertion in either file depends on the old exact-arrival `today` instant behavior; all bare-`Date` tests (T-2-01, T-12, adversarial T-2-04) use the `instant` mapping and are unaffected.

### 5.2 (a) Implementor happy-path test — `curatedStopHours.test.ts` (REQUIRED, fails-on-revert)

Add **T-ORCH-1212-01 (fails-on-revert): 'today' at an off-hour returns itineraries that the old instant policy emptied.**
- Build a curated card, `utcOffsetMinutes:0`, single non-optional restaurant stop with `periods(localDay, 9, 17)` (open 9–17).
- `now` = a 4 AM local instant on `localDay` (e.g. `new Date(Date.UTC(2026,5,3,4,0,0))` → 04:00 local at offset 0, Wed=3).
- `policy = resolveCuratedHoursPolicy({ dateOption:'today', now })` → assert `policy.mode === 'instantFromNowOnward'`.
- `filterCuratedByStopHours([card], policy)` → assert `length === 1`.
- **Fails-on-revert:** reverting the `today` branch to `{mode:'instant',...}` (the old exact-arrival cascade) evaluates the stop at 04:00 → CLOSED → card DROPPED → `length === 0` → assertion FAILS. Document this in the test comment (mirror the existing T-01 fails-on-revert prose at `:137-162`).

Add **T-ORCH-1212-02: 'today' still DROPS a card with nothing open for the rest of today.**
- Same 9–17 restaurant card, but `now` = 18:00 local. `instantFromNowOnward` probes `s ∈ [18,23]` → none open → `length === 0`. (Proves we did not loosen to full any-hour-on-day; preserves the from-now bias and parity with `isOpenFromHourOnwards` dropping a venue past close.)

Add **T-ORCH-1212-03: multi-stop from-now-onward slides the start hour.**
- Two non-optional stops: stop0 restaurant `periods(day, 12, 22)`, stop1 bar `periods(day, 17, 26)` (overnight), `travelTimeFromPreviousStopMin` realistic. `now`=09:00 local → must QUALIFY by sliding `s` to where the chained arrivals fall in both windows (e.g. `s=18`). Assert `length === 1`. Confirms the cascade (not a flat any-hour check) drives qualification.

### 5.3 (b) Tester adversarial test — `curatedStopHours.adversarial.test.ts` (DIFFERENT angle, tester owns)

Add **T-ORCH-1212-A (genuinely all-closed-all-day pool still empties):** a curated card whose single non-optional stop has `periods` ONLY on a DIFFERENT weekday (e.g. open Tue, today is Wed) → on `today` from-now-onward, no probe on the Wed local day finds it open → `length === 0`. Asserts we never fabricate availability for a stop closed all of today (Constitution #9 in the closed direction; the inverse of the happy path).

Add **T-ORCH-1212-B (this_weekend / pick_dates UNCHANGED):** re-assert that `this_weekend` (Sat-only stop RETAINED, weekday-only stop DROPPED) and `pick_dates` (selected-Saturday stop RETAINED) behave EXACTLY as the existing T-03/T-04/T-05 — i.e. the ORCH-1212 change did not leak into the `anyHourOnDays` modes. Assert `policy.mode === 'anyHourOnDays'` for both and the day-set is unchanged.

Add **T-ORCH-1212-C (back-compat bare Date untouched):** a bare `Date` arg at an off-hour where a stop is closed-right-now-but-open-later MUST still be treated as the strict `instant` exact-arrival cascade and DROP the card (NOT from-now-onward). Proves the bare-Date contract (legacy/test callers) is intentionally distinct from the user-facing `today` path. (This is the adversarial guard that the implementor didn't accidentally reroute the bare-Date back-compat through the new mode.)

### 5.4 CI WIRING (REQUIRED for CLOSE — per Seth's hard-must regression protection)

These Deno tests run under `deno test`, which is NOT a blocking CI job in this repo (per MEMORY: business jest is not blocking; only `featureFlags.test.ts` runs + strict-grep gates). **Per the CLOSE-HARD regression-protection rule, the contract MUST be backed by a strict-grep gate wired into `strict-grep-mingla-business.yml` plus the ACTIVE invariant in §7.** Add:

**NEW strict-grep gate** `.github/scripts/strict-grep/i-curated-today-from-now-onward.mjs` (model on `orch-1147-cart-total-is-allin.mjs` — `--self-test` GOOD/BAD fixtures, comment-strip, exit 1 on violation). It asserts, by scanning `supabase/functions/_shared/curatedStopHours.ts` (comments stripped):
  1. `resolveCuratedHoursPolicy`'s `today`/`now`/empty branch returns `instantFromNowOnward` (NOT bare `instant`) — fail if the `today` branch body matches `mode:\s*['"]instant['"]` without `FromNowOnward`.
  2. The `CuratedHoursPolicy` type union contains `instantFromNowOnward`.
  3. `filterCuratedByStopHours` contains an `instantFromNowOnward` branch that loops a start hour from `Math.floor(` of the local now-hour (token presence check: a `for` over a start-hour with `< 24` AND a reference to `instantFromNowOnward`).
  - Self-test: a GOOD fixture (today→`instantFromNowOnward`, union has it, loop present) passes; a BAD fixture (today→`instant`, or no `instantFromNowOnward` branch) fails with exit 1.
Register it in `.github/workflows/strict-grep-mingla-business.yml` as its own job (run `--self-test` then the real run, mirroring the `orch-1019-curated-hours-canonical-reader` job pattern at `:339-341`). **Prove PASS-on-fix + FAIL-on-revert** of the gate before CLOSE.

> Net: the Deno tests give behavioral fails-on-revert (developer-run + the deno suites already invoked by the curated test files), and the strict-grep gate gives the CI-ENFORCED structural guard that the `today` policy is the from-now-onward mode. Both are required for CLOSE.

---

## 6. DEPLOY / OTA NOTES

- **Edge functions to redeploy** (both import `_shared/curatedStopHours.ts`):
  - `generate-curated-experiences`
  - `discover-cards`
  Deploy from MERGED `main` (not a stale worktree) per the ORCH-1065 INFRA gotcha (clobber risk).
- **Migrations:** NONE.
- **Consumer OTA:** **NOT needed.** This is server-side only; no `app-mobile` JS changes. (Confirmed: the only production edit is `curatedStopHours.ts`, a Deno edge-shared module; no native dep, no client file.)
- **Business OTA:** NONE.
- **Web deploy:** NONE.

---

## 7. AFFECTED SURFACES DECLARATION

| Surface | Affected? | How |
|---|---|---|
| Consumer app (app-mobile) | YES (behaviorally, via server) | The "Today" curated deck now returns multi-stop itineraries at off-hours instead of collapsing to brand-experiences-only. No client code change; no OTA. |
| Collab decks (discover-cards) | YES (behaviorally, via server) | `today` collab curated cards inherit the permissive from-now-onward policy. No new aggregation field. |
| Business app | NO | — |
| Buyer web / marketing web | NO | — |
| Brand experiences hours | NO | Unchanged (brand experiences are not curated stops; no hours gate). |
| `this_weekend` / `pick_dates` | NO | Byte-identical `anyHourOnDays` behavior preserved. |
| Database / RLS / RPC | NO | No migration. |

---

## 8. DRAFT INVARIANT

**I-CURATED-TODAY-FROM-NOW-ONWARD (DRAFT — flip to ACTIVE at ORCH-1212 CLOSE)**

- **Rule:** The curated multi-stop open-hours evaluation for `date_option` `today`/`now`/empty/unknown MUST use the **from-now-onward** policy (`mode:'instantFromNowOnward'`): an itinerary qualifies if it can be completed starting at some hour from `floor(localNowHour)` through end of the place-local day, with every non-optional stop open at its computed arrival time on that day. It MUST mirror the single-venue `today` filter `isOpenFromHourOnwards` (`discover-cards/index.ts:688-694`), NOT the point-in-time exact-arrival instant cascade. It MUST use the LIVE clock (never the stale `datetime_pref`) and place-local day derivation via `utcOffsetMinutes` (no UTC drift, constitution #12). `this_weekend`/`pick_dates` remain `anyHourOnDays`; honest-unknown stays OPEN (Constitution #9). Both solo (`generate-curated-experiences`) and collab (`discover-cards`) paths inherit it via the shared `resolveCuratedHoursPolicy`/`filterCuratedByStopHours` in `_shared/curatedStopHours.ts`. The bare-`Date` back-compat arg to `filterCuratedByStopHours` remains the strict `instant` exact-arrival cascade (distinct contract).
- **Supersedes-extends:** I-CURATED-DATE-OPTION-HONORS-LIVE-CLOCK (ORCH-1113, registry `:389`) — the live-clock-not-stale-pref requirement is preserved; only the `today` mode tightens from exact-arrival `instant` to `instantFromNowOnward`. Amend the ORCH-1113 registry entry's `today` clause accordingly at CLOSE.
- **Enforcement:** strict-grep gate `.github/scripts/strict-grep/i-curated-today-from-now-onward.mjs` (§5.4) wired into `strict-grep-mingla-business.yml`, ships `--self-test`; backed by §5.2 implementor + §5.3 tester Deno tests with proven fails-on-revert.
- **Status:** DRAFT until CLOSE.

---

## 9. WHAT IS EXPLICITLY OUT OF SCOPE (do not touch)

- D2: the curated-only-deck-does-not-fetch-real-venues rule (Seth: leave as-is).
- `this_weekend` / `pick_dates` / `custom` behavior.
- Brand experiences hours behavior.
- Multi-day arrival spill (no new tomorrow-day logic).
- The bare-`Date` → `instant` back-compat mapping.
- Single real-venue card filtering (`discover-cards` `isOpenFromHourOnwards`) — it is the REFERENCE, already correct; do not modify.
- Any client / native / OTA change.
