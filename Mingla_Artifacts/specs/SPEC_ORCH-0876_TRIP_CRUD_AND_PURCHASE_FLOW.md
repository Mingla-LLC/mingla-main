# SPEC — ORCH-0876 [Trip CRUD + Purchase Flow Completion]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` (3 root causes proven, 10 findings, probable-confidence overall — S-3 live-fire promotable on web)
**Orchestrator dispatch (lock-source):** `Mingla_Artifacts/prompts/SPEC_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` (10 operator decisions pre-locked)
**Author confidence:** H — investigation grounded, every contract maps to a six-field finding, no new questions surfaced during SPEC.

---

## 0. Layman summary

- **Trip planners get a real Save semantic on the edit wizard.** Tap Back, tap X-close in edit mode, blur a field — all paths commit changes to the DB and surface a visible "Saved" toast. Lose-changes silently is eliminated. Publish stays Publish; Save is distinct.
- **Trip planners can set or replace the trip cover image** during create AND edit. New cover field at the top of Step 1 Basics. Reuses the entire event-cover picker stack (`EventCoverMedia` + `uploadEventCoverMedia` + ImagePicker + Giphy/Pexels search) — backend already wired for 7 cover_media_* fields in the publish RPC.
- **Buyers tapping "Reserve my spot" land on a working trip-purchase chain at `/checkout-trip/{tripEventId}`** — not on "Event not found" anymore. New 5-file route tree under `app/checkout-trip/[tripEventId]/{_layout, index, buyer, payment, confirm}.tsx`. Thin trip-aware shells around the shared CartContext + CheckoutHeader + QuantityRow + payment primitives. The event-side `/checkout/{eventId}/*` chain stays unchanged and continues to reject trip IDs as designed (audit-test-enforced).
- **Zero database migrations. Zero edge function deployments. Pure frontend (`mingla-business/`).** The backend RPCs (`business_publish_trip_draft`, `biz_ticket_checkout_create_session`) are already trip-aware end-to-end.
- **EAS-OTA eligible** post-merge (no native module changes).

---

## 1. Phase 1 — Investigation ingest

The investigation is complete and orchestrator-APPROVED. Specific findings consumed by this spec:

- **F-1, F-2, F-3 (S-3 root causes):** TripCheckoutFlow routes to `/checkout/${trip.id}` but `getPublicEventById` is hard-rejecting trips by design (codified by `eventType.filter.audit.test.ts:102-106`). Fix must be additive — new trip-specific chain, audit untouched. Locked direction = Q1=8.3.A.
- **F-4, F-5 (S-1 root causes):** Autosave fires only on `handleNext` step-transition; `handleStepBack` (line 485-489) and `handleClose` in edit mode (line 491-528) do NOT call autosave. No explicit Save CTA. Locked direction = Q4=8.1.C HYBRID.
- **F-6 (S-1 hidden flaw — DEFERRED):** Mutations are step-scoped; cross-step atomicity is not enforced. Out of scope per investigation §6; register as follow-up ORCH if a partial-save bug surfaces in production.
- **F-7 (S-2 root cause):** Trip wizard has zero cover surface. F-8 confirms backend is fully wired. Locked direction = Q5=8.2.B (embed in Step 1).
- **F-9 (cross-cutting):** ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] coordination — Tr4 implementor PAUSED until this SPEC closes. Locked = Q9.
- **F-10 (observation):** 0/7 trips currently have a cover; data state consistent with no-UI gap.

Investigation confidence ceiling was "probable" because S-3 sim/web live-fire was blocked in the orchestrator-driven session. The operator may promote to "proven" in <5 min by visiting any trip's public page on web — but this SPEC stands on source + schema + data evidence regardless of promotion status.

---

## 2. Scope and non-goals

### Scope (what THIS spec covers)

- **S-1 fix (Save semantic):** modify `TripCreatorWizard.handleStepBack` and `TripCreatorWizard.handleClose` to await `autosaveCurrentStep()` in edit mode; wire a "Saved" toast to autosave success; preserve the existing autosave-error retry shape; preserve ORCH-0874 [Trip Visual Parity] chrome (Close X + Stepper + create-mode-dirty discard dialog).
- **S-2 fix (Cover edit):** add a Cover field at the top of Step 1 Basics; reuse `EventCoverMedia` + `uploadEventCoverMedia`; extend `TripCreatorWizard.handleConfirmPublish` draftPayload with 7 cover_media_* fields; add `updateTripCover` service + `useUpdateTripCover` hook for cover-only commits on already-published trips; preserve 5-step Stepper count.
- **S-3 fix (Reserve route):** redirect `TripCheckoutFlow.handleReserve` to `/checkout-trip/${trip.id}`; create the 5-file new route tree under `mingla-business/app/checkout-trip/[tripEventId]/`; add new service `getPublicTripById` + new hook `usePublicTripById`; thin trip-aware screens reusing shared CartContext / CheckoutHeader / QuantityRow / payment primitives; existing /checkout/[eventId]/* untouched.
- **Audit-test extension:** add a clause to `eventType.filter.audit.test.ts` asserting `getPublicTripById` pins `event_type='trip'` (mirror of the existing 4-filter trip-rejection clauses for events).
- **Regression tests:** 3 implementor happy-path test files + 1 tester adversarial anti-regression test (Q10-locked paths).

### Non-goals (what this spec EXPLICITLY does NOT do)

- **No widening of `getPublicEventById` / `getPublicEventBySlug` / `getPublicBrandBySlug`.** Existing audit-test trip-rejection invariant preserved unmodified. Event services remain event-only.
- **No new database migration.** All required schema (events.cover_media_*, event_type, sidecar tables, RPC support) is already live.
- **No edge function deployment.** The `biz_ticket_checkout_create_session` RPC and `business_publish_trip_draft` RPC are already trip-aware (per Tr3 ORCH-0869 [Tr3 Installment Payments] + Tr2 ORCH-0859 [Tr2 Minimum Viable Trip]).
- **No business logic for ORCH-0875 [Tr4] booking-deadline OR refund-tier gates.** Tr4 ships separately AFTER this CLOSE.
- **No field-blur debounced autosave (SC-1.6 from dispatch is DEFERRED).** Polish; not in v1 of this fix. Operator can register follow-up ORCH if needed.
- **No unification of TripCreatorWizard with EventCreatorWizard.** Preserved per ORCH-0874 hard guard.
- **No new strict-grep CI gate from this ORCH.** Audit-test extension provides the structural safeguard; no parallel CI workflow added per orchestrator memory rule on strict-grep registry.
- **No cover-edit on the public trip page.** Public page renders cover but does not allow edit (correct — operators edit from the wizard).
- **No new copy-deck strings beyond Save / Saved / Tap to add cover / Reserve your spot on {trip.title} / generic trip-not-found / past-trip / closed-trip / sold-out-trip empty states.**
- **No analytics events added.** Existing event-checkout analytics fires from the shared primitives — if any analytics IDs need trip-vs-event discrimination, that is a follow-up ORCH.
- **No native module changes.** EAS-OTA eligible.

### Assumptions (must hold for spec to be correct)

- `business_publish_trip_draft` RPC at `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql:200-209` accepts all 7 cover_media_* fields. (Verified in investigation §4 F-8.)
- `biz_ticket_checkout_create_session` RPC has `v_is_trip := v_event.event_type = 'trip'` branching per `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql`. (Verified in investigation §3.)
- `uploadEventCoverMedia` at `mingla-business/src/services/eventCoverMediaService.ts:76` is generic over `events` table row IDs (parameter named `eventId` is any row in `events`, including trips). (Verified in SPEC pre-flight.)
- Storage bucket is `event_covers` (the const at `eventCoverMediaService.ts:20`). Bucket name does not need to change for trips — they share `events`-row-id keying.
- `usePublicTripBySlug.ts:139-140` already reads `event.cover_media_url + event.cover_media_type` and renders them on the public trip page — no public-page change needed for SC-2.6.

---

## 3. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | In scope? | Per-surface behaviour + paths | Parity model |
|---|---------|-----------|-------------------------------|--------------|
| 1 | Consumer iOS (`app-mobile/` on iOS) | NO | No trip surface on consumer app (Track C1 scope). | n/a |
| 2 | Consumer Android | NO | Same. | n/a |
| 3 | **Buyer-anon Web** (mingla-business RN-Web bundle) | **YES — primary surface for S-3** | New `/checkout-trip/[tripEventId]/{index,buyer,payment,confirm}.tsx` chain. Buyer-anon (no useAuth). Renders trip-specific copy + tier-picker + Stripe payment via shared primitives. | Shared RN code — parity-automatic with mobile via the same files. |
| 4 | **Business iOS** (`mingla-business/` on iOS) | **YES** for S-1 + S-2 (wizard Save + Cover) | TripCreatorWizard + TripCreatorStep1Basics edits. Wizard rendered inside business app. | Shared RN code. |
| 5 | **Business Android** (`mingla-business/` on Android) | **YES — parity-automatic** | Same files as iOS. Tester verifies on Android emu per Q8 lock. | Shared RN code — parity-automatic but verified separately per tester parity-enforcement rule. |
| 6 | Admin Web (`mingla-admin/`) | NO | Admin dashboard has no trip page; no trip CRUD; no trip purchase. | n/a |
| 7 | **Business Web preview** (mingla-business RN-Web dev bundle) | **YES — follows automatically** | Surfaces 3 + 4 + 5 share the RN-Web code path; the web build picks up identical components. | Shared RN-Web code. Tester smokes web for both buyer flow (S-3) AND operator flow (S-1, S-2) per Q8. |

**Manual-parity surfaces:** none — all in-scope surfaces share RN code. Tester verifies parity, not implementor (implementor ships one diff for all three).

**Implications for SC numbering:** SCs are single-numbered (no per-surface forks needed) — every SC implicitly covers iOS + Android + Web for the relevant role (creator or buyer). Tester gate enforces 3-platform verification regardless.

---

## 4. Schema layer (Phase 3 — DB)

**No migrations.** Backend support is already complete:

- `events.event_type` discriminator: live (per ORCH-0826 [Hub Foundation + universal-plus creator])
- `events.cover_media_url`, `cover_media_type`, `cover_media_provider`, `cover_media_source_url`, `cover_media_credit`, `cover_media_credit_url`, `cover_media_alt`: live for both event and trip rows
- `trip_days`, `trip_inclusions`, `trip_pricing_tiers`: live (per ORCH-0859 [Tr2 Minimum Viable Trip])
- `ticket_types`: live, shared event/trip
- RLS policies on `events` + sidecars: cover trip rows for anon read when status ∈ {scheduled, live}; cover trip rows for owner write — already verified in investigation
- Storage bucket `event_covers`: live, RLS-protected, keyed by `{brandId}/{eventId}/...` — trip event-row IDs work without bucket-policy change

**Implementor MUST NOT run `supabase db push` or apply any migration.** If a hypothetical schema gap surfaces during implementation, STOP and surface to the orchestrator — the assumption that zero migrations are needed is investigation-grounded.

---

## 5. Edge function layer (Phase 3 — edge)

**No edge function changes. No deployments.**

The two trip-relevant edge functions are already live and trip-aware:

| Function | Trip-aware proof | Action |
|---------|-----------------|--------|
| `ticket-checkout-create` | RPC `biz_ticket_checkout_create_session` declares `v_is_trip := v_event.event_type = 'trip'` (Tr3 migration 20260610000002) and branches installment-path for trips | None — invoked unchanged from new `/checkout-trip/[tripEventId]/payment.tsx` |
| `ticket-checkout-confirm` | Operates on order ID; event-type-agnostic | None — invoked unchanged from new `/checkout-trip/[tripEventId]/confirm.tsx` |
| `ticket-checkout-status` | Same | None |

**Implementor MUST NOT run `supabase functions deploy`.** If an edge function gap surfaces, STOP and surface to orchestrator.

---

## 6. Service layer (Phase 3 — services)

### 6.1 New: `getPublicTripById` in `mingla-business/src/services/publicEventsService.ts`

Export a new function ALONGSIDE existing `getPublicEventById` (do NOT replace; do NOT widen). Trip-only resolver — mirror the trip-only `usePublicTripBySlug` query at `mingla-business/src/hooks/usePublicTripBySlug.ts:63-83`.

**Signature:**
```ts
export const getPublicTripById = async (
  tripEventId: string,
): Promise<PublicTripDetail | null>
```

**Behaviour:**
1. Probe `events` table by id with `.eq('event_type', 'trip')` filter (the inverse of the event-side probe).
2. If `data === null` → return `null` (trip not found OR not a trip).
3. Otherwise fetch sidecar `trip_days`, `trip_pricing_tiers`, `trip_inclusions`, `ticket_types` in parallel (mirror `usePublicTripBySlug` lines 92-114).
4. Fetch the brand by `brand_id` for the brand payload.
5. Map to a `PublicTripDetail` shape — REUSE the existing `PublicTripPayload` interface from `usePublicTripBySlug.ts:28-37` (hoist to a shared types module if currently inline — see §6.4).

**Status filter:** `.in('status', ['scheduled', 'live'])` matching `usePublicTripBySlug`. (Per investigation §2 data probe — trips use scheduled/live status enum values once published, mirroring events.)

**Soft-delete filter:** `.is('deleted_at', null)`.

**Error contract:** throws on supabase errors; returns null on not-found.

**Type:** `PublicTripDetail` (re-export from the shared types module created in §6.4 OR define inline matching the existing `Trip` interface from `tripsService.ts`).

**Audit-test extension (in `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts`):** add a test asserting `getPublicTripById` source contains `.eq("event_type", "trip")`. Add to the existing `describe("ORCH-0859 REWORK 3 — events_type filter audit (trip-only defensive)")` block. New test name: `"publicEventsService.getPublicTripById pins event_type='trip'"`.

### 6.2 New: `updateTripCover` in `mingla-business/src/services/tripsService.ts`

Mirror of `updateTripBasics` shape — cover-only commit path for already-published trips.

**Signature:**
```ts
export interface TripCoverPatch {
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider: string | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
}

export async function updateTripCover(
  eventId: string,
  brandId: string,
  patch: TripCoverPatch,
): Promise<void>
```

**Behaviour:**
- Permission check via existing brand-role pattern (mirror `updateTripBasics`).
- Direct UPDATE to `events` table:
  ```ts
  await supabase
    .from('events')
    .update({
      cover_media_url: patch.coverMediaUrl,
      cover_media_type: patch.coverMediaType,
      cover_media_provider: patch.coverMediaProvider,
      cover_media_source_url: patch.coverMediaSourceUrl,
      cover_media_credit: patch.coverMediaCredit,
      cover_media_credit_url: patch.coverMediaCreditUrl,
      cover_media_alt: patch.coverMediaAlt,
    })
    .eq('id', eventId)
    .eq('brand_id', brandId)
    .eq('event_type', 'trip')   // pin trip-only — audit invariant
    .is('deleted_at', null);
  ```
- I-MUTATION-ROWCOUNT-WAIVER comment (mirror `softDeleteTrip` pattern at `tripsService.ts:825`).
- Error contract: throws on supabase error.

**Why this hook exists:** Save-cover-only path on an already-published trip must NOT call the publish RPC (Q7 lock). The wizard's cover-bound autosave (SC-2.5) routes through this service.

### 6.3 Extension: `publishTrip` payload schema in `mingla-business/src/services/tripsService.ts:776-800`

No service-code change — the function already takes `draftPayload: Record<string, unknown>`. The change is on the CALLER side (TripCreatorWizard.handleConfirmPublish, §9.2 below): extend the `draftPayload` object to include the 7 cover_media_* fields when set.

Document the supported keys in a top-of-function comment so future callers know the schema:
```ts
/**
 * publishTrip — calls business_publish_trip_draft RPC with draft payload.
 *
 * Supported draftPayload keys (per migration 20260608000100):
 *   - title (string, required)
 *   - timezone (string)
 *   - theme.business_trip.{startAt,endAt,destinationPlaceId,destinationLocationText,
 *     destinationLat,destinationLng,capacity}
 *   - cover_media_url, cover_media_type, cover_media_provider, cover_media_source_url,
 *     cover_media_credit, cover_media_credit_url, cover_media_alt (ORCH-0876 extension)
 */
```

### 6.4 New module: `mingla-business/src/types/publicTrip.ts` (OPTIONAL — implementor's call)

If implementor finds the `PublicTripPayload` interface is needed in 3+ places (`usePublicTripBySlug.ts`, `usePublicTripById.ts`, new `getPublicTripById`), hoist to a shared types module. If only used in 2 places, inline duplication is fine — DO NOT add a module for marginal DRY.

### 6.5 No changes to existing event services

`getPublicEventById`, `getPublicEventBySlug`, `getPublicBrandBySlug` in `publicEventsService.ts` STAY UNCHANGED — the audit test in `eventType.filter.audit.test.ts:90-116` continues to enforce their trip-rejection probes.

---

## 7. Hook layer (Phase 3 — hooks)

### 7.1 New: `usePublicTripById` at `mingla-business/src/hooks/usePublicTripById.ts`

Mirror `usePublicEventById` (`usePublicEvents.ts:50-63`) for trips.

**Code shape:**
```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getPublicTripById } from "../services/publicEventsService";
import type { PublicTripPayload } from "./usePublicTripBySlug"; // or shared types

const PUBLIC_TRIP_STALE_MS = 60 * 1000;
const DISABLED_KEY = ["public-trips-disabled"] as const;

// Reuse tripKeys factory from useTrips.ts if available; otherwise inline a
// public-trip-by-id key that does NOT collide with tripKeys.byId (which is
// owner-side).
const publicTripKeys = {
  detailById: (id: string): readonly ["public-trips", "detail-by-id", string] =>
    ["public-trips", "detail-by-id", id] as const,
};

export const usePublicTripById = (
  tripEventId: string | null,
): UseQueryResult<PublicTripPayload | null> => {
  const enabled = tripEventId !== null && tripEventId.length > 0;
  return useQuery<PublicTripPayload | null>({
    queryKey: enabled ? publicTripKeys.detailById(tripEventId) : DISABLED_KEY,
    enabled,
    staleTime: PUBLIC_TRIP_STALE_MS,
    queryFn: async () => {
      if (!enabled || tripEventId === null) return null;
      return getPublicTripById(tripEventId);
    },
  });
};
```

**Query key isolation:** `["public-trips", "detail-by-id", id]` is distinct from the existing `publicEventKeys.detailById` (`["public-events", "detail-by-id", id]`). No cache collision.

### 7.2 New: `useUpdateTripCover` at `mingla-business/src/hooks/useTrips.ts` (append to existing file)

Mirror `useUpdateTripBasics` pattern.

```ts
export const useUpdateTripCover = () =>
  useMutation({
    mutationFn: async (input: {
      eventId: string;
      brandId: string;
      patch: TripCoverPatch;
    }) => updateTripCover(input.eventId, input.brandId, input.patch),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: tripKeys.byId(vars.eventId) });
      queryClient.invalidateQueries({
        queryKey: tripKeys.publicByIdOrSlug(),  // or all public-trip keys
      });
    },
    onError: (e) => {
      console.warn('[useUpdateTripCover] failed', e);
      // Do not silently swallow — let consumer surface a toast per SC-1.5
      throw e;
    },
  });
```

**Cache invalidation:** must invalidate (a) owner-side `tripKeys.byId(eventId)` so the trip dashboard refreshes its cover, and (b) public-trip caches so the public page reflects the new cover within stale-time.

### 7.3 No existing hook signature changes

`usePublicEventById`, `usePublicEventBySlug`, `usePublicBrandBySlug`, `usePublicTripBySlug`, `useUpdateTripBasics`, `useUpsertTripDays`, `useUpsertTripInclusions`, `useUpdateTripPricing` — all preserved unchanged.

---

## 8. Route layer (Phase 3 — new routes)

Create the following 5 files under `mingla-business/app/checkout-trip/[tripEventId]/`:

### 8.1 `_layout.tsx`

Expo-router layout shell. Mirror `mingla-business/app/checkout/[eventId]/_layout.tsx` exactly — same CartContext provider wrap, same stack screens config — but rename the route segment label to "Trip checkout" if relevant.

**Anon-tolerance:** NO `useAuth`. NO sign-in redirect. Mirror existing `/checkout/[eventId]/_layout.tsx` (`feedback_anon_buyer_routes.md`).

### 8.2 `index.tsx` — trip tickets screen

Mirror `mingla-business/app/checkout/[eventId]/index.tsx` structure end-to-end, with these substitutions:

| Event-side line | Trip-side replacement |
|-----------------|----------------------|
| `import { usePublicEventById } from "../../../src/hooks/usePublicEvents";` | `import { usePublicTripById } from "../../../src/hooks/usePublicTripById";` |
| `const publicEventQuery = usePublicEventById(eventId);` | `const publicTripQuery = usePublicTripById(tripEventId);` |
| `const event = publicEventQuery.data?.event ?? null;` | `const trip = publicTripQuery.data?.trip ?? null;` (PublicTripPayload shape) |
| Title `"Get tickets"` | `"Reserve your spot"` |
| Empty state `"Event not found" / "This link may be expired or moved."` | `"Trip not found" / "This trip link may be expired or moved."` |
| `eventPublicPath({ brandSlug, eventSlug })` for the back nav fallback | `tripPublicPath({ brandSlug, tripSlug })` (new helper in `publicUrls.ts`; OR fall back to `/b/{brandSlug}` if not added) |
| Tier source `event.tickets` (with QuantityRow per ticket type) | `trip.pricingTiers` mapped to QuantityRow inputs (one row per pricing tier; `ticketTypeId` drives the QuantityRow's underlying ticket_type) |
| Past-gate `isEventPast(event, computeMasterEndAtUtc(event))` | `isTripPast(trip)` — new helper using `trip.businessTrip.endAt` (trip-specific timestamp). Inline 3-line helper acceptable; do not over-abstract. |
| Cart line construction | identical (CartContext is shared — keys by ticket_type id, agnostic to event vs trip) |

**SafeArea:** mirror the strict-grep-allow comment block at the top of `checkout/[eventId]/index.tsx:17`.

**Continue button:** `router.push(\`/checkout-trip/${tripEventId}/buyer\`)`.

### 8.3 `buyer.tsx` — buyer info collection

Mirror `mingla-business/app/checkout/[eventId]/buyer.tsx` with the same `usePublicEventById → usePublicTripById` swap. Logic for capturing buyer email/phone/name is event-type-agnostic; trip vs event distinction is purely the resolver hook.

Continue button: `router.push(\`/checkout-trip/${tripEventId}/payment\`)`.

### 8.4 `payment.tsx` — Stripe payment

Mirror `mingla-business/app/checkout/[eventId]/payment.tsx` end-to-end. Critical points:

- The session-create RPC `biz_ticket_checkout_create_session` IS trip-aware — calling it with a trip event ID triggers the installment-path branch automatically (per Tr3 ORCH-0869 migration 20260610000002).
- Resolver swap: `usePublicEventById → usePublicTripById`.
- Title copy: `"Payment"` (no change — same as event-side).
- Stripe PaymentSheet integration: unchanged (single-payment trips treat like event tickets; installment trips trigger the existing installment branch).

Continue/confirm: routes to `router.replace(\`/checkout-trip/${tripEventId}/confirm?...\`)` on Stripe success.

### 8.5 `confirm.tsx` — confirmation + receipt

Mirror `mingla-business/app/checkout/[eventId]/confirm.tsx` end-to-end. Resolver swap: `usePublicEventById → usePublicTripById`. Copy adjustments: `"Your tickets" → "Your reservation"` ONLY if copy actually says "tickets" — implementor matches whatever the event-side surface says for consistency. Default = keep "Your tickets" if `trip.pricingTiers` map to ticket_types underneath.

**Hook target for ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]:** this `/checkout-trip/[tripEventId]/confirm.tsx` is the surface Tr4 will extend with a buyer-cancel CTA after ORCH-0876 closes. Implementor MUST NOT scaffold the cancel CTA in this SPEC — it ships with Tr4.

### 8.6 Tests folder

Create `mingla-business/app/checkout-trip/[tripEventId]/__tests__/` and the regression tests specified in §14.

### 8.7 publicUrls helper extension

`mingla-business/src/constants/publicUrls.ts` should gain a `tripCheckoutPath({ tripEventId })` helper (used by TripCheckoutFlow.handleReserve to keep the route literal in one place). If the file doesn't already centralize event paths, add only the trip path constant — do not refactor existing helpers.

---

## 9. Component layer (Phase 3 — components)

### 9.1 Modify: `mingla-business/src/components/trip/TripCheckoutFlow.tsx:59-62`

**Current code (lines 59-62):**
```ts
const handleReserve = (): void => {
  // Route into the existing event-buyer checkout chain. The underlying
  // [...] reuses the existing /checkout chain end-to-end.
  router.push(`/checkout/${trip.id}` as never);
};
```

**Replacement:**
```ts
const handleReserve = (): void => {
  // ORCH-0876: route into the trip-specific /checkout-trip/ chain.
  // The event-side /checkout/ chain hard-rejects trips at usePublicEventById
  // by design (ORCH-0859 REWORK 3 audit-test invariant — see
  // eventType.filter.audit.test.ts). Trips have their own end-to-end chain.
  router.push(`/checkout-trip/${trip.id}` as never);
};
```

Update the file-header comment at line 5-13 accordingly (`navigates to /checkout-trip/{tripEventId}/...`).

### 9.2 Modify: `mingla-business/src/components/trip/TripCreatorWizard.tsx`

Four discrete changes:

#### 9.2.a — `handleStepBack` (line 485-489): await autosave before step decrement

**Current:**
```ts
const handleStepBack = useCallback((): void => {
  if (step <= 1) return;
  setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
  setPublishError(null);
}, [step]);
```

**Replacement:**
```ts
const handleStepBack = useCallback(async (): Promise<void> => {
  if (step <= 1) return;
  // ORCH-0876 SC-1.1: save-on-back. Commit current step before decrementing
  // so the user never loses changes by tapping Back.
  try {
    await autosaveCurrentStep();
  } catch {
    // autosaveError state already set by autosaveCurrentStep; surface the
    // toast via the existing autosave-error pathway. Do NOT block the back
    // tap on save failure — operator may need to back out specifically
    // because save is failing.
  }
  setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
  setPublishError(null);
}, [step, autosaveCurrentStep]);
```

#### 9.2.b — `handleClose` (line 491-528): in edit mode, await autosave before exit

The current edit-mode branch (around line 524 with the "silent exit (autosave semantics)" comment) is the path to modify. The CREATE-mode branch (with the discard ConfirmDialog) MUST be preserved per ORCH-0874.

**Logic shape:**
```ts
const handleClose = useCallback(async (): Promise<void> => {
  if (isCreateMode) {
    // ORCH-0874 [Trip Visual Parity] create-mode-dirty discard dialog —
    // preserved unchanged.
    const pristine = isTripWizardPristine(/* ...existing args... */);
    if (pristine) {
      onExit();
      return;
    }
    setDiscardDialogVisible(true);
    return;
  }
  // ORCH-0876 SC-1.2: edit-mode close = save current step THEN exit.
  // Failure does not block exit (user explicitly asked to leave); the
  // autosave-error toast surfaces and the next session can retry.
  try {
    await autosaveCurrentStep();
  } catch {
    // toast already surfaced via autosave-error pathway
  }
  onExit();
}, [
  isCreateMode,
  isTripWizardPristine,
  /* ...existing deps... */
  autosaveCurrentStep,
  onExit,
]);
```

#### 9.2.c — `handleConfirmPublish` (line 572-601): extend draftPayload with cover_media_*

Add 7 fields to the `draftPayload` object built at lines 578-592. Implementor reads the operator-set cover from local component state (added per §9.3.a) and includes ONLY when set (omit keys if null/empty — matches the RPC's NULLIF pattern at migration 20260608000100 lines 200-209):

```ts
const draftPayload: Record<string, unknown> = {
  title: step1Draft.title.trim(),
  theme: {
    business_trip: {
      startAt: step1Draft.startAt,
      endAt: step1Draft.endAt,
      destinationPlaceId: step1Draft.destinationPlaceId,
      destinationLocationText: step1Draft.destinationLocationText,
      destinationLat: step1Draft.destinationLat,
      destinationLng: step1Draft.destinationLng,
      capacity: step1Draft.capacity,
    },
  },
  timezone: trip.timezone,
};
// ORCH-0876 SC-2.4: include cover_media_* when set.
if (step1Draft.coverMediaUrl !== null && step1Draft.coverMediaUrl.length > 0) {
  draftPayload.cover_media_url = step1Draft.coverMediaUrl;
  draftPayload.cover_media_type = step1Draft.coverMediaType;
  draftPayload.cover_media_provider = step1Draft.coverMediaProvider;
  draftPayload.cover_media_source_url = step1Draft.coverMediaSourceUrl;
  draftPayload.cover_media_credit = step1Draft.coverMediaCredit;
  draftPayload.cover_media_credit_url = step1Draft.coverMediaCreditUrl;
  draftPayload.cover_media_alt = step1Draft.coverMediaAlt;
}
```

#### 9.2.d — Wire "Saved" toast on autosave success (SC-1.3)

The existing `autosaveCurrentStep` (line 453-468) sets `autosaveSavedAt` on success. Use a `useEffect` watching `autosaveSavedAt` to surface a 1.5s "Saved" Toast. Toast must be wrapped in absolute-positioned View per `feedback_toast_needs_absolute_wrap.md`. Suppress the Saved toast if `publishMutation.isPending` (publish flow has its own progress UI).

Pseudo-code:
```ts
const lastShownSaveAtRef = useRef<string | null>(null);
useEffect(() => {
  if (autosaveSavedAt === null) return;
  if (autosaveSavedAt === lastShownSaveAtRef.current) return;
  if (publishMutation.isPending) return;
  lastShownSaveAtRef.current = autosaveSavedAt;
  showToast("Saved");  // existing showToast helper at line ~609
}, [autosaveSavedAt, publishMutation.isPending, showToast]);
```

The existing autosave-error toast pathway (line 605-609) handles SC-1.5 — keep it; do not duplicate.

### 9.3 Modify: `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx`

#### 9.3.a — Add cover field at top of step

Add a Cover row ABOVE the existing title input. The component receives the cover via props from TripCreatorWizard's step1Draft state.

**New props (extend Step1BasicsProps):**
```ts
interface Step1BasicsProps {
  // ...existing...
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  onCoverChange: (cover: TripCoverPatch) => void;
}
```

**Render:**
```tsx
<View style={styles.coverRow}>
  <Text style={styles.label}>Cover</Text>
  <Pressable
    onPress={handleCoverTap}
    accessibilityLabel={
      coverMediaUrl !== null
        ? "Change trip cover"
        : "Add trip cover"
    }
    testID="trip-cover-pressable"
  >
    {coverMediaUrl !== null ? (
      <EventCoverMedia
        mediaUrl={coverMediaUrl}
        mediaType={coverMediaType}
        radius={radiusTokens.lg}
        height={180}
        autoplay={false}
        muted
      />
    ) : (
      <View style={styles.coverEmpty}>
        <Icon name="image" size={32} />
        <Text style={styles.coverEmptyText}>Tap to add a cover</Text>
      </View>
    )}
  </Pressable>
</View>
```

`handleCoverTap` opens the picker. Reuse the CreatorStep4Cover picker pattern (`mingla-business/src/components/event/CreatorStep4Cover.tsx:1-40` and beyond) — implementor decides whether to:
- (a) Extract the picker logic to a shared `<CoverPicker>` component (cleaner; bigger diff)
- (b) Inline a slimmer picker in Step1Basics (smaller diff; some duplication)

**Recommended:** (b) for v1 — inline the ImagePicker.launchImageLibraryAsync + uploadEventCoverMedia call directly. If a third surface needs the same picker later, refactor to (a) in a follow-up ORCH.

#### 9.3.b — Picker integration

```ts
const handleCoverTap = useCallback(async (): Promise<void> => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,  // v1: images only
    quality: 0.85,
    allowsEditing: false,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  try {
    const uploaded = await uploadEventCoverMedia({
      uri: asset.uri,
      brandId: trip.brandId,
      eventId: trip.id,
      mimeType: asset.mimeType ?? null,
      fileName: asset.fileName ?? null,
      fileSize: asset.fileSize ?? null,
    });
    onCoverChange({
      coverMediaUrl: uploaded.publicUrl,
      coverMediaType: uploaded.mediaType,
      coverMediaProvider: "upload",  // or "image" — match event-side string
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: null,
    });
  } catch (e) {
    showToast(
      e instanceof EventCoverMediaError
        ? e.message
        : "Couldn't upload cover. Try again."
    );
  }
}, [trip.brandId, trip.id, onCoverChange, showToast]);
```

**v1 scope: image picker only (no Giphy/Pexels/video).** Adding all 3 cover providers would balloon scope — defer to a follow-up ORCH if operator wants parity with events.

#### 9.3.c — Edit-mode auto-commit

When the wizard is in edit mode (`isCreateMode === false`) AND the cover changes, auto-commit via `useUpdateTripCover` immediately (not through publish). This is the SC-2.5 pathway. Implementor wires this in TripCreatorWizard's `onCoverChange` handler (the one passed down to Step1Basics):

```ts
// In TripCreatorWizard:
const updateCoverMutation = useUpdateTripCover();
const handleCoverChange = useCallback(async (patch: TripCoverPatch) => {
  setStep1Draft((s) => ({ ...s, ...patch }));
  if (!isCreateMode) {
    // Already-published trip — commit cover directly without re-publish.
    try {
      await updateCoverMutation.mutateAsync({
        eventId: trip.id,
        brandId: trip.brandId,
        patch,
      });
      // Saved toast already wired via autosave pathway? No — cover bypasses
      // autosave. Surface "Cover saved" toast explicitly.
      showToast("Saved");
    } catch {
      showToast("Couldn't save cover. Try again.");
    }
  }
}, [isCreateMode, trip.id, trip.brandId, updateCoverMutation, showToast]);
```

### 9.4 Modify: `mingla-business/src/components/ui/Toast.tsx` — verify absolute-wrap

The Toast primitive itself should not change. The CONSUMER (TripCreatorWizard) must wrap it in absolute-positioned View per `feedback_toast_needs_absolute_wrap.md`. Verify TripCreatorWizard's existing render block has the absolute wrap; add if missing.

### 9.5 No changes to other components

`TripCheckoutFlow.tsx` (other than line 59-62), `TripPreview.tsx`, `TripCreatorStep{2,3,4,5}*.tsx`, `EventCoverMedia.tsx`, `EventCreatorWizard.tsx`, all event components — UNCHANGED.

---

## 10. Realtime layer (Phase 3 — realtime)

N/A — no realtime channels touched.

---

## 11. Success criteria (Phase 4 — numbered, observable, testable)

### S-1 (Save semantic)

- **SC-1.1** — In edit mode, when operator changes a field on Steps 1-4 and taps Back, the change is persisted to DB via the active step's autosave mutation BEFORE the step state decrements. Verify: spy on `useUpdateTripBasics` / `useUpsertTripDays` / `useUpsertTripInclusions` / `useUpdateTripPricing`; tap Back; assert mutation fired with the new field value; assert step state decreased AFTER the mutation resolved.
- **SC-1.2** — In edit mode, when operator changes a field and taps the chrome X (Close), the change is persisted via current-step autosave BEFORE wizard exits. CREATE-mode-dirty discard dialog from ORCH-0874 still fires UNCHANGED in create mode.
- **SC-1.3** — After every successful autosave (Next, Back, Close), a Toast with exact copy `"Saved"` appears for 1.5s. Toast is wrapped in absolute-positioned View. Toast is suppressed during publish flow.
- **SC-1.4** — Save NEVER calls `business_publish_trip_draft` RPC for already-published trips. Verify: spy on `publishTrip`; tap Save flow (any of: Next, Back, Close); assert `publishTrip` was NOT called. Only `useUpdateTrip*` mutation hooks called.
- **SC-1.5** — On save failure (network error or supabase error), the existing autosave-error pathway surfaces "Unsaved changes — retrying" in the subtitle row (preserved from current code at line 619). Toast copy `"Couldn't save. Tap to retry."` surfaces (NEW — wired to autosaveError state transition). Operator's edits remain in local component state (step1Draft / daysDraft / etc.) and the wizard does not exit on auto-save failure UNLESS the operator explicitly tapped X (which is a deliberate exit and exits anyway per SC-1.2 trailing).
- **SC-1.6** — DEFERRED — field-blur debounced autosave. Not in v1. Follow-up ORCH if operator requests.

### S-2 (Cover edit)

- **SC-2.1** — TripCreatorStep1Basics renders a Cover row at the top of the step (above title). Shows EventCoverMedia primitive when cover set; "Tap to add a cover" empty state when null.
- **SC-2.2** — Tap → opens ImagePicker.launchImageLibraryAsync (images only in v1). Cancel → no change. Pick → uploads via `uploadEventCoverMedia` → calls `onCoverChange` callback.
- **SC-2.3** — Uploaded cover lands in storage bucket `event_covers` at path `{brandId}/{tripEventId}/{random}.{ext}` (existing bucket; existing path scheme). Public URL is returned and used as `cover_media_url`.
- **SC-2.4** — `TripCreatorWizard.handleConfirmPublish` extends `draftPayload` with the 7 cover_media_* fields when set. Verify: spy on `publishTrip`; publish with cover set; assert draftPayload has all 7 keys with the operator-set values.
- **SC-2.5** — Cover-edit on already-published trip routes through `useUpdateTripCover` (NOT publish RPC). Verify: in edit mode of a non-create trip, change cover; spy on `publishTrip` (assert NOT called) and on `updateTripCover` (assert called with the 7-field patch). Surface `"Saved"` toast on success.
- **SC-2.6** — Public trip page at `/t/{brandSlug}/{tripSlug}` renders the trip cover using existing `event.cover_media_url` read at `usePublicTripBySlug.ts:139-140`. No public-page code change required — verify by setting a cover via the wizard and observing it appears on the public page after stale-time refresh.

### S-3 (Reserve route)

- **SC-3.1** — `TripCheckoutFlow.handleReserve` routes to `/checkout-trip/${trip.id}` (NOT `/checkout/${trip.id}`). Verify: spy on `router.push`; tap Reserve; assert exact route literal.
- **SC-3.2** — Route `/checkout-trip/[tripEventId]/index.tsx` mounts and calls `usePublicTripById(tripEventId)`. Renders the same loading / error / not-found / sold-out / past / closed empty-state pattern as the event-side equivalent — but with trip-specific copy.
- **SC-3.3** — `getPublicTripById` queries `events` with `.eq('event_type', 'trip')` AND `.in('status', ['scheduled','live'])` AND `.is('deleted_at', null)`. Returns null for non-trip rows, missing rows, or draft/cancelled trips. Audit test `eventType.filter.audit.test.ts` includes a new assertion pinning this.
- **SC-3.4** — Tickets screen renders the trip's `pricingTiers` as QuantityRow entries. Title copy: `"Reserve your spot"`. Continue CTA enabled when at least one tier quantity ≥ 1.
- **SC-3.5** — `/checkout-trip/{tripEventId}/buyer.tsx` collects buyer email + name (mirror event-side buyer.tsx contract — same shared `CartContext` carries the cart). Continue routes to `/checkout-trip/${tripEventId}/payment`.
- **SC-3.6** — `/checkout-trip/{tripEventId}/payment.tsx` invokes `biz_ticket_checkout_create_session` RPC; the RPC's `v_is_trip` branching at Tr3 migration handles installment vs single-payment automatically. Stripe PaymentSheet completes payment. No edge function change.
- **SC-3.7** — Success routes to `/checkout-trip/{tripEventId}/confirm` — shows confirmation + ticket QR + share + receipt download (reuse event-side primitives). This surface is the Tr4 buyer-cancel CTA target (ORCH-0875 [Tr4] extends post-CLOSE).
- **SC-3.8** — Existing `/checkout/[eventId]/*` chain UNCHANGED. Adversarial test confirms a trip ID hitting `/checkout/{tripId}` STILL renders the existing "Event not found" empty state (preserves the audit invariant).
- **SC-3.9** — All `/checkout-trip/[tripEventId]/*` routes are buyer-anon (no `useAuth`, no sign-in redirect). Mirrors `/checkout/[eventId]/*` anon-tolerance.
- **SC-3.10** — All `/checkout-trip/[tripEventId]/*` routes carry the strict-grep-allow safearea-on-fullscreen-routes comment matching `/checkout/[eventId]/index.tsx:17` (design-intent full-bleed buyer header).
- **SC-3.11** — Trip-not-found, past-trip, closed-trip (when ORCH-0875 [Tr4] ships its `bookings_closed` gate later), sold-out-trip, and zero-tier states all render trip-specific empty-state copy. v1 spec covers: not-found, past, sold-out, zero-tier. The closed-trip state is reserved for Tr4 — Tr4 spec amendment after this CLOSE wires it.

---

## 12. Invariants — preserved (Phase 5 — must NOT break)

| ID | Description | How spec preserves it |
|----|-------------|-----------------------|
| Audit test `eventType.filter.audit.test.ts` (existing 4 + 4 trip clauses) | `getPublicEventBy*` rejects trips; `tripsService.getTrip + updateTripBasics + updatePricing` pin `event_type='trip'` | Spec adds a new `getPublicTripById` ALONGSIDE existing events functions; existing event functions UNTOUCHED; audit test extended with a new clause for the new function |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (ORCH-0859) | Trip routes and event routes are separated by event_type | New `/checkout-trip/[tripEventId]/*` chain is trip-only; event `/checkout/[eventId]/*` chain stays event-only; both audit-test enforced |
| I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES (ORCH-0859) | Fullscreen buyer-anon routes have explicit SafeArea pattern + strict-grep allowlist comment | All 5 new `/checkout-trip/[tripEventId]/*` routes carry the same allowlist comment block (per SC-3.10) |
| I-PROPOSED-TR1-PERSONA-INTERFACE (ORCH-0855) | PersonaDef.id union locked at 3 ids | This spec does not touch PersonaDef |
| I-PROPOSED-TR1-KIND-IMMUTABLE (ORCH-0855) | brands.kind immutable post-create for trip_planner | This spec does not touch BrandEditView |
| ORCH-0869 [Tr3] 4 installment invariants | Installment-PI-via-cron-owner, installment-customer-durability, ledger-collected-implies-pi-id, schedule-currency-pinned-at-publish | This spec calls `biz_ticket_checkout_create_session` unchanged; Tr3 backend handles installment branching; no ledger change |
| ORCH-0874 [Trip Visual Parity] chrome contract | TripCreatorWizard Close X + Stepper + Keyboard.addListener + isCreateMode/isTripWizardPristine logic | This spec preserves all chrome; only extends handleStepBack + handleClose with autosave calls; create-mode discard dialog UNCHANGED |
| `feedback_anon_buyer_routes.md` | Buyer-anon routes live outside `app/(tabs)/`, no useAuth, no sign-in redirect | `app/checkout-trip/[tripEventId]/*` is outside `app/(tabs)/`; no useAuth (SC-3.9) |
| `feedback_toast_needs_absolute_wrap.md` | Toast consumers must absolute-position wrap | SC-1.3 explicitly mandates absolute-wrap |
| `feedback_rn_color_formats.md` | hex/rgb/hsl/hwb colors only | No new color tokens introduced in this spec |
| Constitution #1 (no dead taps) | Every interactive element responds | Reserve CTA reaches working purchase chain (SC-3.1..3.11) |
| Constitution #3 (no silent failures) | Every error surfaces | Save failure surfaces toast (SC-1.5); upload failure surfaces toast (SC-2.2 error path); trip-not-found renders trip-specific empty state (SC-3.11) |
| Constitution #9 (no fabricated data) | Missing = hidden, never fake | Cover-not-set state shows empty pressable, not a fake cover; trip-not-found shows empty state, not fake data |
| Constitution #12 (validate at right time) | User's datetime, not new Date() | isTripPast uses `trip.businessTrip.endAt` per investigation §6 |
| One-PR-per-CLOSE (orchestrator rule) | Each CLOSE is one Seth→main PR | Orchestrator concern at CLOSE — SPEC noted only |
| Step 0.5 regression-test gate (ORCH-0840) | Implementor happy-path + tester adversarial both required | §14 names both with paths |
| Step 1.5 DIAG-marker reaping | Zero `[ORCH-0876-DIAG]` markers at CLOSE | Implementor instructed not to leave DIAG markers (§17 below) |

---

## 13. Invariants — NEW DRAFT (flip to ACTIVE at CLOSE)

| ID | Description | Verification mechanism |
|----|-------------|------------------------|
| **I-PROPOSED-TR-CHECKOUT-ROUTE-BY-EVENT-TYPE** | `/checkout-trip/[tripEventId]/*` resolves ONLY `event_type='trip'`; `/checkout/[eventId]/*` resolves ONLY `event_type='event'`. Neither route serves the other type. | Audit test `eventType.filter.audit.test.ts` extended; adversarial test `event_chain_rejects_trips_still.test.tsx` asserts trip ID at /checkout/ still returns "Event not found" |
| **I-PROPOSED-TRIP-WIZARD-EDIT-SAVE-DISTINCT-FROM-PUBLISH** | In edit mode, Save commits via per-step mutation hooks (`useUpdateTrip*` / `useUpsert*`) and `useUpdateTripCover`. Save NEVER calls `business_publish_trip_draft` RPC. | SC-1.4 spy assertion; SC-2.5 spy assertion |
| **I-PROPOSED-TRIP-COVER-EDITABLE-POST-CREATE** | Trip cover_media_* fields are updatable on already-published trips via `updateTripCover` service without re-publish. Schema supports it (existing); UI exposes it (this ORCH). | SC-2.5 |
| **I-PROPOSED-TRIP-WIZARD-SAVE-ON-BACK-AND-CLOSE** | In edit mode, `handleStepBack` awaits `autosaveCurrentStep()` before step decrement; `handleClose` awaits `autosaveCurrentStep()` before exit. Failure does not block back/close (deliberate user exit); error toast surfaces. | SC-1.1 + SC-1.2 spy assertions |

No new strict-grep CI gates from this ORCH per orchestrator memory rule. Audit-test extension is sufficient structural safeguard.

---

## 14. Test cases (Phase 6 — happy + error + edge + adversarial)

### Implementor happy-path tests (required for Step 0.5 gate)

| Path | Purpose |
|------|---------|
| `mingla-business/src/components/trip/__tests__/TripCheckoutFlow_routes.test.ts` | SC-3.1 — assert `handleReserve` routes to `/checkout-trip/${trip.id}` literal. fails-on-revert: change route back to `/checkout/${trip.id}` → test FAILS. |
| `mingla-business/src/components/trip/__tests__/TripCreatorWizard_editSave.test.ts` | SC-1.1 + SC-1.2 + SC-1.4 — assert handleStepBack and handleClose-edit-mode await autosaveCurrentStep before state mutation; assert publishTrip NOT called from Save paths. |
| `mingla-business/src/components/trip/__tests__/TripCreatorStep1Basics_cover.test.ts` | SC-2.1 + SC-2.4 + SC-2.5 — assert Cover row renders; assert onCoverChange propagates 7 fields; assert publish-payload extension; assert updateTripCover called in edit mode. |

Each happy-path test MUST include a `fails-on-revert verified at <commit hash>` line in the implementation report. Tests that pass on both fixed and unfixed code don't exercise the bug.

### Tester adversarial test (required for Step 0.5 gate)

| Path | Purpose | Different angle from happy-path |
|------|---------|--------------------------------|
| `mingla-business/app/checkout/[eventId]/__tests__/event_chain_rejects_trips_still.test.tsx` | SC-3.8 — adversarial anti-regression. Mount `/checkout/[eventId]/index.tsx` with a `tripEventId` (event_type='trip'). Assert it STILL renders the "Event not found" empty state. This protects the existing audit invariant from being accidentally widened by the fix. Different angle: happy-path tests prove the trip path WORKS; this proves the event path STILL REJECTS trips. | Happy-paths cover the new chain; this covers preservation of the old chain |

### Audit-test extension (in existing file)

| Path | Purpose |
|------|---------|
| `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (extend) | Add a test `"publicEventsService.getPublicTripById pins event_type='trip'"` under the existing trip-defensive describe block. Assert source contains `.eq("event_type", "trip")` for the new function. |

### Detailed test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Reserve route | tap Reserve on /t/{brand}/{trip} | `router.push('/checkout-trip/${trip.id}')` | Component + Route |
| T-02 | Trip resolver pins event_type | call `getPublicTripById(eventId)` where event_type='event' | returns null | Service |
| T-03 | Trip resolver returns trip | call `getPublicTripById(tripId)` for a scheduled/live trip | returns PublicTripPayload | Service + DB |
| T-04 | Past trip empty state | endAt < now | renders "This trip has ended" or equivalent trip-specific copy | Component |
| T-05 | Sold out empty state | all tiers capacity = 0 | renders sold-out copy | Component |
| T-06 | Edit-back save | edit Step 3 field, tap Back | mutation fires; step state decrements AFTER | Hook + Component |
| T-07 | Edit-close save | edit Step 1 field, tap X (edit mode) | mutation fires; onExit called AFTER | Hook + Component |
| T-08 | Create-close discard | edit Step 1 field, tap X (create mode, dirty) | ConfirmDialog fires (ORCH-0874 contract preserved) | Component |
| T-09 | Saved toast | autosaveSavedAt changes | Toast "Saved" visible 1.5s, absolute-wrapped | Component |
| T-10 | Save failure | autosaveCurrentStep throws | "Unsaved changes — retrying" subtitle + error toast; wizard does not exit on autosave-failure (unless user tapped X) | Component |
| T-11 | Save does not republish | tap Next on already-published trip | useUpdateTrip* called; publishTrip NOT called | Component + Hook |
| T-12 | Cover render empty | trip.coverMediaUrl is null | "Tap to add a cover" placeholder | Component |
| T-13 | Cover upload | pick image | uploadEventCoverMedia called; onCoverChange propagates 7-field patch | Component + Service |
| T-14 | Cover edit-mode commit | change cover on published trip | updateTripCover called; publishTrip NOT called | Component + Hook |
| T-15 | Cover publish payload | publish with cover set | draftPayload includes cover_media_* (7 fields) | Component → Service |
| T-16 | Public trip page renders cover | trip has cover_media_url | EventCoverMedia renders the url | Component (already shipping; verify) |
| T-17 | Event chain still rejects trips | mount /checkout/{tripId} | "Event not found" empty state | Adversarial |
| T-18 | Audit test extension | scan getPublicTripById source | finds `.eq("event_type", "trip")` | Audit |
| T-19 | Buyer-anon checkout-trip | visit /checkout-trip/{tripId} unauthenticated | renders ticket screen; no sign-in redirect | Route |
| T-20 | Trip checkout payment installment | trip with installment plan | payment screen uses Stripe SetupIntent path (Tr3 RPC branch); confirms via /checkout-trip/{tripId}/confirm | Full stack |

Tester writes T-17 (adversarial). Implementor writes T-01..T-16, T-18..T-20 (happy paths + audit). All tests have `fails-on-revert` verification per Step 0.5 gate.

---

## 15. Implementation order (Phase 7)

Sequenced for minimum risk and maximum testability:

1. **Service layer** — add `getPublicTripById` to `publicEventsService.ts`; add `updateTripCover` + `TripCoverPatch` to `tripsService.ts`; document publishTrip payload schema. Run audit test extension; verify it passes.
2. **Hook layer** — add `usePublicTripById` (new file); add `useUpdateTripCover` to `useTrips.ts`. Verify React Query keys do not collide with `publicEventKeys`.
3. **publicUrls helper** — add `tripCheckoutPath` constant.
4. **Route layer** — create 5 files under `app/checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx`. Each mirrors event-side shape with the resolver-hook swap. Compile-check + lint-check.
5. **Wire S-3 (one-line route fix)** — modify `TripCheckoutFlow.tsx:62`. Manual sim verification: tap Reserve → expect new route mounts.
6. **Wire S-1 (Save semantic)** — modify `TripCreatorWizard.handleStepBack` + `handleClose` + autosave-success Toast wire-up. Manual sim verification: edit-back, edit-close, observe Saved toast.
7. **Wire S-2 (Cover)** — extend Step1Basics with Cover row; add picker handler; extend `handleConfirmPublish` payload; add `useUpdateTripCover` mutation call in edit-mode flow. Manual sim verification: pick cover, publish, observe persistence.
8. **Implementor happy-path tests** — write the 3 test files under `__tests__/` folders. fails-on-revert verify each.
9. **Adversarial test (tester writes; implementor stubs the file path for the Step 0.5 commit body cite)** — Adversarial file is tester-written in TEST mode. Implementor lists the path in the implementation report so tester knows where to land.
10. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_TRIP_CRUD_AND_PURCHASE_FLOW.md` with old→new receipts per ORCH change, fails-on-revert commit hashes, and a "Discoveries" section for anything found mid-implementation.

**No commits during implementation** — operator commits after orchestrator REVIEW + tester PASS.

---

## 16. Regression prevention (Phase 8)

### Structural safeguards

- **Audit-test extension** at `eventType.filter.audit.test.ts` — pins `getPublicTripById` event_type=trip filter. If a future refactor accidentally widens the trip resolver to also serve events, the test FAILS and the change is blocked by CI.
- **Adversarial test** at `event_chain_rejects_trips_still.test.tsx` — pins the inverse direction: `/checkout/{eventId}/` continues to reject trips. If a future refactor accidentally widens `getPublicEventById` to admit trips, the test FAILS.
- **4 new DRAFT invariants** (§13) — codified at CLOSE for future investigations to consult.

### Protective comments

Each touched file gets a single-line `// ORCH-0876` comment at the modified line explaining the WHY (not the WHAT):

- `TripCheckoutFlow.tsx:62` — "// ORCH-0876: trip-specific chain; event-side hard-rejects trips by audit-test invariant"
- `TripCreatorWizard.handleStepBack` — "// ORCH-0876 SC-1.1: save-on-back so changes aren't lost"
- `TripCreatorWizard.handleClose` edit-mode branch — "// ORCH-0876 SC-1.2: save-on-close in edit mode"
- `TripCreatorStep1Basics.tsx` cover row — "// ORCH-0876 SC-2.1: cover-edit on trip wizard"
- `tripsService.updateTripCover` — "// ORCH-0876 SC-2.5: cover commit without re-publish"
- `publicEventsService.getPublicTripById` — "// ORCH-0876 SC-3.3: trip-only resolver (mirror of getPublicEventById's trip-rejection)"

### Test mod authorization (if needed at CLOSE)

If implementor finds existing tests (e.g., `tr2RewordPolish.test.ts`, ORCH-0859 trip tests) need assertion adjustments to reflect the new Save semantic, cite `[TEST-MOD-APPROVED ORCH-0876]` in the commit body. Tests are append-only otherwise per `.github/workflows/tests-append-only.yml`.

### DIAG marker policy

Implementor MUST NOT leave any `[ORCH-0876-DIAG]` markers in product code at CLOSE. Step 1.5 DIAG-reap is enforced by orchestrator. If diagnostic markers were used mid-implementation (e.g., to trace a bug), remove all before commit.

---

## 17. Open questions

**EMPTY.** All 10 dispatch-§0 questions are operator-locked. SPEC discovered no NEW open question during writing. If implementor surfaces an open question mid-implementation (e.g., "the picker UX needs a Camera button — events have it; should trips?"), STOP and surface to orchestrator — do NOT silently make the call.

---

## 18. Working tree + deployment

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Files created:**
- `mingla-business/src/hooks/usePublicTripById.ts`
- `mingla-business/app/checkout-trip/[tripEventId]/_layout.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/index.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx`
- `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`
- `mingla-business/src/components/trip/__tests__/TripCheckoutFlow_routes.test.ts`
- `mingla-business/src/components/trip/__tests__/TripCreatorWizard_editSave.test.ts`
- `mingla-business/src/components/trip/__tests__/TripCreatorStep1Basics_cover.test.ts`
- `mingla-business/app/checkout/[eventId]/__tests__/event_chain_rejects_trips_still.test.tsx` (tester writes; implementor stubs path)

**Files modified:**
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (1 route literal + header comment)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` (handleStepBack, handleClose, handleConfirmPublish payload, Saved-toast effect, handleCoverChange)
- `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (Cover row + handler + new props)
- `mingla-business/src/services/publicEventsService.ts` (export `getPublicTripById`)
- `mingla-business/src/services/tripsService.ts` (export `updateTripCover` + `TripCoverPatch`; document publishTrip schema)
- `mingla-business/src/hooks/useTrips.ts` (export `useUpdateTripCover`)
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (one new test in existing describe block)
- `mingla-business/src/constants/publicUrls.ts` (one new `tripCheckoutPath` const)

**Files unchanged (explicitly verified):**
- All event-side checkout files (`app/checkout/[eventId]/*`)
- `usePublicEvents.ts` event hooks
- `EventCreatorWizard.tsx`, `CreatorStep4Cover.tsx`
- `EventCoverMedia.tsx`
- `eventCoverMediaService.ts`
- Any supabase/migrations/ file
- Any supabase/functions/ file

**Deployment:**
- Zero migrations to apply (operator skips `supabase db push`).
- Zero edge function deployments (orchestrator skips `supabase functions deploy`).
- EAS OTA eligible — operator publishes post-merge:
  ```bash
  cd mingla-business && eas update --branch production --platform ios,android \
    --message "ORCH-0876: Trip CRUD + Purchase Flow (Save + Cover + Reserve route)"
  ```
- Verify correct EAS project (mingla-business, NOT app-mobile).

**CLOSE protocol:** single PR Seth→main per one-PR-per-CLOSE rule. PR title: `Close ORCH-0876: Trip CRUD + Purchase Flow Completion`. Step 0.5 regression-test gate cites the 4 test paths above. Step 1.5 DIAG-reap: zero `[ORCH-0876-DIAG]` matches required.

**Post-CLOSE actions:**
1. Resume ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: amend its SPEC to target `/checkout-trip/{tripEventId}/confirm` (the canonical trip-confirm route this ORCH establishes) instead of `/checkout/{eventId}/confirm`, then dispatch Tr4 implementor.
2. Flip 4 DRAFT invariants (§13) to ACTIVE in `INVARIANT_REGISTRY.md`.
3. Optional: register follow-up ORCH for SC-1.6 field-blur autosave if operator wants it.
4. Optional: register follow-up ORCH for v2 cover picker (Giphy + Pexels + video parity with events) if operator wants it.

---

## 19. Confidence

**H** — investigation grounded, every contract maps to a six-field finding, source-traced through every layer touched, zero open questions, zero new ambiguity introduced during SPEC writing. The only "probable" tag on the source investigation (S-3 sim/web blocker) does not affect SPEC correctness — fix shape is correct regardless of whether the bug is "probable" or "proven."
