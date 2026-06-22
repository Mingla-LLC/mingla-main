# TEST REPORT — ORCH-1196 Admin API-Health Hub + Email Alerts

**Phase:** TEST (brutal production gatekeeper). Assumed-broken-until-proven.
**Worktree/branch:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1196-[api-health-hub]/` · `ORCH-1196-api-health-hub`
**Date:** 2026-06-21
**Tester commit:** `369e5f59a` (adversarial tests, append-only, DIFFERENT angle than implementor)
**Implementor commits under test:** `e3dea6ca2` (core), `3e3d3ff2d` (allSettled), `dd42388a6` (report)

## VERDICT: **CONDITIONAL PASS**

The implementation is correct and well-built at every layer I could test statically and at unit/integration level. RLS/RPC security is VERIFIED against real Postgres. The alert state machine, cooldown, low-balance one-shot, fire-and-forget Layer-C, no-fabricated-data, canonical service set, and mode resolvers are all VERIFIED. The ONLY reason this is not an unconditional PASS is that the live runtime (real cron tick → real vendor probes → real row insert → real alert email) is **deploy-gated** and physically cannot be live-fired pre-deploy. Conditions = the post-deploy live-fire checklist (§ below). No P0/P1 defects found.

---

## What I VERIFIED (unit / integration / real-Postgres evidence)

| # | Angle | How verified | Result |
|---|---|---|---|
| 4 | **RLS / SECURITY** | Applied the migration's tables+RLS+RPC to an ephemeral Postgres 15 (Docker) with Supabase-like `anon`/`authenticated`/`service_role` roles + stubbed `auth.uid()`/`is_admin_user()`. | **VERIFIED**: anon SELECT on all 5 tables = 0 rows; authenticated-non-admin SELECT = 0 rows; non-admin RPC + anon RPC both RAISE `not_authorized`; admin RPC returns services; `service_role` (BYPASSRLS) reads+writes. |
| 1 | **Email fires exactly once per ok→alerting** | Adversarial multi-tick state-threading test counts ACTUAL emails across the real load→decide→persist→re-read loop. 4 consecutive down ticks → exactly 1 down email (entry on tick 2, ticks 3/4 suppressed by 6h cooldown). | **VERIFIED** |
| 2 | **Cooldown boundary** | 6h−1s → no fire; exactly 6h → fires (`>=` semantics); 6h+1s → fires. 24h of continuous down → exactly 4 emails (1 entry + 3 six-hourly), never hourly. | **VERIFIED** |
| 3 | **Low-balance one-shot** | cross fires once; 24 hourly low ticks → 1 email (23 suppressed); low→recover→low re-fires (reset re-arms); still-low after exactly 24h → reminder; null signal never alerts + preserves prior state. | **VERIFIED** |
| 5 | **No fabricated data** | `computeEffectiveStatus`: zero rows → `unknown`+no-alert; unknown+down → surfaces `down` (not masked); unknown+healthy → `healthy` (not faked-down); all-unknown across 10 ticks → 0 emails. Admin UI (`statusDotClass`/`worstOfLayers`, single owner imported by `ApiHealthPage`) → empty/unknown = grey "No signal yet", never green. | **VERIFIED** |
| 6 | **Layer-C fire-and-forget** | All 6 wrap sites use `void recordApiCall(...)` (grep-confirmed, zero `await recordApiCall` on any host path). Stripe + `notifyV2.ts` NOT wired. Adversarial test: hostile args (NaN/Infinity/negative latency, empty/500-char key, undefined http) never throw; bad-host insert swallowed; wrapped-client return value unchanged + returns in <1s (not blocked). | **VERIFIED** |
| 7 | **Digest via api_health_meta (NO `_digest` pseudo-row)** | `api_health_services` seeds exactly 25 REAL services; the only `_digest` strings are comments documenting its absence. Digest gated on `api_health_meta.last_digest_at`. Verified the jsonb round-trip on real Postgres: seed `null` (JS typeof≠string→NaN→fires) ; post-send jsonb string (typeof===string→parses→gates within 20h). | **VERIFIED** |
| 8 | **Canonical service_key** | Gate `i-proposed-1196-service-key-canonical` PASS (25 services, 19 probe keys ⊆ seeded). 4 dead services (Foursquare/Eventbrite/OpenWeatherMap/Firebase) absent from migration + edge fn. Both OneSignal apps surfaced separately (distinct app-id/key env per tile). DB FK on checks/alert_state → services. | **VERIFIED** |
| 9 | **Mode correctness** | `detail.mode` sourced from `resolveStripeMode()` / `resolvePaystackMode()` — no hardcoded `"test"`/`"live"`. | **VERIFIED** (source); runtime mode value DEPLOY-GATED. |
| — | **Webhook freshness column names** | Verified against real schemas: `payment_webhook_events.created_at` ✓, `event_cover_video_jobs.created_at` ✓, `twilio_message_status_events.received_at` ✓, `notification_deliveries`{`provider`,`status`,`attempt_at`} ✓ (implementor's `created_at`→`attempt_at` correction is right; `created_at` does NOT exist on that table). | **VERIFIED** |
| — | **allSettled isolation** | Existing + re-run: one rejecting probe drops only itself; `Promise.all` revert drops all. Handler uses `allSettled` for both Layer-A/B. | **VERIFIED** |
| — | **Sidebar reconciliation 10→17 / 16→17** | Runtime `NAV_ITEMS.length===17` and the list matches `EXPECTED_IDS` exactly; `api-health` genuinely sits between `stripe-mode` and `settings`. NOT count-fudged — assertions equal the real array. `orch1014` 10→17 reconciliation legit (test deepEquals real nav; load-bearing photo-* deletions preserved). | **VERIFIED** |
| — | **Full regression** | 40 deno tests pass (17 logic + 2 allsettled + 2 apiHealthLog + 16 adversarial-statemachine + 3 adversarial-recordApiCall). 22 admin node tests pass (sidebar×2 + apiHealthStatus). `npm test` default 19 pass. 3 strict-grep gates pass. `deno check` clean on edge fn + all 6 wrapped clients + both adversarial files. | **VERIFIED** |
| — | **Blast radius** | The 4 ORCH-1196 commits touch ZERO `app-mobile/`, `mingla-business/`, `mingla-marketing/` files (`git log origin/main..HEAD -- mingla-business/` empty; the 1197 files in the raw diff are pre-existing on origin/main). | **VERIFIED** |

## What is DEPLOY-GATED (cannot be live-fired pre-deploy)

- Migration not applied to the live project (confirmed: `to_regclass('public.api_health_services')` = null). RLS/RPC behavior is VERIFIED on an equivalent ephemeral Postgres, not the live DB.
- pg_cron hourly tick, pg_net→edge invocation, vault `supabase_url`/`service_role_key` resolution.
- Real vendor statuspage fetches + authed synthetic probes (real secrets).
- Real `sendOpsAlertEmail` delivery to seth@usemingla.com (Resend).
- Real `api_health_checks` row landing + admin board render against live data.
- Runtime Stripe/Paystack mode value (resolver wiring is source-verified; the resolved value is runtime).

## Findings

**P0:** none.
**P1:** none.

**P2 (advisory, not blocking):**
- The admin node tests (`orch1008_sidebar`, `orch1014_sidebar_post_prune`, `apiHealthStatus`) are NOT wired into any CI workflow or the `mingla-admin` `npm test` script (which only runs claimsPhone + deckCardPreviewRules). They pass when invoked, but the NO-FABRICATED-HEALTH UI unit test and the sidebar-count invariant are effectively ungated in CI. Pre-existing pattern (the sidebar tests were never in the npm script). Recommend adding them to the admin test script or a CI job on close.
- `maybeSendDigest` writes `JSON.stringify(iso)` through supabase-js `.update({ value })`. supabase-js JSON-serializes the body, so jsonb receives a string (single-encoded) — verified correct on Postgres. The `JSON.stringify` is slightly redundant but harmless; the read path only checks `typeof === "string"`, so even a double-encode would still gate. Leave as-is.
- Stripe `detail.balance` is Stripe *funds* balance (available[0].amount), not API credit — informational only and no threshold/alert wired for it (by spec). Confirmed; not a defect.

## Adversarial test files (append-only, DIFFERENT angle)

- `supabase/functions/api-health-probe/adversarial_statemachine.test.ts` (16 tests) — multi-tick STATE-THREADING that counts ACTUAL emails fired across full ok→alerting→cooldown→recovery sequences + 6h boundary + low-balance lifecycle + unknown-as-neither-floor-nor-ceiling. (Implementor only tested each pure decision once in isolation.)
- `supabase/functions/_shared/adversarial_recordApiCall.test.ts` (3 tests) — hostile-args no-throw + host-call non-regression (return unchanged, not blocked). (Implementor only tested bad-host swallow + missing-env.)

### Fails-on-revert proof (at tester commit `369e5f59a`)
- Remove the cooldown guard in `logic.ts` (`if (elapsed >= cooldownMs)` → always) → adversarial_statemachine **13 passed / 3 FAILED** (entry one-shot, 6h−1s boundary, 24h-spam). Restored → 16/16.
- Flip N=2→N=1 (`nextConsecutiveFailures >= 2` → `>= 1`) → adversarial_statemachine **11 passed / 1 FAILED** (N=2 distinguisher: entry on 2nd tick not 1st). Restored → 16/16.
- `logic.ts` byte-identical after restore (`git status` clean).

## POST-DEPLOY LIVE-FIRE CHECKLIST (the CONDITIONS)

1. Enable `pg_cron` + `pg_net`; confirm vault has `supabase_url` + `service_role_key`. Apply migration `20261120000000` (re-confirm no newer prefix collision). Self-verify guard must pass (cron scheduled, 25 services, meta row present).
2. Deploy `api-health-probe` from MERGED main (`config.toml` already `verify_jwt=false`). Deploy mingla-admin (Vercel).
3. **Auth-guard live-fire:** `POST /functions/v1/api-health-probe` with NO/ wrong Bearer → expect **401**; with `Bearer <SERVICE_ROLE_KEY>` → expect **200** `{ok:true, ticks:N>0, ...}`.
4. **Row landing:** after a forced run, `SELECT count(*), count(distinct service_key) FROM api_health_checks WHERE checked_at > now()-interval '10 min'` → expect ~20+ services across layers; dump one row to confirm `detail`/`mode` shape; confirm Stripe/Paystack rows carry the ACTIVE mode (`test` today).
5. **One dead vendor isolation:** temporarily blank one secret (e.g. `GEMINI_API_KEY`) → that service row = `unknown`, all others still land, tick returns 200, no email for it.
6. **Alert email:** drive 2 consecutive `down` ticks for one service (e.g. point a probe at a bad endpoint or temporarily set a threshold) → confirm exactly ONE `⚠️ [API HEALTH] … is DOWN` email arrives at **seth@usemingla.com**; a 3rd down tick within 6h → NO new email; recovery tick → ONE `✅ … recovered`.
7. **Digest:** at the 13:00 UTC tick, confirm ONE `📊 Daily digest` email; a second 13:00 run same day → suppressed (api_health_meta gate).
8. **Board render:** open admin `#/api-health` as an admin → cards render per category, `unknown` services grey "No signal yet" (never green), `down` red, balances shown for twilio/cloudinary/paystack/pexels, "Last probe Nm ago", 60s auto-refresh. As a NON-admin → error state, no data (RPC `not_authorized`).
9. Flip the 4 I-PROPOSED-1196-* invariants to ACTIVE; register in INVARIANT_REGISTRY.
10. (P2) Add the 3 admin node tests to the mingla-admin test script / a CI job.

## Bottom line
Build quality is high; every layer I could exercise is correct, and the security model is proven against real Postgres. CONDITIONAL PASS — clear to merge/deploy, then complete the live-fire checklist (especially items 6/7/8 — the real email + board render) before closing.
