# TEST — META-ORCH-1161 go-live-prep (DEC-191 marketing opt-out + US quiet-hours recipient TZ)

**Verdict: FAIL — 1 P0, 1 P1, 1 P2 (NOT clear-to-close).**
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[golive-prep]/` on branch `ORCH-1161-golive-prep` @ `f4f0d1346`.
**Date:** 2026-06-20. **Tester:** mingla-tester. **Evidence level:** `proven` (real Postgres 15 in Docker + Deno + Node + read-only remote probe).

Comms ledger read on entry: no BLOCK rows; the two ALL-targeted WARNs (COMMS-0039 1148 Stripe-idempotency, COMMS-0040 1163 RSVP page) touch different files/lanes — read, no ack required, no new cross-ORCH discovery to log.

---

## 1. Verdict + finding counts

| Severity | Count | Item |
|---|---|---|
| P0 | 1 | Migration `20261113000000` does NOT apply — `set_marketing_suppression` fails to COMPILE (invalid `GET DIAGNOSTICS` expression). The entire opt-out write path is absent; under `db push` the whole migration rolls back (can_send flip lost too). |
| P1 | 1 | Contact-keyed suppression row never persists (two-row `ON CONFLICT` collapse) → the marketing **SMS blast** does NOT honor a prefs-UI opt-out. SC-6 single-source-of-truth round-trip is broken for SMS. |
| P2 | 1 | EMAIL marketing opt-out via the RPC is NOT honored by the email blast at all — `marketingAudience.aggregate` reads only `marketing_unsubscribes`, never `channel_suppressions(channel='email')`. SC-6 round-trip broken for email even if P1 is fixed. |

---

## 2. SC-by-SC matrix (runtime evidence)

| SC | Verdict | Evidence |
|---|---|---|
| SC-1 can_send marketing default-ON (no pref + no suppression → TRUE) | **PASS** | Real PG: `can_send(alice,'marketing_blast','email',…)=t`, sms=t, push=t. Migration replaces the prior `IS DISTINCT FROM true` opt-in branch (confirmed vs `20261110000002`). |
| SC-1b suppression(marketing\|all) → FALSE | **PASS** | Real PG: scope='marketing' email → f; scope='all' sms → f. |
| SC-1c explicit pref enabled=false → FALSE | **PASS** | Real PG: pref(enabled=false) → f. |
| SC-2 scope ISOLATION — marketing suppression does NOT block transactional | **PASS** | Real PG: with marketing email suppression present, `can_send(alice,'buyer_receipt','email',…)=t`. Control: scope='all' DOES block transactional (=f). |
| SC-3 prefs chips default ON + opt-out routes to suppression RPC | **PASS (pure logic)** | Node: `buildNotificationMatrix([MARKETING_CAT],[])` → marketing email/sms ON; `resolveToggleAction` for marketing email/sms → `{kind:'marketing_suppression', suppress}`. Device round-trip NOT runnable (blocked by P0). |
| SC-3b RPC SECURITY DEFINER + cross-user safety | **PASS** | Real PG: RPC keys off `auth.uid()`; an alice-authed call writes ONLY alice's contact, never the victim's. REVOKE PUBLIC/anon + GRANT authenticated present on both fns. Unauth → RAISE `not_authenticated`. |
| SC-4 single source of truth — opt-out → can_send false AND audience excludes | **FAIL** | can_send(sms) honors the user_id row (TRUE→false). BUT the contact-keyed row is dropped (P1) so the SMS blast resolver (keys on `channel_suppressions.contact`) never excludes the user; the email blast never reads channel_suppressions at all (P2). Round-trip NOT closed. |
| SC-5 quiet-hours recipient TZ (West-Coast 5 AM blocked while 8 AM ET) | **PASS** | Deno (real shipped map): 415 Pacific @ 5 AM PT = blocked; 212 Eastern @ 8 AM ET = allowed (same instant); 8:30 ET allowed; 21:00 ET blocked (endHour exclusive); Phoenix judged no-DST; unknown area code → deny; NG WAT 8 AM–8 PM with 20:00 blocked. |
| SC-6 migration `20261113000000` applies monotonic above prior 1161 max | **FAIL** | Prefix > `20261112000002` (ordering OK) but the migration FAILS TO APPLY (P0) — does not even compile. |
| SC-7 text-dark intact; zero Twilio HTTP while off | **PASS** | smsAdapter kill-switch checked BEFORE any `fetch`; branch diff does not touch smsAdapter / SMS_LIVE_ENABLED. `MARKETING_SEND_LIVE_ENABLED` also default-false. |

---

## 3. Findings

### P0-1 — `set_marketing_suppression` fails to compile; migration does not apply
- **Evidence:** `supabase/migrations/20261113000000_orch_1161_golive_marketing_optout.sql:220`
  `GET DIAGNOSTICS v_affected = v_affected + ROW_COUNT;`. Applied verbatim to real Postgres 15:
  `ERROR: unrecognized GET DIAGNOSTICS item at or near "v_affected"` at line 65 of the function body → the migration aborts; `set_marketing_suppression` is never created. `GET DIAGNOSTICS` only accepts a bare `var = item` assignment, never an expression.
- **Impact:** The opt-out write path does not exist. The prefs UI's `setMarketingSuppression` RPC call 404s. Under `supabase db push` (single transaction) the WHOLE migration rolls back, so the can_send marketing-default-ON flip is lost too — go-live ships nothing.
- **Required fix:** Split into two statements:
  `GET DIAGNOSTICS v_tmp = ROW_COUNT; v_affected := v_affected + v_tmp;` (declare `v_tmp integer`). Verified locally: with this change the function compiles and the migration applies.
- **Retest:** apply the migration to real PG; `set_marketing_suppression(text,boolean)` exists; G-01 of the tester `.test.sql` passes.

### P1-2 — Contact-keyed suppression row is silently dropped (SMS blast never honors opt-out)
- **Evidence:** RPC inserts two rows: `(v_user_id, NULL, …)` then `(v_user_id, v_contact, …)` (lines 211–221). The production unique index is `channel_suppressions_uniq_idx ON (COALESCE(user_id::text, contact), channel, scope, COALESCE(brand_id::text,'global'))` (confirmed read-only on remote). For BOTH rows `COALESCE(user_id, contact)=user_id` (non-null) → identical index key → the second INSERT hits `ON CONFLICT DO NOTHING` and is skipped. Real PG (after locally fixing P0): `set_marketing_suppression('sms',true)` returns 1, persists ONE row with `contact=NULL`; `SELECT … WHERE contact='+1555…'` → **0 rows**.
- **Impact:** `marketingAudience.resolveSuppressedPhones` matches on `channel_suppressions.contact`. With contact NULL, the suppressed user is NOT in `suppressedPhones` → the SMS marketing blast still texts a user who opted out in the prefs UI. (can_send(sms) DOES block via the user_id row, but the actual blast path keys off contact.) The report §10 "theoretical, only affects users with no email/phone" is incorrect — the contact row is dropped for EVERY user.
- **Required fix:** give the contact-keyed row a distinct unique key — e.g. write it with `user_id=NULL` (so its index key is `contact`), and broaden the opt-in DELETE to also remove `contact = v_contact` rows. Verified locally: this makes a `contact=phone` row persist and the tester G-02 passes while G-03 (cross-user) still passes.
- **Retest:** tester `.test.sql` G-02 (`contact='+1555…'` row exists) passes; an end-to-end SMS audience resolve excludes the opted-out phone.

### P2-3 — EMAIL opt-out via the RPC is not honored by the email blast
- **Evidence:** `supabase/functions/_shared/marketingAudience.ts` — `resolveBrandBuyers`/`resolveEventBuyers` build the email-suppression set ONLY from `marketing_unsubscribes` (`contact_email`); `aggregate` checks `unsubLookup` (email-keyed unsubs). `channel_suppressions(channel='email')` is consulted ONLY for phones (`resolveSuppressedPhones`), never for email. The RPC writes to `channel_suppressions`, not `marketing_unsubscribes`.
- **Impact:** Even after P0+P1 are fixed, a prefs-UI EMAIL marketing opt-out updates `can_send(email)` (blocks server-gated sends) but the actual email blast still includes the contact. The "single source of truth honored by BOTH can_send AND marketingAudience" claim (SC-6/SC-9) holds for SMS-only once P1 is fixed; email needs the audience email path to also read `channel_suppressions(channel='email', scope∈{marketing,all})`, OR the RPC must also write a `marketing_unsubscribes` row.
- **Required fix:** add a channel_suppressions email read to `aggregate`/`resolveBrandBuyers` (mirror the SMS phone path), keyed on `buyer_email`. (Smaller blast-radius than dual-writing two ledgers.)
- **Retest:** an email-keyed channel_suppressions row excludes the buyer from `reachable_email`.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **can_send Deno test** (`orch_1161_golive_can_send_marketing_optout.test.ts`): re-ran @ `f4f0d1346` → 5/5 pass. **Caveat:** this test is a TypeScript RE-IMPLEMENTATION of the SQL plus `sql.includes(...)` text anchors — it never compiles or runs the actual SQL, which is exactly why it could not catch P0/P1. The repo has a real-Postgres `.test.sql` precedent (orch_1116, orch_1150) that the implementor did not use here.
- **quiet-hours Deno test** (`quiet-hours-tz.test.ts`): re-ran → 6/6 pass. Re-implements the logic + srcContains anti-revert anchors; sound for the TZ logic.
- **matrix Node test** (`notificationPrefsMatrix.orch1161.golive.test.ts`): re-ran → 5/5 pass. Pure-logic, legitimate.
- **modified test** (`notificationPrefsMatrix.orch1161.test.ts`): the `[TEST-MOD-APPROVED META-ORCH-1161]` inversion (marketing default OFF→ON) is a legitimate, documented contract supersession per DEC-191 — not a weaken-to-pass.

## 5. Adversarial tests added (tester, different angle, real runtime)

1. `supabase/migrations/__tests__/orch_1161_golive_set_marketing_suppression.tester.test.sql` — real-Postgres `.test.sql`. G-01 (RPC exists / migration applied), G-02 (contact-keyed row persists for the audience resolver), G-03 (no cross-user row). **fails-on-revert verified at `f4f0d1346`:** FAILS (exit 3, G-01) on the as-shipped buggy migration; PASSES (exit 0) on a fully-fixed migration (P0 GET DIAGNOSTICS + P1 contact-row key both corrected). Different angle from the implementor's re-implementation: it executes the ACTUAL migration SQL against Postgres with the production unique index.
2. `supabase/functions/marketing-send/quiet-hours-tz.tester.test.ts` — extracts the ACTUAL `US_AREACODE_TZ` map from the deployed `index.ts` (not a hand-picked copy) and tests boundary cases the implementor omitted: 8:00/8:30/7:59 ET edges, 21:00 (9 PM) endHour-exclusive, Phoenix no-DST vs Denver, NG 20:00 WAT endHour-exclusive, null/empty country code. 8/8 pass.

Both files are append-only NEW files; will appear in the closing diff once committed by CLOSE.

## 6. Constitution 14-rule matrix (against the diff)

| # | Rule | Verdict |
|---|---|---|
| 1 | No dead taps | N/A (no new tap surface verified at runtime; blocked by P0) |
| 2 | One owner per truth | **FAIL** — channel_suppressions is claimed single owner of marketing opt-out but the contact row is dropped (P1) and the email blast reads a different ledger (P2); the two authorities (can_send vs blast) disagree. |
| 3 | No silent failures | **FAIL-adjacent** — the dropped contact row is a silent no-op (`ON CONFLICT DO NOTHING` swallows the collapse); the prefs UI reports success while the SMS blast still sends. |
| 4 | One query key per entity | N/A |
| 5 | Server state server-side | PASS (RPC is the RLS-correct write path; no Zustand) |
| 6 | Logout clears | N/A |
| 7 | TRANSITIONAL labeled | PASS (none introduced) |
| 8 | Subtract before adding | PASS (old opt-in branch removed; old Eastern anchor removed) |
| 9 | No fabricated data | PASS |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | PASS |
| 12 | Validate at right time (user datetime) | PASS — quiet-hours now uses recipient-local TZ (this is the fix) |
| 13 | Exclusion consistency | **FAIL** — can_send excludes by user_id|contact; the SMS blast excludes by contact only; the email blast excludes by a different table → inconsistent exclusion across the chokepoints. |
| 14 | Persisted-state startup | N/A |

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS | **BLOCKED** | prefs chip → RPC round-trip cannot be device-verified — the RPC migration does not apply (P0). A device run would 404 on the RPC. Re-run after P0+P1 fixed. |
| Consumer Android | **BLOCKED** | same shared RN core; same blocker. |
| Buyer/anon Web | N/A | not affected (no prefs matrix). |
| Business iOS/Android | N/A | not affected. |
| Admin Web / Business Web preview | N/A | not affected. |
| Backend (real Postgres) | **PROVEN** | can_send truth table + RPC battery executed against Postgres 15. |
| Live deploy state (read-only) | can_send on remote is still the OLD opt-in version (migration not yet applied — expected); `marketing-send` edge fn unchanged. |

Physical iPhone HITL: not requested — the feature is non-functional pre-fix (P0), so a device step is premature; deferred to RETEST after fixes.

## 8. Discoveries for orchestrator

- The can_send regression test pattern (TS re-implementation + `sql.includes`) is structurally blind to SQL compile/semantic errors. Recommend the repo's real-Postgres `.test.sql` harness for any RPC/migration with executable logic (orch_1116/1150 precedent). The tester `.test.sql` added here can seed that.
- `marketingAudience` has TWO email-suppression ledgers in play (`marketing_unsubscribes` vs `channel_suppressions`) — a latent split-authority that predates this ORCH; P2 surfaces it. Worth a consolidation ORCH.
- Open question from the report (no-email/no-phone user) is real but SUBSUMED by P1: the contact row is dropped for ALL users, not just contactless ones.

## 9. Accepted conditions

None — this is a FAIL, not a CONDITIONAL PASS. Routes to REWORK.

---

# RETEST 2026-06-20

**Verdict: PASS — 0 P0, 0 P1, 0 P2. CLEAR-TO-CLOSE.**
**Rework commits verified:** `0b9c8f9be` (3 defect fixes) + `fdfad5a47` (CI registration + IMPLEMENT REWORK report).
**Branch:** `ORCH-1161-golive-prep`. **Tester:** mingla-tester. **Evidence level:** `proven` — real Postgres **15.18** (Docker `postgres:15`, fresh container) + Deno 2.7.14.
**Comms ledger re-read on entry:** no BLOCK row targets `mingla-tester`, `META-ORCH-1161`, or `ORCH-1161`. The ALL-targeted rows are WARN/FYI process notes (eas OTA, edge-deploy hazards, RSVP-page restructure, 1148 Stripe idempotency) — different lanes/files; read, no ack required, no new cross-ORCH discovery to log.

## R1. Retest method (real Postgres, not the re-implemented unit tests)

Spun a fresh `postgres:15` container; built a faithful harness: `auth.users`/`auth.identities`, an `auth.uid()` stub reading `current_setting('test.uid')`, a `brands` FK stub, the `anon`/`authenticated`/`service_role` roles, and the production foundation tables from `20261110000000` — including the EXACT production unique index `channel_suppressions_uniq_idx ON (COALESCE(user_id::text, contact), channel, scope, COALESCE(brand_id::text,'global'))` (the index the P1 collapse hinges on, confirmed byte-identical via `pg_indexes.indexdef`). Then applied the real `20261113000000_orch_1161_golive_marketing_optout.sql` and ran the actual `.test.sql` files + direct row inspection. (The implementor's `.test.ts` for can_send is a TS re-implementation + `sql.includes` anchors — deliberately NOT trusted for the migration; all SQL findings below are from executing the real migration against Postgres.)

## R2. Per-defect close proofs

### P0 — CLOSED (real Postgres apply, no roll-back)
- The full apply chain ran: harness OK → foundation tables created → **`20261113000000` applied cleanly (`GOLIVE-APPLIED-OK`)**, no compile error, no roll-back.
- Post-apply: `pg_proc` shows BOTH `can_send(p_user_id uuid, p_category_key text, p_channel text, p_contact text)` and `set_marketing_suppression(p_channel text, p_suppress boolean)` exist. The `v_tmp int` + split `GET DIAGNOSTICS v_tmp = ROW_COUNT; v_affected := v_affected + v_tmp;` compiles.
- **Tester G-01 PASS** (`orch_1161_golive_set_marketing_suppression.tester.test.sql`, exit 0).
- **Fails-on-revert PROVEN:** restored the invalid expression-form `GET DIAGNOSTICS v_affected = v_affected + ROW_COUNT;` → migration aborts with the exact original error `ERROR: unrecognized GET DIAGNOSTICS item at or near "v_affected"`, and tester G-01 RAISEs (`set_marketing_suppression … does not exist`). Fixed version applies; reverted version does not.

### P1 — CLOSED (contact-keyed row persists; SMS blast honors opt-out; opt-in removes both)
- Independent row inspection (not the test's own assertions): `set_marketing_suppression('sms', true)` returns **2** and persists EXACTLY two rows — `(user_id=alice, contact=NULL)` AND `(user_id=NULL, contact='+15551234567')` — distinct unique-index keys, no collapse. `can_send` returns **false** via BOTH the `user_id` branch AND the contact-only/`user_id=NULL` branch (the blast/anon path). `set_marketing_suppression('sms', false)` returns **2** and leaves **0** rows.
- **Tester G-02 PASS** (contact-keyed row count ≥1) and **implementor roundtrip R-1/R-3/R-4 PASS** (`orch_1161_golive_marketing_optout_roundtrip.test.sql`, exit 0).
- The SMS audience resolver (`resolveSuppressedPhones`, keyed on `channel_suppressions.contact`) now finds the user — confirmed the contact-keyed row exists with the phone in E.164 `+15551234567`.
- **Fails-on-revert PROVEN:** rebuilt the contact INSERT to carry `v_user_id` (the original collapse) → `COALESCE(user_id, contact)` keys both rows identically → only 1 row persists, 0 contact-keyed. Tester G-02 RAISEs (`no contact-keyed sms marketing suppression row persisted … got 1 total rows, 0 contact-keyed`) and roundtrip R-1 RAISEs (`affected 1 rows, expected 2`). Fixed (`user_id=NULL`) version lands both.

### P2 — CLOSED (email blast reads channel_suppressions and excludes the opted-out email)
- Wiring verified in `supabase/functions/_shared/marketingAudience.ts`: new `resolveSuppressedEmails` queries `channel_suppressions` with `.eq('channel','email').in('scope',['marketing','all']).not('contact','is',null)`, lowercases `contact`, and is called in BOTH `resolveBrandBuyers` (L286) and `resolveEventBuyers` (L335), fed into `aggregate(... suppressedEmails)`; the `emailOk` gate now also checks `!suppressedEmails.has(emailKey)` (L418-419).
- **Email-suppression aggregate test PASS** (`marketingAudience.email-suppression.golive.test.ts`, 3/3): suppressed buyer NOT `reachable_email` (sms unaffected); case-insensitive email match; no-suppression both reachable.
- End-to-end key consistency confirmed: the RPC stores `contact=lower(email)` (real-PG row showed `alice@example.com`); the resolver lowercases `contact`; `aggregate` keys on lowercased email → matched.
- **Fails-on-revert PROVEN:** reverted the `emailOk` line to drop `!suppressedEmails.has(emailKey)` → 2/3 email-suppression tests FAIL; restored → 3/3 pass. File restored to as-committed.

## R3. No-regression (the parts that already passed)

| Area | Result | Evidence |
|---|---|---|
| Marketing default-ON in can_send | PASS | Real PG: `can_send(marketing_blast,email)` = **t** with no pref/suppression. can_send Deno 5/5. |
| Scope isolation (marketing opt-out ≠ transactional block) | PASS | Real PG: with alice's marketing-email opt-out active, `can_send(buyer_receipt,email)` = **t** and `can_send(buyer_receipt,sms)` = **t**. Roundtrip R-6 PASS. |
| set_marketing_suppression cross-user-write security | PASS | Real PG: after alice opt-out, **0** rows carry a non-NULL `user_id` other than the caller; victim user-2 `can_send(marketing,email)` = **t**. Tester G-03 PASS. |
| SMS phone-exclusion path | PASS (no regression) | `resolveSuppressedPhones` still wired (L285/L334); sms-suppression aggregate 2/2. |
| Quiet-hours recipient-TZ | PASS | Deno 14/14 (415 PT 5 AM blocked vs 212 ET 8 AM allowed same instant; 8:00 allowed/7:59 blocked; 21:00 endHour-exclusive; Phoenix no-DST; NG WAT; null→deny). |
| Text-dark / zero Twilio while off | PASS (unchanged) | Rework diff does not touch smsAdapter / kill-switches; no change since prior PASS. |

## R4. Constitution deltas vs prior FAIL

Rules 2 (one owner per truth), 3 (no silent failures), 13 (exclusion consistency) were the prior FAILs. All now **PASS**: `channel_suppressions` is the single opt-out authority honored by can_send (user_id|contact) AND both blast resolvers (contact-keyed phone + email); the contact row no longer silently collapses (returns 2, both persist); exclusion is consistent across all three chokepoints. No new violations introduced.

## R5. Device / parity

Backend-only + edge-fn-pure-logic change → no UI/runtime surface in this ORCH (the prefs-UI chips were verified in the Sub-A/SliceA reports; this ORCH is the can_send flip + RPC + audience resolver). Phase-0.A live-fire **exempt** (SQL migration + Deno pure-function). The prior FAIL's BLOCKED device rows (RPC 404 because migration didn't apply) are now MOOT — the migration applies and the RPC exists. Live deploy: NOT yet applied to remote (expected; CLOSE/operator deploys via `supabase db push` + edge-fn deploy from merged main).

## R6. Retest cycle count

Cycle 1 (single retest after one rework). Not stuck-in-loop.

## R7. RETEST verdict

**PASS — CLEAR-TO-CLOSE.** All three FAIL defects (P0 migration compile/apply, P1 SMS contact-row collapse, P2 email blast opt-out) are fixed and proven on real Postgres 15.18 + Deno, each with fails-on-revert. Zero regression to the previously-passing surfaces. Routes to the orchestrator for CLOSE. Reminder for CLOSE: deploy `marketing-send`/shared edge fns from MERGED main (not the worktree) and apply the migration via `db push` / Management API per the standing hazards.
