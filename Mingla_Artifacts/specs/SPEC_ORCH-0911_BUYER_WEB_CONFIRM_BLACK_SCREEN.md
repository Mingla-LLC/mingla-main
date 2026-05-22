# SPEC — ORCH-0911 [Buyer-web checkout confirm screen renders black on `?cs=…` arrival]

**ORCH:** ORCH-0911
**Mode:** SPEC (follows INVESTIGATION_ORCH-0911_BUYER_WEB_CONFIRM_BLACK_SCREEN.md)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-22
**Affected Surfaces:** buyer-anon-web (`mingla-business/`) + `supabase/functions/ticket-checkout-create/`.

---

## Scope

This SPEC fixes the two proven root causes from the investigation, in one bundled implementor pass:

1. **RC-1 — Trip buyers routed to the event confirm screen.** `ticket-checkout-create` Stripe `success_url`/`cancel_url` builder must branch on `tripGateRow.event_type`. Trip rows route to `/checkout-trip/{id}/confirm` + `/checkout-trip/{id}/payment`. Event rows keep the current `/checkout/{id}/...`.
2. **RC-2 — Empty-shell black-screen fall-through.** Both confirm screens (`mingla-business/app/checkout/[eventId]/confirm.tsx` and `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`) replace the bare `<View style={styles.host} />` fall-through with a calm "Confirming your tickets…" / "Confirming your reservation…" loading hero whenever `?cs=` is present in the URL AND `result === null`. The loading hero renders INDEPENDENT of `event`/`trip` query state and INDEPENDENT of `realtimePending`. The existing "Confirming…" hero copy + checkmark badge is the right visual.

---

## Non-Goals

- **No defensive copy for permanent failure** (e.g., 30s+ timeout with "Email support" copy) — operator did not request, and ORCH-0852 comments explicitly forbid retry buttons / help links / dead-end fallbacks on this surface. Investigation noted this as DISC-0911-A carry-forward.
- **No telemetry/Mixpanel additions** — DISC-0911-D carry-forward.
- **No defensive type change on `getPublicEventById`** — DISC-0911-C carry-forward.
- **No `buildConfirmSuccessUrl` helper extraction** — DISC-0911-A. Implementor MAY inline the branch directly in `ticket-checkout-create/index.ts`; helper extraction is not required.
- **No change to native (iOS/Android Stripe PaymentSheet) flow** — not affected by RC-1; deep-link handler is independent.
- **No change to ORCH-0852 sync-confirm + Realtime fallback architecture.** Only the loading-state coverage changes.
- **No DB migration. No RLS change. No new edge function.** Pure code edits.

---

## Assumptions

- `tripGateRow` is loaded at `ticket-checkout-create/index.ts:138-149` BEFORE the URL-builder block at line 419, so `tripGateRow?.event_type` is reliably available at line 430.
- `mobile-web` surface is reachable for both event and trip flows; same branching applied to both `surface === "web"` and `surface === "mobile-web"` cases (the URL-builder code path is shared between them at line 419).
- The existing "Confirming…" hero copy at `confirm.tsx:359-378` (event) and `checkout-trip/[tripEventId]/confirm.tsx:312-331` (trip) is acceptable as the new universal loading state — no UX/copy changes required.

---

## Cross-Surface Impact

| Surface | Covered? | What changes | Files touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** | NOT in scope | No change — consumer-app has no buyer-anon-web flow. | None | N/A |
| **Consumer Android** | NOT in scope | No change. | None | N/A |
| **Buyer/anonymous Web** | **YES (primary)** | (a) Stripe `success_url`/`cancel_url` route to correct event/trip path based on `event_type`. (b) Both confirm screens render "Confirming…" hero on first paint when `?cs=` present + `result===null`. | `supabase/functions/ticket-checkout-create/index.ts`, `mingla-business/app/checkout/[eventId]/confirm.tsx`, `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` | Manual (3 separate file edits — each has its own SC) |
| **Business iOS** | NOT in scope | Native PaymentSheet uses deep-link return, not web URLs. RC-1 does not apply. | None | N/A |
| **Business Android** | NOT in scope | Same as iOS. | None | N/A |
| **Admin Web** | NOT in scope | Admin doesn't render checkout. | None | N/A |
| **Business Web preview** | Inherited (passthrough) | mingla-business web preview uses the same code as production buyer-anon-web; fix applies automatically. | None directly | Automatic |

---

## Layer-by-Layer Specification

### Database layer — NONE

No schema changes. No migrations. No RLS changes.

### Edge function layer — `ticket-checkout-create`

**File:** `supabase/functions/ticket-checkout-create/index.ts`

**Current code at lines 418-449 (the surface routing block).** Modify the `successUrl`/`cancelUrl` construction at lines 422-449 to branch on `event_type`. The `tripGateRow` is loaded at line 138-149 and is in scope at this point.

**Exact change shape (the implementor may format differently as long as semantics match):**

```ts
if (surface === "web" || surface === "mobile-web") {
  let successUrl: string;
  let cancelUrl: string;
  if (surface === "web") {
    const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
    if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      console.error(
        "[ticket-checkout-create] MINGLA_PUBLIC_WEB_BASE_URL not set or invalid",
      );
      return jsonResponse({ error: "web_base_url_missing" }, 500);
    }
    // ORCH-0911 — branch confirm/payment URL on event_type so trip buyers
    // reach the trip-confirm screen (which calls usePublicTripById) and
    // event buyers reach the event-confirm screen. Pre-ORCH-0911 hardcoded
    // `/checkout/...` for all rows, leaving trip buyers on a screen that
    // calls getPublicEventById → null (trip-row rejection) → permanent
    // black render.
    const isTrip = tripGateRow?.event_type === "trip";
    const surfacePath = isTrip ? "checkout-trip" : "checkout";
    successUrl =
      `${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`;
    cancelUrl = `${baseUrl}/${surfacePath}/${eventId}/payment`;
  } else {
    // mobile-web custom-scheme branch unchanged from ORCH-0839-B.
    successUrl =
      `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success`;
    cancelUrl =
      `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel`;
  }
  // ... rest unchanged
```

**Implementor notes:**

- DO NOT change the `mobile-web` branch — its custom-scheme deep link is event/trip-agnostic and handled by the native return route.
- DO NOT factor `tripGateRow.event_type === "trip"` into a helper unless you're already touching adjacent code; inline is fine.
- DO leave the existing `tripGateRow` load + `event_type` use at lines 138-235 untouched.
- DO add a one-line comment citing ORCH-0911 above the branch.

### Service layer — NONE

`createTicketCheckout` already returns the `hostedCheckoutUrl` Stripe builds from `success_url`. No client-service change needed — the fix is server-side.

### Hook layer — NONE

`usePublicEventById` / `usePublicTripById` already do the right thing for their respective row types. No change.

### Component layer — confirm screens (event side)

**File:** `mingla-business/app/checkout/[eventId]/confirm.tsx`

**Current code at lines 359-384:** the hero gate AND the fall-through. Replace BOTH with a single new branching shape.

**Required behavior:**

1. **First-mount loading state (NEW):** when `Platform.OS === "web"` AND `result === null` AND the URL contains `?cs=…` (regardless of `event` query state and regardless of `realtimePending`), render the "Confirming your tickets…" hero. This becomes the new default for the pre-result window.
2. **Hero with realtime-pending text (UNCHANGED behavior, reachable via item 1's gate):** the existing copy + checkmark badge + "Payment received. Your tickets will appear here in a moment." subtext stays.
3. **Empty-shell fall-through (PRESERVED for non-`?cs=` paths):** if `Platform.OS !== "web"` OR no `?cs=` in URL AND (`event===null||result===null`), preserve the bare `<View style={styles.host} />` — that's the legitimate "defensive redirect is about to fire" window for non-resume paths.
4. **Full render (UNCHANGED):** when `event !== null && result !== null`, render the full hero + summary + QR + sticky CTA exactly as today.

**Suggested implementation shape (implementor may refactor):**

```tsx
// Pre-existing realtimePending hero block at 359-378 → DELETE.

// Replace lines 382-384 fall-through with:
if (result === null) {
  if (Platform.OS === "web") {
    const win = (globalThis as unknown as { location?: { search?: string } });
    const hasCs = /[?&]cs=/.test(win.location?.search ?? "");
    if (hasCs) {
      // ORCH-0911 — render loading hero from FIRST paint on ?cs= arrival,
      // independent of event/realtimePending state. Pre-ORCH-0911 this
      // window rendered as pure black (#0c0e12) with no affordance.
      return (
        <View style={styles.host}>
          <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
            <View style={styles.checkBadge}>
              <Icon name="check" size={36} color={textTokens.primary} />
            </View>
            <Text style={styles.heroTitle}>Confirming your tickets…</Text>
            <Text style={styles.heroEmail} numberOfLines={3}>
              Payment received. Your tickets will appear here in a moment.
            </Text>
          </View>
        </View>
      );
    }
  }
  // Non-`?cs=` path → defensive redirect is firing. Bare shell is fine.
  return <View style={styles.host} />;
}

if (event === null) {
  // result is populated but event detail still loading. Show the same
  // loading hero (we have the order, just no event name yet — never black).
  return (
    <View style={styles.host}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.checkBadge}>
          <Icon name="check" size={36} color={textTokens.primary} />
        </View>
        <Text style={styles.heroTitle}>Confirming your tickets…</Text>
        <Text style={styles.heroEmail} numberOfLines={3}>
          Payment received. Your tickets will appear here in a moment.
        </Text>
      </View>
    </View>
  );
}

// Both populated — render full success view (unchanged).
return (
  <View style={styles.host}>
    {/* ... existing scroll + summary + QR + CTA */}
  </View>
);
```

### Component layer — confirm screens (trip side)

**File:** `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx`

Apply the exact same shape change at lines 312-335. Copy difference: the hero title is `"Confirming your reservation…"` (per the existing pre-ORCH-0911 trip hero at line 324) — DO NOT change to "tickets". The subtext stays `"Payment received. Your tickets will appear here in a moment."`.

The condition uses `trip` instead of `event` (the trip-side analog).

### Realtime — NONE

`useOrderRealtimeSubscription` unchanged. The wider gate just means the buyer sees the calm hero from first paint instead of black; the eventual transition to full render still happens via `recordResult` → `result` populated → re-render → second condition (`event !== null`) eventually populates → full render.

### Styles — NONE

No new styles. The hero blocks reuse existing `styles.host`, `styles.hero`, `styles.checkBadge`, `styles.heroTitle`, `styles.heroEmail`.

---

## Success Criteria

**SC-1 (Edge function — event row):** When `ticket-checkout-create` is invoked with `surface:"web"` and the row at `eventId` has `event_type='event'`, the returned `hostedCheckoutUrl` corresponds to a Stripe Checkout session whose `success_url` is `https://business.usemingla.com/checkout/{eventId}/confirm?cs={CHECKOUT_SESSION_ID}` and `cancel_url` is `https://business.usemingla.com/checkout/{eventId}/payment`. (Unchanged from pre-fix behavior — guard against regression.)

**SC-2 (Edge function — trip row):** When the row at `eventId` has `event_type='trip'`, the `success_url` is `https://business.usemingla.com/checkout-trip/{eventId}/confirm?cs={CHECKOUT_SESSION_ID}` and `cancel_url` is `https://business.usemingla.com/checkout-trip/{eventId}/payment`. (NEW.)

**SC-3 (Edge function — null/missing event_type):** When `tripGateRow` is null or `event_type` is null/undefined, the URL falls back to the `/checkout/...` (event) path. (Defensive default — never null-pointer.)

**SC-4 (Edge function — mobile-web surface):** `mobile-web` surface custom-scheme deep link is unchanged regardless of `event_type` (no breakage).

**SC-5 (Event confirm screen — `?cs=` + result===null + event===null):** Renders the "Confirming your tickets…" hero with checkmark badge + reassurance subtext. NOT a bare black `<View>`. Verifiable by `getByText(/Confirming your tickets/)` in jest-dom or RN-test-renderer.

**SC-6 (Event confirm screen — `?cs=` + result populated + event===null):** Renders the same loading hero (we have the order but not the event detail). NOT a bare black `<View>`.

**SC-7 (Event confirm screen — no `?cs=` + result===null):** Preserves the bare `<View style={styles.host} />` so the defensive redirect at line 318 fires uninterrupted on non-resume paths. No regression on the empty-cart redirect path.

**SC-8 (Event confirm screen — happy path):** When both `event !== null` and `result !== null`, renders the full hero + summary + QR + sticky CTA exactly as pre-fix. No regression on the success view.

**SC-9 (Trip confirm screen — `?cs=` + result===null + trip===null):** Renders the "Confirming your reservation…" hero with checkmark badge + reassurance subtext. NOT a bare black `<View>`.

**SC-10 (Trip confirm screen — `?cs=` + result populated + trip===null):** Renders the same loading hero. NOT a bare black `<View>`.

**SC-11 (Trip confirm screen — no `?cs=` + result===null):** Preserves bare `<View>` for defensive redirect window.

**SC-12 (Trip confirm screen — happy path):** Full success render unchanged.

**SC-13 (End-to-end — trip buyer):** A buyer paying for a trip via `/checkout-trip/{tripEventId}/payment` → Stripe-hosted → success redirect lands on `/checkout-trip/{tripEventId}/confirm?cs=...` (NOT `/checkout/{tripEventId}/confirm`). The trip-confirm screen mounts, calls `usePublicTripById`, fetches the trip detail, renders full success view with "Back to trip" CTA reachable. Verifiable manually on Vercel preview with Stripe test card `4242 4242 4242 4242`.

**SC-14 (End-to-end — event buyer):** A buyer paying for an event via `/checkout/{eventId}/payment` → Stripe-hosted → success redirect lands on `/checkout/{eventId}/confirm?cs=...` (unchanged). Confirm screen shows "Confirming…" hero from FIRST paint, transitions to full success view when `event` + `result` both populate. NO black-screen window. Verifiable manually on Vercel preview.

---

## Invariants Preserved

- **I-OUTSIDE-TABS** (`feedback_anon_buyer_routes.md`): `/checkout/...` and `/checkout-trip/...` remain outside `app/(tabs)/`. No change to route grouping.
- **I-ORCH-0852-NO-DEAD-END-CONFIRM**: confirm screen never shows retry button / help link / dead-end fallback. Loading hero is the calm state; full render is the resolved state. Preserved.
- **I-ANON-TOLERANT-BUYER-ROUTES**: neither path calls `useAuth`. Preserved.
- **Constitution #1 (No dead taps):** "Back to event/trip" CTA becomes reachable for trip buyers (RC-1 fix). Event-buyer CTA reachability unchanged.
- **Constitution #3 (No silent failures):** loading-state visibility ELIMINATES the silent "is anything happening?" UX failure. Sync-confirm errors still swallow to `console.warn` (HF-2 carry-forward — DISC-0911-D).
- **Constitution #14 (Persisted-state startup):** sessionStorage resume payload flow unchanged.

## Invariants Established (NEW, DRAFT — flip ACTIVE on ORCH-0911 CLOSE)

- **I-PROPOSED-BUYER-WEB-CONFIRM-HAS-LOADING-STATE** — buyer-anon-web confirm screens (`/checkout/{id}/confirm` and `/checkout-trip/{id}/confirm`) MUST render a non-bare-View loading state from the first paint until either (a) full success view becomes reachable OR (b) defensive redirect fires. Pure-color blank `<View>` is forbidden on the `?cs=…` arrival path.
- **I-PROPOSED-CHECKOUT-SUCCESS-URL-MATCHES-EVENT-TYPE** — `ticket-checkout-create` MUST build `success_url` and `cancel_url` against the path matching the row's `event_type`. Trip rows → `/checkout-trip/{id}/...`. Event rows (or null/default) → `/checkout/{id}/...`. Any future surface added to the `surface === "web" || "mobile-web"` block MUST handle the branching.

## Regression Prevention

- **Strict-grep gate (optional, P3):** add a script under `.github/scripts/strict-grep/` that asserts the `successUrl =` literal in `ticket-checkout-create/index.ts` references `event_type` (or a named helper) within ~10 lines above. WARN-level only. Implementor decides whether to ship.

## Test Cases

| Test | Scenario | Input | Expected | Layer | `[FAILS-ON-REVERT KEY]` |
|---|---|---|---|---|---|
| T-01 | URL builder branches to trip path | mock `tripGateRow.event_type='trip'`, eventId `'abc'` | `successUrl === '{base}/checkout-trip/abc/confirm?cs={CHECKOUT_SESSION_ID}'` | Edge function | YES (T-01) |
| T-02 | URL builder uses event path for event row | `event_type='event'` | `/checkout/abc/confirm?cs=...` | Edge function | YES |
| T-03 | URL builder falls back to event path for null event_type | `tripGateRow=null` | `/checkout/abc/confirm?cs=...` | Edge function | NO (defensive) |
| T-04 | URL builder cancelUrl mirrors trip branch | `event_type='trip'` | `cancelUrl === '{base}/checkout-trip/abc/payment'` | Edge function | YES |
| T-05 | Mobile-web surface unchanged | `surface='mobile-web'`, `event_type='trip'` | `successUrl.startsWith('mingla-business://')` | Edge function | YES (T-05, guards against regression on native) |
| T-06 | Event confirm: cs+result=null+event=null renders hero | mount with `?cs=` URL, no resume payload, no event data | DOM contains "Confirming your tickets…" text; NOT bare View | Component | YES (T-06) |
| T-07 | Event confirm: cs+result populated+event=null renders hero | mount with result set but event query still null | DOM contains "Confirming your tickets…" | Component | YES |
| T-08 | Event confirm: no cs+result=null renders bare View | mount without `?cs=`, no result | DOM matches bare `<View>` (defensive redirect path) | Component | NO (regression guard) |
| T-09 | Event confirm: happy path full render | event + result both populated | DOM contains "You're in" + "Back to event" CTA | Component | YES |
| T-10 | Trip confirm: cs+result=null+trip=null renders hero | mount with `?cs=`, no trip data | DOM contains "Confirming your reservation…" | Component | YES |
| T-11 | Trip confirm: happy path full render | trip + result populated | DOM contains "You're in" + "Back to trip" CTA | Component | YES |
| T-12 | E2E trip buyer (manual, Vercel preview) | Pay with test card 4242 on `/checkout-trip/{tripEventId}/payment` | Redirected to `/checkout-trip/{tripEventId}/confirm?cs=...`; "Confirming…" then full success view; CTA "Back to trip" works | Full stack | YES |
| T-13 | E2E event buyer (manual, Vercel preview) | Pay on `/checkout/{eventId}/payment` | Redirected to `/checkout/{eventId}/confirm?cs=...`; "Confirming…" then full success; CTA works | Full stack | YES |

## Implementation Order

1. **Edge function first.** Edit `supabase/functions/ticket-checkout-create/index.ts:418-449` to add the `event_type` branch in the `surface === "web"` block. Write Deno unit test covering T-01 through T-05 at `supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.test.ts`. Verify locally with `deno test`. Fails-on-revert: revert the branch and confirm T-01 + T-04 fail.
2. **Operator deploys edge function** (orchestrator owns deploy per `feedback_orchestrator_deploys_edge_functions.md`).
3. **Event confirm screen.** Edit `mingla-business/app/checkout/[eventId]/confirm.tsx` to widen the loading hero gate per the suggested implementation shape above. Delete the old realtimePending-gated hero block at lines 359-378 (its content is absorbed into the new universal loading branch). Write jest test covering T-06 through T-09 at `mingla-business/app/checkout/[eventId]/__tests__/orch_0911_confirm_loading_state.test.tsx`.
4. **Trip confirm screen.** Edit `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx` with identical shape. Test T-10 + T-11 at `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.test.tsx`.
5. **Operator runs end-to-end manual smoke** (T-12 + T-13) on Vercel preview with Stripe test mode.
6. **Tester (Claude `mingla-tester`)** writes adversarial regression test attacking DIFFERENT angles than implementor — e.g., mobile-web URL not regressed, `?cs=` present with sessionStorage CLEARED still shows hero (not bare View), trip-row with `tripGateRow=null` defensively routes to event path (not crash), confirm screen with `Platform.OS!=='web'` preserves bare-View fall-through (no native regression).
7. **CLOSE** with `[deploy]` tag (Vercel surfaces) per Vercel `[deploy]` gate.

## Regression Prevention (post-fix discipline)

Cite `[TEST-MOD-APPROVED ORCH-0911]` in the closing commit body ONLY if any test file is modified post-create (append-only gate).

---

## Definition of Done

- [ ] T-01 through T-13 all PASS.
- [ ] T-01 + T-04 + T-06 + T-10 fail-on-revert verified at the implementor's commit hash.
- [ ] Operator manual smoke T-12 + T-13 PASS on Vercel preview with real Stripe test card.
- [ ] Implementation report cites this SPEC + the investigation + lists exact files changed + diff summary.
- [ ] Tester adversarial report attacks 5+ different angles than the happy-path tests, with fails-on-revert evidence.
- [ ] CLOSE commit subject contains `[deploy]` tag.
- [ ] World Map + Master Bug List updated with CLOSE banner.
- [ ] I-PROPOSED-* invariants flipped from DRAFT to ACTIVE in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
