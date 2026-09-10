# G7 — App Store + Play evidence backfill (#426 / decision 2A)

**Gate:** G7 — App Store + Play  
**Mode:** Evidence backfill only (listings already live per product docs).

## Canonical product attestation (in-repo)

From [`PRODUCT_AND_STRATEGY.md`](../../../PRODUCT_AND_STRATEGY.md) §2 (2026-07-19):

> All four store listings — Mingla Explorer (iOS + Android) and Mingla Host (iOS + Android) — are live on the App Store and Google Play at version 1.1.2.

## EAS submit plumbing (verified on disk)

| App | ASC App ID (`eas.json`) | Play track config |
|-----|-------------------------|-------------------|
| Mingla Host (`mingla-business`) | `6768737367` | `submit.production.android.track: internal` |
| Mingla Explorer (`app-mobile`) | `6760440898` | `submit.production.android.track: internal` |

This proves submission **config** exists; it is not by itself the storefront screenshot.

## Operator evidence still required

| Check | Artifact |
|-------|----------|
| App Store Connect — Explorer Ready for Sale | `reports/asc-explorer.png` |
| App Store Connect — Host Ready for Sale | `reports/asc-host.png` |
| Play Console — Explorer production | `reports/play-explorer.png` |
| Play Console — Host production | `reports/play-host.png` |
| Public store URLs (current version) | paste on #426 |

## Close checklist for #426

- [ ] Four storefront / console screenshots attached
- [ ] Public URLs + version at evidence time recorded on #426
- [ ] Epic Tier 2 G7 row → ✅ with link to this folder
