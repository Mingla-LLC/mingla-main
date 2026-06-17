# SPEC — ORCH-1156 · Public RSVP Event Page → Direction C "Momentum"

**Mode:** SPEC (half 2 of IA pass). Investigation: `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1156_RSVP_PUBLIC_PAGE.md` (same worktree).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1156-[rsvp-public-redesign]/` on branch `ORCH-1156-rsvp-public-redesign`.
**Binding design:** `Mingla_Artifacts/design/ORCH-1156/RSVP_DIRECTION_C_MOMENTUM.html` + `DESIGN_PHILOSOPHY_ORCH-1156_RSVP_PUBLIC_PAGE.md`. Seth-approved Direction C, kicker `color:inherit` tweak applied.
**Status:** ready for mingla-implementor.

---

## 1. Executive summary

Rebuild the public RSVP event page from a "ticket-page subtraction" into Direction C "Momentum": a social-first, non-transactional invitation whose gravitational center is (a) the **going-momentum unit** — going count + capacity meter + an anonymous (faceless) attendee cluster — and (b) the **Going / Maybe / Can't decision** as the thumb-zone hero (float→dock on phone, sticky right panel on desktop ≥1024). Energy comes from the **brand theme accent as a loudness dial**, so the same layout reads right from a networking mixer to a club-night. Add party-type vibe chips, the "You're invited" kicker (color inherits the title), host, single date, City/Country, and description at a calm second tier.

This ships across ALL FIVE surfaces (buyer-web + business iOS/Android via the shared `RsvpPublicBody`; consumer iOS/Android via the `ConsumerEventDetailScreen` RSVP branch) plus the business-web RSVP preview. RSVP is ticketless — **no checkout, no price, no cart affordance anywhere**. The investigation proved every Direction-C field is ALREADY on the anon-safe `business_public_events_view` (incl. `rsvp_going_count` and `party_types`), so **no migration and no edge function are required**; this is pure frontend + shared-package work. Social proof stays honest: count + meter + anonymous cluster only — never names, faces, a public maybe count, a public waitlist count, or comments.

---

## 2. Scope & non-goals

**In scope:**
- A NEW shared RN component, `RsvpMomentumDecision`, in `packages/offering-rendering/`, rendering the momentum unit (count + meter + anonymous cluster), the party-type chips, the "You're invited" kicker, and the Going/Maybe/Can't decision control with float→dock (phone) and a sticky-panel (desktop) layout — theme-accent driven.
- Rework `mingla-business/src/components/event/RsvpPublicBody.tsx` to compose Direction C from the shared unit (buyer-web + business + preview).
- Rework the RSVP branch of `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` to consume the same shared unit (Going/Maybe/Can't, momentum where data is available).
- Add `partyTypes: string[]` (and optionally `vibeTags`) to `PublicEventProps`; populate it in the buyer-web view-row mapper.
- Consumer momentum data: fetch the public RSVP event via the existing anon `business_public_events_view` path so the consumer screen has `rsvp_going_count` + capacity + waitlist/approval (Open Question OQ-1 governs the final fork).

**Non-goals (explicit, with reason):**
- NO migration, NO new edge function, NO RPC change (F-3: the view already carries every field). If implementation discovers a genuinely-missing field → STOP and request a SPEC amendment (do not silently add a migration; that would trip COMMS-0002).
- NO public guest list / names / avatars (no schema; constitution rule 9).
- NO public maybe count, NO public waitlist count, NO comments/photos/reactions (no schema).
- NO checkout / price / cart / Reserve affordance on any RSVP surface.
- NO change to the ticketed event page, trip, or experience pages (byte-identical).
- NO change to `public-submit-rsvp`, `submitPublicRsvp`, or `submitDeckRsvp` write contracts.
- NO change to the consumer deck CARD itself (only the detail screen's RSVP branch).

**Assumptions:** the brand theme palette + `ParallaxCoverShell` + `normalizeCityCountry` + `ChipGroup` + `resolveRsvpCta` behave as today; the anon view read is unchanged.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | RSVP detail shows Direction-C momentum unit (count + meter + anonymous cluster where data present) + Going/Maybe/Can't dock (float→dock), party chips, kicker. No price/cart. | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`, consumes shared unit | Manual (separate path) — held by shared unit |
| 2 | Consumer Android | YES | Same as iOS; opaque Android fills on momentum/cluster/decision cards. | same | Manual; opaque-glass policy |
| 3 | Buyer/anon Web | YES | `/e/{slug}/{slug}` RSVP renders Direction C; desktop ≥1024 = two-column with sticky right RSVP panel; phone = float→dock decision. | `mingla-business/src/components/event/RsvpPublicBody.tsx`, `publicEventsService.ts`, shared unit | Auto (shared body) for native+web; web responsive via `useResponsiveLayout` |
| 4 | Business iOS | YES | Same `RsvpPublicBody` Direction C in the business app's public/preview rendering. | same as #3 | Auto (shared body) |
| 5 | Business Android | YES | Same; opaque Android fills. | same | Auto; opaque-glass policy |
| 6 | Business Web preview (`/rsvp/[id]/preview`) | YES | Draft preview renders Direction C with goingCount=0 → momentum unit shows an honest zero/empty state ("Be the first to RSVP"), no fabricated count. | `mingla-business/app/rsvp/[id]/preview.tsx` (props only), shared unit | Auto (shared body) |
| 7 | Admin Web | NO | No RSVP public page on admin. | — | n/a |

---

## 4. Layered specification

No DB / edge / service-write layers change. Layers below are: shared types, shared component, buyer-web read service, the two host components, and the consumer data fetch.

### 4.1 Shared types — `packages/event-rendering/types.ts`
- Add to `PublicEventProps` (ADDITIVE, default-safe so no existing offering page breaks):
  - `partyTypes: string[];` (canonical party-type slugs; `[]` when none).
  - (optional) `vibeTags: string[];` if the design wants secondary vibe chips — keep `[]`-default.
- These are consumed by the shared C unit to render chips. Every existing constructor of `PublicEventProps` (ticket/trip/experience mappers) must default these to `[]` (type-checker will flag — add `partyTypes: []` where they don't have it).

### 4.2 NEW shared component — `packages/offering-rendering/RsvpMomentumDecision.tsx`
Pure presentational RN component (no data fetch, no React Query). Exported from `packages/offering-rendering/index.ts`.

**Props (contract):**
```ts
interface RsvpMomentumDecisionProps {
  palette: ThemePalette; theme: ResolvedTheme;
  goingCount: number; capacity: number | null;     // capacity null = unlimited
  ctaState: RsvpCtaState;                            // from resolveRsvpCta (single owner)
  guestStatus: "going"|"not_going"|"waitlisted"|"maybe"|null;
  guestApproval: "pending"|"approved"|null;
  allowPlusOnes: boolean; plusOnesMax: number; plusCount: number; onPlusChange:(n:number)=>void;
  submitting: boolean;
  onGoing:()=>void; onMaybe:()=>void; onNotGoing:()=>void;
  variant: "inline" | "sticky-panel" | "floating-dock"; // layout mode
  testID?: string;
}
```
**Renders (per the mockup):**
- **Momentum unit:** `goingCount` in oversized accent-weighted numerals + label "going"; a sub-line that is HONEST and derived: `capacity===null` → "Open invite" (no scarcity); else `spotsLeft = max(0, capacity−goingCount)` → "N spots left · filling up" (or "Full · waitlist open" when full). A capacity meter (`width = capacity? min(100, goingCount/capacity*100) : a low fixed fill`) using `linear-gradient(accent-strong→accent)` + accent glow. **goingCount=0 → "Be the first to RSVP", meter empty, NO cluster.**
- **Anonymous attendee cluster:** up to 3 FACELESS avatar disks (person glyph, accent gradient) + a `+N` overflow chip where `N = goingCount − shown`, with copy "are pulling up" (or theme-appropriate). NEVER names/photos. Hidden entirely when `goingCount===0`. The cluster is explicitly a COUNT motif (a11y label: "{goingCount} people going").
- **Decision control:** Going / Maybe / Can't, theme-accent driven. States exactly mirror `resolveRsvpCta` + the current `RsvpPublicBody` state machine: open (3 buttons), going ("You're going ✓" + change), maybe ("Maybe" + switch-to-going/decline), pending ("Awaiting approval", disabled), full+waitlist ("Join waitlist"), waitlisted ("You're on the waitlist"), not_going (switch-to-going). Going + Maybe require a reachable guest (contact form lives in `RsvpPublicBody`, gated by `contactReady`; on consumer the logged-in JWT supplies it). Submitting → "Saving…"/"Joining…".
- **Plus-ones stepper** when `allowPlusOnes` and not in a resolved binding state.
- **Layout modes:** `floating-dock` = the decision only, sticky to the bottom with safe-area inset (phone); `sticky-panel` = host + momentum + decision in a sticky card (desktop ≥1024); `inline` = full unit in the body flow (fallback / native single-column). Use `useResponsiveLayout` in the HOST to pick the mode.

**Android:** all card fills opaque (`Platform.select`, fill ≥0.92, `overflow:'hidden'`, no Android shadow under rounded fill) per `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.
**A11y:** decision buttons ≥44pt, `accessibilityRole="button"`, labels per state; meter not interactive.
**Motion:** kicker dot pulse (1.8s), meter fill width transition (0.5s ease), button `:active` scale 0.97 — per the mockup CSS; on RN use `Animated`/layout transitions, keep subtle.

### 4.3 Buyer-web read service — `mingla-business/src/services/publicEventsService.ts`
- In `publicEventViewRowToEvent` (the view-row → `PublicEventRecord` mapper), extract `row.party_types` (and `row.vibe_tags` if used) into the returned record so `partyTypes` reaches `PublicEventProps`. Default `[] ` when null. No other change. (Already-present `rsvp_going_count` continues to flow into `event.rsvpGoingCount`.)

### 4.4 Host — `mingla-business/src/components/event/RsvpPublicBody.tsx`
- Recompose to Direction C: hero kicker "You're invited" (style `color: inherit` = same color as the title; pulsing dot stays accent) inside the existing `ParallaxCoverShell` hero (phone-lead + desktop caption parity with the mockup); host row; party-type chips (via `ChipGroup` from `partyTypes` + date/City-Country chips); then `RsvpMomentumDecision`.
  - Phone (`useResponsiveLayout` not-desktop): momentum unit `inline` in the body; decision rendered in a `floating-dock` (sticky bottom). Keep the contact form + plus stepper in the body, gating Going/Maybe on `contactReady` (unchanged logic).
  - Desktop (≥1024): two-column — scrolling body (cover caption, about, where, chips, momentum-context) left; `sticky-panel` (host + momentum + decision) right.
- Preserve EVERY existing state, copy, contact-form validation (`A4-NEW` name+email+phone), error handling, and the `onSubmit`/`resolveRsvpCta` wiring. Do NOT change the write path. Keep `testID="orch-1150-rsvp-…"` IDs and add `orch-1156-…` IDs for the new momentum/cluster/decision/chips nodes.

### 4.5 Host — `mingla-business/app/rsvp/[id]/preview.tsx`
- Props-only: pass `partyTypes` from the draft (`draft.partyTypes`) into the `publicEvent` it builds (`mapDraftToPublicEvent`), and keep `goingCount: 0`. The shared unit renders the honest zero state. No logic change.

### 4.6 Host — `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (RSVP branch)
- Replace the hand-rolled `rsvpDock` (2-button, no Maybe) with `RsvpMomentumDecision` in `floating-dock` mode + the momentum unit inline in the body, plus the party-type chips (the seed already carries `partyTypes`).
- Add **Maybe** to the consumer write: extend `handleRsvp` / `submitDeckRsvp` call sites to accept `"maybe"` (the edge fn + shared body already support maybe; only the consumer caller is narrowed to going/not_going today). Keep the logged-in JWT path (no contact form).
- Momentum data (OQ-1): fetch the public RSVP event for this `eventId` via the SAME anon `business_public_events_view` path used by buyer-web (a thin consumer hook/service), so the consumer has `rsvp_going_count` + capacity + waitlist/approval. If OQ-1 resolves to "defer consumer momentum", render the decision + chips only and OMIT the momentum unit on consumer (still honest — no fabricated count). Decision is mandatory; momentum is data-gated.

### 4.7 Realtime
- Not applicable. `goingCount` is a snapshot from the view at load; after a successful own-submit the host may optimistically reflect the viewer's own state (existing behavior). Do NOT add a realtime channel.

---

## 5. Success criteria (runtime-observable, per surface)

- **SC-1-Web / SC-1-BizIOS / SC-1-BizAndroid:** Loading a published RSVP event at `/e/{slug}/{slug}` (open state, capacity set, goingCount>0) shows: "You're invited" kicker (same color as title) + pulsing accent dot; the going count number + "going"; a capacity meter filled proportionally; an anonymous faceless cluster with "+N" overflow and "people going" a11y label; party-type chips; host; date chip; City,Country chip; description. (Per the mockup phone screenshot.)
- **SC-2-Web (desktop ≥1024):** at viewport ≥1024px the page is two-column; the RSVP panel (host + momentum + Going/Maybe/Can't) is sticky on the right and stays in view while the left column scrolls.
- **SC-2-phone (Web/Biz/Consumer):** at <1024px the Going/Maybe/Can't decision is docked at the bottom (thumb zone), above the safe-area inset, and remains reachable while the body scrolls under the pinned cover.
- **SC-3-(all 5):** the decision shows Going / Maybe / Can't in the open state; tapping Going (logged-in or contact-complete) writes via the EXISTING path and the control resolves to "You're going ✓" with the honest sub-copy; Maybe resolves to "Maybe" with a switch-to-going option; Can't resolves to a switch-back option. (No dead ends.)
- **SC-4-(all 5):** a full event with waitlist shows "Join waitlist" (meter at 100%, sub "Full · waitlist open"); after joining, "You're on the waitlist" — and NO public waitlist NUMBER is shown anywhere.
- **SC-5-(all 5):** a manual-approval event after Going shows "Awaiting host approval" (disabled), no number, honest sub-copy.
- **SC-6-(all 5):** NO price, NO "Reserve"/"Get tickets"/cart, NO `/checkout` navigation appears or is reachable from any RSVP surface (grep + runtime).
- **SC-7-(all 5):** goingCount=0 (incl. business-web preview) shows "Be the first to RSVP", an empty meter, and NO attendee cluster — never a fabricated count or faces.
- **SC-8-Consumer iOS/Android:** the consumer RSVP detail shows Going / **Maybe** / Can't (Maybe is NEW on consumer) + party chips; momentum unit renders iff OQ-1 supplies the count.
- **SC-9-Android (Biz + Consumer):** the momentum / cluster / decision cards use opaque fills (no translucent Android glass, no taupe ring).
- **SC-10-(all 5):** the brand theme accent drives the meter, cluster, going button, and kicker dot — switching brand theme changes the page's "loudness" with no layout change (verify with a light/navy corporate theme and a dark/violet club theme).

---

## 6. Invariants

**Preserve:**
- `ANDROID_GLASS_USES_OPAQUE_FALLBACK` — new cards opaque on Android (SC-9; test: snapshot/style assertion that Android fills are ≥0.92 + `overflow:'hidden'`).
- ORCH-1150 RSVP-no-checkout test (`app-mobile/src/services/__tests__/rsvpDeckService.orch1150.test.ts` + the business equivalent) — must stay green; extend it for ORCH-1156 below.
- `I-PROPOSED-1138-EVENT-DECK-OFF-EBES` — deck routing into `ConsumerEventDetailScreen` unchanged.

**New DRAFT invariants (flip ACTIVE on CLOSE — orchestrator owns the flip):**

| ID (DRAFT) | Rule | Enforcement | Regression test |
|---|---|---|---|
| `I-PROPOSED-1156-RSVP-NO-CHECKOUT-AFFORDANCE` | No RSVP surface may render a price, "Reserve"/"Get tickets"/cart, or navigate to `/checkout`/`ticket-checkout-create`. | strict-grep over `RsvpPublicBody.tsx` + the consumer RSVP branch + `RsvpMomentumDecision.tsx` for `checkout`/`Reserve`/`priceAllIn`/`cart` (allow none) + a render test asserting no price node. | `__tests__/orch_1156_rsvp_no_checkout.test.*` — FAILS if any RSVP file references a checkout/price affordance. |
| `I-PROPOSED-1156-RSVP-DECISION-IS-HERO` | The Going/Maybe/Can't control is rendered in a docked/sticky position (floating-dock on phone, sticky-panel on desktop), not buried mid-body. | render test: the decision node carries the dock/sticky `variant` and is a direct child of the floating/sticky container, not the inline body, on each layout. | `__tests__/orch_1156_decision_hero.test.tsx`. |
| `I-PROPOSED-1156-RSVP-SOCIAL-PROOF-ANON-ONLY` | Social proof is goingCount + meter + faceless cluster ONLY. No guest names, no avatar images, no public maybe count, no public waitlist count. | strict-grep: `RsvpMomentumDecision.tsx` must not import/render any guest-name/photo field or a `maybeCount`/`waitlistCount` prop; cluster avatars are glyph-only (no `Image`/`uri`). | `__tests__/orch_1156_social_proof_anon.test.tsx` — asserts cluster has no `<Image>` and the props surface has no name/maybe/waitlist count. |
| `I-PROPOSED-1156-RSVP-USES-BRAND-THEME-DIAL` | The momentum meter, cluster, going button, and kicker dot derive color from `palette.accent`/theme, never a hardcoded hue. | strict-grep: no hardcoded hex in the accent-driven nodes of `RsvpMomentumDecision.tsx` (must read from `palette`). | `__tests__/orch_1156_theme_dial.test.tsx` — render with two palettes, assert the meter/button color tracks `palette.accent`. |

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | Open RSVP, count>0, capacity set | view row goingCount=38 capacity=50 | kicker (inherit color) + "38 going" + meter ~76% + cluster "+35" + chips | component (web+native) |
| T-2 | Open, unlimited capacity | capacity=null | "Open invite" sub, no scarcity, meter low-fixed fill | component |
| T-3 | goingCount=0 (and preview) | goingCount=0 | "Be the first to RSVP", empty meter, NO cluster | component |
| T-4 | Full + waitlist | goingCount≥capacity, waitlistEnabled | meter 100%, "Join waitlist", NO waitlist number | component |
| T-5 | Manual approval after Going | submit going, approval manual | "Awaiting host approval", disabled, no number | component |
| T-6 | Maybe path (consumer NEW) | tap Maybe on consumer | resolves "Maybe" + switch-to-going available; write rides `submitDeckRsvp("maybe")` | screen + service |
| T-7 | No checkout affordance | render every RSVP surface | no price/Reserve/cart/checkout node (grep + render) | invariant |
| T-8 | Desktop sticky panel | viewport 1280px web | two-column, right panel sticky | layout (web) |
| T-9 | Phone float→dock | viewport 390px | decision docked at bottom above safe area | layout |
| T-10 | Android opaque | Android render | momentum/cluster/decision fills opaque | style/platform |
| T-11 | Theme dial | violet-dark vs navy-light palette | accent nodes track palette.accent, no layout shift | invariant |
| T-12 | Submit error | onSubmit throws rsvp_full | inline "This event just filled up.", no dead end | error path |

---

## 8. Implementation order

1. **Types:** add `partyTypes` (+ optional `vibeTags`) to `PublicEventProps`; fix all constructors to default `[]` (type-check passes).
2. **Service:** populate `partyTypes` in `publicEventViewRowToEvent` (buyer-web).
3. **Shared component:** build `packages/offering-rendering/RsvpMomentumDecision.tsx` + export it; build all states/layout modes; opaque Android; a11y.
4. **Business host:** recompose `RsvpPublicBody.tsx` to Direction C consuming the shared unit (phone float→dock + desktop sticky panel via `useResponsiveLayout`); keep contact form + write path.
5. **Preview host:** pass `partyTypes` + goingCount=0 in `app/rsvp/[id]/preview.tsx`.
6. **Consumer host:** rework the `ConsumerEventDetailScreen` RSVP branch to consume the shared unit; add Maybe; wire the anon-view momentum fetch (OQ-1).
7. **Tests + invariants:** add the 4 DRAFT-invariant guards + T-1…T-12; extend the ORCH-1150 no-checkout test for the new files.

---

## 9. Regression prevention (fails-on-revert)

- Primary safeguard: `__tests__/orch_1156_rsvp_no_checkout.test.*` (I-PROPOSED-1156-RSVP-NO-CHECKOUT-AFFORDANCE) — strict-grep across `RsvpPublicBody.tsx`, the consumer RSVP branch, and `RsvpMomentumDecision.tsx` asserting ZERO checkout/price/cart references. **Must FAIL if any implementor reintroduces a Reserve/price affordance (revert proof: temporarily add a price node → test fails; remove → passes.)**
- Secondary: `orch_1156_social_proof_anon.test.tsx` asserts the cluster renders no `<Image>`/`uri` and the props carry no name/maybeCount/waitlistCount — FAILS if someone wires a real guest list or a public maybe/waitlist number (constitution-rule-9 guard).
- Protective comments at the top of `RsvpMomentumDecision.tsx` and the consumer RSVP branch explaining WHY (no public guest identities; RSVP is ticketless; theme is the loudness dial).

---

## 10. Open questions

- **OQ-1 (consumer momentum data — needs orchestrator bless):** the consumer detail builds RSVP UI from the deck seed, which does NOT carry `rsvp_going_count`/capacity/waitlist/approval (investigation F-6). Two options: **(a, recommended)** the consumer screen fetches the public RSVP event via the SAME anon `business_public_events_view` path used by buyer-web (one data contract, NO migration, NO COMMS-0002 trip); **(b)** widen the deck-supply RPC + seed mapper to carry the RSVP host-control fields (a migration → triggers the COMMS-0002 backend-allowlist gate). Recommend (a). If neither is chosen, the consumer ships the decision + chips and OMITS the momentum unit (still honest). Implementor MUST get this answered before step 6.
- **OQ-2:** does Direction C want secondary `vibeTags` chips in addition to `party_types`, or party-types only? Mockup shows party-types only ("Rooftop party", "Club night"). Recommend party-types only; `vibeTags` optional/deferred.

---

## 11. Downstream routing

Next = **mingla-implementor** (this worktree). Then **mingla-tester** (per-surface live-fire: web desktop+phone, business iOS+Android, consumer iOS+Android — prove SC-1…SC-10 in all 5 states: open / few-spots / full+waitlist / you're-going / pending). Then **mingla-orchestrator** CLOSE (flip the 4 `I-PROPOSED-1156-*` to ACTIVE; World Map + registry sync). All-surface parity (incl. consumer-app OTA per the parity memory rule) is a CLOSE gate.

---

## Scoped allowlist (implementor may change ONLY these)

- `packages/event-rendering/types.ts` (add `partyTypes`/`vibeTags`)
- `packages/offering-rendering/RsvpMomentumDecision.tsx` (NEW)
- `packages/offering-rendering/index.ts` (export the new component)
- `mingla-business/src/services/publicEventsService.ts` (mapper: extract `party_types`)
- `mingla-business/src/components/event/RsvpPublicBody.tsx`
- `mingla-business/app/rsvp/[id]/preview.tsx` (props only)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (RSVP branch only)
- `app-mobile/src/services/rsvpDeckService.ts` (add `"maybe"` to the write enum + a thin anon-view momentum fetch if OQ-1=a)
- Constructors of `PublicEventProps` that must default `partyTypes: []` (ticket/trip/experience mappers — type-check will name them)
- New `__tests__/orch_1156_*` files + extension of the ORCH-1150 no-checkout test

## DO-NOT-TOUCH (stop-and-amend before changing)

- Any `supabase/migrations/**` or `supabase/functions/**` (F-3: nothing needed; a migration trips COMMS-0002).
- `public-submit-rsvp`, `submitPublicRsvp`, the RSVP write/edge contracts.
- The ticketed `PublicEventPage` ticket branch, `FoundationEventPreview`, trip/experience pages, `ticket-checkout-create`, any cart/checkout code.
- `ParallaxCoverShell`, `OfferingChrome`, `resolveRsvpCta`, `normalizeCityCountry`, `ChipGroup` internals (consume, don't fork).
- The consumer deck CARD + `ExpandedCardModal` routing.
