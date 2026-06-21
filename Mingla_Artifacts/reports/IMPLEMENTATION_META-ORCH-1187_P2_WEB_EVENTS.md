# IMPLEMENTATION — META-ORCH-1187 Phase 2 — WEB analytics gap-fixes

**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[p2-web-events]/`
**Branch:** `META-ORCH-1187-p2-web-events` (rebased onto `origin/main` @ `e9f4aa7e1`)
**Scope:** WEB-only (buyer-web `.web` paths + marketing Next site). No native behavior changed; no Stripe/edge/app.config touched.

---

## 1. Summary

Two web analytics instrumentation gaps found by the Phase-2A dashboard build, fixed by mirroring the existing Phase-1 web patterns exactly:

- **FIX 1 (checkout-funnel parity):** the event checkout already fired `web_checkout_started`; the trip and experience checkout cart screens did NOT, so the web funnel undercounted started checkouts for trips/experiences. Added the same on-mount `web_checkout_started` PostHog capture + GA4 `begin_checkout` to both, with `offering_type: "trip"` / `"experience"`.
- **FIX 2 (consent measurement):** both consent banners now fire a `consent_granted` event in the Accept path, ordered AFTER the PostHog opt-in (so it is not dropped while still opted-out). No `consent_denied` PostHog capture is fired on Reject (PostHog stays opted-out there); deny-rate is derived downstream as sessions-without-a-grant. The marketing surface additionally emits a cookieless GA4 `consent_denied`/`consent_granted` ping since gtag is already loaded.

All changes are pure-JS additions using the analytics facades that are ALREADY in the web bundle (`captureWeb`/`gaEvent` from the event checkout; `captureMarketing` from the marketing provider) — no new dependencies, no new heavy imports.

---

## 2. SPEC success-criteria coverage

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| FIX-1-trip | trip checkout fires `web_checkout_started` (offering_type trip) + GA `begin_checkout` | ✓ | `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` on-mount effect; regression test green + fails-on-revert |
| FIX-1-exp | experience checkout fires `web_checkout_started` (offering_type experience) + GA `begin_checkout` | ✓ | `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` on-mount effect; regression test green |
| FIX-2-buyer | buyer-web Accept fires `consent_granted` AFTER opt-in; no `consent_denied` capture | ✓ | `mingla-business/src/analytics/webAnalytics.web.ts` `grantConsent()`; ordering asserted in test |
| FIX-2-mkt | marketing Accept fires `consent_granted` AFTER opt-in; no `consent_denied` capture | ✓ | `mingla-marketing/components/marketing/consent-banner.tsx` `choose()`; ordering asserted in test |
| Gates | I-PROPOSED-1187 strict-grep gates pass | ✓ | all 10 `*1187*` gates OK (§9) |
| Consent gate / masking unchanged | ✓ | no edit to opt-out-by-default / maskAllInputs; consent-gate-before-cookies gate OK |

---

## 3. Files changed

```
mingla-business/app/checkout-trip/[tripEventId]/index.tsx          +20
mingla-business/app/checkout-experience/[experienceEventId]/index.tsx  +21
mingla-business/src/analytics/webAnalytics.web.ts                  +11 -1
mingla-marketing/components/marketing/consent-banner.tsx           +19 -1
mingla-business/src/analytics/__tests__/metaOrch1187P2WebEvents.test.ts  +112 (new)
```

---

## 4. Data-model changes
None.

## 5. Edge functions touched
None.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/analytics/__tests__/metaOrch1187P2WebEvents.test.ts` (new, append-only) — 6 tests, all green.
  - FIX 1: trip + experience cart screens contain `captureWeb("web_checkout_started"` + correct `offering_type` + `gaEvent("begin_checkout"` + the analytics facade import.
  - FIX 2: ordering proofs — `consent_granted` capture index > opt-in index in BOTH banners; and NO `consent_denied` capture in either.
- **fails-on-revert verified at `7e2a7b340`** (pre-rebase) and re-confirmed green post-rebase at `e9f4aa7e1`: deleting the trip `captureWeb("web_checkout_started", {...})` block (true line deletion, not comment-out) → the FIX-1-trip assertion FAILED (`Test Suites: 1 failed, 1 failed test`); restored → 6/6 pass.

Test pattern follows the established node-env source-text proof model used by the sibling `orch1187Leg2BuyerWebAnalytics.test.ts` (comment-stripped before matching so a doc-comment cannot mask a real deletion).

---

## 7. Old → New receipts

### `app/checkout-trip/[tripEventId]/index.tsx`
- **Before:** the trip cart screen rendered with no analytics; no funnel "start" event fired on web.
- **Now:** a ref-guarded on-mount `useEffect` fires `captureWeb("web_checkout_started", { event_id: tripEventId, offering_type: "trip" })` + `gaEvent("begin_checkout", { event_id: tripEventId })` once `tripEventId` resolves. Imports `{ captureWeb, gaEvent }` from `../../../src/analytics/webAnalytics` (platform-resolved `.web` on web, no-op native).
- **Why:** FIX 1 — close the trip funnel undercount; mirror `app/checkout/[eventId]/index.tsx` exactly.
- **Lines:** ~20.

### `app/checkout-experience/[experienceEventId]/index.tsx`
- **Before:** same gap as trip.
- **Now:** ref-guarded on-mount effect fires `web_checkout_started` (`offering_type: "experience"`) + `begin_checkout` on `experienceEventId` resolve. Uses `React.useRef`/`React.useEffect` (matches this file's React-namespaced style).
- **Why:** FIX 1 — experience funnel undercount.
- **Lines:** ~21.

### `src/analytics/webAnalytics.web.ts`
- **Before:** `grantConsent()` opted PostHog in + GA4 consent-update granted; `denyConsent()` opted out. Neither captured a consent event.
- **Now:** `grantConsent()` fires `captureWeb("consent_granted")` + `gaEvent("consent_granted")` AFTER the opt-in (comment documents the ordering rationale + the deny-rate-derivation note). `denyConsent()` documents WHY no capture fires (opted-out → dropped).
- **Why:** FIX 2 — consent-rate measurement without breaking the consent gate.
- **Lines:** +11/-1.

### `mingla-marketing/components/marketing/consent-banner.tsx`
- **Before:** `choose(value)` wrote storage + `applyConsent(value)` (PostHog opt-in/out + GA consent update) but captured nothing.
- **Now:** imports `captureMarketing`; after `applyConsent(value)`, on grant fires `captureMarketing('consent_granted')` + GA4 `consent_granted`; on deny fires only the cookieless GA4 `consent_denied` ping (NO PostHog deny capture). Fires only on the active `choose` path, not the mount re-apply.
- **Why:** FIX 2 — consent-rate measurement on the marketing surface.
- **Lines:** +19/-1.

---

## 8. Cross-surface impact

| Surface | Affected? | What changes |
|---------|-----------|--------------|
| Consumer iOS | No | not touched (app-mobile untouched) |
| Consumer Android | No | not touched |
| Buyer/anonymous Web | **Yes** | trip+experience checkout now fire `web_checkout_started`; Accept fires `consent_granted` (parity automatic — single `.web` codebase) |
| Business iOS | No | `.web.ts`/`.web.tsx` paths resolve to native no-op stubs; the index-file imports resolve to the native no-op `webAnalytics.ts` |
| Business Android | No | same as iOS |
| Admin Web (adjacent) | No | not touched |
| Marketing Web (adjacent) | **Yes** | Accept fires `consent_granted` (PostHog + GA4); Reject fires cookieless GA4 `consent_denied` |

Native safety: the trip/experience index imports use the bare `webAnalytics` specifier (no `.web`), exactly like the already-shipped event checkout, so Metro resolves the native no-op on iOS/Android — zero native behavior change.

---

## 9. Gates run (real output)

All 10 `*1187*` strict-grep gates: **OK**.
```
i-proposed-1187-analytics-web-only-via-web-ts ...... OK
i-proposed-1187-consent-gate-before-cookies ........ OK (opt-out-by-default + GA consent-default-denied pre-GA)
i-proposed-1187-marketing-layout-mounts-analytics .. OK
i-proposed-1187-native-mounts-analytics ............ OK
i-proposed-1187-no-phx-in-client ................... OK (2977 client files, 0 phx_)
i-proposed-1187-posthog-host-us .................... OK (2 init sites, all US)
i-proposed-1187-posthog-key-static-read ............ OK
i-proposed-1187-replay-masks-pii ................... OK (2287 client files, masking intact)
orch-1187-leg2-buyer-web-analytics-wired ........... OK
orch-1187-tester-consent-gate-deletion-robust ...... OK
```
Adjacent: `orch-1130-no-buyer-tax-form` OK.

Jest: `src/analytics/__tests__/` → **3 suites, 33 tests pass** (includes the existing leg-2 happy + tester tests as regression, plus the 6 new P2 tests).

Typecheck (touched files): `npx tsc --noEmit` in `mingla-business` produced **zero errors on the two index files and the new test file**. Pre-existing unrelated errors remain: `webAnalytics.web.ts` "Cannot find module 'posthog-js'" (line 45/201 — those imports exist on `origin/main`; `posthog-js` is not installed in the anchor node_modules) and `buyer.tsx` implicit-any (untouched file). My `webAnalytics.web.ts` edit added NO new imports.

---

## 10. Known issues / deferred — BUILD GATES NOT RUN (environment blocker)

The three build-dependent verifications could NOT run in this worktree and are flagged for the orchestrator/operator to run from a fully-installed checkout:

- `mingla-business` web export (`npx expo export -p web --output-dir /tmp/web-build-check`)
- ORCH-1083 `__common` bundle-budget gate (`ORCH_1083_WEB_BUILD=... node mingla-business/scripts/ci/orch-1083-initial-bundle-budget.mjs`)
- marketing `next build` + `orch-0891-marketing-performance-budget.mjs`

**Reason:** the worktree symlinks `node_modules` → the anchor `mingla-main`, and the anchor is MISSING `expo-tracking-transparency` and `posthog-js` (added by META-ORCH-1187 Leg 3). `expo export` / the budget gate fail at plugin resolution: `Failed to resolve plugin for module "expo-tracking-transparency"`. The marketing worktree has NO `node_modules` at all. This is the SAME pre-existing environment gap documented in **COMMS-0052** (BLOCK, ALL) — it is NOT caused by this change. A `npm install` (anchor + marketing) including the Leg-3 deps is required before these build gates can run.

**Confidence the budget is safe regardless:** all four edits are pure-JS additive (+70/-1) and use analytics facades ALREADY present in the web bundle (event checkout already imports `captureWeb`/`gaEvent`; marketing provider already exports `captureMarketing`). No new module is pulled into any eager chunk, so the `__common` budget is materially unchanged.

CI (Vercel + the GitHub `web-build-check.yml` workflow) WILL run these gates on the PR with a clean install and is the authoritative check.

---

## 11. Operator action required

- **Deploy:** web-only — buyer-web ships via Vercel from merged `main`; marketing ships via Vercel from merged `main`. No OTA, no edge deploy, no migration.
- **Run on the PR (clean install):** the three build gates in §10 (the CI workflow does this automatically).
- **Do NOT OTA the business app** — COMMS-0052 (BLOCK) stands: business OTA is frozen until a new native build ships (posthog-react-native hard-import). These web changes are unaffected by that freeze (web deploys via Vercel, not OTA).

---

## 12. Discoveries for orchestrator

- **COMMS-0052 environment gap is real and blocks local web-build gates.** The anchor `node_modules` lacks `expo-tracking-transparency` + `posthog-js`, so `expo export` / the 1083 budget gate / 0891 budget gate cannot run locally from any worktree symlinked to the anchor. Anyone needing to run web-build gates locally must `npm install` the Leg-3 deps first. (Acknowledged COMMS-0052 as factored-in; my work is web-Vercel, not OTA, so unblocked.)
- No other side issues.
