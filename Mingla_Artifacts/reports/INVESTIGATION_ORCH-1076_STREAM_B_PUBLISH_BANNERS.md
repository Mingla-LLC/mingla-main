# INVESTIGATION — ORCH-1076 Stream B [business-app proactive publish banners]

**Mode:** mingla-forensics INVESTIGATE (READ-ONLY, code-audit-only — no sim repro required; pure source map of an existing pattern + parity gap).
**Date:** 2026-06-04
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`
**Confidence:** HIGH (every file read in full; server detection cross-checked against the ORCH-1075 migration; latest-migration confirmed via grep-all → the 1075 migration is the latest toucher of all 4 publish RPCs).

---

## 0. Goal restatement

EVENTS proactively warn a brand "Stripe required for paid tickets / Connect Stripe to publish" BEFORE publish: a status card in the creator's final preview (Step 7), a disabled Publish button, and a blocking toast on Publish-tap. TRIPS and EXPERIENCES have NO proactive banner — they are only blocked **reactively** by (a) the ORCH-1075 server RPC guard (`stripe_charges_disabled`) and (b) the `paidPublishGuards.ts` catch-site copy that fires AFTER the operator taps Publish and the RPC rejects. Stream B replicates the event proactive pattern onto trip + experience creators (and edit-to-paid surfaces), reusing existing pieces.

This investigation maps the event template exactly (file:line), maps the trip + experience gaps, and states the reuse direction + the client/server paid-detection parity requirement. SPEC owns the design.

---

## 1. The EVENT pattern (the template to copy) — file:line

### 1.1 Proactive banner — `mingla-business/src/components/event/CreatorStep7Preview.tsx`
- Component picks one of three status cards from `computePublishability(draft, stripeStatus)` at **line 83**, rendered at **lines 152-164**:
  - `status === "ready"` → `<ReadyCard>` (green check, lines 190-219).
  - `status === "blocked-stripe"` → **`<StripeBlockedCard onConnectStripe={…}>`** (lines 225-248) — the proactive banner. Title **"Stripe required for paid tickets"**, body **"Connect Stripe to publish. Free tickets can be published any time."**, plus a **"Connect Stripe"** Pressable CTA (lines 238-246) wired to the `onConnectStripe` prop.
  - else → `<ErrorsBlockedCard count>` (lines 254-268) — "N things to fix".
- `stripeStatus` source at **line 82**: `brand?.stripeStatus ?? "not_connected"`. The `brand` prop is the full `Brand` (`currentBrandStore`), which carries `stripeStatus?: BrandStripeStatus`.
- Props: `CreatorStep7PreviewProps` (lines 53-58) = `StepBodyProps` + `brand: Brand | null` + `onTapMiniCard` + **`onConnectStripe: () => void`**.

### 1.2 Publish gate logic — `mingla-business/src/utils/draftEventValidation.ts`
- **`validatePublish(draft, brandStripeStatus, partnerStripeGate?)`** (lines 61-104). The Stripe gate is **lines 79-90**:
  ```ts
  const hasPaidTicket = draft.tickets.some((t) => !t.isFree && (t.priceGbp ?? 0) > 0);   // line 81-83
  if (hasPaidTicket && brandStripeStatus !== "active") {                                  // line 84
    errors.push({ fieldKey: "stripeNotConnected", step: 4,
                  message: "Connect Stripe to publish paid tickets." });                  // line 85-89
  }
  ```
- **`computePublishability(draft, brandStripeStatus)`** (lines 531-573). Calls `validatePublish`, splits the stripe error from other errors, and returns `status: "blocked-errors" | "blocked-stripe" | "ready"` plus `hasPaidTickets`/`needsStripe`/`errorCount`. The `"blocked-stripe"` branch is **lines 557-565** (other errors win first → lines 548-556).
- **Client paid-detection (events):** `!t.isFree && (t.priceGbp ?? 0) > 0` across the draft's per-ticket array. Stripe-ready check: `brandStripeStatus === "active"` (negated as `!== "active"`).

### 1.3 Wizard wiring — `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `stripeStatus` resolved at **line 315-316**: `brand?.stripeStatus ?? "not_connected"`.
- `publishability` memo at **lines 599-602**; `publishDisabled = publishability.status === "blocked-stripe" || coverVideoProcessing` at **lines 607-608**.
- **Publish button disabled** when blocked-stripe — dock at **lines 909-919** (`disabled={publishDisabled || isPublishing}`).
- **`handlePublishTap`** (lines 503-527): on Stripe-only blocking (no other errors) it shows the **blocking toast "Connect Stripe to publish paid tickets."** at **line 522** and stays on Step 7 (the body card owns the CTA). Other-errors path opens `<PublishErrorsSheet>` (lines 508-515).
- **`handleConnectStripe`** (lines 593-595) → `onOpenStripeOnboard()`. Step 7 body receives it via `onConnectStripe={handleConnectStripe}` at **line 665**.
- **Reactive catch** (defense-in-depth, ORCH-1075) at **lines 558-574** in `handleConfirmPublish`: `resolvePaidPublishGuardCopy(error.message)` → toast + `onOpenStripeOnboard()` (Guard A) or jump to When step (Guard B).
- `<PublishErrorsSheet>` mounted at root **lines 986-991**.

### 1.4 Stripe-readiness source the UI reads
- `Brand.stripeStatus: BrandStripeStatus` (`store/currentBrandStore.ts` — v8 field). Value computed by **`utils/deriveBrandStripeStatus.ts`** (TS twin of `pg_derive_brand_stripe_status`): returns `"active"` iff `charges_enabled === true` (line 57), else `not_connected`/`onboarding`/`restricted`/`detached`. `hooks/useBrandStripeStatus.ts` reads the full `stripe_connect_accounts` row; `useCurrentBrand()` returns the cached `Brand`.
- **CRITICAL PARITY FACT:** `stripeStatus === "active"` ⇔ `charges_enabled === true` ⇔ the server's `pg_brand_can_charge()` predicate (see §3). Client banner and server block read the SAME truth.

### 1.5 Onboarding route target
- Route file: `app/brand/[id]/payments/onboard.tsx` (param is `id`). Mounts `BrandOnboardView` ("Connect Stripe to start selling tickets", BrandOnboardView.tsx:593).
- Canonical builder: **`paidPublishGuards.ts:106-107`** `brandStripeOnboardingRoute(brandId) = `/brand/${brandId}/payments/onboard``. Resolves the `[id]` param correctly.
- Event flow reaches it via `onOpenStripeOnboard` (route handler does `router.push(brandStripeOnboardingRoute(...))`).

---

## 2. TRIP creator — what's missing (file:line)

### 2.1 No proactive Stripe banner today
- **`TripCreatorStep5Review.tsx`** (Step 7 of the trip wizard — the "Review" preview pane) renders `<TripPreview>` + a `publishError` banner (lines 60-68) that ONLY appears AFTER a failed publish (`mapPublishErrorToState`). There is **NO** Stripe-readiness status card, no `computePublishability` analog, no `onConnectStripe` CTA. `mapPublishErrorToState` (lines 88-179) does map `stripe_charges_disabled` (lines 158-164) — but that is REACTIVE (only after the RPC rejects).
- **`TripCreatorWizard.tsx`**: Publish button (dock, lines 1250-1267) is NEVER disabled for Stripe — only `disabled={submitting}`. `handlePublishTap` (lines 825-828) just opens the confirm dialog with NO pre-check. `handleConfirmPublish` (lines 830-868) catches `stripe_charges_disabled` REACTIVELY at **lines 864-866** → `router.push(brandStripeOnboardingRoute(trip.brandId))`. No proactive banner, no blocking toast before publish, no disabled button.

### 2.2 Where the event-style banner + gate would mount
- Banner: inside `TripCreatorStep5Review` (the Step 7 review body), above/below the `publishError` banner — mirroring `CreatorStep7Preview`'s status card slot.
- Button disable: `TripCreatorWizard.tsx` dock Step-7 Publish (lines 1250-1267) needs a `publishDisabled = needsStripe` analog.
- Blocking toast: `handlePublishTap` (lines 825-828) needs a pre-check that, when paid + not-active, shows a toast and does NOT open the confirm dialog.

### 2.3 Client paid-detection for trips
- Trip pricing is a **single tier** (ORCH-0859): `step4Draft.priceMajor` (string) + `isFree` is NOT modeled as a flag — a trip is paid iff `priceCents = round(parseFloat(priceMajor)*100) > 0`. The in-flight value lives in `step4Draft` (TripCreatorWizard line 357); the previewTrip's tier priceCents is computed at lines 515-518.
- Server detection (trip RPC `business_publish_trip_draft`, ORCH-1075 migration lines 2456-2468): paid = `MAX(ticket_types.price_cents) WHERE available_online = true > 0`. Trip tickets are online-sellable, so client `priceMajor > 0` mirrors it. (See §4 parity requirement — must mirror EXACTLY.)

### 2.4 Is `brand.stripeStatus` available there?
- **NO at the prop boundary — but YES at the route handler.** `TripCreatorWizard`'s `brand` prop is the **narrow `TripPreviewBrand`** type (`TripPreview.tsx:47-53` = `{id, slug, name, bio?, coverMediaUrl?}`) — it does NOT carry `stripeStatus`.
- **HOWEVER** both route handlers (`app/trip/create.tsx:43` and `app/trip/[id]/edit.tsx:60`) call `useCurrentBrand()` (full `Brand` with `stripeStatus`) and then **drop `stripeStatus`** when building the narrow object (`app/trip/[id]/edit.tsx:198-204`). So Stream B must thread `stripeStatus` through — either widen `TripPreviewBrand`/add a sibling prop, OR have the wizard call `useCurrentBrand()` itself (the experience wizard does exactly this — see §3.4).

---

## 3. EXPERIENCE creator — what's missing (file:line)

### 3.1 No proactive Stripe banner today
- **`ExperienceCreatorWizard.tsx`** is a 5-step single-form wizard (Identity / Stops / When / Pricing / Cover; STEPS at lines 129-135). There is **NO review/preview step** and **NO Stripe status card anywhere**. The footer (lines 846-882) shows Continue (steps 1-4) then **"Save as draft" + "Publish"** (step 5, lines 863-880) or a single "Save changes" in live-edit mode.
- Stripe handling is REACTIVE only: `handlePaidPublishGuard` (lines 454-472) calls `resolvePaidPublishGuardCopy(raw)` and, on `stripe_onboarding`, `router.push(brandStripeOnboardingRoute(brand.id))`. It is invoked from `handleSubmit`'s RPC-error catch (line 517) and `handleLiveSave`'s catch (lines 618, 632-638) — i.e. only AFTER `biz_publish_experience` / `biz_update_live_experience` rejects.

### 3.2 Where the event-style banner + gate would mount
- The experience wizard has no review pane, so the banner needs a deliberate home. Candidate: a status card on **Step 4 (Pricing)** or **Step 5 (Cover, the last step before Publish)**, OR a banner rendered above the footer Publish button. SPEC must choose; this is the one place the experience flow diverges structurally from events/trips.
- Button: the **"Publish"** button (lines 872-879) needs a `disabled` when paid + not-active (the "Save as draft" button must stay enabled — drafts are exempt server-side).
- Blocking toast: `handleSubmit(true)` (lines 474-549) should pre-check before calling the RPC and surface the locked copy without a round-trip.

### 3.3 Client paid-detection for experiences (whole vs per-stop)
- Experiences compute `resolvedTotalMajor` (lines 278-288): if `isFree` → 0; if `pricingMode === "whole"` → `parseFloat(wholePriceMajor)`; else (`per_stop`) → SUM of each stop's `parseFloat(s.priceMajor)`. Paid iff `!isFree && resolvedTotalMajor > 0`.
- Server detection (`biz_create_experience` / `biz_publish_experience`, migration lines 301-313 + 356 / 874-884 + 928): `v_resolved_total = (is_free ? 0 : whole ? whole_price_cents : SUM(stop price_cents))`; guard fires on `p_publish AND NOT v_is_free AND v_resolved_total > 0`. The single ticket is always `available_online = true` (migration line 524/1092). So client `!isFree && resolvedTotalMajor > 0` mirrors the server EXACTLY across BOTH pricing modes.

### 3.4 Is `brand.stripeStatus` available there?
- **YES, directly.** `ExperienceCreatorWizard` calls `const brand = useCurrentBrand()` (line 187), which returns the full `Brand` with `stripeStatus`. No threading needed — the wizard can read `brand?.stripeStatus === "active"` in place. This is the cleanest of the three.

---

## 4. EDIT-TO-PAID screens

### 4.1 Reference — event `EditPublishedScreen.tsx`
- Imports `resolvePaidPublishGuardCopy` (line 83) and handles `stripe_charges_disabled` REACTIVELY only (no proactive banner). So **even the EVENT edit screen has no proactive Stripe banner** — the proactive pattern lives ONLY in the create wizard's Step 7. This is a scope clarification: "edit-to-paid parity" means matching the event edit screen's *reactive* behavior, NOT inventing a proactive banner the event edit screen lacks (unless SPEC deliberately upgrades all three).

### 4.2 Trip — `EditPublishedTripScreen.tsx`
- 6-section accordion. Save → `ChangeSummaryModal` → `handleConfirmSave` → `biz_update_live_trip`. Reactive guard ALREADY wired: `buildRejectDialog` cases `stripe_charges_disabled` (lines 873-882, routes to `brandStripeOnboardingRoute(trip.brandId)`) and `offering_date_past` (lines 883-889). No proactive banner. The brand here is the `trip` object's `brandId` only — `stripeStatus` is NOT loaded on this screen (would need `useCurrentBrand()` or a brand query if a proactive banner is added).

### 4.3 Experience live-edit — `ExperienceCreatorWizard.tsx` (liveExperience mode)
- Same component as create; `handleLiveSave` (lines 555-675) routes through `biz_update_live_experience` and already calls `handlePaidPublishGuard` reactively. `brand` (= `useCurrentBrand()`) IS available, so a proactive banner is feasible here with no threading.

### 4.4 Where the banner/gate belongs for editing a live offering into paid
- Trip edit: the Pricing accordion section (`EditPublishedTripScreen.tsx` `case "pricing"`, lines 1171-1223) is where price becomes paid — a banner could mount there or at the Save dock. Brand stripe status must be sourced.
- Experience live-edit: the Pricing step (step 4) or above the "Save changes" button.
- **Recommendation (SPEC decides):** Stream B's primary win is the CREATE-wizard proactive banners for trip + experience (matching events). Edit-to-paid proactive banners are a secondary, optional upgrade since all three edit screens are reactive today and already wire the ORCH-1075 catch. Flag for orchestrator whether edit-to-paid proactive banners are in or out of Stream B scope.

---

## 5. The "Connect Stripe" to-do row already covers all 3 types — do NOT touch

- **`businessTodos.ts:218-227`** emits the `connect_stripe` row whenever `!input.stripeActive` (i.e. brand-level Stripe not active), with sublabel sharpening when `hasDraftPaidOffering`. This is **brand-level and offering-type-agnostic** — it already covers events, trips, AND experiences. Stream B must NOT modify `businessTodos.ts` or the `connect_stripe` row. Confirmed: the to-do row is about the brand connecting Stripe at all; the proactive banner is about a SPECIFIC paid offering being blocked at publish — complementary, non-overlapping surfaces.

---

## 6. Side-by-side gap table

| Capability | EVENT (has it) | TRIP (has / needs) | EXPERIENCE (has / needs) |
|---|---|---|---|
| **Proactive banner (status card)** | ✅ `CreatorStep7Preview.tsx:159-160` `<StripeBlockedCard>` | ❌ NEEDS — mount in `TripCreatorStep5Review.tsx` (review pane) | ❌ NEEDS — no review step; mount on Pricing/Cover step or above Publish (`ExperienceCreatorWizard.tsx`) |
| **Publish gate util** | ✅ `draftEventValidation.ts` `validatePublish` L84-90 + `computePublishability` L557-565 → `"blocked-stripe"` | ❌ NEEDS — no client gate; only reactive `mapPublishErrorToState` (`TripCreatorStep5Review.tsx:158-164`) | ❌ NEEDS — no client gate; only reactive `handlePaidPublishGuard` (`ExperienceCreatorWizard.tsx:454-472`) |
| **Client paid-detection** | ✅ `!t.isFree && (t.priceGbp ?? 0) > 0` (per-ticket array) | ⚠️ `round(parseFloat(step4Draft.priceMajor)*100) > 0` (single tier, no isFree flag) | ⚠️ `!isFree && resolvedTotalMajor > 0` (whole OR per-stop sum, `ExperienceCreatorWizard.tsx:278-288`) |
| **`brand.stripeStatus` available at mount** | ✅ full `Brand` prop (`CreatorStep7Preview` L82) | ⚠️ NO at prop (`TripPreviewBrand` lacks it) — YES at route handler `useCurrentBrand()`; must thread or read in-wizard | ✅ YES — `useCurrentBrand()` in-wizard (`ExperienceCreatorWizard.tsx:187`) |
| **Disabled Publish button when blocked** | ✅ `EventCreatorWizard.tsx:607-608, 916` | ❌ NEEDS — dock Publish only `disabled={submitting}` (L1263) | ❌ NEEDS — Publish button (L872-879); keep "Save as draft" enabled |
| **Blocking toast on Publish-tap** | ✅ `EventCreatorWizard.tsx:522` "Connect Stripe to publish paid tickets." | ❌ NEEDS — `handlePublishTap` L825-828 has no pre-check | ❌ NEEDS — `handleSubmit(true)` L474 has no pre-check |
| **Onboarding route wiring** | ✅ `onConnectStripe → onOpenStripeOnboard` + reactive `brandStripeOnboardingRoute` | ✅ reactive only (`brandStripeOnboardingRoute(trip.brandId)` L865) — needs proactive CTA too | ✅ reactive only (`brandStripeOnboardingRoute(brand.id)` L461) — needs proactive CTA too |
| **Reactive ORCH-1075 catch (already shipped)** | ✅ `EventCreatorWizard.tsx:558-574` + `EditPublishedScreen` | ✅ wizard L864-866 + `EditPublishedTripScreen` L873-889 | ✅ wizard L517 + L618/632 |
| **`connect_stripe` to-do row** | ✅ `businessTodos.ts:218` (covers ALL 3) — DO NOT TOUCH | ✅ same row | ✅ same row |

---

## 7. Reuse plan direction (SPEC owns the detailed design)

The pattern is small and already centralized — **generalize, don't duplicate**:

1. **Banner component:** `StripeBlockedCard` is a private sub-component inside `CreatorStep7Preview.tsx` (lines 225-248). Direction: **extract a shared `<PublishStripeBlockedCard onConnectStripe>` primitive** (e.g. `src/components/offering/PublishStripeBlockedCard.tsx`) consumed by event Step 7, trip review, and the experience wizard. Keeps copy + tokens identical across all three (the copy already matches `paidPublishGuards.ts` `stripe_charges_disabled.body`). This is the cleanest single-source reuse.
2. **Paid-detection + gate:** the event gate is event-shaped (`validatePublish` is tied to `DraftEvent.tickets`). Trips/experiences have different price models. Direction: **add a tiny shared helper** `offeringNeedsStripeToPublish({ isPaid, stripeStatus })` (pure: `isPaid && stripeStatus !== "active"`), and per-type `isPaid` resolvers that EXACTLY mirror each server RPC (see §8). Do NOT try to reuse `validatePublish` itself across types.
3. **`stripeStatus` plumbing:**
   - Experience: read `brand?.stripeStatus` from the existing `useCurrentBrand()` (already in the wizard) — zero plumbing.
   - Trip: thread `stripeStatus` from the route handler (it already has `currentBrand`) — either widen `TripPreviewBrand` with an optional `stripeStatus?: BrandStripeStatus` OR pass a sibling prop OR have `TripCreatorWizard` call `useCurrentBrand()`. SPEC picks; widening the type is the lowest-risk (additive, optional field).
4. **Onboarding route:** reuse `brandStripeOnboardingRoute(brandId)` (`paidPublishGuards.ts:106`) for the proactive CTA — same builder the reactive catches already use.
5. **Toast/button-disable:** per-wizard local wiring mirroring `EventCreatorWizard`'s `publishDisabled` + `handlePublishTap` toast; no shared abstraction needed.

---

## 8. Mismatch risk — client/server paid-detection parity (HARD requirement)

**The client "paid" detection MUST mirror the ORCH-1075 server detection per type, or the banner will disagree with the actual server block** — producing either a false-green (banner says "ready", server rejects on Publish — the exact ORCH-1075 dead-end the program is killing) or a false-block (banner nags about Stripe on a listing the server would happily publish). Per-type contract (all confirmed against migration `20260911000000_orch_1075_paid_publish_integrity_guards.sql`):

| Type | Server PAID predicate (canonical) | Required client mirror |
|---|---|---|
| **Event** | `EXISTS ticket_types WHERE available_online=true AND price_cents>0` (`business_publish_event_draft`, guard at migration L2148) | `draft.tickets.some(t => !t.isFree && (t.priceGbp ?? 0) > 0)` — already correct |
| **Trip** | `MAX(ticket_types.price_cents) WHERE available_online=true > 0` (`business_publish_trip_draft`, migration L2456-2468) | `round(parseFloat(step4Draft.priceMajor)*100) > 0` (single online tier) |
| **Experience** | `NOT is_free AND v_resolved_total > 0`, where resolved = whole_price OR Σ stop price_cents; ticket always `available_online=true` (`biz_publish_experience`, migration L874-884 + L928) | `!isFree && resolvedTotalMajor > 0` (whole OR per-stop sum) — `ExperienceCreatorWizard.tsx:278-288` already computes this |

**Stripe-readiness parity:** the client's `stripeStatus === "active"` is the EXACT mirror of the server's `pg_brand_can_charge()` (migration L65-78: attached `stripe_connect_accounts.charges_enabled = true`), because `deriveBrandStripeStatus` returns `"active"` iff `charges_enabled === true` (`deriveBrandStripeStatus.ts:57`). **Caveat for SPEC:** `pg_brand_can_charge` reads the SOURCE column `stripe_connect_accounts.charges_enabled` (detached_at IS NULL), whereas `brand.stripeStatus` from the `mapBrandRowToUi` cache path may read the denormalized `brands.stripe_charges_enabled` cache. The migration header (L14-16) deliberately reads the SOURCE to avoid stale-cache disagreement. SPEC should require the banner to read a freshly-settled status (the `useBrandStripeStatus` hook reads the live `stripe_connect_accounts` row) OR accept the cache as a UX-only proactive hint with the server guard as the canonical fail-close (the reactive ORCH-1075 catch already covers the residual cache-staleness window — so a false-green from a stale cache still fails closed at the RPC, never reaching a buyer). This is the one parity nuance SPEC must rule on.

**Edge cases the mirror must respect (or the banner disagrees):**
- **Draft saves are EXEMPT server-side** (`p_publish=false` skips all guards). The proactive banner must only block PUBLISH, never "Save as draft" (experience) or draft autosave.
- **In-person-only paid is EXEMPT** server-side (`available_online=false`). Trip/experience tickets are always online (`available_online=true`), so this exemption is moot for them — but if a future type sets in-person-only, the client mirror must match.
- **Free is exempt** — all three client mirrors already gate on `!isFree`/`>0`.
- **Past-date (Guard B)** is a SEPARATE server reason (`offering_date_past`) — Stream B's banner is scoped to Stripe-readiness (Guard A). SPEC should decide whether the proactive banner also surfaces past-date proactively (the reactive catches already handle it). Recommend Stripe-only for the banner; leave past-date reactive unless SPEC widens.

---

## 9. Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | MEMORY `project_orch_1073_paid_publish_integrity_guards` + `project_orch_1075` register the publish-time fail-close. No doc claims trips/experiences have proactive banners. Consistent with code. |
| **Schema** | ORCH-1075 migration (latest toucher of all 4 publish RPCs, grep-all confirmed) defines `pg_brand_can_charge` + per-type paid predicates. Source = `stripe_connect_accounts.charges_enabled`. |
| **Code** | Event Step 7 has the proactive triad (banner + disabled button + toast). Trip review + experience wizard have ONLY reactive catches. Confirmed file:line above. |
| **Runtime** | Not exercised (code-audit-only dispatch; no UI bug to repro). Behavior inferred from full source read + migration. |
| **Data** | N/A (no data query needed for a pattern-parity map). The ORCH-1075 header cites the live Lantern & Vine incident as the motivating data point. |

No layer contradicts another. The gap is purely a missing proactive UI on two of three types.

---

## 10. Blast radius

- **Surfaces touched by Stream B:** Business iOS + Business Android + Business web preview (the wizards are shared RN). Trip create (`app/trip/[id]/edit.tsx`), experience create/live-edit (`ExperienceCreatorWizard`), optionally trip/experience edit-to-paid. NOT consumer, NOT admin, NOT buyer-anon web (those don't author offerings).
- **Shared-primitive extraction risk:** if `StripeBlockedCard` is extracted from `CreatorStep7Preview.tsx`, the event Step 7 import must repoint — a same-PR refactor, low risk, covered by the existing event Step 7 render tests.
- **`TripPreviewBrand` widening risk:** the type is also consumed by the public `/t/{slug}` route (`TripPreview.tsx` is anon-tolerant). Adding an OPTIONAL `stripeStatus?` is additive and the public page simply won't pass it — safe.
- **Invariant:** must NOT regress the ORCH-1075 server fail-close (the banner is additive UX in front of it; the RPC stays canonical). Must NOT touch `businessTodos.ts` `connect_stripe` (§5).

---

## 11. Discoveries for orchestrator

- **D-1 (scope decision):** Even the EVENT edit-to-paid screen (`EditPublishedScreen.tsx`) has NO proactive banner — only the reactive ORCH-1075 catch. So "edit-to-paid parity" is ambiguous: matching events means trips/experiences edit screens stay reactive (they already are). A proactive edit-to-paid banner would be a NEW pattern beyond event parity. SPEC/orchestrator must rule whether edit-to-paid proactive banners are in Stream B scope or deferred.
- **D-2 (parity nuance):** `brand.stripeStatus` from the brand-list cache (`mapBrandRowToUi`) reads the denormalized `brands.stripe_charges_enabled`, while the server guard reads the SOURCE `stripe_connect_accounts.charges_enabled`. SPEC must decide whether the banner reads the live `useBrandStripeStatus` row or accepts the cache (with the server guard as the fail-close). Not a blocker — the reactive catch covers the residual window — but SPEC should state it explicitly.
- **D-3 (experience structural gap):** the experience wizard has no review/preview step, so the banner has no natural "final preview" home like events (Step 7) and trips (review pane). SPEC must pick the mount point (Pricing step, Cover step, or above the Publish button).
- **D-4 (no new ORCH needed):** all reuse pieces exist (`StripeBlockedCard`, `brandStripeOnboardingRoute`, `useCurrentBrand`, the per-type paid resolvers). Stream B is purely additive UI wiring + one shared-component extraction.

---

## 12. Fix strategy (direction only — SPEC writes the contract)

1. Extract `StripeBlockedCard` → shared `<PublishStripeBlockedCard onConnectStripe>` (or equivalent) under `src/components/offering/`.
2. Add a pure helper `offeringNeedsStripeToPublish({ isPaid, stripeStatus })` + per-type `isPaid` resolvers that EXACTLY mirror the server predicates in §8.
3. Trip: thread `stripeStatus` (widen `TripPreviewBrand` with optional field, or read `useCurrentBrand()` in the wizard); mount the banner in `TripCreatorStep5Review`; disable the dock Publish + add the blocking toast in `handlePublishTap`.
4. Experience: read `brand?.stripeStatus` (already present); mount the banner at the SPEC-chosen step; disable "Publish" (keep "Save as draft" enabled); pre-check in `handleSubmit(true)`.
5. Keep all existing reactive ORCH-1075 catches as the canonical fail-close (the banner is a proactive front-end of the same gate).
6. Do NOT touch `businessTodos.ts`.

---

## 13. Confidence

**HIGH.** Every pertinent file read in full (event Step 7 + validation + wizard; trip wizard + review + edit screen + route handlers + preview type; experience wizard; paidPublishGuards; businessTodos; deriveBrandStripeStatus; BrandOnboardView route). Server detection cross-checked against the ORCH-1075 migration with grep-all confirming it is the latest toucher of all four publish RPCs. The only open questions are deliberate SPEC decisions (D-1 edit scope, D-2 cache-vs-source, D-3 experience mount point), not unverified facts.
