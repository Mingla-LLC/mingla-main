# TEST — ORCH-1331 [partner program Nigeria/Paystack payout rail]

- **Date:** 2026-07-11
- **Mode:** TARGETED + SPEC-COMPLIANCE + SECURITY (mingla-tester adversarial pass)
- **Against:** SPEC @ `37df6bfbc` + DESIGN @ `c8b4d6d43` + IMPLEMENTATION report; implementation HEAD `0e2b5f1aa`; tester tests at `6c46a478f`
- **Working tree:** `~/Desktop/mingla-orchs/orch-1331-[partner-paystack-rail]/` on branch `orch-1331-partner-paystack-rail`
- **Verification cap (BINDING, per SPEC §Verification cap):** Paystack is LIVE (real money) — every Paystack/network surface was mocked; ZERO live Paystack calls, NO migration apply, NO deploys. **The ceiling for this ORCH is PASS (mocked) + post-deploy live smoke (Seth's, SPEC §11).** This verdict is issued under that cap.

---

## 1. VERDICT

**FAIL** — routes to REWORK (mingla-implementor).

**Finding counts: 1 × P1 · 2 × P2 · 3 × P3 · 2 × P4 (praise). Zero P0.**

One P1 blocks CLOSE: the async transfer-failure retry path never actually retries (SC-9 broken end-to-end; proven RED at runtime by tester test DP-7). Everything else on the rail held under attack — all double-pay seams, the constitutional fail-soft contract at three different throw stages, money math at every kobo boundary, rail exclusivity in BOTH directions at runtime, PII discipline including the log-line clause, RLS/grant/idempotency armor in the migration, and the client form's full state machine under a real RTL mount. The fix is small and precisely located; DP-7 goes green with it and this becomes **PASS (mocked)** on retest.

---

## 2. SC-by-SC matrix

| SC | Verdict | Evidence (tester-independent runtime unless noted) |
|---|---|---|
| SC-1 picker NG + fork + non-partner card | PASS (capped) | Implementor T-16 source contract re-run 20/20; form-level runtime: tester R-9/R-10 (RTL mount). Earnings SCREEN not mounted (no RTL harness for the full screen) and no sim run — screen-level render claim capped to source+component evidence. |
| SC-2 verify → resolved name; edit clears; unresolvable → inline error, no recipient | PASS | Tester RTL R-3 (hostile input stripped/clamped 10; disabled CTA never fires resolve), R-4 (resolved name + C10 hint render; CTA swaps), R-5 (one-digit edit clears confirm), R-6 (E1/E2 verbatim at runtime); onboard fn: 422 → no recipient (implementor T-1 + tester HI-1 zero-call assertions). |
| SC-3 recipient create; last4 ONLY; partner_country='NG'; card flip | PASS (mocked) | Implementor T-1/T-2 re-run; tester PII-1 extends to the LOG-LINE clause (console captured across happy + 3 failure flows — full NUBAN absent everywhere; last4 present proves non-vacuity); card-flip hold = R-7 (state-8 `isPending || isSuccess` proven disabled+busy at runtime). |
| SC-4 exclusivity 409 both directions | PASS (runtime, both legs) | Paystack leg: implementor T-3 runtime. Stripe leg (the implementor-flagged gap): tester EX-1 — REAL `partner-stripe-onboard` handler via serve-shim answers `409 {conflict, paystack_already_connected}` with ZERO api.stripe.com calls; EX-2 detached row does not overfire; EX-3 exclusivity read failure fails CLOSED (500, no Stripe call). |
| SC-5 one row, key `paystack:<ref>`, share=round(F×0.10), replay-safe | PASS | Implementor T-4/T-7; tester DP-1 (5× replay storm → 1 transfer, 1 reference, 1 row over a STATEFUL ledger implementing the real RPC guards), MM-1 (9 kobo boundaries incl. 1, 9, 15005, 2^31−1: share==Math.round, share≤fee, initiate amount==recorded share), MM-2 (0/negative/NULL/NaN/string fee → zero rows, zero calls). |
| SC-6 transferred flip + first_split_at + push once | PASS (mocked) | Implementor T-9; tester DP-3 (transfer.success ×2 → single flip, transferred_at COALESCE-stable, all pushes share ONE idempotencyKey). first_split_at = ORCH-1081 trigger, pinned by migration probe 6.4 + emulated in the stateful harness. |
| SC-7 FAIL-SOFT (constitutional) | PASS (runtime) | Implementor T-8 re-run + independently revert-proven (§4 below); tester WH-1/WH-2 force the throw at TWO DIFFERENT stages (partner-pin RPC 500, ledger-record RPC 500) → 200 ack, finalize + confirmation ran, inbox processed=true, error=null; WH-3 malformed charge payloads (no data / no reference / wrong types / negative junk) → no crash, split stage NEVER reached. |
| SC-8 blocked_no_paystack row + badge | PASS | Implementor engine tests (no/detached recipient → blocked row, zero transfer calls) + T-15 badge mapping re-run. |
| SC-9 insufficient balance same-ref; transfer.failed → NEW ref next sweep; cap → failed + alert | **FAIL** | Same-reference half PASSES (tester HP-3: 5xx/429/network/balance ALL re-use `_a0`, zero bumps — the double-pay defense holds). Cap-finalize half PASSES (implementor T-10 + sweep suite). **The NEW-reference half is broken end-to-end: tester DP-7 RED** — see P1 below. |
| SC-10 refund vs pending → reversed_pending; vs transferred → reversal_owed_at + audit + alert | PASS | Implementor T-12 family re-run; tester DP-8 (reversed_pending is sweep-invisible AND terminal against a late transfer.success flip). P2 edge race noted below (in-flight transfer at refund time). |
| SC-11 brands trigger stamps owner_stripe_connected_at once; no renames | PASS (SQL contract; NOT applied per cap) | Implementor T-13 re-run; tester TRG-1 (COALESCE + OLD-NULL + DISTINCT + active-only — re-fire can never re-stamp) + IDEM-1 backfill re-run-safety. |
| SC-12 Stripe rail bit-identical | PASS | `git diff origin/main...HEAD` = 0 lines on `partnerSplits.ts`, `stripeWebhookRouter.ts`, `ticketCheckout.ts`, `ticket-checkout-create/index.ts` (re-run by tester); implementor's exact regression set re-run: **48/48 PASS**. |
| SC-13 no NG in Stripe allowlist | PASS | I-PROPOSED-T gate re-run: 2163 files, 0 violations; T-16 assertion re-run. |

---

## 3. Findings

### P1-1331-STALE-TRANSFER-CODE — SC-9 retry-after-definitive-failure never retries (BLOCKS CLOSE)

- **Evidence (runtime, committed test):** `supabase/functions/_shared/__tests__/paystackPartnerSplits.doublePay.tester.orch1331.test.ts` test **DP-7 — RED at `6c46a478f`**. Failing assertion output: `References sent to Paystack: ["psplit_…_a0"]; row after two sweeps: status=pending, attempt_count=3, stripe_transfer_id=TRF_dp_0` — no `_a1` initiate ever happens.
- **Mechanism:** `_shared/paystackPartnerSplits.ts:603-629` (`handlePaystackTransferEvent`, `transfer.failed`) bumps `attempt_count` but **never clears `stripe_transfer_id`**. The sweep (`partner-paystack-split-retry/index.ts:138-179`) is reconcile-FIRST: a row with a transfer_code goes to `fetchTransfer` → the dead transfer reports `failed` → the sweep re-enters the same `transfer.failed` handler → bumps AGAIN → `continue`. The `attemptTransferForSplit` retry branch (line 196) is permanently shadowed. Contrast: the reconcile-**reversed** branch (lines 158-174) DOES clear the code — the failed branch is the missing mirror.
- **Impact:** any Paystack transfer that initiates as `pending` and then fails asynchronously (recipient bank rejects — the mainline async-failure mode) is NEVER retried. The row burns its remaining attempts on reconcile loops (~2h at */30) and hard-finalizes `failed` with an ops alert that misstates "exhausted 5 transfer attempts" when exactly ONE real attempt was made. Partner doesn't get paid; recovery becomes manual. (Money-safe direction — no double-pay — but SPEC §4.5.3 "row stays pending (sweep retries with new reference)" and SC-9 are violated as a composed path.)
- **Required fix (small):** clear `stripe_transfer_id` (and `payout_reference`) whenever a DEFINITIVE `transfer.failed` bump occurs — in `handlePaystackTransferEvent`'s transfer.failed branch AND/OR the sweep's reconcile-`failed` branch (mirror the reconcile-`reversed` clear at `partner-paystack-split-retry/index.ts:162-173`). Keep the below-cap/at-cap logic unchanged.
- **Retest:** DP-7 goes green; re-run the full doublePay suite (14/14) + implementor engine/sweep suites.

### P2-1331-REFUND-INFLIGHT-RACE — refund.processed vs an in-flight transfer mis-ledgers (registry item, not a CLOSE blocker)

- **Evidence:** `paystackPartnerSplits.ts:703-715` — a `pending` row is treated as "money never left" and flipped `reversed_pending`, without checking `stripe_transfer_id`. A pending row WITH a transfer_code has money in flight; if that transfer completes, the late `transfer.success` cannot flip `reversed_pending` (RPC guards `pending|failed` — proven terminal by tester DP-8). Result: partner paid, ledger says never-paid, no `reversal_owed_at`, no ops alert.
- **Assessment:** implementor followed the SPEC verbatim (§4.5.4's pending-implies-unpaid assumption is the seed); window is seconds-to-minutes; NGN refund volume low. Route to registry as a follow-up: when the row carries a transfer_code, reconcile (or defer to the sweep) before choosing `reversed_pending`.

### P2-1331-DUPLICATE-REFERENCE-SHAPE — the one double-pay hole mocks cannot close (live-smoke pin, cannot verify under the cap)

- **Evidence:** the entire double-pay defense rests on Paystack's documented behavior that re-initiating with an existing `reference` returns the ORIGINAL transfer. If live Paystack instead answers a 4xx "duplicate/reference exists" error, `classifyTransferError` (`paystackPartnerSplits.ts:273-288`) classifies it DEFINITIVE → bump → NEW reference `_a1` → a second real transfer while `_a0` may be in flight. Tester DP-2/DP-6/HP-3 prove the engine is correct **given the documented behavior**; the behavior itself is unverifiable under the mocked cap.
- **Required action:** add one step to the SPEC §11 post-deploy live smoke — initiate the SAME reference twice on a minimal transfer and pin the response shape. Defense-in-depth option for the rework (cheap): treat messages matching `/duplicate|reference.*(exists|already)/i` as RETRYABLE (no bump).

### P3-1331-DELETE-LOG-ECHO — defense-in-depth on the log-line PII clause

`partner-paystack-onboard/index.ts:268-274, 366-372` log upstream `err.message` verbatim on recipient-delete failures. Today those messages reference recipient codes, not account numbers (tester PII-1 passes with realistic hostile messages), but any future upstream echo of an account number would land in logs. Consider truncating/normalizing upstream messages before logging. Registry note only.

### P3-1331-STALE-DISPUTE-TEST — pre-existing latent local red (NOT attributable to this ORCH)

`stripeWebhookRouter_disputeAdversarial.test.ts` ("charge.succeeded must NOT be in STRIPE_ROUTED_EVENT_TYPES (OQ-5)") fails on this branch AND on origin/main by construction (both the test and `stripeWebhookRouter.ts` are zero-diff vs origin/main; charge.succeeded was legitimately added to routing by ORCH-1054). It appears in NO CI job file list, so it is a local-only latent red. Discovery for the orchestrator (stale-assertion cleanup ORCH; needs `[TEST-MOD-APPROVED]`).

### P3-1331-NONPARTNER-403-NOISE — confirmed as implementor DISC-1331-4

Background paystack-status 403s for non-partners: harmless (not-a-partner branch renders first — pinned by the implementor's screen-order assertion). Cosmetic console noise; already routed.

### P4 (praise) — fail-soft + idempotency discipline

The constitutional fail-soft wiring survived throws at THREE distinct stages (fee-read, partner-pin, ledger-record) without ever touching the ack/inbox; the `psplit_<id>_a<n>` reference discipline + DB `status='pending'` write-guards held every double-pay attack (13/14 DP/MM/HP tests green, the 14th being the P1's honest red). The `record-first, ON CONFLICT, return-current-row` ledger pattern is exactly right.

### P4 (praise) — exclusivity fail-closed + PII

`partner-stripe-onboard`'s exclusivity read failing CLOSED (EX-3) and the last4-only discipline surviving a console-capture hunt (PII-1) are production-grade.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

At HEAD `0e2b5f1aa` (implementor proved at `49bd06da9`; same tree content):
1. Deleted the webhook fan-out try/catch (bare `await handlePaystackPartnerSplit(...)` left) → **T-8 FAILED** (`0 passed | 1 failed`) AND `orch-1331-partner-split-fail-soft.mjs` **FAILED** ("call is NOT inside its own try/catch"). Exit code 1 captured.
2. Restored via `git checkout --` → T-8 `1 passed | 0 failed`; gate "passed". Worktree clean.

## 5. Tester adversarial tests added (all NEW files, on-branch, in the closing diff)

| Suite | Path | Count | Angle |
|---|---|---|---|
| Double-pay / money-math / hostile events | `supabase/functions/_shared/__tests__/paystackPartnerSplits.doublePay.tester.orch1331.test.ts` | **13/14** (DP-7 red = the P1, by design) | STATEFUL in-memory ledger implementing the migration's exact RPC guard semantics + ORCH-1081 trigger emulation; full multi-event sequences incl. replay storms, races, lost webhooks, kobo boundaries |
| Webhook hostile | `supabase/functions/_shared/__tests__/paystackWebhookHostile.tester.orch1331.test.ts` | 5/5 | REAL handler via serve-shim; throws at DIFFERENT stages than T-8; malformed payload battery; designed transfer-event retry semantics |
| Rail exclusivity + PII | `supabase/functions/_shared/__tests__/partnerRailExclusivity.tester.orch1331.test.ts` | 6/6 | REAL `partner-stripe-onboard` runtime 409 (the SC-4 gap); fail-closed; hostile input shapes; NUBAN console-leak hunt |
| SQL contract armor | `supabase/migrations/__tests__/orch_1331_paystack_rail_tester_adversarial.test.ts` | 6/6 | RLS single-SELECT-policy + FORCE + zero write policies; DDL idempotency class; txn+probes; grant surface; pending-only guards; trigger re-fire immunity |
| Client RTL render-proof | `mingla-business/src/components/partner/__tests__/PartnerPaystackOnboardForm.orch1331.render.test.tsx` (+ `jest.orch1331.render.cjs`) | 10/10 | REAL RTL mount driving design §3.2 states 1–9 incl. the BINDING state-8 hold, §7 copy verbatim, I-39 labels, dead-tap + invalidation contracts |

**Tester fails-on-revert — three vectors, all break → RED → restore → GREEN at `6c46a478f`:**
- **A (engine):** deleted the replay early-return in `handlePaystackPartnerSplit` → DP-1 FAILED (5 transfers instead of 1) → restored → PASS.
- **B (SQL):** deleted `AND status = 'pending'` from `bump_paystack_partner_split_attempt` → SM-1 FAILED → restored → PASS.
- **C (client):** deleted the invalidation line in `onAccountChange` → R-5 FAILED → restored → PASS.

Both the implementor's suites and the tester's suites are visible in `git diff origin/main...HEAD --name-only` (13 test/config files).

## 6. Suite counts (all re-run by the tester on this machine)

| Set | Result |
|---|---|
| Implementor Deno (engine 24 + onboard 16 + sweep 7 + SQL 10) | **57/57 PASS** |
| Implementor T-8 fail-soft runtime (import-map) | **1/1 PASS** |
| Stripe-rail regression (orch_1054 happy+adversarial, orch_1052, orch_1054 SQL, orch_1081, stripeWebhookRouter, stripeWebhookSignature) | **48/48 PASS** |
| Tester Deno adversarial | **30/31** (DP-7 red = the P1) |
| Implementor client jest (T-15/T-16) | **20/20 PASS** |
| Tester client RTL render | **10/10 PASS** |
| `deno check` (7 touched fns/modules) | 7/7 OK |
| Gates: fail-soft (5/5 self-test + live), share-single-source (4/4 + live), I-PROPOSED-T (2163 files, 0), I-38 (531, 0), I-39 (531, 0) | ALL PASS |

**Pre-existing red set — UNCHANGED and re-verified:** `KeyboardRoot.test.tsx` 4× ENOENT on `src/components/brand/TripBrandWizard.tsx` re-run by the tester — the file is absent on BOTH this worktree and anchor main (75 passed / 4 failed, identical failure signature) → pre-existing confirmed, not attributed. `businessNotificationRouting` mock-drift, `shell.test.ts` tax-jurisdiction [ORCH-1330], `VenueCreatorWizard.ve2` [ORCH-1345] — not attributed per dispatch. NEW discovery: the stale `stripeWebhookRouter_disputeAdversarial` red (P3 above) is also pre-existing by construction (zero-diff files).

## 7. Constitution (14 rules)

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | R-3/R-10 runtime: disabled CTA never fires; back button fires onCancel |
| 2 | One owner per truth | PASS | split status owned solely by the guarded RPCs; single ledger table |
| 3 | No silent failures | PASS | split failures log + ops-alert + error_message; the P1 is a broken retry, not a silent one (alert fires — though its copy overstates attempts; fix rides the P1) |
| 4 | Query-key factory | PASS | `partnerPaystackKeys` factory; no string literals at call sites |
| 5 | Server state server-side | PASS | react-query only; no Zustand |
| 6 | Logout clears everything | PASS | standard query-cache lifecycle; no new persistence |
| 7 | `[TRANSITIONAL]` labeled | N/A | none introduced |
| 8 | Subtract before adding | PASS | provider-neutral labels replace Stripe-specific copy |
| 9 | No fabricated data | PASS | masked last4 is real; no phantom "pending verification" state (design §3.2 note honored) |
| 10 | Currency-aware | PASS | NGN-only zero-FX proven (MM-3); `formatCents` Intl |
| 11 | One auth instance | PASS | house resolveUserId/getUser patterns in both fns |
| 12 | Validate at right time | N/A | no datetime surface |
| 13 | Exclusion consistency | PASS | detached rows excluded identically both rails (EX-2 + implementor T-3 detached leg) |
| 14 | Persisted-state startup | N/A | no persisted stores added |

## 8. Device / parity matrix

| Surface | Result | Basis |
|---|---|---|
| Consumer iOS / Android | N/A | zero `app-mobile/` files in the diff (verified) |
| Buyer/anonymous Web (NGN checkout) | PASS (backend-proven) | SC-12 zero-diff + T-8/WH-1/WH-2 prove the webhook ack/finalize path is byte-stable under split failure |
| Business iOS | CAPPED | shared RN code; form state machine proven via RTL (jest, iOS haste platform); NO sim run (dispatch: sim optional — claims capped to component-level runtime) |
| Business Android | CAPPED | same shared code; 42dp Done-bar clearance + opaque `#14110f` sheet pinned by implementor source tests; NOT device-driven |
| Business Web preview | CAPPED | same shared code; RN-web Alert fallback = shipped Stripe-disconnect pattern (source-verified); no browser run |
| Admin Web | N/A | additive schema only |
| Edge deploy state | N/A by design | NOT deployed (cap); deploy + `verify_jwt` table is CLOSE-owned (IMPLEMENTATION §5) |
| Physical iPhone HITL | NOT APPLICABLE THIS PHASE | backend-dark rail; client visual smoke rides the post-deploy manual smoke (SPEC §11) — flagged, not skipped silently |

## 9. Discoveries for Orchestrator

1. **P3-1331-STALE-DISPUTE-TEST** — stale OQ-5 assertion in `stripeWebhookRouter_disputeAdversarial.test.ts` red on main (local-only; in no CI file list). Needs a `[TEST-MOD-APPROVED]` cleanup ORCH.
2. **P2-1331-REFUND-INFLIGHT-RACE** — registry follow-up (§3).
3. **P2-1331-DUPLICATE-REFERENCE-SHAPE** — add the same-reference-twice probe to the SPEC §11 live smoke; optional defense-in-depth classification tweak in the P1 rework.
4. Implementor discoveries DISC-1331-1..4 re-confirmed where touched (KeyboardRoot ENOENT re-proven; migration-history drift NOT re-probed — prod read access not needed for this phase).
5. RTL overlay (`.orch1118-testdeps`) provisioned in THIS worktree for `jest.orch1331.render.cjs`; per house pattern it is gitignored — CLOSE reap loses nothing, but a retest in a fresh worktree must re-provision per `EditPublishedTripScreen.render.README.md`.

## 10. Routing

**FAIL → REWORK (mingla-implementor):** fix P1-1331-STALE-TRANSFER-CODE (clear `stripe_transfer_id`/`payout_reference` on definitive `transfer.failed` bumps — webhook handler branch + sweep reconcile-failed branch, mirroring the reconcile-reversed clear). Optionally fold in the P2 duplicate-reference retryable classification. DO NOT touch DP-7 — it is the acceptance test and goes green with the fix. Then RETEST here: full doublePay suite 14/14 + implementor engine/sweep suites + both gates. Retest ceiling remains **PASS (mocked)**; the post-deploy live smoke (SPEC §11 + the new same-reference probe) stays with Seth after CLOSE.
