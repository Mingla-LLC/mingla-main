# SPEC — ORCH-1392 [SECURITY DEFINER grant-hygiene sweep — durable fix]

- **Phase:** SPEC (contract only — no code applied). Follows `reports/INVESTIGATION_ORCH-1392_SECURITY_DEFINER_GRANT_SWEEP.md` (commit `0193374fe`) + evidence `evidence/ORCH-1392/{definer_privilege_gate_inventory.csv, LEAKERS_ranked.md}`.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]/` on branch `ORCH-1392-security-definer-grant-sweep` (rebased onto current `origin/main`).
- **Target DB:** prod Supabase `gqnoajqerqhnvulmnyvv`.
- **All function signatures + current effective grants in this SPEC were re-probed live (read-only) 2026-07-18** via `pg_get_function_identity_arguments` + `has_function_privilege` — the migration below uses the EXACT identity-argument signatures returned by prod (overload-safe).

---

## 1. Executive summary

Supabase auto-grants `EXECUTE` to the `anon` role on every function it ships (`ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`). A `REVOKE ALL … FROM PUBLIC` does NOT strip that per-role grant, so a SECURITY DEFINER function that trusts a caller-supplied identity and lacks an internal gate becomes an anon auth-bypass. The investigation found **279 of 399** prod definer functions anon-executable, **≥33 true leakers**, and **5 live HIGH holes** (forge-refund, forge-paid-contribution, wipe-audit-log, QR-code exfil, admin-email dump) + 2 ORCH-1384-class accept functions. The orchestrator already **hot-patched 7 functions live** (grants-only, verified anon=false).

This SPEC makes the hot-patch **durable** and **extends** it, in three deliverables:

1. **One idempotent, grants-first migration** (`20270104000000_orch_1392_security_definer_grant_sweep.sql`) that (a) re-asserts the 7 hot-patched grants so fresh environments converge, (b) revokes anon (and, where backend-only, authenticated) from the remaining **≥26 Tier-2 leakers** to their intended role, and (c) applies the **2 internal-gate body fixes** (`fetch_user_going_rsvps`, `get_admin_emails`) that grants alone cannot fix — all with post-apply `has_function_privilege` DO-block asserts. **The intended-public set is explicitly spared** (documented DO-NOT-REVOKE list).
2. **A class-killing CI gate** — a live `has_function_privilege('anon', …, 'EXECUTE')` probe against the CI Supabase-Postgres (after migrations apply) that FAILS the build if any non-trigger SECURITY DEFINER function in `public` is anon-executable and NOT on a checked-in `anon_executable_definer_allowlist.txt`. A source-regex was proven unreliable (INVESTIGATION F-6); the live probe is authoritative.
3. **A two-sided regression contract** — a static migration-text test (fails if a REVOKE line is deleted) + the live gate (fails if a function becomes anon-executable at runtime and is not allowlisted).

Non-user-facing: this is a backend grant/gate change. No screen changes; the only observable app behavior is that the already-closed anon exploits stay closed and two authenticated-abuse residuals are closed.

---

## 2. Scope & non-goals

### In scope
- **41 functions** get an explicit, idempotent EXECUTE grant per their intended role (23 → service_role only; 18 → authenticated, anon revoked). This includes re-asserting the 7 already-hot-patched functions.
- **2 functions** additionally get a `CREATE OR REPLACE` body gate (`fetch_user_going_rsvps` → `auth.uid()` self-check; `get_admin_emails` → `is_admin_user()` admin check). These two live in the SAME migration.
- **1 CI gate** (new workflow + probe script + allowlist file) + **1 static regression test**.

### Explicit non-goals (and why)
- **No function body changes other than the 2 named gate fixes.** The gated `admin_*`/`biz_*` families (INVESTIGATION F-7) are already safe (they gate on `is_admin_user()` / `*_for_caller`); their bodies and their (allowlisted) anon grant are untouched.
- **No re-widening of any grant.** Never grant anon to anything not already intended-public.
- **No touch to the intended-public set** — see §4.4 DO-NOT-REVOKE. Their public pages depend on anon EXECUTE.
- **No touch to `partner_reissue_brand_invitation`** (ORCH-1384 P0-1, already service_role-only, live) or the ORCH-1384 migrations `20270102000000` / `20270103000000`.
- **The `authenticated`-executable tier (375 fns) is NOT swept here.** The gate probes `anon` only. Sweeping the authenticated tier is Discovery #4 → a separate ORCH.
- **Body-logic hardening of `submit_event_rsvp` / `biz_ticket_checkout_create_session`** (they trust `p_user_id`/`p_buyer_user_id` when supplied) is a body change, NOT a grant revoke — logged as Discovery, out of scope (they stay intended-anon).
- **`admin_city_pipeline_status` / `admin_city_place_stats` deserve an `is_admin_user()` body gate** (they leak internal stats to any authenticated user). This SPEC only revokes their anon access (public → logged-in). The body gate is Open Question OQ-3 → fast-follow.
- **The Supabase advisor backlog** (search_path_mutable ×134, rls_disabled ×12, etc. — INVESTIGATION §10) is out of scope.

### Assumptions
- ORCH-1384 merges before or after ORCH-1392 without conflict — both are idempotent grants; the ORCH-1384 grants are already live on prod. Migration ordering is immaterial for idempotent grants (see OQ-1).
- The CI `supabase/postgres:17.4.1.075` image provides the `anon`/`authenticated`/`service_role` roles (confirmed: the baseline migration grants to them and the CI job is a passing gate).

---

## 3. Cross-Surface Impact Declaration

This is a database-grant + CI change. Parity across app surfaces is **automatic** — the grant lives at the DB ACL layer, upstream of all app code; every surface sees the identical effective privilege. No surface has a separate code path to change.

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|--------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Consequence only | Calendar "Going" passes still load for the signed-in user (`fetch_user_going_rsvps` gate is transparent — client passes own id). No other change. | none | Automatic (DB ACL) |
| 2 | Consumer Android (`app-mobile/`) | Consequence only | Same as iOS. | none | Automatic |
| 3 | Buyer/anonymous Web (`mingla-business/`) | Consequence only | Public event/trip/experience pages, ticket availability, RSVP, and anonymous checkout unaffected — their functions are on the DO-NOT-REVOKE spare list. | none | Automatic |
| 4 | Business iOS (`mingla-business/`) | Consequence only | Ticket scanning unaffected — `biz_ticket_scan` is called only by the `scan-ticket` edge function (service_role). | none | Automatic |
| 5 | Business Android (`mingla-business/`) | Consequence only | Same as Business iOS. | none | Automatic |
| 6 | Admin Web (`mingla-admin/`, adjacent) | Consequence only | Admin login/bootstrap unaffected — `get_admin_emails` keeps `authenticated`; its new `is_admin_user()` gate returns the list to real admins and empty to non-admins, which `AuthContext.fetchDynamicAdmins` already tolerates (falls back to hardcoded allowlist + `is_admin_email`). | none | Automatic |
| 7 | Business Web preview (adjacent) | Consequence only | No change. | none | Automatic |

Files actually touched are backend/CI only: `supabase/migrations/**`, `supabase/security/**`, `scripts/ci/**`, `.github/workflows/**`. No app/product code is modified.

---

## 4. Layered specification

### 4.1 The single migration — `supabase/migrations/20270104000000_orch_1392_security_definer_grant_sweep.sql`

Prefix `20270104000000` is unique vs `origin/main` (max = `20270101000864`) and vs all active worktrees (ORCH-1384's `20270102000000`/`20270103000000` are the only later files; `2027010[4-9]…` is unused). Monotonic-after-1384.

**Structure (in this exact order, inside one `BEGIN … COMMIT`, `NOTIFY` after):**
1. **Section A — body gate fixes** (`CREATE OR REPLACE FUNCTION` ×2). Must come BEFORE the grants: `CREATE OR REPLACE` preserves the existing ACL on prod (no widening), and on a fresh env re-creates the function so the grant section then sets the correct ACL.
2. **Section B — grants** (REVOKE/GRANT ×41). Idempotent; safe to re-run.
3. **Section C — DO-block asserts** (`has_function_privilege` on all 41). Fails the migration (rolls back) if any end-state is wrong.
4. `COMMIT;` then `NOTIFY pgrst, 'reload schema';`

**SAFE-MIGRATION PROTOCOL:** the only DDL is 2 `CREATE OR REPLACE FUNCTION` (semantics-preserving — identical signature + query, guard prepended) + grants. No table DDL, no RLS change, no DROP.

#### Section A — body gate fixes (exact SQL)

**A-1. `fetch_user_going_rsvps`** — convert `LANGUAGE sql` → `LANGUAGE plpgsql` (a sql function cannot host `IF … RAISE`), preserve the identical `RETURNS TABLE(...)` and the identical two-branch `UNION ALL` query, prepend the self-gate. The gate exempts `service_role` (whose `auth.uid()` is NULL) so edge functions are unaffected; for an `authenticated` caller it enforces `auth.uid() = p_user_id`. Transparent to the sole client caller (`calendarService.ts:517` passes the signed-in user's own id).

```sql
CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)
RETURNS TABLE(rsvp_id uuid, guest_id uuid, role text, qr_code text, rsvp_status text, approval_status text, plus_count integer, display_name text, invited_by text, event_id uuid, event_title text, event_slug text, cover_media_url text, timezone text, location_text text, is_online boolean, online_url text, brand_id uuid, brand_slug text, brand_name text, master_start_at timestamp with time zone, master_end_at timestamp with time zone, created_at timestamp with time zone)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: self-scope gate. anon is revoked at the grant layer; an
  -- authenticated caller may only read their OWN rows. service_role
  -- (auth.uid() IS NULL) is the trusted edge-function path and bypasses.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  <<< the EXACT existing SELECT … UNION ALL … body, verbatim from prod
      pg_get_functiondef (both branches, WHERE r.user_id = p_user_id /
      g.matched_user_id = p_user_id …), unchanged >>>;
END;
$function$;
```
> Implementor: copy the two-branch SELECT verbatim from prod (`pg_get_functiondef('public.fetch_user_going_rsvps(uuid)')`) — do NOT retype it. Only the wrapper (`BEGIN`/guard/`RETURN QUERY`/`END`) and `LANGUAGE plpgsql` are new.

**A-2. `get_admin_emails`** — convert `LANGUAGE sql` → `LANGUAGE plpgsql`, add `SET search_path TO 'public'` (also clears the `function_search_path_mutable` advisory for this fn), add the admin gate. Non-admins get an **empty** result (not a RAISE) — `AuthContext.fetchDynamicAdmins` (`mingla-admin/src/context/AuthContext.jsx:123-139`) maps `data || []` and treats empty as "no dynamic admins" (falls back to hardcoded allowlist + `is_admin_email`). Real admins (`is_admin_user()` TRUE) still get the full list. Keeps `authenticated` grant (the console calls it authenticated at line 129).

```sql
CREATE OR REPLACE FUNCTION public.get_admin_emails()
RETURNS TABLE(email text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- ORCH-1392: only a confirmed admin may enumerate the admin roster.
  -- Non-admins (and anon, already revoked) receive zero rows — the admin
  -- console tolerates an empty dynamic list (hardcoded allowlist fallback).
  IF NOT public.is_admin_user() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT au.email, au.status
    FROM admin_users au
    WHERE au.status IN ('active', 'invited');
END;
$function$;
```

#### Section B — grants (the 41-function matrix)

**Grant pattern per role:**
- **service_role only:** `REVOKE EXECUTE ON FUNCTION public.<sig> FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ON FUNCTION public.<sig> TO service_role;`
- **authenticated (anon revoked):** `REVOKE EXECUTE ON FUNCTION public.<sig> FROM PUBLIC, anon;` then `GRANT EXECUTE ON FUNCTION public.<sig> TO authenticated, service_role;`

**Group 1 — SERVICE_ROLE ONLY (23).** Backend-only (webhook / cron / trigger-kicker / edge-fn / payout-ledger / destructive). Exact signatures:

| # | Function signature | Class | Caller verified |
|---|--------------------|-------|-----------------|
| 1 | `biz_refund_order_commit_from_webhook(p_order_id uuid, p_stripe_refund_id text, p_amount_cents integer, p_currency character, p_application_fee_refunded_cents integer, p_idempotency_key_hint text)` | webhook (re-assert) | live=svc-only ✓ |
| 2 | `finalize_rsvp_contribution(p_contribution_id uuid, p_provider_ref text, p_charge_id text, p_payment_method_type text)` | webhook (re-assert) | live=svc-only ✓ |
| 3 | `anonymize_user_audit_log(p_user_id uuid, p_salt text)` | internal (re-assert) | live=svc-only ✓ |
| 4 | `mark_partner_split_transferred(p_application_fee_id text, p_transfer_id text)` | payout ledger | — |
| 5 | `mark_partner_split_reversed(p_application_fee_id text, p_reversal_transfer_id text)` | payout ledger | — |
| 6 | `mark_partner_split_failed(p_application_fee_id text, p_reason text, p_error_message text)` | payout ledger | — |
| 7 | `bump_paystack_partner_split_attempt(p_key text, p_error text)` | payout ledger | — |
| 8 | `mark_paystack_partner_split_attempted(p_key text, p_payout_reference text, p_transfer_code text)` | payout ledger | — |
| 9 | `record_partner_split_attempt(p_application_fee_id text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer, p_currency text)` | payout ledger | — |
| 10 | `record_paystack_partner_split_attempt(p_reference text, p_order_id uuid, p_brand_id uuid, p_partner_account_id uuid, p_mingla_fee_cents integer, p_partner_share_cents integer)` | payout ledger | — |
| 11 | `truncate_seed_map_presence()` | destructive | — |
| 12 | `cron_refresh_admin_place_pool_mv()` | cron | — |
| 13 | `tg_kick_pending_trial_runs()` | worker kicker (non-trigger, callable) | — |
| 14 | `tg_kick_pending_thumb_backfill()` | worker kicker (non-trigger) | — |
| 15 | `tg_meta_orch_1009_sub_d_kick_rescores()` | worker kicker (non-trigger) | — |
| 16 | `expire_agent_pending_actions(p_now timestamp with time zone)` | internal maintenance | — |
| 17 | `pg_topup_recurring_experiences(p_floor integer)` | internal generator | — |
| 18 | `pg_expand_experience_recurrence(p_event_id uuid, p_master_start timestamp with time zone, p_master_end timestamp with time zone, p_rule jsonb, p_timezone text)` | internal generator | — |
| 19 | `pg_try_discover_cache_build_lock(p_cache_key text, p_ttl_seconds integer)` | internal lock | — |
| 20 | `pg_release_discover_cache_build_lock(p_cache_key text)` | internal lock | — |
| 21 | `record_trial_phone(p_phone text)` | internal | edge `delete-user` (svc) ✓ |
| 22 | `biz_ticket_scan(p_event_id uuid, p_qr_payload text, p_scanner_user_id uuid, p_qr_token_pepper text)` | edge-only | edge `scan-ticket` (svc) ✓ |
| 23 | `add_buyer_to_event_chat(p_event_id uuid, p_buyer_user_id uuid, p_order_id uuid, p_buyer_email text)` | post-purchase server | no app-client caller ✓ |

**Group 2 — AUTHENTICATED (anon revoked; 18).** Self-gated-on-`auth.uid()` client verbs + read-only recon that should be logged-in-only. Exact signatures:

| # | Function signature | Class | Caller verified |
|---|--------------------|-------|-----------------|
| 24 | `fetch_user_going_rsvps(p_user_id uuid)` | client read (re-assert + BODY GATE A-1) | client passes own id ✓ |
| 25 | `get_admin_emails()` | admin console (re-assert + BODY GATE A-2) | `AuthContext.jsx:129` authed ✓ |
| 26 | `accept_invite_and_transfer_brand_ownership(p_token_hash text, p_accepting_account_id uuid)` | client accept (re-assert) | ORCH-1384 browser-accept authed ✓ |
| 27 | `accept_scanner_invitation(p_token_hash text, p_accepting_account_id uuid)` | client accept (re-assert) | authed accept ✓ |
| 28 | `get_or_create_direct_conversation(p_user1_id uuid, p_user2_id uuid)` | client verb | `messagingService.ts:592` authed ✓ |
| 29 | `remove_participant_prefs(p_session_id uuid, p_user_id uuid)` | client verb | `useSessionManagement.ts` authed ✓ |
| 30 | `upsert_participant_prefs(p_session_id uuid, p_user_id uuid, p_prefs jsonb)` | client verb | multiple authed clients ✓ |
| 31 | `execute_undo_action(p_undo_id text, p_user_id uuid)` | client verb | authed (reversible default) |
| 32 | `get_effective_tier(p_user_id uuid)` | recon (read) | — |
| 33 | `derive_user_segment(p_profile_id uuid)` | recon (read) | — |
| 34 | `get_undo_actions(p_user_id uuid)` | recon (read) | — |
| 35 | `get_muted_user_ids(user_id uuid)` | recon (read) | — |
| 36 | `admin_city_pipeline_status()` | recon (read; see OQ-3) | admin console authed |
| 37 | `admin_city_place_stats(p_city_id uuid)` | recon (read; see OQ-3) | admin console authed |
| 38 | `phone_has_used_trial(p_phone text)` | recon (read) | — |
| 39 | `has_recent_report(reporter uuid, reported uuid, hours_window integer)` | recon (read) | — |
| 40 | `is_admin_email(p_email text)` | recon predicate | `AuthContext.jsx:276` authed ✓ |
| 41 | `check_invited_admin(p_email text)` | invite predicate | `AuthContext` authed session ✓ |

> The `authenticated` re-GRANT also lists `service_role` (already granted by default privileges — explicit for durability and fresh-env clarity).

#### Section C — DO-block asserts (fail-closed, self-verifying)

After Section B, one `DO $$ … $$;` block asserts the end-state for all 41:
- Group 1 (23): `has_function_privilege('anon', '<sig>', 'EXECUTE') = false` AND `has_function_privilege('authenticated', '<sig>', 'EXECUTE') = false` AND `has_function_privilege('service_role', '<sig>', 'EXECUTE') = true`.
- Group 2 (18): `has_function_privilege('anon', '<sig>', 'EXECUTE') = false` AND `has_function_privilege('authenticated', '<sig>', 'EXECUTE') = true`.

Any failure → `RAISE EXCEPTION` → transaction rolls back. Mirror the ORCH-1384 `20270103000000` DO-block-assert shape. (Body-gate correctness for A-1/A-2 is verified by the tests in §7, not the DO block.)

### 4.2 The allowlist — `supabase/security/anon_executable_definer_allowlist.txt`

Checked-in source-of-truth: one function identity signature per line (format `proname(identity_args)` exactly as `pg_get_function_identity_arguments` renders), `#`-comment lines allowed and required as section headers/justifications. The gate FAILS if the live probe returns any non-trigger definer signature in `public` that is anon-executable and NOT present here.

**The allowlist enumerates the ENTIRE acceptable anon-executable definer surface remaining AFTER this migration** — not merely the intended-public reads. It must, because F-6 proved "gated vs ungated" is undetectable by source parse, so every acceptable anon-exec fn (intended-public reads AND internally-gated `admin_*`/`biz_*` AND RLS predicate helpers) must be explicitly listed. Every future anon-exec definer fn then requires a conscious allowlist line (with justification) — that is the class-kill.

**Seed generation (deterministic, implementor):** after applying ALL migrations (including `20270104000000`) to the CI Supabase-Postgres, run the canonical probe (§4.3) and write its sorted output into the file, grouped under justification headers. Because this migration has already revoked the 41 leakers, the probe output is the curated acceptable remainder. Group under these required header comments:

```
# === INTENDED-PUBLIC READS (power anonymous public pages / checkout) — INVESTIGATION F-8 ===
pg_public_event_by_slug(text, text)
pg_public_trip_by_slug(text, text)
pg_public_experience_by_slug(text, text)
pg_public_rsvp_by_slug(text, text)
pg_public_brand_upcoming(text, timestamp with time zone, integer)
pg_public_experiences_by_brand(text)
pg_public_trips_by_brand(text)
pg_public_ticket_types_remaining(uuid)
pg_public_event_tier_allin(uuid)
pg_public_social_proof(uuid)
pg_published_trips_public(text, text, timestamp with time zone, timestamp with time zone, integer, integer, integer, integer, text, integer, integer)
pg_discover_business_events(text[], timestamp with time zone, timestamp with time zone, text[], text[], text[], integer, integer)
check_username_availability(text)
is_username_available(text)
submit_event_rsvp(uuid, uuid, text, text, text, text, integer, jsonb, text)
biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamp with time zone, integer, text)
# === INTERNALLY-GATED admin_*/biz_* (gate on is_admin_user() / *_for_caller — INVESTIGATION F-7; anon-exec is harmless) ===
#   (implementor: the full set from the probe output — e.g. admin_edit_place(...), admin_grant_override(...),
#    biz_retry_installment(uuid), biz_cancel_order(uuid, text), biz_can_read_order_for_caller(uuid), … )
# === RLS BOOLEAN PREDICATE HELPERS (SECURITY DEFINER so RLS policies may call them; boolean over supplied args) ===
#   (implementor: is_*/has_*/are_*/can_*/biz_is_*/biz_can_* raw-arg forms from the probe output)
# === st_estimatedextent (PostGIS system function; anon-exec is stock) ===
st_estimatedextent(text, text)
st_estimatedextent(text, text, text)
st_estimatedextent(text, text, text, boolean)
```

> The implementor MUST NOT hand-curate away a genuine leak into the allowlist. Every allowlisted signature must be either (a) intended-public per F-8, (b) internally gated per F-7 (verify the body has `is_admin_user()` / `*_for_caller` / `auth.uid()`), or (c) a boolean RLS predicate helper. If the probe output contains a signature that fits none of these AND is not in the 41 revoked by this migration, STOP — it is a missed leaker; escalate for a SPEC amendment rather than allowlisting it.

### 4.3 The gate probe — `scripts/ci/security_definer_anon_gate.sh`

Runnable in CI and locally. Connects via `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` (defaults matching the CI job: `localhost:5432 postgres/postgres postgres`). Logic:

1. **Canonical probe** (the authoritative enumeration):
```sql
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname = 'public'
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 1;
```
2. Read `supabase/security/anon_executable_definer_allowlist.txt`, strip `#` comments + blank lines.
3. **Diff:** any probed signature NOT in the allowlist → collect as a violation.
4. If violations: print each with the remediation message and `exit 1`:
   `SECURITY DEFINER anon-grant gate FAILED: <sig> is EXECUTE-able by anon but not allowlisted. Add an explicit 'REVOKE EXECUTE ON FUNCTION public.<sig> FROM PUBLIC, anon;' migration, OR (if intentionally public) add the signature to supabase/security/anon_executable_definer_allowlist.txt with a justification comment.`
   Else print `OK: N anon-executable definer functions, all allowlisted.` and `exit 0`.
5. **Reverse-drift check (optional, warn-only):** allowlist entries not present in the probe output → print a warning (stale allowlist line) but do not fail (a function may have been dropped/renamed).

### 4.4 DO-NOT-REVOKE (intended-public spare list — HARD)

These MUST retain their anon EXECUTE grant AND keep their current bodies. Breaking any of them breaks public pages / anonymous checkout / signup:

- `pg_public_event_by_slug`, `pg_public_trip_by_slug`, `pg_public_experience_by_slug`, `pg_public_rsvp_by_slug`, `pg_public_brand_upcoming`, `pg_public_experiences_by_brand`, `pg_public_trips_by_brand`, `pg_public_ticket_types_remaining`, `pg_public_event_tier_allin`, `pg_public_social_proof`, `pg_published_trips_public`, `pg_discover_business_events` — power the anonymous public event/trip/experience pages + ticket availability.
- `check_username_availability`, `is_username_available` — signup username checks (anon).
- `submit_event_rsvp` — public RSVP entry point (anon guest).
- `biz_ticket_checkout_create_session` — anonymous web-checkout entry point.
- The internally-gated `admin_*` / `biz_*` families (F-7) and RLS boolean predicate helpers — bodies untouched; stay anon-exec but allowlisted.
- `partner_reissue_brand_invitation` — already service_role-only (ORCH-1384); DO NOT re-touch.

### 4.5 The gate workflow — `.github/workflows/security-definer-anon-grant-gate.yml`

New workflow (mirrors the `migrations` job in `supabase-migrations-and-stripe-deno.yml`). Triggers on PRs touching `supabase/migrations/**`, `supabase/security/anon_executable_definer_allowlist.txt`, `scripts/ci/security_definer_anon_gate.sh`, or the workflow file itself. Steps:
1. `services.postgres` = `supabase/postgres:17.4.1.075`, `POSTGRES_PASSWORD: postgres` (identical to the existing job — provides the `anon`/`authenticated`/`service_role` roles).
2. Wait-for-postgres (copy the existing 90s loop).
3. **Default-privilege faithfulness seed** (run BEFORE applying migrations, as the connecting role): `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;` — guarantees the CI DB reproduces prod's "every new function auto-gets anon EXECUTE" behavior, so a future leaky function is caught even if it has no explicit anon grant. Idempotent no-op if the image already does this (see OQ-2).
4. Apply migrations in timestamp order (copy the existing `psql -f` loop).
5. Run `scripts/ci/security_definer_anon_gate.sh` → must exit 0 (green).
6. **Self-test / negative control** (proves the gate is not a no-op): create a throwaway leaky fn `CREATE FUNCTION public._orch1392_gate_selftest() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';` (inherits the seeded anon default-priv), then assert the gate script now `exit 1` (`if scripts/ci/…; then echo FAIL; exit 1; fi`), then `DROP FUNCTION public._orch1392_gate_selftest();`. If the gate does NOT go red on the injected leaker, fail the job.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1 (hot-patch codified):** After `20270104000000` applies to a fresh DB, `has_function_privilege('anon', …)` = `false` for all 7 originally hot-patched functions; the 3 webhook/internal ones are additionally `authenticated`=`false`, `service_role`=`true`. (Asserted by Section C.)
- **SC-2 (Tier-2 svc-only revoked):** For every Group-1 signature (§4.1 rows 1-23), `anon`=`false`, `authenticated`=`false`, `service_role`=`true`.
- **SC-3 (Tier-2 authenticated):** For every Group-2 signature (§4.1 rows 24-41), `anon`=`false`, `authenticated`=`true`.
- **SC-4 (intended-public spared):** Every DO-NOT-REVOKE function (§4.4) retains `anon`=`true`. (Verified by the gate: they appear in the probe AND are allowlisted → green.)
- **SC-5 (`fetch_user_going_rsvps` gate transparent):** With `auth.uid()` = X, calling `fetch_user_going_rsvps(X)` returns the same rows as before (the sole client caller passes its own id); calling `fetch_user_going_rsvps(Y)` for Y≠X raises `42501 not_authorized`; a `service_role` call for any id returns rows (bypass).
- **SC-6 (`get_admin_emails` gate transparent):** An `authenticated` caller for whom `is_admin_user()` is TRUE gets the full active/invited list; a non-admin authenticated caller gets zero rows (no error); the admin console login flow completes unchanged.
- **SC-7 (idempotent):** Re-running the migration end-to-end is a no-op (no error, same end-state) — REVOKE/GRANT re-runs and `CREATE OR REPLACE` are idempotent; the DO-block asserts still pass.
- **SC-8 (CI gate green on truth):** On a branch with the migration + allowlist, `.github/workflows/security-definer-anon-grant-gate.yml` passes (probe returns only allowlisted signatures).
- **SC-9 (CI gate self-tests):** The negative-control step proves the gate exits non-zero when a leaky definer fn is injected.
- **SC-10 (no re-widening):** No function anywhere gains a NEW anon grant. The migration contains zero `GRANT EXECUTE … TO anon`.
- **SC-11 (fails-on-revert, static):** Deleting any `REVOKE … FROM … anon` line for a Group-1/2 fn makes `orch_1392_grant_sweep.test.ts` fail.
- **SC-12 (fails-on-revert, runtime):** Re-granting anon to any revoked fn (or adding a new anon-exec definer fn not in the allowlist) makes the live gate fail.

Surface split (SC-*-iOS/Android/Web): N/A — the DB ACL is a single shared enforcement point; there is no per-surface code path.

---

## 6. Invariants

- **Preserves** the ORCH-1338 / ORCH-1384 class invariant (a definer fn must not rely on the grant layer as its only auth barrier). This SPEC hardens the grant layer AND adds internal gates to the 2 fns whose grant is not the true barrier.
- **Preserves** `partner_reissue_brand_invitation` service_role-only state (untouched).
- **NEW (propose as DRAFT — orchestrator flips ACTIVE at CLOSE):** `I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER` — "No SECURITY DEFINER function in schema `public` (non-trigger) is `anon`-EXECUTE-able unless its identity signature is present in `supabase/security/anon_executable_definer_allowlist.txt` with a justification. Enforced by the live-probe CI gate." Verified by `.github/workflows/security-definer-anon-grant-gate.yml`.
- **NEW (propose as DRAFT):** `I-PROPOSED-1392-DEFINER-GRANTS-EXPLICIT-IN-MIGRATION` — "Every intentional privilege reduction on a definer fn is expressed as an explicit `REVOKE … FROM PUBLIC, anon[, authenticated]` in a migration (never relying on `REVOKE … FROM PUBLIC` alone)." Verified by `orch_1392_grant_sweep.test.ts`.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | svc-only end-state | apply migration; probe row 1 (`biz_refund_order_commit_from_webhook`) | anon=f, authed=f, svc=t | DB (DO-block + retest) |
| T-2 | authenticated end-state | probe `get_or_create_direct_conversation` | anon=f, authed=t | DB |
| T-3 | intended-public spared | probe `pg_public_event_by_slug`, `submit_event_rsvp` | anon=t | DB |
| T-4 | ORCH-1384 untouched | probe `partner_reissue_brand_invitation` | anon=f, authed=f, svc=t (unchanged) | DB |
| T-5 (happy) | rsvp self-read | `auth.uid()=X`, call `fetch_user_going_rsvps(X)` | returns X's rows incl. qr_code | DB body |
| T-6 (error) | rsvp cross-read | `auth.uid()=X`, call `fetch_user_going_rsvps(Y)` | `42501 not_authorized` | DB body |
| T-7 (edge) | rsvp svc bypass | service_role, `fetch_user_going_rsvps(Y)` | returns Y's rows (no raise) | DB body |
| T-8 (happy) | admin roster read | authed admin (`is_admin_user()`=t), `get_admin_emails()` | full active/invited list | DB body |
| T-9 (error) | non-admin roster read | authed non-admin, `get_admin_emails()` | zero rows, no error | DB body |
| T-10 (edge) | admin console bootstrap | run `AuthContext` login as real admin | dynamic admin list populated; login completes | admin web (tester live-fire) |
| T-11 | idempotency | apply migration twice | second run no-op, asserts pass | DB |
| T-12 (gate happy) | gate on truth | run gate script post-migration | exit 0 | CI |
| T-13 (gate fails-on-revert) | inject leaker | create leaky definer fn, run gate | exit 1 with message | CI self-test |
| T-14 (static fails-on-revert) | delete a REVOKE line | remove `REVOKE … anon` for row 4, run `orch_1392_grant_sweep.test.ts` | test FAILS | migration-text |
| T-15 (client transparent) | consumer Calendar | sign in, open Calendar "Going" | passes render (own QR) unchanged | consumer app (tester device) |

---

## 8. Implementation order

1. **Write the migration** `supabase/migrations/20270104000000_orch_1392_security_definer_grant_sweep.sql` — Section A (2 `CREATE OR REPLACE`, bodies copied verbatim from prod `pg_get_functiondef` + guards) → Section B (41 REVOKE/GRANT) → Section C (DO-block asserts) → COMMIT → NOTIFY.
2. **Boot CI Supabase-Postgres locally** (`supabase/postgres:17.4.1.075`), seed default privileges (§4.5 step 3), apply ALL migrations. Confirm the migration applies clean (ON_ERROR_STOP=1) and the DO-block passes.
3. **Generate the allowlist** `supabase/security/anon_executable_definer_allowlist.txt` from the canonical probe output on that DB (§4.2), grouped + justified; verify every entry fits F-7/F-8/predicate/PostGIS (no smuggled leaker).
4. **Write the gate script** `scripts/ci/security_definer_anon_gate.sh` (§4.3); run locally → exit 0.
5. **Write the gate workflow** `.github/workflows/security-definer-anon-grant-gate.yml` (§4.5) incl. negative-control self-test.
6. **Write the static regression test** `supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts` (deno, mirrors the ORCH-1384 static-scan convention: strip comments, isolate each revoked signature's REVOKE statement, assert the grantee list strips `anon` (and `authenticated` for Group-1); assert no `GRANT … TO anon` anywhere; assert both `CREATE OR REPLACE` bodies contain their guard token).
7. Do NOT apply to prod — the orchestrator applies at CLOSE (mostly a no-op vs the live hot-patch + the new Tier-2 revokes + 2 gates).

---

## 9. Regression prevention (two-sided fails-on-revert contract)

- **Structural safeguard 1 (static, migration-text):** `supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts`. Isolates each of the 41 signatures inside a `REVOKE … ON FUNCTION <sig> … ;` and asserts the grantee list after `FROM` includes `anon` (all 41) and `authenticated` (Group-1's 23); asserts zero `GRANT EXECUTE … TO anon`; asserts the two guard tokens (`auth.uid() IS DISTINCT FROM p_user_id`, `NOT public.is_admin_user()`) are present. **FAILS when a REVOKE line or a guard is deleted; PASSES when restored.** (Comments stripped before matching, per COMMS-0106.)
- **Structural safeguard 2 (runtime, live probe):** the CI gate + allowlist. **FAILS when a function becomes anon-executable at runtime (reverted REVOKE, or a new definer fn) and is not allowlisted; PASSES on the curated surface.** This is the safeguard the static test cannot provide (F-6: the anon grant is a default-privilege, invisible in migration text) — and the reason both sides are required.
- **Protective comments:** the migration header explains the default-privileges footgun (mirror the ORCH-1338 header) and states "grants-first CANNOT be reordered after the CREATE OR REPLACE; do not delete any REVOKE — the anon grant returns via default privileges."

---

## 10. Open questions

- **OQ-1 (migration ordering):** `20270104000000` sorts after ORCH-1384's `20270102/03000000`. If ORCH-1392 merges/applies to prod BEFORE ORCH-1384 merges, the later-merged ORCH-1384 migrations carry earlier timestamps — harmless for idempotent grants (all ORCH-1384 grants are already live on prod), but the orchestrator should confirm the migration runner tolerates the out-of-order timestamp at CLOSE, or apply ORCH-1384 first. **Recommendation:** apply/merge ORCH-1384 first (it is further along, in TEST); otherwise proceed — no functional risk.
- **OQ-2 (CI default-privilege faithfulness):** Does `supabase/postgres:17.4.1.075` already `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO anon`? The §4.5 step-3 seed makes the gate faithful either way (idempotent). The implementor should confirm via a one-line probe in the CI log; if the image does NOT auto-grant, the seed is load-bearing (without it, a new leaky fn with no explicit anon grant would false-green). Either way the seed stays.
- **OQ-3 (`admin_city_*` body gate):** `admin_city_pipeline_status()` / `admin_city_place_stats(uuid)` are ungated read-only stats — this SPEC revokes their anon access (public → logged-in) but any authenticated user can still read them. Recommend a fast-follow `is_admin_user()` body gate (same shape as A-2). In scope only if Seth elects; otherwise Discovery.
- **OQ-4 (allowlist tightening):** Should a follow-on ORCH revoke anon from the internally-gated `admin_*`/`biz_*` families + RLS predicate helpers (defense-in-depth), shrinking the allowlist to just the intended-public reads? The investigation raised this (Open Question c). Deferred — those are safe today (F-7).
- **OQ-5 (authenticated tier):** 375 definer fns are `authenticated`-executable. Gating that tier (probe `authenticated`) is Discovery #4 → separate ORCH; the gate here probes `anon` only.

None of these block IMPLEMENT. OQ-1/OQ-2 are orchestrator/CI confirmations; OQ-3/4/5 are explicitly out of scope.

---

## 11. Downstream routing

- **Next = IMPLEMENT** (mingla-implementor). Working tree `~/Desktop/mingla-orchs/ORCH-1392-[security-definer-grant-sweep]/` on branch `ORCH-1392-security-definer-grant-sweep`. Build the 5 files in §8 order; boot the CI Supabase-Postgres to self-verify the migration + gate before reporting; do NOT apply to prod; do NOT re-widen any grant; stop-and-amend before touching anything outside the allowlist (§ below).
- **Then TEST** (mingla-tester) — live-fire on prod (read-only privilege probes for all 41 end-states + the 4 spare-checks; the single harmless anon RPC deferred from INVESTIGATE F-9, e.g. anon POST to a revoked fn expecting `42501` not `P0001`); the 2 gate bodies (T-5..T-9) on a branch DB or prod read; admin-console bootstrap (T-10) + consumer Calendar (T-15) on device; gate self-test (T-13).
- **Then CLOSE** (orchestrator) — apply `20270104000000` to prod (mostly no-op vs the live hot-patch + the Tier-2 revokes + 2 gates), flip the 2 `I-PROPOSED-1392-*` invariants ACTIVE, remove the registry row, resolve COMMS-0110.

### Scoped allowlist (files the implementor MAY create/modify)
1. `supabase/migrations/20270104000000_orch_1392_security_definer_grant_sweep.sql` (NEW — the ONE migration: grants + 2 gates)
2. `supabase/security/anon_executable_definer_allowlist.txt` (NEW)
3. `scripts/ci/security_definer_anon_gate.sh` (NEW)
4. `.github/workflows/security-definer-anon-grant-gate.yml` (NEW)
5. `supabase/migrations/__tests__/orch_1392_grant_sweep.test.ts` (NEW)

### DO-NOT-TOUCH
- The bodies of every intended-public fn (§4.4) and every gated `admin_*`/`biz_*` fn (F-7) — except the 2 named gate fixes (A-1, A-2).
- `partner_reissue_brand_invitation` grants + the ORCH-1384 migrations `20270102000000` / `20270103000000`.
- The 7 hot-patched grants are RE-ASSERTED by this migration (not left alone) — but no OTHER migration file is edited.
- All unrelated migrations, app/product code, RLS policies, and edge functions. No table DDL, no RLS change.
- Any change that would `GRANT … TO anon` — forbidden (SC-10).
