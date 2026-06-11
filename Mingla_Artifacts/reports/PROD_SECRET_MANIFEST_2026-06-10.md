# Mingla-prod Secret Manifest

**Project:** `gupxgpmukdwhozqfmzgd` (Mingla-prod) · **Date:** 2026-06-10
**State:** 75 secrets set · Stripe **TEST** mode · marketing **OFF** · functionally complete except the 2 launch webhook secrets.
**Source of truth for values:** `~/Desktop/Key Details For Mingla/MINGLA_MASTER_KEYS.md` (consolidated 2026-06-10).

This manifest is the canonical record of what is/isn't set on prod and why. Values are NOT recorded here (see master keys doc).

## SET on prod (75)

| Category | Vars |
|---|---|
| Stripe — money layer | `STRIPE_SECRET_KEY`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, 8 RAKs × {base, `_LIVE`, `_TEST`}, `STRIPE_RAK_TAX_DASHBOARD_TEST` |
| Stripe — mode/config | `MINGLA_STRIPE_MODE`=**test**, `ENVIRONMENT`=production |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_VERIFY_SERVICE_SID` (from Twilio API), `TWILIO_STATUS_CALLBACK_SECRET` (generated) |
| OneSignal | consumer `ONESIGNAL_APP_ID` + `ONESIGNAL_REST_API_KEY`; business `ONESIGNAL_BUSINESS_APP_ID` + `ONESIGNAL_BUSINESS_REST_API_KEY` |
| Resend | `RESEND_API_KEY`, `RESEND_ADMIN_FROM`, `RESEND_SYSTEM_FROM`, `RESEND_TICKET_FROM` |
| AI | `GEMINI_API_KEY`, `GEMINI_API_KEY_ARI`, `OPENAI_API_KEY` (still live: moderate-content, curated-experiences, holiday-categories) |
| Maps & Places | `GOOGLE_MAPS_API_KEY` = `GOOGLE_PLACES_API_KEY` (one key), `MAPBOX_ACCESS_TOKEN` |
| Media | `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET/URL`, `PEXELS_API_KEY`, `EVENT_COVER_VIDEO_PROVIDER`=cloudinary |
| Attribution | `APPSFLYER_DEV_KEY`, `APPSFLYER_BUSINESS_DEV_KEY` (same), `APPSFLYER_BUSINESS_ANDROID_APP_ID`, `APPSFLYER_BUSINESS_IOS_APP_ID` |
| Other ext. | `TICKETMASTER_API_KEY`, `PAYSTACK_SECRET_KEY_TEST`, `SERPER_API_KEY`, `OPENWEATHER_API_KEY` |
| Generated | `UNSUBSCRIBE_TOKEN_SECRET`, `app.qr_token_pepper` |
| Config (URLs) | `MINGLA_PUBLIC_APP_ORIGIN`=https://usemingla.com · `MINGLA_PUBLIC_WEB_BASE_URL` / `BUSINESS_WEB_ORIGIN` / `MINGLA_BUSINESS_WEB_URL`=https://business.usemingla.com |
| Config (email) | `MINGLA_FOOTER_ADDRESS`, `MINGLA_LOGO_URL`=Supabase Storage `App Stuff/mingla_official_logo.png` (verified 200), `STRIPE_DISPUTE_ALERT_EMAILS` / `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS`=seth@usemingla.com |

Auto-injected by the platform (not counted/managed): `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL/JWKS/PUBLISHABLE_KEYS/SECRET_KEYS`.

## LAUNCH-PENDING (2) — created at webhook repoint (runbook step C)
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_PLATFORM` — generated NEW when the live Stripe webhook endpoints are repointed from dev → prod. Do NOT copy dev's.

## SKIPPED — intentionally NOT set (with reason)
- `STRIPE_RAK_TAX_DASHBOARD_LINK` — live mode doesn't use it (ORCH-0953 §3.1).
- `STRIPE_WEBHOOK_SECRET_PREVIOUS` — empty rotation slot.
- All 9 `PLACES_*` — **dead** (admin-seed-places uses hardcoded constants, not env). Also deleted from dev.
- `MINGLA_LOGO_URL_2X` — reserved, never wired. Deleted from dev.
- `NATIVE_PAID_ALLOWED_REGIONS` — **decommissioned** (ORCH-0955); tests assert absence. Deleted from dev.
- `GOOGLE_GEOLOCATION_API_KEY`, `LOVABLE_API_KEY` — **0 code refs**. Deleted from dev.
- `ANTHROPIC_API_KEY` — only the orphaned `score-place-photo-aesthetics` used it (replaced by Gemini intelligence-trial). Deleted from dev.

## Mode & posture
- `MINGLA_STRIPE_MODE`=**test** for Taofeek's load/readiness testing (flip to **live** at real launch).
- `MARKETING_SEND_LIVE_ENABLED`=**false** (no real email/SMS sends).

## Pending code cleanup (ORCH-1108)
Delete 3 confirmed-dead functions from the repo + undeploy: `generate-ai-summary`, `ai-reason`, `score-place-photo-aesthetics`. Evidence: `INVESTIGATE_OPENAI_ANTHROPIC_DEPRECATION_AND_LOGO.md`.

## Follow-ups
- Logo currently points at **dev** storage (works); copy to prod storage + fix the dead `usemingla.com/email-assets` code fallback at launch.
- Optional: migrate moderate-content / generate-curated-experiences / generate-holiday-categories off OpenAI onto Gemini to fully drop the OpenAI runtime dependency.
