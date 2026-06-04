# QA — ORCH-1065 [consumer-experience-deck-card]

**Mode:** TEST (mingla-forensics TEST / TARGETED) — adversarial regression + static layer ONLY
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1065-[consumer-experience-deck-card]/` on branch `ORCH-1065-consumer-experience-deck-card`
**Base:** `origin/main` `b9d272156`
**Implementation under test:** commit `6b2c97f45` (+ artifacts `f2924a69b`)
**Date:** 2026-06-03
**Inputs read in full:** SPEC_ORCH-1065, IMPLEMENTATION_ORCH-1065, the migration, the edited `discover-cards/index.ts`, `deckService.ts`, `SwipeableCards.tsx`, `CuratedExperienceSwipeCard.tsx`, all 4 implementor test files.

**Comms-ledger acks (this turn):**
- COMMS-0018 (WARN, META-ORCH-1009) — the venue→deck `place_pool`/`ai_signal_scores`/`run-signal-scorer` `signal_id` bug. ORCH-1065's supply seam deliberately BYPASSES that path. I independently re-proved the bypass holds (T-09+) AND that it fails-on-revert when a `place_pool` ref is injected. acked.
- COMMS-0002 (WARN, ALL) — new backend file (my adversarial supply test under `supabase/functions/`) added to the ORCH-0863 C7 `ORCH_1065_BACKEND_ALLOWLIST` in the SAME commit. C7 re-verified green. acked.
- COMMS-0014/0016 (re-homed) — no parallel money fn; I added an independent directory-scan guard and proved it fails-on-revert. acked.
- COMMS-0003 (WARN, ALL) — no new external-API surface in my tests; the migration's doc citations were verified present. acked (N/A to test authoring).

---

## VERDICT (unit + static layer): **PASS**

> Scope of this verdict is the **adversarial regression test set + static verification ONLY**. On-device LIVE-FIRE (SC-2 deck render on iOS/Android, SC-9 Book→PaymentSheet) is **PENDING** and is **NOT a failure of the code** — it is blocked on a program-wide migration-history drift that prevents applying the ORCH-1065 RPC to remote (orchestrator escalating to operator). See "Live-fire status" below.

- **P0:** 0  |  **P1:** 0  |  **P2:** 0  |  **P3:** 1  |  **P4:** 2
- Implementor's 21 Deno tests: **21 passed / 0 failed** (re-run independently at `6b2c97f45`).
- Tester adversarial tests: **31 passed / 0 failed** (new, this pass).
- 4 LOCKED fails-on-revert proofs (interleave/expand-routing/no-parallel-money-fn/COMMS-0018): all re-confirmed (implementor's set) + 2 independently re-proven by me + 2 additional exclusion-gate proofs.
- `deno check` on `discover-cards/index.ts`: clean (exit 0).
- `tsc --noEmit` on the 3 touched app-mobile files: zero errors in any of them.
- ORCH-0863 C7 strict-grep gate: **PASS** (zero offenders).
- Append-only test gate: my 3 files are all status `A` (added) → ALLOWED; the `.mjs` allowlist edit is not a test file.

---

## 1. RE-RAN IMPLEMENTOR SUITE (requirement 1)

`deno test --allow-read --no-check` over the 4 implementor files:

```
ticket-checkout-create/__tests__/orch1065_experience_checkout.test.ts   3 ok  (T-08a/b/c)
discover-cards/__tests__/orch_1065_experience_supply.test.ts            8 ok  (T-01a..e, T-05, T-09-guard, grant)
components/__tests__/orch1065_experience_expand.test.tsx                5 ok  (T-03a..d, T-12/SC-13)
services/__tests__/deckService.orch1065.test.ts                        5 ok  (T-02a..e)
TOTAL: 21 passed | 0 failed
```

**4 LOCKED fail-on-revert tests at `6b2c97f45`** (dispatch requirement) — the implementor's quartet, all still present and green:
- **interleave** → T-01b (`cards: mergedCards` from `interleaveExperiencesIntoDeck(finalCards, experienceCards)`).
- **expand-routing** → T-03c/T-07 (`kind: "businessEvent"`, experience branch precedes curated).
- **no-parallel-money-fn** → T-08c (no `experience-checkout-*` fn).
- **COMMS-0018 bypass** → T-09-guard (supply block grep-clean of `place_pool`/`ai_signal_scores`/`run-signal-scorer`/`session_deck_cards`).

I independently re-proved two of these fail-on-revert (see §3) rather than trust the implementor's claim.

---

## 2. ADVERSARIAL TEST SET (requirement 2) — real paths, distinct failure modes

Each attacks a DIFFERENT failure mode than the implementor's happy-path grep assertions. Where the implementor only grep-asserted a seam EXISTS, I ported the pure logic and RAN it against adversarial inputs, and I added negative/boundary/error-path cases the happy path cannot exercise.

### File A — `supabase/functions/discover-cards/__tests__/orch1065_experience_supply_adversarial.test.ts` (15 tests)
| Test | Failure mode attacked | Angle vs implementor |
|---|---|---|
| interleave-pin | anti-drift guard for the ported helper | new |
| T-11a (exec) | empty pool + experiences ⇒ experiences (never `[]`), order preserved | **executable** (impl only grep'd) |
| ADV interleave additive | every place card preserved, additive sum | **executable** |
| ADV interleave dedupe | duplicate experience ids collapse to one | **executable** |
| ADV interleave exclude-self | experience id colliding with a place id is dropped (no double-render) | **executable, new boundary** |
| ADV interleave spacing | experiences spread, not clustered at head | **executable, new** |
| ADV interleave identity | zero experiences ⇒ place deck unchanged | **executable** |
| **T-04** | past/ended experience NEVER surfaces — strict `end_at > p_now`, not `>=`, not `start_at` | **new exclusion gate** |
| **T-06** | geo: upper-bound `<= p_radius_m`, null-coord stops excluded, real haversine | **new exclusion gate** |
| T-06b (exec) | haversine metric sanity (near in / far out, DC↔Baltimore) | **executable, new** |
| **T-10** | source-failure tolerance — catch only warns, no re-throw, no pool-empty (INV-042) | **new error path** |
| **T-11b** | empty pool + experiences ⇒ explicit populated `path:'pipeline'` (INV-043), pool-empty fallback intact | **new** |
| **T-09+** | COMMS-0018 bypass across supply block AND hoisted call site, case/sep-insensitive | **deeper than impl T-09-guard** |
| ADV no-parallel-money-fn | directory scan for any `*experience*checkout/create/payment*` fn (COMMS-0014/0016) | **new, independent of impl T-08c** |
| ADV migration safety | RPC is read-only (no DML), STABLE, search_path-hardened, no anon, REVOKE present | **new security** |

### File B — `app-mobile/src/services/__tests__/deckService.orch1065_adversarial.test.ts` (8 tests)
| Test | Failure mode attacked |
|---|---|
| ADV pin | anti-drift for ported stopLabel + distance-gate logic |
| **T-12a (exec)** | single-stop experience labels lone stop `Start Here`, NOT `End With` (guard-order boundary) |
| ADV multi-stop labels (exec) | first/middle/last label derivation |
| **T-12b (exec)** | zero/absent distance renders NO badge — no fabricated `0.0 km` (Constitution #9) |
| T-12c | non-string brand logo stays `null` (honest monogram fallback, no fake logo) |
| ADV id coercion (exec) | `id`/`eventId` fallback is string-safe (never `undefined` deck key) |
| **T-13-adv (exec)** | an experience envelope is claimed by `isExperiencePayload`, NOT `isCuratedPayload` (it structurally looks curated — order is load-bearing) |
| T-13-adv pin | experience dispatch precedes curated (fails-on-revert) |

### File C — `app-mobile/src/components/__tests__/orch1065_experience_adversarial.test.tsx` (9 tests)
| Test | Failure mode attacked |
|---|---|
| **T-07-adv early-return** | experience expand branch EARLY-RETURNS — cannot fall through to curated/place (impl only checked branch ORDER, not the `return`) |
| **T-07-adv target precedence** | `businessEvent` target STRICTLY precedes `nightOut` — an experience with a stale `selectedCardForExpansion` still opens the business sheet |
| **T-07-adv no curated route** | experience branch never calls `setSelectedCardForExpansion` (no curated itinerary) |
| T-07-adv close hygiene | close handler clears the experience state (no stale leak across opens) |
| **T-13-adv curated clean** | curated/default render branches receive NO `brandExperience`/`ctaOverride` |
| T-13-adv prop-gated | chip + Book CTA gated on optional props; CTA falls back to exact curated copy |
| **T-12-adv monogram** | monogram fallback reachable for null/failed logo, `onError` path, band-clamped hue (no AI-slop gradient) |
| T-12-adv a11y | Book CTA has contextual `accessibilityLabel`, ≥44pt touch target |
| ADV discriminator integrity | renderer keys on `=== 'experience'`, not a loose truthy `brandName &&` probe |

**Adversarial result:** 31 passed / 0 failed.

---

## 3. FAILS-ON-REVERT EVIDENCE (requirement 2 — proven, not claimed)

All four performed by mutating source/dirs, running the targeted test, confirming RED, then restoring (git-verified byte-clean after each).

| Invariant | Revert applied | Test | Result |
|---|---|---|---|
| **COMMS-0018 bypass** | injected `const _leak = args.supabaseAdmin.from("place_pool")` into the supply block | T-09+ | **RED** (1 failed) → restored → green |
| **no-parallel-money-fn** | created `supabase/functions/experience-checkout-create/index.ts` | ADV no-parallel-money-fn | **RED** (1 failed) → restored → green |
| T-04 future-date gate | changed `ed.end_at > p_now` → `>= p_now` (would surface just-ended) | T-04 | **RED** (1 failed) → restored → green |
| T-06 geo gate | flipped `) <= p_radius_m` → `) >= p_radius_m` (inverts radius) | T-06 | **RED** (1 failed) → restored → green |

Verbatim evidence captured in the session transcript. After each revert+restore: `git diff --stat <file>` returned empty (byte-clean).

The two dispatch-mandated proofs (COMMS-0018-bypass + no-parallel-money-fn) are the first two rows — both proven RED-on-revert by independent tester-authored assertions, not the implementor's.

---

## 4. STATIC VERIFICATION (requirement 3)

| Check | Command | Result |
|---|---|---|
| Edge fn typecheck | `deno check supabase/functions/discover-cards/index.ts` | **clean** (exit 0) |
| App-mobile typecheck | `npx tsc --noEmit`, filtered to the 3 touched files | **zero errors** in `deckService.ts`, `SwipeableCards.tsx`, `CuratedExperienceSwipeCard.tsx` (pre-existing baseline noise in unrelated files only, per impl §9 — confirmed) |
| Strict-grep C7 | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | **PASS** — C1–C7 all OK, C7 "zero touches under supabase/… (offenders: none)" |
| Append-only test gate | `.github/scripts/test-append-only-check.js` (logic verified) | my 3 files are status `A` → ALLOWED; the `.mjs` allowlist edit is not a test file (no `.test.*`/`.spec.*`/`__tests__/` match) |

My new adversarial backend test (`discover-cards/__tests__/orch1065_experience_supply_adversarial.test.ts`) was added to `ORCH_1065_BACKEND_ALLOWLIST` in the SAME commit (COMMS-0002). The two app-mobile adversarial tests are under `app-mobile/` (not backend) — no allowlist needed.

---

## 5. CONSTITUTION (relevant rules)

| Rule | Verdict | Evidence |
|---|---|---|
| #1 no dead taps | PASS | Book CTA has handler + a11y label + 44pt target (T-12-adv). |
| #2 one owner per truth | PASS | `expandedBrandExperience` is a dedicated state; experiences can't fall into the curated/place authority (T-07-adv early-return). |
| #3 no silent failures | PASS (with note) | experience-source failure is INTENTIONALLY swallowed (best-effort, warns) — this is INV-042-correct, NOT a silent product failure; the place deck still serves (T-10). |
| #9 no fabricated data | PASS | rating/reviewCount honest 0; null logo → monogram never fake; distance 0 → NO `0.0 km` badge (T-12b/c). |
| #13 exclusion consistency | PASS | the RPC's future-date + geo + sellable gates are the generation-time exclusion; the deck never serves an ineligible experience (T-04/T-05/T-06). |

---

## 6. DISCOVERIES FOR ORCHESTRATOR

- **P3 — `CuratedStop.distanceFromUserKm` is typed non-nullable (`number`), so the converter coalesces honest-null server distance to `0` (deckService.ts:303-304), NOT `null`.** This is reconciled at the DISPLAY layer (line 347 gates the badge on `> 0`, so a 0 shows NO badge — honest), so it is **not fabrication** and **not a P1/P2**. But the SPEC §3.3 text says "honest null from server," and the underlying stop object carries `0` not `null`. If any future consumer reads `stop.distanceFromUserKm` directly and treats `0` as "at the venue," it would be wrong. Recommend the `CuratedStop` type allow `number | null` for these two fields in a follow-up so the honest-null survives to the data layer, not just the display gate. Proven non-fabricating today by T-12b. (No code change required for ORCH-1065 close.)
- **P4 — Migration filename deviation is correct.** The SPEC §3.2 locked `20260901000000`; that prefix is taken by ORCH-1064 on this base and remote head is `20260902000000`. The implementor's `20260903000000` is the correct monotonic choice. Verified the file exists and the test references match.
- **P4 — Geo mechanism deviation is correct.** `earthdistance`/`cube` are not installed; the SPEC's D3 fallback (plain-SQL haversine) is the authorized path and matches the existing `query_servable_places_by_signal` pattern. T-06b proves the metric is sane.
- **No live published experiences exist in prod yet** (impl §9). LIVE-FIRE requires a seeded published-live experience + the migration applied + edge deployed — all blocked this pass (see below).

---

## 7. LIVE-FIRE STATUS — **PENDING (not a failure)**

The on-device LIVE-FIRE leg (SPEC §7; SC-2 iOS+Android deck render, SC-9 Book→PaymentSheet) was **NOT attempted this pass and is explicitly DEFERRED**, per the dispatch. It is blocked on a **program-wide migration-history drift** that prevents applying the ORCH-1065 RPC (`pg_eligible_experiences_for_deck`) to remote — the orchestrator is escalating that to the operator. Per the tester constitution Rule 13, the tester does NOT apply migrations. Without (a) the migration applied, (b) `discover-cards` deployed, (c) a seeded published-live experience, the card cannot be observed on-device.

This is a **deploy/data blocker, not a code defect.** The code-and-contract layer is PASS. When the migration-apply is unblocked, the live-fire leg must run on iOS sim + Android emulator with `proven`-level evidence (Prime Directive 7) before a full PASS that authorizes CLOSE. Until then this verdict is **PASS on the unit + static layer with live-fire PENDING** — it is NOT a CONDITIONAL PASS on a P1, because there is no open P1; the only outstanding item is the externally-blocked runtime proof.

---

## 8. ADVERSARIAL TEST PATHS + COMMIT

- `supabase/functions/discover-cards/__tests__/orch1065_experience_supply_adversarial.test.ts`
- `app-mobile/src/services/__tests__/deckService.orch1065_adversarial.test.ts`
- `app-mobile/src/components/__tests__/orch1065_experience_adversarial.test.tsx`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (allowlist +1 backend test file, COMMS-0002)

Commit hash: **`33f1c62f7`** on branch `ORCH-1065-consumer-experience-deck-card` (tests are byte-identical to the earlier `7970dbda3`; this hash is the final amended commit carrying the QA report).

Post-commit gate re-verification: ORCH-0863 C7 = PASS (18 files, zero offenders); append-only gate = 7 ADDED, 0 failed; full ORCH-1065 unit suite = **53 passed / 0 failed** (21 implementor + 32 adversarial).
