# INVESTIGATION — #865 Attribution Engine re-validation vs SHIPPED ad engine

**Issue:** GitHub #865 (child of #852 "[Full Rooms] Internal Ad & Reservation Engine")
**Mode:** INVESTIGATE (re-validation) — verify the #865 spec's "what exists" claims against the NOW-MERGED ad engine on `origin/main`; produce a current build plan. No product code, no API writes, no deploys, no push.
**Worktree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine` (rebased onto `origin/main`, now 0 behind; 5 issue-865 spec commits ahead).
**Author:** mingla-forensics · **Date:** 2026-07-18
**Ground truth base:** `origin/main` after the #862/#863/#866 ad-engine merges (foundation migration `20261230000000_issue_862_ad_engine_foundation.sql`; creative library `20261231000866_issue_866_creative_library.sql`).

---

## 0. Purpose

The #865 SPEC (body + A1 + A2) was authored 2026-07-14/15 when the ad engine was still Meta-only research. Since then the **generalized 5-channel engine shipped** (#862/#863/#866). This investigation re-bases every "what exists" claim in the spec against main, names the exact NEW files #865 must touch (verified, not assumed), isolates the highest-risk change (tracking code on LIVE web surfaces), and sequences the build.

**Comms ledger factored (OPEN WARN, ALL):** COMMS-0112 (`i-1378-web-shim-export-parity` gate — the `appsFlyerService.web.ts` shim MUST export the full native surface; `openExternal` no longer passes `noopener`), COMMS-0102 (duplicate migration version-prefix hazard — #865's migration must use a unique, correctly-ordered prefix), COMMS-0100/0083 (AppsFlyer click/deep-link attribution already works — complementary to #865's conversion lane). No OPEN+BLOCK entry targets this work; the CI-red BLOCK entries (0111/0108/0103) are all RESOLVED, main green since `d4f0996df`/#941. Per the no-push guard I did not push a ledger ack.

---

## 1. Investigation manifest (files read verbatim, in order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `Mingla_Artifacts/specs/SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md` (body+A1+A2) | docs | the contract under re-validation |
| 2 | `Mingla_Artifacts/research/ad-pipeline-2026-07-15/PROOF_LOG.md` | evidence | pixel ground truth (never-fired proofs) |
| 3 | `supabase/migrations/20261230000000_issue_862_ad_engine_foundation.sql` | schema | the SHIPPED ad-engine tables |
| 4 | `supabase/functions/_shared/adChannel.ts` | code | ChannelAdapter, token resolution, pixel-gated-goals |
| 5 | `supabase/functions/admin-ad-create-campaign/index.ts` (gate regions) | code | the live `422 pixel_no_signal` gate per channel |
| 6 | `supabase/functions/admin-ad-preflight/index.ts` + `admin-ad-connect/index.ts` (grep) | code | pixel-state capture at connect/preflight |
| 7 | `supabase/functions/_shared/meta.ts` (pixel reader) | code | `metaFetchPixelLastFired` live-signal read |
| 8 | `mingla-business/src/analytics/webAnalytics.web.ts` | code | the web pixel install target (PostHog+GA4 today) |
| 9 | `mingla-business/app/{e,t,b,checkout,checkout-trip,checkout-experience}/**` (grep) | code | real public + checkout surfaces + firing sites |
| 10 | `mingla-business/src/services/appsFlyerService.web.ts` + native `appsFlyerService.ts` ×2 | code | deep-link capture + shim parity |
| 11 | `supabase/functions/_shared/stripeWebhookRouter.ts` + finalize callers (grep) | code | conversion-fire choke point |
| 12 | `supabase/config.toml` (admin-ad block) | config | verify_jwt pattern for new fns |
| 13 | `~/Desktop/Key Details For Mingla/MINGLA_MASTER_KEYS.md` (name-grep only) | data | CAPI env-var NAMES provisioned |

---

## 2. Q-scorecard

**Q1 — Are the DB tables #865 integrates with the ones the spec names (`meta_campaigns`, `meta_ad_connections`)?**
Verdict: **NO — spec is STALE (proven).** The shipped engine is the generalized `ad_connections` / `ad_campaigns` / `ad_sets` / `ads` / `ad_status_events` (+ `ad_creatives` from #866). There is no `meta_campaigns`/`meta_ad_connections` table on main. (F-1)

**Q2 — Are `ad_attribution_touches` / `ad_conversions` and any CAPI/pixel sender code already on main?**
Verdict: **NO — greenfield confirmed (proven).** Neither table exists; no `metaCapi`/`tiktokEvents`/`snapCapi`/`redditCapi`/`conversion_events` sender exists. #865 §5.1/§5.2 are genuinely to-build. (F-2)

**Q3 — Where do the browser pixels actually install, and how many surfaces?**
Verdict: **4 public page templates + THREE checkout flows (proven; spec undercounts).** Public: `/e/[brandSlug]/[eventSlug].tsx`, `/t/[brandSlug]/[tripSlug].tsx`, `/b/[brandSlug]/index.tsx`. Checkout: `/checkout/[eventId]/`, **`/checkout-trip/[tripEventId]/`, `/checkout-experience/[experienceEventId]/`** — each with index/payment/confirm. The spec names only `app/checkout/[eventId]`. (F-3)

**Q4 — Is the web analytics init the spec targets still the right file, and what's already there?**
Verdict: **YES — `webAnalytics.web.ts` is correct and already has the consent machinery (proven).** PostHog + GA4, consent-gated on `mingla_consent_v1`; **GA4 Consent Mode v2 already emitted** (default-denied before load); `gaEvent("purchase")` already fires "for the Ads conversion link" at all three confirm pages. Missing: `fbq`/`ttq`/`snaptr`/`rdt`. (F-4)

**Q5 — How do the CAPI senders resolve pixel IDs + tokens on the shipped engine?**
Verdict: **Per-connection via `ad_connections.extra` + `token_env_var` (proven).** `ad_connections` has `UNIQUE (platform, lane)`, `token_env_var`, and `extra jsonb` whose COMMENT declares it carries `pixel/dataset id, capi_env_var`. Senders must resolve from the connection row, not hardcoded EXPO_PUBLIC secrets. (F-5)

**Q6 — Does the `422 pixel_no_signal` gate (WP-D) already exist, and does it self-open?**
Verdict: **PARTLY — three different designs, only Meta self-opens (proven).** Meta reads LIVE `last_fired_time` (`metaFetchPixelLastFired`) → self-opens. Snap keys on a STORED `extra.pixel_installed === true` flag. TikTok is an UNCONDITIONAL hard-reject with no opening condition. (F-6)

**Q7 — Which CAPI token env-var NAMES are provisioned; which is missing?**
Verdict: **3 provisioned, Reddit's value TODO (proven).** Names present in master keys: `META_CAPI_ACCESS_TOKEN`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `SNAPCHAT_CAPI_TOKEN` (+ `SNAPCHAT_REFRESH_TOKEN`, `TIKTOK_PIXEL_CODE`, `EXPO_PUBLIC_TIKTOK_PIXEL_CODE`). `REDDIT_ADS_CAPI_TOKEN` is name-reserved but its value is still to be generated in Reddit Events Manager. Meta/Snap/Reddit `EXPO_PUBLIC_*_PIXEL_ID` names were not found — pixel IDs live in `ad_connections.extra` (F-5), so client-side pixel IDs should be sourced from app config `extra`/connection, not new secrets. (F-7)

**Q8 — Is the conversion-fire choke point the spec's list of callers?**
Verdict: **NO — more callers, and a shared post-paid hook precedent exists (proven).** `biz_ticket_checkout_finalize` is called from `stripeWebhookRouter.ts:1165`, `paystackWebhookRouter.ts`, `ticket-checkout-create`, `ticket-checkout-confirm`, `reconcile-stuck-checkouts`, `ticket-confirmation-dispatch`. `_shared/businessNotifyTriggers.ts` is the existing post-order-paid hook and the correct precedent for a shared `_shared/adConversionFire.ts` helper. (F-8)

---

## 3. Findings (six-field evidence)

### F-1 — Spec DB references are stale: `meta_campaigns`/`meta_ad_connections` → `ad_campaigns`/`ad_connections`
- **Symptom:** SPEC §5.1 defines `campaign_id uuid ... REFERENCES public.meta_campaigns(id)`; §4 references `meta_ad_connections`; §5.5 "spend from #862's `meta-campaign-sync`".
- **Layer:** schema/code.
- **Probe:** `grep -rlE "create table[^;]*(ad_connections|ad_campaigns...)" supabase/migrations/`; read of foundation migration lines 33–137.
- **Evidence:** foundation migration defines `public.ad_connections` (L33, `platform` CHECK meta/tiktok/snapchat/google/reddit, `UNIQUE (platform, lane)`), `public.ad_campaigns` (L60, `connection_id`, `dest_url`, `dest_smart_link`). No `meta_campaigns` / `meta_ad_connections` table exists anywhere. Shipped sync fn is `admin-ad-campaign-sync` (config.toml L443).
- **Mechanism:** #865's FKs and joins keyed on Meta-only table names would not compile against main; every `campaign_id` FK must target `public.ad_campaigns`.
- **Severity:** CONFIRMED (spec correction required).

### F-2 — Attribution/conversion tables + all CAPI/pixel senders are genuinely greenfield
- **Symptom:** #865 must build the measurement layer.
- **Layer:** schema/code.
- **Probe:** `grep -rli "ad_attribution_touches|ad_conversions" supabase/`; `grep -rli "metaCapi|tiktokEvents|snapCapi|redditCapi|sendMetaConversion|conversion_events" supabase/functions/`; `ls _shared/ | grep -i capi|pixel|convers`.
- **Evidence:** all four greps returned EMPTY.
- **Mechanism:** confirms §5.1 tables + §5.2 senders are net-new (nothing to reconcile/fork).
- **Severity:** CONFIRMED (greenfield — no conflict).

### F-3 — Web install surface undercounted: THREE checkout flows, not one
- **Symptom:** SPEC §3/§5.3/§10 name only `app/checkout/[eventId]`.
- **Layer:** code.
- **Probe:** `find mingla-business/app -type d`; `grep -rn 'gaEvent("purchase"|web_purchase_completed' checkout*/`.
- **Evidence:** three parallel confirm pages fire GA4 purchase — `checkout/[eventId]/confirm.tsx:351`, `checkout-trip/[tripEventId]/confirm.tsx:336-343`, `checkout-experience/[experienceEventId]/confirm.tsx:296-303`. Public pages `/e/…:50` and `/t/…` fire `web_public_offering_viewed`.
- **Mechanism:** a browser `Purchase`/`CompletePayment` pixel + attribution threading added only to the event flow would silently drop ALL trip and experience conversions — under-attribution, not a crash.
- **Severity:** CONFIRMED ROOT-CAUSE-CLASS for the spec's surface list (must widen to all three flows + `/t/`, `/b/`).

### F-4 — `webAnalytics.web.ts` is the right target and already carries consent + Consent-Mode-v2 + purchase-event scaffolding
- **Symptom:** need to know how much of §5.3 is already built.
- **Layer:** code.
- **Probe:** full read of `mingla-business/src/analytics/webAnalytics.web.ts`.
- **Evidence:** consent-gated PostHog (`opt_out_capturing_by_default:true`) + GA4; `loadGa4()` emits `gtag('consent','default',{ad_storage:'denied',...})` (Consent Mode v2) BEFORE config (L147-156); `grantConsent()`/`denyConsent()` flip both gates (L242-280); `gaEvent()` fires GA4 events "for the Ads conversion link" (L294-303); env via a `readEnv` switch (COMMS-0028 — no dynamic bracket access, L65-84). No `fbq`/`ttq`/`snaptr`/`rdt`.
- **Mechanism:** #865 extends THIS file — add the 4 browser pixels into `initWebAnalytics` (dynamic import, no-op when id absent), consent-gate them in `grantConsent`/`denyConsent`, and add new ids to the `readEnv` switch. The GA4 Consent-Mode-v2 half of A2-8 is already satisfied; Meta/TikTok/Snap/Reddit must be added to the same gate.
- **Severity:** CONFIRMED (reduces §5.3 scope; hard invariant: keep the consent gate).

### F-5 — Pixel IDs + CAPI token env-var NAMES live in `ad_connections.extra` / `token_env_var` — senders must resolve per-connection
- **Symptom:** spec proposes new `EXPO_PUBLIC_*` + standalone secrets; engine already stores these per-connection.
- **Layer:** schema/code.
- **Probe:** read foundation migration L34-58 + `adChannel.ts` L50-58/L414-418; `admin-ad-connect/index.ts:924`.
- **Evidence:** `ad_connections.token_env_var text NOT NULL`; COMMENT L57-58: "extra also carries per-platform miscellany: page_id, pixel/dataset id, capi_env_var…"; ChannelAdapter "Resolves the token from `Deno.env[conn.token_env_var]`"; connect stores `pixel_last_fired_time`.
- **Mechanism:** the server CAPI senders should resolve `{pixel_id, capi_env_var}` from the lane's `ad_connections` row (then `Deno.env.get(capi_env_var)`), matching the engine's established token-resolution pattern, rather than introducing parallel hardcoded secrets. Keeps two-lane (consumer/business) correctness automatic via `(platform, lane)`.
- **Severity:** CONFIRMED (integration contract — reuse, don't fork).

### F-6 — The `422 pixel_no_signal` gate has THREE designs; only Meta self-opens; TikTok cannot open at all today
- **Symptom:** WP-D ("flip the gate off once real events flow") is not uniform.
- **Layer:** code.
- **Probe:** read `admin-ad-create-campaign/index.ts` L2444-2463 (Meta), L891-912 (Snap), L1355-1363 (TikTok); `meta.ts` L601-620.
- **Evidence:**
  - **Meta** L2448: `const pixel = await metaFetchPixelLastFired(client); if (!pixel.hasSignal) return 422 pixel_no_signal` — LIVE read, self-opens when `last_fired_time ≠ epoch-0`.
  - **Snap** L894-901: `if (SNAPCHAT_PIXEL_GATED_GOALS.includes(goal)) { if (sconnExtra.pixel_installed !== true) return 422 pixel_goal_unavailable }` — STORED flag in `extra`.
  - **TikTok** L1357-1363: `if (TIKTOK_PIXEL_GATED_OBJECTIVES.includes(objectiveT)) return 422 pixel_goal_unavailable` — UNCONDITIONAL; no opening condition exists.
- **Mechanism:** making the pixels fire opens Meta automatically (no code). Snap opens only when something sets `extra.pixel_installed=true`. TikTok can NEVER offer a web-conversion objective until this code is edited to add an opening condition. Therefore WP-D MUST edit `admin-ad-create-campaign/index.ts` (a #862/#863 file the original spec's DO-NOT-TOUCH implied off-limits).
- **Severity:** CONFIRMED — and a direct conflict with **SC-13** ("every downstream gate reads LIVE pixel signal, never a '#865 shipped' flag"): Snap uses a flag, TikTok uses a constant.

### F-7 — 3 CAPI tokens provisioned; `REDDIT_ADS_CAPI_TOKEN` value still to be generated
- **Symptom:** which channels can send server-side today.
- **Layer:** data.
- **Probe:** `grep -oE "<name-alternation>" MINGLA_MASTER_KEYS.md | sort -u` (names only; values never emitted).
- **Evidence:** names present — `META_CAPI_ACCESS_TOKEN`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `SNAPCHAT_CAPI_TOKEN`, `SNAPCHAT_REFRESH_TOKEN`, `TIKTOK_PIXEL_CODE`, `EXPO_PUBLIC_TIKTOK_PIXEL_CODE`, `REDDIT_ADS_CAPI_TOKEN` (name reserved). PROOF_LOG A2-7: the Reddit conversion access token is generated once in Events Manager (non-expiring, token-first path CONFIRMED via official docs; no `adsconversions` re-consent needed).
- **Mechanism:** Meta/TikTok/Snap can send server conversions the moment the sender code ships; Reddit is PENDING-CONFIG until a human generates the token; Google has NO conversion action at all (separate later piece).
- **Severity:** CONFIRMED (human prerequisite isolated).

### F-8 — Conversion-fire choke point: 6 finalize callers + an existing post-paid hook precedent
- **Symptom:** spec §5.2/§10 lists 4 callers (stripe/paystack/free/venue); reality is 6.
- **Layer:** code.
- **Probe:** `grep -rln biz_ticket_checkout_finalize supabase/functions/`; `grep businessNotifyTriggers`.
- **Evidence:** callers: `_shared/stripeWebhookRouter.ts:1165`, `_shared/paystackWebhookRouter.ts`, `ticket-checkout-create`, `ticket-checkout-confirm`, `reconcile-stuck-checkouts`, `ticket-confirmation-dispatch`. `_shared/businessNotifyTriggers.ts` already runs post-order-paid (test `meta_orch_1074_order_paid_payload`).
- **Mechanism:** to fire exactly once per real-world conversion (idempotent on `event_id`), #865 should add ONE shared `_shared/adConversionFire.ts` invoked at the same post-finalize point notifications already use — not N ad-hoc edits. Venue reservations hook `venue-reservation-confirm` (dir exists).
- **Severity:** CONFIRMED (design: single shared helper, idempotent).

---

## 4. Five-truth-layer reconciliation

| Layer | Says | Contradiction |
|---|---|---|
| Docs (spec body/A1) | "Meta/TikTok only; Google/Snap → #867"; `meta_campaigns`/`meta_ad_connections`; one checkout flow | A2 already pulled Snap/Reddit/Google in; shipped engine is 5-channel `ad_*`; three checkout flows |
| Schema (main) | `ad_connections(platform,lane)` + `extra.{pixel_id,capi_env_var}`; `ad_campaigns`; NO `ad_conversions`/`ad_attribution_touches` | senders resolve per-connection (F-5); attribution tables greenfield (F-2) |
| Code (main) | Meta gate reads live signal; Snap=flag; TikTok=constant; web funnel + Consent-Mode-v2 already wired | SC-13 (live signal only) contradicted by Snap flag + TikTok constant (F-6) |
| Runtime (PROOF_LOG) | all pixels epoch-0/zero-events; Google conversion action absent | #865 is the first-fire; gates stay closed until it ships AND fires |
| Data (master keys) | 3 CAPI tokens present; Reddit value TODO | Reddit AC is PENDING-CONFIG (F-7) |

**Every contradiction is a spec-staleness item, not a runtime bug** — this is a spec re-validation, so findings drive Amendment A3 (appended to the spec), not a fix.

---

## 5. WHAT EXISTS vs WHAT #865 MUST BUILD (verified against main)

### Already shipped (reuse — do NOT rebuild)
- **Per-lane, per-platform connections:** `ad_connections` with `UNIQUE (platform, lane)`, `token_env_var`, `extra.{pixel_id, capi_env_var, minimum_budgets, page_id}`. All 5 platforms modelled.
- **Campaign/adset/ad/status tables** (`ad_campaigns` carries `dest_url` canonical + `dest_smart_link` demoted), `ad_creatives` (#866).
- **Provisioned pixels (all never-fired):** Meta `1949011972638955` (single canonical dataset, `NOT_ONBOARDED`), TikTok `7662469356818858002`, Snap `af5f8fc4-…` (ACTIVE, `automatic_event_opt_in:OPT_OUT`), Reddit pixel = ad-account id `a2_jcfwvnfcfqcs`. Google: none.
- **CAPI tokens:** `META_CAPI_ACCESS_TOKEN`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `SNAPCHAT_CAPI_TOKEN` (+ Snap refresh) — provisioned.
- **Live-signal gate (Meta only):** `metaFetchPixelLastFired` + `META_PIXEL_GATED_GOALS` → 422 self-opens.
- **Web funnel + consent:** `webAnalytics.web.ts` (PostHog+GA4, consent gate, **GA4 Consent-Mode-v2**, `gaEvent("purchase")` at all 3 confirm pages), `web_public_offering_viewed` on /e/ and /t/.
- **AppsFlyer click/deep-link attribution** (consumer OneLink live) — the CLICK lane; #865 adds the CONVERSION lane on top.

### #865 must build (net-new)
1. **DB migration** (unique prefix per COMMS-0102): `ad_attribution_touches`, `ad_conversions` (unique `event_id`; `campaign_id → ad_campaigns(id)`, NOT `meta_campaigns`), `ticket_checkout_sessions.attribution_click_id`, `ad_campaign_rollups_v` + `admin_ad_rollups` RPC, RLS (service-insert, admin+brand-scoped select).
2. **4 server CAPI senders** `_shared/{metaCapi,tiktokEvents,snapCapi,redditCapi}.ts` — resolve pixel_id + token env-var from `ad_connections.extra` per lane; fail-open; hashed PII; dedup id shared with browser pixel.
3. **`attribution-capture` edge fn** (`verify_jwt=false`, anon) — persists a touch, returns `click_id`.
4. **Shared `_shared/adConversionFire.ts`** invoked at the single post-finalize point (F-8) across the 6 callers + venue-confirm — idempotent insert + fan-out to the senders.
5. **4 browser pixels** (`fbq`/`ttq`/`snaptr`/`rdt`) in `webAnalytics.web.ts`, consent-gated; PageView/ViewContent on `/e/`, `/t/`, `/b/`; Purchase/CompletePayment on ALL THREE confirm pages; click-id capture + threading through all THREE checkout flows.
6. **App deep-link capture** in both native `appsFlyerService.ts` (+ keep `.web.ts` shim export parity — COMMS-0112).
7. **`admin-ad-rollups` edge fn + admin view** (`mingla-admin`).
8. **WP-D gate work** — TikTok/Snap gate opening conditions in `admin-ad-create-campaign/index.ts` (allowlist expansion; F-6).
9. **(Phase B)** `admin-ad-audience-create` (generalized, not `admin-meta-audience-create`) + Reddit CAPI token wiring + Google Enhanced Conversions (later).

---

## 6. HIGHEST-RISK ITEM — tracking code on LIVE consumer + business web surfaces

**This is the flag.** #865 injects third-party tracking (`fbq`/`ttq`/`snaptr`/`rdt` + click capture + a network POST to `attribution-capture`) into pages REAL buyers load and pay on. These are the only revenue surfaces in the whole company.

**Exact surfaces/files that change (LIVE):**
- `mingla-business/src/analytics/webAnalytics.web.ts` (pixel init + consent gate).
- Public pages: `app/e/[brandSlug]/[eventSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`, `app/b/[brandSlug]/index.tsx`.
- Checkout (×3 flows): `app/checkout/[eventId]/{index,confirm}.tsx`, `app/checkout-trip/[tripEventId]/{index,confirm}.tsx`, `app/checkout-experience/[experienceEventId]/{index,confirm}.tsx`.
- App deep-link: `app-mobile/src/services/appsFlyerService.ts`, `mingla-business/src/services/appsFlyerService.ts` (+ `.web.ts` shim).

**Failure modes to design against (all fail-OPEN):**
1. A pixel script that throws/404s/blocks (adblock, CSP, slow CDN) must NEVER block render, the "Reserve"/"Pay" tap, or navigation. Pixel loads must be dynamic-import + try/catch + no-op-when-absent (mirror the existing PostHog dynamic-import pattern) and must never sit on the critical purchase path.
2. `attribution-capture` POST failing/slow must never delay landing or checkout — fire-and-forget, timeout-bounded, non-awaited on the purchase path.
3. The server conversion send (CAPI) must run AFTER finalize and fail-open (record `*_status='failed'`, never throw upward) — RT-1.
4. Consent: no pixel fires and no PII leaves the browser under denied consent (extend the existing `mingla_consent_v1` gate to the 4 new pixels; EEA/London → Consent-Mode-v2 already present for GA4, must cover the new tags) — RT-3.
5. Double-fire: browser pixel + server CAPI must dedup on an exact `event_id`/`event_name` pair (Meta 48h window; F-6/A2-5) — else conversions double-count.

**Test strategy (runtime proof required — source-only is capped at "suspected"):**
- **Static/unit:** RT-1 (CAPI throws → order still `paid`), RT-2 (webhook replay → no 2nd conversion), RT-3 (no raw PII in `ad_*`; consent gate), RT-4 (strict-grep: no `7d_view`/`28d_view`; `META_API_VERSION=v25.0`).
- **Live-fire (mingla-tester, real devices — MANDATORY):** run a real #862 LINK_CLICKS campaign to a live page; click from a physical device (web + app); complete a REAL purchase on each of the three checkout flows; confirm exactly-once conversion in Meta Events Manager Test Events + TikTok + Snap + the admin rollup, deduplicated, correct revenue/ROAS; and prove fail-open by loading checkout with pixels blocked (adblock/offline) and completing a purchase.
- **Regression guard:** a "pixel-throws-does-not-block-purchase" test at each confirm page (fails on revert of the try/catch/no-op wrapper).

---

## 7. BUILD-PLAN — Work Packages (sequenced)

Dependencies flow top-down. Each WP names its touched surfaces + human prerequisites.

### WP-A — Conversion-tracking schema + attribution capture (foundation)
- **Build:** migration (`ad_attribution_touches`, `ad_conversions` unique `event_id`, `ticket_checkout_sessions.attribution_click_id`, rollup view + `admin_ad_rollups` RPC, RLS); `attribution-capture` edge fn (`verify_jwt=false`); config.toml.
- **Surfaces:** `supabase/migrations/**`, `supabase/functions/attribution-capture/**`, `supabase/config.toml`.
- **Depends on:** shipped `ad_campaigns`/`ad_connections` (FK target — F-1). Migration prefix must be unique + latest-ordered (COMMS-0102).
- **Human prereq:** none.

### WP-B — 4 server CAPI senders + shared fire helper + dedup (server conversion lane)
- **Build:** `_shared/{metaCapi,tiktokEvents,snapCapi,redditCapi}.ts` (resolve pixel_id + token env-var from `ad_connections.extra` per lane — F-5; hashed PII; fail-open); `_shared/adConversionFire.ts` (idempotent insert + fan-out); wire it at the single post-finalize point across the 6 callers (F-8) + `venue-reservation-confirm`. Deterministic `event_id` = Mingla order/reservation id (Meta eventID==event_id AND event==event_name exact pair, 48h, fbc/fbp unhashed — A2-5).
- **Surfaces:** `supabase/functions/_shared/**`, the 6 finalize callers (hook point ONLY), `venue-reservation-confirm`.
- **Depends on:** WP-A (`ad_conversions`). Reddit send is code-complete but PENDING-CONFIG until `REDDIT_ADS_CAPI_TOKEN` value exists.
- **Human prereq:** generate `REDDIT_ADS_CAPI_TOKEN` in Reddit Events Manager (F-7). Meta/TikTok/Snap tokens already set.

### WP-C — Browser pixels + click capture + checkout threading (LIVE web surfaces — HIGHEST RISK, §6)
- **Build:** add `fbq`/`ttq`/`snaptr`/`rdt` to `webAnalytics.web.ts` (consent-gated, dynamic-import, fail-open, ids via `readEnv`/app-config `extra`); PageView/ViewContent on `/e/`, `/t/`, `/b/`; Purchase/CompletePayment on ALL THREE confirm pages with the shared `event_id`; click-id parse + `attribution-capture` POST on public-page mount; thread `attribution_click_id` through all THREE checkout-create calls.
- **Surfaces:** `webAnalytics.web.ts`; `app/e|t|b/**`; `app/checkout|checkout-trip|checkout-experience/**` (F-3).
- **Depends on:** WP-A (`attribution-capture`, `click_id`), WP-B (shared `event_id` contract).
- **Human prereq:** verify each pixel fires in Events Manager after install; confirm Consent-Mode-v2 covers new tags for London/EEA traffic.

### WP-C2 — App deep-link capture (parity lane)
- **Build:** in both native `appsFlyerService.ts` `onDeepLink`, read `af_c_id`/`deep_link_*`, POST `attribution-capture` (`surface:ios|android`), thread `click_id` into checkout; keep `appsFlyerService.web.ts` export parity (COMMS-0112 gate `i-1378-web-shim-export-parity`).
- **Surfaces:** `app-mobile/src/services/appsFlyerService.ts`, `mingla-business/src/services/appsFlyerService.ts` (+ `.web.ts`).
- **Depends on:** WP-A. Ships in a NATIVE build (COMMS-0063: business OTA bricks — native only; release-parity gate COMMS-0096/0097).
- **Human prereq:** connect Meta + TikTok as AppsFlyer integrated partners (dashboard, no code).

### WP-D — Open the pixel-signal gates once events flow (cross-channel)
- **Build:** Meta gate already self-opens (no code). Give Snap an opening condition (set `ad_connections.extra.pixel_installed=true` after verified install, ideally upgrade to a live-signal read for SC-13 parity) and TikTok an opening condition at `admin-ad-create-campaign/index.ts:1357` (currently an unconditional reject — F-6). Reconcile SC-13: either upgrade Snap/TikTok gates to live-signal reads (recommended, matches Meta + A2-4) or document the flag as an accepted per-channel exception.
- **Surfaces:** `supabase/functions/admin-ad-create-campaign/index.ts` (**allowlist expansion** — was implicitly DO-NOT-TOUCH), possibly `_shared/{tiktok,snapchat}.ts` for a `fetchPixelLastFired` equivalent.
- **Depends on:** WP-C (pixels actually firing).
- **Human prereq:** none (self-verifying if live-signal reads).

### WP-E — Rollups/proof feed + Phase-B audiences (measurement out + retargeting)
- **Build:** `admin-ad-rollups` edge fn + `mingla-admin` rollup view + brand-scoped proof feed; **(Phase B)** `admin-ad-audience-create` (generalized name) with the A2-9 sequencing gate + size floors + per-channel lookalike ratios; Google Enhanced Conversions + GCLID import (separate later piece — A2-8). Spend/ROAS via `admin-ad-campaign-sync` (NOT `meta-campaign-sync`), never requesting `7d_view`/`28d_view` (RT-4).
- **Surfaces:** `supabase/functions/admin-ad-rollups/**`, `mingla-admin/src/**`.
- **Depends on:** WP-A/B (data), WP-D (audiences gate on live signal).
- **Human prereq:** link Instagram to Page `797406353459597` (IG retargeting/engagement audiences — PROOF M-P10); Google conversion-action creation for the Google lane.

---

## 8. HUMAN PREREQUISITE LIST (precise)

1. **Generate `REDDIT_ADS_CAPI_TOKEN`** in Reddit Events Manager (Generate conversion access token — shown once, non-expiring). Blocks Reddit server sends only (SC-12 PENDING-CONFIG). Token-first path CONFIRMED; no `adsconversions` OAuth re-consent needed (A2-7).
2. **Verify each pixel fires after install** — Meta `1949011972638955`, TikTok `7662469356818858002`, Snap `af5f8fc4-…`, Reddit `a2_jcfwvnfcfqcs` — in each platform's Events Manager / Test Events. This is what flips the Meta gate open automatically and is the precondition for setting Snap `pixel_installed=true` / TikTok gate opening.
3. **Consent-Mode-v2 / cookie-consent for EEA (London is live):** GA4 already emits Consent-Mode-v2; confirm the 4 new pixels honor the same `mingla_consent_v1` gate and that Meta/Google tags emit the required consent signals for London/EEA traffic (A2-8, GR-51).
4. **AppsFlyer partner config** — connect Meta + TikTok as integrated partners (dashboard; no code) so in-app purchase events forward.
5. **Link Instagram to Page `797406353459597`** — unblocks IG retargeting/engagement audiences (Phase B; PROOF M-P10). Facebook-only until then.
6. **Google conversion action** — none exists; create conversion actions + Enhanced Conversions + GCLID import for the Google measurement lane (separate later piece; tCPA/tROAS stay un-offered until ≥15 conv/30d).

---

## 9. STALE SPEC ASSUMPTIONS (now corrected vs shipped main)

| Spec text | Reality on main | Fix |
|---|---|---|
| `campaign_id REFERENCES public.meta_campaigns(id)`; `meta_ad_connections` | tables are `ad_campaigns`/`ad_connections` (F-1) | retarget all FKs/joins |
| §2 non-goal "Google/Snapchat → #867" | engine ships all 5; A2 already pulled Snap/Reddit/Google | senders cover Meta/TikTok/Snap/Reddit; Google = later lane |
| §5.2 `admin-meta-audience-create`; §5.5 `meta-campaign-sync` | generalized `admin-ad-*`; sync is `admin-ad-campaign-sync` | rename to generalized fns |
| §5.3/§10 one checkout flow (`app/checkout/[eventId]`) | THREE flows: event/trip/experience (F-3) | pixels + threading on all three + `/t/`, `/b/` |
| New `EXPO_PUBLIC_*_PIXEL_ID` + standalone CAPI secrets | pixel_id + capi_env_var live in `ad_connections.extra`; token via `token_env_var` (F-5) | senders resolve per-connection/lane |
| §5.2 finalize = 4 callers; DO-NOT-TOUCH the admin-ad fns | 6 callers + a shared post-paid hook precedent; WP-D MUST edit `admin-ad-create-campaign` (F-8, F-6) | single shared fire helper; allowlist +create-campaign gate |
| SC-13 "every gate reads LIVE signal, never a flag" | Meta live-reads; **Snap uses `extra.pixel_installed` flag; TikTok is an unconditional constant** (F-6) | WP-D reconciles: upgrade to live reads OR document per-channel exception |
| §7 "resolve duplicate dataset first" | CLOSED — single canonical pixel (A2-1) | already removed in A2 |

---

## 10. Confidence + recommended next phase

**Confidence: PROVEN (source-of-truth reads on main).** Every finding is backed by a file+line on `origin/main` or a verbatim PROOF_LOG probe. This is a docs/schema/code re-validation — the live-fire directive applies to the IMPLEMENT/TEST phases (real-device pixel firing), not to this re-validation, which is code-truth against main.

**Recommended next phase:** the spec is sound in shape but stale in specifics — **append Amendment A3** (this investigation's deltas) and route to `mingla-implementor` starting **WP-A → WP-B → WP-C** (Phase A), with WP-C gated behind the fail-open + consent + dedup test contract, then WP-D/WP-E. mingla-tester owns the live-fire dedup + fail-open proof on real devices.

**No fix proposed here** (INVESTIGATE discipline): the corrections land as SPEC Amendment A3, not code.
