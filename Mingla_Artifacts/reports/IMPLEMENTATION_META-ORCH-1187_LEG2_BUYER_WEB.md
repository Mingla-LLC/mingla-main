# IMPLEMENTATION — META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (BUYER WEB)

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/`
**Branch:** `META-ORCH-1187-leg2-buyer-web` (based on origin/main `120806a83`)
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md` (v2)
**Status:** implemented and verified (web build + bundle budget + gates + fails-on-revert all green; runtime PostHog/GA4 landing is a Seth/tester live-fire step requiring Vercel env)

---

## 1. Summary

Added PostHog (posthog-js) + GA4 (Consent Mode v2) to the buyer-web surface (the
`mingla-business` Expo-Web export), WEB-ONLY, with a real Mingla-branded consent
gate. No cookies / no capture until the visitor clicks Accept. Session replay is
ON but masked (all inputs masked; checkout/PII text tagged `data-ph-mask`/
`ph-no-capture`) and sampled at 20% to protect the free tier. Conversion +
funnel + view events fire at the 8 buyer-web call sites. Native is byte-
unaffected: posthog-js/gtag load only via a `.web.ts(x)` split + a
`Platform.OS === "web"` boot guard; the native bundle pulls pure no-op stubs.

This is LEG 2 only. Marketing web (LEG 1) is already merged; native apps (LEG 3)
are NOT touched here.

---

## 2. SPEC success-criteria coverage (LEG-2 scope)

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-3-BuyerWeb | public page load → PostHog `$pageview` + `web_public_offering_viewed` + GA4 hit; native has no posthog-js/gtag | ✓ code; runtime pending Vercel env | `web_public_offering_viewed` fires in all 4 public routes; native-isolation proven (web export confines posthog-js/rrweb to lazy chunk `module-112*.js`, 0 refs in main entry) |
| SC-4-BuyerWeb | web checkout complete → PostHog `web_purchase_completed` + GA4 `purchase` (value+currency) | ✓ code; runtime pending | `captureWeb("web_purchase_completed")` + `gaEvent("purchase", {value,currency})` at event/trip/experience confirm |
| SC-9-SecretHygiene | no `phx_*` in any committed source/bundle; only `phc_*` + `G-Z4W3B9900S` ship | ✓ verified | gate `i-proposed-1187-no-phx-in-client` PASS (2939 files, 0 phx_) |
| SC-11-Consent-BuyerWeb | no capture / no cookies until Accept; banner links to usemingla.com/privacy-policy | ✓ code; runtime pending | `opt_out_capturing_by_default: true` + GA4 consent-default-denied; banner links `https://usemingla.com/privacy-policy` |
| SC-Security-Web | replay masks inputs/card/email/amount on checkout | ✓ structural; runtime recording = tester T-16 | `maskAllInputs: true` + `maskInputOptions{password,email}` + `data-ph-mask`/`ph-no-capture` on PII; gate `replay-masks-pii` PASS |
| SC-Security-Config | mask flags never false anywhere | ✓ verified | gate `replay-masks-pii` PASS |
| SC-13-Flags | feature flag read resolves on a web surface | ✓ code | `getFeatureFlagWeb()` exported (default-safe) |
| SC-15-Errors | thrown test error captured to PostHog error tracking (web) | ✓ code | `capture_exceptions: true` in init |
| SC-16-CostGuard | replay sampling configured | ✓ code | `sampleRate: 0.2` (SESSION_REPLAY_SAMPLE_RATE); autocapture narrowed to click/submit. (Seth's $0 billing cap = SA-1, out-of-band) |

NOTE on the US-host invariant (I-PROPOSED-1187-POSTHOG-HOST-US): the buyer-web
init uses `https://us.i.posthog.com` (gate now scans 2 init sites, PASS).

Runtime SCs (events actually landing in PostHog 479999 + GA4 Realtime) require
the Vercel env vars set (§Operator action) and are the tester's live-fire step
(T-4/T-5/T-13/T-14/T-15/T-16) — labelled "runtime pending" above.

---

## 3. Files changed

NEW (mingla-business):
- `src/analytics/webAnalytics.web.ts` (+313) — PostHog + GA4 consent-gated init, capture/identify/consent facade, masked+sampled replay, dynamic posthog-js import
- `src/analytics/webAnalytics.ts` (+26) — native no-op stub (no posthog-js)
- `src/analytics/ConsentBanner.web.tsx` (+206) — Mingla-branded banner (Accept/Reject/Manage)
- `src/analytics/ConsentBanner.tsx` (+14) — native no-op (returns null)
- `src/analytics/phMask.web.ts` (+26) — `phMaskProps`/`phNoCaptureProps` (web data-attr/class for replay masking)
- `src/analytics/phMask.ts` (+19) — native no-op (returns `{}`)
- `src/analytics/__tests__/orch1187Leg2BuyerWebAnalytics.test.ts` (+154) — happy-path regression

MODIFIED (mingla-business):
- `package.json` (+1) — `posthog-js@^1.205.0`
- `package-lock.json` (+87) — lockfile sync
- `app.config.ts` (+21) — 3 `extra` keys (POSTHOG_KEY/HOST + GA4_MEASUREMENT_ID), adjacent to Mapbox block; Stripe/GIPHY IIFEs untouched
- `app/_layout.tsx` (+22) — web-guarded `initWebAnalytics()` in the deferred-init block + `<ConsentBanner/>` mount
- `app/checkout/[eventId]/confirm.tsx` (+34) — `web_purchase_completed` + GA `purchase` + PII mask
- `app/checkout/[eventId]/index.tsx` (+17) — `web_checkout_started` + GA `begin_checkout`
- `app/checkout-trip/[tripEventId]/confirm.tsx` (+27) — trip purchase capture + PII mask
- `app/checkout-experience/[experienceEventId]/confirm.tsx` (+27) — experience purchase capture + PII mask
- `app/e/[brandSlug]/[eventSlug].tsx` (+18) — `web_public_offering_viewed` (event)
- `app/t/[brandSlug]/[tripSlug].tsx` (+17) — view (trip)
- `app/exp/[brandSlug]/[experienceSlug].tsx` (+17) — view (experience)
- `app/b/[brandSlug]/index.tsx` (+17) — view (brand)

INFRA/GATES:
- `.github/scripts/strict-grep/i-proposed-1187-consent-gate-before-cookies.mjs` (±12) — un-commented LEG-2 entries (buyer-web init + GA loader)
- `.github/scripts/strict-grep/orch-1187-leg2-buyer-web-analytics-wired.mjs` (NEW +130) — LEG-2 wiring gate
- `.github/workflows/strict-grep-mingla-business.yml` (+4) — registered the new gate (self-test + run)

Total: 14 modified + 9 new. `git diff --stat origin/main` confirms ONLY
mingla-business web-path files + the strict-grep gate/workflow. ZERO app-mobile,
supabase, mingla-marketing, mingla-admin changes.

---

## 4. Data-model changes
None. (Phase 1 buyer web is client-side only; no migrations, no edge functions.)

## 5. Edge functions touched
None. (DO-NOT-TOUCH honored; no server-side capture this phase.)

---

## 6. Regression tests added

- **Happy-path (implementor):** `mingla-business/src/analytics/__tests__/orch1187Leg2BuyerWebAnalytics.test.ts` — 18 tests, all PASS. Source-text proofs (node-env, comment-stripped for true fails-on-revert) covering: US host, consent gate, masked replay, GA4 all-denied default, the export facade, dynamic posthog-js import, native no-op purity, `_layout` web-guard + banner mount, and all 8 conversion/view call sites.
- **fails-on-revert verified at commit `<COMMIT_LEG2>`:** deleted the real `opt_out_capturing_by_default: true,` line from `webAnalytics.web.ts` (TRUE line deletion, not comment-out) → the test `opts out of capturing by default` FAILED (1 failed, 17 passed) AND both strict-grep gates (`consent-gate-before-cookies`, `orch-1187-leg2-buyer-web-analytics-wired`) FAILED; restored the line → 18/18 PASS + gates green.
- **Strict-grep gates (all PASS on source tree):** posthog-host-us (2 init sites, US), no-phx-in-client (0 phx_), consent-gate-before-cookies, replay-masks-pii, analytics-web-only-via-web-ts, orch-1187-leg2-buyer-web-analytics-wired (+ self-test).

---

## 7. Old → New receipts (representative)

### webAnalytics.web.ts / webAnalytics.ts (NEW)
- **Before:** no buyer-web analytics existed.
- **Now:** web resolves to a consent-gated PostHog+GA4 module; native resolves to a pure no-op. posthog-js loaded via dynamic `import()` so its bulk stays out of the eager boot chunk.
- **Why:** SC-3/4/11/Security; native-isolation invariant; ORCH-1083 budget.

### app/_layout.tsx
- **Before (deferred-init block):** AppsFlyer + Mixpanel + RevenueCat + OneSignal init only.
- **Now:** + `if (Platform.OS === "web") void initWebAnalytics();`, and `<ConsentBanner/>` mounted at root (web-only render).
- **Why:** one boot init + the consent gate must render on public buyer routes. Native byte-unaffected (guard + `.web` split + null stub).

### app/checkout/*/confirm.tsx (×3)
- **Before:** rendered the order; `Sent to {email} and {phone}` shown in clear.
- **Now:** + a one-shot `web_purchase_completed` (PostHog) + `purchase` (GA4, value+currency) keyed on orderId (covers both sync-confirm and realtime paths); the PII line carries `{...phMaskProps()}` so replay masks it.
- **Why:** SC-4 + SC-Security-Web.

### public pages (×4) + cart index
- **Before:** rendered the offering / cart.
- **Now:** + one-shot `web_public_offering_viewed` (pages) / `web_checkout_started` + GA `begin_checkout` (cart).
- **Why:** SC-3 (funnel top) + the web conversion funnel dashboard.

---

## 8. Cross-surface impact

| Surface | Affected | Detail |
|---------|----------|--------|
| Buyer/anon Web (mingla-business web) | YES | consent banner + PostHog/GA4 (gated), masked replay, captures. Files = `mingla-business/{app,src,app.config,package}`. Parity manual (`.web` split). |
| Business iOS / Android (mingla-business native) | NO | `.web.ts(x)` split + `Platform.OS==='web'` guard → native pulls no-op stubs; posthog-js/rrweb absent from native. Byte-unaffected. |
| Consumer iOS / Android (app-mobile) | NO | not touched (LEG 3). |
| Marketing Web | NO | LEG 1 (merged); not re-touched. |
| Admin Web | NO | out of Phase-1 scope. |

---

## 9. Build / budget / smoke results

- **Web export:** `npx expo export -p web --output-dir web-build` → `Exported: web-build` (success, on rebased tree at origin/main `120806a83`).
- **ORCH-1083 bundle budget:** `node scripts/ci/orch-1083-initial-bundle-budget.mjs` → **PASS** — initial payload 3,215,456 bytes (ceiling 9,405,478); 142 chunk files; 0 deferred specifiers in main entry; `__common` 2,210,332 bytes (cap 2,250,000 — within by ~40KB).
- **posthog-js deferral proven:** the posthog-js SDK + rrweb session-replay bulk live in a lazy chunk `module-112*.js` (~216KB); 0 posthog refs in the 45 main `index-*.js` entry chunks; `__common` holds only my thin `webAnalytics.web` module + a tiny shared posthog stub (2 "posthog" tokens, rrweb absent). The `await import("posthog-js")` kept the SDK out of the boot bundle.
- **TypeScript:** zero `error TS` in ANY of my LEG-2 files (the 702 repo-wide tsc errors are pre-existing on origin/main — buyer.tsx implicit-any + render-test deps; confirmed via `git show origin/main`).
- **Native isolation:** structural (`.web` split + guard) + gate `analytics-web-only-via-web-ts` PASS (posthog-js only in `.web.ts`). A full native `expo export -p ios` string-grep (T-6) is the tester's confirmation; not run here.

---

## 10. Known issues / deferred

- **Runtime live-fire pending Vercel env:** events landing in PostHog 479999 + GA4 Realtime (SC-3/4/11 runtime, T-4/5/13/14/15) + the replay recording inspection (SC-Security-Web/T-16) require the Vercel env set + a real buyer-web session — the tester/Seth step.
- **GA4 `purchase` value basis:** uses `result.total` (major units) — the displayed all-in total, consistent with the confirm screen. No tax/fee breakdown sent (not required Phase 1).
- **`Manage` button (banner):** Phase-1 single combined analytics toggle (Accept/Reject) per spec §4.E — granular categories not required; structure allows future expansion.
- **No `[TRANSITIONAL]` markers introduced.**

---

## 11. Operator action required (Seth)

1. **Vercel env (mingla-business project, Production + Preview):**
   - `EXPO_PUBLIC_POSTHOG_KEY` = `phc_kiBp4PLw8jGLRkpAPtEVQYP7a3gBHYZCAd8PrjRfcVVg`
   - `EXPO_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com`
   - `EXPO_PUBLIC_GA4_MEASUREMENT_ID` = `G-Z4W3B9900S`
   (The app.config has these as fallbacks so a local/preview build still works, but set them in Vercel to make env-rotation explicit + override-able.)
2. **SA-1 ($0 billing cap):** PostHog 479999 → Billing → set billing limit to $0 on every product + no card on file.
3. **SA-2 (project settings):** enable session replay + surveys in PostHog project settings (SDK flags alone are insufficient).
4. No migration `db push`, no edge-fn deploy for this leg.

**Smoke-test on a buyer-web checkout page (after Vercel deploy):**
1. Open an incognito window → load a public offering, e.g. `https://business.usemingla.com/e/<brand>/<event>`.
2. The Mingla consent banner appears bottom-center. Before clicking: DevTools → Application → Cookies/Local Storage shows NO `ph_*` PostHog entry and NO `_ga` cookie; PostHog Live Events (project 479999) shows NO `$pageview`.
3. Click **Accept all** → a `$pageview` + `web_public_offering_viewed` land in PostHog Live Events; GA4 Realtime (stream usemingla.com) shows the hit; cookies now appear.
4. Run a test checkout to the confirm screen → `web_purchase_completed` (PostHog) + `purchase` (GA4) fire. In a PostHog session replay of that flow, the buyer email/phone + payment fields render as MASKED blocks (SC-Security).

---

## 12. Discoveries for Orchestrator

- **DISC-A (ORCH-ID collision, informational):** origin/main commit `120806a83` is titled "ORCH-1187: consumer experience purchase/render fixes + reconcile cron (#585)" — a DIFFERENT, already-merged ORCH-1187 (consumer-experience bug fixes), colliding numerically with META-ORCH-1187 (Growth Analytics). My branch was initially created off a STALE origin/main missing `120806a83`, which made an early diff falsely show that commit's work as "reverted." I rebased onto current origin/main `120806a83` (my work was all uncommitted, so a clean fast-forward); the final diff is clean. No action needed beyond awareness — but the orchestrator may want a COMMS row noting the 1187 number is double-booked (Growth-Analytics META vs the consumer-experience ORCH).
- **DISC-B (gate scans build output):** the LEG-1 META-ORCH-1187 strict-grep gates walk the filesystem WITHOUT excluding `mingla-business/web-build/`. After a LOCAL `expo export`, the posthog-js SDK chunk (which legitimately contains `eu.i.posthog.com` as an SDK default + mask config) trips `posthog-host-us` / `no-phx-in-client` / `replay-masks-pii` as FALSE failures. `web-build` is gitignored so CI never sees it, but a developer running gates locally after a web export will. Suggest adding a `web-build/`/`dist/` exclusion to those gates' `isExempt`/walk (left untouched here to avoid widening LEG-1 gate behavior beyond my consent-gate extension).
