# Mingla-prod Supabase Stand-Up — Runbook & Status

**Date:** 2026-06-10
**Owner:** Claude `mingla-orchestrator` (direct execution)
**Decision basis:** Operator authorized "stand up a separate PROD Supabase project." Choices locked: Pro org, **straight-to-LIVE Stripe**, region us-east-2 (match dev), name "Mingla-prod".

## Identity

| | Value |
|---|---|
| Prod project ref | `gupxgpmukdwhozqfmzgd` |
| Prod DB host | `db.gupxgpmukdwhozqfmzgd.supabase.co` |
| Prod URL | `https://gupxgpmukdwhozqfmzgd.supabase.co` |
| Region / org | us-east-2 / Mingla (`mrcqqkovdchaltvquggd`) |
| DB password | in Key Details → `mingla-prod-supabase-db-password.md` |
| Dev project (unchanged) | `gqnoajqerqhnvulmnyvv` ("Mingla-dev") |

## DONE ✅

1. **Project created** — Pro, us-east-2, ACTIVE_HEALTHY.
2. **Schema applied** — all **202 migrations** pushed (`supabase db push --linked`); verified **195 public tables, 1,078 functions, 202 migrations recorded**. Exit 0.
3. **Storage** — all **9 buckets** present (6 migration-created + `avatars`/`marketing-assets`/`place-photos` replicated from dev with matching public flag, size limits, mime types).

## REMAINING (gated — see blockers)

### A. Secrets (98) — BLOCKED on values
Supabase Management API returns secret **values as hashes**, so dev's values cannot be copied programmatically. Source map:
- **Have (Key Details):** Stripe LIVE (pk/sk + 8 RAKs), Twilio (5), OneSignal (4), Mapbox, Google Places, Pexels, Paystack (test), Resend key, Gemini-Ari, Ticketmaster, AppsFlyer.
- **Auto (Supabase sets per-project):** `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL/JWKS/PUBLISHABLE_KEYS/SECRET_KEYS` → use prod's own.
- **Derivable config:** `ENVIRONMENT=production`, `MINGLA_PUBLIC_*` URLs, `RESEND_*_FROM`, `*_ALERT_EMAILS`, `PLACES_*` budgets, `MARKETING_SEND_LIVE_ENABLED`, `EVENT_COVER_VIDEO_PROVIDER`, `BUSINESS_WEB_ORIGIN`.
- **Generate fresh (no data yet):** `UNSUBSCRIBE_TOKEN_SECRET`, `app.qr_token_pepper`.
- **GAP — need values (≈9):** `CLOUDINARY_API_KEY/SECRET/CLOUD_NAME/URL`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (main), `ANTHROPIC_API_KEY`, `SERPER_API_KEY`, `OPENWEATHER_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_GEOLOCATION_API_KEY`, `LOVABLE_API_KEY`.
  - **Best single source:** the dev project's `.env` / a `supabase` secrets file inside the OLD `mingla-main` (recoverable from iCloud — same folder that holds the lost skills). Otherwise pull each from its service dashboard.
- **Also:** `MINGLA_STRIPE_MODE=live` on prod (straight-to-live per operator); load `STRIPE_RAK_*_LIVE` + `STRIPE_SECRET_KEY` (live) + `STRIPE_WEBHOOK_SECRET*` (NEW — see C).

### B. Edge functions (~72) — mechanical, do after secrets
```bash
cd ~/Desktop/mingla-main
# (CLI is already linked to prod ref gupxgpmukdwhozqfmzgd)
supabase functions deploy --project-ref gupxgpmukdwhozqfmzgd   # or per-function
```
Preserve `verify_jwt` per function (CLI reads config.toml). Webhook fns stay `verify_jwt:false`.

### C. Stripe LIVE webhooks — repoint to prod
Live webhooks currently point at the **dev** ref (`gqnoajqerqhnvulmnyvv`). For prod-live, create 2 live webhook endpoints on `https://gupxgpmukdwhozqfmzgd.supabase.co/functions/v1/stripe-webhook` (Connect: 18 events, Platform: 10 events), then load their NEW signing secrets into prod (`STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PLATFORM`).

### D. Auth config — set on prod
Redirect/allow URLs, SMTP sender, external providers, JWT/site URL → mirror dev's GoTrue config.

### E. App cutover — DELIBERATE LAUNCH STEP (affects live users)
Point production builds at prod:
- **Vercel** (mingla-business, marketing, admin): set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` → prod; `MINGLA_STRIPE_MODE=live`; `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_*`. Redeploy.
- **EAS** (app-mobile, mingla-business): production channel env → prod URL/anon key + pk_live. New build or OTA as appropriate.
- Do this only after A–D verified on prod; this is the real "go-live" switch.

## Verification checklist (before cutover)
- [ ] All 98 secrets set on prod (0 gaps).
- [ ] All edge functions deployed; versions bumped; `verify_jwt` preserved.
- [ ] Live Stripe webhooks point at prod + signing secrets loaded; test event delivered.
- [ ] Auth redirect URLs correct.
- [ ] Smoke: anon checkout (live test card), Ari chat, push, media upload, email.
- [ ] Security: re-run `get_advisors` on prod; drop dead backup tables there too (they won't exist on a fresh prod — clean by default).

## Notes
- Dev (`gqnoajqerqhnvulmnyvv`) is **untouched** and remains the test/dev project. CLI is currently linked to prod — relink to dev (`supabase link --project-ref gqnoajqerqhnvulmnyvv`) when returning to dev work.
- Prod starts with **zero data** (correct for production). No test brands/accounts carried over.
