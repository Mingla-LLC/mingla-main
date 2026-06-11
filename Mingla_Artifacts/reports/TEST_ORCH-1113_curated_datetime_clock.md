# TEST — ORCH-1113 [curated-experience-empty-deck-regression] / curated_datetime_clock

**Tester:** mingla-tester (Claude) · **Date:** 2026-06-11
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1113-[curated-datetime-clock]/` · **Branch:** `ORCH-1113-curated-datetime-clock`
**HEAD at verdict:** `cb9ccf1a1` (tester adversarial test commit) · base `origin/main`

---

## 1. VERDICT

### ✅ PASS — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

The ORCH-1113 fix is independently proven correct via the executed Deno test matrix (the
date-option policy is pure, unit-testable code — the dispatch's required runtime-evidence bar).
The stale `datetime_pref` no longer leaks into a `today` evaluation; the ORCH-1061 same-day drop
survives; `this_weekend`/`pick_dates` evaluate the right day(s); the `all_closed_at_time` empty
reason is structurally gated so it can never be a false signal on a genuinely-empty pool;
idempotence holds in both policy modes; no SQL/RPC/migration was touched; single-card behavior is
unchanged; the regression gate is satisfied (implementor happy-path T-01 + tester adversarial
T-3-01, both on-branch, both in the closing diff, both with verified fails-on-revert).

**Regression-gate evidence:** implementor `T-01 fails-on-revert` independently re-verified (the exact
line at `curatedStopHours.ts` `resolveCuratedHoursPolicy` `today` branch); tester adversarial
`T-3-01` (different angle: far-east +540 offset, end-to-end filter) `fails-on-revert verified at
cb9ccf1a1` (against a scratch revert of the same production line).

**Post-merge residuals (NOT blocking, dispatch-scoped out):**
- Edge functions are not deployed to prod (orchestrator-owned post-merge). Device "deck populates"
  smoke remains a post-merge step for the orchestrator/Seth (P4-1).
- Pre-existing CI gate `orch-0910-chat-payload-curated-aware` fails identically on `origin/main` —
  NOT introduced by ORCH-1113 (P4-2 / Discovery).

---

## 2. SC-by-SC MATRIX (spec §7 test matrix + §9 adversarial angles)

| SC / Angle | Requirement | Verdict | Evidence |
|---|---|---|---|
| §9(a) | Stale `datetime_pref` does NOT leak into a remote location's open/closed eval under `today` | **PASS** | Implementor T-01 (Brussels +120) + tester **T-3-01** (Tokyo +540, end-to-end filter). Both assert `policy.mode==='instant'` carries the LIVE clock, never the parsed stale pref; the remote card is RETAINED at its live-local noon despite a stale night/early-morning stored instant. Fails-on-revert proven. |
| §9(b) | `today` STILL drops a stop closed at the live clock now (ORCH-1061 same-day guard survives) | **PASS** | Implementor T-02 (single-stop 03:00) + tester **T-3-02** (MULTI-stop: stop0 open, downstream museum closed by projected arrival 23:45 → card dropped; control at noon → retained). The same-day arrival cascade (duration + travel accumulation) is intact. |
| §9(c) | `this_weekend` retains a Sat-only-open stop even when the stored instant is a Wed night | **PASS** | Implementor T-03/T-04 + tester **T-3-03** (Sat-only stop RETAINED while BOTH `datetimePref` (Wed night) AND a weekday `selectedDates` (Wed) are present and ignored; policy resolves to `anyHourOnDays:[6,0]`; a Tuesday-only stop is dropped). |
| §9(d) | `all_closed_at_time` fires ONLY when cards were built then all dropped — NEVER for a genuinely empty pool | **PASS** | Tester **T-3-04**: (1) empty input → empty output, no card dropped; (2) non-empty all-closed pool → empty output (the only `builtCount>0` path); (3) handler source-grep proves `builtCount=cards.length` is captured BEFORE the hours filter, the `all_closed_at_time` branch is gated `builtCount > 0`, and the branch only runs `&& !summary` (so `generateCardsForType`'s prior `pool_empty`/`no_viable_anchor` short-circuit it). Structural impossibility of a false signal confirmed. |
| §9(e) | Idempotence — re-running the filter on a passing list drops nothing | **PASS** | Implementor T-11 (all-passing) + tester **T-3-05** (stronger: MIXED list, some kept/some dropped, survivors re-filter to themselves in BOTH `instant` and `anyHourOnDays` modes). |
| §7 / extra | `pick_dates` evaluates selected weekday(s); union across multiple dates | **PASS** | Implementor T-05 (single date) + tester **T-3-06** (UNION across Wed+Sat: Sat-only retained, Fri-only dropped; `days` resolves to `[3,6]`). |
| §7 | Unknown/empty `dateOption` → live-clock instant (never the stale pref) | **PASS** | Implementor T-06 (also independently observed FAILING on the scratch revert — bonus coverage). |
| §7 | `filterCuratedByStopHours(cards, Date)` back-compat (bare Date = instant) | **PASS** | Implementor T-12 + the entire ORCH-1061 adversarial file (T-2-01..T-2-05) still pass unchanged with a bare Date. |
| Constitution #9 | Honest-unknown → OPEN preserved in the new `isStopOpenAtHourAnyTime` | **PASS** | Implementor T-11b + tester T-3-06 unit assertions; module branches mirror `isStopOpenAtHour` (ALWAYS_OPEN → true, no-data → true). |
| Wiring | Both edge fns thread `dateOption`/`selectedDates`; client services + context forward them | **PASS (source)** | discover-cards (handler + serve), generate-curated-experiences (body destructure + defensive shape), curatedExperiencesService, deckService, RecommendationsContext, SwipeableCards, type union, all 30 locale `cards.json`. Pure additive; see §3. |

---

## 3. INDEPENDENT FORENSIC CODE READING

**`_shared/curatedStopHours.ts`** (the heart of the fix):
- `resolveCuratedHoursPolicy` — `today`/`now`/empty → `{instant, utcNow: now}` (live clock, the
  root-cause fix); `this_weekend`/`weekend` → `{anyHourOnDays:[6,0]}`; `pick_dates`/`custom` →
  union of selected dates' weekdays (noon-UTC day derivation, parity with discover-cards:697-699),
  falling back to `[datetimePref]` then `[now]` only when `selectedDates` is absent; **unknown →
  safe `instant` with `now`, never the stale pref.** The normalization (`lowercase`, `-`/space →
  `_`) matches discover-cards:648. No stale `datetime_pref` path survives for `today`.
- `filterCuratedByStopHours` — accepts `CuratedHoursPolicy | Date`; a bare `Date` is coerced to
  `{instant}` (back-compat). `instant` mode = the unchanged ORCH-1061 same-day arrival cascade.
  `anyHourOnDays` mode = a non-optional stop passes iff open at any hour on any policy day
  (`isStopOpenAtHourAnyTime`); optional stops skipped; idempotent (filter is a pure predicate).
- `isStopOpenAtHourAnyTime` — same cascade branches as `isStopOpenAtHour` (always-open → true;
  no-data → true honest-unknown; business-array; periods; _periods; text), differing only in the
  "any period on this day" vs "open at this hour" predicate. **Honest-unknown (Constitution #9)
  preserved — no fabricated `closed`.**
- **Minor honest-unknown note (P4, not a defect):** for an overnight period whose `open.day` is
  the prior day (e.g. Fri 18:00→Sat 02:00), `isStopOpenAtHourAnyTime(stop, Sat)` returns false even
  though the venue is open Sat 00:00–02:00. This exactly mirrors discover-cards' `isOpenAnyTimeOnDay`
  (matches on `open.day`), so it is intentional parity, not a regression — and it errs toward
  dropping a weekend-edge stop, never toward fabricating a closure on a wrong day.

**`generate-curated-experiences/index.ts`** — `dateOption`/`selectedDates` destructured from body
with defensive shaping (`selectedDates` filtered to non-empty strings or coerced to null, same
pattern as `excludePlacePoolIds`). `builtCount = cards.length` captured before the filter;
`all_closed_at_time` only when `builtCount > 0 && !summary` — verified structurally sound (a
genuinely-empty pool returns a `summary` from `generateCardsForType` at line 1220-1236, so
`!summary` is false and the new branch is unreachable from a 0-card pool).

**`discover-cards/index.ts`** — two call sites updated: the deterministic-V2 aggregate path (uses
`dateOption:'today'` because `pg_aggregate_collab_prefs` exposes no date option — consistent with
the `today` already passed to `filterByDateTime` at line 1554) and the main serve path (reuses the
in-scope `dateOption`/`selectedDates`/`datetimePref`). **`filterByDateTime` (single-card,
non-curated reader) body and signature are UNCHANGED** — only its already-existing call line and
surrounding comments appear in the diff. Single-card behavior is unaffected.

**Client wiring** — `curatedExperiencesService` forwards `dateOption`/`selectedDates` only when
present; `deckService` threads them through and adds `all_closed_at_time` to the aggregation
precedence (`pipeline_error > no_viable_anchor > all_closed_at_time > pool_empty`);
`RecommendationsContext` surfaces `curatedEmptyReason` from `activeDeck.curatedEmptyReason` for
both solo and collab; `SwipeableCards` branches the empty-state copy to `all_closed_title`/
`all_closed_subtitle`; the type union is extended in one place and re-exported via deckService;
**all 30 locale `cards.json` files contain `swipeable.all_closed_title` + `_subtitle`** (verified —
zero missing), so no i18n missing-key crash. Collab dead-end copy still takes precedence (the new
branch only affects the plain-empty case).

---

## 4. STEP 0.5 — INDEPENDENT RE-RUN OF THE IMPLEMENTOR'S FAILS-ON-REVERT PROOF

The implementor's TRANSIENT proof commit `b87804932` reverts the `today` branch of
`resolveCuratedHoursPolicy` from `{ mode:'instant', utcNow: now }` →
`{ mode:'instant', utcNow: opts.datetimePref ? new Date(opts.datetimePref) : now }` (restoring the
pre-fix stale-pref behavior), then restores it at `28333d19c`.

I did NOT trust the claim — I reproduced it independently with my own scratch revert of the SAME
production line (backed up `curatedStopHours.ts`, applied the identical revert, ran, restored from
backup):

```
=== HAPPY-PATH against the reverted policy ===
T-01 (fails-on-revert): 'today' uses the LIVE clock, NOT the stale datetime_pref ... FAILED
T-06 (ORCH-1113): unknown/empty dateOption defaults to live-clock instant ...        FAILED
FAILED | 12 passed | 2 failed
```

T-01 fails on revert exactly as claimed (the Brussels-noon-open card is dropped because the stale
23:20 instant reads CLOSED). T-06 also fails (bonus). After `cp` restore: **25 passed | 0 failed.**

---

## 5. ADVERSARIAL TEST ADDED (tester-owned, different angle)

**Path:** `supabase/functions/_shared/__tests__/curatedStopHours.adversarial.test.ts`
**Commit:** `cb9ccf1a1` (appended T-3-01..T-3-06; additions-only — a second `import` statement at
the block head, no existing line touched).
**In closing diff:** yes — `git diff origin/main...HEAD --name-only` lists both
`curatedStopHours.test.ts` (implementor happy-path) and `curatedStopHours.adversarial.test.ts`
(tester).

| Test | Angle (distinct from implementor) |
|---|---|
| T-3-01 | Stale-pref leak at the **end-to-end filter** on a **far-east +540 (Tokyo)** offset — opposite magnitude/day-roll from the implementor's Brussels +120 policy-only test. **This is the tester fails-on-revert anchor.** |
| T-3-02 | `today` same-day drop on a **MULTI-stop** card via projected-arrival accumulation (implementor's T-02 was single-stop). |
| T-3-03 | `this_weekend` ignores BOTH `datetimePref` AND a weekday `selectedDates` simultaneously. |
| T-3-04 | `all_closed_at_time` **false-signal guard** — structural precondition + handler source-grep that the branch is gated `builtCount > 0 && !summary`. |
| T-3-05 | Idempotence on a **MIXED** list (some dropped) in both modes (implementor's T-11 used all-passing lists). |
| T-3-06 | `pick_dates` **union** across multiple selected weekdays (open-on-any → retained). |

**Passing run (full file, restored module):**
```
running 11 tests from ./functions/_shared/__tests__/curatedStopHours.adversarial.test.ts
... T-2-03 / T-2-04 / T-2-04b / T-2-05 / T-2-01 ... ok
... T-3-01 / T-3-02 / T-3-03 / T-3-04 / T-3-05 / T-3-06 ... ok
ok | 11 passed | 0 failed
```

**`fails-on-revert verified at cb9ccf1a1`** — against a scratch revert of the `today` policy line,
T-3-01 FAILED:
```
T-3-01 (adversarial): 'today' ignores the stale datetime_pref on a Tokyo +540 card ... FAILED
  => ./functions/_shared/__tests__/curatedStopHours.adversarial.test.ts:262:6
FAILED | 10 passed | 1 failed
```
(T-3-02..T-3-06 stayed green on the revert — they target other invariants, as designed; T-3-01 is
the load-bearing date-option anchor.) After restore: T-3-01 passes.

---

## 6. REGRESSION RESULTS

| Suite | Command | Result |
|---|---|---|
| Shared curated-hours (happy-path + ORCH-1113 additions) | `deno test ... curatedStopHours.test.ts` | **14 passed, 0 failed** (incl. all ORCH-1061 T-2-* + ORCH-1113 T-01..T-12, T-11b) |
| Shared curated-hours (adversarial) | `deno test ... curatedStopHours.adversarial.test.ts` | **11 passed, 0 failed** (5 ORCH-1061 + 6 tester ORCH-1113) |
| Both shared files together | `deno test ... curatedStopHours.test.ts curatedStopHours.adversarial.test.ts` | **25 passed, 0 failed** |
| `generate-curated-experiences` full suite | `deno test ... functions/generate-curated-experiences/__tests__/` | **35 passed, 0 failed** |
| `discover-cards` full suite | `deno test ... functions/discover-cards/__tests__/` | **89 passed, 0 failed** |
| `businessHoursToGoogle` (touched via the any-time branch) | `deno test ... businessHoursToGoogle*.ts` | **17 passed, 0 failed** |

- **ORCH-1061 tests pass with the surgical assertion update** — the only edit to the ORCH-1061
  adversarial file is T-2-01(c), which previously asserted the EXACT line ORCH-1113 removes
  (`datetimePref ? new Date(datetimePref) : new Date()`) and now asserts the new
  `resolveCuratedHoursPolicy({...})` wiring. Carried under commit `9a7daadfc`
  `[TEST-MOD-APPROVED ORCH-1113]`. Legitimate and necessary (the old assertion would fail forever).
- **Single-card (non-curated) behavior unchanged** — `filterByDateTime` body/signature untouched
  (diff shows only comments + its pre-existing call line). discover-cards suite green confirms.
- **No SQL / RPC / migration touched** — `git diff origin/main..HEAD --name-only` contains zero
  `.sql` / `migration` / `rpc` files. Hard constraint satisfied.

---

## 7. CONSTITUTION 14-RULE MATRIX

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive control; empty-state copy is a passive label. |
| 2 | One owner per truth | PASS | The date-option policy lives in ONE place (`resolveCuratedHoursPolicy`); both edge fns call it. T-2-05 source-grep proves no re-duplication. |
| 3 | No silent failures | PASS | Empty deck now routes to an honest `all_closed_at_time` verdict → EMPTY UI (not stuck-loading); unparseable dates skipped with a `now`-day fallback, never a crash. |
| 4 | One query key per entity | N/A | No query-key change. |
| 5 | Server state server-side | N/A | No Zustand/server-state change. |
| 6 | Logout clears everything | N/A | No auth/storage change. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional shim. |
| 8 | Subtract before adding | PASS | The fix replaces the stale-pref arg construction; it does not add a parallel path. |
| 9 | No fabricated data | **PASS** | Honest-unknown → OPEN preserved in `isStopOpenAtHourAnyTime` (T-11b, T-3-06). `all_closed_at_time` is only emitted when cards were genuinely built-then-dropped (T-3-04). No fabricated `closed`. |
| 10 | Currency-aware | N/A | No money path. |
| 11 | One auth instance | N/A | No auth. |
| 12 | Validate at the right time (user's datetime) | **PASS** | This IS the fix — `today` validates against the LIVE clock at the venue's offset, not a stale stored instant; future-day modes validate the selected weekday(s). |
| 13 | Exclusion consistency | PASS | `selectedDates`/`excludeCardIds` shaped defensively, consistent with existing patterns. |
| 14 | Persisted-state startup | N/A | No hydration-gated startup change. |

No violations → zero auto-P0.

---

## 8. DEVICE / PARITY MATRIX

| Surface | Status | Note |
|---|---|---|
| Backend — `_shared` pure functions | **PASS (proven, executed Deno)** | 25 + 35 + 89 + 17 tests green; fails-on-revert proven on both the implementor's and the tester's anchor. This is the dispatch's designated runtime-evidence bar (the policy is pure-function testable). |
| Edge fn deploy state (discover-cards, generate-curated-experiences) | **N/A — not deployed (orchestrator post-merge)** | Dispatch explicitly scopes deploy out; device "deck populates" is a post-merge smoke for the orchestrator/Seth. |
| Consumer iOS / Android (deck populates in remote tz) | **DEFERRED (post-merge)** | Requires the edge-fn deploy; source-verified client wiring only (suspected-ceiling on UI runtime — correctly NOT claimed as proven). |
| Buyer/anon Web · Business iOS/Android · Admin Web · Business Web preview | **N/A** | Change does not ship to these surfaces (curated consumer deck only). |

Parity skips are all "does not ship there" or "deploy is orchestrator-owned post-merge", per the
dispatch — not "code looks the same."

---

## 9. DISCOVERIES FOR ORCHESTRATOR

- **P4-2 / PRE-EXISTING CI GATE (not an ORCH-1113 regression):**
  `.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` FAILS with 1 violation
  (`FAIL buildCardDataPayload synthesizes curated image and images from stops`). **Independently
  confirmed to fail IDENTICALLY on `origin/main`** (ran the gate in a clean `git worktree add
  origin/main`): same single violation, same message. The gate script is byte-identical between
  `origin/main` and ORCH-1113 HEAD (no diff). This predates ORCH-1113 and should be triaged as its
  own item — it does not block this merge.
- **P4-1 / POST-MERGE SMOKE:** after the orchestrator deploys both edge fns from MERGED main,
  do one device smoke that a remote-timezone curated deck (the original Brussels reproducer) now
  populates under "Today", and that an all-closed late-night deck shows "Everything's closed right
  now." The policy is proven in unit tests; this is confirmation of the end-to-end deploy + client
  copy render only.

## 10. ACCEPTED CONDITIONS

None — this is an unconditional PASS (zero P0, zero P1).
