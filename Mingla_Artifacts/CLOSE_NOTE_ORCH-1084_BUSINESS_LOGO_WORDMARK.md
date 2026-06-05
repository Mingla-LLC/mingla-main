# CLOSE NOTE — ORCH-1084 Business Logo Wordmark

## Verdict

CLOSED PASS Grade A on 2026-06-05.

The Mingla Business welcome screen now renders the official `assets/brand/mingla-business-logo.png` logo on business web and native. The first merge introduced the asset, but live production web proof showed the image loaded invisibly; the corrective merge renders an explicit web `<img>` with stable 220x220 sizing while preserving the native React Native `<Image>` path.

## Shipped

- PR #378 merged at `7ccf01716`: initial official logo replacement.
- PR #379 merged at `89845e46`: corrective visible web render path.
- Vercel `mingla-business` deploy passed via `[deploy]`.
- Business-app production OTA published from clean merged `origin/main` commit `89845e46`, never from an unmerged worktree:
  - iOS group `8185fdb3-dec2-4e71-b5f0-307c750edcd9`, update `019e9949-b3da-778e-be77-5fcf00e48ea7`.
  - Android group `74b8fa13-54c9-470f-b8f7-431843c01737`, update `019e994b-8b63-72a0-80d0-722bd505c3d1`.

## Evidence

- Regression tests: `BusinessWelcomeScreenLogo.test.tsx` and `BusinessWelcomeScreenLogoAdversarial.test.tsx` passed 7/7.
- QA: `Mingla_Artifacts/reports/QA_ORCH-1084_BUSINESS_LOGO_WORDMARK_REWORK.md`.
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1084_BUSINESS_LOGO_WORDMARK.md`.
- Live production proof at `https://business.usemingla.com`: `img[alt="Mingla Business"]` has natural 2000x2000 dimensions, renders at 220x220, opacity `1`, display `block`, visibility `visible`.
- Screenshot: `Mingla_Artifacts/reports/orch-1084-evidence/live-production-mobile-after.png`.

## Residuals

None for this scoped logo surface. No backend, migration, RLS, edge function, admin, consumer, or checkout changes were in scope.
