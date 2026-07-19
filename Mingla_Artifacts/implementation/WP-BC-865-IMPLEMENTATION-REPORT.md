# WP-B + WP-C — ISSUE-865 Attribution Engine (server CAPI + browser pixels)

**Issue:** GitHub #865 (child of #852 Full Rooms) · **WPs:** WP-B (server conversion lane) + WP-C (browser revenue surfaces), built together (shared browser↔server dedup contract).
**Worktree:** `~/Desktop/mingla-orchs/issue-865-[attribution-bc]/` on branch `issue-865-attribution-bc` (rebased onto origin/main — WP-A present, 0 behind).
**Author:** mingla-implementor · **Date:** 2026-07-18
**Commits:** WP-B backend `ed932b09a` · WP-C web `bdced2048` · tests + CI `28e0fd2f3`
**Gates:** `deno check` clean on all edge files (EXIT=0); Stage-B Deno 12/12; Stage-C jest 4/4; both fails-on-revert proven; touched web files 0 tsc errors.

---

## THE SHARED event_id / DEDUP CONTRACT (decided)

**`event_id = orders.id` (the order UUID) — or the reservation id for a venue reservation — used VERBATIM on BOTH sides.** Deterministic; nothing is separately minted or persisted:

- The browser confirm page already holds `result.orderId` (== `orders.id`) and already fires `gaEvent("purchase", { transaction_id: result.orderId })`. WP-C's `fireAdPurchase(result.orderId, …)` sends each pixel's Purchase with that id as the dedup key (Meta `eventID`, TikTok `event_id`, Snap `client_dedup_id`, Reddit `conversion_id`).
- The server `fireAdConversion` is called post-finalize with the order in hand → `event_id = order.id`, `event_name = "Purchase"`. Meta dedups the exact pair (`eventID == event_id` AND `event == event_name`, 48h — A2-5).

Why order.id and not a minted id: the order id is the natural real-world-conversion key and is guaranteed present on both sides, so no `ticket_checkout_sessions` round-trip is needed to agree on the id. (`attribution_click_id` is still threaded — but only to link the conversion to its *campaign/touch*, not to form the dedup id.)

---

## STAGE B — server-side (backend)

### New files
- `supabase/functions/_shared/metaCapi.ts` — `sendMetaConversion`. `POST graph.facebook.com/v25.0/{pixel}/events`, access_token in the JSON body (never the URL), `event_id`/`event_name` = dedup pair, hashed `em`/`ph`, `fbc`/`fbp` UNHASHED, value in major units. No `action_attribution_windows` (it is /events not /insights → RT-4 satisfied by construction). Fail-open.
- `supabase/functions/_shared/tiktokEvents.ts` — `sendTikTokConversion`. `POST business-api.tiktok.com/open_api/v1.3/event/track/`, `Access-Token` header, `event_source_id` = pixel code, shared `event_id`, hashed user email/phone, `ttclid` raw. 200-with-`code!=0` = soft failure. Fail-open.
- `supabase/functions/_shared/snapCapi.ts` — `sendSnapConversion`. `POST tr.snapchat.com/v3/{pixel}/events?access_token=…`, `client_dedup_id` = shared event_id, hashed `em`/`ph`, `sc_click_id` raw, event_time in ms. Fail-open.
- `supabase/functions/_shared/redditCapi.ts` — `sendRedditConversion`. `POST ads-api.reddit.com/api/v3/pixels/{pixel}/conversion_events`, Bearer token, v3 `event_type.tracking_type`, `event_metadata.conversion_id` = shared event_id. **PENDING-CONFIG: token unset → `{status:'skipped', reason:'pending_config'}`, never an error (SC-12)** — starts sending the instant `REDDIT_ADS_CAPI_TOKEN` exists, no code change.
- `supabase/functions/_shared/adConversionFire.ts` — **the ONE post-finalize hook** `fireAdConversion(supabase, { orderId | reservationId, surface?, lane?, eventType? })`. Self-resolving: loads the order/reservation, derives brand via `events.brand_id`, resolves `attribution_click_id → touch` (reconstructs Meta `fbc = fb.1.{touch.created_at}.{fbclid}`), hashes buyer email/phone (SHA-256), upserts ONE `ad_conversions` row (idempotent on `event_id`), then fans out to the 4 senders in parallel (`Promise.allSettled`, bounded 8s each) and records per-channel `*_status` + `provider_response` (never a token). **Per-channel status-gate idempotency**: a channel already non-`pending` is not re-sent (replay → no double-send, RT-2). **NEVER throws** (outer try/catch → `{ok:false, reason:'absorbed'}`).
- Token resolution (A3-2, no hardcoded secrets, NAMES only): Meta `extra.dataset_id` + `extra.capi_env_var` (default `META_CAPI_ACCESS_TOKEN`); TikTok `extra.pixel_id` + `extra.events_env_var` (default `TIKTOK_EVENTS_ACCESS_TOKEN`); Snap `extra.pixel_id` + default `SNAPCHAT_CAPI_TOKEN`; Reddit `extra.reddit_pixel_id` + default `REDDIT_ADS_CAPI_TOKEN`. Per-lane via `(platform, lane)` on `ad_connections`.

### Finalize wiring — the exact 6 sites (all post-paid, fail-open, mirroring `fireOrderFinalizeNotifications` / the AppsFlyer S2S block)
| Site | File | Placement | Await mode |
|---|---|---|---|
| Stripe webhook | `supabase/functions/_shared/stripeWebhookRouter.ts` | after the notify block, before AppsFlyer S2S | **awaited** (webhook, no human) |
| Confirm slow-path | `supabase/functions/ticket-checkout-confirm/index.ts` | after `fireOrderFinalizeNotifications` | **fire-and-forget** (buyer's tap→pay wait) |
| Paystack/NGN | `supabase/functions/_shared/paystackWebhookRouter.ts` | after the finalize RPC (NGN-only arm) | awaited |
| Free order | `supabase/functions/ticket-checkout-create/index.ts` | after the free finalize (value 0) | fire-and-forget |
| Reconcile cron | `supabase/functions/reconcile-stuck-checkouts/index.ts` | after the recovery finalize | awaited |
| Venue reservation | `supabase/functions/venue-reservation-confirm/index.ts` | after `pg_finalize_guest_reservation` | fire-and-forget |

Idempotency (per-channel status gate + unique `event_id`) makes firing from all 6 safe; the confirm/webhook race collapses to one send per channel.

### Migration (WRITTEN, not applied)
`supabase/migrations/20270106000865_issue_865_wp_bc_gdpr_and_threading.sql` — additive, no guards/backfills (no probe required):
- **P3-2 (GDPR):** `ad_attribution_touches.user_id` FK → `ON DELETE SET NULL` (a user erasure NULLs the touch instead of being blocked).
- **§5.1 threading:** `ticket_checkout_sessions.attribution_click_id text NULL` (+ partial index). Read by `fireAdConversion` via `orders.id → session.order_id`, so `biz_ticket_checkout_finalize` internals are untouched (DO-NOT-TOUCH honored).
- Prefix `20270106000865` > WP-A head `20270105000865` and every sibling worktree; none of the six COMMS-0102 duplicate prefixes.

### P3-1 note
The anon capture path (`attribution-capture`, WP-A) already carries a per-isolate rate limit. "Correlate before trusted for spend" is satisfied here: `fireAdConversion` only stamps `connection_id`/`campaign_id` when a real `click_id → touch` correlates; uncorrelated conversions carry no campaign attribution. The spend/ROAS rollup itself is WP-E (out of WP-B/C scope).

---

## STAGE C — browser (the LIVE revenue surfaces)

### `mingla-business/src/analytics/webAnalytics.web.ts` (+ native no-op sibling `webAnalytics.ts`)
- 4 pixels (`fbq`/`ttq`/`snaptr`/`rdt`) loaded via **dynamic `<script>` injection**, each in its own `try/catch` (`safePixel`), **no-op when the id is absent**. IDs resolved through the existing `readEnv` switch: `EXPO_PUBLIC_META_PIXEL_ID`, `EXPO_PUBLIC_TIKTOK_PIXEL_CODE`, `EXPO_PUBLIC_SNAP_PIXEL_ID`, `EXPO_PUBLIC_REDDIT_PIXEL_ID` (NAMES only; no values).
- **Consent gate (SC-8 / RT-3):** pixels bootstrap ONLY inside `grantConsent()` (`bootstrapAdPixels`), NEVER in `initWebAnalytics` — EEA/London is not tracked pre-consent. Reuses the existing `mingla_consent_v1` gate; GA4 Consent-Mode-v2 already present.
- `fireAdPageView` / `fireAdViewContent` / `fireAdPurchase(eventId, {value, currency})` — all no-op until bootstrapped; each pixel call wrapped so a failure is silent.
- `captureAdClickIds` — parses `fbclid`/`ttclid`/`sccid`/`gclid`/`rdt_cid`/`af_c_id`/`utm_*` off the landing URL, records a first-party server touch, stores the returned `click_id` in sessionStorage for threading. **No email/phone leaves the browser.**
- `postAttributionTouch` / `postAttributionConversion` — fire-and-forget, 4s-bounded fetches to `attribution-capture` (anon key). The conversion POST carries `event_id`(=orderId)/value/currency/click_id only — **no PII egress**; the server hashes PII from the order and owns the authoritative CAPI send.

### Public pages (PageView/ViewContent + click capture on mount)
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`
- `mingla-business/app/b/[brandSlug]/index.tsx`

### Checkout success — the DEDUP fire (`fireAdPurchase` + `postAttributionConversion`, keyed on `result.orderId`)
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`
- `mingla-business/app/checkout-experience/[experienceEventId]/confirm.tsx`

### Click-id threading
- `mingla-business/src/services/ticketCheckoutService.ts` — `createTicketCheckout` (the event-type-agnostic shared create used by event + trip + experience-web) forwards the stored `attribution_click_id` into `ticket-checkout-create` ONLY when present (byte-identical for non-ad traffic).

**ABSOLUTE RULE honored:** every pixel is background/deferred (dynamic import + try/catch), a blocked/broken pixel is a silent no-op, and NONE sits on the tap→pay critical path — reserve+pay stay fully functional with pixels blocked (proven by the Stage-C fail-open test).

---

## EXACT web + finalize files touched

**Finalize (server) — 6 + 1 threading:** `_shared/stripeWebhookRouter.ts`, `ticket-checkout-confirm/index.ts`, `_shared/paystackWebhookRouter.ts`, `ticket-checkout-create/index.ts` (fire + threading persist), `reconcile-stuck-checkouts/index.ts`, `venue-reservation-confirm/index.ts`.

**Web (LIVE):** `src/analytics/webAnalytics.web.ts`, `src/analytics/webAnalytics.ts`, `app/e/[brandSlug]/[eventSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`, `app/b/[brandSlug]/index.tsx`, `app/checkout/[eventId]/confirm.tsx`, `app/checkout-trip/[tripEventId]/confirm.tsx`, `app/checkout-experience/[experienceEventId]/confirm.tsx`, `src/services/ticketCheckoutService.ts`.

---

## SPEC success-criteria coverage

| SC | Covered by | Commit |
|---|---|---|
| SC-2/SC-3 (threading + one conversion when paid, event/trip/experience) | fireAdConversion at 6 sites; unique `event_id`; threading | `ed932b09a` |
| SC-4-meta/tiktok (+snap/reddit) send hashed PII + shared event_id; fail-open | 4 senders + fire helper | `ed932b09a` |
| SC-5 / SC-15 (dedup, exact pair, at each confirm page) | event_id = orders.id both sides; `fireAdPurchase` | `ed932b09a`/`bdced2048` |
| SC-8 (consent: no client pixel pre-consent, no PII egress) | consent-gated bootstrap; PII-free browser POSTs | `bdced2048` |
| SC-9 (SHA-256 PII; no raw PII stored/sent) | `sha256Hex` in senders/helper; hashed-only columns | `ed932b09a` |
| SC-12 (Reddit PENDING-CONFIG until token) | `redditCapi` soft-skip | `ed932b09a` |
| GDPR erasure cascade (P3-2) | migration `ON DELETE SET NULL` | `ed932b09a` |

---

## Regression tests + fails-on-revert evidence

**Stage B — `supabase/functions/_shared/__tests__/issue_865_wp_b_ad_conversion.test.ts` (Deno, 12/12):** sender wire shapes (endpoint/fields/hashing/shared event_id), fail-open (500/timeout absorbed), Reddit `pending_config` skip, fire-helper dedup contract (one send per channel with the shared id), idempotency (all-sent row → re-sends nothing), fail-open (throwing DB and throwing sender both absorbed). Registered in the `stripe-deno` `DENO_TEST_FILES` batch.

**Stage C — `mingla-business/src/analytics/__tests__/webAnalytics.pixels.issue865.test.ts` (jest, 4/4):** consent gate blocks pre-consent firing, grantConsent bootstraps + `fireAdPurchase` carries `eventID == order id` (dedup), no-op when pixel id absent, simulated pixel-load failure does not throw/break the flow. Runs in a dedicated `issue-865-attribution-jest` CI job.

**fails-on-revert (both proven, restored byte-identical):**
- adConversionFire fail-open guard → reverted the outer catch to `throw err` → the "throwing DB is ABSORBED" test **FAILED** (0 passed / 1 failed) → restored → 12/12 green. `fails-on-revert verified at ed932b09a`.
- Browser consent gate → added `bootstrapAdPixels()` into `initWebAnalytics` (pre-consent) → the "CONSENT GATE" test **FAILED** at `adPixelsReady()===false` → restored → 4/4 green. `fails-on-revert verified at bdced2048`.

---

## Off-critical-path + fail-open confirmation

- **Server:** `fireAdConversion` runs only AFTER finalize marked the order paid; it NEVER throws (proven); webhook/cron sites await it (bounded, no human waiting), buyer-facing sites (confirm slow-path, free-order, venue) fire-and-forget so the buyer's response is never delayed. A CAPI 500/timeout is absorbed into `*_status='failed'` — it can never block, delay, or reverse a purchase.
- **Browser:** all pixels are dynamic-import + try/catch + no-op-when-absent, bootstrapped only on consent, off the tap→pay path; the attribution POSTs are fire-and-forget + timeout-bounded. A blocked/broken pixel leaves reserve+pay fully functional (proven by the Stage-C fail-open test).

---

## Operator action required
1. **Apply the migration from MERGED main:** `cd "/Users/sethogieva/Desktop/mingla-orchs/issue-865-[attribution-bc]" && /Users/sethogieva/bin/supabase db push --linked` (additive; no guards → safe).
2. **Deploy edge functions from MERGED main** (orchestrator-owned): `attribution-capture` (already live, unchanged), and the finalize callers that now import the shared helper — `stripe-webhook`, `ticket-checkout-confirm`, `ticket-checkout-create`, `reconcile-stuck-checkouts`, `venue-reservation-confirm`, `paystack-webhook`. Preserve each function's existing `verify_jwt` (unchanged; no config.toml edits made).
3. **Set the client pixel-id env NAMES** in `mingla-business` app config `extra` / `.env`: `EXPO_PUBLIC_META_PIXEL_ID`, `EXPO_PUBLIC_TIKTOK_PIXEL_CODE`, `EXPO_PUBLIC_SNAP_PIXEL_ID`, `EXPO_PUBLIC_REDDIT_PIXEL_ID` (values from master keys; no values in repo). Pixels no-op until set.
4. **Generate `REDDIT_ADS_CAPI_TOKEN`** in Reddit Events Manager to flip Reddit from `pending_config` to live.
5. This touches `mingla-business` web → it IS a `[deploy]`-gated surface; the orchestrator adds `[deploy]` at CLOSE (not added by this session).

---

## Discoveries for Orchestrator
- **Pre-existing broken test (not mine):** `supabase/functions/_shared/__tests__/meta_orch_1074_order_paid_payload.test.ts` FAILS identically on the untouched anchor (`origin/main`) with `-A` — "unexpected table event_dates" in its fake supabase + an AssertionError. Environment/stale-mock issue, unrelated to WP-B/C; flagging for triage.
- **COMMS-0102 factored** (unique migration prefix `20270106000865`). Per the no-push guard, no ledger ack was pushed — the orchestrator can append it at CLOSE.
- **A foreign `git stash`** sits in the shared stash stack (COMMS-0105); untouched by this session.
- **fbp** is not reconstructable server-side (browser-only cookie); the server Meta CAPI uses hashed email/phone + reconstructed `fbc`. The browser pixel carries the real `fbc`/`fbp`; the two dedup on the shared `event_id`. Match quality is good; noting for the live-fire tester.
