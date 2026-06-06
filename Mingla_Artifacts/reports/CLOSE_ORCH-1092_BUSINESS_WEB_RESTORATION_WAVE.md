# CLOSE ORCH-1092 - Business Web Restoration Wave

**Verdict:** CLOSED PASS Grade A  
**Closed:** 2026-06-06  
**Surface:** Mingla Business Web (`business.usemingla.com`)  
**PR:** #398 `[deploy] ORCH-1092 business web restoration wave`  
**Merge:** `80f7a3d0d`  

## What Shipped

Static Business Home now reopens:

- `/hub/events`
- `/marketing`
- `/marketing/campaigns/compose`
- `/account`

Preserved from earlier waves:

- `/event/create`
- ORCH-1091 mobile chunk recovery, blur-kill CSS, and `?v=orch1091` eager-script cache busting

Still intentionally shelled:

- Payout account
- Hub Experiences
- Hub Trips
- Ari

## Technical Contract

- Web-native hazard wrappers keep native-only `expo-image-picker`, `expo-file-system`, schedule picker, cover picker/video trim, and related imports out of eager web boot.
- The reopened route families have an outer web signed-out recovery before providers.
- Marketing compose uses browser-native date/time controls on web.
- Payout/account copy remains provider-neutral.
- The ORCH-1092 guard checks reopened route markers, shelled route boundaries, provider-neutral copy, eager chunk hygiene, and live-style signed-out recovery.

## Verification

Local branch verification before merge:

```bash
npm run test:orch-1092
rm -rf dist && npx expo export -p web --output-dir dist && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1092
node .github/scripts/strict-grep/orch-0786-creator-avatar-upload-integrity.mjs
node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs
```

GitHub required checks:

- `mingla-business: web build (expo export)` PASS
- `docs-artifact-regression` PASS
- `Test files: append-only` PASS
- Full strict-grep matrix PASS
- Vercel contexts PASS

Production verification:

- `https://business.usemingla.com/home` serves ORCH-1092 reopen markers.
- Live root HTML includes `mingla-mobile-web-chunk-recovery`, `mingla-mobile-web-home-preboot`, `mingla-mobile-web-no-blur`, and `data-orch1091-js-cache-bust`.
- Mobile Chromium production probe:
  - `/home` rendered static Home.
  - `/hub/events` rendered signed-out recovery for Hub Events.
  - `/marketing` rendered signed-out recovery for Marketing overview.
  - `/marketing/campaigns/compose` rendered signed-out recovery for Compose blast.
  - `/account` rendered signed-out recovery for Account settings.
  - No blank screen, no browser crash text, no generic "Cannot Open Page" failure.

Seth smoke:

- Signed-in mobile browser passed after the final branch surface test.

## Deploy Notes

The code was deployed from merged `main` only, per COMMS-0015/0018. Vercel production deployment `dpl_9fdgmdgTebxhtReYV61xN63JFedF` is READY and aliased to `https://business.usemingla.com`.

One manual deploy attempt from the clean merged-main checkout failed before publishing because the Vercel CLI combined the project root directory with the checked-in build command and looked for `mingla-business/mingla-business`. It did not alias over production and did not affect the live ready deployment.

No native OTA was published for ORCH-1092; the shipped surface is Business Web and the native split files preserve existing native behavior rather than changing a native user workflow.

## Evidence Trail

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE_RETEST.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE_RETEST2.md`

## Remaining Web Program Boundary

ORCH-1092 closes the first bounded route-family restoration wave. It does not claim full business-web parity. The next waves should restore remaining high-value route families in larger chunks using this same pattern: native import quarantine, static Home reopen markers, signed-out recovery before providers, ORCH-1091 cache guard preservation, and production phone-browser proof before close.
