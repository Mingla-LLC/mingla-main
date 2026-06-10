# Production-Readiness Forensic Audit — Mingla

**Date:** 2026-06-10
**Author:** Claude `mingla-orchestrator` (direct audit; forensics skill unavailable — lost in iCloud incident)
**Method:** Live probes against Supabase Management API + Postgres (read-only), repo config, security advisors. Facts only; no inference where a probe was possible.
**Project ref:** `gqnoajqerqhnvulmnyvv`

---

## 1. Payments / Stripe — the headline correction

| Fact | Evidence |
|---|---|
| `MINGLA_STRIPE_MODE` = **`test`** | Management API secret digest = `9f86d081…0a08` = SHA-256("test") |
| **Both** test AND live restricted keys are loaded | All 8 `STRIPE_RAK_*_TEST` and `STRIPE_RAK_*_LIVE` secrets present in Supabase |
| Mode switch is code-wired (ORCH-1056) | `_shared/stripeMode.ts` `resolveStripeKey(role)` routes on `MINGLA_STRIPE_MODE` |
| Build fail-close honored | `mingla-business/app.config.ts:151` requires `pk_live_` only when mode=live; default = `pk_test_51TTnt1…` sandbox |
| Brand money state | 59 brands · 20 with test Stripe Connect · **7 charges_enabled + 7 payouts_enabled** · 0 Paystack · 0 null currency · 5 currencies |

**Conclusion:** Going live is **flipping one flag** (`MINGLA_STRIPE_MODE` → `live`, swap the Vercel `pk` to `pk_live_`) + business/legal verification. The live keys are already in Supabase. My earlier "4–8 hour from-scratch" framing was wrong — it cited the superseded B2 checklist.

## 2. Service configuration — 98 secrets, platform fully wired

Configured & loaded (Supabase secrets): Stripe (test+live), OneSignal (app+business), Resend (4), Twilio (5), Cloudinary, Gemini (+Ari), OpenAI, Anthropic, Google (Places/Maps/Geo), Mapbox, Pexels, Ticketmaster, AppsFlyer, OpenWeather, Serper, Paystack (**TEST only**), feature flags (`MARKETING_SEND_LIVE_ENABLED`, `EVENT_COVER_VIDEO_PROVIDER`).

**Sentry:** wired for the apps, NOT for edge functions.
- Consumer: `Sentry.init` DSN hardcoded in `app-mobile/app/_layout.tsx:29` (live).
- Business: production EAS profile sets `SENTRY_DISABLE_AUTO_UPLOAD: false` (source-map upload on); DSN in Key Details.
- **Gap:** no `SENTRY_*` secret in Supabase → edge-function errors are NOT sent to Sentry (Taofeek's `reportNonFatal` is native-only). Minor, optional.

**Stale leftover:** `NATIVE_PAID_ALLOWED_REGIONS` secret still present though the region gate was decommissioned (ORCH-0955). Harmless (no code reads it); delete for hygiene.

## 3. Scale reality — pre-launch dataset

Approx live rows: tickets 174 · events 138 · orders 64 · brands 59 · profiles 39 · agent_messages 29 · event_dates 22 · marketing_campaigns 19 · support_tickets 1 · stripe_disputes 0.

**Conclusion:** No real production traffic yet. The #430 hot-path indexes (applied 2026-06-10) and the 100k load test are **future-capacity** work, not fixes for a current problem. No money has been charged for real (mode=test).

## 4. Security posture — Supabase advisors (667 findings, classified by REAL risk)

| Level | Lint | Count | Real risk assessment |
|---|---|---|---|
| ERROR | `rls_disabled_in_public` | 12 | **LOW** — 10 are stale `_backup_*`/`_archive_*`/`_deprecated_*` tables; verified **no `anon`/`authenticated` grants** → NOT API-reachable. 1 = `spatial_ref_sys` (PostGIS system table, false positive). `seed_map_presence`/`used_trial_phones` = review. Action: **drop the dead backup tables** (hygiene + removes the lint). |
| ERROR | `security_definer_view` | 3 | **REVIEW** — `claimed_venues_public_view`, `business_public_events_view`, `business_public_brands_view`. Intentional public views for public pages; confirm they expose only public columns. |
| WARN | `*_security_definer_function_executable` (anon+auth) | 515 | **BY DESIGN** — heavy-RPC architecture; each SECURITY DEFINER RPC must validate auth internally. Surface is large but expected. |
| WARN | `function_search_path_mutable` | 120 | **HARDENING** — pin `search_path` on these functions (search-path-injection defense). Real debt, not urgent. |
| WARN | `public_bucket_allows_listing` | 7 | **LOW** — avatars/covers/photos/marketing buckets; public by design, listing enumeration is a minor info-leak. Optional: disable listing. |
| WARN | `rls_policy_always_true` | 1 | `ticketmaster_events_cache` — public cache data; acceptable. |
| WARN | `materialized_view_in_api` | 1 | `admin_place_pool_mv` — confirm it's not anon-readable (admin data). |
| WARN | `extension_in_public` | 2 | cosmetic. |
| INFO | `rls_enabled_no_policy` | 6 | deny-all by default; fine. |

**Conclusion:** No active public data-exposure hole found. The scary "15 ERRORS" decompose into stale-table cleanup + a PostGIS false positive + 3 intentional public views to spot-check. Genuine pre-launch security work = drop dead backup tables, pin function search_paths, review the 3 SD views + `used_trial_phones` RLS.

## 5. Migrations / deploy

- 202 local migration files; `#430` hot-path index migration applied + recorded (`20260923000000`) on 2026-06-10.
- 4 hot-path edge functions (`ticket-checkout-create/-status`, `stripe-webhook`, `agent-chat`) redeployed 2026-06-10 with #428 structured logging (verified versions v202/v198/v173/v142).

## 6. The 7 launch gates — evidence-based status (corrects 2026-06-10 first pass)

| Gate | Status by fact |
|---|---|
| G3 Sentry live | **DONE for apps** (consumer DSN hardcoded; business prod EAS upload on). Optional gap: edge-fn Sentry not wired. |
| G6 Stripe TEST→LIVE | **Technically one flag** — live keys already in Supabase; needs business/legal verification + the flip decision. |
| G7 App Store / Play | **Credentials ready** (Apple Issuer ID + AuthKey `.p8`); needs the actual submission. |
| G2 Staging/prod Supabase project | **STILL THE KEYSTONE** — single project runs everything; this is why prod can't run alongside test. Real, unblocks G1 + safe G6. |
| G1 100k load test | Real future-capacity exercise; scripts exist (#427/#429/#433). No current load. |
| G4 DR restore drill | Real activity; not performed. |
| G5 Incident/alert drill | Real activity; Sentry (alerting half) already live. |

## 7. Verification pass (2026-06-10, live probes)

**RLS policy bodies on live money/user tables — VERIFIED SOLID.**
- `orders`, `tickets`: **no `anon` access**; all reads/writes gated by `biz_can_read_order_for_caller` / `biz_*_rank` role functions or buyer's own order. Anon buyers reach these only via service-role edge functions.
- `brands`, `events`, `event_dates`: anon SELECT limited to non-deleted + `visibility='public'` + published rows; writes gated by `biz_is_brand_admin_plus` / `biz_brand_effective_rank >= event_manager`.
- `profiles`: scoped by `auth.uid()=id`, `visibility_mode='public'`, friends, and blocked checks.
- `agent_messages`: owner-only (`user_id = auth.uid()`). **No exposure gaps.**

**Live-mode Stripe — VERIFIED, account is launch-ready.**
- Live platform account `acct_1TU23…`: `charges_enabled=true`, `details_submitted=true`, `payouts_enabled=true`, country US → **fully verified & active**.
- **2 live webhook endpoints** enabled, both → prod `…supabase.co/functions/v1/stripe-webhook` (18 events Connect + 10 events Platform — the ORCH-0953 dual-endpoint design).
- **0 live connected accounts** (expected — brands onboard to live after the flip).

**Vercel production Stripe key — PARTIALLY VERIFIED (good security finding).**
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `MINGLA_STRIPE_MODE` are stored as Vercel **Sensitive (write-only)** vars — unreadable via API or `vercel env pull` (returns empty). This is correct hygiene.
- Indirect proof of consistency: `app.config.ts` build **fail-closes** on any pk/mode mismatch; business.usemingla.com deploys successfully (HTTP 200); backend mode=test; 0 live connected accounts ⇒ the web serves **`pk_test`** consistently. Direct confirmation would require triggering the lazy checkout chunk on a live checkout URL.
- All 3 web surfaces live: business.usemingla.com, usemingla.com, admin.usemingla.com → HTTP 200.

**Still not probed:** EAS *remote* env secret values (only `eas.json` static config read); the deeply-lazy checkout-chunk pk on the live site (needs a real checkout URL).

## 8. Recommended order of work (fact-driven)

1. **G2 — separate prod Supabase project.** Keystone; unblocks live Stripe co-existence + safe load testing.
2. **Security cleanup** (cheap, pre-launch): drop dead `_backup_*`/`_archive_*` tables; review `used_trial_phones`/`seed_map_presence` RLS; spot-check the 3 SD public views; delete stale `NATIVE_PAID_ALLOWED_REGIONS` secret.
3. **G1 load test** against the new staging project.
4. **G4/G5 drills.**
5. **G6 Stripe flip + G7 store submit** — short, credential-ready.
6. Optional hardening: pin `search_path` on 120 functions; wire edge-fn Sentry.
