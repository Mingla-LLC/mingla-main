# G7 — App Store + Play evidence backfill (#426 / decision 2A)

**Gate:** G7 — App Store + Play  
**Mode:** Evidence backfill only (listings already live per product docs).  
**Status:** ✅ Public storefront evidence captured 2026-09-10 (version **1.1.6** on all four listings).

## Canonical product attestation (in-repo)

From [`PRODUCT_AND_STRATEGY.md`](../../../PRODUCT_AND_STRATEGY.md) §2 (2026-07-19):

> All four store listings — Mingla Explorer (iOS + Android) and Mingla Host (iOS + Android) — are live on the App Store and Google Play at version 1.1.2.

**Evidence-time correction:** public storefronts show **1.1.6** (App Store lookup 2026-08-23 release; Play “Updated on Aug 22, 2026”). Product doc version string is stale; listings themselves are live.

## EAS submit plumbing (verified on disk)

| App | ASC App ID (`eas.json`) | Play track config |
|-----|-------------------------|-------------------|
| Mingla Host (`mingla-business`) | `6768737367` | `submit.production.android.track: internal` |
| Mingla Explorer (`app-mobile`) | `6760440898` | `submit.production.android.track: internal` |

## Evidence captured (public storefronts)

2A accepts public live listings as proof of store presence. These are **public product pages** (Install / Get), not logged-in ASC/Play Console “Ready for Sale” admin views — equivalent operator proof for “already live.”

| Check | Artifact |
|-------|----------|
| App Store — Explorer live | [`reports/asc-explorer.png`](./reports/asc-explorer.png) |
| App Store — Host live | [`reports/asc-host.png`](./reports/asc-host.png) |
| Play — Explorer live (Install) | [`reports/play-explorer.png`](./reports/play-explorer.png) |
| Play — Host live (Install) | [`reports/play-host.png`](./reports/play-host.png) |
| Public URLs + versions | [`reports/store-urls-2026-09-10.txt`](./reports/store-urls-2026-09-10.txt) |

### Public URLs (2026-09-10)

- Explorer iOS: https://apps.apple.com/us/app/mingla-date-plans-city-gems/id6760440898 — **1.1.6**
- Host iOS: https://apps.apple.com/us/app/mingla-host-sell-grow/id6768737367 — **1.1.6**
- Explorer Android: https://play.google.com/store/apps/details?id=com.mingla.app.v2 — **1.1.6**
- Host Android: https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness — **1.1.6**

## Close checklist for #426

- [x] Four storefront screenshots attached under `reports/`
- [x] Public URLs + version at evidence time recorded
- [x] Epic Tier 2 G7 row → ✅ with link to this folder
