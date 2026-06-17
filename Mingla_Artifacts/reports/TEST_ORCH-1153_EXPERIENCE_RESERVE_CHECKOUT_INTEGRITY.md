# TEST — ORCH-1153 [experience-reserve-checkout-integrity]

**Skill:** mingla-tester (Claude). **Date:** 2026-06-17.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1153-[experience-reserve-integrity]` on branch `ORCH-1153-experience-reserve-integrity`, HEAD `d5a217d00` (matches the dispatched OTA commit).
**Prod project:** `gqnoajqerqhnvulmnyvv` (Mingla-dev, active env). Migrations applied; discover-cards edge fn v349 deployed; client OTA'd to DEVELOPMENT channel.
**Comms acked:** none OPEN/BLOCK for tester/1153/ALL (max id COMMS-0035; no 1153 mention). COMMS-0013/0014/0018 (WARN) factored. **New discovery → DISC-1153-T1 (fixture SQL bug) — see Discoveries.**

---

## 1. VERDICT

**CONDITIONAL PASS** — 0 P0, 0 P1, 1 P2 (fixture-SQL bug, not product code), 2 P3.

All seven dispatched criteria are PROVEN at the DB / edge / source / unit-test layer with live-fire evidence. The single reason this is not a clean PASS: the consumer + business **UI/runtime** surfaces (Reserve verb on the consumer screen, the open-daily picker rendering, the price on the OTA'd business /exp route) were NOT driven on a device/sim in this run — those are explicitly device-only checks that remain for Seth, and the tester Constitution forbids a source-only PASS on a UI/runtime change. The web /exp price fix is merge-gated off Vercel (stated in the dispatch). Every backend/contract claim is `proven`; the UI claims are `suspected` pending the device pass.

**P0–P4:** P0 = 0 · P1 = 0 · P2 = 1 · P3 = 2 · P4 = 2.

---

## 2. Criterion-by-criterion matrix

| # | Criterion | Verdict | Evidence (live-fire) |
|---|---|---|---|
| 1 | Casualty repaired + public read bookable | **PASS** | `event_dates` for `b8bd995b…` = **52 total / 51 future / 1 master** (was 1 total/0 future). Event row: daily/never, status=scheduled. Public read: brand `lanternvine`, slug `raleigh-wine-and-dine-crawl`, public, **51 future** via the same `event_dates` query `publicExperienceService.ts:466-469` uses → `allDatesPast()=false`, `bookableDates()` returns future occurrences → NOT sold-out, date picker populated. |
| 2a | Pass-fee fixture applied | **PASS** | Applied (corrected — see DISC-1153-T1). brand `9bdeb57a-c46e-413f-b459-1ffb8b3ea435` / slug `orch-1153-pass-fee-qa-50e0fd65`; event `229ff02a-9104-46bc-8f81-c6fa4f651773` / slug `orch-1153-pass-fee-tasting-crawl-33c703cd`; ticket `99bdee8e-357d-4df5-af15-7f2c1c2d80e0` (base 5000). pass_mingla_fee=true (event + brand default), take_rate_bps_override=1000 (10%). |
| 2b | Server all-in non-zero fee | **PASS** | `SELECT * FROM pg_public_event_tier_allin('229ff02a…')` → **base_cents=5000, all_in_cents=5500** (differ by 500 = $5.00; non-zero). |
| 2c | Display === all-in (no 100×) | **PASS (source+unit)** | `publicExperienceService.ts:358-362` `priceAllInGbp = allInCents/100` = 55.0 (major). `/exp` `:301-306` `expDisplayCents = round(55.0*100) = 5500` = all_in_cents exactly. `formatExpPrice` `:561` ÷100 → $55.00. `ExperienceCheckoutFlow.tsx:101-104` identical. Absorb/RPC-miss fallback → `priceCents`. Jest 5/5 + adversarial 10/10. |
| 2d | Displayed === CHARGED | **PASS (code-trace + live RPC inputs)** | Checkout `resolve_event_pricing_inputs('229ff02a…')` live → pass_mingla_fee=true, effective_take_rate_bps=1000 (SAME inputs as the display RPC). `computeBuyerSubtotal` `allInPricingEngine.ts:178-189` = base + round(base*bps/10000) = **5500** = `unit_amount` charged (`ticket-checkout-create:1096`). Same formula as `compute_all_in_cents`. Real PaymentSheet not completed (fixture `stripe_account_id` null → no connected account; charge AMOUNT math is proven, no real money). |
| 2e | Absorb-fee unchanged | **PASS** | Fallback `:306` returns `priceCents` when all-in absent/0/===base. Jest "absorb-fee renders identically" + adversarial "absorb-fee === bare base" both pass. |
| 3 | Reserve verb + 3 gates | **PASS (source+gates)** | Consumer `ConsumerExperienceDetailScreen.tsx:412-413` `buyVerb:"Reserve"`, `freeVerb:"Reserve"`. `/exp` CTA strings "Reserve". "Get my spot"/"Buy ticket"/"Get free ticket" only in comments. 3 strict-grep gates (reserve-verb, no-bare-base, opendaily-one-owner) all **exit 0**. (Device render = remaining check.) |
| 4 | Open-daily one owner + recurrence on supply | **PASS** | Shared `packages/event-rendering/experienceOpenDaily.ts` `isOpenDailyExperience` consumed by both apps (web `/exp:47,102-106`; consumer `:57,381`). Consumer density heuristic `isOpenDailyModel` `@deprecated`. Both deck-supply RPCs carry `is_recurring`+`recurrence_rules` (RETURNS TABLE). **Live RPC** `pg_eligible_experiences_for_deck(Raleigh, 'first-date')` returns `is_recurring=true, recurrence_rules={daily,never}` for casualty + QA fixture. discover-cards v349 maps `isRecurring`/`recurrenceRule`. All 4 consumer seed-mapper hops plumb the fields. Detector deno test 5/5. |
| 5a | Cron exists | **PASS** | `cron.job` → `orch-1153-topup-recurring-experiences`, schedule **`0 9 * * *`**, active=true, cmd `SELECT public.pg_topup_recurring_experiences(14)`. |
| 5b | Drain guard in RPCs | **PASS** | `biz_publish_experience` + `biz_update_live_experience` both contain `recurring_experience_has_no_future_occurrences` RAISE + ORCH-1153 markers (live `pg_get_functiondef`). Guard condition: `IF NOT EXISTS(future dates) AND NOT pg_recurrence_is_terminated(rule)` → RAISE. Termination helper proven correct (never→false, until-past→true, until-future→false). |
| 5c | 0 drained recurring | **PASS** | Only 2 scheduled recurring experiences exist; both 51 future. Zero drained. |
| 6 | Both regression tests exist + pass + fails-on-revert | **PASS** | Implementor: `orch1153ExperienceAllInDisplay.test.ts` jest **5/5**; fails-on-revert RE-RUN by tester at HEAD `d5a217d0` → revert to `priceCents` = **1 failed/4 passed** + gate trips; restore = 5/5. Tester adversarial: `orch1153AllInChargeParityAdversarial.test.ts` jest **10/10** (different angle: formula-level + boundary sweep); fails-on-revert = inject 100× → **8 failed/2 passed**; restore = 10/10. Both on-branch + in closing diff. |
| 7 | No ORCH-1148 regression | **PASS** | Migrations 20261010000000-3 + 20261011000000-1 ALL present in `supabase_migrations.schema_migrations` on prod. 1153's 20261009000000-3 applied above them; monotonic; no clobber. (1138-rework 20261007000000 also now applied → DISC-1153-D / COMMS-0036 concern resolved.) |

---

## 3. Findings

### P2-1 (DISC-1153-T1) — the shipped fixture SQL `ORCH-1153_PASS_FEE_FIXTURE.sql` does NOT run as written
- **Evidence:** the fixture's `brands` INSERT sets `pass_mingla_fee/pass_service_fee/pass_tax` — those columns live on **`events`** (+ `brands.default_pass_*`), NOT `brands` (`information_schema.columns`). It also omits `brands.account_id` (NOT NULL) and `events.created_by` (NOT NULL), and never sets the pass toggle on the EVENT row (where `pg_public_event_tier_allin` reads it first). Running it verbatim errors `column b.pass_mingla_fee does not exist`.
- **Impact:** anyone re-running the fixture file as committed gets a hard failure; worse, even if the brand insert were fixed, with no event-level toggle the all-in would equal base (the WS3 proof would silently show zero fee).
- **Required fix:** update the fixture to (a) insert `default_pass_mingla_fee` on `brands` + `account_id`, (b) set `pass_mingla_fee=true` on the `events` row, (c) set `events.created_by`, (d) optionally `take_rate_bps_override` for a crisp non-trivial fee. The tester applied a corrected inline version (recorded in §2 row 2a) to complete the proof.
- **Retest:** re-run the corrected fixture; `pg_public_event_tier_allin` must return all_in_cents > base_cents.
- **Routing:** not product code (a test fixture). Route to implementor to correct the committed `.sql` before CLOSE, or orchestrator updates it.

### P3-1 — SQL probe `orch_1153_recurrence_topup_backfill.test.sql` remains hand-run, never executed in CI
- **Evidence:** implementor report §6 marks it "hand-run post-apply… UNVERIFIED until applied." The tester executed its core invariants live (termination helper, top-up idempotency, top-up forward-fill, drain-guard predicate) against prod in rolled-back transactions — all PASS — but the .sql file itself was not piped through psql.
- **Impact:** low; the invariants are independently proven. The file is a manual artifact, not a gated test.
- **Required fix:** none blocking. Optionally wire into a DB CI step later.

### P3-2 — fixture brand has no Stripe connected account (`stripe_account_id` null)
- **Evidence:** `pg_brand_can_charge('9bdeb57a…')`-gated supply (the deck RPC excludes it). The charge-amount math is fully proven via `resolve_event_pricing_inputs` + the engine; an actual PaymentSheet round-trip cannot complete.
- **Impact:** none on the WS3 proof (display===charged is arithmetic, proven). A live end-to-end PaymentSheet charge with a non-zero fee remains unexercised.
- **Required fix:** to do a true device PaymentSheet charge, point the fixture brand at the sandbox `acct_1TTnt1` connected account (test mode). Optional.

### P4 (praise)
- The single-owner all-in contract held end-to-end: display RPC and checkout engine read the SAME event-level pass-toggle + take-rate and apply the SAME `base + round(base*bps/10000)` formula. No parallel price path.
- The top-up is genuinely idempotent + forward-only + 52-capped, proven live (drain to 5 → top-up → 52, zero duplicate (event_id,start_at)).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out branch HEAD **`d5a217d00`** (the OTA'd commit).
- Ran `mingla-business/__tests__/orch1153ExperienceAllInDisplay.test.ts` → **5 passed**.
- True line-deletion of the WS3 fix in `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` (reverted `expDisplayCents` from `Math.round(ticket.priceAllInGbp * 100)` to `ticket.priceCents`) → jest **1 failed / 4 passed** (the "applies the all-in ×100 transform" source-contract case failed) AND strict-grep `orch-1153-no-bare-base-under-allin` **failed** ("no reference to ticket.priceAllInGbp — reverted to bare base").
- Restored the source → jest **5 passed**, gate passed. Working tree confirmed clean (`git status --porcelain` empty).
- Deno detector test `packages/event-rendering/__tests__/orch1153OpenDailyExperience.test.ts` → **5 passed** (implementor's claimed fails-on-revert at `2ff8eaf43` accepted; not re-line-deleted, the jest revert above is the load-bearing proof).

**Implementor fails-on-revert: CONFIRMED at `d5a217d0`.**

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `mingla-business/__tests__/orch1153AllInChargeParityAdversarial.test.ts`
- **Commit:** on branch `ORCH-1153-experience-reserve-integrity` (added this run); appears in `git diff origin/main...HEAD --name-only`.
- **Angle (distinct from implementor's hardcoded-value display test):** replicates BOTH the server all-in engine formula and the page display transform as two independent code paths, then asserts `displayed === charged` across a SWEEP of boundary prices (rounding edges: 9999/12345/99999 cents; fee-rounds-to-zero: 1 cent; the live fixture 5000) + absorb-fee no-regression + RPC-miss fallback + a major-units round-trip drift loop to 200000 cents.
- **Run:** `npx jest` → **10 passed**.
- **Fails-on-revert verified:** injecting the 100× units bug (treat `priceAllInGbp` as cents, drop the `*100`) → **8 failed / 2 passed**; restored → 10/10.

---

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A (runtime) | Reserve CTA wiring present in source; device tap proof = remaining check. |
| 2 | One owner per truth | **PASS** | Open-daily: single shared `isOpenDailyExperience`. Price: single all-in RPC chain. Top-up: drain guard keeps publish-time materialization authoritative. |
| 3 | No silent failures | **PASS** | `edit.tsx` adds `console.warn` on null parsed rule; drain guard RAISEs explicitly; backfill RAISE NOTICE per row. |
| 4 | One query key per entity | N/A | No new query keys. |
| 5 | Server state server-side | **PASS** | No Zustand additions; recurrence rides server payload. |
| 6 | Logout clears | N/A | Untouched. |
| 7 | Label `[TRANSITIONAL]` | **PASS** | None introduced (implementor §10). `isOpenDailyModel` marked `@deprecated` with exit (retired as owner). |
| 8 | Subtract before adding | **PASS** | Density heuristic retired as the open-daily owner when adding the rule-based one. |
| 9 | No fabricated data | **PASS** | Backfill re-anchors REAL master forward; never fabricates geo (publish blocked w/o stop addresses); honest empty defaults in deck RPC. |
| 10 | Currency-aware | **PASS** | all-in RPC returns currency; display uses `ticket.currency`; engine currency-neutral minor units. |
| 11 | One auth instance | N/A | Anon /exp page does not call useAuth (preserved). |
| 12 | Validate at right time | **PASS** | Termination/until evaluated at `now()` with event timezone on master. |
| 13 | Exclusion consistency | **PASS** | Top-up + deck eligibility both respect deleted_at + status + termination. |
| 14 | Persisted-state startup | N/A | No persisted client state change. |

No constitutional violation found.

---

## 7. Device / parity matrix

| Surface | Layer proven | Device/runtime | Verdict |
|---|---|---|---|
| Buyer Web `/exp/` | backfill data (applied), all-in source | **NOT driven**; price fix is **merge-gated off Vercel** (per dispatch) — visual price verification is post-merge. Backfill (data) IS live on prod so future dates show even on current web. | CONDITIONAL (post-merge web eyeball) |
| Business iOS `/exp/` (OTA'd) | source has WS3 price + Reserve | **NOT driven on sim/device** this run | CONDITIONAL (device check remains) |
| Business Android `/exp/` (OTA'd) | same | **NOT driven** | CONDITIONAL |
| Consumer iOS | verb + open-daily source + live deck recurrence | **NOT driven**; physical iPhone is human-in-the-loop (Seth) | CONDITIONAL (device check remains) |
| Consumer Android | same | **NOT driven** | CONDITIONAL |
| Admin Web | n/a (no buyer reserve) | skip + reason | N/A |
| Business Web preview | n/a | skip + reason | N/A |
| Edge: discover-cards | **v349 ACTIVE** on prod, maps recurrence (verify_jwt=true) | live-confirmed | PASS |
| DB: migrations 20261009000000-3 | applied on prod | live-confirmed | PASS |

**Why no sims this run:** the dispatch directed DB/edge/source verification + the fixture proof + gate/test runs; it did not request sim driving, and the physical iPhone requires Seth. UI/runtime PASS is therefore withheld (Constitution: no source-only PASS on UI). These are the explicit device-only checks for Seth (§9).

---

## 8. Discoveries for Orchestrator

- **DISC-1153-T1 (P2):** the committed fixture SQL is broken (brands vs events column placement + NOT NULL omissions + missing event-level toggle) — corrected inline by the tester to complete the proof; the committed file should be fixed before reuse. Details in P2-1.
- **DISC-1153-D / COMMS-0036 (from implementor) — RESOLVED on prod:** `20261007000000_orch_1138_rework_deck_supply.sql` IS now present in `schema_migrations` on prod (applied ahead of 1153's `…000003`), so the latent deck/venue supply shape concern is closed for this env. Orchestrator may close COMMS-0036 as resolved (verify consumer deck/venue cards render post-OTA as the residual check).
- **Fixture lifecycle:** the pass-fee fixture is a TEST-mode synthetic brand/event on the active dev project. **Recommendation: KEEP it** — it is the only artifact that makes WS3 displayed===charged provable (0/8 live brands pass fees) and the tester will need it again for the device PaymentSheet check. Teardown when ORCH-1153 fully closes via the SQL in the fixture header (soft-delete event + brand). If kept, it will surface as a deck card only after a sandbox `stripe_account_id` is attached (currently gated off by `pg_brand_can_charge=false`, so it does NOT pollute live supply).

---

## 9. Device-only checks that remain for Seth

1. **Consumer app (iOS/Android, dev channel, runtime 1.1.0):** open an experience (e.g. the backfilled Raleigh Wine and Dine Crawl on the Discover deck) → the reserve CTA must read **"Reserve"** (paid AND free), and a daily/never experience must open the **date → time-in-window → party-size** picker (open-daily), matching `/exp/`.
2. **Business app /exp route (OTA'd, runtime 1.0.0):** open `/exp/orch-1153-pass-fee-qa-50e0fd65/orch-1153-pass-fee-tasting-crawl-33c703cd` → headline + Reserve CTA must show **$55.00** (= all-in), and the cart Total must equal $55.00 (no jump from $50.00).
3. **Web /exp price:** verify AFTER the branch merges to main and Vercel deploys (price fix is merge-gated; backfill bookability already live).
4. **(Optional) live PaymentSheet charge:** attach sandbox `acct_1TTnt1` to the fixture brand, then run a test-mode reserve to confirm the charged amount is $55.00.

---

## 10. Routing

CONDITIONAL PASS with the device checks (§9) + the P2 fixture-file fix as conditions. **Per tester rules, a CONDITIONAL PASS with unaccepted conditions does NOT auto-route to CLOSE** — surface to Seth: either (a) Seth/tester runs the §9 device passes and the P2 fixture fix lands → upgrade to PASS → CLOSE; or (b) Seth explicitly accepts the device checks as deferred follow-ups → CLOSE with documented conditions. No P0/P1 blocks.
