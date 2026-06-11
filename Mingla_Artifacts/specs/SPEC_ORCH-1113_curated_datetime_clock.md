# SPEC — ORCH-1113 [curated-experience-empty-deck-regression]

- **Mode:** SPEC (contract only; no code, illustrative snippets ≤2–3 lines)
- **Date:** 2026-06-11
- **Author:** mingla-forensics (SPEC)
- **Source investigation (authoritative):** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1113_CURATED_EXPERIENCE_EMPTY_DECK.md` — section **ROOT CAUSE v4** (PROVEN, source + live-DB backed).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1113-[curated-datetime-clock]/` on branch `ORCH-1113-curated-datetime-clock` (rebased on origin/main).
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets `forensics`, `ORCH-1113`, or `ALL` that gates this turn. COMMS-0003 (external-API docs at SPEC time) is **N/A** — this ORCH touches NO external API (no Stripe/OpenAI/Google/etc.); it is a clock/date-option fix inside two edge functions, one shared module, and the RN client. The curated-deck COMMS history (0011/0016, supply/pricing) is unrelated to this defect.

---

## 1. Executive summary

When a user opens a **curated multi-stop "intent card"** deck (Romantic / First-Date / Group-Fun / Adventurous / Picnic / Stroll), the curated path decides whether each stop is open by evaluating the venue's hours against the **stale stored `datetime_pref`** (a fixed timestamp that can be weeks old), and it **never reads the user's `date_option`** ("Now/Today/This Weekend/Pick a Date"). For a remote/custom location whose stored instant lands at night locally, every vibe's required stop reads "closed," the whole deck empties, and it is mislabeled `pool_empty` → "No spots match right now." Single cards are immune only because the singles path uses the **live device clock** for `today` and branches on `date_option`.

This SPEC brings the curated open-hours evaluation to **parity with single cards' `filterByDateTime`**: for `date_option='today'/'now'` it evaluates against the **live clock**; for `this_weekend` it evaluates **open-at-ANY-hour on Sat or Sun**; for `pick_dates` it evaluates **open-at-ANY-hour on the selected day(s)**. It threads `date_option` + `selected_dates` from the client through both the solo (`generate-curated-experiences`) and collab (`discover-cards`) curated paths via a single shared helper so both stay correct and idempotent. It replaces the dishonest hardcoded `pool_empty` with a distinct `all_closed_at_time` reason when cards were built then all hours-dropped, and branches the consumer empty-state copy on that reason. The ORCH-1061 same-day "don't serve a closed venue right now" intent is preserved.

---

## 2. Scope & non-goals

### In scope
1. A new shared helper in `_shared/curatedStopHours.ts` that, given `date_option`, `datetime_pref`, `selected_dates`, and the live clock, returns the **evaluation policy** the multi-stop cascade must use (live-clock instant for `today`; an open-at-any-hour-on-target-day(s) policy for `this_weekend`/`pick_dates`). Applied identically by the solo and collab call sites.
2. Threading `date_option` + `selected_dates` from the RN client → `generate-curated-experiences` (request body) and into the cascade.
3. Replacing the hardcoded `pool_empty` at `generate-curated-experiences/index.ts:1741-1742` with `all_closed_at_time` **only when cards existed pre-filter and were all dropped by the hours cascade**; genuine empty candidate pools keep `pool_empty`.
4. Extending the `CuratedEmptyReason` union with `all_closed_at_time`; aggregating it in `deckService.ts`; threading the solo reason to `SwipeableCards` and branching the empty-state title/subtitle copy.
5. Collab (`discover-cards`) curated path: the same `curatedUtcNow`/policy computation, so the latent equivalent defect does not ship there.

### Non-goals (explicitly OUT)
- **No SQL / RPC / migration change.** The candidate RPC `fetch_local_signal_ranked` has NO city/country/region gate and returns ample Brussels supply (investigation E-2/A); region-gating and supply-starvation are DISPROVEN. Do not touch any migration or RPC.
- **No deletion or weakening of the open-hours filter for same-day "now" plans.** ORCH-1061's intent (never recommend a closed venue for a Today-right-now plan) is preserved (Invariant I-CURATED-HOURS-VIA-CANONICAL-READER).
- **No change to the candidate radius (F-3), the combo all-or-nothing engine (F-2), or graceful-degrade.** Those are proven-mechanism contributors but out of this ORCH's scope.
- **No client-side `datetime_pref` hygiene rewrite** (recompute/clear stored pref on `date_option` change). The server-side date_option fix makes the stale instant harmless for the curated path; a client hygiene pass is a separate optional ORCH.
- **No currency/locale change. No honest-unknown (Constitution #9) change** — venues with no hours data still assume OPEN.
- **No business app / buyer-web / admin change** — none call the curated path.

### Assumptions
- `preferences.date_option` values seen by the client: `'today'`, `'now'`, `'this_weekend'`, `'pick_dates'`, plus legacy `'weekend'`/`'custom'` (normalized exactly as `discover-cards` `filterByDateTime` already does at index.ts:648).
- `selected_dates` is an ISO-date-string array or null (matches `discover-cards` `selectedDates` handling at index.ts:684-686).
- For `pick_dates` with no `selected_dates`, the cascade falls back to `datetime_pref` as a single date (mirrors `filterByDateTime` index.ts:684-686), then to live clock.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | ✅ | Curated deck assembles for a remote location at a date_option where venues are open; closed-everything decks read honest copy | `app-mobile/src/types/curatedExperience.ts`, `services/curatedExperiencesService.ts`, `services/deckService.ts`, `components/SwipeableCards.tsx`, `i18n/locales/en/cards.json`, `contexts/RecommendationsContext.tsx` (thread reason to component) + shared edge fns | Shared edge fn → automatic with Android |
| 2 | Consumer Android (`app-mobile/` Android) | ✅ | Same as iOS | Same as iOS (shared RN + edge) | Automatic (shared code) |
| 3 | Buyer/anon Web | ❌ | — | none | No consumer curated deck on web |
| 4 | Business iOS | ❌ | — | none | Business app has no curated intent deck |
| 5 | Business Android | ❌ | — | none | Same |
| 6 | Admin Web | ❌ | — | none | No curated deck |
| 7 | Business Web preview | ❌ | — | none | No curated deck |

Shared edge functions touched (`supabase/functions/generate-curated-experiences/index.ts`, `discover-cards/index.ts`, `_shared/curatedStopHours.ts`) serve BOTH consumer platforms identically → iOS/Android parity is automatic.

---

## 4. Layered specification

> No Database, Realtime layer. Edge + shared module + service + context + component + i18n only.

### 4.1 Shared module — `supabase/functions/_shared/curatedStopHours.ts`

Add a single exported policy resolver and route `filterCuratedByStopHours` through it. The cascade body (`isStopOpenAtHour`, `evalPeriods`, duration accumulation, honest-unknown rule, ALWAYS_OPEN, business-hours array branch) is **unchanged**.

**New exported function — `resolveCuratedHoursPolicy(opts)`**
- **Input:** `{ dateOption?: string; datetimePref?: string; selectedDates?: string[] | null; now?: Date }` (`now` defaults to `new Date()`; injectable for tests).
- **Behavior (normalize `dateOption` EXACTLY as discover-cards index.ts:648 — lowercase, `-`/space→`_`):**
  - `'today'` | `'now'` | empty/undefined → **`{ mode: 'instant', utcNow: <now> }`** — evaluate the multi-stop arrival cascade from the LIVE clock (NOT `datetimePref`). This is the fix for fact #2 (Raleigh works) and fact #5 (Brussels noon open) — matches singles' `today` branch (discover-cards:654 `const utcNow = new Date()`).
  - `'this_weekend'` | `'weekend'` → **`{ mode: 'anyHourOnDays', days: [6, 0] }`** — a stop passes if it is open at ANY hour on Saturday OR Sunday (mirror `isOpenAnyTimeOnDay` semantics at discover-cards:676).
  - `'pick_dates'` | `'custom'` → **`{ mode: 'anyHourOnDays', days: <weekday set> }`** — derive the day-of-week set from `selectedDates` (fall back to `[datetimePref]`, then to `[now]`) using the SAME noon-UTC day derivation as `filterByDateTime` (discover-cards:697-699). A stop passes if open at ANY hour on any of those days.
  - Unknown `dateOption` → treat as `'instant'` with `utcNow: now` (safe default; never trust a stale `datetimePref`).
- **Output type (export):**
  ```ts
  type CuratedHoursPolicy =
    | { mode: 'instant'; utcNow: Date }
    | { mode: 'anyHourOnDays'; days: number[] };
  ```

**Changed function — `filterCuratedByStopHours`**
- **New signature (additive, back-compat):** `filterCuratedByStopHours(cards: any[], policy: CuratedHoursPolicy | Date): any[]`.
  - When a bare `Date` is passed (legacy callers / tests), treat it as `{ mode: 'instant', utcNow: <date> }` — preserves the existing fails-on-revert test contract and idempotence.
- **`mode: 'instant'`** — IDENTICAL to today's body: per-card `utcOffsetMinutes` → place-local start hour/day, accumulate per-stop duration + travel, drop on any closed non-optional stop. (No behavioral change for `today`/`now` except the clock source is the live instant, set by the caller.)
- **`mode: 'anyHourOnDays'`** — for each non-optional stop, the stop passes if `isStopOpenAtHourAnyTime(stop, day)` is true for ANY `day` in `policy.days`. "Open at any time on the day" means: ALWAYS_OPEN → true; no data → true (honest-unknown); else the stop has ≥1 period (or parseable text range) on that day. The multi-stop arrival cascade does NOT apply in this mode (a weekend/pick-dates plan is not anchored to a wall-clock arrival time — same rationale `filterByDateTime` uses `isOpenAnyTimeOnDay` not the hour cascade for these modes). Add a thin internal `isStopOpenAtHourAnyTime(stop, day)` that reuses the existing `evalPeriods`/business-array/text branches with an "any period on this day" predicate (mirror `hasOpeningData`/`isOpenAnyTimeOnDay` at discover-cards:614-644).
- **Idempotence preserved:** re-filtering an already-passing card is a no-op in both modes (collab calls the filter again downstream; must remain a no-op).

**Reference contract being mirrored (cite in code comment):** `discover-cards/index.ts` `filterByDateTime` (index.ts:509-707) — `today`→`utcNow=new Date()`+`isOpenFromHourOnwards` (654-666); `this_weekend`→`isOpenAnyTimeOnDay(6)||isOpenAnyTimeOnDay(0)` (673-677); `pick_dates`→day-of-week from each selected date via noon-UTC (683-702). The new policy resolver makes the curated cascade reach this same shape.

### 4.2 Edge function — `supabase/functions/generate-curated-experiences/index.ts`

- **Request parse (index.ts:1616-1634):** add `dateOption` and `selectedDates` to the destructured body (default `dateOption: undefined`, `selectedDates: null`). Validate `selectedDates` is an array of strings or null (drop non-string entries; coerce non-array to null), same defensive shape used for `excludePlacePoolIds` (index.ts:1635-1640).
- **Collab aggregation (index.ts:1657-1671):** when `session_id` is present, `aggregateSessionPreferences` is the source of truth. If the aggregate exposes a date option / selected dates, prefer them over the body values (mirror the existing `if (agg.datetimePref) datetimePref = agg.datetimePref` at index.ts:1664). If the aggregate does not expose them, retain the body values. (Do NOT add new aggregation fields if absent — collab curated already runs through discover-cards' deterministic path for the primary collab deck; this fn's collab branch is the teaser/aggregate path. Use whatever the aggregate already returns; otherwise body.)
- **Hours filter (index.ts:1737-1738):** replace the bare `curatedUtcNow` construction with a policy:
  ```ts
  const hoursPolicy = resolveCuratedHoursPolicy({ dateOption, datetimePref, selectedDates });
  cards = filterCuratedByStopHours(cards, hoursPolicy);
  ```
- **Honest empty reason (index.ts:1739-1743):** capture `cards.length` BEFORE the filter (`builtCount`). After the filter, if `cards.length === 0 && !summary`:
  - if `builtCount > 0` → `summary = { emptyReason: 'all_closed_at_time', candidateAnchorCount: builtCount, failedAnchorCount: builtCount }`.
  - else → `summary = { emptyReason: 'pool_empty', candidateAnchorCount: 0, failedAnchorCount: 0 }` (unchanged).
- **Error contract:** unchanged; still returns HTTP 200 with `cards: []` + `summary` on empty.

### 4.3 Edge function — `supabase/functions/discover-cards/index.ts` (collab parity)

- Both curated call sites (index.ts:1557-1558 and 2396-2397) currently do `const curatedUtcNow = (agg.)datetimePref ? new Date(...) : new Date(); filterCuratedByStopHours(timeFilteredCards, curatedUtcNow)`.
- Replace each with `resolveCuratedHoursPolicy({ dateOption: <local dOpt source>, datetimePref: <same source>, selectedDates: <same source> })` then `filterCuratedByStopHours(timeFilteredCards, hoursPolicy)`.
  - At index.ts:2392-2395 `dateOption` + `selectedDates` are already in scope (passed to `filterByDateTime`). Use them.
  - At index.ts:1543-1556 (aggregate path) `agg.datetimePref`/`agg.selectedDates`/`agg.dateWindows` are in scope; pass the aggregate's date option if present, else `'today'`. (`filterByDateWindows` branch is untouched.)
- `filterByDateTime` upstream is UNCHANGED — it already removes cards that don't open on the target day; the curated cascade now agrees with it instead of contradicting it via a stale instant.

### 4.4 Service — `app-mobile/src/services/curatedExperiencesService.ts`

- `GenerateCuratedParams` (line 4-16): add `dateOption?: string;` and `selectedDates?: string[] | null;`.
- `generateCuratedExperiences` body build (line 28-39): forward both when present (`if (params.dateOption) body.dateOption = params.dateOption;` and `if (params.selectedDates?.length) body.selectedDates = params.selectedDates;`). `warmPool` body unchanged (warm pool intentionally has no date context).

### 4.5 Service — `app-mobile/src/services/deckService.ts`

- `DeckParams` (line 63-77): add `selectedDates?: string[];` (the interface already has `dateOption?: string` at line 73).
- Curated call (line 733-744): forward `dateOption: params.dateOption` and `selectedDates: params.selectedDates` into `generateCuratedExperiences({ … })`.
- Empty-reason aggregation (line 964-970): extend precedence to **`pipeline_error > no_viable_anchor > all_closed_at_time > pool_empty`**. `all_closed_at_time` ranks above `pool_empty` so that if ANY pill emptied due to closed venues (cards built then dropped) while another genuinely had no pool, the user gets the more actionable "everything is closed" message. Update the trailing comment.

### 4.6 Types — `app-mobile/src/types/curatedExperience.ts`

- Extend the union (line 62): `export type CuratedEmptyReason = 'pool_empty' | 'no_viable_anchor' | 'pipeline_error' | 'all_closed_at_time';`.
- Update the doc comment above to note `all_closed_at_time` = "candidate pool was non-empty; every assembled itinerary had a stop closed at the evaluated time".

### 4.7 Context — `app-mobile/src/contexts/RecommendationsContext.tsx`

- `soloCuratedEmptyReason` (line 806) already carries the verdict. Currently it is only surfaced to the component for COLLAB (`collabDeckDeadEndReason`, line 1918-1920). Add a **solo-visible** field on the context value, e.g. `curatedEmptyReason: soloCuratedEmptyReason` (or extend the existing `collabDeckDeadEndReason` to also pass through for solo under a clearly-named field). The component must be able to read the reason for BOTH modes to branch copy. Do not change the EMPTY-routing logic (lines 933/1308/1627/1827) — those already fire EMPTY on any reason including the new one (it is `!== undefined`).

### 4.8 Component — `app-mobile/src/components/SwipeableCards.tsx`

- Read the curated empty reason from context (the field added in 4.7) in addition to the existing `collabDeckDeadEndReason`.
- In the `EMPTY` branch (line 2366-2411), when the resolved curated reason is `'all_closed_at_time'`, use:
  - **title:** `t('cards:swipeable.all_closed_title')`
  - **subtitle:** `t('cards:swipeable.all_closed_subtitle')`
  - icon stays `filter-outline`.
  - For every other empty reason, behavior is UNCHANGED (`no_matches_title`/`no_matches_subtitle`).
- The collab dead-end copy path (`getCollabDeadEndCopy()`) takes precedence as today; the new branch applies to the solo+collab plain-empty case where reason is `all_closed_at_time`.

### 4.9 i18n — `app-mobile/src/i18n/locales/en/cards.json`

Add two keys (EN authoritative; other locales get the same English string + `@needs_translation` suffix, matching the existing pattern at pl/vi/sv/he/ms):
- `"swipeable.all_closed_title": "Everything's closed right now"`
- `"swipeable.all_closed_subtitle": "These spots are great but closed at this time. Try \"This Weekend\" or pick a date to plan ahead."`

(Exact strings are the copy contract — implementor uses verbatim.)

---

## 5. Success criteria

- **SC-1 (core, both platforms via shared edge):** With a stored `datetime_pref` weeks in the past (e.g. 2026-04-15 21:20 UTC), a Brussels custom location, and `date_option='today'`, `generate-curated-experiences` assembles ≥1 curated card when Brussels venues are open at the LIVE clock (e.g. midday Brussels), instead of returning empty. Evaluation no longer reads the stale `datetime_pref` for `today`.
- **SC-2:** With `date_option='this_weekend'`, the curated cascade evaluates open-at-any-hour on Sat OR Sun (not the stored instant); a stop open Saturday afternoon is NOT dropped because the stored instant was a Wednesday night.
- **SC-3:** With `date_option='pick_dates'` + `selected_dates=['2026-06-20']`, the cascade evaluates open-at-any-hour on that date's weekday; stops closed on an unrelated stored-instant day are not dropped.
- **SC-4 (preserve ORCH-1061):** With `date_option='today'` and the LIVE clock at 03:00 local where every required stop is closed, the cascade STILL drops closed stops (no closed venue served for a now-plan).
- **SC-5 (honest reason):** When cards were built then all dropped by the hours cascade, the response carries `summary.emptyReason='all_closed_at_time'` (not `pool_empty`). When the candidate pool was genuinely empty (no cards built), it carries `pool_empty`.
- **SC-6-iOS / SC-6-Android (copy):** A curated-only deck that empties with `all_closed_at_time` shows the title "Everything's closed right now" and the all_closed subtitle, NOT "No spots match right now". Other empty reasons keep the original copy. (Manual-parity split only because it is a UI assertion; shared RN code makes the two identical.)
- **SC-7 (param threading):** `generate-curated-experiences` receives `dateOption` + `selectedDates` in its request body from the curated client call (verifiable in the request payload / edge log).
- **SC-8 (collab parity + idempotence):** The collab `discover-cards` curated path uses the same policy resolver; re-running `filterCuratedByStopHours` on an already-passing card list is a no-op (no card dropped on the second pass).

---

## 6. Invariants

- **I-CURATED-HOURS-VIA-CANONICAL-READER** (ACTIVE, ORCH-1019/1061) — PRESERVED. The hours evaluation still routes through `isStopOpenAtHour`/`evalPeriods` (the canonical periods-first cascade); no weekday-name indexing added. Verified by the existing strict-grep gate + the unchanged cascade body.
- **Honest-unknown → OPEN** (Constitution #9, curatedStopHours.ts:25-27) — PRESERVED. No-hours-data stops still assume OPEN in both policy modes.
- **`CuratedEmptyReason` contract** (curatedExperience.ts) — EXTENDED additively with `all_closed_at_time`; existing literals unchanged; downstream aggregation handles the new literal.
- **Idempotence of `filterCuratedByStopHours`** — PRESERVED (collab double-filter no-op).

### New DRAFT invariant (orchestrator flips ACTIVE on CLOSE)
- **I-PROPOSED-CURATED-HONORS-DATE-OPTION** *(DRAFT)* — The curated multi-stop open-hours evaluation MUST honor `date_option`: use the LIVE clock for `today`/`now` (parity with single-card `filterByDateTime`'s `today` mode), and open-at-ANY-hour-on-target-day(s) for `this_weekend`/`pick_dates`. The curated cascade MUST NOT evaluate stop open/closed against a stored `datetime_pref` instant for `today`. Both the solo (`generate-curated-experiences`) and collab (`discover-cards`) curated paths compute the policy via the shared `resolveCuratedHoursPolicy`. Enforced by the regression tests in §7/§9.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (happy, fails-on-revert) | `today` uses live clock, not stale pref | stale `datetimePref`=2026-04-15 21:20 UTC, `dateOption='today'`, card with stop open at the LIVE-clock local hour | card RETAINED (policy `instant` with `now`) | shared module |
| T-02 | `today` still drops closed-now | `dateOption='today'`, live clock 03:00 local, required stop closed | card DROPPED | shared module |
| T-03 | `this_weekend` open-at-any-hour | `dateOption='this_weekend'`, stop open Sat 14:00 only, stored instant Wed 23:20 | card RETAINED | shared module |
| T-04 | `this_weekend` closed all weekend | stop with no Sat/Sun periods | card DROPPED | shared module |
| T-05 | `pick_dates` selected weekday | `selectedDates=['2026-06-20']` (Sat), stop open Sat | RETAINED; stop closed only on the stored-instant weekday is NOT used | shared module |
| T-06 | unknown/empty dateOption defaults safe | `dateOption=undefined` | policy `instant` with `now` (NOT stale pref) | shared module |
| T-07 | honest reason — closed | cards built (builtCount>0), all dropped by filter | `summary.emptyReason='all_closed_at_time'` | edge fn |
| T-08 | honest reason — genuine empty | zero cards built | `summary.emptyReason='pool_empty'` | edge fn |
| T-09 | aggregation precedence | one pill `all_closed_at_time`, one `pool_empty` | `curatedEmptyReason='all_closed_at_time'` | service |
| T-10 (copy) | empty-state copy branch | curated reason `all_closed_at_time` | title="Everything's closed right now"; other reasons unchanged | component |
| T-11 (collab idempotence) | double filter no-op | already-passing card list filtered twice | identical list both passes | shared module |
| T-12 (legacy Date arg) | bare `Date` still works | `filterCuratedByStopHours(cards, someDate)` | treated as `{mode:'instant'}`; existing T-2-01 passes unchanged | shared module |

---

## 8. Implementation order

1. **Shared module** — add `CuratedHoursPolicy` type + `resolveCuratedHoursPolicy` + `isStopOpenAtHourAnyTime` in `_shared/curatedStopHours.ts`; widen `filterCuratedByStopHours` to accept `CuratedHoursPolicy | Date`. (`_shared/curatedStopHours.ts`)
2. **Solo edge fn** — parse `dateOption`/`selectedDates`; build policy; honest empty reason with `builtCount`. (`generate-curated-experiences/index.ts`)
3. **Collab edge fn** — route both curated call sites through `resolveCuratedHoursPolicy`. (`discover-cards/index.ts`)
4. **Types** — extend `CuratedEmptyReason`. (`app-mobile/src/types/curatedExperience.ts`)
5. **Services** — forward params (curatedExperiencesService) + add `selectedDates` to `DeckParams` + forward in curated call + extend aggregation precedence. (`curatedExperiencesService.ts`, `deckService.ts`)
6. **Context** — surface solo curated reason to the component value. (`RecommendationsContext.tsx`)
7. **Component + i18n** — branch empty-state copy; add EN keys + `@needs_translation` mirrors. (`SwipeableCards.tsx`, `i18n/locales/*/cards.json`)
8. **Tests** — extend `_shared/__tests__/curatedStopHours.test.ts` (T-01..T-06, T-11, T-12) and the handler test for T-07/T-08; client test for T-09/T-10.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the policy resolver `resolveCuratedHoursPolicy` is the single date-option authority for the curated cascade, used by both call sites.
- **Implementor happy-path (fails-on-revert) — T-01:** in `_shared/__tests__/curatedStopHours.test.ts`, a curated card for a remote location (e.g. `utcOffsetMinutes=120`, Brussels) with a stored `datetimePref` weeks in the past evaluated under `dateOption='today'` is RETAINED because the policy uses the live clock at an hour the stop is open. **Reverting** the policy change (back to `curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date()`) makes the stop read closed at the stale 23:20 instant → card DROPPED → test FAILS. Capture the revert evidence in the implementation report. Add a protective comment citing ORCH-1113 + the v4 root cause.
- **Tester adversarial (different angle, owned by mingla-tester):** prove (a) a stale `datetime_pref` no longer leaks into a remote location's open/closed evaluation under `today` (build a Brussels card with a Wed-night stored instant + a live clock at Brussels noon → RETAINED); (b) `today` mode uses the live clock — closed-now stops still dropped (SC-4); (c) `this_weekend` evaluates open-at-any-hour (a Sat-only-open stop survives even though the stored instant is a Wednesday night); (d) the honest-reason branch fires `all_closed_at_time` only when cards were built then dropped, never for a genuinely empty pool. Adversarial test file: `_shared/__tests__/curatedStopHours.adversarial.test.ts` (extend) + a client copy-branch assertion.
- **Run:** `cd supabase && deno test --allow-read functions/_shared/__tests__/curatedStopHours.test.ts functions/_shared/__tests__/curatedStopHours.adversarial.test.ts` + the app-mobile jest suite for deckService/SwipeableCards.

---

## 10. Open questions

1. **Collab date-option source in `generate-curated-experiences` aggregate branch (index.ts:1657-1671).** The investigation did not enumerate whether `aggregateSessionPreferences` exposes a `dateOption`/`selectedDates` field. CONTRACT DECISION (no new investigation): if the aggregate already returns them, prefer them; if not, fall back to the body values (default `'today'`). Do NOT add new aggregation columns/fields under this ORCH. If the implementor finds the aggregate path is the PRIMARY collab curated supply (not just teaser) AND lacks date context, STOP and request a SPEC amendment rather than widening.
2. **`this_weekend`/`pick_dates` and the arrival cascade.** This SPEC intentionally drops the wall-clock arrival cascade in `anyHourOnDays` mode (matching `filterByDateTime`'s `isOpenAnyTimeOnDay`), because a future-day plan has no "now" to anchor arrival times to. If product later wants weekend plans to also respect a same-chain closing cascade at a chosen start hour, that is a follow-on — not in this ORCH.

---

## 11. Downstream routing

**NEXT = mingla-implementor (consumer side).** Build from this SPEC §4 in the implementation order §8, inside the worktree `~/Desktop/mingla-orchs/ORCH-1113-[curated-datetime-clock]/` on branch `ORCH-1113-curated-datetime-clock`. Hold all §6 invariants (esp. preserve ORCH-1061's same-day drop and Constitution #9). Touch ONLY the allowlist files (§ Allowlist). Produce `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1113_curated_datetime_clock.md` with the T-01 fails-on-revert evidence captured. Then route to **mingla-tester** for the adversarial §9 angles + device/sim confirmation (reset `datetime_pref` to a stale value, switch to a remote evening location, select a curated vibe under each date_option), then **mingla-orchestrator** for CLOSE (flip I-PROPOSED-CURATED-HONORS-DATE-OPTION → ACTIVE; deploy edge fns from MERGED main per the edge-deploy hazard rule; OTA per-platform).

---

## Scoped allowlist (implementor may modify ONLY these)

- `supabase/functions/_shared/curatedStopHours.ts`
- `supabase/functions/generate-curated-experiences/index.ts`
- `supabase/functions/discover-cards/index.ts`
- `app-mobile/src/types/curatedExperience.ts`
- `app-mobile/src/services/curatedExperiencesService.ts`
- `app-mobile/src/services/deckService.ts`
- `app-mobile/src/contexts/RecommendationsContext.tsx`
- `app-mobile/src/components/SwipeableCards.tsx`
- `app-mobile/src/i18n/locales/*/cards.json` (EN authoritative; others get `@needs_translation` mirror)
- Tests: `supabase/functions/_shared/__tests__/curatedStopHours.test.ts`, `curatedStopHours.adversarial.test.ts`, the relevant `generate-curated-experiences/__tests__/` handler test, and app-mobile jest tests for deckService/SwipeableCards.

## DO-NOT-TOUCH

- Any `supabase/migrations/**` (NO SQL/RPC change — region/supply DISPROVEN).
- `fetch_local_signal_ranked`, `query_servable_places_by_signal`, `signalRankFetch.ts`, `distanceMath.ts`, the combo-assembly engine (`generateCardsForType` internals), `pg_eligible_experiences_for_deck`.
- The `isStopOpenAtHour`/`evalPeriods`/business-hours/honest-unknown cascade BODY (reuse, do not alter its open/closed semantics).
- `filterByDateTime` in `discover-cards` (already correct; the curated path is being brought to parity WITH it, not changing it).
- Any Stripe/Paystack/payment, brand-experience supply, or business/admin/buyer-web code.

The implementor must **stop-and-amend** (request a SPEC amendment) before touching anything outside the allowlist.
