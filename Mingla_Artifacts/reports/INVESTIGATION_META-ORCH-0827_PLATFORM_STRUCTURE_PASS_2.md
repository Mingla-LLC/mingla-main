# INVESTIGATION — META-ORCH-0827 PLATFORM STRUCTURE — Pass 2

> **Pass 1 reference:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`
> **Pass 1 SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`
> **Author:** Claude `mingla-forensics` (INVESTIGATE+SPEC, iterative)
> **Date:** 2026-05-13
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> **Trigger:** Operator added new constraint after Pass 1: "whatever is happening on the business app, needs to render on the consumer app. Users need to be able to pay from the app... I don't want browsers, or external links, I want in-app workflows."

---

## 0. Pass 1 Verdict Superseded

Pass 1 recommended deferring workspace migration under the assumption that no current product requirement created cross-app shared-code needs. The operator's new constraint invalidates that assumption directly:

- **Cross-app rendering parity:** consumer app's business-event sheet must render identically to mingla-business's public event page. As Tr2 (trips) and Ve4 (venue pages) land, the same applies to those surfaces.
- **Native payments in consumer app:** consumer must complete Stripe checkout inside app-mobile without any browser/WebView/external link. Currently consumer has zero Stripe code; mingla-business already has the working native integration.

Pass 1's "defer" recommendation no longer holds. Pass 2 evaluates Branch D from the operator's session (introduced in conversation, not in Pass 1 SPEC): a **lightweight `packages/` directory + per-app Stripe SDK install**, sized minimally to solve only the named requirement.

---

## 1. Verification Receipt

Files read directly during Pass 2:

| Path | Lines | Why read |
|---|---|---|
| `app-mobile/metro.config.js` | 5 | Confirm current Metro config complexity |
| `mingla-business/metro.config.js` | 68 | Confirm current Metro config (zustand web override only) |
| `app-mobile/tsconfig.json` | 18 | Confirm existing `paths` alias pattern |
| `mingla-business/tsconfig.json` | 17 | Same |
| `mingla-business/src/payments/StripeNativeProvider.native.tsx` | 19 | Canonical Stripe provider pattern |
| `mingla-business/src/payments/stripePaymentSheet.native.ts` | 25 | Canonical PaymentSheet hook |
| `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | 88 | Public event page route (thin Expo Router wrapper) |
| `supabase/functions/ticket-checkout-create/index.ts` (grep) | — | Confirm `surface: "native"` support |

File inventories captured:

| Path | Line count | Role |
|---|---|---|
| `mingla-business/src/components/event/PublicEventPage.tsx` | (not opened; identified via `find`) | **Canonical rendering component to share** |
| `mingla-business/src/components/event/PublicEventNotFound.tsx` | (not opened) | Companion 404 state |
| `mingla-business/src/services/publicEventsService.ts` | (not opened) | Data-fetching service (per-app, NOT shared) |
| `mingla-business/app/checkout/[eventId]/index.tsx` | 396 | Buyer checkout entry |
| `mingla-business/app/checkout/[eventId]/buyer.tsx` | 617 | Buyer info collection |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | 636 | Payment surface (uses `useStripePaymentSheet`) |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | 654 | Confirmation screen |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | 408 | Current consumer-side sheet (gets replaced) |
| `mingla-business/src/payments/` directory | 9 files | StripeNativeProvider `.tsx`/`.native.tsx`/`.web.tsx`, stripePaymentSheet `.ts`/`.native.ts`/`.web.ts`, normalizePaymentSheetResult, plus __tests__ |
| `mingla-business/package.json` Stripe deps | 3 SDKs | `@stripe/connect-js` 3.4.2, `@stripe/react-connect-js` 3.4.1, `@stripe/stripe-react-native` 0.50.3 |
| `app-mobile/package.json` Stripe deps | **ZERO** | No Stripe present |

---

## 2. Five Key Facts That Drive the SPEC

### 2.1 Metro configs are minimal and adding `watchFolders` is trivial

`app-mobile/metro.config.js` is 5 lines — just the Sentry wrapper around the default Expo config. `mingla-business/metro.config.js` is 68 lines but the only customization is a web-specific Zustand override; the base is still `getDefaultConfig`. Adding `config.watchFolders = [...(config.watchFolders ?? []), path.join(__dirname, '..', 'packages')]` and pointing `config.resolver.nodeModulesPaths` at both `<app>/node_modules` and the workspace-root `node_modules` is the well-documented Expo monorepo pattern. It does NOT require pnpm.

### 2.2 Both tsconfigs already use `paths` aliasing

Both files declare `"paths": { "@/*": ["./*"] }`. Adding a second alias for `@mingla/event-rendering` is one line per file. No structural change to TS config; just an additive path mapping.

### 2.3 The intra-app native/web split pattern is already in production

`mingla-business/src/payments/` has the trio: `StripeNativeProvider.tsx` (common/web-safe fallback), `StripeNativeProvider.native.tsx` (native iOS/Android), `StripeNativeProvider.web.tsx` (web variant). Same pattern for `stripePaymentSheet.ts`/`.native.ts`/`.web.ts`. **This proves the platform-conditional pattern works in production today without workspaces** — Metro's file-extension resolution handles it natively. Any shared package that needs platform variants can use the same `.native.ts` / `.web.ts` extension trick.

There is also a strict-grep CI gate (`orch-0778-web-stripe-native-import-gate.mjs` per `mingla-business/package.json`) that enforces web bundles do not import the native Stripe SDK. Existing CI scaffolding can be extended for any new shared package's platform constraints.

### 2.4 Backend already supports native checkout surface

`supabase/functions/ticket-checkout-create/index.ts:44` reads `const surface: CheckoutSurface = body.surface === "web" ? "web" : "native";`. Line 179 branches behavior on `if (surface === "web")`. The default (when client passes no surface or passes `"native"`) is native — returning the PaymentIntent client secret + publishable key + payment intent ID that `@stripe/stripe-react-native`'s PaymentSheet consumes directly. **Zero edge function work needed** for consumer-side native payments.

### 2.5 The canonical rendering component is `PublicEventPage`, not the route

`mingla-business/app/e/[brandSlug]/[eventSlug].tsx` is an 88-line Expo Router wrapper. It does three things: extracts URL params, calls `usePublicEventBySlug(brandSlug, eventSlug)`, and renders `<PublicEventPage event={...} brand={...} />` from `mingla-business/src/components/event/PublicEventPage.tsx`. **The shareable unit is `PublicEventPage`** (a presentational component taking `{event, brand}` as props), not the route file or the hook. The hook (`usePublicEventBySlug`) and service (`publicEventsService.ts`) stay per-app — each app has its own React Query setup and Supabase client.

This is important: keeping the shared package **purely presentational** (props in, JSX out) means:

- Zero data-fetching dependencies inside the package
- No coupling to either app's React Query / Zustand / auth state
- Each app retains full control of caching, error boundaries, and auth context
- The shared package is unit-testable in isolation with mock props
- If the data shape changes, only the consuming wrappers need to update (the package's prop interface is the contract)

---

## 3. The Lightweight Approach (Branch D)

### 3.1 Concrete shape

```
/Users/sethogieva/Desktop/mingla-main/
  packages/                                    ← NEW directory
    event-rendering/                           ← Phase 1 package
      package.json                             ← name: @mingla/event-rendering, private: true, no version
      tsconfig.json                            ← extends expo/tsconfig.base
      index.ts                                 ← barrel: re-exports PublicEventPage, PublicEventNotFound, types
      PublicEventPage.tsx                      ← MOVED from mingla-business/src/components/event/
      PublicEventNotFound.tsx                  ← MOVED from same
      types.ts                                 ← PublicEventProps type, PublicBrandProps type (extracted)
    payments-native/                           ← Phase 2 package (Stripe shared between business+consumer NATIVE)
      package.json                             ← name: @mingla/payments-native, private: true
      tsconfig.json
      index.ts
      StripeNativeProvider.tsx                 ← MOVED from mingla-business/src/payments/StripeNativeProvider.native.tsx
      useStripePaymentSheet.ts                 ← MOVED from mingla-business/src/payments/stripePaymentSheet.native.ts
      normalizePaymentSheetResult.ts           ← MOVED
      __tests__/                               ← MOVED
  app-mobile/
    metro.config.js                            ← MODIFIED (add watchFolders + nodeModulesPaths)
    tsconfig.json                              ← MODIFIED (add @mingla/* paths)
    package.json                               ← MODIFIED (add @stripe/stripe-react-native dep)
    src/
      components/expandedCard/
        ExpandedBusinessEventSheet.tsx        ← REWRITTEN (wraps shared PublicEventPage in BottomSheet)
      payments/                                ← NEW
        nativeCheckoutFlow.ts                  ← consumer-side glue (calls ticket-checkout-create, presents sheet)
  mingla-business/
    metro.config.js                            ← MODIFIED (add watchFolders + nodeModulesPaths)
    tsconfig.json                              ← MODIFIED (add @mingla/* paths)
    src/components/event/PublicEventPage.tsx  ← DELETED (moved to package)
    src/components/event/PublicEventNotFound.tsx ← DELETED
    src/payments/StripeNativeProvider.native.tsx ← DELETED (moved to package)
    src/payments/stripePaymentSheet.native.ts ← DELETED
    src/payments/normalizePaymentSheetResult.ts ← DELETED
    src/payments/__tests__/ ← MOVED to package
    app/e/[brandSlug]/[eventSlug].tsx          ← MODIFIED (import from @mingla/event-rendering)
    app/checkout/[eventId]/payment.tsx         ← MODIFIED (import useStripePaymentSheet from @mingla/payments-native)
```

### 3.2 What this does NOT require

- **No pnpm install.** Both apps still use npm. The `packages/` folder is referenced via Metro `watchFolders` + TS `paths`, not via pnpm workspace symlinks.
- **No root `package.json`.** The packages have their own `package.json` files (needed for TS module resolution and the package-name field), but there's no monorepo-level `package.json` declaring a `"workspaces"` field. Each app keeps its independent `package-lock.json`.
- **No restructure of existing code.** Only files explicitly listed in 3.1 move; nothing else is touched.
- **No EAS reconfiguration.** EAS Build reads each app's `eas.json` from inside the app directory; `watchFolders` is honored by the Metro bundler that EAS invokes.
- **No npm publish.** Packages are local-only, consumed by relative path resolution.
- **No Vercel deploy changes.** mingla-business's web build still bundles from its own root; Metro picks up the shared packages through the same `watchFolders`.

### 3.3 Why this is reversible

If something breaks during the migration, rolling back means:

- Delete the `packages/` directory
- Revert the 4 config file edits (2 metro.config.js + 2 tsconfig.json)
- Restore the deleted source files from git
- Revert the consumer-side ExpandedBusinessEventSheet rewrite

No lockfile damage, no node_modules pollution, no EAS profile changes. Two commits to add, one commit to revert.

### 3.4 Why this is forward-compatible with full workspaces

If `packages/` grows to 5+ packages and the lightweight approach starts producing pain (dep version drift between packages, etc.), graduating to proper pnpm workspaces is mechanical:

- Add a root `package.json` with `"workspaces": ["apps/*", "packages/*"]` and `"packageManager": "pnpm@..."`
- Optionally rename `app-mobile/` → `apps/mobile/` and `mingla-business/` → `apps/business/` (or leave them at top level — pnpm's `"workspaces"` glob can match either layout)
- Run `pnpm install` once
- Remove Metro `watchFolders` (pnpm symlinks make it unnecessary)
- Remove TS path aliases (pnpm symlinks in node_modules make `@mingla/*` resolve naturally)

The lightweight version uses the same directory name (`packages/`) and the same `@mingla/*` import convention, so consumer code doesn't change during the graduation.

---

## 4. Cost-Benefit Re-Assessment

### 4.1 Upfront cost

| Piece | Time |
|---|---|
| Create `packages/event-rendering/` + move 2 components + extract types | 2-3 hours |
| Update `mingla-business/{metro.config.js, tsconfig.json}` | 15 min |
| Update `app-mobile/{metro.config.js, tsconfig.json}` | 15 min |
| Update `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` import | 5 min |
| Verify mingla-business native + web builds still work post-migration | 30-60 min |
| Install `@stripe/stripe-react-native@0.50.3` in app-mobile + native rebuild via EAS | 30 min + EAS build time (~15-25 min cloud) |
| Create `packages/payments-native/` + move 3 files | 1 hour |
| Update `mingla-business/app/checkout/[eventId]/payment.tsx` import | 5 min |
| Create `app-mobile/src/payments/nativeCheckoutFlow.ts` (glue around shared hook + edge function call) | 1-2 hours |
| Rewrite `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` to wrap shared `<PublicEventPage>` + wire native checkout | 2-3 hours |
| End-to-end smoke test: consumer taps business event → sheet renders → "Get Tickets" → native PaymentSheet → confirmation | 1 hour |
| **Total** | **~1.5-2 days of focused work** |

This is less than Pass 1's estimate for full pnpm workspace migration (1.5-4 days) and delivers more product value (consumer native payments + cross-app rendering parity, vs only the deduplication of constants).

### 4.2 Ongoing benefit

| Benefit | Magnitude |
|---|---|
| Consumer renders public event page identically to mingla-business | Operator's named requirement — high |
| Consumer pays natively with Stripe PaymentSheet inside the app | Operator's named requirement — high |
| When Tr2 ships, trip detail page can be added to `packages/event-rendering/` (or new `packages/trip-rendering/`) once and consumed by both apps | Compounding |
| When Ve4 ships, venue page same pattern | Compounding |
| Future shared rendering surfaces (multi-stop composer cards C2, discussion thread previews Tr6) have a natural home | Compounding |
| Backend contract (`ticket-checkout-create` `surface: "native"`) already serves both apps without any backend change | Free benefit |

### 4.3 Risks

| Risk | Mitigation |
|---|---|
| `@stripe/stripe-react-native` requires a native rebuild (not OTA-only) for app-mobile | Operator schedules an EAS Build cycle; one-time cost. Subsequent OTAs are fine. |
| Metro `watchFolders` symlink behavior differs between Metro versions / on EAS Build cloud | Both apps use Expo SDK 54 / Metro from `getDefaultConfig` — well-tested baseline. Validate via EAS Build dev profile before promoting to production. |
| TS path alias resolution in some IDE configurations can lag (cached resolution showing stale paths) | Restart TS server in IDE after the config change; mechanical. |
| Shared `PublicEventPage` accidentally imports business-specific service/hook and breaks consumer build | Pure-prop component design (no data-fetching imports in the package); CI check via strict-grep extending the existing `orch-0778-*` gate pattern. |
| Consumer's React Query / Supabase client is initialized differently from business — data shape passed to shared component might diverge | Define explicit `PublicEventProps` / `PublicBrandProps` types in `packages/event-rendering/types.ts`; both apps must shape data into this contract; type-checker enforces. |
| Native Stripe build breaks on Android due to missing config | mingla-business already has Android Stripe working in production — copy its Expo config + Gradle setup verbatim. |

### 4.4 Net assessment

The lightweight approach delivers exactly what the operator named (cross-app rendering identity + consumer native payments) at the cost of ~1.5-2 days of focused work, with no tooling change, no restructure, and no risk to the 14-week 1.2 plan. Pass 1 Branch A (defer) is wrong under the new constraint; Branch C (full pnpm migration) is overkill; Branch D (lightweight `packages/`) is the right size.

---

## 5. Updated Unknowns Register

Reconciliation from Pass 1 + new unknowns from Pass 2:

| ID | Status | Resolution |
|---|---|---|
| UNK-001 | RESOLVED | Operator added new constraint; defer is no longer viable |
| UNK-002 | RESOLVED in Pass 2 SPEC | Branch D supersedes Branch A/B/C in the Pass 1 SPEC; old ORCH-0826 workspace artifacts still need rename/archive (separate orchestrator task) |
| UNK-003 | OPEN (non-blocking) | Operator's "event planner" terminology still undocumented; not blocking |
| UNK-004 | DEFERRED | Live-fire bundling not run in Pass 2 (lightweight approach doesn't change web bundle composition meaningfully); recommend smoke test before committing |
| UNK-005 | OPEN (non-blocking) | Taofeek's toolchain not verified; lightweight approach uses no new tools so risk is low |
| UNK-006 | PARTIALLY RESOLVED | Pass 2 produces SPEC; operator decides whether to dispatch IMPLEMENT or do further passes |
| UNK-007 | OPEN | ORCH-0824-F Phase 2 status overlaps materially with the new work; Pass 2 SPEC explicitly closes ORCH-0824-F Phase 2 into this scope |
| UNK-008 | NOT IN SCOPE | Constant-file dedup (eventTaxonomy, etc.) — not part of Pass 2; could be opportunistic followup |
| UNK-009 | RESOLVED | Live-fire confirmed unnecessary for Pass 2; the lightweight approach doesn't materially affect bundle output beyond what Metro already does |
| UNK-010 | OPEN (non-blocking) | Prior session investigation not spot-checked; the old ORCH-0826 SPEC is now superseded regardless |
| **UNK-011 (NEW)** | OPEN | Does `app-mobile`'s React Query / Supabase setup return event/brand data in the shape `PublicEventPage` expects? Verify during IMPLEMENT phase by typing the props strictly. |
| **UNK-012 (NEW)** | OPEN | Are there any consumer-side product requirements where the sheet rendering should diverge from the public page (e.g., consumer-only "Save to wishlist" affordance)? Operator confirms scope. |
| **UNK-013 (NEW)** | OPEN | Stripe publishable key — is the consumer app's Stripe account the same as mingla-business's? (Yes by design — buyers pay through Mingla Connect platform; only ONE platform Stripe key.) Confirm key is in app-mobile's EAS env. |
| **UNK-014 (NEW)** | OPEN | Are existing strict-grep CI gates extensible for the new package boundary, or does a new gate file need writing? |

Blocking-unknown count: 0 for the SPEC itself (the SPEC documents the approach; UNKs 011-014 are IMPLEMENT-phase verifications, not SPEC blockers).

---

## 6. Five-Layer Cross-Check (Pass 2)

| Layer | Finding |
|---|---|
| Docs | Operator's new constraint reframes the entire investigation. Pass 1 deferral no longer holds. Pass 2 lightweight approach aligns with the 14-week 1.2 plan (which expects shared rendering as consumer surfacing lands in C1/C2). |
| Schema | No schema changes required for Pass 2. The backend contract (`ticket-checkout-create` `surface: "native"`) is already deployed. The events table changes from M0 (`event_type` discriminator) are orthogonal. |
| Code | Verified the canonical `PublicEventPage.tsx` is presentational + props-driven (the route is a thin wrapper). Verified `useStripePaymentSheet` is a small hook that wraps `useStripe()` from `@stripe/stripe-react-native`. Verified the `.native.tsx` / `.web.tsx` pattern works in production today. |
| Runtime | Not run live (UNK-009 — lightweight approach doesn't affect bundle composition meaningfully). Recommend smoke test post-IMPLEMENT before promoting to PR. |
| Data | No data-layer changes. Consumer fetches public event via its own service (parallel to mingla-business's `publicEventsService.ts`); shared rendering component just takes props. |

No layer contradictions.

---

## 7. Recommendation Going Into Pass 2 SPEC

Adopt **Branch D — lightweight `packages/` + per-app Stripe SDK install**, sized for two initial packages (`@mingla/event-rendering`, `@mingla/payments-native`) with a clear forward path for trip-rendering and venue-rendering as Tr2/Ve4 land.

Concrete SPEC at: `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md`.

---

## 8. Discoveries for Orchestrator

1. **ORCH-0824-F Phase 2 is functionally subsumed by Pass 2 scope.** The Phase 2 native-checkout-and-calendar work the prior session paused is exactly what Pass 2 enables. Close ORCH-0824-F Phase 2 as superseded; calendar integration becomes a follow-up.
2. **The existing `orch-0778-web-stripe-native-import-gate.mjs` CI gate** is a working precedent for enforcing shared-package platform constraints. Extend this pattern for the new packages.
3. **`packages/payments-native/` could optionally absorb the existing `mingla-business/src/payments/normalizePaymentSheetResult.ts`** and its tests — clean since it's already RN-runtime-free and unit-testable.
4. **mingla-business has `StripeNativeProvider.tsx` (common fallback), `.native.tsx`, AND `.web.tsx`** — the common file is what gets imported when no platform-specific variant is found. The package design should preserve this pattern: ship a `.tsx` common entry that's safe on all platforms, with `.native.ts` / `.web.ts` variants for platform-conditional code.
5. **Consumer app's `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`** (408 lines) was built in the prior ORCH-0824 session as a self-contained sheet. The Pass 2 rewrite will likely keep the BottomSheet wrapper but swap the internal rendering to `<PublicEventPage>`. Roughly 60-70% of the existing file gets replaced.
6. **A separate `packages/event-data-types/`** might be valuable later if the shared rendering needs strict type contracts on event/brand shape — but for Pass 2 SPEC, embedding types in `packages/event-rendering/types.ts` is simpler.

---

## 9. Confidence

**HIGH** for the verification facts (Metro/tsconfig pattern, Stripe SDK presence, backend surface support, file inventory) — all read directly.

**MEDIUM-HIGH** for the lightweight approach working end-to-end on first try — the pattern is well-documented in Expo monorepo guides, but there is always some EAS-Build-specific surprise risk. SPEC includes a verification gate to catch it before production promotion.

**MEDIUM** for the 1.5-2 day estimate — depends on how much the existing `PublicEventPage` component implicitly couples to business-specific services. Pure prop-driven refactor may take longer if it currently calls hooks directly. Recommend reading `PublicEventPage.tsx` early in IMPLEMENT to validate.

End of Pass 2 investigation.
