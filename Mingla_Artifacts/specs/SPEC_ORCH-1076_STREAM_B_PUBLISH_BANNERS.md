# SPEC — ORCH-1076 Stream B [business-app proactive publish banners]

**Mode:** mingla-forensics SPEC (contract only — no code).
**Date:** 2026-06-04.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`.
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1076_STREAM_B_PUBLISH_BANNERS.md` (HIGH confidence; every file read in full, server predicates cross-checked against the ORCH-1075 migration).
**Server fail-close (canonical, already shipped):** `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` + `mingla-business/src/utils/paidPublishGuards.ts`. This SPEC is the PROACTIVE UI layer in front of that reactive guard — it never replaces it.
**Comms ledger:** read on entry. No BLOCK/WARN row is addressed to `mingla-forensics`+ORCH-1076 or requires action. COMMS-0003 (external-API docs inline) is N/A — this SPEC touches no external API, no migration, no edge function; it cites only existing INTERNAL server predicates (the ORCH-1075 migration) for parity.

---

## 0. One-paragraph summary

EVENTS already warn a brand "Stripe required for paid tickets — Connect Stripe to publish" BEFORE the brand taps Publish: a status card in the creator's final preview (Step 7), a disabled Publish button, and a blocking toast on Publish-tap. TRIPS and EXPERIENCES have no such proactive warning — they are only blocked REACTIVELY, after the brand taps Publish and the ORCH-1075 server RPC rejects. Stream B gives trips and experiences the SAME proactive triad (banner + disabled Publish + blocking toast) by (a) extracting the event's private `StripeBlockedCard` into ONE shared primitive that all three offering types consume, (b) adding per-type `isPaid` resolvers that EXACTLY mirror the ORCH-1075 server paid predicates so the banner can never disagree with the server block, and (c) wiring each create wizard to show the banner, disable Publish, and toast on tap when the offering is paid and the brand's Stripe is not active. Scope is the CREATE wizards only (matching where events have it); edit-to-paid flows keep the existing reactive ORCH-1075 catch. No migration, no edge function, pure-JS — rides the next business-app build/OTA.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 In scope (LOCKED)

1. **Shared `StripeBlockedCard` primitive** extracted to `mingla-business/src/components/offering/StripeBlockedCard.tsx`, consumed by event Step 7, trip review (Step 7), and the experience wizard. Event Step 7 switches to it as a **pure, byte-identical refactor** (same look, same copy, same behavior).
2. **Per-type `isPaid` resolvers** + a shared `offeringNeedsStripeToPublish` predicate in `mingla-business/src/components/offering/publishStripeReadiness.ts`, each mirroring the ORCH-1075 SERVER paid predicate EXACTLY (§4).
3. **Trip create wizard** (`TripCreatorWizard` + `TripCreatorStep5Review`): banner in the review pane, disabled Publish in the dock, blocking toast on Publish-tap. Thread `stripeStatus` from the route handler (widen `TripPreviewBrand`).
4. **Experience create wizard** (`ExperienceCreatorWizard`): banner on the FINAL step (Cover, step 5) directly above the Publish CTA AND inline on the Pricing step (step 4); disabled Publish (keep "Save as draft" enabled); blocking toast pre-check in `handleSubmit(true)`. `brand.stripeStatus` already available via `useCurrentBrand()`.
5. **Characterization test** locking event Step 7 behavior byte-identical across the refactor + the per-type parity truth-table tests (§9).

### 1.2 Non-goals (LOCKED — do NOT do these)

- **N-1. No proactive banner on ANY edit-to-paid screen** (`EditPublishedTripScreen`, the experience live-edit branch of `ExperienceCreatorWizard`, or the event `EditPublishedScreen`). D-1 below locks this: even the EVENT edit screen has no proactive banner today; adding one to trip/experience edit would EXCEED event parity. Edit-to-paid keeps the existing reactive ORCH-1075 catch unchanged. A future ORCH may unify edit if desired.
- **N-2. Do NOT touch `businessTodos.ts` `connect_stripe`** — the brand-level to-do row already covers all three offering types (§5 of the investigation). It is complementary, not overlapping.
- **N-3. Do NOT change, weaken, or remove the reactive ORCH-1075 server guard or `paidPublishGuards.ts`** — it stays the canonical fail-close. The banner is additive UX in front of it.
- **N-4. No new readiness source.** Do NOT add a new `useBrandStripeStatus` read or a fresh `stripe_connect_accounts` query for the banner. Use the existing UI value `brand.stripeStatus` (D-2).
- **N-5. No past-date (`offering_date_past`) proactive surfacing.** Stream B's banner is Stripe-readiness only (Guard A). Past-date stays reactive via the existing catches. (Past-date is a separate, additive concern an operator can re-open later.)
- **N-6. No migration, no edge function, no RPC change, no DB read.** Pure-JS client UI.
- **N-7. No new visual design.** Reuse the existing event `StripeBlockedCard` look exactly (D-3 reuses the same component). Only the copy STRINGS differ per type (§6).

### 1.3 Assumptions (proven in the investigation)

- **A-1.** `brand.stripeStatus === "active"` ⇔ server `pg_brand_can_charge()` (`charges_enabled = true`), because `deriveBrandStripeStatus.ts:57` returns `"active"` iff `charges_enabled === true`. The residual cache-staleness window (cache reads denormalized `brands.stripe_charges_enabled`; server reads SOURCE `stripe_connect_accounts.charges_enabled`) is covered by the reactive ORCH-1075 catch — a false-green from a stale cache still fails closed at the RPC and never reaches a buyer. **D-2 rules this acceptable; the banner is a proactive UX hint, the RPC is the fail-close.** (Investigation §8.)
- **A-2.** `app/trip/create.tsx` only redirects to `/trip/{clientId}/edit`; the real mount for BOTH new-trip and edit-trip is `app/trip/[id]/edit.tsx`, whose `currentBrand = useCurrentBrand()` (line 60) carries `stripeStatus` but DROPS it when building the narrow `TripPreviewBrand` (lines 198-204). (Investigation §2.4.)
- **A-3.** The experience wizard reads `const brand = useCurrentBrand()` (line 187) — full `Brand` with `stripeStatus` — so no threading needed there. (Investigation §3.4.)
- **A-4.** Draft saves are server-exempt (`p_publish=false` skips all guards). The banner must block PUBLISH only — never "Save as draft" (experience) nor draft autosave (trip/event). (Investigation §8.)

---

## 2. Cross-Surface Impact (MANDATORY)

The three creator wizards are shared React Native components rendered identically on iOS, Android, and the business web preview. Parity is **automatic** (shared code) for the banner, the resolver, and the disabled-button logic; the only manual angle is per-platform on-device QA (orchestrator+operator's later step, per the dispatch).

| # | Surface | Covered? | User-visible behavior this SPEC demands | Files touched here | Parity |
|---|---------|----------|------------------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | — | — | Consumer app does not author offerings. |
| 2 | Consumer Android (`app-mobile/`) | NO | — | — | Same. |
| 3 | Buyer/anon Web (`mingla-business/` `/t/{slug}`, `/e/…`, `/checkout/…`) | NO | — | `TripPreview` widening is additive/optional; the public `/t/{slug}` route simply won't pass `stripeStatus`. | Anon buyers don't publish; they never see the banner. |
| 4 | Business iOS (`mingla-business/` on iOS) | **YES** | Paid trip/experience on a Stripe-inactive brand shows the StripeBlockedCard banner in the creator + a disabled Publish + a blocking toast on tap. Events unchanged (byte-identical). | §3 files | Shared RN — automatic with #5 + #7. |
| 5 | Business Android (`mingla-business/` on Android) | **YES** | Identical to #4. | §3 files | Automatic (shared code). |
| 6 | Admin Web (`mingla-admin/`) | NO | — | — | Admin doesn't render creator wizards. |
| 7 | Business Web preview (`mingla-business/` dev/web) | **YES** | Identical to #4. | §3 files | Automatic (shared code). |

Because parity across surfaces 4/5/7 is automatic (one shared component tree), success criteria are NOT split per-platform at the logic level; the per-surface on-device acceptance is captured as **SC-iOS / SC-Android** in §8 for the QA step.

---

## 3. Files touched

| # | File | Change | LOCKED/OPEN |
|---|------|--------|-------------|
| F-1 | `src/components/offering/StripeBlockedCard.tsx` (NEW) | Extract the event's private `StripeBlockedCard` (CreatorStep7Preview.tsx:221-248) into a shared primitive with props `{ title?: string; body?: string; ctaLabel?: string; onConnectStripe: () => void }`; defaults reproduce the event copy + look byte-identical. | LOCKED structure, OPEN internal polish |
| F-2 | `src/components/offering/publishStripeReadiness.ts` (NEW) | `offeringNeedsStripeToPublish({ isPaid, stripeStatus })` pure predicate + per-type `isPaid` resolvers (`eventDraftIsPaid`, `tripDraftIsPaid`, `experienceDraftIsPaid`) mirroring the ORCH-1075 server predicates (§4). | LOCKED |
| F-3 | `src/components/event/CreatorStep7Preview.tsx` | Delete the local `StripeBlockedCard` sub-component (lines 221-248) + its now-unused styles; import + render the shared F-1 with the event default copy. **Pure refactor — render output byte-identical.** | LOCKED |
| F-4 | `src/components/trip/TripPreview.tsx` | Widen `TripPreviewBrand` (lines 47-53) with optional `stripeStatus?: BrandStripeStatus | null`. Additive — public route passes nothing. | LOCKED |
| F-5 | `app/trip/[id]/edit.tsx` | Pass `stripeStatus: currentBrand.stripeStatus ?? null` into the `brand={{…}}` object (lines 198-204). | LOCKED |
| F-6 | `src/components/trip/TripCreatorStep5Review.tsx` | Add an optional `needsStripe: boolean` + `onConnectStripe: () => void` to `TripCreatorStep5ReviewProps`; render the shared F-1 banner (trip copy) ABOVE the `previewWrap`, below the existing reactive `publishError` banner, when `needsStripe`. | LOCKED placement, OPEN spacing within token grid |
| F-7 | `src/components/trip/TripCreatorWizard.tsx` | Compute `tripNeedsStripe = offeringNeedsStripeToPublish({ isPaid: tripDraftIsPaid(step4Draft), stripeStatus: brand.stripeStatus ?? null })`; pass `needsStripe` + an `onConnectStripe` (→ `router.push(brandStripeOnboardingRoute(trip.brandId))`) to F-6; disable the Step-7 dock Publish (`disabled={submitting || tripNeedsStripe}`, line ~1263); add a pre-check in `handlePublishTap` (line 825) that, when `tripNeedsStripe`, shows the blocking toast and does NOT open the confirm dialog. | LOCKED |
| F-8 | `src/components/experience/ExperienceCreatorWizard.tsx` | Compute `experienceNeedsStripe = offeringNeedsStripeToPublish({ isPaid: experienceDraftIsPaid({ isFree, resolvedTotalMajor }), stripeStatus: brand?.stripeStatus ?? null })` (NOT in live-edit mode). Render F-1 banner: (a) inline at the bottom of the Pricing step (step 4) body, (b) directly above the footer Publish CTA on the Cover step (step 5). Disable the `label="Publish"` button (line 873) when `experienceNeedsStripe` (keep `label="Save as draft"` enabled). Pre-check at the top of `handleSubmit(true)` (line 474): when `publish && experienceNeedsStripe`, set the blocking toast and `return` before the RPC. | LOCKED placement, OPEN inline-vs-card spacing |

No other files change. No test-locked file is touched except via the new characterization test in §9 (which is additive).

---

## 4. The per-type `isPaid` PARITY CONTRACT (HARD, LOCKED)

Each client `isPaid` resolver MUST be the exact boolean mirror of the ORCH-1075 server paid predicate for that type, so the banner can NEVER disagree with the actual server block (no false-green dead-end, no false-block nag). Server lines below are from `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql`.

### 4.0 Shared predicate

```
offeringNeedsStripeToPublish({ isPaid, stripeStatus }) := isPaid === true && stripeStatus !== "active"
```

`stripeStatus !== "active"` is the exact client mirror of `NOT pg_brand_can_charge()` (server **L65-78**: attached `stripe_connect_accounts` row, `detached_at IS NULL`, `charges_enabled IS DISTINCT FROM false`), because `deriveBrandStripeStatus.ts:57` returns `"active"` iff `charges_enabled === true`. `stripeStatus` of `null`/`undefined`/`"not_connected"`/`"onboarding"`/`"restricted"`/`"detached"` all read as "not active" → needs Stripe (fail-safe toward blocking, never toward a false-green).

### 4.1 EVENT

| | |
|---|---|
| **Server predicate** | `bool_or( availableAt IN ('online','both') AND NOT isFree AND round(price*100) > 0 )` over the about-to-write tickets → if true, require `pg_brand_can_charge`. (**L2133-2151**, the `business_publish_event_draft` Guard-A block; in-person-only paid `availableAt='door'` is EXEMPT.) |
| **Client mirror (existing, unchanged)** | `draft.tickets.some(t => !t.isFree && (t.priceGbp ?? 0) > 0)` — already in `draftEventValidation.ts:81-83` / `542-544`. Event tickets in the draft are online-sellable by construction here, so the `availableAt` clause is satisfied. `eventDraftIsPaid(draft)` simply re-exposes this so all three types share the resolver namespace; `computePublishability` keeps its existing inline copy (no behavior change). |

### 4.2 TRIP

| | |
|---|---|
| **Server predicate** | `max(tt.price_cents) WHERE tt.deleted_at IS NULL AND tt.available_online = true > 0` over the trip's pricing tiers → if true, require `pg_brand_can_charge`. (**L2454-2473**, `business_publish_trip_draft` Guard-A block.) |
| **Client mirror (NEW)** | `tripDraftIsPaid(step4Draft) := Math.round((parseFloat(step4Draft.priceMajor) || 0) * 100) > 0`. The trip wizard has a SINGLE online-sellable tier (`step4Draft.priceMajor`, the value written into `ticket_types.price_cents` with `available_online=true` — confirmed at `TripCreatorWizard.tsx:516,530,559,601`). `(parseFloat ‖ 0)` matches the wizard's own price parsing; the `round(*100) > 0` matches the server's cents comparison. |

### 4.3 EXPERIENCE

| | |
|---|---|
| **Server predicate** | `v_resolved_total := is_free ? 0 : whole ? whole_price_cents : Σ stop price_cents`; guard fires on `p_publish AND NOT v_is_free AND v_resolved_total > 0` → require `pg_brand_can_charge`. The single experience ticket is always `available_online=true`. (**L301-313 + L356-360** for `biz_publish_experience` create-path; **L874-884 + L928-930** for the `biz_update_live_experience` twin.) |
| **Client mirror (NEW)** | `experienceDraftIsPaid({ isFree, resolvedTotalMajor }) := !isFree && resolvedTotalMajor > 0`. `resolvedTotalMajor` is already computed in the wizard (`ExperienceCreatorWizard.tsx:278-288`): `isFree ? 0 : whole ? parseFloat(wholePriceMajor) : Σ parseFloat(stop.priceMajor)` — the exact major-units mirror of the server's `v_resolved_total` across BOTH pricing modes. |

### 4.4 Parity edge cases the resolvers MUST respect (LOCKED)

- **Draft-exempt:** the resolver feeds the PUBLISH gate only. "Save as draft" (experience), draft autosave (all), and the trip wizard's non-publish steps never disable on `needsStripe`. (Server `p_publish=false` is exempt.)
- **Free-exempt:** every resolver returns `false` when free (`!isFree` / price 0). Banner hidden, Publish enabled.
- **In-person-only:** moot for trips/experiences (their single ticket is always `available_online=true`); the event mirror already honors `availableAt`. Do not add an in-person path the current types don't have.
- **Active-exempt:** `stripeStatus === "active"` → `needsStripe=false` regardless of paid-ness. Banner hidden, Publish enabled.

---

## 5. The 3 LOCKED decisions (orchestrator-approved defaults)

### D-1 — Edit-to-paid scope: PROACTIVE banner is CREATE-wizards only. **LOCKED.**
**Decision:** the proactive banner ships on the trip + experience CREATE wizards (trip review Step 7 = the create preview; experience Cover step 5 + Pricing step 4 = create flow). Edit-to-paid flows (`EditPublishedTripScreen`, `ExperienceCreatorWizard` live-edit branch) KEEP the existing reactive ORCH-1075 catch unchanged — no proactive banner.
**Rationale:** events have the proactive banner ONLY in the create wizard's Step-7 preview; even the event `EditPublishedScreen` is reactive-only (Investigation §4.1). Adding a proactive banner to trip/experience edit would EXCEED event parity and introduce a NEW pattern events don't have. Stream B's mandate is "the SAME guidance events already have," so it matches events exactly: proactive on create, reactive on edit. A future ORCH can unify edit across all three if desired.

### D-2 — Cache vs source: use existing `brand.stripeStatus === "active"`. **LOCKED.**
**Decision:** the banner reads the existing UI value `brand.stripeStatus` (from `useCurrentBrand()` / `deriveBrandStripeStatus`, which already derives from the `stripe_connect_accounts` SOURCE on the full-load path and from the `brands.stripe_*` cache on the list path) — IDENTICAL to what events use (`CreatorStep7Preview.tsx:82`, `EventCreatorWizard.tsx:315`). No new readiness read, no new hook call, no fresh `stripe_connect_accounts` query.
**Rationale:** events already prove this value is correct enough for a proactive hint. The residual cache-staleness window (cache may briefly read `"active"` after a true detach) is covered by the canonical server fail-close: a false-green still fails closed at the ORCH-1075 RPC and never reaches a buyer (Investigation §8 / A-1). Introducing a parallel readiness read would create a second source of truth (constitution rule "one owner per truth" risk) and diverge from events for no buyer-safety gain.

### D-3 — Experience banner mount: FINAL step above Publish + inline on Pricing. **LOCKED.**
**Decision:** the experience wizard has no review step, so mount the shared banner (a) on the FINAL step (Cover, step 5) directly above the footer Publish CTA, AND (b) inline at the bottom of the Pricing step (step 4) so the brand sees it the moment they set a price. The disabled-Publish + blocking toast also live on the final step's Publish action.
**Rationale:** the Cover step is the last gate before Publish — the closest structural analog to the event Step-7 preview and the trip review pane (where the banner sits adjacent to the Publish button). Surfacing it ALSO on Pricing gives the brand the warning at the exact moment of cause (setting a non-zero price), shortening the time-to-understand. Both mounts render the same shared primitive; no extra visual design.

---

## 6. Copy contract (LOCKED strings)

The shared `StripeBlockedCard` defaults reproduce the EVENT copy byte-for-byte (so the event refactor is identity). Trip + experience pass their own title/body but reuse the event CTA pattern. The proactive CTA routes to the same `brandStripeOnboardingRoute(brandId)` builder the reactive catches use (`paidPublishGuards.ts:106`).

| Type | Banner title | Banner body | CTA label | Blocking toast (on Publish-tap) |
|------|--------------|-------------|-----------|----------------------------------|
| **Event** (default — unchanged) | `Stripe required for paid tickets` | `Connect Stripe to publish. Free tickets can be published any time.` | `Connect Stripe` | `Connect Stripe to publish paid tickets.` |
| **Trip** | `Stripe required for paid trips` | `Connect Stripe to publish this paid trip. Free trips can be published any time.` | `Finish Stripe setup` | `Connect Stripe to publish this paid trip.` |
| **Experience** | `Stripe required for paid experiences` | `Connect Stripe to publish this paid experience. Free experiences can be published any time.` | `Finish Stripe setup` | `Connect Stripe to publish this paid experience.` |

Notes:
- The event default CTA label stays `Connect Stripe` (byte-identical refactor — do NOT change it to "Finish Stripe setup").
- Trip/experience use `Finish Stripe setup` to align with the reactive guard's locked `actionLabel` (`paidPublishGuards.ts:51`) — consistent wording for the new surfaces, without disturbing the event identity.
- All copy is Mingla voice: plain, second-person, no jargon, names the exact unblock. No emojis. (Voice ref: `mingla-product/references/canonical-voice.md`.)

---

## 7. Visual & UX contract

### 7.1 Banner (shared `StripeBlockedCard`) — LOCKED (reuse, no new design)

The shared primitive reproduces the existing event `StripeBlockedCard` exactly (CreatorStep7Preview.tsx:225-248 + the `warnCard`/`statusRow`/`statusTitle`/`statusSub`/`connectStripeBtn`/`connectStripeLabel` styles, lines 369-391). No token, color, spacing, radius, icon, or typography value changes. Specifically pinned (carried over verbatim):

- **Container:** `GlassCard variant="base" padding={spacing.md}` with `style={warnCard}` (`borderColor: accent.border`, `borderWidth: 1`).
- **Row:** `flexDirection:"row"`, `alignItems:"flex-start"`, `gap: spacing.sm`; leading `Icon name="flag" size={20} color={accent.warm}`.
- **Title:** `typography.bodySm.fontSize`, `fontWeight:"600"`, `color: text.primary`.
- **Body:** `typography.caption.fontSize`, `color: text.secondary`, `marginTop: 2`, `lineHeight: typography.caption.lineHeight * 1.4`.
- **CTA:** `Pressable` → `connectStripeBtn` (`marginTop: spacing.md`, row, centered, `gap: 4`, `paddingVertical: spacing.sm`, `paddingHorizontal: spacing.md`, `borderRadius: radius.md`, `overflow:"hidden"`, `backgroundColor: accent.tint`, `borderColor: accent.border`) + label `connectStripeLabel` (`typography.bodySm.fontSize`, `fontWeight:"600"`, `color: accent.warm`) + trailing `Icon name="chevR" size={14} color={accent.warm}`.
- **Accessibility:** CTA keeps `accessibilityRole="button"` + `accessibilityLabel` set to the CTA label string.
- **Contrast:** unchanged from the shipped event card (already in production). Implementor must not regress; tester verifies `accent.warm` on `accent.tint` and title/body on the glass base meet ≥ 4.5:1 body / ≥ 3:1 large via the existing tokens. (These are the SAME tokens already shipped on events, so this is a non-regression check, not a new computation.)

### 7.2 Placement per surface — LOCKED

- **Event Step 7:** unchanged — banner in the `statusCardWrap` slot (CreatorStep7Preview.tsx:152-164), only when `publishability.status === "blocked-stripe"`.
- **Trip review (Step 7):** banner rendered in `TripCreatorStep5Review` between the reactive `publishError` banner (lines 60-68) and `previewWrap` (line 70). When BOTH a `publishError` and `needsStripe` are present, both render (reactive error above, proactive Stripe banner below) — they describe different things and must not suppress each other. Banner top margin = `spacing.md` (matches the existing review spacing rhythm). 🎨 OPEN: exact vertical gap within the `spacing.sm`–`spacing.md` band.
- **Experience Pricing step (4):** banner at the BOTTOM of the `ExperiencePricingStep` body region (after the pricing inputs, inside the same `ScrollView`), `marginTop: spacing.md`. 🎨 OPEN: inline card vs. full-width within content padding.
- **Experience Cover step (5):** banner directly ABOVE the footer Publish CTA. Because the footer is a fixed `View` outside the `ScrollView`, mount the banner at the bottom of the Cover step's scroll body (so it scrolls with content and sits visually above the dock) OR in a thin wrapper directly above the footer button row — implementor picks the cleaner of the two as long as it reads as "attached to Publish." 🎨 OPEN: which of the two mounts; LOCKED: it must be visible without scrolling past the Publish button on a 390pt screen when the brand is on the Cover step.

### 7.3 Disabled Publish + toast — LOCKED

- **Disabled state:** when `needsStripe`, the Publish button uses the existing `Button` `disabled` prop (trips: dock Publish; experiences: footer Publish). The button's standard disabled styling (reduced opacity, no press feedback) applies — NO new disabled visual. The trip dock keeps `Back` enabled; the experience footer keeps `Save as draft` enabled.
- **Toast:** the blocking toast uses each wizard's existing toast mechanism (trip: `handleShowToast` equivalent / experience: `setToast(...)`, `kind="error"`). On a disabled button, tap is swallowed natively — so the toast fires from the explicit pre-check path: trips via `handlePublishTap` (since the dock Publish, even if disabled, should also surface the toast if reached programmatically), experiences via `handleSubmit(true)`'s top pre-check. Because the button is `disabled`, the PRIMARY discoverability is the visible banner; the toast is the belt-and-suspenders confirmation matching the event flow (`EventCreatorWizard.tsx:516-523`).
- **No haptics added** (events don't add one here; keep parity).

### 7.4 No-AI-slop (LOCKED)

No new gradients, no stock/AI imagery, no emoji icons, no decorative effects. The only iconography is the existing `flag` + `chevR` glyphs already in the event card. References examined: the shipped event `StripeBlockedCard` (Mingla's own production component) + Stripe Connect onboarding-prompt patterns (inline status card + single primary CTA, per `stripe-best-practices`/Stripe Connect embedded UX). This surface intentionally reuses Mingla's existing premium pattern; no fresh visual design is warranted.

### 7.5 🎨 OPEN (handed to the implementor's craft)

- Exact vertical gap of each banner within the `spacing.sm`–`spacing.md` token band.
- Which of the two valid Cover-step mounts (bottom-of-scroll vs. above-footer-wrapper) reads cleaner.
- Whether the Pricing-step banner is full-content-width or inset to match the pricing card — either is acceptable as long as it uses grid tokens and aligns with neighbors.
- Internal prop ergonomics of the shared `StripeBlockedCard` (e.g. a `tone` prop vs. plain copy props) — as long as the event default render is byte-identical and the three call sites stay terse.

---

## 8. Success Criteria

Observable, testable, unambiguous. "Active" below = `brand.stripeStatus === "active"`.

| ID | Criterion |
|----|-----------|
| SC-1 | **Event refactor identity.** With the shared primitive in place, event Step 7 renders the StripeBlockedCard with title "Stripe required for paid tickets", body "Connect Stripe to publish. Free tickets can be published any time.", CTA "Connect Stripe" → `onConnectStripe`, for a paid event on a non-active brand — byte-identical to before. No event behavior changes. |
| SC-2 | **Trip banner shows.** A trip with `priceMajor` > 0 on a non-active brand shows the trip StripeBlockedCard in the review (Step 7), with the trip copy (§6) and CTA routing to `brandStripeOnboardingRoute(trip.brandId)`. |
| SC-3 | **Trip banner hidden when free.** A trip with `priceMajor` 0/empty shows NO banner; Publish enabled. |
| SC-4 | **Trip banner hidden when active.** A paid trip on an active brand shows NO banner; Publish enabled. |
| SC-5 | **Trip Publish disabled + toast.** When the trip banner is showing, the Step-7 dock Publish is disabled; a tap (or programmatic publish attempt) surfaces the toast "Connect Stripe to publish this paid trip." and does NOT open the publish confirm dialog. |
| SC-6 | **Experience banner shows.** A non-free experience with `resolvedTotalMajor` > 0 (whole OR per-stop sum) on a non-active brand shows the experience StripeBlockedCard inline on the Pricing step AND above the Publish CTA on the Cover step, with the experience copy (§6). |
| SC-7 | **Experience banner hidden when free.** `isFree=true` (or resolved total 0) shows NO banner; Publish enabled. |
| SC-8 | **Experience banner hidden when active.** A paid experience on an active brand shows NO banner; Publish enabled. |
| SC-9 | **Experience Publish disabled, draft enabled, toast.** When the experience banner shows, the footer "Publish" is disabled and "Save as draft" stays enabled; invoking publish surfaces "Connect Stripe to publish this paid experience." and returns before the `biz_publish_experience` RPC. |
| SC-10 | **Per-type parity truth-table.** `tripDraftIsPaid` / `experienceDraftIsPaid` / `eventDraftIsPaid` each return the EXACT boolean the corresponding ORCH-1075 server predicate would (§4 truth-table in §9). |
| SC-11 | **No edit-to-paid banner.** No proactive banner appears on `EditPublishedTripScreen` or the `ExperienceCreatorWizard` live-edit branch; their existing reactive ORCH-1075 catch is unchanged. |
| SC-12 | **Server fail-close intact.** The ORCH-1075 reactive catches still fire (toast + route) if a publish reaches the RPC and is rejected (e.g. a stale-cache false-green) — Stream B did not remove or weaken them. |
| SC-13 | **`businessTodos.ts` untouched** — the `connect_stripe` to-do row behavior is unchanged. |
| **SC-iOS** | On the iOS Business build, SC-1…SC-9 reproduce on the simulator/device: banners render with correct copy + tokens, Publish disabled state visible, toast fires, draft save still works. (orchestrator+operator on-device QA step.) |
| **SC-Android** | On the Android Business build, SC-1…SC-9 reproduce identically (shared RN). Verify the GlassCard opaque-fallback policy still renders the banner correctly on Android (per `project_android_glass_policy_opaque_fallback`). |

---

## 9. Test Cases (jest)

New/updated unit + component tests. Files: `src/components/offering/__tests__/publishStripeReadiness.test.ts` (resolvers + parity), `src/components/offering/__tests__/StripeBlockedCard.test.tsx` (primitive), `src/components/event/__tests__/CreatorStep7Preview.refactorParity.test.tsx` (event identity), plus trip/experience wizard render tests in their existing `__tests__` dirs.

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Shared predicate — paid + inactive | `{isPaid:true, stripeStatus:"onboarding"}` | `offeringNeedsStripeToPublish` → true | util |
| T-02 | Shared predicate — paid + active | `{isPaid:true, stripeStatus:"active"}` | false | util |
| T-03 | Shared predicate — free | `{isPaid:false, stripeStatus:"not_connected"}` | false | util |
| T-04 | Shared predicate — null status | `{isPaid:true, stripeStatus:null}` | true (fail-safe to block) | util |
| T-05 | Trip resolver truth-table | `priceMajor` ∈ {"", "0", "0.00", "0.005", "10"} | false,false,false,**false (rounds to 0)**,true — mirrors `round(price*100)>0` | util |
| T-06 | Experience resolver — whole | `{isFree:false, pricingMode:"whole", resolvedTotalMajor:25}` | true | util |
| T-07 | Experience resolver — per-stop sum | per-stop prices [10, 0, 5] → `resolvedTotalMajor:15` | true | util |
| T-08 | Experience resolver — free overrides price | `{isFree:true, resolvedTotalMajor:0}` | false | util |
| T-09 | Experience resolver — per-stop all zero | sum 0 | false | util |
| T-10 | **Parity vs server (trip)** | a table of `priceMajor` → assert the resolver matches a fixture of the server predicate `max(price_cents)>0` for the same cents | match for every row | util (parity) |
| T-11 | **Parity vs server (experience)** | a table of `{is_free, pricing_mode, prices}` → assert the resolver matches `NOT is_free AND v_resolved_total>0` | match for every row | util (parity) |
| T-12 | **Parity vs server (event)** | tickets table → assert `eventDraftIsPaid` matches `bool_or(online AND !free AND round(price*100)>0)` | match | util (parity) |
| T-13 | Shared card default render = event copy | render `<StripeBlockedCard onConnectStripe>` | title "Stripe required for paid tickets" + body + CTA "Connect Stripe" present | component |
| T-14 | Shared card custom copy | render with trip props | trip title/body/CTA present; `onConnectStripe` fires on CTA press | component |
| T-15 | **Event Step 7 refactor identity** | paid event, non-active brand | Step 7 shows the event StripeBlockedCard with unchanged strings + CTA wired to `onConnectStripe` (characterization snapshot of the rendered card) | component |
| T-16 | Event Step 7 ready (free) | free-only event | ReadyCard, no Stripe banner (unchanged) | component |
| T-17 | Trip review banner shows | paid trip, `stripeStatus:"not_connected"`, `needsStripe:true` | `TripCreatorStep5Review` renders the trip banner above the preview | component |
| T-18 | Trip review banner hidden | `needsStripe:false` | no banner | component |
| T-19 | Trip Publish disabled | wizard with paid trip + inactive brand | Step-7 dock Publish `disabled`; `handlePublishTap` does NOT open confirm dialog and shows the trip toast | component |
| T-20 | Experience Publish disabled / draft enabled | paid experience + inactive brand on Cover step | footer "Publish" disabled, "Save as draft" enabled | component |
| T-21 | Experience publish pre-check | `handleSubmit(true)` with `experienceNeedsStripe` | toast set, `biz_publish_experience` NOT called (mock asserts 0 calls) | component |
| T-22 | Experience draft bypasses gate | `handleSubmit(false)` with `experienceNeedsStripe` | RPC called with `p_publish:false`; no Stripe toast | component |
| T-23 | Edit-to-paid no banner | render `EditPublishedTripScreen` / experience live-edit | no proactive StripeBlockedCard; reactive catch path unchanged | component |
| T-24 | Reactive catch still fires | mock RPC reject `stripe_charges_disabled` | existing toast + route fires (regression) | component |

**Implementor happy-path angle:** verify SC-2/SC-6 (banner appears for the canonical paid-on-inactive case) on the sim before claiming done.
**Tester adversarial angle:** the `0.005`/rounding row (T-05), the per-stop sum vs whole divergence (T-06/T-07), the free-overrides-price row (T-08), the stale-cache false-green path (T-24 — banner hidden but RPC still blocks), and the BOTH-banners trip case (reactive `publishError` + proactive Stripe banner co-render, SC-2 + existing review behavior). Adversarial must also confirm the event refactor changed ZERO rendered bytes (T-15 snapshot diff = empty).

---

## 10. Invariants

| ID | Invariant | How preserved | Verifying test |
|----|-----------|---------------|----------------|
| INV-1 (NEW) | **Client paid-detection mirrors the ORCH-1075 server predicate per type.** The banner can never disagree with the server block. | Per-type resolvers in `publishStripeReadiness.ts` mirror §4 exactly; parity tests pin the truth-tables. | T-10/T-11/T-12 |
| INV-2 (preserve) | **Server fail-close is canonical (ORCH-1075).** The proactive banner is additive; the RPC guard + `paidPublishGuards.ts` catches remain the binding block. | N-3: do not touch the migration/guards; the reactive catches stay wired. | T-24, SC-12 |
| INV-3 (preserve) | **One owner per truth (readiness).** No second Stripe-readiness source introduced. | D-2: reuse `brand.stripeStatus`; no new hook/query. | code review + SC-12 |
| INV-4 (preserve) | **Drafts are never gated.** | Resolver feeds PUBLISH only; "Save as draft" + autosave unaffected. | T-22 |
| INV-5 (preserve) | **`businessTodos.ts` `connect_stripe` covers all 3 types — untouched.** | N-2. | SC-13 + diff check |
| INV-6 (preserve) | **Android glass = opaque fallback.** The shared GlassCard banner must render the Android opaque-fallback fill, not a translucent one. | Reuse the existing GlassCard variant (already policy-compliant). | SC-Android |
| INV-7 (preserve) | **`TripPreviewBrand` stays anon-tolerant.** Public `/t/{slug}` must not require `stripeStatus`. | F-4 adds it as OPTIONAL (`stripeStatus?`). | type-check + buyer-anon smoke |

No new server invariant (no DB change). INV-1 is the one new client invariant; recommend registering it in `INVARIANT_REGISTRY.md` at CLOSE as `I-OFFERING-PROACTIVE-STRIPE-BANNER-MIRRORS-SERVER` (DRAFT → ACTIVE on PASS).

---

## 11. Implementation order

1. **F-2** `publishStripeReadiness.ts` — pure resolvers + predicate first (no UI deps). Land with T-01…T-12.
2. **F-1** `StripeBlockedCard.tsx` — extract the primitive; land with T-13/T-14.
3. **F-3** Repoint event Step 7 to the shared primitive (pure refactor); land T-15/T-16 (identity snapshot) — this proves the extraction is byte-faithful BEFORE any new wiring.
4. **F-4 + F-5** Widen `TripPreviewBrand`; thread `stripeStatus` from `app/trip/[id]/edit.tsx`.
5. **F-6 + F-7** Trip review banner + wizard disabled-Publish + toast; land T-17…T-19.
6. **F-8** Experience Pricing + Cover banners + disabled Publish + pre-check; land T-20…T-22.
7. Regression: T-23 (no edit banner) + T-24 (reactive catch intact).

Order is dependency-correct: pure util → primitive → event-identity proof → trip → experience → regressions.

---

## 12. Regression prevention

- **Class of bug:** a proactive UI hint that DISAGREES with the server block (false-green dead-end = the exact ORCH-1075 failure this program is killing, or a false-block nag).
- **Structural safeguard:** the per-type `isPaid` resolvers live in ONE file (`publishStripeReadiness.ts`) with the server predicate lines cited in a header comment; the parity tests (T-10/T-11/T-12) fail if a resolver drifts from the server truth-table fixture.
- **Protective comment (required in `publishStripeReadiness.ts` header):** cite `20260911000000_orch_1075_…sql` L65-78 (`pg_brand_can_charge`), L2133-2151 (event), L2454-2473 (trip), L301-313/356-360 + L874-884/928-930 (experience) and state: "If the server predicate changes, update these resolvers + the parity fixtures in the SAME PR."
- **Event-identity guard:** T-15 snapshot pins the event card render; any accidental copy/token change in the shared primitive breaks it.
- **Strict-grep (optional, orchestrator's call):** a gate asserting the event `StripeBlockedCard` is imported from `offering/` (not redefined locally) would prevent a future re-fork of the primitive. Not required for CLOSE; flag for orchestrator.

---

## 13. Discoveries for orchestrator

- **DISC-1.** No existing jest test directly pins `computePublishability` → `"blocked-stripe"` or the event `StripeBlockedCard` render (the event behavior was only indirectly covered). The new T-15 characterization test (this SPEC) is the first explicit lock — recommend keeping it permanently as the refactor guard.
- **DISC-2.** `app/trip/create.tsx` is a pure redirect to `/trip/[id]/edit`; ALL trip authoring (new + edit) mounts through the edit route. The "create wizard" for trips is structurally the edit route in `isCreateMode`. The banner correctly rides there; just confirming the mount point is not `create.tsx`.
- **DISC-3.** The trip dock Publish (`TripCreatorWizard.tsx:1250-1267`) and experience footer Publish both already carry a `disabled` prop wired only to `submitting` — adding `|| needsStripe` is a one-token change with no new disabled visual.
- **DISC-4 (deferred, NOT in scope).** Past-date (`offering_date_past`, Guard B) is surfaced only reactively for all three types. A future ORCH could add a proactive past-date banner mirroring this pattern — out of Stream B (N-5).
- **DISC-5 (deferred, NOT in scope).** Edit-to-paid proactive banners across all three types (including events) would be a NEW unified pattern — a clean future ORCH if the operator wants edit parity (D-1 rationale).
- **DISC-6.** Register `I-OFFERING-PROACTIVE-STRIPE-BANNER-MIRRORS-SERVER` (INV-1) in `INVARIANT_REGISTRY.md` at CLOSE.

---

## 14. Confidence

**HIGH.** Every event/trip/experience source file, the trip route handler, the trip preview type, `paidPublishGuards.ts`, `deriveBrandStripeStatus.ts`, and the ORCH-1075 migration were read in full; all server paid predicates were located with exact line numbers and the client mirrors derived directly from them. The three open decisions are locked with the orchestrator-approved defaults + rationale. No external API, migration, or edge function is touched, so no provider-docs citation is required (COMMS-0003 N/A). The only residual nuance — cache-vs-source readiness — is explicitly ruled (D-2) and covered by the canonical server fail-close.
