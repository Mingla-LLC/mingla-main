# INVESTIGATION — ORCH-1392 [proactive SECURITY DEFINER grant-hygiene sweep]

- **Phase:** INVESTIGATE (read-only). No fix proposed, no migration written.
- **Target:** prod Supabase `gqnoajqerqhnvulmnyvv` (the 2 Supabase projects — `gqno` is LIVE prod).
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]/` on branch `ORCH-1392-security-definer-grant-sweep` (rebased onto current `origin/main`).
- **Confidence:** the GRANT LEAK is **proven** (live `has_function_privilege` probes + Supabase security advisor, two independent methods, exact agreement). The EXPLOIT-REACHABILITY via the public anon key over PostgREST is **probable** — NOT live-fired, because the HARD GUARD forbids mutating prod and MCP `execute_sql` runs as service_role, not anon. See F-9.
- **Evidence:** `Mingla_Artifacts/evidence/ORCH-1392/definer_privilege_gate_inventory.csv` (full 340-row callable inventory), `LEAKERS_ranked.md` (ranked leaker table).

---

## 1. Symptom summary (expected vs actual)

**The class (proven twice):** `REVOKE ALL ON FUNCTION … FROM PUBLIC` does NOT strip Supabase's per-ROLE default EXECUTE grants. Supabase projects ship `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`, so every `CREATE FUNCTION` lands with direct `anon`/`authenticated` ACL entries. A PUBLIC-only revoke leaves the per-role grants intact. A SECURITY DEFINER function that is anon-executable AND lacks an internal `auth.uid()` gate (or trusts a caller-supplied identity param) = a latent auth-bypass. Shipped as ORCH-1338 P2-1 (`peer_list_event_guests`, `biz_set_event_guest_privacy`) and ORCH-1384 P0-1 (`partner_reissue_brand_invitation` — anon could mint a brand-ownership token).

- **Expected:** definer functions that trust the caller's identity are service_role-only (edge-fn-invoked) or authenticated-and-`auth.uid()`-gated; only deliberately-public reads are anon-executable.
- **Actual:** **279 of 399** SECURITY DEFINER functions on prod are anon-EXECUTE. Of the 227 that are RPC-callable (non-trigger), a large legacy subset are unintended leaks — including money-integrity, audit-tamper, and PII-exfil functions reachable by the public anon key.

---

## 2. Investigation manifest (read, in order)

1. `feedback_response_2_section_universal.md`, mingla-forensics skill — output + phase rules.
2. `COMMS_LEDGER.md` — active entries (grepped; see §Comms).
3. `supabase/migrations/20261227000000_orch_1338_p2_revoke_anon_execute.sql` — the precedent fix pattern (`REVOKE EXECUTE … FROM PUBLIC, anon; GRANT … TO authenticated;`) and the intended-anon spare (`pg_public_social_proof`).
4. Live prod `pg_proc`/`pg_namespace` — full definer enumeration + `has_function_privilege` probes (steps a–b).
5. Live prod `pg_proc.prosrc` — verbatim bodies of every A-bucket + representative B/C/D-bucket function (step c).
6. Supabase security advisor (`get_advisors security`) — independent corroboration.
7. Guard-helper bodies: `is_admin_user`, `biz_is_brand_member_for_read_for_caller`, `biz_ticket_checkout_assert_qr_pepper`.

---

## 3. Q-scorecard

- **Q1. How many SECURITY DEFINER functions exist, and how many are anon/authenticated-executable?**
  Verdict: 399 total (all in `public`); **279 anon-EXECUTE, 375 authenticated-EXECUTE, 22 service_role-only**. 52 of the 279 anon are trigger fns (not RPC-callable) → **227 callable anon-exposed**. (proven — F-1, F-9)
- **Q2. Which anon-executable definer functions mutate state with NO internal identity gate?**
  Verdict: ≥33 true leakers after correcting two heuristic blind spots (`auth.email()`/helper gates that are SAFE; TRUNCATE/REFRESH/http/aliased-UPDATE side-effects that my regex MISSED). (proven — F-2..F-6)
- **Q3. Are any of these HIGH-blast (money / ownership / auth / PII / destructive) — an EMERGENCY like ORCH-1384?**
  Verdict: YES — 5 near-one-call HIGH leaks: `biz_refund_order_commit_from_webhook`, `finalize_rsvp_contribution`, `anonymize_user_audit_log`, `fetch_user_going_rsvps`, `get_admin_emails`; plus 2 ownership/scanner-invite fns of the exact ORCH-1384 class (with a residual email-match barrier). (proven grant + body; probable reachability — F-2, F-3, F-7, F-9)
- **Q4. Which anon-executable functions are INTENDED-public and must be spared?**
  Verdict: the `pg_public_*` family + slug/discovery reads + username-availability + `submit_event_rsvp` + `biz_ticket_checkout_create_session` + RLS boolean predicate helpers. Grants are correct there. (proven — F-8)
- **Q5. Is the ORCH-1384 fix actually live on prod?**
  Verdict: YES — `partner_reissue_brand_invitation` is now `anon=0, authed=0, svc=1`. Do not re-touch. (proven — F-10)
- **Q6. Can a permanent CI gate kill this class?**
  Verdict: YES, but ONLY as a live `has_function_privilege` probe against an allowlist — a source-regex is provably unreliable (F-6). (design scoped — §8)

---

## 4. Findings (six-field evidence)

### F-1 — 279/399 definer functions are anon-executable · CONFIRMED ROOT CAUSE (surface)
- **Symptom:** massive anon-exposed definer surface.
- **Layer:** schema (grants).
- **Probe:** `SELECT count(*) FILTER (WHERE has_function_privilege('anon',p.oid,'EXECUTE')) … FROM pg_proc p JOIN pg_namespace n … WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')`.
- **Evidence:** `{total_secdef:399, anon_exec:279, authed_exec:375, svc_only:22}`; all 279 in `public` (52 trigger, 227 callable). Supabase advisor: `anon_security_definer_function_executable`=279 (exact match).
- **Mechanism:** default-privileges GRANT to anon on every CREATE FUNCTION; PUBLIC-only revokes (where present) never stripped the per-role anon grant.
- **Severity:** CONFIRMED ROOT CAUSE (the leak surface).

### F-2 — Money-integrity leaks: anon can forge refunds & mark contributions paid · CONFIRMED ROOT CAUSE
- **Symptom:** anon can corrupt financial state.
- **Layer:** schema (grant) + code (no caller gate).
- **Probe:** privilege probe (anon=true) + `pg_get_functiondef` for `biz_refund_order_commit_from_webhook`, `finalize_rsvp_contribution`.
- **Evidence:** `biz_refund_order_commit_from_webhook` — body has NO auth check; `SELECT * FROM orders WHERE id=p_order_id` then INSERT `refunds(status:'succeeded')`, `UPDATE orders SET payment_status='refunded'`, and `UPDATE tickets SET status='refunded'`. `finalize_rsvp_contribution` — `UPDATE event_rsvp_contributions SET status='paid', stripe_charge_id=… WHERE id=p_contribution_id` with no auth check, then fires host receipts. Both anon-EXECUTE.
- **Mechanism:** the name `…_from_webhook` and the receipt-firing show these are Stripe/Paystack-webhook (service_role) functions; anon EXECUTE lets any caller with the public anon key forge "succeeded refund" / "paid contribution" state by supplying a known `order_id`/`contribution_id` (UUIDs that appear in URLs/QRs/emails).
- **Severity:** CONFIRMED ROOT CAUSE (HIGH — money/data integrity).

### F-3 — Audit-tamper & PII-exfil: anon can wipe any audit log and dump any user's QR passes + admin emails · CONFIRMED ROOT CAUSE
- **Probe:** privilege probe + bodies of `anonymize_user_audit_log`, `fetch_user_going_rsvps`, `get_admin_emails`.
- **Evidence:** `anonymize_user_audit_log(p_user_id,p_salt)` — `UPDATE audit_log SET user_id=NULL, ip=NULL, user_agent=NULL, before/after redacted WHERE user_id=p_user_id`, no auth. `fetch_user_going_rsvps(p_user_id)` — returns `qr_code` (+ display_name, event/brand) for `WHERE r.user_id=p_user_id`, no auth. `get_admin_emails()` — `SELECT email,status FROM admin_users WHERE status IN ('active','invited')`, no auth. All anon-EXECUTE.
- **Mechanism:** one anon RPC call each → destroy a user's forensic/audit trail; exfiltrate any user's ticket QR codes (forgery/impersonation at entry) + attendance PII; enumerate all admin emails (targeted phishing/ATO).
- **Severity:** CONFIRMED ROOT CAUSE (HIGH — auth/integrity/PII).

### F-4 — ORCH-1384-class ownership/scanner invite accept trusts caller-supplied account id · SECONDARY ROOT CAUSE
- **Probe:** bodies of `accept_invite_and_transfer_brand_ownership`, `accept_scanner_invitation`.
- **Evidence:** both take `(p_token_hash text, p_accepting_account_id uuid)`, resolve the acceptor from the caller-supplied `p_accepting_account_id`, and `RAISE 'invite_email_mismatch'` unless `lower(acceptor_email)=lower(invitation.email)`. The brand one runs `UPDATE brands SET account_id=p_accepting_account_id`. Both anon-EXECUTE, no `auth.uid()`.
- **Mechanism:** exact ORCH-1384 shape (trusts caller-supplied identity; grant is not the barrier). Residual barrier = token_hash secrecy + the invited-email must equal the accepting account's email, so it is NOT a clean one-call takeover — but the grant must still be service_role/authenticated.
- **Severity:** SECONDARY ROOT CAUSE (HIGH-by-class; residual email-match reduces practical exploitability below ORCH-1384 P0-1).

### F-5 — Partner-payout ledger + trial/chat/collab/cron tamper cluster · SECONDARY ROOT CAUSE
- **Evidence (anon-EXECUTE, no gate):** `mark_partner_split_transferred/_reversed/_failed`, `bump_paystack_partner_split_attempt`, `mark_paystack_partner_split_attempted`, `record_partner_split_attempt`, `record_paystack_partner_split_attempt` (payout-ledger writes keyed on the Stripe `application_fee_id`); `truncate_seed_map_presence` (`TRUNCATE seed_map_presence`); `add_buyer_to_event_chat`, `get_or_create_direct_conversation`, `remove_participant_prefs`, `upsert_participant_prefs`, `execute_undo_action`, `record_trial_phone`, `expire_agent_pending_actions`, `pg_expand_experience_recurrence`, `pg_topup_recurring_experiences`, `pg_try/release_discover_cache_build_lock`, `tg_kick_pending_trial_runs`, `tg_kick_pending_thumb_backfill`, `tg_meta_orch_1009_sub_d_kick_rescores`, `cron_refresh_admin_place_pool_mv`.
- **Mechanism:** ledger poisoning/starvation, table truncation, chat/collab griefing, trial-abuse table poisoning, mass event-date generation, and `net.http_post`-driven resource abuse — all by anon.
- **Severity:** SECONDARY ROOT CAUSE (MED). Full per-fn detail in `LEAKERS_ranked.md` Tier 2.

### F-6 — Body-regex gate/mutation heuristics are unreliable · CONFIRMED (drives the CI-gate design)
- **Evidence — FALSE "ungated" (actually SAFE):** `admin_edit_place` gates on `auth.email()` against `admin_users`; `admin_grant_override`/`admin_revoke_override`/all `admin_*` gate on `is_admin_user()` (which reads `auth.users WHERE id=auth.uid()` → anon NULL → FALSE); `biz_retry_installment` gates on `biz_is_brand_member_for_read_for_caller` = `biz_is_brand_member_for_read(brand, auth.uid())`. My first-pass `auth.uid()`-only regex flagged all of these as leaks (43 false-positive HIGH → 30 after expansion).
- **Evidence — FALSE "readonly/gated" (actually LEAKS):** `truncate_seed_map_presence` (TRUNCATE, not caught by insert/update/delete), `cron_refresh_admin_place_pool_mv` (REFRESH MATVIEW), `tg_kick_pending_thumb_backfill` (aliased `UPDATE … b SET` defeated `update\s+<tbl>\s+set`; also `net.http_post`), `tg_meta_orch_1009_sub_d_kick_rescores` (http-only side-effect); `biz_ticket_scan` mis-flagged "gated" because its `assert_qr_pepper` helper matched the `assert_` token (that helper only checks pepper length≥32, NOT a server secret — the real barrier is that the pepper must reproduce the stored QR hash, but the scanner-identity `p_scanner_user_id` is still caller-supplied/trusted).
- **Mechanism:** a source-parse cannot reliably distinguish gated-vs-ungated or mutating-vs-readonly (helper gates, `auth.email()`, TRUNCATE/REFRESH/COPY, `net.http_post`, table aliases, dynamic SQL). Only the live effective-privilege ACL is authoritative.
- **Severity:** CONFIRMED (methodological — mandates a live-probe CI gate, §8).

### F-7 — `is_admin_user()` and the caller-wrapper pattern are SOUND · RULED OUT (as leaks)
- **Evidence:** `is_admin_user()` = `SELECT email FROM auth.users WHERE id=auth.uid()` → if NULL RETURN FALSE → EXISTS admin_users. Anon (`auth.uid()` NULL) → FALSE. The `*_for_caller` wrappers (e.g. `biz_is_brand_member_for_read_for_caller`) inject `auth.uid()` into the raw predicate.
- **Severity:** RULED OUT — B_MUT_GATED `admin_*`/`biz_*` fns are safe against anon despite anon-EXECUTE; do NOT include them in the hardening list.

### F-8 — Intended-public anon functions must be spared · RULED OUT (as leaks)
- **Evidence:** `pg_public_event_by_slug`, `pg_public_trip_by_slug`, `pg_public_experience_by_slug`, `pg_public_rsvp_by_slug`, `pg_public_brand_upcoming`, `pg_public_experiences_by_brand`, `pg_public_trips_by_brand`, `pg_public_ticket_types_remaining`, `pg_public_event_tier_allin`, `pg_public_social_proof`, `pg_published_trips_public`, `pg_discover_business_events`, `check_username_availability`, `is_username_available` — power the public event/trip/experience pages, ticket availability, and signup username checks. `submit_event_rsvp` and `biz_ticket_checkout_create_session` are the public RSVP + anonymous web-checkout entry points. The ORCH-1338 precedent explicitly spared `pg_public_social_proof`.
- **Severity:** RULED OUT — grants are correct. NB: `submit_event_rsvp`/`biz_ticket_checkout_create_session` trust `p_user_id`/`p_buyer_user_id` when supplied — that is a body-logic hardening (bind to `auth.uid()` when non-null), NOT a grant revoke; log it as a Discovery, do not revoke anon.

### F-9 — Exploit reachability is PROBABLE, not live-fired · disclosure
- **Evidence:** the anon key is public (embedded in both apps). PostgREST exposes any `public`-schema function the caller's role can EXECUTE at `POST /rest/v1/rpc/<fn>`. Every leaker above has `has_function_privilege('anon', …,'EXECUTE')=true`.
- **Not done:** I did NOT POST any RPC to prod (HARD GUARD: read-only; MCP `execute_sql` runs as service_role/postgres, so it cannot stand in for the anon role). The grant is CONFIRMED; end-to-end anon exploitation is inferred from standard PostgREST behavior = **probable**. A definitive proof would be a single harmless anon RPC that RAISEs before any mutation (e.g. `biz_refund_order_commit_from_webhook` with a bogus order_id → `order_not_found`) — deferred to TEST, not run here.
- **Severity:** disclosure (confidence discipline per skill Prime Directive 7).

### F-10 — ORCH-1384 P0-1 hardening is LIVE on prod · RULED OUT (already fixed)
- **Evidence:** `partner_reissue_brand_invitation` probes `anon=0, authed=0, svc=1`. (Its migration file is not yet merged to `main` — it was hot-patched to prod on the ORCH-1384 branch, mid-REWORK per COMMS.)
- **Severity:** RULED OUT — do NOT re-touch its grants (dispatch HARD GUARD).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| Docs | ORCH-1338 P2 migration documents the class + the intended two-layer defense; expects definer fns to be authenticated/service_role unless deliberately public. | — |
| Schema (grants) | 279/399 definer fns anon-EXECUTE; only 22 service_role-only. | **YES** — the schema grants contradict the documented intent for ≥33 leakers. The gap IS the bug class. |
| Code (bodies) | Most `admin_*`/`biz_*` DO gate internally (is_admin_user / *_for_caller); a legacy subset do not (and trust caller-supplied ids). | **YES** — the internal gate, where present, is the ONLY barrier; the grant layer is not. Where absent (F-2..F-5), nothing stops anon. |
| Runtime | Not live-fired (read-only guard); reachability inferred from PostgREST exposure of anon-EXECUTE public fns. | flagged (F-9) |
| Data | n/a (no data read beyond function metadata). | — |

---

## 6. Repro evidence
Read-only probes only; no reproducer fired against prod (HARD GUARD). All evidence is live `has_function_privilege` + verbatim `pg_proc.prosrc` + the Supabase security advisor. Full machine table: `evidence/ORCH-1392/definer_privilege_gate_inventory.csv`. Negative verdict on live exploitation: **not reproduced (deliberately not attempted)** — see F-9.

---

## 7. Blast radius / cross-surface map
- **Reached by:** any client bearing the public anon key = every surface (Consumer iOS/Android, Buyer/anonymous Web, Business iOS/Android, Admin Web) AND any third party who copies the anon key from a shipped bundle. The exposure is at the DB grant layer, upstream of all app code — surface-agnostic.
- **In-scope for the follow-on hardening SPEC:** the ≥33 mutating/side-effect leakers (F-2, F-4, F-5, plus the heuristic-missed set) + the read-only HIGH exfil pair (`get_admin_emails`, `fetch_user_going_rsvps`) + the read-only recon set (F-5 tail).
- **Out-of-scope / spare:** F-7 (gated `admin_*`/`biz_*`), F-8 (intended-public), F-10 (`partner_reissue_brand_invitation` already fixed).

---

## 8. CI-gate feasibility (scoped for the SPEC — NOT built here)
**Goal:** assert "no SECURITY DEFINER fn ships anon-executable unless it is on an allowlist marking it intentionally-public."

**Source of truth MUST be a live effective-privilege probe, not a migration grep or a body-regex.** F-6 proves a body/source parse is unreliable (misses TRUNCATE/REFRESH/`net.http_post`/aliased-UPDATE; false-flags helper- and `auth.email()`-gated fns). A migration-grep is also unreliable because the anon grant is implicit (default privileges), never written in a migration.

**Recommended shape (for the SPEC to specify, not this phase):**
1. **Allowlist file** (checked into the repo), e.g. `supabase/security/anon_executable_definer_allowlist.txt` — one function signature per line, each with a required justification comment (the intentionally-public set: `pg_public_*`, slug reads, username-availability, `submit_event_rsvp`, `biz_ticket_checkout_create_session`, and the low-risk RLS predicate helpers if the team elects to keep them anon).
2. **A CI step** that connects to a DB (a disposable branch DB seeded from migrations, or a read-only prod probe in a scheduled job) and runs the same query used here:
   `SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc p JOIN pg_namespace n … WHERE prosecdef AND nspname='public' AND prorettype<>'trigger'::regtype AND has_function_privilege('anon',oid,'EXECUTE')`.
3. **Assertion:** every returned signature MUST appear in the allowlist; any not-listed anon-executable definer fn FAILS the build with a message naming the fn + "add an explicit `REVOKE EXECUTE … FROM anon` migration OR allowlist it as intentionally-public."
4. **Fails-on-revert property:** reverting a hardening REVOKE re-adds the fn to the live probe result → not in allowlist → CI red. Adding a new definer fn without revoking anon → CI red by default (safe-by-default).
5. **Complements** the existing Supabase advisor lint `anon_security_definer_function_executable` (same signal), but the CI gate makes it blocking + allowlist-scoped.

Decisions the SPEC must settle (Open Questions): (a) probe target — branch DB vs scheduled read-only prod probe; (b) whether to also gate `authenticated`-executable definer fns (375 today) or only anon; (c) whether the low-risk RLS predicate helpers get allowlisted or revoked-from-anon.

---

## 9. Invariant impact
- Reinforces the ORCH-1338/1384 class invariant (definer fns must not rely on the grant layer as their only auth barrier). Candidate NEW invariant for the SPEC to propose as DRAFT: `I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER` — "no SECURITY DEFINER function in `public` is anon-EXECUTE unless on the intentionally-public allowlist." (I do NOT flip it ACTIVE — orchestrator owns that at CLOSE.)
- No existing invariant is violated by this READ-ONLY investigation.

---

## 10. Discoveries for Orchestrator (side issues)
1. **Supabase security advisor backlog** (out of this sweep's scope): `function_search_path_mutable`=134, `rls_disabled_in_public`=12, `rls_enabled_no_policy`=16, `public_bucket_allows_listing`=8, `security_definer_view`=5, `rls_policy_always_true`=3, `extension_in_public`=2, `materialized_view_in_api`=1. Each is a separate hardening item.
2. **Body-logic (not grant) hardening:** `submit_event_rsvp` and `biz_ticket_checkout_create_session` trust `p_user_id`/`p_buyer_user_id` when supplied — bind to `auth.uid()` when non-null so an authed impersonation path is closed while keeping the anon guest path. `upsert_participant_prefs`/`remove_participant_prefs` gate asymmetry (the latter has no membership check at all).
3. **`biz_ticket_scan`** trusts caller-supplied `p_scanner_user_id`; real ticket-marking is currently gated only by QR-pepper secrecy — worth an explicit service_role grant + caller binding even though the pepper holds today.
4. **375 authenticated-executable definer fns** — a second, larger tier (any logged-in user). Not in this sweep's anon focus, but the same `*_for_caller` discipline should be audited there next.

---

## 11. Confidence + recommended next phase
- **Confidence:** grant leak **proven**; HIGH-blast classification **proven** (grant + verbatim body); end-to-end anon exploitation **probable** (not live-fired per read-only guard, F-9).
- **Recommended next phase:** REVIEW → SPEC. Scope for the SPEC: (i) a grants-only, idempotent hardening migration (`REVOKE EXECUTE … FROM PUBLIC, anon; GRANT … TO <authenticated|service_role>`) for the ≥33 mutating/side-effect leakers + the 2 read-only HIGH exfil fns + the read-only recon set — modeled on `20261227000000_orch_1338_p2_revoke_anon_execute.sql`, sparing the F-7/F-8/F-10 sets; (ii) the class-killing live-probe CI gate + allowlist (§8). NO fix or migration is proposed here.
- **EMERGENCY flag for the orchestrator:** `biz_refund_order_commit_from_webhook`, `finalize_rsvp_contribution`, `anonymize_user_audit_log`, `fetch_user_going_rsvps`, `get_admin_emails` are live anon-executable HIGH leaks (money-integrity / audit-tamper / PII). None is a clean money-OUT exfiltration (they corrupt state / exfil data rather than move funds to an attacker account), so this is a notch below ORCH-1384 P0-1 — but a same-day grants-only REVOKE hot-patch is warranted, exactly as done for ORCH-1384.
