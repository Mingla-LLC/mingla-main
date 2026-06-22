# ORCH-1212 [today-curated-hours] — IMPLEMENTATION REPORT

**Author:** mingla-implementor
**Date:** 2026-06-22
**Branch / worktree:** `ORCH-1212-today-curated-hours` @ `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1212-[today-curated-hours]`
**Spec:** `Mingla_Artifacts/specs/ORCH-1212-SPEC.md` (binding contract, implemented exactly)
**Mode:** server-side only (Supabase edge-shared module). No client/native change → no OTA.

---

## 1. WHAT WAS BUILT

Single production change + its regression protection, exactly per spec:

1. **`supabase/functions/_shared/curatedStopHours.ts`** (the only production code change):
   - Added a third policy mode `{ mode: 'instantFromNowOnward'; utcNow: Date }` to the `CuratedHoursPolicy` type union.
   - `resolveCuratedHoursPolicy`: the `today`/`now`/empty branch and the unknown-fallback now return `instantFromNowOnward` instead of the harsh exact-arrival `instant`. `this_weekend` and `pick_dates` branches UNCHANGED. Live-clock derivation (`opts.now ?? new Date()`) and normalization preserved (no `datetime_pref` reintroduced).
   - `filterCuratedByStopHours`: added the `instantFromNowOnward` branch BEFORE the `instant` fall-through. It probes integer start hours `s ∈ [Math.floor(nowHour), 23]` and qualifies the card if ANY `s` yields a forward arrival cascade with zero closed non-optional stops. Place-local derivation (`utcOffsetMinutes` → `localDay`/`nowHour`) is identical to the instant branch (no UTC drift, constitution #12). The inner cascade was extracted to a private helper `curatedArrivalCascadeOpen(card, startHour, localDay)` so the duration/travel math + optional-stop handling are byte-identical to the existing instant loop.
   - The bare-`Date` back-compat in `filterCuratedByStopHours` stays mapped to strict `{ mode: 'instant' }` — untouched.
   - Doc-comments updated to document the third mode, the from-now-onward semantics, and the `isOpenFromHourOnwards` parity; ORCH-1061/1113 history preserved.

2. **`supabase/functions/_shared/__tests__/curatedStopHours.test.ts`** (implementor-owned):
   - **T-02 flipped** (the spec-named CLOSE blocker): was "`today` at 03:00 DROPS a 11–23 restaurant (length 0)"; now "`today` (from-now-onward) RETAINS a stop open later today (length 1)" + asserts `policy.mode === 'instantFromNowOnward'`.
   - **T-06 updated**: unknown/empty `dateOption` now asserts `mode === 'instantFromNowOnward'` (was `instant`); still proves the live-clock (not stale-pref) `utcNow`.
   - **T-ORCH-1212-01** (fails-on-revert): 4 AM local, single 9–17 restaurant → `instantFromNowOnward` → RETAINED (probe s=9). Reverting to `instant` empties it.
   - **T-ORCH-1212-02**: same 9–17 venue at 18:00 local → DROPPED (probe set [18,23] finds nothing open) — proves we did NOT loosen to any-hour-on-day.
   - **T-ORCH-1212-03**: multi-stop (restaurant 12–22, bar 17–26, 30min travel) at 09:00 → RETAINED by sliding the start hour — proves the cascade (not a flat check) drives qualification.

3. **`.github/scripts/strict-grep/i-curated-today-from-now-onward.mjs`** (NEW gate, modeled on `orch-1147-cart-total-is-allin.mjs`): comment-stripped scan of `curatedStopHours.ts` asserting (1) the union contains `instantFromNowOnward`, (2) the `today` branch returns `mode:'instantFromNowOnward'` not bare `instant`, (3) `filterCuratedByStopHours` has the mode guard + a `for (... = Math.floor(...) ... < 24 ...)` start-hour probe. Ships `--self-test` (GOOD passes; BAD_A=today-still-instant and BAD_B=no-from-now-branch both fail with exit 1).

4. **`.github/workflows/strict-grep-mingla-business.yml`**: registered job `orch-1212-curated-today-from-now-onward` (self-test step + real run), mirroring the `orch-1019-curated-hours-canonical-reader` pattern.

---

## 2. BEFORE / AFTER — POLICY RESOLUTION + NEW BRANCH

### `resolveCuratedHoursPolicy` — `today` branch
BEFORE:
```ts
if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
  return { mode: 'instant', utcNow: now };
}
```
AFTER:
```ts
if (dOpt === 'today' || dOpt === 'now' || !opts.dateOption) {
  // [ORCH-1212] FROM-NOW-ONWARD: doable starting at some hour from now through
  // end of today (live clock, never the stale stored datetime_pref).
  return { mode: 'instantFromNowOnward', utcNow: now };
}
```
Unknown fallback: `{ mode: 'instant', utcNow: now }` → `{ mode: 'instantFromNowOnward', utcNow: now }`.

### `filterCuratedByStopHours` — NEW from-now-onward branch (added before the `instant` fall-through)
```ts
if (resolved.mode === 'instantFromNowOnward') {
  const utcNow = resolved.utcNow;
  return cards.filter((card) => {
    if (card.cardType !== 'curated' || !card.stops?.length) return true;
    const offsetMin = card.utcOffsetMinutes ?? (card.lng != null ? Math.round(card.lng / 15) * 60 : 0);
    const localMs = utcNow.getTime() + offsetMin * 60 * 1000;
    const localDate = new Date(localMs);
    const nowHour = localDate.getUTCHours() + localDate.getUTCMinutes() / 60;
    const localDay = localDate.getUTCDay();
    for (let s = Math.floor(nowHour); s < 24; s++) {
      if (curatedArrivalCascadeOpen(card, s, localDay)) return true;
    }
    return false;
  });
}
```
The `instant` branch below it and the `anyHourOnDays` branch above it are unchanged. `curatedArrivalCascadeOpen` is the existing instant inner loop with the start hour parameterized (same `CURATED_STOP_DURATION`, same `travelTimeFromPreviousStopMin || 15`, same `if (stop.optional) continue;`).

---

## 3. TEST RUN (PASS)

`cd supabase && deno test --allow-read --no-check functions/_shared/__tests__/curatedStopHours.test.ts`
```
ok | 17 passed | 0 failed (8ms)
```
Includes the flipped T-02, updated T-06, and the three new T-ORCH-1212-01/02/03. `deno check functions/_shared/curatedStopHours.ts` — clean.

---

## 4. FAILS-ON-REVERT PROOF

Temporarily reverted ONLY the `today` branch back to `{ mode: 'instant', utcNow: now }`:
- Deno suite: **5 FAILED** — T-ORCH-1212-01 (the mandated 4 AM / 9–17 venue test), T-ORCH-1212-02, T-ORCH-1212-03, T-02, T-06. (12 passed / 5 failed.)
- Strict-grep gate: **exit 1** — `the 'today'/'now'/empty branch of resolveCuratedHoursPolicy must return mode:'instantFromNowOnward', not the harsh exact-arrival 'instant'.`

Restored the fix → 17/17 pass, gate exit 0.

---

## 5. STRICT-GREP GATE SELF-TEST

```
$ node .github/scripts/strict-grep/i-curated-today-from-now-onward.mjs --self-test
ORCH-1212 curated-today-from-now-onward gate self-test passed.   (exit 0)
$ node .github/scripts/strict-grep/i-curated-today-from-now-onward.mjs
ORCH-1212 curated-today-from-now-onward gate passed.             (exit 0)
```
The pre-existing `i-curated-hours-via-canonical-reader.mjs` gate still passes (no regression).

---

## 6. SCOPE CONFIRMATION

- `this_weekend` / `pick_dates` / `custom`: byte-identical `anyHourOnDays` behavior. The only diff lines touching them are doc-comment context — zero logic change. (T-03/T-04/T-05/T-11 pass.)
- Call sites `generate-curated-experiences/index.ts` and `discover-cards/index.ts`: NOT edited — they inherit the fix through the shared resolver/filter (`git diff --name-only` shows neither). The `all_closed_at_time` empty-reason emission stays as-is.
- Experiences (brand experiences hours): untouched.
- **D2** (no-real-venue-fetch for curated-only decks): untouched — the change is purely the hours predicate.
- Bare-`Date` back-compat: still strict `instant` (T-12 passes).
- No migration, no client/native file, no OTA, no web deploy.

---

## 7. FLAGS / SPEC-vs-REALITY NOTES

1. **Tester adversarial file now has 1 failing assertion (expected, tester-owned).** `curatedStopHours.adversarial.test.ts` **T-3-01** (line 276) hard-asserts `policy.mode === 'instant'` for `dateOption:'today'`. After the fix `today` resolves to `instantFromNowOnward`, so that assertion fails (10 passed / 1 failed in that file). Per dispatch + spec §5.3 the adversarial file is **tester-owned** and I did NOT modify it. The spec §5.1's instruction to "confirm no OTHER existing assertion depends on old `today` instant behavior" only audited the implementor file; it missed this mode-assertion in the tester file. **Action for the tester:** when adding T-ORCH-1212-A/B/C, also update T-3-01's mode assertion from `'instant'` to `'instantFromNowOnward'` (its end-to-end length assertion at line 280 still holds — the Tokyo card at 13:00 local qualifies under from-now-onward). T-3-02's `today` cases assert only lengths and still pass.

2. **Spec §3.1.C.3 prose vs. actual instant-branch code on optional stops.** The spec prose says optional stops "still consume their duration+travel in the cascade" while the binding clause says "match the existing instant loop structure precisely." The existing instant loop `continue`s on optional stops BEFORE the clock advance (so optional stops consume nothing). I matched the existing code exactly (the binding instruction) via the shared `curatedArrivalCascadeOpen` helper — both the `instant` and `instantFromNowOnward` paths now share one loop, guaranteeing identical optional-stop handling. The prose's "consume duration+travel" description does not match the pre-existing instant branch; I preserved behavioral parity rather than the prose.

---

## 8. COMMIT

Single commit on `ORCH-1212-today-curated-hours` (see commit hash in the dispatch return / `git log`). No commit on `main`. Not deployed, not merged.
