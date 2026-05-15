# SPEC — META-ORCH-0827 PLATFORM STRUCTURE — Pass 2 (Branch D, Concrete)

> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md`
> **Supersedes:** Pass 1 SPEC (`SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_1.md`) Branch A recommendation
> **Approach:** Branch D — Lightweight `packages/` directory + per-app Stripe SDK install + Metro/TS path aliasing
> **Date:** 2026-05-13
> **Status:** Ready for IMPLEMENT dispatch upon operator approval

---

## 0. Layman Summary

This SPEC tells the implementor exactly how to make the consumer app render mingla-business's public event page identically, and how to make consumers pay with Stripe natively inside the consumer app. The approach is small (one new top-level folder, two config edits per app, one new dependency in consumer), reversible, and uses patterns mingla-business already runs in production.

Total work: ~1.5-2 days. No pnpm. No restructure. No EAS profile changes. No backend changes.

---

## 1. Scope

### 1.1 In scope

1. **Create `packages/event-rendering/`** at repo root containing the canonical `PublicEventPage` + `PublicEventNotFound` components, moved from `mingla-business/src/components/event/`.
2. **Create `packages/payments-native/`** at repo root containing `StripeNativeProvider`, `useStripePaymentSheet`, `normalizePaymentSheetResult`, moved from `mingla-business/src/payments/`.
3. **Wire `mingla-business` to consume the packages** (Metro `watchFolders` + TS path alias + import-path rewrites).
4. **Wire `app-mobile` to consume the packages** (same + install `@stripe/stripe-react-native@0.50.3` + new `<StripeProvider>` wrap at root).
5. **Rewrite `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`** to render shared `<PublicEventPage>` inside a `BottomSheet` and trigger native Stripe PaymentSheet for the "Get Tickets" CTA.
6. **Replace consumer-side `InAppBrowserModal` usage for tickets** with the new native checkout flow.
7. **Extend existing strict-grep CI gates** to enforce: (a) `app-mobile` only imports `@mingla/payments-native` on native (not web — but consumer has no web target); (b) `packages/event-rendering/` does not import from `mingla-business/src` or `app-mobile/src`.
8. **Smoke test verification** in IMPLEMENT phase before PR merge.

### 1.2 Non-goals

- **No full pnpm workspace migration.** No root `package.json` with `"workspaces"` field. No restructure of `app-mobile/`, `mingla-business/`, or `mingla-admin/` directory paths.
- **No changes to `mingla-admin/`.** Admin is independent Vite + React 19 codebase; it does not consume the new packages.
- **No changes to backend edge functions.** `ticket-checkout-create` already supports `surface: "native"`.
- **No constant-file dedup** (eventTaxonomy, designSystem, BrandIcons, etc.). Pass 2 is scoped to the operator's named requirement; opportunistic dedup is a separate follow-up if desired.
- **No schema migrations.** None needed.
- **No trip-rendering or venue-rendering packages yet.** Those land as additional packages when Tr2 and Ve4 ship. The shape established by `@mingla/event-rendering` is the template.
- **No EAS profile changes.** Standard build profiles continue to work.
- **No deploy of mingla-business web.** This SPEC does not modify the public web checkout flow (Vercel deploy continues unchanged).

### 1.3 Assumptions

- Operator and Taofeek both use the existing tooling (npm, Node 22, Expo SDK 54). No tool installation required.
- The Stripe publishable key in mingla-business's EAS env is the SAME Stripe Connect platform key that should be used by consumer (verify in IMPLEMENT — UNK-013).
- The consumer's existing React Query / Supabase setup can fetch business events and brands in a shape compatible with `PublicEventPage`'s props (verify in IMPLEMENT — UNK-011).
- A native rebuild of app-mobile via EAS Build is acceptable for the Stripe SDK install (cannot be OTA-only — new native module).

---

## 2. Architecture Decisions

### DEC-PASS2-1 — Lightweight packages, not pnpm workspaces

Rationale: the operator's requirement is bounded (rendering parity + native payments). Full workspace tooling adds setup cost and restructure risk without delivering more than what Metro `watchFolders` + TS `paths` already provides.

### DEC-PASS2-2 — Shared components are purely presentational

`PublicEventPage` accepts `{event, brand}` as props. It does NOT import hooks, services, or React Query keys from either app. Data fetching stays per-app; each app shapes data into the shared `PublicEventProps` / `PublicBrandProps` types.

Rationale: prevents transitive imports from polluting the shared package. Each app retains autonomy over caching, auth, and error boundaries.

### DEC-PASS2-3 — Stripe native code is shared; Stripe web code stays per-app

`packages/payments-native/` ships only `.native.ts` / `.tsx` variants (no web targets). The mingla-business web Stripe Connect onboarding (`@stripe/react-connect-js`) stays in `mingla-business/app/connect-onboarding.tsx`.

Rationale: consumer app has no web target. mingla-business's web Stripe surfaces (Connect onboarding, web buyer checkout) are NOT consumer concerns; sharing them would inflate the consumer bundle for no benefit.

### DEC-PASS2-4 — Consumer's native checkout glue stays in app-mobile

`app-mobile/src/payments/nativeCheckoutFlow.ts` is a per-app file that:
- Calls `ticket-checkout-create` with `surface: "native"` via the consumer's Supabase client
- Receives `{clientSecret, publishableKey, paymentIntentId}`
- Calls the shared `useStripePaymentSheet` hook from `@mingla/payments-native`
- Returns a normalized result

Rationale: per-app glue isolates business-specific concerns (which Supabase client, which auth context, which analytics events) from the shared SDK wrapper.

### DEC-PASS2-5 — Path: `packages/` at workspace root

Directly under `/Users/sethogieva/Desktop/mingla-main/packages/`. Lines up with the conventional pnpm-workspace layout if/when the project graduates to full workspaces.

### DEC-PASS2-6 — Naming: `@mingla/<purpose>`

`@mingla/event-rendering`, `@mingla/payments-native`. Forward-compatible with private npm registry or pnpm workspace publishing if ever needed.

### DEC-PASS2-7 — ORCH-0824-F Phase 2 closes into this scope

The prior session's paused ORCH-0824-F Phase 2 (native checkout + sheet/public-page parity + calendar) is functionally subsumed. Calendar integration becomes ORCH-0824-F Phase 3 (a small follow-up after Pass 2 lands).

### DEC-PASS2-8 — Pass 2 establishes project-wide architectural patterns, not event-specific ones

Pass 2 is a **hypothesis test** for the cross-app rendering + native payment architecture using events as the first concrete application. The patterns codified below are **load-bearing for every future shared rendering surface** that mingla-business and app-mobile will both consume — trips (Tr2 onward), discussion boards (Tr6), venue pages (Ve4), experiences (Ve5-Ve7), consumer trip discover (C1), multi-stop composer cards (C2), and future groups / RSVP lists / broadcast surfaces not yet specced. Once Pass 2 CLOSEs with a validated TEST verdict, these patterns propagate into `PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` §2.2 as project-wide invariants and into every relevant milestone brief.

**Pattern 1 — Pure-presentational shared components (REINFORCED):** Any component placed in `packages/<domain>-rendering/` MUST be pure-presentational. No internal data fetching. No internal navigation. No internal auth context. No React Query keys. No Zustand reads. All data comes via props; all actions are injected as callback props. This is the single rule that lets the same component render in two apps with two different data layers, two different React Query setups, two different auth contexts, and two different navigation systems. Already stated as DEC-PASS2-2; restated here as a project-wide rule. Will become **I-1.2-SHARED-RENDERING-PURE-PRESENTATIONAL** in the 1.2 invariant registry after Pass 2 validates.

**Pattern 2 — Role-aware props convention (NEW):** Any shared rendering component that needs to display different affordances to different viewer types accepts a `viewerRole` prop (or domain-specific equivalent like `userRelationship`) typed as a discriminated union. The component branches its UI on this prop; consuming apps inject the role based on their context. Examples of forthcoming use:

- `<PublicEventPage viewerRole="organizer" | "ticket-holder" | "anonymous">` — organizer sees "Edit" + "Manage tickets", ticket-holder sees "Your tickets" + "Add to calendar", anonymous sees "Get tickets"
- `<DiscussionThread viewerRole="planner" | "traveler" | "broadcast-only-viewer">` — planner can pin and post, traveler can post and reply, broadcast-only-viewer can only read
- `<TripPage viewerRole="planner" | "confirmed-traveler" | "prospective-buyer" | "anonymous">` — different action surfaces per stage of the buyer journey
- `<VenuePage viewerRole="owner" | "visitor">` — owner sees edit/claim status, visitor sees public-only fields

This is THE pattern that makes "one component, both apps, same entity, different role-aware affordances" work without forking components per role or per app. Will become **I-1.2-ROLE-AWARE-PROPS-CONVENTION** after Pass 2 validates.

**Pattern 3 — `packages/` namespace and growth shape (NEW):** All shared cross-app code lives at `<repoRoot>/packages/<domain>-<purpose>/`. Domain is `event`, `trip`, `venue`, `discussion`, `group`, `payments`, etc. Purpose is `rendering`, `native`, `web`, `types`, `hooks-shared` (if ever applicable — though pure-presentational rule means rendering packages have no hooks). The `@mingla/*` import namespace mirrors the directory: `@mingla/event-rendering`, `@mingla/trip-rendering`, `@mingla/payments-native`. New packages get added without restructure; existing packages get versioned only when breaking changes ship to multiple consumers (essentially never for an internal monorepo). Will become **I-1.2-PACKAGES-NAMESPACE** after Pass 2 validates.

**Pattern 4 — Each shared component ships with a `types.ts` declaring its prop contract (NEW):** The `types.ts` file in each package is the binding interface between the package and its consumers. Both apps must shape their data to match these types; type-checker enforces. If the underlying schema changes (e.g., M0 adds `events.event_type`), the package's types file updates once; both apps' type-checkers immediately flag any drift. This is the cheap regression prevention that scales with package count.

---

## 3. Implementation Plan — Step-by-Step

> **REVISED 2026-05-13 (Option C selected by operator after IMPLEMENT pre-flight discovery).** The original Step 2 said "git mv `PublicEventPage.tsx` from `mingla-business/src/components/event/` into the package." That plan was based on a forensics miss: the existing `PublicEventPage.tsx` is 1,325 lines with deep mingla-business couplings (useAuth, useBrandList, useRouter, LiveEvent Zustand type, 6 UI primitives, 7 utility imports), not the few-hundred-line presentational component the SPEC assumed. Moving it verbatim would either drag ~30-50 dependency files with it (option B) or require a 2-3 day refactor of an in-production component with high regression risk (option A). The operator selected **Option C: design a fresh pure-presentational `<PublicEventPage>` in the package and convert the existing mingla-business component into a thin adapter that maps data + callbacks to the package's props.** The Stripe half of the SPEC (original Steps 5-9) is unaffected — those files extract cleanly.

Implementor (Codex `implementor-mingla` per canonical pipeline, or Claude `mingla-implementor` per parity if operator redirects) executes in this order. Each step has a verification gate before proceeding.

### Step 1 — Create `packages/event-rendering/` skeleton

Files to create:

```
packages/event-rendering/package.json
packages/event-rendering/tsconfig.json
packages/event-rendering/index.ts
packages/event-rendering/types.ts
```

`packages/event-rendering/package.json`:

```json
{
  "name": "@mingla/event-rendering",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "types": "index.ts",
  "license": "UNLICENSED"
}
```

`packages/event-rendering/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

`packages/event-rendering/index.ts`:

```typescript
export { PublicEventPage } from "./PublicEventPage";
export { PublicEventNotFound } from "./PublicEventNotFound";
export type { PublicEventProps, PublicBrandProps } from "./types";
```

`packages/event-rendering/types.ts` — extract the prop shape from the existing `PublicEventPage` signature. Exact contents derived during IMPLEMENT by reading the current component. At minimum:

```typescript
export type PublicEventProps = {
  id: string;
  title: string;
  description: string | null;
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  startAt: string;       // ISO 8601
  endAt: string | null;
  locationText: string | null;
  locationGeo: { lat: number; lng: number } | null;
  // ... full shape extracted from existing PublicEventPage props
};
export type PublicBrandProps = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  profilePhotoUrl: string | null;
  // ... full shape
};
```

**Verification gate:** `packages/event-rendering/` exists with the 4 files. `ls packages/event-rendering/` returns expected listing.

### Step 2 (REVISED) — Design fresh pure-presentational PublicEventPage in the package

DO NOT `git mv` the existing component. The existing 1,325-line mingla-business component stays in place until Step 3.

Write fresh in the package:

**`packages/event-rendering/designTokens.ts`** — inline-defined design tokens (colors, spacing, text, glass, accent, semantic, radius, typography) duplicated from `mingla-business/src/constants/designSystem.ts` for the subset the rendering component uses. Inline-define; do not import from either app. ~80-120 lines. The tokens are stable and worth duplicating for the package boundary.

**`packages/event-rendering/types.ts`** — full prop contract:

- `PublicEventProps` — event identity (id, name, brandSlug, eventSlug), description, dates (startAt, endAt, isMultiDate, isRecurring, datesList), location (format, venueName, address, hideAddressUntilTicket), cover (coverHue, coverMediaUrl, coverMediaType, coverMediaProvider, coverMediaCredit), status (status enum, endedAt), tickets (array of PublicTicketProps), currency
- `PublicBrandProps` — id, slug, displayName, brandId for the founder-aware check
- `PublicTicketProps` — id, name, description, priceGbp, currency, isFree, isUnlimited, capacity, visibility, passwordProtected, password, saleStartAt, saleEndAt, approvalRequired, waitlistEnabled, availableAt, displayOrder
- `ViewerRole` — `"organizer" | "ticket-holder" | "anonymous"`
- `PublicEventCallbacks` — `onShare()`, `onClose()`, `onBuyTicket(ticketId)`, `onClaimFreeTicket(ticketId)`, `onJoinWaitlist(ticketId)`, `onRequestApproval(ticketId)`, `onUnlockPassword(password)`, `onCancelledRefundInfo()` — caller injects navigation/auth-aware behavior
- Component prop shape: `{event: PublicEventProps; brand: PublicBrandProps | null; viewerRole: ViewerRole; callbacks: PublicEventCallbacks}`

**`packages/event-rendering/PublicEventPage.tsx`** — fresh implementation, pure-presentational. Same visual fidelity as the existing mingla-business component (port the screenshot 3 design carefully) but with these rules:

- No `useAuth`, no `useBrandList`, no `useRouter`, no `usePathname`. All auth/navigation/role data comes via the `viewerRole` prop and the callback props.
- No Zustand store imports. Data flows through `PublicEventProps` / `PublicBrandProps` only.
- No SEO `<Head>` block (each consuming app's route handles its own SEO).
- Use raw React Native primitives (`View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `StyleSheet`) + `@expo/vector-icons` for the location pin icon (peer dep both apps have).
- For the cover image: use `expo-image`'s `<Image>` (peer dep both apps have) directly. Do NOT depend on mingla-business's `EventCoverMedia` primitive (it has video playback logic out of scope for v1 of the package; revisit when video parity is needed).
- Implement the 7 state variants the existing component handles: cancelled, past, password-gate, pre-sale, sold-out, published, approval-required. Same precedence order.
- The founder-aware close chrome: branch on `viewerRole === "organizer"` to show the close icon; otherwise hide. Share icon always shown. Callbacks fire `onClose()` and `onShare()`.
- The buyer action handlers: route based on ticket state to the appropriate callback (`onBuyTicket` for paid, `onClaimFreeTicket` for free, `onJoinWaitlist` for sold-out + waitlist-enabled, `onRequestApproval` for approval-required).

Aim for ~600-900 lines (smaller than the original 1,325 because no auth/navigation/SEO logic).

**`packages/event-rendering/PublicEventNotFound.tsx`** — fresh implementation. Pure-presentational with `{onBrowse}` callback prop. ~60 lines.

**`packages/event-rendering/index.ts`** — barrel re-export of `PublicEventPage`, `PublicEventNotFound`, types.

**Verification gate:** `packages/event-rendering/PublicEventPage.tsx` exists with the new pure-presentational implementation. `npx tsc --noEmit -p packages/event-rendering/` succeeds. The existing `mingla-business/src/components/event/PublicEventPage.tsx` is still in place and still works (not yet touched).

### Step 3 — Update `mingla-business` to consume the package

`mingla-business/metro.config.js` — add at the bottom of the file, before `module.exports`:

```javascript
const workspaceRoot = path.resolve(__dirname, "..");
config.watchFolders = [...(config.watchFolders ?? []), path.join(workspaceRoot, "packages")];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(__dirname, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;
```

`mingla-business/tsconfig.json` — extend `paths`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./*"],
      "@mingla/event-rendering": ["../packages/event-rendering"],
      "@mingla/event-rendering/*": ["../packages/event-rendering/*"]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts",
    "../packages/event-rendering/**/*.ts",
    "../packages/event-rendering/**/*.tsx"
  ]
}
```

**Convert the existing `mingla-business/src/components/event/PublicEventPage.tsx` into a thin adapter.** This is the Option C key step — the existing 1,325-line file becomes ~80-120 lines that:

1. Imports `PublicEventPage` (the new presentational component) from `@mingla/event-rendering`
2. Reads auth + brand list + router from existing mingla-business hooks
3. Computes `viewerRole`: `"organizer"` if `userBrands.some(b => b.id === event.brandId)`, else `"anonymous"` (Cycle 1.2 may add `"ticket-holder"` once order data is in scope; for Pass 2 only organizer + anonymous are computed)
4. Maps the existing `LiveEvent` + `Brand` types to the package's `PublicEventProps` + `PublicBrandProps` shape (probably a `mapLiveEventToPublicEvent(event)` helper alongside)
5. Provides callbacks: `onClose` → `router.replace("/(tabs)/events")`, `onShare` → opens existing ShareModal, `onBuyTicket(ticketId)` → `router.push(checkoutPublicPath(event.id))` (Cycle 8 wiring as today), `onClaimFreeTicket(ticketId)` → same, `onJoinWaitlist` → existing toast "Waitlist invites land B5", `onRequestApproval` → existing toast "Approval flow lands Cycle 10 + B4"
6. Keeps the existing ShareModal + Toast components mounted at the adapter level (they're mingla-business UI primitives; the package doesn't render them)
7. The SEO `<Head>` block stays in the adapter (web-only, mingla-business-specific URL constants)
8. **Old code deleted:** the 1,200+ lines of variant-rendering logic that's now in the package

Also convert `mingla-business/src/components/event/PublicEventNotFound.tsx` to a thin adapter (~20 lines): import from package, provide `onBrowse: () => router.replace("/")`.

`mingla-business/app/e/[brandSlug]/[eventSlug].tsx` — no import path change needed. The route still imports `PublicEventPage` from `../../../src/components/event/PublicEventPage` (the adapter); the adapter imports from the package.

The data-fetching call (`usePublicEventBySlug`) stays in `mingla-business/src/hooks/usePublicEvents.ts` unchanged.

**Verification gate:** `cd mingla-business && npx tsc --noEmit` succeeds. `cd mingla-business && npx expo start` launches without errors. Open the public event page in iOS Simulator; it renders correctly with all 7 state variants accessible (verify cancelled/past/pre-sale/sold-out via test data or temporary state injection). Open in web browser via `npx expo start --web`; renders correctly there too. **No visual regression vs pre-migration baseline.**

### Step 4 — Repeat configuration for `app-mobile`

`app-mobile/metro.config.js`:

```javascript
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("node:path");

const config = getSentryExpoConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, "..");
config.watchFolders = [...(config.watchFolders ?? []), path.join(workspaceRoot, "packages")];
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.join(__dirname, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
```

`app-mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "paths": {
      "@/*": ["./*"],
      "@mingla/event-rendering": ["../packages/event-rendering"],
      "@mingla/event-rendering/*": ["../packages/event-rendering/*"]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "../packages/event-rendering/**/*.ts",
    "../packages/event-rendering/**/*.tsx"
  ]
}
```

**Verification gate:** `cd app-mobile && npx tsc --noEmit` succeeds.

### Step 5 — Create `packages/payments-native/` skeleton

Same shape as Step 1. `package.json` name: `@mingla/payments-native`.

`packages/payments-native/index.ts`:

```typescript
export { StripeNativeProvider } from "./StripeNativeProvider";
export { useStripePaymentSheet } from "./useStripePaymentSheet";
export { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";
export type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./types";
```

**Verification gate:** package skeleton exists.

### Step 6 — Move Stripe native files

```
git mv mingla-business/src/payments/StripeNativeProvider.native.tsx packages/payments-native/StripeNativeProvider.tsx
git mv mingla-business/src/payments/stripePaymentSheet.native.ts packages/payments-native/useStripePaymentSheet.ts
git mv mingla-business/src/payments/normalizePaymentSheetResult.ts packages/payments-native/normalizePaymentSheetResult.ts
git mv mingla-business/src/payments/__tests__ packages/payments-native/__tests__
```

Important rename: the file `StripeNativeProvider.native.tsx` becomes `StripeNativeProvider.tsx` in the package because the package itself is native-only (it imports `@stripe/stripe-react-native` which only exists on native). The `.native` extension was used in mingla-business to distinguish from the `.web.tsx` variant; in the package there's no web variant so no extension needed. However the package's `package.json` should declare it's not for web:

```json
{
  "name": "@mingla/payments-native",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "types": "index.ts",
  "react-native": "index.ts",
  "browser": false
}
```

Edit `packages/payments-native/StripeNativeProvider.tsx` and `useStripePaymentSheet.ts` to fix the relative type-import paths (`./stripePaymentSheet` → `./types` or wherever the types now live).

Add `packages/payments-native/types.ts` extracting the shared types.

### Step 7 — Update `mingla-business` to consume `@mingla/payments-native`

Edit `mingla-business/tsconfig.json` to add the path alias (same pattern as event-rendering).

Edit any mingla-business file that imports the moved Stripe code:

- `mingla-business/app/checkout/[eventId]/payment.tsx` — `useStripePaymentSheet` import → from `@mingla/payments-native`
- Wherever `<StripeNativeProvider>` is currently mounted in mingla-business root — import path → from `@mingla/payments-native`

Keep mingla-business's `StripeNativeProvider.tsx` (common fallback) and `StripeNativeProvider.web.tsx` (web variant) in place — the package only owns the native variant. mingla-business's resolution: on web, picks up local `.web.tsx`; on native, picks up `@mingla/payments-native`. Verify Metro resolves correctly.

**Verification gate:** `cd mingla-business && npx tsc --noEmit` succeeds. Native build still works (open Simulator, navigate to a test event checkout, payment screen renders).

### Step 8 — Install Stripe SDK in `app-mobile`

```bash
cd app-mobile && npm install @stripe/stripe-react-native@0.50.3
```

Match the exact version mingla-business uses (0.50.3) to avoid native module version mismatch issues.

Update `app-mobile/tsconfig.json` to add the `@mingla/payments-native` path alias.

Add `<StripeNativeProvider>` near the root of app-mobile's component tree (probably in `app-mobile/index.ts` or wherever React Query / Auth providers are wrapped today). Reference `mingla-business/app/_layout.tsx` for the current placement pattern.

**Verification gate:** `cd app-mobile && npx tsc --noEmit` succeeds. App still launches in Simulator (no native module errors). The Stripe SDK requires a native rebuild — operator runs `cd app-mobile && eas build --profile development --platform ios` (and android if needed).

### Step 9 — Create `app-mobile/src/payments/nativeCheckoutFlow.ts`

The glue file that bridges the shared hook + consumer's data layer:

```typescript
// app-mobile/src/payments/nativeCheckoutFlow.ts
import { useStripePaymentSheet } from "@mingla/payments-native";
import { supabase } from "../services/supabase";
import { handleEdgeFunctionError } from "../utils/edgeFunctionError";

type CreateCheckoutInput = {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
};

type CheckoutResult =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };

export const useNativeCheckoutFlow = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripePaymentSheet();

  return async (input: CreateCheckoutInput): Promise<CheckoutResult> => {
    // 1. Call edge function for client secret
    const { data, error } = await supabase.functions.invoke(
      "ticket-checkout-create",
      {
        body: {
          surface: "native",
          event_id: input.eventId,
          ticket_type_id: input.ticketTypeId,
          quantity: input.quantity,
        },
      }
    );
    if (error) return { outcome: "failed", message: await handleEdgeFunctionError(error) };
    if (!data) return { outcome: "failed", message: "Empty checkout response" };

    const { clientSecret, publishableKey, paymentIntentId, orderId } = data;

    // 2. Init payment sheet
    const initResult = await initPaymentSheet({
      merchantDisplayName: "Mingla",
      paymentIntentClientSecret: clientSecret,
      // ... full PaymentSheetInitInput per Stripe RN docs
    });
    if (initResult.status === "Failed") return { outcome: "failed", message: initResult.message ?? "Init failed" };

    // 3. Present payment sheet
    const presentResult = await presentPaymentSheet();
    if (presentResult.status === "Canceled") return { outcome: "canceled" };
    if (presentResult.status === "Failed") return { outcome: "failed", message: presentResult.message ?? "Payment failed" };

    return { outcome: "succeeded", orderId };
  };
};
```

Exact body schema for `ticket-checkout-create` derived during IMPLEMENT by reading the edge function and mingla-business's `ticketCheckoutService.ts` for the existing native-surface call shape.

**Verification gate:** TypeScript compiles. Hook signature matches mingla-business's equivalent.

### Step 10 — Rewrite `ExpandedBusinessEventSheet.tsx`

Current file: 408 lines. Strategy:

- Keep the `BottomSheet` wrapper + open/close state management
- Replace the rendering body with `<PublicEventPage event={...} brand={...} />` from `@mingla/event-rendering`
- Replace the existing "Get Tickets" CTA's `InAppBrowserModal` open with a call to `useNativeCheckoutFlow()`
- On checkout success: show toast, close sheet, optionally navigate to a "My Tickets" surface (UNK-012 — operator confirms if My Tickets exists or is a future surface)
- On checkout canceled: keep sheet open, no toast
- On checkout failed: show error toast, keep sheet open

Approximately 60-70% of the existing file gets replaced. The remaining 30-40% is the sheet animation, gesture handling, and result-toast logic.

**Verification gate:** Smoke test (Step 12) passes.

### Step 11 — Add CI gates

Extend `.github/scripts/strict-grep/` with:

1. `meta-orch-0827-package-isolation.mjs` — fails if any file in `packages/event-rendering/` or `packages/payments-native/` imports from `mingla-business/src/`, `app-mobile/src/`, or `mingla-admin/src/`. Prevents back-references.
2. `meta-orch-0827-no-web-stripe-in-consumer.mjs` — fails if `app-mobile/` imports anything from `@stripe/stripe-js`, `@stripe/react-stripe-js`, or `@stripe/react-connect-js`. Consumer is native-only.

Add both as jobs in `.github/workflows/strict-grep-mingla-business.yml` (extending pattern from `orch-0778-web-stripe-native-import-gate.mjs`).

**Verification gate:** CI green on a draft PR.

### Step 12 — End-to-end smoke test (in IMPLEMENT)

Run on iOS Simulator (Android emulator also if available):

1. **Business public event page (mingla-business native):** open mingla-business, sign in, navigate to a published event, tap "View public page". The page renders correctly — title, cover, description, ticket types, all visual elements identical to pre-migration baseline.

2. **Business public event page (mingla-business web):** `cd mingla-business && npx expo start --web` (or equivalent), open a public event URL in browser. Renders correctly — verifies the package works on web too.

3. **Consumer event sheet (app-mobile native):** open app-mobile, navigate to Discover, ensure a business-event card is visible (requires test data — same event as Step 1), tap it. Sheet opens with the EXACT same rendering as the public event page (title, cover, description, ticket types) — verifies cross-app rendering parity.

4. **Consumer native checkout:** tap "Get Tickets" inside the consumer sheet. Native Stripe PaymentSheet opens (NOT a browser, NOT an InAppBrowserModal). Select a saved card or enter a new test card (4242 4242 4242 4242). Tap Pay. PaymentSheet dismisses. Toast confirms success. Verify in mingla-business admin (or via SQL probe) that an order row exists with the expected `account_id`, `event_id`, status.

5. **Consumer cancel flow:** tap "Get Tickets" again, swipe down to dismiss PaymentSheet. Sheet stays open, no error toast — verify graceful cancel handling.

6. **Consumer failure flow:** use Stripe test card 4000 0000 0000 0002 (always declines). Verify error toast appears with a useful message, sheet stays open.

7. **Regression check on mingla-business buyer checkout:** open mingla-business's web public event page, tap "Get tickets", complete a web checkout. Verify the web flow still works post-migration (the web-side Stripe code wasn't touched, but the import paths changed for the native code).

8. **TypeScript check both apps:** `cd app-mobile && npx tsc --noEmit && cd ../mingla-business && npx tsc --noEmit`. Both pass.

9. **Native build verification:** `cd app-mobile && eas build --profile development --platform ios` succeeds with the new Stripe SDK installed.

**All 9 checks must pass before declaring IMPLEMENT complete.**

---

## 4. Success Criteria

| # | Criterion | Verifier |
|---|-----------|----------|
| 1 | `packages/event-rendering/` exists with `PublicEventPage`, `PublicEventNotFound`, `index.ts`, `types.ts`, `package.json`, `tsconfig.json`, `designTokens.ts` | `ls packages/event-rendering/` |
| 2 | `packages/payments-native/` exists with `StripeNativeProvider`, `useStripePaymentSheet`, `normalizePaymentSheetResult`, `types.ts`, `index.ts`, `package.json`, `tsconfig.json`, `__tests__/` | `ls packages/payments-native/` |
| 3 | Both apps' `metro.config.js` declare `watchFolders` including `<workspaceRoot>/packages` and `nodeModulesPaths` including both app + workspace `node_modules` | Diff against pre-migration baseline |
| 4 | Both apps' `tsconfig.json` declare `@mingla/event-rendering` and `@mingla/payments-native` paths | Diff |
| 5 | `app-mobile/package.json` has `@stripe/stripe-react-native: 0.50.3` | `npm ls @stripe/stripe-react-native` from app-mobile |
| 6 | mingla-business public event page (`/e/[brandSlug]/[eventSlug]`) renders identically pre vs post migration on native + web | Visual diff in Simulator + browser |
| 7 | Consumer business-event sheet renders the shared `<PublicEventPage>` (visually identical to mingla-business's render) | Visual diff |
| 8 | Consumer "Get Tickets" CTA opens native Stripe PaymentSheet (NOT a browser, NOT InAppBrowserModal) | Live test |
| 9 | Successful consumer payment creates a valid order row in the database | SQL probe via Supabase Management API |
| 10 | Canceled consumer payment leaves sheet open with no error toast | Live test |
| 11 | Failed consumer payment (declined card) shows error toast and keeps sheet open | Live test |
| 12 | mingla-business web buyer checkout still works post-migration | Live test in browser |
| 13 | TypeScript compiles in both apps with no errors | `npx tsc --noEmit` in each |
| 14 | EAS Build dev profile succeeds for app-mobile with the new native Stripe module | EAS Build cloud |
| 15 | CI strict-grep gates pass: `meta-orch-0827-package-isolation` and `meta-orch-0827-no-web-stripe-in-consumer` | GitHub Actions green |
| 16 | The package's components have ZERO imports from `mingla-business/src/` or `app-mobile/src/` | strict-grep gate #15 |
| 17 | Existing `orch-0778-web-stripe-native-import-gate.mjs` CI gate still passes (mingla-business web bundle does not pull native Stripe) | GitHub Actions green |
| 18 | No regression in mingla-business native event creation, edit, publish, scanner flows (constitutional check) | Smoke test |

---

## 5. Invariants

### New invariants this SPEC establishes

- **I-MOR-0827-PACKAGE-ISOLATION:** code inside `packages/*/` MUST NOT import from `mingla-business/src/`, `app-mobile/src/`, or `mingla-admin/src/`. Enforced by `meta-orch-0827-package-isolation.mjs` CI gate.
- **I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY:** `app-mobile/` MUST NOT import any web-side Stripe SDK (`@stripe/stripe-js`, `@stripe/react-stripe-js`, `@stripe/react-connect-js`). Consumer is native-only. Enforced by `meta-orch-0827-no-web-stripe-in-consumer.mjs` CI gate.
- **I-MOR-0827-SHARED-PRESENTATIONAL-ONLY:** shared rendering components in `packages/event-rendering/` (and future `packages/trip-rendering/`, `packages/venue-rendering/`) MUST be purely presentational — no hooks that fetch data, no React Query keys, no Zustand stores. Props in, JSX out.

### Invariants this SPEC must preserve (no violation allowed)

- All 14 constitutional rules
- I-1.2-UNIFIED-EVENT-TYPE (single events table — orthogonal but verify no migration breaks it)
- I-1.2-BRAND-AS-CONTAINER
- The existing `orch-0778-web-stripe-native-import-gate` rule

---

## 6. Test Plan

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | mingla-business native build with shared packages | `cd mingla-business && npx expo start` then open Simulator | App launches, public event page renders unchanged | Build + UI |
| T-02 | mingla-business web build with shared packages | `cd mingla-business && npx expo start --web` then open browser | App launches, public event page renders unchanged | Build + UI |
| T-03 | mingla-business native checkout still works | Tap "Get tickets" on a native test event | PaymentSheet opens, test card succeeds, order row appears | Full stack |
| T-04 | mingla-business web checkout still works | Same on web | Web checkout completes | Full stack |
| T-05 | app-mobile launches with new Stripe SDK | `cd app-mobile && npx expo start` then open Simulator | App launches, no native module errors | Build |
| T-06 | Consumer business-event sheet renders shared PublicEventPage | Open business event in app-mobile Discover | Sheet renders identical to mingla-business public page | UI |
| T-07 | Consumer native checkout succeeds | Tap "Get Tickets", use test card 4242 4242 4242 4242 | PaymentSheet opens, completes, order row appears | Full stack |
| T-08 | Consumer cancel flow | Tap "Get Tickets", swipe to dismiss | Sheet stays open, no error toast | UI + payments |
| T-09 | Consumer decline flow | Tap "Get Tickets", use card 4000 0000 0000 0002 | Error toast appears, sheet stays open | UI + payments |
| T-10 | Strict-grep CI gates pass | Open draft PR | Both new gates + orch-0778 gate green | CI |
| T-11 | TypeScript strict in both apps | `npx tsc --noEmit` in each | Zero errors | TS |
| T-12 | EAS Build dev profile succeeds | `cd app-mobile && eas build --profile development --platform ios` | Build cloud succeeds | EAS |

---

## 7. Regression Surface

Most likely areas for unintended breakage:

1. **mingla-business public event page on web.** The shared package is consumed by web bundle; if any RN-only API leaks in, web breaks. Mitigate with T-02.
2. **mingla-business native checkout.** The Stripe import paths change; if the Provider isn't mounted correctly, payments break. Mitigate with T-03.
3. **app-mobile launch with new native module.** Stripe RN SDK on Android sometimes needs additional Expo config. Mitigate with T-05 + EAS build verification.
4. **TS path alias resolution in IDE.** Operator's VS Code may need a TS server restart to pick up new paths. Document this in IMPLEMENT report.
5. **Metro `nodeModulesPaths` ordering.** Wrong order can cause Metro to resolve a wrong React copy. Mitigate by putting app's own `node_modules` first.

---

## 8. Implementation Order

Strict ordering — do NOT parallelize:

1. Step 1 (skeleton)
2. Step 2 (move event-rendering)
3. Step 3 (mingla-business config + import rewrite for event-rendering)
4. T-01 + T-02 verification gate — mingla-business native AND web still work with shared event-rendering
5. Step 4 (app-mobile config for event-rendering)
6. Step 5 (payments-native skeleton)
7. Step 6 (move payments-native)
8. Step 7 (mingla-business config + import rewrite for payments-native)
9. T-03 + T-04 verification gate — mingla-business checkout still works
10. Step 8 (install Stripe in app-mobile + EAS dev build)
11. Step 9 (nativeCheckoutFlow glue)
12. Step 10 (rewrite ExpandedBusinessEventSheet)
13. Step 11 (CI gates)
14. Step 12 (full smoke test T-01 through T-12)
15. PR open + green CI + operator review + merge

---

## 9. Regression Prevention

The two new CI gates (I-MOR-0827-PACKAGE-ISOLATION and I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY) prevent the most likely regressions structurally:

- **If someone adds a `useAuth()` import to `packages/event-rendering/PublicEventPage.tsx`** (which would couple it to a per-app auth hook), the package-isolation gate fails at PR time.
- **If someone tries to add a web Stripe SDK to `app-mobile` later** (perhaps thinking it'd be needed for a web target), the consumer-native-Stripe-only gate fails.

Protective comments added to the package's `index.ts`:

```typescript
// @mingla/event-rendering — SHARED PURE-PRESENTATIONAL RENDERING
// Consumed by mingla-business AND app-mobile.
// MUST NOT import from any app's src/ — see I-MOR-0827-PACKAGE-ISOLATION.
// All data is passed via props. All design tokens are local to this package.
```

---

## 10. Discoveries Surfaced By This SPEC

1. **ORCH-0824-F Phase 2 superseded.** Operator should close it formally (the IMPLEMENT phase of Pass 2 delivers what Phase 2 was scoped to deliver). Calendar integration remains as ORCH-0824-F Phase 3 follow-up.
2. **The 1.2 plan's C1 (Consumer Trips tab) and C2 (Multi-stop composer) will benefit from this foundation.** When Tr2 ships trip pages, add `packages/trip-rendering/`. When Ve4 ships venue pages, add `packages/venue-rendering/`. The pattern is repeatable.
3. **Stripe Connect onboarding (mingla-business web only) remains untouched** — operator's consumer requirement doesn't include Connect onboarding, which is exclusively for brand owners.

---

## 10.5 Forward-Looking Section — Expected Package Growth

Pass 2 ships two packages. Based on the 14-week 1.2 plan and the operator's communicated scope (groups, discussions, multi-party surfaces all needing cross-app rendering), the realistic 6-month projection for `packages/` looks like:

| Package | Triggering milestone | Domain | Used by |
|---|---|---|---|
| `@mingla/event-rendering` | **Pass 2 (this SPEC)** | Public event page rendering | mingla-business native + web, app-mobile native |
| `@mingla/payments-native` | **Pass 2 (this SPEC)** | Stripe RN PaymentSheet glue | mingla-business native, app-mobile native |
| `@mingla/trip-rendering` | Tr2 (~week 3-4) | Trip detail page rendering | mingla-business native + web, app-mobile native (via consumer Trips tab from C1) |
| `@mingla/venue-rendering` | Ve4 (~week 5-6) | Public venue page rendering | mingla-business native + web, app-mobile native (via consumer Discover from C2) |
| `@mingla/discussion-rendering` | Tr6 (~week 9-10) | Multi-party discussion thread | mingla-business native + web, app-mobile native |
| `@mingla/entity-types` (optional, may emerge organically) | Whenever first cross-package type sharing is needed | Shared TS types for Event, Trip, Venue, Brand, Order, Ticket | All packages + both apps |
| `@mingla/group-rendering` (speculative — not yet specced) | Future "groups are coming" work | Multi-party group entity rendering | Both apps |
| `@mingla/experience-rendering` (potential split from event-rendering) | If Ve5-Ve7 experiences need rendering that diverges from events | Single-intent experience cards | Both apps |

The lightweight `packages/` + Metro `watchFolders` + TS paths approach scales linearly to 8-10 packages without requiring graduation to full pnpm workspaces. If/when graduation becomes necessary (e.g., shared deps drift across packages, build-time concerns), the path is mechanical per Pass 2 investigation §3.4.

**What this section is for:** the implementor of Tr2 in ~3 weeks, the implementor of Tr6 in ~10 weeks, and the implementor of any future cross-app surface should read this SPEC and recognize "I'm following the pattern META-ORCH-0827 established," not "I'm inventing a new approach." This SPEC is the canonical reference for the next several months of cross-app architecture decisions.

**Pass 2 CLOSE produces a "propagation pass"** that updates `PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` §2.2 with the validated invariants from DEC-PASS2-8, and adds a paragraph to each relevant milestone brief (Tr2, Tr6, Ve4, C1, C2) directing the implementor to consume the appropriate package per this pattern. That propagation pass is a separate small META-ORCH dispatched immediately after Pass 2 CLOSE; it is doc-only and contains no code changes.

---

## 11. Next Handoff (Pending Operator SPEC Approval)

> NEXT HANDOFF — paste into Codex `implementor-mingla` (canonical IMPLEMENT owner per DEC-133):
>
> Implement Pass 2 of META-ORCH-0827 per `Mingla_Artifacts/specs/SPEC_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md` following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0827_PLATFORM_STRUCTURE_PASS_2.md`. Execute the 12 implementation steps in strict order with all verification gates. Specifically: create `packages/event-rendering/` and `packages/payments-native/` at repo root, move `PublicEventPage.tsx` + `PublicEventNotFound.tsx` from mingla-business into the event-rendering package, move `StripeNativeProvider.native.tsx` + `stripePaymentSheet.native.ts` + `normalizePaymentSheetResult.ts` + `__tests__` from mingla-business into the payments-native package, update both apps' `metro.config.js` to add `packages/` to `watchFolders`, update both apps' `tsconfig.json` to add `@mingla/*` path aliases, install `@stripe/stripe-react-native@0.50.3` in app-mobile, rewrite `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` to render shared PublicEventPage + invoke native Stripe PaymentSheet via a new `app-mobile/src/payments/nativeCheckoutFlow.ts` glue file, and add two new CI gates (`meta-orch-0827-package-isolation.mjs` and `meta-orch-0827-no-web-stripe-in-consumer.mjs`). Do NOT introduce pnpm or restructure existing directories. Do NOT change backend edge functions. Do NOT touch mingla-admin. Stay strictly within the SPEC scope; do not opportunistically dedupe other files (eventTaxonomy, designSystem, etc.). After all 12 steps complete and all 12 tests pass, write `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0827_PLATFORM_STRUCTURE_REPORT.md` with old→new receipts for every changed file and the smoke test results. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. After IMPLEMENT, the next dispatch is Claude `mingla-tester` (canonical TEST owner) for QA on iOS Simulator + Android Emulator + mingla-business web. After tester PASS, Codex `orchestrator-mingla` for CLOSE which includes the ORCH-0826 ID collision cleanup (archive the prior session's `SPEC_ORCH-0826_WORKSPACE_MIGRATION.md` and `INVESTIGATION_ORCH-0826_WORKSPACE_MIGRATION.md`).

End of Pass 2 SPEC.
