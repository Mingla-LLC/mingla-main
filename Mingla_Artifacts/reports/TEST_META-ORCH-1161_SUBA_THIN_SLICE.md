# TEST — META-ORCH-1161 Sub-A (THIN SLICE) — buyer_reservation_changed end-to-end

**ORCH:** META-ORCH-1161 Sub-A (thin slice)
**Phase:** TEST (mingla-tester, adversarial)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[notif-system]/` on branch `ORCH-1161-notif-system`
**Under test:** code commit `a511b7944`, report `6faa0dcbd`
**Tester adversarial test commit:** `577de017b`
**Date:** 2026-06-20
**Mode:** TARGETED + SPEC-COMPLIANCE (backend-only — Phase 0.A live-fire-sim EXEMPT: no UI/runtime surface ships this slice; verified against real Postgres + Deno runtime instead)

---

## 1. VERDICT: **CONDITIONAL PASS**

**P0: 0 | P1: 0 | P2: 2 | P3: 1 | P4: 3**

Zero P0, zero unaccepted P1. The slice is correct and well-built; the two P2s are pre-disclosed limitations (anon-path idempotency gap + anon-path delivery-ledger gap) that do not block the thin-slice /goal and are the documented Sub-C hardening surface. **The CONDITIONAL is because the live SMS leg cannot be end-to-end-proven without a deployed Twilio + a flipped kill-switch (operator-owned go/no-go), and the two P2 anon-path gaps should be Seth-accepted (carried to Sub-C) rather than fixed in this slice.** If Seth accepts the two P2s as Sub-C carry-forward, this is a clean ship.

Regression gate: SATISFIED — implementor happy-path test (fails-on-revert reproduced by me) + tester adversarial test (different angle, on-branch, in-diff, its own fails-on-revert) both present.

---

## 2. What I RUNTIME-PROVED vs SUSPECTED

### RUNTIME-PROVEN (real Postgres `supabase/postgres:15.8.1.060` in Docker + Deno 2.7.14)
- **Migrations apply IN ORDER against real Postgres** (the implementor's biggest unverified gap — they had no Docker). All 4 migrations `20261110000000→3` applied clean in sequence (the only failures were environment stubs — `auth.uid()`/`auth.users` absent in a bare container — resolved by stubbing the Supabase runtime objects, then clean).
- **Monotonic versioning:** `20261110000000-3` > origin/main max `20261015000001`. ✓
- **RLS enabled on all 6 new tables** (`relrowsecurity=t` for categories, channel_prefs, channel_suppressions, consent_records, deliveries, outbox). ✓
- **REVOKE PUBLIC+anon on every SECURITY DEFINER fn** (the auto-grant gotcha): `can_send` → public=f, anon=f, authenticated=t; `orch_1161_reservation_notify_outbox` (trigger fn) → public=f, anon=f, auth=f. ✓
- **`notification_outbox` is service-role-only** (0 RLS policies → all authenticated/anon access denied). ✓
- **DC-3 closed SMS set:** exactly 7 categories have `urgency=high AND 'sms' in default_channels`; `buyer_purchase_confirmation` correctly NOT among them (DEC-185 removed purchase SMS). ✓
- **Scope separation (I-PROPOSED-1161-TRANSACTIONAL-VS-MARKETING-CONSENT-SEPARATED):** a `scope='marketing'` STOP on a phone → `can_send(transactional, 'sms')` returns **TRUE** (not blocked); `marketing_blast` blocked. A `scope='all'` STOP → transactional **FALSE** (correct carve-out). ✓
- **NULL user_id (anon/guest) does not crash `can_send`** (SPEC R-7): contact-keyed sms → TRUE; push with NULL contact → TRUE. ✓
- **Reservation trigger fires correctly:** requested→confirmed enqueues `buyer_reservation_confirmed`; table change enqueues `buyer_reservation_changed`; a no-op UPDATE (party_size=party_size, guest_name change) enqueues NOTHING. ✓
- **STOP round-trip:** inbound-webhook-style `scope='all'` suppression insert → next transactional SMS denied; repeat STOP idempotent via the partial unique index (INSERT 0 0, 1 row). ✓
- **Legacy `notify-dispatch` `type` path is BYTE-IDENTICAL:** `git diff origin/main...HEAD` on `notify-dispatch/index.ts` shows ZERO deletions — purely an import + an early additive `if (category_key)` branch. `twilio-message-status` diff also 0 deletions (additive). ✓
- **SMS kill-switch zero-HTTP:** smsAdapter returns `skipped` BEFORE `twilioSend` is reachable; my adversarial test stubs `fetch` and asserts `counters.twilio === 0` with the switch OFF. ✓
- **Simultaneous send (DEC-185, supersedes SPEC §5.4 waterfall):** `dispatchV2` writes inapp always, then fans out push+email+sms in parallel via `Promise.all` — no fallback ordering. ✓ (Deviation is documented in the impl report §1; the dispatch contract / DEC-185 governs.)
- **GSM-7 + segment count:** sanitizer normalizes smart quotes/em-dash/ellipsis/nbsp/bullet; templates authored ASCII-clean; `buyer_reservation_changed` SMS + STOP footer is single-segment. ✓
- **8/8 implementor Deno tests pass; 3/3 tester adversarial pass; 11/11 combined.** ✓
- **`deno check` clean** on all 5 touched edge functions; strict-grep gate `i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs` passes (exit 0). ✓

### SUSPECTED (could not runtime-prove — no live deploy / no Twilio in test)
- **End-to-end live SMS delivery + a real Twilio STOP round-trip** — requires `SMS_LIVE_ENABLED_US=true` + deployed `twilio-inbound-sms` webhook wired in the Twilio console. This is the §8 operator go/no-go gate, intentionally OFF. Source + stubbed-fetch + SQL prove the LOGIC; live delivery is operator-owned.
- **The pg_cron drain actually firing every minute against live vault/pg_net** — `cron.schedule` registered correctly (proven); the `$cron$` body references `vault.decrypted_secrets`/`net.http_post` which exist only in deployed Supabase (the migration's own DO-block advisory NOTICE flags this). Suspected-correct (mirrors the proven `marketing-send` cron verbatim).
- **OneSignal push actually delivering** — pushAdapter wraps the existing proven `sendPush`; not re-fired live here.

---

## 3. Migration-apply result (the headline gap, now CLOSED)

| Migration | Apply result (real Postgres, in order) |
|---|---|
| `20261110000000_..._foundation_tables` | OK — 6 tables + 6 RLS enables + 5 policies (after stubbing `auth.uid()`/`auth.users`, which are Supabase-runtime objects absent from a bare container — NOT a migration defect) |
| `20261110000001_..._seed_categories` | OK — INSERT 0 16, idempotent ON CONFLICT upsert |
| `20261110000002_..._can_send_and_trigger` | OK — `can_send` + trigger fn + `AFTER UPDATE` trigger; REVOKE/GRANT correct |
| `20261110000003_..._outbox_drain_cron` | OK — `cron.schedule` registered `* * * * *`; advisory NOTICE for vault (expected in non-Supabase PG) |

**Conclusion:** the migration chain is valid SQL, monotonic, and structurally sound. The implementor's "NOT run — no local Docker" gap is now independently closed.

---

## 4. Findings

### P2-1 — Anon/guest path has NO idempotency dedupe → duplicate SMS/email on a double-fire
- **Evidence:** `_shared/notifyV2.ts:217-254` (`dispatchAnon`) sends email/SMS directly with no dedupe. The `notifications` UNIQUE(idempotency_key) backstop (lines 96-115) guards ONLY the `user_id` path. The drain (`notify-outbox-drain/index.ts:47-68`) claims rows with a NON-atomic `select status='pending'` then `update status='processing'` — two overlapping crons (a run >60s) can both claim the same pending row. For a user-bearing reservation the downstream 23505 dedupes; for an anon/guest reservation it does NOT. **Proven by my adversarial test** `ANON: double-dispatch of the SAME idempotency_key sends SMS TWICE` → `counters.twilio === 2`.
- **Impact:** a guest (created_via='guest', no consumer_user_id) reservation change could send the buyer two identical SMS (Twilio cost + UX) if the drain double-claims. Low probability today (every-minute cron, fast dispatch), real at scale or on a slow dispatch.
- **Required fix (Sub-C):** make the drain claim atomic (a single `UPDATE ... WHERE status='pending' ... RETURNING` or `FOR UPDATE SKIP LOCKED`), OR add an anon-side dedupe keyed on `idempotency_key` (e.g. a unique `sent_outbox_idempotency` ledger checked before the anon send).
- **Retest:** re-run `orch_1161_anon_guest_path.test.ts`; flip the A3 assertion to `assertEquals(counters.twilio, 1)` once fixed.
- **Status:** pre-disclosed in impl report §10 ("anon reservations get email/SMS but no deliveries rows") — but the report frames it as a ledger gap, NOT a double-send gap. This finding sharpens it. Recommend Seth-accept as Sub-C carry-forward.

### P2-2 — Anon/guest deliveries are NOT recorded in `notification_deliveries`
- **Evidence:** `dispatchAnon` returns inline deliveries but writes NO `notification_deliveries` rows (the FK requires a `notifications.id`, and `notifications.user_id` is NOT NULL → no inbox row for a user-less guest). `notifyV2.ts:214-216` comment acknowledges this.
- **Impact:** for guest reservations there is no durable cross-channel delivery ledger; the Twilio status webhook (`provider_message_id` reconcile) has no row to update → guest SMS delivery/failure is unobservable in `notification_deliveries`.
- **Required fix (Sub-C):** either relax `notifications.user_id` to nullable for guest rows, or add a guest-scoped delivery ledger not FK-bound to `notifications`.
- **Status:** pre-disclosed (impl report §10). Recommend Seth-accept as Sub-C carry-forward.

### P3-1 — Idempotency key uses millisecond wall-clock `now()` → dedupes only WITHIN a transaction
- **Evidence:** `20261110000002...sql:148` builds `idempotency_key = category || ':' || id || ':' || to_char(now(),'YYYYMMDD"T"HH24MISSMS')`. `now()` is transaction-start time (stable per-txn), so two identical changes in ONE txn dedupe via `ON CONFLICT`; two identical changes in SEPARATE transactions get DIFFERENT keys → no dedupe. SPEC §7.2 specified `:{transitionAt}` which is itself per-transition, so this matches intent — but it means the outbox idempotency only protects against same-txn re-fires, not logical-duplicate transitions.
- **Impact:** minor — a legitimate distinct transition SHOULD get a distinct notification, so this is arguably correct. Flagged because it interacts with P2-1 (the dedupe people might assume exists across the drain does not).
- **Required fix:** none required for the thin slice; document the semantics. Consider a coarser bucket (e.g. truncate to the second, or use the reservation `updated_at`) if cross-txn dedupe is ever desired.

### P4 (praise)
- **P4-1:** `notify-dispatch` v2 is a textbook additive branch — ZERO deletions on the legacy path, proven by diff. Exactly the §5.7 transitional contract. Constitution Rule 7 ([TRANSITIONAL] labels) honored.
- **P4-2:** the kill-switch returns `skipped` before any Twilio env is even read — the cost-law fails CLOSED. Clean.
- **P4-3:** every SECURITY DEFINER fn carries the explicit REVOKE PUBLIC + REVOKE anon (the well-known Supabase auto-grant gotcha) — independently verified live.

---

## 5. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- **Checked-out commit:** `a511b7944` (current branch HEAD before my test commit).
- **Ran:** `deno test ... orch_1161_notify_dispatch_v2.test.ts` → **8 passed | 0 failed**.
- **Reverted the fix** by true line-deletion of the kill-switch guard block (`const killSwitch = ...; if (!envTrue(killSwitch)) { return skipped }`) in `smsAdapter.ts` → **6 passed | 2 failed**:
  - FAIL: `smsAdapter: kill-switch OFF returns skipped WITHOUT an HTTP call` (asserts on the skipped status / no-call mechanism, asserts.ts:190).
  - FAIL: `dispatchV2: kill-switch OFF — inapp+push+email fire, SMS skipped (no fallback)` — `AssertionError: SMS skipped when kill-switch off` (test file:239).
- **Restored** the guard → **8 passed | 0 failed**.
- **Conclusion:** the implementor's `fails-on-revert verified at a511b7944` claim is REPRODUCED. ✓

---

## 6. Adversarial test added (different angle, on-branch, in-diff)

- **Path:** `supabase/functions/__tests__/orch_1161_anon_guest_path.test.ts`
- **Commit:** `577de017b` (on branch `ORCH-1161-notif-system`)
- **Angle:** the ANON/GUEST path (`dispatchV2 → dispatchAnon`, `user_id === null`) — which NONE of the implementor's 8 tests exercise (all use a user_id). Stubs `globalThis.fetch` to COUNT Twilio HTTP. Three tests:
  1. anon kill-switch OFF → SMS `skipped`, ZERO Twilio HTTP, no push/inapp attempted;
  2. anon kill-switch ON → exactly 1 Twilio HTTP per single dispatch;
  3. anon double-dispatch of the SAME idempotency_key → SMS sent TWICE (pins the P2-1 gap).
- **fails-on-revert verified at `a511b7944`** — deleting the smsAdapter kill-switch guard makes the anon SMS leg hit `fetch` → test 1's `counters.twilio === 0` assertion FAILS (asserts.ts:190, test file:116, `2 passed | 1 failed`); restore → `3 passed`.
- **Both tests confirmed in the closing diff:** `git diff origin/main...HEAD --name-only -- supabase/functions/__tests__/` lists BOTH `orch_1161_notify_dispatch_v2.test.ts` and `orch_1161_anon_guest_path.test.ts`. ✓

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI in this slice |
| 2 | One owner per truth | PASS | `notify-dispatch` v2 = sole dispatch entry; adapters = sole provider-HTTP owners; `notification_deliveries` = sole cross-channel ledger (transitional dual-write labeled) |
| 3 | No silent failures | PASS | every can_send denial / no-contact writes a `suppressed`/`skipped` deliveries row; drain re-queues on failure (3 attempts → `failed`, not dropped); consent-write failure logged non-fatal. ONE soft spot: anon path has no ledger (P2-2) but returns inline deliveries (not silent) |
| 4 | One query key per entity | N/A | edge/SQL only |
| 5 | Server state server-side | N/A | no client state |
| 6 | Logout clears everything | N/A | no client |
| 7 | `[TRANSITIONAL]` + exit | PASS | `META-ORCH-1161 transitional:` labels on the v2 branch + notifyV2; exit = legacy `type` retired at CLOSE |
| 8 | Subtract before adding | PASS | additive-only by design (legacy path 0 deletions); no parallel new sender |
| 9 | No fabricated data | PASS | templates render from payload only; default branch never fabricates (renders payload.body or a plain notice) |
| 10 | Currency-aware | N/A | no money |
| 11 | One auth instance | N/A | service-role only |
| 12 | Validate at right time | PASS | trigger only enqueues on a real status/table/time change; idempotency on transition instant |
| 13 | Exclusion consistency | PASS | DC-3 closed SMS set holds (7 high-urgency sms rows; can_send denies channel-not-in-default) |
| 14 | Persisted-state startup | N/A | no client hydration |

No violations → no automatic P0.

---

## 8. Device / parity matrix

| Surface | Result | Note |
|---|---|---|
| Consumer iOS | N/A (skip) | no UI shipped this slice (impl §8: indirect only). |
| Consumer Android | N/A (skip) | same. |
| Buyer/anon Web | N/A (skip) | no buyer-web file touched. |
| Business iOS | N/A (skip) | brand push untouched. |
| Business Android | N/A (skip) | same. |
| Admin Web | N/A | OUT of META-ORCH-1161. |
| Backend (`supabase/`) | **PASS (runtime-proven)** | the whole slice; real-Postgres migration apply + Deno runtime + stubbed-fetch + SQL live-fire. |

Physical-iPhone HITL: not applicable (no user-touchable surface this slice). **Edge-fn live deploy state:** the 2 new + 2 extended edge fns are NOT yet deployed (operator-owned, from merged main per impl §11) — confirmed via the impl report; not independently checked against live Supabase because nothing is merged yet.

---

## 9. Discoveries for Orchestrator (not fixed here)

- **DEC-185 / DEC-186 ID COLLISION (carry the impl's Discovery #2).** The local `DECISION_LOG.md` DEC-185/DEC-186 are ORCH-1146/1151 (experience-parser) decisions — NOT the "simultaneous policy send" / "bundled consent" decisions the dispatch + this slice reference. The notification DEC-185 (simultaneous send) governs the code (correctly), but it is NOT in `DECISION_LOG.md`. **Orchestrator must log the notification decisions under FRESH, non-colliding IDs at CLOSE** or the audit trail is ambiguous. The SPEC §5.4 (push-first/SMS-fallback waterfall) is SUPERSEDED by simultaneous-send — record that supersession explicitly.
- **COMMS-0038 (I-PROPOSED-BV realtime-publication gate) RED on origin/main** is pre-existing (META-ORCH-1148) and does NOT block this slice (it adds no realtime subscriptions). Noted, not chased — per dispatch instruction. The closing PR will inherit the red gate until 1148 fixes it.
- **CI coverage:** the 2 Deno test files are NOT in `.github/workflows/supabase-migrations-and-stripe-deno.yml` DENO_TEST_FILES (impl §10). Orchestrator should add both paths at CLOSE so they gate future PRs.
- **The COPY file** (`COPY_META-ORCH-1161_CONSENT_AND_MESSAGE_TEMPLATES.md`) lives in the anchor, not on origin/main — commit it to main for durability (impl Discovery #3). The `[[FILL]]` legal placeholders block the Sub-B/checkout consent-disclosure path.
- **`payout_paid` business SMS category** was seeded (a single business SMS per DEC-185/COPY §3.12) though the SPEC §2 non-goal said "brand SMS OUT." This is a documented DEC-185 deviation, not a defect — but the SPEC non-goal and the seed now disagree; orchestrator should reconcile the SPEC text.

---

## 10. Accepted conditions (CONDITIONAL PASS)

This verdict is CONDITIONAL on Seth accepting, as deliberate Sub-C carry-forward (not this-slice rework):
1. **P2-1** — anon/guest path has no idempotency dedupe (double-claim → duplicate guest SMS/email). Fix in Sub-C (atomic drain claim).
2. **P2-2** — anon/guest deliveries are not recorded in `notification_deliveries` (no FK-bound ledger for user-less guests). Fix in Sub-C.

If Seth accepts both → this routes to CLOSE. If either must be fixed in the thin slice → routes to REWORK (implementor), cited above by file:line.

---

## Downstream routing

CONDITIONAL PASS with two P2 conditions requiring Seth's accept → **STOP and surface to Seth** (do not auto-route to CLOSE). On Seth's accept of P2-1 + P2-2 as Sub-C carry-forward → orchestrator CLOSE (flip I-PROPOSED-1161-* ACTIVE, log the notification DEC-185/186 under non-colliding IDs, add the 2 Deno test paths to CI). On reject → REWORK to implementor for the atomic drain claim + guest delivery ledger.
