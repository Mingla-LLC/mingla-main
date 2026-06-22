# ORCH-1196 — External API / Service Inventory (authoritative)

**Status:** INVESTIGATE pending. This file is the canonical, completeness-proven inventory of every
external/third-party service the Mingla program depends on. Built 2026-06-21 from a 5-angle parallel
sweep (env-vars · package deps · raw hostnames · edge-function enumeration · native/build config) so
that no integration could hide behind a single search method.

**Affected Surfaces (the feature, not the inventory):** Admin Web (`mingla-admin`) + backend-only
(scheduled probe edge functions + Resend alert email). NOT consumer/business apps.

## LOCKED DECISIONS (Seth, 2026-06-21 — bind the SPEC)

1. **Alert recipient:** `seth@usemingla.com` (single recipient for now; use an env-var list so it can grow — reuse the existing `STRIPE_*_ALERT_EMAILS` pattern, e.g. `API_HEALTH_ALERT_EMAILS`).
2. **Scope:** Build **ALL THREE layers** — (A) vendor status-page aggregation, (B) authenticated synthetic probes, (C) passive real-traffic success-rate via a shared `_shared/` logging wrapper. No phasing-down. Full rigorous pipeline: deep research, no assumptions, extensive testing, drive to completion.
3. **Probe cadence:** **hourly** (synthetic probes run once per hour; passive layer is continuous; status-page poll can match the hourly tick).

---

## Completeness method (why we trust this is 100%)

Five independent angles were run in parallel and reconciled. Each angle catches what the others miss:

| Angle | Catches | Tooling |
|---|---|---|
| Env-vars / secrets | services referenced only by a secret name | `Deno.env.get`, `process.env`, `EXPO_PUBLIC_*`, every `.env.example`/`eas.json` |
| Package deps | client SDKs that phone home (incl. hardcoded-key SDKs) | every `package.json` |
| Raw hostnames | one-off `fetch()`/`axios` hosts a service-name search misses | grep all `https://` + call sites |
| Edge-function enumeration | per-function integrations + inbound webhooks | all 144 dirs under `supabase/functions/` |
| Native/build config | services wired only in native config | `app.config.ts`, `app.json`, `eas.json`, `google-services.json`, `vercel.json` |

**Services the single-angle first pass MISSED (caught only by cross-check):** Foursquare,
ExchangeRate-API, Thum.io, Google Analytics 4, Firebase, Vercel, Apple Sign-In, App Store/Play
billing rails. **False positive killed:** "SendGrid" — no `SENDGRID_*` var exists; those functions
use Resend.

---

## A. Monitorable service dependencies (the health-hub scope)

Each has credentials/quota/rate and a reachable endpoint, so it can fail and should be on the board.

### AI
| Service | Env var(s) | Surface | Cost | Health probe |
|---|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY`, `GEMINI_API_KEY_ARI` | backend | paid per-token + quota | `models.list` (cheap) |
| OpenAI | `OPENAI_API_KEY` | backend | moderation free; GPT paid | `models` list |

### Payments
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_RAK_*`, webhook secrets, `MINGLA_STRIPE_MODE` | backend + client | per-txn % (TEST mode now) | balance/account retrieve (free) |
| Paystack | `PAYSTACK_SECRET_KEY_TEST/LIVE`, `PAYSTACK_MODE` | backend | per-txn (TEST mode) | balance endpoint |

### Maps / location
| Mapbox | `MAPBOX_ACCESS_TOKEN` (server), `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (client static) | backend + client | paid per-request | 1 tiny geocode |
| Google Places/Maps | `GOOGLE_MAPS_API_KEY` | backend | paid per-request | 1-result text search (small cost) |
| Foursquare | `EXPO_PUBLIC_FOURSQUARE_API_KEY` | client(?) | paid tier | **VERIFY live vs dormant** |

### Seeding / discovery
| Ticketmaster | `TICKETMASTER_API_KEY` | backend | paid, rate-limited | 1-result query |
| Serper | `SERPER_API_KEY` | backend | paid per-request | has credit-balance endpoint |
| Pexels | `PEXELS_API_KEY` | backend | paid, rate-limit headers | 1-result search |
| Giphy | `EXPO_PUBLIC_GIPHY_API_KEY` | business client (ToS forbids proxy) | paid | client-only; hard to probe server-side |
| Eventbrite | `EVENTBRITE_TOKEN` | backend | — | **VERIFY live vs dormant** |

### Messaging / push / email
| OneSignal | `ONESIGNAL_APP_ID`/`_REST_API_KEY` + `ONESIGNAL_BUSINESS_*` (TWO apps) | backend + client | paid per-push | "view app" endpoint |
| Resend | `RESEND_API_KEY` + `RESEND_*_FROM` | backend | paid per-send | domains list |
| Twilio | `TWILIO_ACCOUNT_SID`/`_AUTH_TOKEN`/`_MESSAGING_SERVICE_SID`/`_VERIFY_SERVICE_SID` | backend | paid per-msg + balance | account fetch + **balance** |

### Media / data
| Cloudinary | `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` | backend | paid, byte/duration caps | usage/ping (exposes credit balance) |
| ExchangeRate-API | (`currencyService.ts:92`) | consumer client | free tier likely | 1 rate fetch |
| Thum.io | (`VenueCreatorWizard.tsx:405`) | business client | paid/free tier | 1 screenshot fetch |
| Open-Meteo | (`app-mobile/.../weatherService.ts:8`) | consumer client | free | 1 forecast fetch |
| OpenWeatherMap | `OPENWEATHER_API_KEY` (`supabase/functions/weather/index.ts:63`) | backend | free tier | **VERIFY which weather API is live** |

### Monetization
| RevenueCat | hardcoded SDK keys (`appl_*`/`goog_*`) | consumer client | rev-share | status page / SDK |

### Platform / infra
| Supabase | `SUPABASE_URL`/`_ANON_KEY`/`_SERVICE_ROLE_KEY` | all | paid platform | `select 1` + status page |
| Vercel | hosting + `@vercel/og` | web | paid platform | deploy status / status page |

---

## B. Client-SDK analytics & observability (monitor via vendor status page + ingestion confirmation)

Can't synthetic-probe with our server creds the same way; health = vendor up + events arriving.

| PostHog | `EXPO_PUBLIC_POSTHOG_KEY`/`_HOST`, `NEXT_PUBLIC_POSTHOG_*` | consumer + business + marketing | free tier |
| Mixpanel | `EXPO_PUBLIC_MIXPANEL_TOKEN` + S2S engage | consumer + business + backend | paid (being retired, ORCH-1191) |
| Sentry | `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SUPABASE_SENTRY_DSN` | consumer + business + backend | paid (3 projects) |
| AppsFlyer | `APPSFLYER_DEV_KEY`/`_BUSINESS_*` + S2S | consumer + business + backend | paid |
| Google Analytics 4 | `EXPO_PUBLIC_GA4_MEASUREMENT_ID`, `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `@next/third-parties` | web + apps | free |

---

## C. Auth / platform rails (external dependencies, mostly not synthetic-probeable)

| Google Sign-In (OAuth) | `GOOGLE_*_CLIENT_ID` | consumer + business | free |
| Apple Sign-In | `expo-apple-authentication` | consumer + business | free |
| Firebase | `google-services.json` (project `mingla-dev`) | Android | **VERIFY active vs dormant — push is OneSignal, may be storage-only/legacy** |
| Apple App Store / Google Play (IAP) | RevenueCat-mediated; EAS submission | consumer | rev-share |
| Apple Pay / Google Pay | Stripe-mediated native rails | both apps | — |

---

## D. NOT a monitored dependency (share intents / asset CDNs — listed for completeness, excluded from hub)

- Social share intent URLs: twitter/x, instagram, facebook, linkedin, threads, tiktok
- Calendar add-event links: Google Calendar, Outlook
- Image asset hosts: Unsplash (`images.unsplash.com` placeholders), `framerusercontent.com` (Framer marketing assets)

These are user-facing link-outs or static asset CDNs, not credentialed APIs that can "fail" for us.

---

## E. Inbound webhook receivers (health = receiving, not sending — distinct monitoring signal)

1. `stripe-webhook` — Stripe Connect/platform events (signed) — already has `stripe-webhook-health-check`
2. `paystack-webhook` — Paystack charge events (HMAC-SHA512)
3. `event-cover-video-webhook` — Cloudinary processing completion (signature + timestamp)
4. `twilio-inbound-sms` — STOP/HELP keywords (form POST)
5. `twilio-message-status` — SMS delivery status callbacks (form POST)

---

## F. Open verification items for INVESTIGATE (must resolve before SPEC)

1. **Foursquare** — env var exists; is it actually called in live code, or dormant?
2. **Eventbrite** — `EVENTBRITE_TOKEN` present; minimal usage — live or dead?
3. **Weather** — Open-Meteo (app-mobile) AND OpenWeatherMap (edge fn) both exist; which is live, which is legacy?
4. **Firebase** — `google-services.json` present; confirm storage-only/dormant vs actively used (push is OneSignal).
5. **SendGrid** — confirm definitively absent (no `SENDGRID_*` var; agent false positive).
6. Per-service: cheapest no-/low-cost probe endpoint, and which expose **credit balance / quota** for low-balance alerts.
