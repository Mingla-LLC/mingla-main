# ORCH-1392 — Ranked leaker table (SECURITY DEFINER anon-executable, effective privilege + gate)

All probed live on prod `gqnoajqerqhnvulmnyvv` via `has_function_privilege(<role>, <oid>, 'EXECUTE')` (read-only).
`anon`/`authed`/`svc` = effective EXECUTE. "Gate" = internal caller-identity check inside the body.
Blast tiers: HIGH = anon one-call money/auth/ownership/PII or destructive; MED = needs a semi-secret id or lower blast; LOW = idempotent/recon.

## Tier 1 — HIGH (anon-executable, no caller-identity gate, money / auth / PII / destructive)

| Fn | anon | Gate present? | What an anon caller can do | Intended grant |
|----|------|---------------|----------------------------|----------------|
| `biz_refund_order_commit_from_webhook(p_order_id,…)` | YES | none | Forge a `refunds` row `status='succeeded'` on ANY order by `order_id`, flip `orders.payment_status='refunded'`, and VOID that order's tickets — with no Stripe refund. Corrupts financial ledger + destroys valid tickets. | service_role only |
| `finalize_rsvp_contribution(p_contribution_id,…)` | YES | none | Mark ANY chip-in contribution `status='paid'`, set a bogus `stripe_charge_id`, and fire host "you got paid" receipts — without any payment. | service_role only |
| `anonymize_user_audit_log(p_user_id,p_salt)` | YES | none | Wipe/redact the ENTIRE `audit_log` for ANY user_id (nulls user_id/ip/user_agent, redacts before/after) — forensic-evidence tamper + GDPR-erase weapon. | service_role only |
| `fetch_user_going_rsvps(p_user_id)` | YES | none (returns caller-supplied user's rows) | Dump ANY user's "going" RSVPs INCLUDING `qr_code` (the ticket/pass secret) + display name + event/brand — ticket forgery + attendance PII. | authenticated + `auth.uid()=p_user_id` |
| `get_admin_emails()` | YES | none | Return the full list of Mingla admin email addresses + status — targeted phishing / ATO recon. | authenticated+admin / service_role |
| `accept_invite_and_transfer_brand_ownership(p_token_hash,p_accepting_account_id)` | YES | residual: token_hash secrecy + invited-email == accepting-account email | Same class as ORCH-1384 P0-1: trusts caller-supplied `p_accepting_account_id`, transfers brand ownership. NOT a clean one-call takeover (email-match to the invitation constrains the target account), but the GRANT is not the barrier. | service_role / authenticated |
| `accept_scanner_invitation(p_token_hash,p_accepting_account_id)` | YES | residual: token + email-match (same as above) | Grant scanner role on an event/brand to a caller-supplied account (token + email-match residual gate). | service_role / authenticated |

## Tier 2 — MED (anon-executable, no gate; ledger/data tamper, needs a semi-secret id, or destructive-but-low-value)

| Fn | anon | What an anon caller can do | Intended grant |
|----|------|----------------------------|----------------|
| `mark_partner_split_transferred(p_application_fee_id,p_transfer_id)` | YES | Flip a pending/failed partner_splits row to `transferred` with a bogus transfer id → payout cron skips the REAL transfer → partner never paid. | service_role only |
| `mark_partner_split_reversed / _failed`, `bump_paystack_partner_split_attempt`, `mark_paystack_partner_split_attempted` | YES | Tamper partner-payout ledger status/metadata (needs the Stripe application_fee_id, which appears in dashboards/logs). | service_role only |
| `record_partner_split_attempt`, `record_paystack_partner_split_attempt` | YES | INSERT arbitrary pending partner_splits rows (poison the payout ledger; fabricate partner_account_id / amounts). | service_role only |
| `truncate_seed_map_presence()` | YES | `TRUNCATE public.seed_map_presence` — wipe the whole table. (Heuristic-missed: TRUNCATE.) | service_role only |
| `add_buyer_to_event_chat(p_event_id,p_buyer_user_id,…)` | YES | Inject ANY user_id into ANY event's group chat; seed pending_trip_chat_claims. | service_role only |
| `get_or_create_direct_conversation(p_user1_id,p_user2_id)` | YES | Create/enumerate a direct conversation between ANY two users (spam/harassment surface). | authenticated + `auth.uid()` ∈ {u1,u2} |
| `remove_participant_prefs(p_session_id,p_user_id)` | YES | Delete ANY participant's collab-session prefs (its sibling `upsert_participant_prefs` DOES check membership; this one does not — gate asymmetry). | authenticated + membership check |
| `upsert_participant_prefs(p_session_id,p_user_id,p_prefs)` | YES | Writes prefs for any accepted participant (validates p_user_id is a participant, NOT that caller==p_user_id → impersonation). | authenticated + `auth.uid()=p_user_id` |
| `execute_undo_action(p_undo_id,p_user_id)` | YES | Execute an undo (restore msg / remove vote / etc.) if the undo_id+owner are known (undo_id secrecy = partial barrier). | authenticated + `auth.uid()=p_user_id` |
| `record_trial_phone(p_phone)` | YES | Poison `used_trial_phones` (pre-mark phones as trial-used → deny legit trials / griefing). | service_role only |
| `expire_agent_pending_actions(p_now)` | YES | Pass a future `p_now` → force-expire ALL pending agent actions. | service_role only |
| `pg_topup_recurring_experiences(p_floor)` | YES | Pass a huge floor → mass event_date generation/deletion across ALL recurring experiences (mutation + DoS). | service_role only |
| `pg_expand_experience_recurrence(p_event_id,…)` | YES | Inject up to 52 event_date rows into ANY event with a crafted rule. | service_role only |
| `tg_kick_pending_trial_runs()`, `tg_kick_pending_thumb_backfill()`, `tg_meta_orch_1009_sub_d_kick_rescores()` | YES | Trigger backend worker runs via `net.http_post` (resource abuse). Read a vault secret internally but never return it. (Backfill/rescore kickers heuristic-missed: aliased UPDATE / http-only side-effect.) | service_role only |
| `cron_refresh_admin_place_pool_mv()` | YES | Trigger `REFRESH MATERIALIZED VIEW CONCURRENTLY` + ANALYZE (resource/DoS). (Heuristic-missed: REFRESH.) | service_role only |
| `pg_try_discover_cache_build_lock` / `pg_release_discover_cache_build_lock` | YES | Hold/release discover cache-build locks → cache stampede or starvation. | service_role only |
| `biz_ticket_scan(p_event_id,p_qr_payload,p_scanner_user_id,p_qr_token_pepper)` | YES | Trusts caller-supplied `p_scanner_user_id` (spoof any authorized scanner) + inject 'not_found' scan_events. REAL ticket-marking blocked by QR-pepper secrecy (pepper must reproduce the stored hash; `assert_qr_pepper` only checks len≥32, NOT a server secret). Mis-flagged "gated" (the `assert_` match was the pepper helper). | service_role only |
| `get_effective_tier`, `derive_user_segment`, `get_undo_actions`, `get_muted_user_ids`, `admin_city_pipeline_status`, `admin_city_place_stats`, `phone_has_used_trial`, `has_recent_report`, `is_admin_email`, `check_invited_admin` | YES | Read-only recon/privacy: any user's tier/segment/undo list/mute list; admin-vs-not probe; internal city pipeline stats; trial/report/admin-email enumeration. | authenticated (most) |

## Confirmed SAFE despite heuristic flags (do NOT touch)

| Fn | Why safe |
|----|----------|
| `admin_edit_place`, `admin_grant_override`, `admin_revoke_override`, all `admin_*` (B_MUT_GATED) | Gate on `is_admin_user()` (reads `auth.users WHERE id=auth.uid()` → anon NULL → FALSE) or `auth.email()` against `admin_users`. Anon-exec is harmless. |
| `biz_retry_installment`, `biz_*` (B_MUT_GATED) | Gate on `biz_is_brand_member_for_read_for_caller` = `biz_is_brand_member_for_read(brand, auth.uid())`. |
| `submit_event_rsvp`, `biz_ticket_checkout_create_session` | INTENDED-anon (public RSVP / anonymous web checkout). Grant is correct. NB body-logic note: both trust `p_user_id`/`p_buyer_user_id` when supplied — a body fix (bind to auth.uid() when non-null), NOT a grant revoke. |
| `pg_public_*` (10), `pg_published_trips_public`, `pg_discover_business_events`, `pg_public_ticket_types_remaining`, slug reads, `check_username_availability`/`is_username_available` | INTENDED-public read RPCs (public event/trip/experience pages, username availability). Grant is correct. |
| RLS boolean predicate helpers `is_*`/`has_*`/`are_*`/`can_*`/`biz_is_*`/`biz_can_*` (raw arg forms) | SECURITY DEFINER so RLS policies can call them; return a boolean over supplied args. Low risk; defense-in-depth revoke-from-anon optional. |
| `partner_reissue_brand_invitation` | ALREADY HARDENED to service_role-only (ORCH-1384 P0-1 hot-patch is LIVE on prod: anon=0, authed=0, svc=1). DO NOT re-touch. |

## Aggregate counts (prod, live)
- Total SECURITY DEFINER functions (all non-system schemas; all in `public`): 399
- anon-EXECUTE: 279 · authenticated-EXECUTE: 375 · service_role-only: 22
- Of the 279 anon: 52 trigger fns (not RPC-callable) + 227 callable
- Supabase security advisor corroboration: `anon_security_definer_function_executable`=279, `authenticated_security_definer_function_executable`=375 (exact match)
