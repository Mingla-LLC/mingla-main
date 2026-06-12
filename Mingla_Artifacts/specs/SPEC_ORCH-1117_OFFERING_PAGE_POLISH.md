# SPEC — ORCH-1117 · Public Offering Page UX/Design Polish

**Status:** SPEC complete — build-ready contract
**Author:** mingla-forensics (SPEC mode)
**Date:** 2026-06-11
**Source design:** `Mingla_Artifacts/specs/DESIGN_ORCH-1117_PUBLIC_OFFERING_PAGE_POLISH.md` (mingla-designer, APPROVED)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1117-[offering-page-polish]` on branch `ORCH-1117-offering-page-polish` (rebased on origin/main)
**Next phase:** mingla-implementor → mingla-tester → orchestrator CLOSE
**Hard merge-order dependency:** MUST merge AFTER ORCH-1116 (RLS fix to `pg_brand_can_charge`). See §2.4 + §10 OQ-D.

---

## 1. Executive summary

Four buyer-facing polish changes on the public/in-app offering view, applied with full cross-surface parity across six concrete surfaces (event/trip/experience × web/native):

1. **White-theme legibility** — on the theme-color-driven public event page, the date eyebrow (L583) and the recurrence "Show all" pill (L617) are hardcoded `#ffffff`; on a light brand theme they render white-on-near-white (invisible). Fix: take their color from the already-computed luminance-aware palette. Isolated to `packages/event-rendering/PublicEventPage.tsx` (renders BOTH the web event page AND the in-app experience detail). Other surfaces are fixed-dark → preventive rule only.
2. **Collapsible About** — the description block starts **collapsed by default** (3-line peek + chevron + "Read more"), expanding on tap. Standardizes the pattern that already exists on one native surface; rolls it out to all six.
3. **Floating Buy CTA** — a persistent bottom bar that is the primary buy action. Two top-level states: a tappable Buy button (routes to the **existing** checkout/cart) and a **non-tappable info strip** (when not bookable / sold out / ended / pre-sale / door-only). No dead taps (Constitution #1).
4. **Reduce title drop-shadow** — remove the heavy `0,2 / radius 10 / 28%-black` text shadow on the event title (L1349-1351); it reads as smudged on a light card and does no legibility work (the title sits on a solid surface). Other surfaces have no shadow → preventive rule only.

Plus one data-plumbing addition required by #3: thread a `bookable` flag onto the **public trip payload** (events + experiences already carry it) so the trip floating bar can render its unavailable state. This consumes `pg_brand_can_charge`, whose RLS is fixed by sibling **ORCH-1116** — hence the merge-order dependency.

**Locked product decisions (Seth, 2026-06-11 — baked in, resolve design OQ-2):**
- Floating "Buy ticket" on **multi-tier events** routes to the **existing checkout/cart page** (`router.push(checkoutPublicPath(event.id))` → `/checkout/{eventId}`, which lists all tickets) — NOT a tier-picker, NOT cheapest-tier auto-buy. The floating bar reuses the SAME navigation the inline ticket-row CTA already uses.
- On **single-ticket trips & experiences**, the inline Reserve / Get-my-spot CTA is **REMOVED entirely**; the floating bottom bar is the **only** CTA. (Multi-tier event inline ticket rows stay as-is.)

---

## 2. Scope & non-goals

### 2.1 In scope (the four changes + trip bookable plumbing, across six surfaces)

| Change | Applies to |
|--------|-----------|
| #1 legibility | EVT-WEB + EXP-NATIVE (shared file, real bug); preventive note for the four fixed-dark surfaces |
| #2 collapsible About | ALL six surfaces |
| #3 floating Buy CTA | ALL six surfaces |
| #4 title shadow | EVT-WEB + EXP-NATIVE (shared file, real bug); preventive note elsewhere |
| trip `bookable` plumbing | TRIP-WEB (hook) + the trip floating bar's unavailable state |

### 2.2 Non-goals (explicitly OUT — do not touch)

- **No money-engine change.** The floating bar reuses existing navigation / existing cart sheets / existing `ticket-checkout-create` and `pg_brand_can_charge`. Zero new payment code, zero fee recompute (WYSIWYP: read `priceAllInGbp`/`priceCents` as-is).
- **No new `bookable` computation for events/experiences.** They already resolve it (`resolveEventBookable`, `resolveBookable`). Only TRIP gains the resolver.
- **No change to `pg_brand_can_charge` itself** — that RLS fix is ORCH-1116's. ORCH-1117 only CONSUMES it for trips.
- **No auto-hide-on-scroll** for the floating bar (design §3.7 — future enhancement, out of scope).
- **No redesign of the inline multi-tier ticket rows** on EVT-WEB (they stay; the floating bar coexists and routes to `/checkout`).
- **No change to the external/Ticketmaster event detail** (`app-mobile/.../EventDetailLayout.tsx`) buy/CTA behavior — see §2.3 finding F-A. Its existing `aboutCollapsed` toggle is the reference for #2 only; it gets copy/chevron standardization, not a floating bar (it has no Mingla checkout — it deep-links an external ticket URL).
- **No `stickyFooter`-prop rerouting** of the native sheets (TRIP-NATIVE / EVT-NATIVE / EXP-NATIVE). See §2.3 finding F-B (HARD constraint — `stickyFooter` froze the gorhom scroll in ORCH-1016).

### 2.3 Investigation findings that bind this SPEC (read during SPEC ingest)

- **F-A — EVT-NATIVE `EventDetailLayout.tsx` is the EXTERNAL event detail, not a Mingla-brand offering.** It renders artist/genre/seat-map and its CTA opens an external ticket URL via browser; it already has `aboutCollapsed=useState(true)` at L72 + a 160-char threshold (the design's reference). The Mingla-brand consumer event/experience detail is the **shared `@mingla/event-rendering` `PublicEventPage`** hosted in `app-mobile/.../ExpandedBusinessEventSheet.tsx`. Therefore "EVT-NATIVE floating Buy bar" in the design maps to the **brand-event sheet** (`ExpandedBusinessEventSheet`), and `EventDetailLayout` gets ONLY the #2 copy/chevron standardization. Do not add a Mingla floating Buy bar to `EventDetailLayout`.
- **F-B — the native brand sheets use a BARE `scrollMode="scroll"` and MUST NOT be rerouted through `BaseBottomSheet`'s `stickyFooter` prop.** ORCH-1016 proved (on-device, measured) that a `stickyFooter`/header/wrapper makes gorhom size the sheet to content → viewport == content → `maxScroll=0` → frozen scroll. `ConsumerTripDetailScreen.tsx` already pins its Reserve bar as a **sibling second child of the bare scroll** (`{detailBody}{reserveFooter}`), NOT via `stickyFooter` (see its L459-465 comment). The native floating bar on EVT-NATIVE/EXP-NATIVE/TRIP-NATIVE MUST use this same proven sibling-at-end-of-scroll pattern, never `stickyFooter`.
- **F-C — the shared package deliberately has NO `Icon`, NO `safe-area-context`, NO `Animated`/`LayoutAnimation`.** It is self-contained with inline RN primitives + the local `GlassBlur`, and uses **text glyphs** (`×`, `↗`) for chrome. Therefore: (a) the collapsible-About chevron in the package is a **text glyph** (`⌄` collapsed / `⌃` expanded) consistent with existing package style, NOT an `Icon` import; (b) the floating Buy bar is NOT built inside the package (it needs safe-area + router + Icon) — it is built in the **host adapters/sheets** that already import those. The package gets #1, #2, #4 only.
- **F-D — EVT-WEB checkout navigation already lives in the adapter** (`mingla-business/.../PublicEventPage.tsx` `onBuyTicket` → `router.push(checkoutPublicPath(event.id))`, neutralized to a toast when `!bookable`). The web floating bar mounts in this adapter and reuses the SAME handler. This realizes the locked "one Buy action → the cart page that lists all tickets" decision with zero new routing.
- **F-E — TRIP-NATIVE already has a floating Reserve bar** (the `reserveFooter` sibling, disabled on bookings-closed). Change #3 on TRIP-NATIVE = upgrade that existing bar to the standardized contract (price-left/action-right anatomy already matches) + add the `bookable===false` unavailable state. It does NOT get a brand-new bar.
- **F-F — the public TRIP fetch is a HOOK with direct Supabase queries (`usePublicTripBySlug.ts`), NOT a `publicTripsService`.** The dispatch's "`resolveTripBookable` in `publicTripsService`" maps to: add the resolver + thread `bookable` into the hook's `PublicTripPayload`. (Event/experience resolvers live in `publicEventsService`/`publicExperienceService`; mirror their shape.)

### 2.4 ORCH-1116 merge-order dependency (HARD)

`bookable` for paid offerings = `pg_brand_can_charge(p_brand_id)`. ORCH-1116 fixes that RPC's **RLS so it returns the correct boolean for anonymous / non-owner buyers**. Before ORCH-1116 lands, the RPC under anon RLS returns the wrong value for non-owners → **every brand would false-gate** (or the fail-open masks it but the unavailable state never fires correctly). After ORCH-1116, the flag is correct.

**Therefore ORCH-1117 MUST merge AFTER ORCH-1116.** The implementor must NOT merge this branch until ORCH-1116 is on `main` and this branch is rebased on it. The resolvers fail OPEN on RPC error (page stays bookable; the checkout 409 is the terminal backstop) — this is the same contract as the event/experience resolvers and must be preserved so a transient RPC error never wrongly hides a bookable listing.

### 2.5 Assumptions

- The all-in price for the floating bar comes from existing server-computed fields only (`priceAllInGbp` events/exp via package data; `priceCents` trips/exp web). Never recompute fees.
- `useSafeAreaInsets()` is available in every host (it is — all adapters/screens already import it).
- The default Mingla theme (`#eb7825`) resolves `useDark=true` → no visible change for the common case under change #1/#4.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched | Parity |
|---|---------|----------|--------------------------------|---------------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | #1 (via shared pkg), #2 collapsible About (brand-event/exp sheet + trip screen + external-event layout), #3 floating Buy bar on brand-event/exp sheet + trip screen (sibling-at-end-of-scroll), #4 (via shared pkg) | `packages/event-rendering/PublicEventPage.tsx`; `app-mobile/.../ExpandedBusinessEventSheet.tsx`; `app-mobile/.../ConsumerTripDetailScreen.tsx`; `app-mobile/.../EventDetailLayout.tsx` (#2 copy/chevron only) | Shared pkg = automatic for #1/#2/#4 of the brand-event/exp body; native bar = MANUAL per host |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Same as iOS PLUS the Android opaque-glass fallback on every floating bar (solid ≥0.92 fill, clipped, no shadow) | Same files | MANUAL Android `Platform.select` branch per bar |
| 3 | **Buyer/anonymous Web** (`mingla-business/` `/e/…`, `/t/…`, `/exp/…`, `/checkout*`) | YES | #1 (event page), #2 collapsible About (event + trip + exp), #3 floating Buy bar (event adapter + trip route + exp route), #4 (event page); single inline Reserve/Get-spot **removed** on trip + exp | `packages/event-rendering/PublicEventPage.tsx`; `mingla-business/src/components/event/PublicEventPage.tsx`; `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`; `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`; `mingla-business/src/components/trip/TripCheckoutFlow.tsx`; `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx`; `mingla-business/src/components/trip/TripPreview.tsx`; `mingla-business/src/components/experience/ExperiencePreview.tsx`; `mingla-business/src/hooks/usePublicTripBySlug.ts`; `mingla-business/src/constants/publicUrls.ts` (add `experienceCheckoutPath` helper) | Event body via shared pkg automatic; trip/exp web bars MANUAL |
| 4 | **Business iOS** | NOT directly | Business app renders the SAME `mingla-business` web/native public components when previewing; no business-only authoring screen changes here | (inherits #3 surface files when business previews a public page) | Automatic via shared components |
| 5 | **Business Android** | NOT directly | Same as Business iOS + Android opaque fallback inherited from the shared bar | (inherits) | Automatic |
| 6 | **Admin Web** (`mingla-admin/`) | NOT covered | Admin has no public offering page | — | Reason: admin never renders the buyer offering view |
| 7 | **Business Web preview** (adjacent) | YES (inherited) | When a business user previews their own public event/trip/exp page in-app, they see the same polished page (legibility, collapsed About, floating bar). The floating bar's bookable state reflects their own brand's charge-readiness. | (inherits #3 surface files) | Automatic via shared components |

---

## 4. Layered specification

> **No database / edge-function / realtime layers are touched.** The only "backend-adjacent" change is consuming the existing `pg_brand_can_charge` RPC from the trip hook (read-only RPC call, already anon-granted). All work is service/hook/component.

### 4.0 The single source of truth — buy state machine (hoist, do not fork)

The floating bar's label + tappability + reason MUST be a **pure projection of the same state machine** already in `PublicTicketRow` (`PublicEventPage.tsx:944-982`) and the page banners — NOT a parallel copy.

**Contract:** introduce one pure helper, exported from the package, that both the inline row and the floating bar consume:

```
// packages/event-rendering/offeringCta.ts  (NEW small pure module)
export type CtaState =
  | { kind: "buy";       label: string; price: string; tappable: true  }
  | { kind: "free";      label: string;                tappable: true  }
  | { kind: "waitlist";  label: string;                tappable: true  }
  | { kind: "unavailable"; title: string; subline: string | null; tappable: false };

export const resolveOfferingCta(input: {
  variant: Variant; bookable: boolean; tickets: PublicTicketProps[]; currency: string;
}): CtaState
```

Precedence (mirrors the inline machine + adds the `bookable` gate FIRST):
`!bookable → unavailable("Booking unavailable", "The organizer is finishing payment setup.")` →
`variant==="past" → unavailable("Sales ended")` →
`variant==="pre-sale" → unavailable("On sale {countdown}")` →
`all door-only → unavailable("Pay at the door")` →
`all sold-out + any waitlist → waitlist("Join waitlist")` →
`all sold-out → unavailable("Sold out")` →
`any free, none paid → free("Get free ticket")` →
else `buy("Buy ticket", "From {minAllInPrice}")`.

The price uses the existing `formatTicketPrice` (all-in, never recomputed). "From" prefix when >1 visible non-free tier; bare price for single tier.

> The inline `PublicTicketRow` keeps its per-tier label (it is per-ticket); the floating bar uses the **page-level** projection above. Both import the same module so the gate logic (`bookable`, sold-out, ended, pre-sale, door) lives in ONE place. The implementor may refactor `PublicTicketRow`'s shared sub-predicates (`saleEnded`, `isSoldOutTicket`, `isDoorOnly`) into this module if it reduces duplication, but MUST NOT change `PublicTicketRow`'s existing per-tier behavior.

### 4.1 CHANGE #1 — White-theme legibility (`packages/event-rendering/PublicEventPage.tsx`)

The luminance machinery already exists (`createThemePalette`, `readableTextFor`, `contrastAdjustedAccent`, `contrastAdjustedForWhiteText` — L185-225). No new computation; the two offending literals just consume the palette.

**Rule R1 (codify in a guard comment):** No raw `#ffffff`/`#fff` on text that sits on a palette surface (`palette.page/card/glass/panel/accentWash`). The ONLY allowed white-on-X is `accentText` (`#ffffff`) on a guaranteed-dark fill (the accent button) — that pairing stays.

**Exact edits:**

| Anchor | Before | After | Why AA-safe |
|--------|--------|-------|-------------|
| L582-584 date line | `{ color: "#ffffff", fontFamily: theme.fontFamilyValue }` | `{ color: palette.accent, fontFamily: theme.fontFamilyValue }` | `palette.accent` passed `contrastAdjustedForWhiteText(…, 4.5)` ⇒ ≥4.5:1 as text on `page`; keeps the "orange uppercase eyebrow" identity |
| L616-617 recurrence pill label | `[styles.recurrencePillLabel, { color: "#ffffff" }]` | `[styles.recurrencePillLabel, { color: palette.primaryText }]` | pill bg is `accentWash` (thin wash over `page`) ⇒ effective bg ≈ `page` ⇒ `primaryText = readableTextFor(page)` is ≈19:1 |

`palette` is already in scope at both anchors (computed at `PublishedBody` L473). No prop threading.

**Per-surface delta:** EVT-WEB = the fix; EXP-NATIVE = inherits same file automatically; the four fixed-dark surfaces = no change (preventive R1 only — they never put theme-color text on a light surface).

**Resolved OQ-1:** date eyebrow = `palette.accent` (emphasis, the default that preserves today's look). Do NOT use `secondaryText`.

### 4.2 CHANGE #2 — Collapsible About (collapsed by default)

**Shared interaction contract (identical semantics on all six surfaces):**

- Header row: the section label ("About" web / "About" or description heading native) on the left, a **chevron glyph** on the right; the WHOLE row is one tap target, min 44×44.
- Collapsed (default): body clamped to `numberOfLines={3}`, `ellipsizeMode="tail"`; an affordance reading **"Read more"** in the accent color under the peek; chevron points DOWN (`⌄`).
- Expanded: full body (no clamp); affordance reads **"Show less"**; chevron points UP (`⌃`).
- **Short-copy exception:** if `description.length <= 160` (the existing EVT-NATIVE threshold), render full body + NO chevron + NO affordance (a toggle for 2 lines is noise).
- **Default = COLLAPSED on every surface** (for copy over the threshold).

**Motion:** toggle via `numberOfLines` swap (3 ↔ undefined). On native wrap the `setState` in `LayoutAnimation.easeInEaseOut(200)` for a 200ms height settle; on web the same `numberOfLines` swap via RN-web is acceptable (Framer height optional, not required). **Reduce-motion:** when `AccessibilityInfo.isReduceMotionEnabled()` (native) / `prefers-reduced-motion` (web), skip the `LayoutAnimation` call — instant toggle; chevron still flips (static).

> **Native-sheet caution (HARD, F-B):** EVT-WEB-in-app + EXP-NATIVE render inside the gorhom `BottomSheetScrollView`. Use the `numberOfLines`+`LayoutAnimation` approach (content-driven, no measured-height race) — do NOT animate a measured height inside the virtualized sheet scroll (can jump scroll position).

**A11y:** header row `accessibilityRole="button"`, `accessibilityState={{ expanded }}`, `accessibilityLabel="About"`, `accessibilityHint={collapsed ? "Expands the description" : "Collapses the description"}`. Chevron is decorative (`accessibilityElementsHidden`/`importantForAccessibility="no"`). State is signaled by BOTH the chevron rotation and the "Read more/Show less" word — never color alone.

**Per-surface contract:**

| Surface | File + anchor | Implementation |
|---------|---------------|----------------|
| EVT-WEB / EXP-NATIVE | `packages/event-rendering/PublicEventPage.tsx` About block L856-872 | Add `const [aboutCollapsed, setAboutCollapsed] = useState(true)` in `PublishedBody`. Replace the static About `<Text>` with: a pressable header row (`About` + text-glyph chevron `aboutCollapsed ? "⌄" : "⌃"`, chevron color `palette.tertiaryText`), the body `<Text numberOfLines={aboutCollapsed ? 3 : undefined}>`, and a "Read more"/"Show less" affordance (`palette.accent`). Apply the ≤160-char short-copy exception. Use the package text-glyph chevron (F-C) — NO Icon import. |
| TRIP-WEB | `mingla-business/src/components/trip/TripPreview.tsx` description block L163-167 | Wrap the `description` `<Text>` in the same collapsible pattern. TripPreview is dark-surface; chevron `rgba(255,255,255,0.52)`, affordance `accent.warm`. May use `Icon name="chevron-down"` here (business app HAS the Icon primitive). |
| EXP-WEB | `mingla-business/src/components/experience/ExperiencePreview.tsx` description block L125-128 | Same as TRIP-WEB. |
| EVT-NATIVE (external) | `app-mobile/.../EventDetailLayout.tsx` L331-356 | Already collapsed-by-default (`aboutCollapsed=useState(true)` L72, 160-char threshold L342). **Standardize ONLY:** copy → "Read more"/"Show less"; add the chevron glyph/Icon next to the toggle; keep its existing `numberOfLines`+threshold engine. Do not alter its CTA. |
| TRIP-NATIVE | `app-mobile/.../ConsumerTripDetailScreen.tsx` description L390-392 | Wrap the description `<Text>` in the collapsible pattern (dark-surface tokens). |

### 4.3 CHANGE #3 — Floating Buy CTA (per-surface, host-level)

**The bar is built per host (F-C), all consuming `resolveOfferingCta` (§4.0). It is NEVER built inside the package.** Recommended: one shared presentational component `FloatingOfferingBar` in **each app** (or a shared `packages/` primitive if the implementor prefers — but it needs `useSafeAreaInsets`, so it lives in app space, not `event-rendering`). Acceptable to implement it twice (business + app-mobile) given the divergent hosts; the STATE comes from the one shared `resolveOfferingCta`.

**Anatomy — bookable:** left = price block (`From {price}` micro-uppercase tertiary label + value 18-20/900 primary); right = accent action button (`Buy ticket`/`Get free ticket`/`Reserve my spot`/`Get my spot`), min height 56, radius `radius.lg`, label white 17/900, press `opacity 0.85`/scale 0.98 + Light haptic (native).

**Anatomy — unavailable (NON-tappable, no dead taps, Constitution #1):** an info strip, `accessibilityRole` NOT "button", NO `onPress`. `ⓘ` glyph + title ("Booking unavailable" / "Sold out" / "Sales ended" / "On sale {countdown}" / "Pay at the door") + optional subline ("The organizer is finishing payment setup."). Fill `palette.panel`/quiet, NOT accent.

**Placement / safe-area / glass:**

| Property | Value |
|----------|-------|
| Web/route | `position:absolute, left:0, right:0, bottom:0`, above scroll content; inner content `maxWidth:660, alignSelf:center` (matches body column) |
| Native sheet (EVT/EXP) | **sibling at the END of the bare `scrollMode="scroll"` content** (F-B) — NOT `stickyFooter`. Mirrors `ConsumerTripDetailScreen`'s `reserveFooter`. |
| Bottom safe area | `paddingBottom: insets.bottom + spacing.sm` (native) / `spacing.md` (web) |
| Min button height | 56 |
| Top edge | 1px hairline `palette.panelBorder` (web/iOS) / `rgba(255,255,255,0.12)` (native dark) |
| Scroll spacer | increase the scroll content bottom padding by bar height + safe area so the last inline element clears the bar. EVT-WEB pkg `scrollContent.paddingBottom` (currently `spacing.xl*2`=64, L1295) is OWNED BY THE HOST that mounts the bar — the **adapter** must pass extra bottom clearance (it cannot edit the pkg style cleanly), OR the pkg adds an optional `extraScrollBottomInset` prop the adapter sets. **Decision:** add an optional `contentBottomInset?: number` prop to the package consumed at `scrollContent` so the web adapter and the native sheet can both reserve bar clearance without forking the style. Native sheets already inject bottom padding via `SheetScrollHost`/`scrollContent` — extend that value by the bar height. |

**Android opaque-glass fallback (HARD — `ANDROID_GLASS_USES_OPAQUE_FALLBACK`):**

| Platform | Bar fill |
|----------|----------|
| iOS | `GlassBlur` intensity 28-34 + `palette.panelStrong`; `overflow:'hidden'`; upward shadow `shadowOffset {0,-8}`, opacity 0.28, radius 24 |
| Android | **opaque ≥0.92 solid fill via `Platform.select`** — dark surface `#16181b`, light EVT-WEB page `#f4f6f9`; `overflow:'hidden'`; **NO Android shadow**; rely on hairline top border for separation |
| Web | `palette.panelStrong` + backdrop-blur + hairline top border; no transparency that lets text bleed through |

**States (full matrix — projection of §4.0):**

| State | Bar | Tappable | Target |
|-------|-----|----------|--------|
| bookable / paid | price + "Buy ticket" | YES | event: `/checkout/{eventId}` (existing); trip: `/checkout-trip/{id}`; exp: `/checkout-experience/{id}` |
| bookable / free | "Free" + "Get free ticket" | YES | same checkout/claim entry |
| bookable / trip | "From {price}" + "Reserve my spot" | YES | `/checkout-trip/{id}` |
| bookable / experience | "From {price}" + "Get my spot" | YES | `/checkout-experience/{id}` |
| `bookable===false` | info strip "Booking unavailable" + subline | NO | — |
| sold out (no waitlist) | strip "Sold out" | NO | — |
| sold out + waitlist | "Join waitlist" | YES | existing waitlist sheet |
| sales ended / past | strip "Sales ended" | NO | — |
| pre-sale | strip "On sale {countdown}" | NO | — |
| door only | strip "Pay at the door" | NO | — |
| loading | bar hidden OR skeleton (panel bar, shimmer pill) | NO | — |
| pressed | opacity 0.85 / scale 0.98 + Light haptic (native) | — | — |

**Motion:** mount slide-up `translateY 100%→0` + fade 260ms `easings.out`; state crossfade 120ms; press 80ms. Reduce-motion: appear instantly. Native sheet: the bar appears with the sheet (no separate slide needed if it's a scroll sibling).

**A11y:** bookable button `accessibilityRole="button"`, label "Buy ticket, from £25"; unavailable strip `accessibilityRole="text"`, label "Booking unavailable. The organizer is finishing payment setup." (NOT a button). Wrapper `pointerEvents="box-none"`, bar `auto`. Every non-bookable state carries a WORD + icon, not color alone.

**Per-surface contract:**

| Surface | File | Inline CTA fate | Bar target |
|---------|------|-----------------|-----------|
| **EVT-WEB** | `mingla-business/src/components/event/PublicEventPage.tsx` (adapter) | KEEP per-ticket rows (multi-tier) | reuse adapter `onBuyTicket` → `router.push(checkoutPublicPath(event.id))` (LOCKED: cart page lists all tickets). When `!bookable`, the bar is the info strip (the adapter already has the `bookable` prop + the toast guard). |
| **EXP-NATIVE** | `app-mobile/.../ExpandedBusinessEventSheet.tsx` | n/a (sheet, single ticket) | bar = scroll sibling; tap → `beginBooking(ticketId)` (existing cart/occurrence flow). Needs `bookable` threaded — see §4.4 native note. |
| **EVT-NATIVE (brand sheet)** | same file as EXP-NATIVE (`ExpandedBusinessEventSheet`) | KEEP cart rows | same as EXP-NATIVE |
| **TRIP-WEB** | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | **REMOVE** the inline Reserve CTA (LOCKED single-ticket rule) — see §4.5 | bar tap → `/checkout-trip/{trip.id}`; `bookable===false` → info strip (needs trip `bookable`, §4.4) |
| **EXP-WEB** | `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | **REMOVE** the inline Get-spot CTA (LOCKED) — see §4.5 | bar tap → `/checkout-experience/{experience.id}`; uses existing `experience.bookable` |
| **TRIP-NATIVE** | `app-mobile/.../ConsumerTripDetailScreen.tsx` | already a single pinned bar (`reserveFooter`) — UPGRADE it | add `bookable===false` info-strip state to the existing bar; keep `Bookings closed` state; tap → `setReserveSheetVisible(true)` (existing) |

### 4.4 Trip `bookable` plumbing (NEW — the only data addition)

**Service-layer contract:** add `resolveTripBookable` mirroring `resolveEventBookable` (`publicEventsService.ts:914-924`) and `resolveBookable` (`publicExperienceService.ts:168-181`):

```
// in mingla-business/src/hooks/usePublicTripBySlug.ts (the trip fetch lives here, F-F)
const resolveTripBookable = async (brandId: string, isPaid: boolean): Promise<boolean> => {
  if (!isPaid) return true;
  const { data, error } = await supabase.rpc("pg_brand_can_charge", { p_brand_id: brandId });
  if (error !== null) return true;       // FAIL OPEN — checkout 409 is the backstop
  return data === true;
};
```

- `isPaid` for a trip = first pricing tier `priceCents > 0` (mirror the trip price source at hook L196-204).
- Add `bookable: boolean` to the `PublicTripPayload` interface (hook L29-37) and set it in the returned payload (`const bookable = await resolveTripBookable(brand.id, isPaid)`).
- `brandId` = `event.brand_id` (already in scope in the hook).

**Component-layer:** `[tripSlug].tsx` reads `payload.bookable` and passes it to the floating bar (info-strip when false). Mirrors how `[experienceSlug].tsx` reads `experience.bookable` (L170).

**Native trip:** `ConsumerTripDetailScreen` consumes whatever its trip-detail hook returns. If that hook does NOT carry `bookable`, thread it the same way (resolver on the brand_id + paid check). **OQ-C:** confirm the native trip-detail hook's fetch path during IMPLEMENT and add the resolver there too if absent (the screen is in scope for #3's bookable state).

**Native brand-event/exp (`ExpandedBusinessEventSheet`):** the consumer `BusinessEventCard` payload does **not** currently carry `bookable` (confirmed — `mergedDiscover.ts` has no `bookable` field). To render the native floating bar's unavailable state, `bookable` must reach the sheet. **OQ-B (scope decision):** either (a) thread `bookable` onto `BusinessEventCard` from the discover/card supply (larger change, touches `discover-cards`), or (b) for v1 render the native floating bar's bookable states only and rely on the existing checkout 409 + cart-sheet guards for the not-ready case (the native cart never dead-ends — it shows a toast). **SPEC default = (b)** to keep ORCH-1117 from widening into the discover supply path: the native brand sheets get the floating Buy bar in its tappable states; the `bookable===false` info-strip on native brand-event/exp is **deferred** (flag to orchestrator). The web surfaces (which DO have `bookable`) get the full unavailable state now. This keeps the dead-tap guarantee (native cart toasts, never dead-ends) while not pulling the discover payload into scope. Tester verifies native never dead-ends via the existing 409/toast path.

### 4.5 Remove single inline CTA (LOCKED decision)

- **TRIP-WEB** `[tripSlug].tsx`: the inline Reserve CTA is inside `TripCheckoutFlow` (its `cta`/`trip-checkout-reserve` Pressable L126-134). Remove the inline Reserve button from `TripCheckoutFlow`'s render (keep the tier card + payment-plan disclosure + helper copy as a quiet "details" block IF still wanted, but the LOUD Reserve action moves to the floating bar). Cleanest: keep `TripCheckoutFlow` for the tier/plan recap, delete its `<Pressable testID="trip-checkout-reserve">`, and let the floating bar own the navigation (`/checkout-trip/{id}`). The `handleReserve` navigation logic moves to the bar.
- **EXP-WEB** `[experienceSlug].tsx`: the inline Get-spot CTA is inside `ExperienceCheckoutFlow` (its `experience-checkout-get-spot` Pressable L123-143). Same treatment: remove the inline Pressable; the floating bar owns `/checkout-experience/{id}`. Keep the ticket recap + helper.
- Do NOT remove inline CTAs anywhere on EVT-WEB (multi-tier rows stay).
- **`publicUrls.ts`:** add `experienceCheckoutPath(experienceEventId)` → `/checkout-experience/{id}` (currently inlined; add the helper for parity with `tripCheckoutPath`/`checkoutPublicPath` and so the floating bar uses a single source).

### 4.6 CHANGE #4 — Remove title shadow (`packages/event-rendering/PublicEventPage.tsx`)

**Rule R4:** title text shadow is removed when the title sits on a solid surface (it always does today). Edit `titleLine` style L1343-1352: **delete** `textShadowColor`, `textShadowOffset`, `textShadowRadius` (L1349-1351). Keep `fontSize:36, lineHeight:41, fontWeight:"900", color:text.primary, marginBottom`. No motion, no a11y change (AA still met by `primaryText` on `page`). Preventive elsewhere (the four other surfaces already have no title shadow — verify none creeps in).

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-WEB (legibility):** On a brand with a white/near-white theme color, the `/e/{brand}/{event}` date eyebrow and recurrence pill render with ≥4.5:1 (eyebrow) / ≥4.5:1 (pill) contrast against the body card — legible, not invisible. A contrast probe on `palette.accent` vs `palette.page` and `palette.primaryText` vs effective pill bg both return ≥4.5:1.
- **SC-1-NATIVE (exp inherit):** The in-app experience detail (hosted on the shared package) shows the same legible eyebrow/pill (inherits the file).
- **SC-2-ALL (collapsed default):** On every surface, an offering with a description >160 chars renders the About/description **collapsed to 3 lines** with a "Read more" affordance + down chevron on first paint; tapping the header expands to full text, affordance → "Show less", chevron → up. An offering with ≤160-char description renders full with no toggle.
- **SC-3-WEB-BUY (event):** The `/e/{…}` floating bar shows "Buy ticket" + "From {all-in price}" when bookable; tapping it navigates to `/checkout/{eventId}` (the cart that lists all tickets) — identical target to the inline ticket-row CTA.
- **SC-3-WEB-TRIP / SC-3-WEB-EXP:** The trip/exp routes show NO inline Reserve/Get-spot button; the floating bar is the only CTA and navigates to `/checkout-trip/{id}` / `/checkout-experience/{id}`.
- **SC-3-UNAVAIL-WEB:** When `bookable===false` (trip/event/exp web), the floating bar is a NON-tappable info strip ("Booking unavailable" + subline), `accessibilityRole!=="button"`, fires no navigation/handler on tap.
- **SC-3-NATIVE-NODEADTAP:** On the native brand-event/exp sheet + trip screen, the floating bar in EVERY non-buyable state either (a) is non-tappable, or (b) on a not-ready paid brand routes through the existing cart/toast path that shows a message and never dead-ends. (Runtime/device proof required — Constitution #1.)
- **SC-3-ANDROID:** On Android, every floating bar renders with a SOLID ≥0.92 fill (no scroll text ghosting through), clipped, with NO Android shadow.
- **SC-4-WEB (shadow):** The `/e/{…}` title renders with no text shadow (clean/flat); `titleLine` style contains no `textShadow*` keys.
- **SC-5 (trip bookable):** `usePublicTripBySlug` returns `payload.bookable`; for a paid trip whose brand `pg_brand_can_charge=false`, `bookable===false`; for a free trip, `bookable===true`; on RPC error, `bookable===true` (fail-open).

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|-----------|---------------|----------------|
| **Constitution #1 — no dead taps** | Every non-bookable floating-bar state is a non-button info strip OR routes through an existing toast/guard path; runtime dead-tap proof at TEST | T-DEADTAP (runtime, §7) |
| **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED** (ORCH-1076) | Trip gains the same `pg_brand_can_charge` gate events/exp already have; fail-open + checkout-409 backstop preserved | T-TRIP-BOOKABLE |
| **WYSIWYP / all-in pricing** | Floating bar reads `priceAllInGbp`/`priceCents` as-is; never recomputes fees | T-PRICE-NORECOMPUTE (assert no fee math in bar) |
| **ANDROID_GLASS_USES_OPAQUE_FALLBACK** | Every bar uses `Platform.select` opaque ≥0.92 Android fill, clipped, no shadow | T-ANDROID-OPAQUE |
| **Anon-tolerant public routes** (`feedback_anon_buyer_routes`) | No new `useAuth` on `/t/`,`/exp/`,`/e/`; trip `bookable` resolved via anon-granted RPC | unchanged routes |
| **Single-scroll native sheet** (ORCH-1016 / META-ORCH-0991) | Native floating bar is a scroll SIBLING, never `BaseBottomSheet.stickyFooter` (F-B) | T-NATIVE-SCROLL (manual on-device) |

**Proposed new invariant (DRAFT — orchestrator flips ACTIVE on CLOSE):**
`I-PROPOSED-NO-RAW-WHITE-ON-PALETTE-SURFACE` — in `packages/event-rendering/PublicEventPage.tsx`, no `color: "#ffffff"`/`"#fff"` literal on a text element on a palette surface, except `accentText` on the accent button. Enforced by a strict-grep CI guard (§9).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-LUM-HAPPY | Light theme contrast | brand theme `#ffffff` → `createThemePalette` | `contrastRatio(palette.accent, palette.page) ≥ 4.5` AND `contrastRatio(palette.primaryText, palette.page) ≥ 4.5` | unit (package) |
| T-LUM-DARK | Default theme unchanged | theme `#eb7825` | `useDark===true`; eyebrow accent + pill primaryText render as today (white on near-black) | unit |
| T-LUM-REVERT | Fails-on-revert | re-introduce `color:"#ffffff"` at L583 | strict-grep guard FAILS | CI grep |
| T-ABOUT-DEFAULT | Collapsed by default | description 400 chars | `aboutCollapsed===true` initial; body `numberOfLines===3`; "Read more" present | unit/render |
| T-ABOUT-SHORT | Short-copy exception | description 80 chars | no chevron, no affordance, full text | unit/render |
| T-ABOUT-TOGGLE | Expand | tap header | `numberOfLines===undefined`; "Show less"; chevron up | render |
| T-CTA-BUY | Bookable event | bookable=true, 2 paid tiers | `resolveOfferingCta → {kind:"buy", price:"From £X", tappable:true}` | unit (offeringCta) |
| T-CTA-UNAVAIL | Not bookable | bookable=false | `{kind:"unavailable", title:"Booking unavailable", tappable:false}` | unit |
| T-CTA-SOLDOUT | Sold out no waitlist | all tiers cap 0 | `{kind:"unavailable", title:"Sold out", tappable:false}` | unit |
| T-CTA-WAITLIST | Sold out + waitlist | cap 0, waitlist on | `{kind:"waitlist", tappable:true}` | unit |
| T-NAV-EVENT | Event bar target | tap bookable bar | `router.push("/checkout/{eventId}")` called | render/spy |
| T-NAV-TRIP-REMOVE-INLINE | Trip inline removed | render `/t/…` | no `testID="trip-checkout-reserve"` in tree; floating bar present → `/checkout-trip/{id}` | render |
| T-NAV-EXP-REMOVE-INLINE | Exp inline removed | render `/exp/…` | no `testID="experience-checkout-get-spot"`; floating bar → `/checkout-experience/{id}` | render |
| T-TRIP-BOOKABLE | Trip resolver | paid trip, RPC=false | `payload.bookable===false` | unit (hook) |
| T-TRIP-BOOKABLE-FAILOPEN | RPC error | RPC throws | `payload.bookable===true` | unit |
| T-TRIP-BOOKABLE-FREE | Free trip | tier price 0 | `bookable===true`, no RPC call | unit |
| T-SHADOW-GONE | Title shadow removed | inspect `titleLine` style | no `textShadowColor/Offset/Radius` keys | unit/snapshot |
| T-ANDROID-OPAQUE | Android fill | `Platform.OS==="android"` | bar fill is solid hex (`#16181b`/`#f4f6f9`), no rgba alpha <0.92, no shadow | unit (Platform.select) |
| T-DEADTAP | Runtime no dead tap | drive sim/device, tap bar in each non-buyable state | never dead-ends; non-button strips fire nothing; not-ready native shows toast | RUNTIME (device) |
| T-NATIVE-SCROLL | Sheet still scrolls | drive native sheet with floating bar | body scrolls fully, bar pinned, swipe-down dismisses | RUNTIME (device) |

---

## 8. Implementation order

1. **`packages/event-rendering/offeringCta.ts`** (NEW) — `resolveOfferingCta` + `CtaState` (the hoisted state machine). Unit-test first.
2. **`packages/event-rendering/PublicEventPage.tsx`** — #1 (L583, L617 → palette tokens), #4 (delete L1349-1351 shadow), #2 (collapsible About L856-872 with `aboutCollapsed` state + text-glyph chevron + 160-char exception), optional `contentBottomInset?` prop, R1 guard comment. Have `PublicTicketRow` import the shared predicates from offeringCta (no behavior change).
3. **`mingla-business/src/constants/publicUrls.ts`** — add `experienceCheckoutPath`.
4. **`mingla-business/src/hooks/usePublicTripBySlug.ts`** — add `resolveTripBookable` + `bookable` on `PublicTripPayload`.
5. **`mingla-business/src/components/trip/TripPreview.tsx`** + **`ExperiencePreview.tsx`** — collapsible description.
6. **`mingla-business/src/components/trip/TripCheckoutFlow.tsx`** + **`ExperienceCheckoutFlow.tsx`** — remove inline Reserve/Get-spot Pressable; expose the nav target for the bar.
7. **`mingla-business/src/components/event/PublicEventPage.tsx`** (adapter) — mount the web floating bar (reuse `onBuyTicket`/`bookable`); reserve scroll-bottom clearance via `contentBottomInset`.
8. **`mingla-business/app/t/[brandSlug]/[tripSlug].tsx`** + **`app/exp/[brandSlug]/[experienceSlug].tsx`** — mount the floating bar (absolute bottom), pass `bookable`, target the checkout paths.
9. **`app-mobile/.../ConsumerTripDetailScreen.tsx`** — upgrade `reserveFooter` to the standardized bar contract + bookable state; collapsible description.
10. **`app-mobile/.../ExpandedBusinessEventSheet.tsx`** — add the floating Buy bar as a scroll sibling (F-B); tappable states route through `beginBooking`; collapsible About inherits from the package.
11. **`app-mobile/.../EventDetailLayout.tsx`** — #2 copy/chevron standardization only.
12. **CI strict-grep guard** for R1 (§9).
13. Run all jest gates; prove fails-on-revert; device runtime proof for T-DEADTAP + T-NATIVE-SCROLL.

---

## 9. Regression prevention (fails-on-revert contract)

- **R1 guard (structural):** add a strict-grep CI check (in the existing CI grep harness / a new audit test under `mingla-business/src/**/__tests__/` that reads the package source) that FAILS if `packages/event-rendering/PublicEventPage.tsx` contains `color: "#ffffff"` or `color: "#fff"` on a text element, EXCEPT the single `accentText` button pairing. Reverting the #1 fix (re-adding the literal at L583/L617) makes this FAIL; restoring it PASSES. Protective comment: "ORCH-1117 R1 — date eyebrow + recurrence pill must read from the luminance-aware palette, never raw white, or they vanish on a light brand theme."
- **#4 guard:** a snapshot/style unit asserting `titleLine` has no `textShadow*` keys — FAILS if the shadow is restored.
- **Inline-CTA-removed guard:** render tests assert `trip-checkout-reserve` / `experience-checkout-get-spot` testIDs are ABSENT and the floating-bar testID is present — FAIL if an inline single CTA is reintroduced alongside the bar.
- **Trip-bookable guard:** unit asserting `usePublicTripBySlug` returns `bookable` and fails-open — FAILS if the field is dropped.
- **Dead-tap (runtime):** Constitution #1 — the tester MUST drive each non-buyable bar state on device and prove no dead-end. Source wiring is insufficient (memory: "interactive elements must fire — runtime proof").

---

## 10. Open questions

- **OQ-A (RESOLVED by locked decisions):** design OQ-2 is closed — multi-tier event bar → existing `/checkout/{eventId}`; single-ticket trip/exp inline CTA → removed. No further decision needed.
- **OQ-B (scope, SPEC default chosen):** native brand-event/exp `bookable===false` info-strip is DEFERRED (the consumer `BusinessEventCard` lacks `bookable`; threading it pulls in the discover-cards supply). v1 native bar ships tappable states + relies on the existing 409/cart-toast for not-ready (never dead-ends). Flagging to orchestrator: confirm deferral, or authorize a follow-on to thread `bookable` onto `BusinessEventCard`.
- **OQ-C:** confirm during IMPLEMENT whether the native trip-detail hook (feeding `ConsumerTripDetailScreen`) carries `bookable`; if not, add `resolveTripBookable` there too (it's the same brand_id + paid check).
- **OQ-D (HARD merge order):** ORCH-1117 MUST merge AFTER ORCH-1116. Do not merge this branch until ORCH-1116 is on `main` and this branch is rebased on it. Before then the trip/exp/event `bookable` boolean is unreliable for anon/non-owner buyers.

---

## 11. Downstream routing

**Next = mingla-implementor (build this contract).** Then mingla-tester (adversarial + device runtime proof for T-DEADTAP/T-NATIVE-SCROLL/T-ANDROID-OPAQUE; verify legibility on a white-theme brand; verify inline-CTA removal; verify trip bookable fail-open). Then orchestrator CLOSE (flip `I-PROPOSED-NO-RAW-WHITE-ON-PALETTE-SURFACE` to ACTIVE; enforce the ORCH-1116-first merge order).

**Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1117-[offering-page-polish]/` on branch `ORCH-1117-offering-page-polish` (rebase on origin/main after ORCH-1116 merges, before merging this).

### Allowlist (implementor MAY edit ONLY these)

- `packages/event-rendering/PublicEventPage.tsx`
- `packages/event-rendering/offeringCta.ts` (NEW)
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/trip/TripPreview.tsx`
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx`
- `mingla-business/src/components/experience/ExperiencePreview.tsx`
- `mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx`
- `mingla-business/app/t/[brandSlug]/[tripSlug].tsx`
- `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`
- `mingla-business/src/hooks/usePublicTripBySlug.ts`
- `mingla-business/src/constants/publicUrls.ts`
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
- `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` (#2 copy/chevron only)
- a NEW shared `FloatingOfferingBar` component in each app's component tree (business + app-mobile) + co-located `__tests__/`
- the CI strict-grep guard / audit test file (§9)
- the native trip-detail hook ONLY IF OQ-C requires the trip `bookable` resolver there

### DO-NOT-TOUCH (stop-and-amend before editing)

- `supabase/` migrations, `pg_brand_can_charge`, any edge function, any Stripe/Paystack money path (ORCH-1116 owns the RPC; ORCH-1117 only reads it).
- `BaseBottomSheet.tsx` (do NOT add/reroute through `stickyFooter` — F-B).
- `discover-cards` edge fn + `BusinessEventCard` supply (OQ-B deferral — do not widen into the discover payload without orchestrator authorization).
- the existing multi-tier inline ticket rows on EVT-WEB (`PublicTicketRow` per-tier behavior).
- `nativeCheckoutFlow`, `TicketCartSheet`, `ticket-checkout-create` request shape.
