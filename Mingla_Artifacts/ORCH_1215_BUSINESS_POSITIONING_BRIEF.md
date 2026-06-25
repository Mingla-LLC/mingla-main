# ORCH-1215 — Mingla Business · Positioning Brief (full-scope, code-grounded)

**App:** Mingla Business — the organizer / venue / experience-brand (supply) side of Mingla.
**Bundle/package:** `com.sethogieva.minglabusiness` · ASC App ID `6768737367` · Web: `business.usemingla.com`
**Date:** 2026-06-22 · Owner: mingla-product
**Purpose:** Replace the "tickets-first" framing of the prior store drafts with a complete, verified positioning of the platform. Feeds the ASO synthesis step.
**Grounding rule:** every claim below is tied to a file in `mingla-business/src` (or a verified cross-surface path). Features at "partial/gated" status are flagged in §7 and must NOT be headlined.

> **The core correction:** the prior listing leaned on "sell tickets + scan at the door." That is true but narrow. The code shows a **full event/experience commerce + operations + growth platform**: brand & venue management (incl. reservations, waitlist, menu, hours), three creation formats (events, trips, multi-stop experiences) with installment plans, refund policies and traveler-intake forms, two payout rails (Stripe US + Paystack Nigeria), a full door-ops suite (scan + walk-up + comps + guest list + scanner team), email **and SMS** marketing with buyer audiences, an AI assistant (Ari) plus menu/activity→experience AI snapping, finance reports, a notification triage inbox, and consumer-deck distribution. Ticketing is one pillar of nine, not the product.

---

## 1) One-line category definition (3 phrasings)

**A — RECOMMEND (broadest, true to scope):**
> Mingla Business is the all-in-one app for venues, organizers, and experience brands to **create, sell, run, and grow** live events and experiences — from one phone.

**B — operator job-framed:**
> Mingla Business turns your phone into a complete box office and back office for events, trips, and experiences: build the listing, take payment, run the door, fill the room.

**C — outcome-framed (brand voice aligned):**
> Mingla Business gives your business a reason for people to show up — create events & experiences, get paid, run the door, and bring your regulars back, all in one app.

> The verbs **create → sell → run → grow** are the spine of the whole brief; reuse them as the four-act structure for any store description. Brand voice anchor: *"we give people a reason to show up for you"* / *"Your business has a vibe. Your community is looking for it."* (`mingla-marketing/app/organisers/page.tsx`).

---

## 2) The pillar map (verified, organizer job-to-be-done → code path)

| # | Pillar | Organizer's job-to-be-done (1-line benefit) | Code anchor(s) |
|---|--------|---------------------------------------------|----------------|
| 1 | **Brand & venue identity + management** | *"Set up my brand once and manage my venue — hours, menu, reservations, waitlist — from one place."* | `components/brand/BrandCreationFlow.tsx`, `BrandEditView.tsx`, `PublicBrandPage.tsx`; `components/venue/VenueCreatorWizard.tsx`, `BrandHoursEditor.tsx`, `VenueMenuModule.tsx`, `VenueReservationsModule.tsx`, `VenueWaitlistModule.tsx`, `VenueAvailabilityModule.tsx`, `VenueCapacityRulesPanel.tsx` |
| 2 | **Multi-format creation (events / trips / experiences)** | *"Build whatever I run — a single night, a multi-day trip, or a multi-stop experience — in a guided wizard, photo/video cover and all."* | `components/event/EventCreatorWizard.tsx` (7-step), `components/trip/TripCreatorWizard.tsx` (multi-day itinerary, ORCH-0874), `components/experience/ExperienceCreatorWizard.tsx` + `ExperienceStopsStep.tsx` (2–5 mapped stops); covers via `CreatorStep4Cover.tsx` + `utils/eventCoverNativeVideo.ts` |
| 3 | **Commerce: ticketing, all-in pricing, tax, refunds, payment plans** | *"Sell tickets at a price guests trust — no checkout surprises — and handle refunds and installments cleanly."* | `components/event/CreatorStep5Tickets.tsx`, `components/pricing/WhoCoversCostsSection.tsx` + `utils/pricingPreview.ts` (all-in, ORCH-1006/1147), `services/ticketCheckoutService.ts`, `components/orders/RefundSheet.tsx`, `services/refundPolicyService.ts` (ORCH-0875), `components/trip/PaymentPlanEditor.tsx` + `TripPaymentChoice.tsx` (installments, ORCH-0915), `components/trip/IntakeSchemaBuilder.tsx` (traveler intake, ORCH-0880) |
| 4 | **Payments + payouts (US + Nigeria, Apple/Google Pay)** | *"Take card or wallet payments and get paid to my bank — wherever I operate."* | `payments/nativeCheckoutFlow.native.ts` (Stripe PaymentSheet incl. Apple/Google Pay + Paystack redirect), `components/brand/BrandPaymentsView.tsx` + `utils/brandPayout.ts` (provider-neutral payout gate), Stripe Connect: `app/connect-onboarding.*`, `hooks/useBrandStripeStatus.ts`; Paystack (Nigeria, META-ORCH-1076): `components/brand/BrandPaystackOnboardView.tsx` + `hooks/useBrandPaystack.ts` |
| 5 | **Door operations (scan / walk-up / guest list / comps / scanner team)** | *"Run the night — check guests in by QR, sell to walk-ups, comp who I want, and put my staff on the scanner."* | `app/event/[id]/scanner/index.tsx` (QR camera scan), `components/door/DoorSaleNewSheet.tsx` + `store/doorSalesStore.ts` (walk-up sales), `app/event/[id]/guests/index.tsx` + `components/guests/AddCompGuestSheet.tsx` + `utils/guestCsvExport.ts` (live list, comps, CSV), `components/scanners/InviteScannerSheet.tsx` + `app/brand/[id]/scanners.tsx` (scanner team, ORCH-1051) |
| 6 | **Marketing & growth (email + SMS + buyer audiences)** | *"Bring back the people who already showed up — email or text my buyers and grow a returning audience."* | `app/(tabs)/marketing/*`, `components/marketing/ComposerV2/*` (rich email, ORCH-0864), `components/marketing/SmsComposeCard.tsx` + `ChannelTabs.tsx` (SMS channel), `app/brand/[id]/blasts.tsx` + `app/event/[id]/blasts/index.tsx` + `services/marketing/marketingAudienceService.ts` (brand_buyers / event_buyers audiences), `components/marketing/AudiencePickerSheet.tsx`, marketing templates |
| 7 | **AI (Ari assistant + menu/activity → experiences)** | *"Never face a blank screen — get help shaping my listing, and turn my menu into ready-to-publish experiences."* | `screens/ari/AriChatScreen.tsx` + `components/ari/*` (chat, tool proposals); `components/experience/MenuSnapInput.tsx` + `ActivitiesSnapInput.tsx` + `app/experience/snap.tsx` + `services/experienceGenerationService.ts` (Gemini Ve5 menu / Ve6 activities parsers, ORCH-1144/1151/1154) |
| 8 | **Intelligence (finance reports + live event analytics)** | *"See what I'm earning and how each event is doing — without spreadsheets."* | `components/brand/BrandFinanceReportsView.tsx` (period switcher, net revenue, gross/refunds/fees/net breakdown, top events, export), `components/home/LiveOfferingCard.tsx` (live revenue + sold/capacity + scanned), `app/(tabs)/marketing/index.tsx` + `hooks/marketing/useMarketingOverview.ts` (marketing funnel) |
| 9 | **Discovery (experiences surface on the consumer deck)** | *"My published experiences reach real people — front-loaded on Mingla's consumer swipe deck, no extra work."* | `supabase/functions/discover-cards/index.ts` + `pg_eligible_experiences_for_deck` RPC (ORCH-1065); business authoring at `app/experience/create.tsx` |
| 10 | **Notifications, deep links, web parity** | *"Get alerted to money/risk/team events, share clean links, and work from my phone or the web."* | `services/oneSignalService.ts` + `components/notifications/BusinessNotificationsScreen.tsx` (push + triage inbox, META-ORCH-1074), `constants/publicUrls.ts` (canonical `/e` `/t` `/exp` `/b` + checkout links + cart seed), web build `business.usemingla.com` (`.web.tsx` overrides throughout) |

---

## 3) Differentiators (why it's more than a ticketing tool)

1. **Three formats, one app — not just "events."** Events, multi-day **trips** (itinerary builder, installment payment plans, refund policies, traveler-intake forms) and **multi-stop experiences** (2–5 mapped stops) are first-class. Most ticketing apps stop at single-session events. *(`TripCreatorWizard.tsx`, `ExperienceStopsStep.tsx`, `PaymentPlanEditor.tsx`, `IntakeSchemaBuilder.tsx`)*
2. **All-in, transparent pricing (WYSIWYP).** The price the guest sees is the price they pay — the organizer chooses to pass or absorb tax / platform fee / processing, with a live "buyer pays / you keep" preview. *(`WhoCoversCostsSection.tsx`, `pricingPreview.ts`; ORCH-1006/1147)*
3. **Two payout rails out of the box: US (Stripe) + Nigeria (Paystack).** Provider-neutral payout gate; brands pick their country and the right rail wires up. Genuinely cross-market, not US-only. *(`brandPayout.ts`, `BrandPaystackOnboardView.tsx`)*
4. **A full door-ops back office, not just a scanner.** QR check-in **plus** walk-up sales, comp guests, a live merged guest list, CSV export, and a delegated **scanner team** (invite staff, brand- or event-scoped). *(`DoorSaleNewSheet.tsx`, `AddCompGuestSheet.tsx`, `InviteScannerSheet.tsx`)*
5. **Growth is built in — email AND SMS to people who already bought.** Buyer audiences are auto-built from orders (brand-wide or per-event); reach returning customers without exporting a list. *(`marketingAudienceService.ts`, `SmsComposeCard.tsx`)*
6. **AI that does real work.** Ari helps author listings and plan marketing; menu/activity **snapping** turns a photo of your menu into publishable experiences. *(`AriChatScreen.tsx`, `MenuSnapInput.tsx`)*
7. **Owned distribution.** Published experiences are front-loaded onto Mingla's consumer discovery deck — the supply you create gets demand, not just a link you have to promote yourself. *(`discover-cards/index.ts`)*
8. **Create + sell + run + grow under one login,** with a finance report and a money/risk/team notification inbox — replacing a stack of point tools (ticketing + POS + CRM + email + reservations).

---

## 4) Target segments

| Segment | What they run | Pillars that hook them |
|---|---|---|
| **Restaurants / food & drink venues** | Menus, reservations, special nights, ticketed dinners; menu→experience snapping | 1 (menu/hours/reservations/waitlist), 7 (snap), 2/3 |
| **Nightlife / bars / clubs / music venues** | Recurring ticketed nights, door sales, scanner staff, guest lists, comps | 5 (door ops), 2/3, 6 |
| **Recurring-night organizers / promoters** | Weekly/monthly series, returning-buyer marketing, multi-event audiences | 2 (recurrence), 6 (audiences/SMS), 8 |
| **Experience & tour brands** | Multi-stop experiences, multi-day trips, installments, traveler intake | 2 (experiences/trips), 3 (plans/intake), 9 (deck) |
| **One-off event hosts** | A single event end-to-end: build → sell → scan → settle | 2, 3, 4, 5 |

---

## 5) Value-prop hierarchy (top 5, ranked for a store description)

1. **Create events, trips & experiences in minutes** — the guided creator (cover photo/video, tickets, publish to a shareable page). *Lead here: it's the entry job and the broadest true claim.*
2. **Sell tickets and get paid, all-in and transparent** — card/Apple Pay/Google Pay, paid to your bank, US (Stripe) + Nigeria (Paystack), no checkout surprises.
3. **Run the door from your phone** — QR check-in, walk-up sales, live guest list, comps, scanner team.
4. **Grow the audience that shows up** — email and SMS your buyers, bring regulars back.
5. **One brain for the business** — Ari AI + menu→experience snapping + a finance dashboard + reservations/menu/hours, without spreadsheets or a stack of apps.

> Ordering rationale: creation is the activation job; payment is the value capture; door is the day-of payoff; growth is retention; the "one brain" line is the moat. Tickets stay prominent (#2) but no longer define the app.

---

## 6) Naming inputs — keyword "tails" / descriptors (all TRUE to full scope)

Use as title/subtitle tails, keyword field, or ASO theme seeds. Each is backed by shipped code.

1. **Events & experiences** (events + trips + multi-stop experiences)
2. **Sell tickets** (ticket tiers + all-in checkout)
3. **Run the door** (scan + walk-up + guest list)
4. **Get paid / payouts** (Stripe + Paystack + wallets)
5. **Event management** (creation → settings → edit → reports)
6. **Box office** (ticketing + door + reconciliation)
7. **Guest list & check-in** (live list, comps, QR)
8. **Grow your audience** (email + SMS to buyers)
9. **Venue management** (hours, menu, reservations, waitlist)
10. **For organizers & venues** (audience descriptor)
11. **Fill your venue / fill the room** (outcome tail; brand-voice aligned)
12. **AI for events** (Ari + menu→experience snapping)

> Strongest single tails for a title slot, in order: **"events & experiences"** (broadest + on-strategy), **"sell tickets"** (highest-volume ASO term), **"for organizers"** (segment). Avoid leading the title with "tickets" alone — it under-sells the platform.

---

## 7) ⚠️ Truth flags (over/under-claims + partial/gated features)

**Prior drafts UNDER-claimed (real, shippable scope they omitted — safe to add):**
- **Venue ops beyond menu:** reservations, waitlist, availability, capacity rules, blackout dates are all built (`VenueReservationsModule.tsx`, `VenueWaitlistModule.tsx`, `VenueAvailabilityModule.tsx`, `VenueCapacityRulesPanel.tsx`). The drafts only named "menu/hours."
- **SMS marketing channel:** not just email — there's a working SMS composer with segment/cost estimate (`SmsComposeCard.tsx`, `ChannelTabs.tsx`). Drafts said "email blasts" only.
- **Scanner team management:** invite/assign staff as scanners, brand- or event-scoped, with revoke (`InviteScannerSheet.tsx`, `app/brand/[id]/scanners.tsx`). Drafts implied solo scanning.
- **Trip depth:** installment payment plans (`PaymentPlanEditor.tsx`), refund policies (`refundPolicyService.ts`), traveler-intake forms (`IntakeSchemaBuilder.tsx`), multi-package tiers. Drafts said "trips" generically.
- **Finance reports + notification triage inbox:** `BrandFinanceReportsView.tsx` (gross/refunds/fees/net, top events, export) and `BusinessNotificationsScreen.tsx` (money/risk/audience/team). Drafts said "dashboard" loosely.
- **Activities snapping (Ve6):** not only restaurant menus — a parallel play/activities parser exists (`ActivitiesSnapInput.tsx`).

**PARTIAL / GATED — do NOT headline; soften or omit:**
- ⚠️ **Marketing funnel attribution is placeholder.** Sent/opened/clicked/converted tiles exist but true open/click attribution is pending (Phase F UTM/webhook). The code's own gate forbids an "Opened" label until real attribution lands. → Say "see your campaigns and reach," not "track opens and conversions."
- ⚠️ **Door sale payment methods are partly gated.** Cash + manual are live; **card reader + NFC tap are DISABLED** ("Coming when backend ships"). → Frame walk-up sales as "log/record door sales," not "take card payments at the door."
- ⚠️ **Apple Pay / Google Pay are Stripe-PaymentSheet-conditional**, surfaced at Stripe's discretion per device/eligibility — true but not guaranteed-visible. Claim "card or wallet (Apple Pay/Google Pay)" rather than promising the buttons always appear.
- ⚠️ **QR scanning is native-only;** the web build shows an explicit "use the app to scan" empty state. Fine, but don't imply door scanning on web.
- ⚠️ **Push notifications are native-only;** web stubs them. Don't promise web push.
- ⚠️ **Finance report fee rates are hard-coded ([TRANSITIONAL], real rates ship in B2).** Numbers are illustrative; don't quote exact fee math in marketing.
- ⚠️ **Attendee-level insight is shallow on the business side** — live revenue/sold/capacity/scanned only; no per-attendee demographic/CRM tiles. Don't claim "know your attendees."
- ⚠️ **Brand photo upload + custom links + "list in Discover" toggle are deferred UI** in `BrandEditView.tsx` (schema exists, UI shows "coming soon"). Don't headline brand customization depth.

**Prior drafts OVER-/MIS-claimed (tighten):**
- The "tickets-first" framing itself (subtitle `"Sell tickets. Fill the room."`, the whole "tickets" lean) **under-positions** the product — see the §1 correction. Keep "sell tickets" as a strong #2, not the category.
- The earlier draft's "Snap your menu" paragraph is real (ORCH-1144/1151) but **niche/early**; keep it, but as a supporting line under AI, not a hero — and remember it now extends to **activities**, not just menus.
- "All-in pricing" is real and verified (ORCH-1147) — safe to claim **WYSIWYP**, but only the **organizer chooses** pass/absorb; don't imply Mingla always absorbs fees.

**Unverified / out-of-scope for this brief (flag, don't assert):**
- Whether a store listing already exists under another name/package (must check ASC + Play before publishing).
- Exact edge-function Gemini behavior lives server-side (`parse-restaurant-menu` / `parse-play-activities`), not audited here for marketing claims beyond "snap → drafts."

---

## Appendix — pillar → code anchor quick index (for ASO synthesis reuse)

```
1 Brand/Venue      components/brand/{BrandCreationFlow,BrandEditView,PublicBrandPage}.tsx
                   components/venue/{VenueCreatorWizard,BrandHoursEditor,VenueMenuModule,
                                     VenueReservationsModule,VenueWaitlistModule,VenueAvailabilityModule}.tsx
2 Creation         components/event/EventCreatorWizard.tsx
                   components/trip/TripCreatorWizard.tsx
                   components/experience/{ExperienceCreatorWizard,ExperienceStopsStep}.tsx
3 Commerce         components/pricing/WhoCoversCostsSection.tsx · utils/pricingPreview.ts
                   services/{ticketCheckoutService,refundPolicyService}.ts
                   components/orders/RefundSheet.tsx · components/trip/{PaymentPlanEditor,IntakeSchemaBuilder}.tsx
4 Payments/Payouts payments/nativeCheckoutFlow.native.ts · components/brand/{BrandPaymentsView,BrandPaystackOnboardView}.tsx
                   utils/brandPayout.ts · hooks/useBrandPaystack.ts · app/connect-onboarding.*
5 Door Ops         app/event/[id]/scanner/index.tsx · components/door/DoorSaleNewSheet.tsx
                   app/event/[id]/guests/index.tsx · components/guests/AddCompGuestSheet.tsx
                   utils/guestCsvExport.ts · components/scanners/InviteScannerSheet.tsx · app/brand/[id]/scanners.tsx
6 Marketing        app/(tabs)/marketing/* · components/marketing/ComposerV2/* · SmsComposeCard.tsx · ChannelTabs.tsx
                   app/brand/[id]/blasts.tsx · app/event/[id]/blasts/index.tsx · services/marketing/marketingAudienceService.ts
7 AI               screens/ari/AriChatScreen.tsx · components/experience/{MenuSnapInput,ActivitiesSnapInput}.tsx
                   app/experience/snap.tsx · services/experienceGenerationService.ts
8 Intelligence     components/brand/BrandFinanceReportsView.tsx · components/home/LiveOfferingCard.tsx
                   hooks/marketing/useMarketingOverview.ts
9 Discovery        supabase/functions/discover-cards/index.ts · pg_eligible_experiences_for_deck
10 Notif/Links/Web services/oneSignalService.ts · components/notifications/BusinessNotificationsScreen.tsx
                   constants/publicUrls.ts · business.usemingla.com (.web.tsx overrides)
```
