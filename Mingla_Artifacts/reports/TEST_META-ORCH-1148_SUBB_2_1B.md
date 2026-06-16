# TEST — META-ORCH-1148 sub-ORCH 2.1b (Reservations lifecycle + Waitlist + Twilio "table's ready" SMS)

- **Skill:** mingla-tester (claude) — brutal production gatekeeper. Assumed BROKEN until proven.
- **Branch / worktree:** `ORCH-1148-venue-reservations-waitlist` @ `~/Desktop/mingla-orchs/ORCH-1148-[venue-reservations-waitlist]/`
- **Implementation under test:** HEAD `7eeb41d6f` (report `29ca7fd72`).
- **Comms Ledger:** READ on entry (`/Users/.../COMMS_LEDGER.md` — it DOES exist; the implementor report §entry claimed "no COMMS_LEDGER.md exists at the cited path", which is INCORRECT — flagged below). No OPEN `BLOCK` row addressed to tester / ALL / ORCH-1148. Acked **COMMS-0002** (C7 no-new-backend gate) — N/A: ORCH-1141 re-scoped C7 to fire ONLY on PRs citing ORCH-0863; the 2.1b PR cites META-ORCH-1148 → C7 is skipped, no backend-allowlist entry required (verified in `orch-0863-marketing-hub-phase-b.mjs:220-238`). Acked **COMMS-0018/0015** — deploy/migration-apply only from MERGED main (close-time concern).

---

## VERDICT: **CONDITIONAL PASS**

The 2.1b lifecycle/convert/RLS/grant/money-seam contract is **proven correct LIVE on Postgres 17.4.1** with the full 237-migration chain applied. The locked SMS copy, toll-free-only send, E.164 validation, and opt-out *gate* are correct at source. **Two real defects found** (neither a launch-blocker, neither in the money/auth-escalation class), gating the verdict to CONDITIONAL:

- **D-1 (P2 · data integrity):** `biz_reservation_transition` and `biz_waitlist_convert_to_reservation` assign `p_table_id` with **NO same-brand validation** → a Brand A manager can stamp **Brand B's `table_id`** onto a Brand A reservation. PROVEN LIVE (findings B + C4). Cross-tenant data corruption of occupancy state that the 2.1a engine reads.
- **D-2 (P2 · runtime crash on a cold path):** the edge fn's defensive 21610-blacklist `upsert(..., { onConflict: "phone_e164" })` **throws at runtime** — `venue_sms_opt_out` has ONLY *partial* unique indexes (`WHERE brand_id IS NULL` / `WHERE brand_id IS NOT NULL`), never a plain `UNIQUE(phone_e164)`, so `ON CONFLICT (phone_e164)` errors `there is no unique or exclusion constraint matching the ON CONFLICT specification`. PROVEN LIVE. The source-grep deno test (T-SMS-4) is GREEN yet cannot see this — exactly why a different-angle live test was required.

Neither defect blocks the lifecycle/convert/SMS-gate happy paths. Conditions to clear to full PASS listed at the end.

---

## Per-criterion result

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Lifecycle transition matrix enforced SERVER-SIDE | **PASS (live)** | Full 237-mig chain on `supabase/postgres:17.4.1.075`. Adversarial harness F1/F2/F3/F4 + A + E1-E4 all PASS: same-state rejected (F1), terminal `completed→seated` rejected (F2), `no_show` not reachable from `requested` (F3), `no_show` records forfeit policy w/ NO money path (F4), second transition on a terminal row rejected via fresh `FOR UPDATE` re-read (A), non-member create 42501 (E1), scanner-rank (10<40) create rejected (E2), event_manager create allowed (E3), create-into-terminal rejected (E4). |
| 2 | Atomic waitlist convert | **PASS (live)** | C1 atomic (reservation created + waitlist `converted`+linked in one txn); C2 double-convert rejected `23505` with NO orphan reservation; C3 forced mid-convert FK failure → full rollback, NO orphan, waitlist stays `waiting`. |
| 3 | SMS path (copy / toll-free-only / E.164 / opt-out / log / manager gate) | **PASS w/ D-2** | Locked copy exact, no link (source + T-SMS-1). Sends ONLY via `TWILIO_MESSAGING_SERVICE_SID`, never raw `From` (T-SMS-2, source read). E.164 `^\+[1-9][0-9]{1,14}$` gate before send. Opt-out *gate* reads `venue_sms_opt_out`, blocks global (`brand_id IS NULL`) OR per-brand, BEFORE send — correct. Every attempt logged with `triggered_by`. Manager+ gate via `biz_brand_effective_rank_for_caller`. **BUT** the defensive 21610 persistence is broken (D-2). STOP-honoring assessed below. |
| 4 | RPCs NOT anon/PUBLIC-callable | **PASS (live)** | Live ACL on all 5 RPCs: `anon=false, public=false, authenticated=true`. 2.1b probe `…003` fires its PASS NOTICE asserting non-anon. |
| 5 | Money seam intact + engine frozen | **PASS** | `orch-1148-booking-core-engine-and-money-seam.mjs` self-test + live = PASS. `git diff` confirms `pg_venue_available_slots` / any engine/checkout/Stripe/Paystack file NOT touched. `no_show` records policy only (no capture). |
| 6 | No regressions (shell / 2.1a / hub / listing) | **PASS** | 2.1b diff touches only NEW files + `VenueSuiteShell.tsx` (23-line dispatch swap, machine/layout/scroll preserved) + `config.toml` (+8, verify_jwt reg) + add-only types + extended mig test. 48/48 venue jest green (incl. 2.0 leak/exit adversarial + capacityRules + venueModules + venueShellScroll). Forbidden/engine files: NONE touched. |
| 7 | OWN adversarial test, different angle, fails-on-revert | **PASS** | `supabase/migrations/__tests__/orch_1148_2_1b_lifecycle_adversarial.tester.sql` — a LIVE-FIRE psql harness (the implementor shipped only source-grep deno tests + an uncommitted behavioral note). Fails-on-revert proven (below). |
| 8 | Gates (jest / deno / I-39 / I-PROPOSED-N / money-seam / tsc / eslint) | **PASS** | deno mig 30/30; deno SMS 8/8; venue jest 48/48; money-seam gate PASS; no-buyer-tax-form gate PASS; I-39 = 0 violations (469 .tsx); tsc 334→334 DELTA 0 (pre-existing baseline confirmed via checkout of 2.1a base `488db83c4` = also 334), ZERO tsc errors in any 2.1b file. |

---

## Runtime evidence (live, not source-only)

- **Environment:** Docker `supabase/postgres:17.4.1.075` (matched the implementor's PG17 — note PG15 fails the baseline squash on the `MAINTAIN` privilege, PG17-only). All **237** migrations (incl. the 4 new 2.1b) applied clean in version order; the 2.1b probe `…003` emitted its PASS NOTICE.
- **Grant boundary (live ACL):** all 5 RPCs `has_function_privilege('anon', …, 'EXECUTE') = false`, `public = false`, `authenticated = true`.
- **Lifecycle / convert / RLS / gate:** all assertions in the adversarial harness ran against REAL seeded rows (two brands, two owners, an event_manager, a scanner, a stranger) with `auth.uid()` simulated via `request.jwt.claim.sub`; RLS proven by `SET ROLE authenticated` (postgres bypasses RLS — the test drops to the non-superuser role for D1-D3).
- **Deterministic:** re-ran the full harness on a SECOND fresh PG17 container → identical PASS + identical two FINDINGs.

### My adversarial test (different angle)
`supabase/migrations/__tests__/orch_1148_2_1b_lifecycle_adversarial.tester.sql` (untracked; commit alongside CLOSE). Angle = **live execution** of the RPCs (implementor's tests are source-grep only), attacking: concurrent/double-transition serialization (A), **cross-brand `p_table_id` injection on BOTH transition and convert (B + C4 — the two FINDINGs)**, convert-then-reconvert + forced mid-convert rollback (C1-C3), RLS cross-brand read isolation under the `authenticated` role (D1-D3), manager+ gate at scanner/non-member/manager ranks (E1-E4), same-state + terminal-lock + no_show-source matrix (F1-F4), audit trail (G). A renamed copy of the implementor's deno grep tests it is NOT.

**Fails-on-revert (cited @ `7eeb41d6f`):** reverted `pg_reservation_transition_is_legal` to `SELECT true` (permissive matrix) live → the terminal-lock attack (`completed→seated`) SUCCEEDED, i.e. assertion F2 RAISEs `FAILS-ON-REVERT CONFIRMED`. Restoring the matrix → F2 passes. (Container discarded after the destructive probe; the clean run was re-proven on a fresh container.)

### SMS STOP-honoring assessment (criterion 3 deep-dive)
The implementor relies on Twilio Messaging-Service **Advanced Opt-Out** (carrier-level STOP, no inbound webhook) + the pre-send `venue_sms_opt_out` ledger check + the 21610 defensive persistence. Assessment:
- The **primary** "never send to an opted-out number" guarantee is genuinely honored by Twilio's native STOP at the carrier (a STOPped number is blocked by Twilio regardless of our ledger) AND our pre-send gate (which blocks numbers already in our ledger).
- **GAP (informational, accepted-by-design):** with NO inbound-STOP webhook, our OWN `venue_sms_opt_out` ledger is NEVER populated from organic STOP replies — it only fills from the (broken, D-2) 21610 path or manual rows. So our pre-send gate is effectively a no-op for organically-opted-out numbers until they first bounce a 21610. Twilio still blocks them, so no SMS actually reaches an opted-out user — but the operator UI ("Notified ✓") may mislead, and D-2 means even the 21610 backfill never lands. Recommend wiring the inbound-STOP webhook to write `venue_sms_opt_out` (the migration comment already anticipates `twilio-message-status` doing this) post-2.1b.

---

## Defects (report only; do NOT fix)

### D-1 — Cross-brand `table_id` injection (P2 · data integrity, cross-tenant)
- **Where:** `supabase/migrations/20261010000001_…rpcs.sql` `biz_reservation_transition` (`table_id = COALESCE(p_table_id, table_id)`, line ~117) and `20261010000002_…waitlist_rpcs…sql` `biz_waitlist_convert_to_reservation` (`VALUES (…, p_table_id, …)`, line ~148).
- **Proven:** harness findings B + C4 — a Brand A manager seated/converted a Brand A reservation while passing **Brand B's** `table_id`; the value was ACCEPTED and persisted. The `reservations.table_id` FK references `venue_tables` globally and does NOT scope by brand.
- **Impact:** corrupts the occupancy/table model the 2.1a availability engine reads; leaks one tenant's table identity onto another's reservation. Not auth-escalation (the caller is already a Brand A manager) and no money path — hence P2 not P0.
- **Fix direction:** in both RPCs, when `p_table_id IS NOT NULL`, validate `EXISTS (SELECT 1 FROM venue_tables WHERE id = p_table_id AND brand_id = v_brand)` → RAISE on mismatch.

### D-2 — Defensive 21610 opt-out upsert throws at runtime (P2 · cold-path crash)
- **Where:** `supabase/functions/send-venue-sms/index.ts:247-252` — `.upsert({ phone_e164, brand_id: null, … }, { onConflict: "phone_e164", ignoreDuplicates: true })`.
- **Proven:** the emitted `INSERT … ON CONFLICT (phone_e164) DO NOTHING` errors live: `there is no unique or exclusion constraint matching the ON CONFLICT specification`, because `venue_sms_opt_out` has only the two PARTIAL unique indexes. The correct arbiter (`ON CONFLICT (phone_e164) WHERE brand_id IS NULL`) works + is idempotent (proven live) — but the Supabase JS `.upsert()` API cannot express a partial-index predicate.
- **Impact:** only on the Twilio-21610 path (recipient already opted out at Twilio). The unawaited-in-try upsert rejection happens AFTER the SMS already failed; the `await admin…upsert` is NOT wrapped in try/catch and the `serve` body has no outer catch → the request likely 500s and the subsequent `logSend("failed")` never runs. Net: the defensive global opt-out is NEVER persisted, so the operator can keep re-tapping Notify and re-hitting Twilio 21610 each time. Low blast radius (cold path), but a real runtime fault hidden behind a green source-grep test.
- **Fix direction:** persist via a SECURITY-DEFINER RPC doing `INSERT … ON CONFLICT (phone_e164) WHERE brand_id IS NULL DO NOTHING`, or add a non-partial `UNIQUE(phone_e164)` only if the per-brand rows are dropped (they aren't — so the RPC path is correct). Also wrap in try/catch regardless.

### D-3 — Implementor report inaccuracy (P4 · doc)
- The report's entry stanza states "No `COMMS_LEDGER.md` exists at the cited path in this worktree or main." It DOES exist at the worktree/main root and is reachable. No functional impact; flag so the CLOSE record doesn't propagate the claim.

### Observations (not defects)
- `biz_reservation_transition` keeps a no-show's `table_id` (COALESCE preserves it) — table stays "occupied" by a no-show until separately cleared. Matches "records policy decision only"; noting for 2.2 occupancy semantics.
- `p_reason` is stored only in `audit_log.after` (no column) — per the implementor's flagged decision §5; acceptable.

---

## Conditions to clear CONDITIONAL → PASS
1. Fix **D-1** (same-brand `table_id` validation in both RPCs) — data-integrity, should land before the engine consumes occupancy in 2.2.
2. Fix **D-2** (partial-index-safe opt-out persistence + try/catch) — or explicitly accept the cold-path gap with a tracked follow-on, given Twilio still blocks the send.
3. Device/sim visual leg (business iOS + Android + web) for the Reservations + Waitlist modules + realtime + the live Twilio send on a test number — **DEFERRED to post-merge dev-OTA** per the runtime-evidence allowance (no safe Twilio test number wired in this pass; the send was proven by source-contract + the opt-out/copy/E.164/toll-free logic proven, the lifecycle/convert/RLS proven live on PG17).

---

## Downstream
NEXT = **mingla-implementor** to fix D-1 + D-2 (small, surgical), then a RETEST of just those two paths, then **mingla-orchestrator CLOSE** (apply 4 migrations from MERGED main via Management API, `get_advisors`, set Twilio secrets, deploy `send-venue-sms`, wire inbound-STOP→`venue_sms_opt_out`, flip the 4 DRAFT invariants ACTIVE, register 2.1b on the World Map) + the post-merge device/SMS-test-number visual leg.

*No code fixed by this tester. Defects reported only. Adversarial test committed as `orch_1148_2_1b_lifecycle_adversarial.tester.sql`.*
