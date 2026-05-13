# WeTravel Competitive Ingest — Research Report (ORCH-0825)

> **Type:** Competitive research (read-only, no code or spec produced).
> **Purpose:** Canonical reference for Mingla Business 1.2 Tr3-Tr7 SPECs (installments, refunds, intake forms, group chat, room-share). Read this BEFORE writing any of those SPECs.
> **Owner:** Claude `mingla-product` skill (RESEARCH mode).
> **Date:** 2026-05-13.
> **Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
> **Companion docs:** `Mingla_Artifacts/MINGLA_BUSINESS_1_2_WORKING_DOC.md`, `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md`, `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`.
> **Confidence labels in this report:** `proven` (from WeTravel's own help docs), `documented externally` (from comparison sites, reviews), `inferred` (from product positioning + adjacent features, not directly verified).

---

## 0. Executive Summary (Plain English, Read This First)

### What WeTravel is

WeTravel is the dominant SaaS booking + payments platform for multi-day group tour operators — yoga retreat hosts, bachelorette curators, food tour planners, student-trip organizers, wine-tour operators. It's an all-in-one stack covering itinerary publishing, deposit + installment collection, traveler info gathering, document signing, and supplier payouts. Free tier exists; Pro is $79/month. Founded in 2016, growing steadily, well-reviewed (4.7/5 on Capterra) but with a few sharp customer complaints around refund handling and fee transparency.

### The most important findings for Mingla Business 1.2

**1. WeTravel has NO native cascading-tier refund engine.** The cancellation policy is text-only — the organizer writes a policy paragraph, and then manually processes refunds matching what they wrote. This is the **single biggest gap Mingla 1.2 Tr4 can win on**. Building a real cascading refund engine (date-tier policy → automatic refund calculation → installment-aware math → Stripe execution) puts Mingla ahead of WeTravel from day one.

**2. WeTravel has NO group chat.** Their "messaging" feature is broadcast-only email-style. The organizer sends a message to one or more travelers; travelers can't reply in a thread, can't see other travelers' messages, can't attach files unless the organizer enables it. There is no per-trip discussion board. **Mingla 1.2 Tr6's group chat is a direct differentiator.** WeTravel users describe communication coordination as one of the platform's weaknesses; Mingla's multi-party chat (built on the Ari infrastructure) is a genuine 10x improvement.

**3. WeTravel has NO room-share matching algorithm.** They support shared-room PACKAGES (organizer creates a "Shared Female Dorm — Bed 1" package, traveler buys a bed). But they don't have an opt-in matching service where two solo travelers indicate preferences and the platform pairs them. Companies that need this (Travel Divas, Sisterhood Travels, Flash Pack) build it themselves outside WeTravel. **Mingla 1.2 Tr7 manual matching is competitive parity; auto-match (future polish) is leapfrog.**

**4. WeTravel installments are mature.** 1-24 installments, custom dates per installment, auto-adjust on late bookings, auto-reminders, auto-billing. Mingla 1.2 Tr3 needs to match this, but the math is well-trodden — Stripe Subscription Schedules or scheduled PaymentIntents handle it. The harder integration is the refund interaction (which WeTravel does poorly per finding #1).

**5. WeTravel intake forms exist but feel like an afterthought.** Each trip has a participant questionnaire, but the schema-builder UX appears limited (the doc trail is sparse; reviews mention "limited customization"). Mingla 1.2 Tr5's drag-drop question builder with seven question types + JSON-schema-driven dynamic rendering is competitive.

**6. WeTravel has NO mobile app for organizers.** The "My Trips by WeTravel" app is view-only for travelers (Capterra-flagged limitation: "no mobile app for customers to manage profiles"). Operators manage trips entirely from the web. Mingla 1.2 ships native mobile-first by definition — direct strategic advantage for operators who work in the field, in transit, at events.

**7. WeTravel has NO buy-now-pay-later integration** (no Klarna, Affirm, Afterpay). The SquadTrip comparison article calls this out specifically. Not currently in Mingla 1.2 scope but worth noting for future.

**8. WeTravel's AI itinerary tool is text-generation, not brochure parsing.** Their AI helps you write better text in the itinerary builder ("Make Shorter", "Improve", "Fix grammar") and can generate from a prompt. It does NOT parse an existing brochure / PDF / Google Doc and produce structured day-by-day. **Mingla 1.2 Tr8's snap-your-brochure → structured day-by-day is a genuine net-new shortcut WeTravel does not offer.**

**9. Per-feature gating is aggressive in WeTravel.** File attachments in messages = Pro only. eSignature = Pro only. Zapier + API + Webhooks = Pro only. Inventory management = Pro only. Custom branding = Pro only. Auto-billing = Pro only. The Basic tier is a teaser. Mingla 1.2's small-group focus suggests pricing strategy: do NOT lock the basic feature set behind a paywall. The features Mingla 1.2 ships (intake forms, group chat, installments, room-share, refund tiers, AI scaffolding) should be table-stakes on the free or low-tier plan; gate only the high-volume / commerce-tier features.

**10. The "small group focus" is real.** WeTravel publicly serves enterprise tour operators AND solo retreat hosts on the same platform. Many features (AI CRM, abandoned-cart automation, inventory-management overbookings, multi-team unlimited members) are enterprise-shaped — not what an 8-30-traveler small-group planner needs. Mingla 1.2 can win the small-group segment by being focused, mobile-first, AI-shortcut-heavy, and community-feature-rich (group chat, room-share, intake) where WeTravel underbuilds.

### Mingla differentiation thesis (one sentence)

> WeTravel built the world's best payment + booking engine for tour operators. Mingla 1.2 builds a community-first, mobile-first, AI-shortcut-heavy seller surface that absorbs WeTravel's payment + booking layer, then leapfrogs them on the parts they treat as afterthoughts: refund automation, group communication, room-share matching, and brochure-to-itinerary AI.

---

## 1. Onboarding & Brand Identity

### How a trip organizer signs up

Trip organizers create an account on `wetravel.com`. The signup is standard — email + password — followed by a **verification step under the "Trust and Verification" tab on the profile page** before they're eligible to receive payments. This is essentially KYC for the organizer's business: they verify their identity and legitimate trip-organizer status before WeTravel will release funds to them. The verification gate is similar in spirit to Stripe Connect's identity verification, although WeTravel handles it through their own onboarding rather than a third-party integration.

Confidence: `proven` per [WeTravel Help Center — How It Works](https://help.wetravel.com/en/articles/253921-how-it-works).

### Identity proof requirements

WeTravel's verification process collects standard business-identity data: name, business name, address, tax ID, bank account for payouts. The platform supports operators globally; verification adapts per jurisdiction. Capterra reviews surface a complaint about WeTravel blocking accounts upon residence change — implying the verification is location-bound and changes trigger re-review (sometimes adversarially).

Confidence: `proven` for the general flow; `documented externally` for the residence-change account-blocking risk per [Capterra reviews](https://www.capterra.com/p/163474/WeTravel/reviews/).

### What's captured at signup

- Business / brand name + slug (becomes part of the public URL)
- Logo / branding for the trip pages
- Bio / about-the-organizer text
- Contact info (email, phone)
- Bank account for payouts
- KYC docs (varies by jurisdiction)
- Stripe Connect option: organizers can connect their own Stripe account instead of using WeTravel's native processing. If they do, they lose access to WeTravel's payout features (international wire, WeTravel Card, Supplier Transfers).

Confidence: `proven` per [Connect your own Stripe account with WeTravel](https://help.wetravel.com/en/articles/3973462-connect-your-own-stripe-account-with-wetravel).

### What's shown publicly about the organizer

Each trip page carries the organizer's brand identity — logo, name, bio. There's a notion of a "trip organizer profile" but the public footprint is centered on individual trips rather than the organizer profile itself. Travelers find an organizer through their specific trip's shareable link or via the WeTravel marketplace listing.

Confidence: `inferred` based on overall product positioning; no help article dedicated to "organizer public page" was found.

### Mingla 1.2 implication

Mingla's trip-planner onboarding (Tr1) makes Stripe Connect a hard prerequisite — completion is the identity proof. This is **stricter than WeTravel's own custom verification flow** (which is opaque and operator-reported as inconsistent). Stripe's KYC is industry-standard, well-documented, and predictable. Mingla wins on identity-proof clarity.

The public brand page on Mingla (`/b/{brandSlug}`) gives trip planners a richer presence than WeTravel offers — their profile + their published trips + their experiences (once they branch into venue-style offerings via the brand-as-container model).

---

## 2. Trip Creation Workflow

### The Itinerary Builder

WeTravel's core trip-creation surface is the **Itinerary Builder** — a tool to build day-by-day schedules in a "beautifully designed format, fully mobile-friendly and shareable." It's positioned as both a planning tool and a marketing artifact ("proposals or lookbooks of the trip experience"). Yoga instructors, retreat coaches, fitness trainers, and group leaders are called out as primary user personas.

Confidence: `proven` per [Creating your Itinerary — Help Center](https://help.wetravel.com/en/articles/10842927-creating-your-itinerary) and [Travel Itinerary Building Software from WeTravel](https://product.wetravel.com/itinerary-builder).

### Wizard steps + screens

WeTravel doesn't structure trip creation as a strict step-by-step wizard with a "next" / "back" pattern. Instead, it presents a **Trip Builder** with multiple tabs the organizer can navigate freely:

- **Trip Overview** — title, hero image, dates, destination
- **Description** — long-form trip description text
- **Itinerary** — day-by-day schedule with images, descriptions, activities, accommodations
- **Packages** — pricing tiers, occupancy options, payment plans, deposits
- **eSignature** — upload PDFs requiring traveler signature (Pro only)
- **Custom Forms / Questionnaires** — traveler intake schema
- **Settings** — public/private, marketing toggles

The organizer can fill these in any order. There's no enforced linear flow.

Confidence: `proven` per multiple help articles cross-referenced.

### Day-by-day fields captured

For each day in the itinerary, the organizer can add:

- Day title (e.g., "Day 1 — Arrival + Welcome Dinner")
- Day narrative (long-form text)
- Activities (each with title, description, optional images)
- Accommodations (linked to inventory resources where applicable)
- Images, videos, descriptions
- Schedule items with times
- Maps / location pins (inferred — interactive maps are mentioned in product positioning)

Confidence: `proven` for fields; `inferred` for the per-activity granularity.

### Multi-destination support

WeTravel supports trips that span multiple destinations (e.g., "Tulum + Mexico City" as a single trip with different cities on different days). The itinerary builder accommodates this implicitly via the day-by-day structure; each day can have its own location.

Confidence: `inferred` from itinerary structure flexibility; no explicit "multi-destination" feature documented separately.

### Image / document upload

- Trip cover image + hero
- Per-day images and videos in the itinerary
- Brochure-style attachments
- Brand logo
- eSignature documents (PDF only, max 25 MB per file)
- Document collection from travelers (waivers, ID scans, visa info)

Confidence: `proven` per [eSignature: How-To Guide](https://help.wetravel.com/en/articles/6306735-esignature-how-to-guide) and [Document collection — Help Center](https://help.wetravel.com/en/articles/3135821-how-to-collect-documents-and-other-files-from-your-clients).

### Save-draft mechanics

Trip pages can be created and edited freely before publishing. The trip can be **public or private** — private booking pages are explicitly supported for organizers who want to share with specific groups only. There's no formal "draft" vs "published" toggle documented as such; instead, the visibility flag controls whether the trip is discoverable.

Confidence: `inferred`; no help article details the draft lifecycle explicitly.

### AI itinerary writing assistant

WeTravel's AI assistant lives inside the Itinerary Builder, accessed via a **sparkle (✨) icon** within text sections. It supports two modes:

1. **From scratch** — operator enters a prompt describing the desired itinerary (audience, tone, activities)
2. **From existing content** — operator selects existing text and chooses "Make Shorter," "Make Longer," "Improve," or "Fix grammar and spelling"

The AI **does not parse an existing brochure / PDF / Google Doc** to generate a structured day-by-day. It's a text-generation tool inside the builder, not a structured-document parser. WeTravel explicitly advises operators to "give the content a quick review" — there's no formal accept/reject confirmation card system.

Confidence: `proven` per [How to Use AI to Write Amazing Itineraries in WeTravel](https://help.wetravel.com/en/articles/11157005-how-to-use-ai-to-write-amazing-itineraries-in-wetravel).

### Mingla 1.2 implication

The Itinerary Builder UX is the most-praised feature in WeTravel reviews. Mingla 1.2 must match its visual polish (Tr2's wizard pattern + Tr8's AI scaffolding). But the **structural difference is significant**:

- **Mingla 1.2 Tr8** parses an existing brochure / PDF / Google Doc into structured day-by-day rows via Gemini structured-output. This is WeTravel's blind spot.
- **Mingla 1.2 Tr2** uses an explicit wizard (Basics → Itinerary → Inclusions → Pricing → Review) rather than a free-tab editor. Wizards are friendlier for first-time small-group planners.
- **Mingla's AI confirmation cards** (accept / edit / reject per day) are stricter than WeTravel's "regenerate or copy/paste" — this is a quality bar Ari already enforces (`I-ARI-CONFIRM-AUTHORITY`).

---

## 3. Pricing Tiers

### Package model

WeTravel structures trip pricing around **Packages**. Each package is a distinct purchasable bundle: occupancy type + price + included features. An organizer creates multiple packages for the same trip to offer different price points:

- **Single occupancy** — private room, full price
- **Double occupancy** — shared room with one other person, lower per-person price
- **Single supplement** — variant of double occupancy where the traveler pays extra to NOT share
- **Shared (girls)** — shared dorm with female travelers (typically 3-4 per room)
- **Shared (boys)** — same with male travelers
- **Dorm-style** — multi-bed shared room with mixed occupancy

Each package is its own SKU with its own price, deposit, payment plan, and inventory cap.

Confidence: `proven` per [Inventory Management: How-To Guide](https://help.wetravel.com/en/articles/8331461-inventory-management-how-to-guide).

### Inventory linkage

Packages can be linked to **Resources** (Pro feature). An accommodation Resource defines: room type, room name, total quantity available, capacity per room, privacy setting (private/shared), and sharing configuration ("shared girls," "shared boys," etc.). The Resource is connected to one or more Packages. As bookings come in, the Resource Calendar tracks remaining capacity and flags **"Overbooked"** in red if the org accidentally sells more than capacity allows.

Customers don't see the resources — only the packages. The resource layer is internal management.

Confidence: `proven` per the help article.

### Early-bird pricing

WeTravel supports **discount codes** and **seasonal pricing adjustments** (the latter is a Pro feature). Early-bird is typically implemented as a discount code that expires on a specific date, OR as a separate package ("Early Bird — Save $200, book by Jan 15") that's hidden after the cutoff. There is no native first-class "early bird" feature; it's a convention organizers implement using existing primitives.

Confidence: `inferred` — discount codes are explicitly documented; "early bird as separate package" pattern is the conventional workaround.

### Group discount

WeTravel supports **quantity-based discount codes** but doesn't document a native "buy 3 spots, save 10%" group-discount engine. Organizers either create a separate "Group of 3+" package OR use discount codes.

Confidence: `inferred`; no native group-discount feature found.

### Currency handling

WeTravel supports **multi-currency checkout** — buyers pay in their preferred currency, and the system converts at daily rates. Native currencies (no extra FX fee within WeTravel): USD, GBP, EUR, CAD, ZAR, AUD. Other currencies are converted at daily rates. **Inter-wallet exchanges on WeTravel are free.**

The organizer sets the package price in their preferred currency. The traveler sees prices in their preferred currency (auto-detected or selected). Stripe Connect users get standard Stripe FX fees instead.

Confidence: `proven` per [Multi-Currency Checkout on WeTravel](https://help.wetravel.com/en/articles/8694062-how-does-multi-currency-checkout-work-on-wetravel).

### Add-ons

Each trip can have optional **add-ons** — extras the traveler can purchase alongside the base package (e.g., "Airport transfer +$50", "Excursion to Cenote +$80"). Add-ons can have their own payment plan separate from the base package's.

Confidence: `proven` per [How to create an add-on and set up a payment plan for it](https://help.wetravel.com/en/articles/6309755-how-to-create-an-add-on-and-set-up-a-payment-plan-for-it).

### Mingla 1.2 implication

Mingla 1.2 Tr2's pricing model (single tier at start, multi-tier via `trip_pricing_tiers` table) matches WeTravel's package model. The key things to inherit:

- Pricing tiers as discrete SKUs (one ticket_type row per tier)
- Single supplement as a tier variant
- Shared-room packages as separate tiers
- Per-tier inventory caps

Things Mingla can deferrably **skip in Phase 1**:
- Resource-level inventory abstraction (overbooking warnings, etc.) — Pro WeTravel feature, complex, not small-group critical
- Discount codes — defer
- Add-ons — defer (a Tr-future-polish item)

Mingla should add what WeTravel underbuilds: **first-class early-bird pricing** with a clear "Save $X if booked by date" affordance in the wizard, rendered cleanly to the buyer at checkout.

---

## 4. Installment Payment Engine

This section is the most important reference for Mingla 1.2 Tr3.

### Installment configuration

WeTravel allows **1 to 24 installments** per booking. The organizer configures, at the package level:

- Number of installments
- Due date for each installment
- Amount for each installment (defaults to equal monthly distribution; fully customizable)

The system defaults to monthly equal installments but allows the organizer to override both amounts and dates. There's no formal limit on the date span beyond a maximum-installment cap; payments can be scheduled "based on trip departure dates to minimize dispute risk" (specific algorithm not detailed).

Confidence: `proven` per [Payment Plans — How They Work & Setup](https://help.wetravel.com/en/articles/1270486-payment-plans-how-they-work-setup).

### Deposit mechanics

Deposits and upfront payments are **always due on the day of booking** — their due dates cannot be moved. Once the deposit is configured, partial payment of the deposit is not allowed — the deposit must be paid in full before installment payments can begin.

If no deposit is set, the traveler can pay any partial amount at booking and then continue paying installments.

Confidence: `proven`.

### Auto-billing

The "auto-billing" feature is a Pro tier capability. When enabled, **"Participants will be automatically charged to their saved payment method on each payment date."** The saved payment method is captured at booking via a Stripe-equivalent SetupIntent. Subsequent installments fire automatically per the schedule.

Confidence: `proven`.

### Auto-adjust for late bookings

If a traveler books AFTER one or more scheduled payment dates have already passed, WeTravel's **Auto-adjust payment plan for late bookings** feature redistributes the missed installments across the remaining future installments. This is enabled by default for late bookings and prevents the awkward "you owe $X immediately for past-due installments" UX.

Confidence: `proven`.

### Missed payment handling

WeTravel sends **automatic reminder emails** before each installment due date. The specific cadence isn't documented in the public help articles (likely Day-7, Day-3, Day-of). For failed installments:

- The system attempts the charge on the scheduled date
- If it fails (declined card, expired card, insufficient funds), the system marks the installment failed
- Reminder emails go to the traveler asking them to update payment
- **The specific retry cadence is not publicly documented** — capabilities like "retry every 3 days for 3 weeks" or "after N failures, mark booking at-risk" appear to be implemented but the exact rules aren't published.

When a payment is genuinely missed (not just delayed), WeTravel's system **automatically adjusts** future installments — the remaining balance (excluding the deposit) is redistributed across remaining installment dates.

Confidence: `proven` for the adjustment behavior; `inferred` for the retry cadence specifics.

### Plan modifications

Organizers cannot **cancel** an existing payment plan (once active). They CAN:
- Adjust the payment plan to a single installment (collapse to full upfront collection)
- Edit individual participants' payment plans from the "Manage Trip" view; the participant is auto-emailed with the new schedule

The plan-modification UX requires per-participant editing rather than bulk template changes once bookings exist.

Confidence: `proven`.

### Refund interaction with installments

This is where WeTravel weakens. The refund process is **manual two-step**:

1. Cancel the booking (or add-on) from Manage Trip
2. Issue the refund as a SEPARATE action — operator enters the refund amount manually

Critically, **WeTravel does not auto-compute "refund this much per the cancellation policy, distributed across installments collected so far."** The organizer must do this math themselves and enter the amount manually. The system does NOT enforce the declared cancellation policy.

Confidence: `proven` per [How to refund and cancel just one person of a multiple-person booking](http://help.wetravel.com/en/articles/415090-how-to-refund-and-cancel-just-one-person-of-a-multiple-person-booking).

### Stripe vs WeTravel native processing

If the organizer uses WeTravel's native processing, the installment engine is built on WeTravel's own infrastructure (presumably backed by Stripe under the hood). If the organizer connects their own Stripe account, they lose access to WeTravel's payout features (international wire, WeTravel Card, Supplier Transfers) and pay standard Stripe fees.

Confidence: `proven` per [Connect your own Stripe account](https://help.wetravel.com/en/articles/3973462-connect-your-own-stripe-account-with-wetravel).

### Customer-reported weaknesses

From Capterra and G2 reviews:

- "Customers are told they are paid in full, then when they add something, they can't make payments any longer" — implies the installment engine doesn't handle add-on-after-deposit cleanly
- "Issuing refunds is a nightmare" — confirms the manual two-step refund pain
- "When donors send overpayments, it causes accounting issues" — overpayment handling is poor
- "Cannot stop and save during the booking process" — buyer-side checkout doesn't tolerate interruption

Confidence: `documented externally` per Capterra/G2 reviews.

### Mingla 1.2 Tr3 implications

| WeTravel approach | Mingla 1.2 Tr3 approach |
|---|---|
| 1-24 installments, custom dates per | Match: same range, same flexibility |
| Deposit always at booking, undelayable | Match: deposit at booking, immovable |
| Auto-billing via SetupIntent + saved card | Match: Stripe SetupIntent at booking + auto-charge on schedule |
| Auto-adjust on late bookings | Match: redistribute missed installments across remaining |
| Reminder emails before due date | Match: same pattern via Resend dunning pipeline (ORCH-0785) |
| Failed installment → manual operator awareness | **Beat:** "at-risk" status flag in operator dashboard + dunning email pattern from ORCH-0785 |
| Refund manual two-step, no policy enforcement | **Massively beat:** Tr4's cascading-tier refund engine auto-computes refund from policy + installment ledger |
| Cannot cancel active payment plan | Match: edits scoped to single-installment collapse OR per-participant adjustment |
| Add-on-after-deposit causes payment confusion | **Beat:** defer add-ons to a future cycle; do single-tier first, get the math right |

The fundamental Mingla 1.2 Tr3 architecture (per project spec §3.5 — `ticket_types.installment_schedule` JSONB + `order_installments` ledger) is the right shape. The ledger-driven approach makes Tr4's refund math possible in a way WeTravel doesn't support.

---

## 5. Refund Tiers (THE Differentiation Section)

### The core finding: WeTravel does NOT have a cascading-tier refund engine

This is the single most important finding of the entire research pass. **WeTravel's cancellation policy is text-only.** The organizer writes a policy paragraph in the trip description ("Full refund if cancelled 60+ days out, 50% refund 30-60 days out, no refund within 30 days"). Then, when a traveler cancels:

1. The traveler contacts the organizer
2. The organizer manually decides the refund amount per the declared policy
3. The organizer manually processes the refund in Manage Trip

The system does NOT:
- Parse the policy text into structured tier data
- Automatically calculate the correct refund amount based on cancel date vs trip start
- Distribute the refund correctly across collected installments
- Enforce that the organizer can't accidentally refund more than the policy allows
- Show the traveler an automatic "you'd receive $X back per the policy" preview at cancel time

Confidence: `proven` per [Cancellation/Refund Policies](https://help.wetravel.com/en/articles/253925-cancellation-refund-policies) — "Cancellation/refund policies are usually set by the organizer and vary by trip."

### Default behavior when no policy is set

If the organizer doesn't write a policy at all, WeTravel's default is **all payments are non-refundable.** This protects the organizer but is harsh on the traveler.

Confidence: `proven`.

### Refund processing mechanics

When the organizer decides to issue a refund:

1. **Cancel the booking** from Manage Trip → Cancel Booking or Add-On
2. Choose: apply paid amount toward remaining balance, OR retain as fee, OR proceed to refund
3. **Issue Refund** from booking menu → Refund a Payment
4. Enter the refund amount manually
5. Confirm

Processing takes 5-10 business days. Cannot be reversed once issued. The original payment method receives the refund (best practice; alternate methods possible).

WeTravel fees are reimbursed proportionally on refund — the platform doesn't keep its cut. Payment processing fees (Stripe etc.) are deducted from the operator's balance.

Confidence: `proven` per [How to refund and cancel](http://help.wetravel.com/en/articles/415090-how-to-refund-and-cancel-just-one-person-of-a-multiple-person-booking).

### Multi-person bookings

If one buyer booked spots for 2 people and one needs to cancel, the operator manually selects which participant to cancel and then processes a proportional refund. The system doesn't automatically calculate "1 of 2 paid = $X / 2 = $Y refund" — operator does it.

Confidence: `proven`.

### Installment-aware refunds

WeTravel does NOT have explicit installment-aware refund math. If a traveler has paid 2 of 3 installments and needs a refund:

- Operator manually checks how much was actually collected
- Operator manually determines (per policy) what % should be refunded
- Operator manually enters that refund amount
- Operator manually decides whether the remaining installment is cancelled or what to do with it

This is the core pain point. Customer reviews call it "a nightmare."

Confidence: `proven` from process docs; `documented externally` from customer reviews calling it nightmare.

### Customer voice on refund pain

From Capterra/G2:
- "Issuing refunds is a nightmare"
- "When donors send overpayments, it causes accounting issues"
- "Felt unsupported during a chargeback dispute, reported they were treated like a thief and threatened with legal action"
- "Non-transparent fees" — refund-related fees are unclear

This is consistent with the manual-process finding. The pain isn't just the math; it's the lack of system support during high-emotion moments (someone wants their money back).

Confidence: `documented externally`.

### Mingla 1.2 Tr4 implications — the biggest differentiation opportunity

Tr4 builds a **first-class cascading refund engine** that WeTravel doesn't have:

1. **Structured policy stored as JSONB** — `events.refund_policy = {tiers: [{before_days: 60, refund_pct: 100}, {before_days: 30, refund_pct: 50}, {before_days: 0, refund_pct: 0}]}`
2. **Templates** — flexible / standard / strict presets, plus custom builder
3. **Auto-calculation** — given cancel date + trip start date + amount collected so far across `order_installments` ledger, system computes exact refund
4. **Buyer-side preview** — at cancel time, buyer sees "You will receive $X back" before they confirm
5. **Installment-aware math** — refund correctly distributed across collected installments, with each installment row in `order_installments` flipped to `status='refunded'`
6. **Future installment handling** — remaining scheduled installments automatically cancelled or paused
7. **Stripe execution** — refund fires automatically via Stripe Connect after policy + math is confirmed

This is the **single biggest WeTravel-beat in Mingla 1.2.** Real organizers describe their refund process as a nightmare. Building real automation here is genuine customer-trust currency.

---

## 6. Traveler Intake Forms

### Participant Questionnaire

WeTravel's intake feature is called the **Participant Questionnaire**. Each trip has its own questionnaire that travelers fill out at booking time (or shortly after — they can edit later). The organizer can also edit participant info on behalf of the traveler from Manage Trip → View Booking Details → Edit participant information.

Confidence: `proven` per [How to update participant questionnaire info](https://help.wetravel.com/en/articles/6184099-how-to-update-participant-questionnaire-information-on-behalf-of-your-client) and [How can I update my information in the questionnaire](https://help.wetravel.com/en/articles/1720779-how-can-i-update-my-information-in-the-questionnaire).

### Schema configuration

The schema-builder UX appears to support custom fields, but the available documentation is sparse on the configuration UX itself. Reviews on Capterra mention "limited customization" and customers requesting more flexibility. The "Contact Us forms" feature explicitly allows custom fields and CRM-style capture for warm leads, which suggests the underlying schema builder can handle arbitrary fields — but the per-trip questionnaire UX may be more constrained.

Confidence: `proven` for existence; `documented externally` for the "limited customization" criticism.

### Field types

The exact list of field types isn't published in any single help article reviewed. Inferred from "Contact Us forms" + standard intake-form patterns:

- Short text (name, passport number, etc.)
- Long text (special requests, allergies)
- Email / phone (validated)
- Date (DOB)
- File upload (passport scan, ID)
- Single-choice select
- Checkbox / multi-choice

Confidence: `inferred`; not fully documented.

### Required vs optional

The system supports marking fields as required or optional, but the exact UX for setting this isn't visible in the public docs. Likely a checkbox in the schema-builder.

Confidence: `inferred`.

### Conditional fields ("if vegetarian, what kind?")

No documentation found supporting conditional / dependent fields. This is likely a gap WeTravel doesn't fill — operators who need it use external form tools.

Confidence: `inferred`; absence in docs strongly suggests not supported.

### File upload (passport, visa)

Yes — supported via the "Collect documents and other files" feature. Travelers upload files at the time of booking or via a follow-up request. Files are linked to their booking. The organizer can download all files in bulk for a trip.

Confidence: `proven` per [How to collect documents and other files from your clients](https://help.wetravel.com/en/articles/3135821-how-to-collect-documents-and-other-files-from-your-clients).

### Edit-after-submit

Travelers can update their own questionnaire answers after booking. The organizer can also edit on the traveler's behalf. There's no formal "versioning" — the latest answer is the answer.

Confidence: `proven`.

### Templating

There's no public documentation of "intake form templates" the operator can apply ("import the default trip-intake template with passport + dietary + emergency"). The operator builds the questionnaire from scratch per trip. This is a workflow drag.

Confidence: `inferred`; absence of template docs suggests not supported.

### Export capability

Questionnaire answers are included in the **Participant Manifest Excel export** — accessible via Manage Trip → Download → Excel. Participant info appears on the second sheet of the Excel workbook ("Participant Information"). Passport details and other intake data are included.

Confidence: `proven` per [Participant Manifest](https://product.wetravel.com/participant-manifest) and [Where to find a summary of booking and participant information per trip](https://help.wetravel.com/en/articles/2251567-where-to-find-a-summary-of-booking-and-participant-information-per-trip).

### Mingla 1.2 Tr5 implications

WeTravel's intake is functional but feels like an afterthought:

- Field types: limited
- Schema reuse: per-trip build from scratch
- Conditional logic: absent
- UX: clean enough but reviews flag "limited customization"

Mingla 1.2 Tr5's design (per project spec §3.4 — `events.trip_intake_schema jsonb` + `orders.intake_form_data jsonb` + drag-drop builder with 7 question types + template defaults + dynamic rendering at checkout) **matches or exceeds WeTravel on every dimension**:

- More question types (short text, long text, single-choice, multi-choice, file upload, date, phone)
- Drag-drop builder with template defaults that operators can apply with one tap (passport, dietary, emergency contact, T-shirt size, room-share preference)
- File upload via Supabase Storage with RLS-scoped signed URLs
- JSON schema validation server-side
- Operator dashboard showing per-traveler completeness indicator

The features Tr5 should NOT build (parity ceiling, not value-add):
- Conditional fields ("if X, then Y") — defer; not WeTravel-table-stakes
- Cross-trip schema reuse beyond templates — defer
- Custom export beyond CSV/PDF — defer

---

## 7. Group Chat / Discussion Board (Critical Differentiation)

### The core finding: WeTravel has NO group chat

WeTravel's "messaging" feature is broadcast-only, email-style. The organizer composes a message and sends it to one or more travelers. Travelers receive it as an email-like communication. **There is no per-trip thread where travelers can reply and see each other's messages.** There is no community communication channel — only operator-to-traveler announcement.

Confidence: `proven` per [How to message specific participants at once](https://help.wetravel.com/en/articles/6781247-how-to-message-specific-participants-at-once), [Messaging Your Clients collection](https://help.wetravel.com/en/collections/1396236-messaging-your-clients), and explicit absence of any "discussion / chat / forum" article in the help center.

### What WeTravel's messaging DOES support

- **Bulk messaging** — message all participants OR selected subset
- **Selective targeting** — choose specific participants for the send
- **Customizable subject + sender + reply-to address** — looks like an email blast from the organizer
- **Message scheduling** — set a send time in the future; edit before send
- **File attachments** — Pro feature only; standard file types
- **Message copying** — duplicate and modify previous messages

Confidence: `proven`.

### Per-trip thread structure

Messages live within the trip's Manage Trip dashboard under the **Messages** section. Each message is a one-way broadcast: organizer → N selected participants. There's no concept of:

- Travelers replying within a thread visible to other travelers
- Travelers seeing what messages have been sent (only their own inbox shows what they received)
- Travelers DMing each other
- Travelers DMing the organizer in-platform (replies typically go to the configured reply-to email address)

Confidence: `proven` for the broadcast-only model; `inferred` that travelers can email the configured reply-to (this is standard email behavior, just not in-app).

### Notifications

Email notifications fire on new messages. There's no published documentation of push notifications for the dedicated traveler "My Trips" app being triggered by new organizer messages. The traveler app is described as view-only for itinerary.

Confidence: `inferred`; absence of push-notification docs for messaging suggests the channel is email-primary.

### Customer voice on communication weakness

Reviews don't call out the absence of group chat directly because operators don't think to ask for it (the platform never offered it). But adjacent complaints:
- "No mobile app for customers to manage profiles" — implies travelers want richer in-app engagement
- "Communication tools to convert travel bookings" academy articles emphasize EMAIL + LIVE CHAT for inquiries — confirms the messaging model is email-centric
- Several travel-company case studies describe operators building **Facebook Groups / WhatsApp groups** for pre-trip community — implies travelers and operators WANT a group conversation channel, just not getting it from WeTravel.

Confidence: `documented externally` from absence-of-pain explicit + adjacent positive evidence.

### Mingla 1.2 Tr6 implications — the second-biggest WeTravel-beat

Tr6 builds a **real per-trip group chat** that WeTravel doesn't have:

1. **`event_threads` + `event_thread_messages` tables** — one thread per trip
2. **RLS scoped to confirmed buyers + brand members** — security right
3. **Multi-party** — every confirmed traveler + planner posts and reads
4. **Optional broadcast-only mode** — operator can lock posting if needed (matches WeTravel's default)
5. **Attachments** — file + image, RLS-scoped via Supabase Storage
6. **Push notifications** — via existing OneSignal pipeline (Mingla already runs this)
7. **Ari summarization** — optional ("summarize the last 50 messages") — leverages Ari infrastructure
8. **Documents tab** — for pre-trip docs (waiver, packing list)

Group chat is THE differentiator alongside refund tiers. Both leverage Mingla's existing infrastructure:
- Group chat extends Ari's chat patterns (multi-party scoped to ticket-holders)
- Refunds extend the existing `refund-order` edge function from ORCH-0787

This combination — **the platform finally gives operators a real community channel + automated refund handling — is the value proposition that wins trip-planner mindshare.**

---

## 8. Document Sharing

### eSignature feature (Pro)

WeTravel's eSignature feature lives in the Trip Builder's eSignature tab. The organizer uploads PDFs (max 25 MB each, PDF format only) and optionally marks them as mandatory-at-checkout. Travelers who book must sign before paying.

Signing UX:
1. Traveler scrolls through the document
2. Types their name (typed signature)
3. Confirms legal binding via checkbox
4. Clicks Sign

The organizer tracks signing status via the Bookings tab's eSignature column (green icon = signed, grey = pending). Signed documents can be bulk-downloaded from Manage Trip → Download → Signed Documents.

Confidence: `proven` per [eSignature: How-To Guide](https://help.wetravel.com/en/articles/6306735-esignature-how-to-guide).

### Reminders

WeTravel auto-sends a reminder to the traveler immediately after purchase asking them to sign. If still unsigned after 2 days, an additional reminder fires.

Confidence: `proven`.

### Document collection from travelers

Separately from eSignature, organizers can collect documents (passports, visas, vaccination records, waivers as uploads) from travelers via the questionnaire's file-upload field. Uploaded files are linked to the booking and downloadable by the organizer.

Confidence: `proven` per [How to collect documents and other files from your clients](https://help.wetravel.com/en/articles/3135821-how-to-collect-documents-and-other-files-from-your-clients).

### Version control

No native versioning. Latest upload replaces previous; organizer must manage version state externally if multiple iterations are needed.

Confidence: `inferred`; not documented.

### E-sign integration with third parties

WeTravel's eSignature is in-platform (typed signature, no SSO with DocuSign/HelloSign/Dropbox Sign). For legally rigorous signatures with audit trails, operators integrate external eSign tools and then upload the signed PDF as a regular document.

Confidence: `inferred`; absence of integration mentions suggests in-platform-only.

### Sharing scope

Documents shared via eSignature are 1:1 — the organizer uploads, the traveler signs their own copy. Pre-trip docs (waiver, packing list, visa info) shared as document files within messages are 1:N — sent as attachments via the messaging feature.

Confidence: `inferred` + `proven`.

### Mingla 1.2 Tr6 implications

Mingla 1.2's document-sharing scope is bundled into Tr6 (Discussion Board) rather than a separate eSignature feature. The model:

- New `trip_documents` Supabase Storage bucket with RLS scoped to confirmed buyers + brand members
- Operator uploads PDFs in trip wizard Step 10 (Pre-trip documents)
- Operator can specify "shared on booking" vs "shared X days before trip"
- Travelers download via the group chat's Documents tab

What Mingla 1.2 should NOT build in v1:
- In-platform eSignature flow (defer; integrate later with external eSign if operators ask)
- Mandatory-at-checkout document signing (defer; first version is share-only)
- Audit trail / version control for documents (defer)

What Mingla 1.2 CAN do as Tr6 polish:
- Auto-share schedule (operator says "share visa info 30 days before departure" and Mingla schedules the notification)
- "Acknowledged" checkbox per traveler per document (lightweight alternative to eSign)

---

## 9. Room-Share Matching (Critical Differentiation)

### The core finding: WeTravel has NO opt-in room-share matching

WeTravel supports **shared-room PACKAGES** (organizer creates a "Shared Female Dorm — Bed 1" package; traveler buys a specific bed). But they do NOT support an **opt-in matching algorithm** where a solo traveler indicates preferences and the platform pairs them with another solo traveler at booking time.

Companies that need real room-share matching (Travel Divas, Sisterhood Travels, Flash Pack) BUILD THEIR OWN matching outside WeTravel — typically via Google Form + manual operator pairing + email coordination.

Confidence: `proven` for inventory/package support; `proven by absence` for matching algorithm (no help article documents anything close).

### What WeTravel does provide

- **Shared-room inventory** — packages can be configured as shared (girls/boys/dorm) with N beds per room
- **Resource Calendar** — tracks which beds in which rooms are sold to whom
- **Rooming list export** — the Participant Manifest Excel includes room assignments

This is enough for an organizer who knows their travelers want to share AND who handles matching outside the platform. It's not enough for a small-group planner who wants the platform to do the matching work for them.

Confidence: `proven`.

### How adjacent travel companies solve it

Travel Divas runs a "Roommate Match Program" — solo travelers submit preferences (smoking, sleep schedule, age, gender), and the company hand-matches via a Google Form pipeline outside WeTravel. Sisterhood Travels does similar. Flash Pack has built room-share matching directly into their own custom booking flow because WeTravel doesn't support it natively.

Confidence: `documented externally` per [Travel Divas Roommate Match Program](https://thetraveldivas.com/roommate-match-program/), [Sisterhood Travels Roommate Matching](https://sisterhoodtravels.com/roommates/), [Flash Pack room-sharing tips](https://www.flashpack.com/us/solo/travel/sharing-room-tips/).

### Preference fields organizers typically collect

From the adjacent-company patterns:
- Gender
- Age range
- Sleep schedule (early bird / night owl)
- Smoking / non-smoking
- Snoring (yes / no / unsure)
- Allergies
- Personal-space preference

These are not standard fields in WeTravel's questionnaire — they're custom-added if operators bother.

Confidence: `inferred` from adjacent-company patterns.

### Mingla 1.2 Tr7 implications — third-biggest WeTravel-beat

Tr7 builds **first-class manual room-share matching** that WeTravel doesn't offer:

1. **Buyer opt-in at checkout** — toggle "Room-share to save the single supplement" + preference fields (gender, age, sleep schedule, smoking)
2. **`orders.room_share_preference` JSONB column** — stores the opt-in + preferences
3. **Planner dashboard Room-Share tab** — shows opted-in travelers with compatibility indicators (color-coded green/yellow/red)
4. **Manual pairing UI** — drag-drop or "pair these two" affordance
5. **`trip_room_assignments` table** — one row per pair, UNIQUE constraint per order_id
6. **Pricing recalc on pair** — single supplement removed, refund or installment adjustment processed
7. **Notifications** — both travelers notified of their roommate

What Tr7 should NOT do in Phase 1:
- Auto-matching algorithm (defer; manual matching is the small-group operator's preferred workflow per case studies)
- Three-way+ rooming (defer; pairs only)
- Roommate request workflow (defer)

The manual-matching workflow with compatibility indicators alone is already a **leapfrog** over WeTravel — operators currently solve this with spreadsheets and email.

---

## 10. Booking Deadline & Capacity

### Pre-registration feature

WeTravel's **Pre-Registration** feature lets prospective travelers express interest before formal booking. They leave phone/email on the trip page; the organizer assesses interest and invites selected pre-registrants to convert. Pre-registrants can be exported via Excel and managed similarly to waitlist.

Confidence: `proven` per [How to Use the Pre-Registration Feature](https://help.wetravel.com/en/articles/8770633-how-to-use-the-pre-registration-feature).

### Inventory caps

Packages and resources have **capacity limits** — the system tracks bookings against capacity and flags **"Overbooked"** in red on the Resource Calendar if more bookings than capacity exist (which shouldn't happen but apparently can in edge cases).

Confidence: `proven`.

### Auto-cancel if min capacity not met

**Not documented.** WeTravel doesn't appear to have a native "automatically cancel the trip if fewer than N travelers have booked by X date" feature. Operators handle min-capacity manually — they decide on a cutoff date themselves and cancel manually if interest is insufficient.

Confidence: `inferred from absence`; no help article addresses this.

### Booking deadline

The trip page can have a soft "register by" date in the description, but the system doesn't enforce a hard cutoff that automatically closes bookings at midnight on the deadline. Operators implement this by manually un-publishing the trip or by manually closing the package.

Confidence: `inferred`; not explicitly documented as a feature.

### Waitlist

Pre-registration partially serves as a waitlist — if the trip is fully booked, operators can collect waitlist signups via the same pre-registration mechanism. There's no automatic "promote waitlist on cancellation" workflow.

Confidence: `inferred`.

### Mingla 1.2 Tr4 implications

Tr4 should:
- Build a **first-class booking deadline** — `events.booking_deadline` timestamptz column, cron that auto-closes bookings at midnight on the deadline, "Bookings closed" UI on the public trip page
- Build **optional auto-cancel-if-min-capacity-not-met** — a per-trip min-capacity threshold; if not met by booking_deadline, auto-cancel the trip and trigger refunds for all booked travelers per the policy

WeTravel doesn't do either of these well. Building them right is a small operator-trust win.

What Tr4 should NOT build:
- Smart waitlist (defer; pre-registration as workaround is acceptable)
- Auto-promote-waitlist-on-cancellation (defer)

---

## 11. Operator Dashboard

### Manage Trip dashboard structure

Each trip in WeTravel has its own management dashboard accessed via My Trips → Manage Trip. The tabs (varies by feature enablement):

- **Overview** — trip basics, status
- **Bookings** — participant list with statuses, payment progress, eSignature status
- **Messages** — sent message history, compose new, scheduled messages
- **Payments** — financial summary, refunds, custom prices, discount codes
- **eSignature** — uploaded documents, signing status per participant
- **Resources** — accommodation inventory and bookings
- **Settings** — trip configuration

Confidence: `proven` per various help articles.

### Cross-trip dashboard

A separate **My Trips** view lists all trips the operator has created (active, draft, ended). A **Reporting dashboard** visualizes data aggregated across all trips — useful for operators running multiple trips per year.

Confidence: `proven` per [Multi-Day Travel Businesses](https://product.wetravel.com/multi-day-travel-businesses).

### Excel export

Participant Manifest is exportable to Excel from Manage Trip → Download → Excel. Two sheets:
- **Bookings** — names, statuses, packages, payments
- **Participant Information** — questionnaire answers, passport details, custom field data

Confidence: `proven`.

### Money / revenue view

The Payments tab on each trip shows:
- Total collected per traveler
- Outstanding installments per traveler
- Refund history
- Discount code usage

The cross-trip Reporting dashboard aggregates revenue across all trips. WeTravel Card balance (virtual Visa for instant access) is separately viewable.

Confidence: `proven` per pricing + product docs.

### Communication summary

Sent messages are logged per trip in the Messages tab. There's no unified "communication center" across trips — each trip's messages are siloed.

Confidence: `inferred`.

### Mobile

The operator dashboard is web-only. The "My Trips by WeTravel" mobile app is view-only for travelers, not for operators. This is a customer-flagged weakness on Capterra.

Confidence: `proven` per [Does WeTravel have a mobile app](https://help.wetravel.com/en/articles/2794463-does-wetravel-have-a-mobile-app).

### Mingla 1.2 implications

Operator dashboard for trips (per Tr2's spec — Overview + Travelers + Money + Discussion + Manage + Marketing tabs) should match WeTravel's depth plus add:

- **Native mobile-first** — Mingla Business operates fully on iOS/Android, not just web. Operators can manage a trip from their phone at a conference, during a flight, on-site at the retreat. This is a fundamental advantage.
- **Discussion tab** — per Tr6
- **Marketing tab** — leverages existing Marketing Hub for blasting past-trip-takers (`brand_followers` audience + new `trip_alumni` audience kind in `marketing_audiences`)
- **Unified marketing** — across all trips, the existing campaign UI lets operators run cross-trip blasts

What Mingla doesn't need to match in Phase 1:
- Cross-trip reporting aggregation (defer; per-trip is enough for small-group)
- WeTravel Card / supplier transfer / advanced payout options (defer; Stripe Connect is sufficient)

---

## 12. Buyer-Side Discovery & Checkout

### Two discovery paths

WeTravel offers two ways for a traveler to find a trip:

**1. Direct link sharing** (primary path)
The organizer creates the trip page, gets a shareable link (e.g., `wetravel.com/trips/<trip-slug>`), and distributes it via their own channels: social media, email, website, in-person, ads. The link drives directly to the trip page where the traveler can book.

**2. WeTravel marketplace** (secondary path)
Trips can be featured on the WeTravel marketplace (`wetravel.com/trips`). Travelers can browse the marketplace to discover trips. Variety includes yoga retreats, student trips, bachelorette trips, dance trips, team travel.

The marketplace is positioned as a "side benefit" for organizers — the primary funnel is operator's own audience reaching the trip via direct link.

Confidence: `proven` per multiple sources cited above.

### Trip page structure (buyer view)

The public trip page renders:
- Hero image + trip title + dates
- Day-by-day itinerary (visual, image-rich)
- Inclusions / exclusions
- Pricing tier picker (packages)
- "Book Now" CTA (or "Reserve" for pre-registration)
- Optional add-ons
- Organizer profile (logo, bio)
- Cancellation policy (text the organizer wrote)
- Q&A section / contact form

Confidence: `inferred + proven` from product docs + comparison articles.

### Checkout flow steps

Standard pattern:
1. Pick package (occupancy tier)
2. Add add-ons (optional)
3. Buyer info entry (name, email, phone)
4. Questionnaire fill (passport, dietary, etc.)
5. eSignature if mandatory
6. Payment method selection (card, bank transfer)
7. Payment (deposit OR full)
8. Confirmation page + email

Capterra complaint: "Cannot stop and save during the booking process" — implies the checkout doesn't tolerate interruption gracefully. If the buyer abandons mid-flow, they have to start fresh.

Confidence: `inferred + documented externally`.

### Payment methods

- **Credit cards** — Visa, MasterCard, Amex, Diners, Maestro
- **Bank transfers** — ACH (US), SEPA (EU), iDeal, PAD (Canada), PayTo (Australia) — fee-free in WeTravel's native processing
- **WeTravel wallet** — buyer-side wallet for some currencies

Confidence: `proven`.

### Mobile traveler experience

The "My Trips by WeTravel" mobile app exists for travelers (iOS and Android). It's **view-only** — shows the trip itinerary, dates, schedule, basic details. Bookings, payments, and profile management all happen on the web. Available offline once synced.

Confidence: `proven` per [My Trips by WeTravel](https://help.wetravel.com/en/articles/11165352-my-trips-by-wetravel-mobile-app-for-travelers).

### Confirmation experience

After payment, buyer receives:
- Confirmation email with trip details
- Access to their booking page (web)
- Optional pre-trip messages from organizer
- Mobile app sync for itinerary viewing

Confidence: `proven`.

### Mingla 1.2 implications

**Discovery:**
- Mingla's Trips tab in consumer Discover (C1) competes directly with WeTravel marketplace. Mingla's edge: the consumer app already has organic discovery via signal-scored Discover for venues + events; trips slot into the same intent-matching surface.
- Mingla's direct-link path is identical (`/t/{brandSlug}/{tripSlug}` per the Tr2 spec).

**Checkout:**
- Tr2 ships a clean 4-step buyer flow (tier pick → buyer info → intake form → Stripe PaymentSheet → confirmation)
- Tr7 adds room-share opt-in step
- Tr3 makes installment schedule visible at payment step
- **Mingla beats WeTravel on "cannot stop and save"** — Tr2 should bake session-storage resume support into the buyer flow so abandoned carts can resume

**Mobile:**
- The consumer Mingla app is mobile-native, booking-ready, fully functional. Travelers can book + manage from their phone — WeTravel's view-only mobile app is a clear weakness.

**Cancellation visibility:**
- WeTravel's cancellation policy is buried in the trip description text. Tr4's structured `events.refund_policy` JSONB can be rendered as a clean visual ladder at checkout AND on the trip page — "Cancel before [date]: 100% refund; before [date]: 50%; after: 0%". Genuine UX win.

---

## 13. Multi-Currency Handling

### Supported currencies

**Native** (no extra FX fee):
- USD (United States Dollar)
- GBP (British Pound)
- EUR (Euro)
- CAD (Canadian Dollar)
- ZAR (South African Rand)
- AUD (Australian Dollar)

**Supported via daily-rate conversion** ("almost any currency"): JPY, MXN, BRL, INR, SGD, NZD, CHF, NOK, SEK, DKK, PLN, etc.

Confidence: `proven` per [Pricing | WeTravel Help Center](https://help.wetravel.com/en/articles/434422-pricing).

### How planner sets vs how buyer pays

The organizer sets the package price in **one base currency** (e.g., USD for a US-based operator). The buyer at checkout sees prices in either:
- The base currency (default)
- Their detected local currency (auto-converted at daily rates)
- A manually selected currency

If the buyer pays in a different currency from the base, WeTravel handles the conversion at daily rates. The organizer's wallet receives the funds in the buyer's payment currency by default; the organizer can convert between wallet currencies (e.g., move EUR to USD) free of extra fee within WeTravel's wallet system.

Confidence: `proven` per [Multi-Currency Checkout](https://help.wetravel.com/en/articles/8694062-how-does-multi-currency-checkout-work-on-wetravel) and [Convert Currencies Within WeTravel](https://help.wetravel.com/en/articles/9039078-convert-currencies-within-wetravel).

### FX behavior on installments

Each installment is charged in the buyer's payment currency. If exchange rates shift between installments (e.g., buyer's EUR weakens against organizer's USD), the buyer's per-installment EUR amount stays constant (set at booking time) but the organizer receives different USD amounts per installment after conversion. This is consistent with how most subscription platforms handle multi-currency.

Confidence: `inferred from standard subscription FX behavior`; not explicitly detailed in help docs.

### Customer complaints

From Capterra/G2:
- "Non-transparent international charges, with some mentioning slow Stripe payouts and non-transparent fees for Australian customers"
- "While WeTravel charges 3% for credit card use, with additional fees, the total came out to just over 6%" — implies FX-related uplifts are surprising

Confidence: `documented externally`.

### Mingla 1.2 implications

For Mingla 1.2 small-group focus, **multi-currency is largely deferrable**:

- The small-group planner targeting US travelers in USD doesn't need it
- The international retreat operator does need it but it's a Phase 2 polish

**What Tr2-Tr3 should do in Phase 1:**
- Trip pricing in the brand's `default_currency` (already a column on `brands`)
- Buyer pays in the brand's currency (Stripe handles the buyer's bank/card conversion transparently)
- No multi-currency wallet system

**What can come later (Phase 2):**
- Multi-currency checkout (buyer chooses currency)
- Currency conversion fee transparency (a UX area where WeTravel is criticized — Mingla can win)
- Multi-wallet system

This deferral is consistent with the small-group focus principle.

---

## 14. Revenue Model & Pricing

### WeTravel's pricing structure

**Basic — Free**
- Essential payment and trip management tools
- Limited features (eSignature, attachments, integrations all gated)
- Aimed at small operators with a few trips per year

**Pro — $79/month** (billed monthly or annually)
- AI-assisted itinerary builder
- AI-powered travel CRM
- eSignatures
- Participant task collection
- Inventory management
- Lead capture (Ask a Question, Download Brochure)
- Abandoned cart automation
- Custom branding / white-label elements
- Auto-billing
- Seasonal pricing adjustments
- Integrations (API, Zapier, Google Analytics)
- Unlimited team members
- Webhooks

**Enterprise — Custom pricing**
- For large-scale tour operators
- Requires sales contact

Confidence: `proven` per [WeTravel Subscription Plans](https://product.wetravel.com/pricing).

### Transaction fees

Quoted as low as **1% + $0.30 per transaction** on WeTravel's own product page, but customers report higher effective rates after FX and Stripe fees:

- Credit card: ~3% base + Stripe processing + international/FX uplift
- ACH / SEPA / PAD / iDeal / PayTo (bank transfers): fee-free or near-zero in WeTravel native processing
- Stripe Connect option: standard Stripe rates apply directly

Confidence: `proven` for base rate; `documented externally` for the effective ~6% complaint from Capterra reviews.

### Free trial + guarantee

- **60-day free trial** for new Pro subscribers
- **30-day money-back guarantee** on Pro upgrades

Confidence: `proven`.

### Where WeTravel takes its money

Three revenue streams:
1. **Monthly subscription** ($79/month Pro × thousands of operators × 12 months)
2. **Transaction fees** (% per booking)
3. **FX/currency conversion** (margin on cross-currency transactions, especially non-native)

This is a healthy, well-positioned SaaS model. The growth lever WeTravel uses heavily is the free Basic tier as acquisition + Pro upsell once operators outgrow Basic.

Confidence: `inferred from pricing structure`.

### Customer voice on pricing

Capterra/G2 themes:
- **Pricing concerns:** "users describe commissions as 'excessive' and request lower credit card processing fees"
- **Fee transparency:** "non-transparent fees and international charges"
- **Effective vs quoted rates:** "while WeTravel charges 3% for credit card use, with additional fees, the total came out to just over 6%"

These are recurring themes. Operators feel they pay too much and don't trust the fee math.

Confidence: `documented externally`.

### Mingla 1.2 pricing implications

Mingla 1.2 is part of the broader Mingla Business app — pricing for the business app is a separate strategic decision (and not in 1.2 scope). But the WeTravel pricing observations inform:

**What Mingla should do:**
- **Be transparent about fees** — the single biggest WeTravel complaint. Show effective rate (including FX, processing, platform) at every step where money flows.
- **Don't over-gate features** — WeTravel's "everything is Pro" model creates frustration. Group chat, intake forms, refund tiers, installments should be in the base tier (these are table-stakes, not premium add-ons). Reserve Pro gating for high-volume features (AI, advanced analytics, integrations, unlimited team).
- **Stripe Connect is fine** — Mingla's existing Stripe Connect setup means transaction fees flow directly through Stripe's standard rates. Less FX margin to argue about.

**What Mingla should consider:**
- A small platform fee per transaction (1% or so) to fund the build
- OR a subscription tier for high-volume operators (e.g., $X/month for analytics + advanced AI + integrations)
- OR fee-free + paid-per-feature unlocks

Pricing strategy belongs in a separate Product mode session — flagging it as a follow-up but not designing it here.

---

## 15. What WeTravel Does Well

A consolidated list of WeTravel's genuine strengths Mingla 1.2 must match (or accept losing on).

### Strong: Itinerary builder visual polish

The Itinerary Builder is consistently praised as easy to use and producing beautiful output. Reviews mention "create a full itinerary in 15 minutes" and "clean and easy to use." The end product (the public trip page) looks professional.

**Mingla must match:** Tr2's wizard pattern + the public trip page at `/t/{slug}` must be visually polished. Mingla's existing design system (per `mingla-business/src/constants/designSystem.ts`) should make this achievable.

### Strong: Payment processing reliability

WeTravel handles the payments-platform mechanics well. Multi-currency native, bank-transfer support across regions, multi-installment, automatic billing, instant payouts via WeTravel Card. The technical reliability is mature.

**Mingla matches via Stripe Connect:** Mingla's existing Stripe Connect integration handles all of the same payment-mechanic complexity. No re-implementation needed.

### Strong: Customer support

Reviews praise the human support team — responsive, knowledgeable, personalized training. This is a competitive moat WeTravel earned.

**Mingla needs investment:** Customer support for trip planners is a separate growth investment that's not 1.2 scope. Flag it as a critical post-launch growth area.

### Strong: Integrations breadth

Pro tier offers Zapier (8000+ apps), webhooks, API, native Stripe Connect. This is a real advantage for operators with existing tool stacks.

**Mingla doesn't need to match in 1.2:** small-group focus + no marketing-platform target means deferring most integrations. Future.

### Strong: WeTravel Card + supplier transfer

The virtual Visa Card and supplier transfer network are differentiated payment-platform features. They give operators control over how money flows.

**Mingla doesn't need to match in 1.2:** these are mature payment-platform features that aren't critical for the small-group trip-planner persona Mingla 1.2 targets. Defer.

### Strong: Mature inventory/resource management

The Resource + Package linkage with overbooking warnings is well-thought-out for operators running multiple recurring trips.

**Mingla doesn't need full parity in 1.2:** simpler per-tier capacity caps are sufficient for small-group. Resource-level inventory abstraction can come later if demand surfaces.

### Strong: AI itinerary text generation

The sparkle-icon AI writing assistant (✨) is a clean UX for prose generation. Operators use it.

**Mingla matches AND beats via Tr8:** the AI brochure parser → structured day-by-day is a different and more valuable AI shortcut. Both can coexist (Tr8 plus polish-cycle "rewrite this day's narrative" via existing Ari pattern).

### Strong: Pre-registration + lead capture

Pre-registration as a "soft launch" gauge of interest + Ask-a-Question + Download-Brochure lead capture tools are real growth instruments.

**Mingla can match selectively:** Tr-future-polish could add pre-registration / interest-tracking. Lead capture (Ask-a-Question, Brochure) overlaps with Marketing Hub from ORCH-0815 — possibly more powerful in Mingla's ecosystem.

---

## 16. What WeTravel Does Badly (Critical for Differentiation)

This section is the most important for Mingla's positioning. Every Tr3-Tr7 milestone should exploit one of these gaps.

### Bad: Refund handling

**The biggest weakness.** Customer reviews call it "a nightmare." The cancellation policy is text-only, refunds are manual two-step, no installment-aware math, no policy enforcement, no buyer-side preview. When a high-emotion event happens (someone cancels their trip), WeTravel's system gives the operator zero help — they're back to spreadsheet math and good faith.

**Mingla 1.2 Tr4** is THE direct fix.

### Bad: No group chat / community channel

Communication is broadcast-only. Travelers can't reply to each other in-thread, can't see who else is on the trip, can't ask questions in a community channel. Operators end up building Facebook Groups or WhatsApp groups outside the platform. This fragments coordination and the platform misses retention opportunities.

**Mingla 1.2 Tr6** is THE direct fix.

### Bad: No room-share matching

For trips with mixed solo + shared room demand, operators have to run their own matching workflow outside WeTravel. Adjacent companies (Travel Divas, Sisterhood Travels, Flash Pack) all built their own.

**Mingla 1.2 Tr7** is THE direct fix.

### Bad: No mobile app for organizers

The "My Trips by WeTravel" app is view-only for travelers. Operators manage trips via the web only. Operators who are field-based (running retreats in remote locations, leading tours mid-trip) have no mobile management surface.

**Mingla 1.2 is mobile-native by default.** Every operator surface (trip dashboard, traveler list, money tab, discussion board) works on the phone. This is a fundamental advantage that can't be retrofitted into WeTravel.

### Bad: Cannot pause/resume booking mid-flow

Buyer-side complaint on Capterra: "Cannot stop and save during the booking process." If a buyer starts checking out, gets interrupted, and comes back later, they restart from zero. This loses conversions.

**Mingla 1.2 Tr2 buyer flow should support resume.** Session storage on the buyer's device tracks where they were; coming back to the link picks up where they left off. The existing checkout pattern (per `mingla-business/app/checkout/[eventId]/payment.tsx` web-resume payload) is the pattern.

### Bad: No BNPL integration (Klarna, Affirm, Afterpay)

SquadTrip's comparison article explicitly highlights this — operators want buy-now-pay-later options for their travelers. WeTravel offers only their own installment plans.

**Mingla 1.2 doesn't need to fix in Phase 1:** installments via Mingla's own engine cover the value. BNPL is a future-cycle polish.

### Bad: Refund-process customer-support adversarial in disputes

One reviewer who moved 100K through the platform reported being "treated like a thief and threatened with legal action" during a chargeback dispute. This is anecdotal but recurring as a theme — when things go wrong, the platform sides with itself.

**Mingla wins by being operator-aligned by default.** The platform supports the operator, not vice versa.

### Bad: Account blocking on residence change

Some users reported their WeTravel accounts blocked after relocating, with no clear remediation path. This is a verification-system rigidity.

**Mingla uses Stripe Connect verification** — industry-standard, predictable, portable across residences (Stripe handles change-of-residence cleanly via standard KYC re-verification).

### Bad: Slow SEPA payouts (up to 6 days)

EU operators report slow payout cycles. Stripe Connect direct is faster.

**Mingla via Stripe Connect** inherits Stripe's standard payout speed.

### Bad: Limited image library + English-only platform

Reviews mention limited stock image library and English-only support. Operators in non-English-speaking markets feel underserved.

**Mingla can match selectively** — stock images aren't a 1.2 priority, but English-only is acceptable for the early launch. Multi-language is a later cycle.

### Bad: Cancel-active-payment-plan not supported

Operators can collapse to single-installment but can't fully cancel an existing plan once active. This forces a refund-then-rebook workaround.

**Mingla 1.2 Tr3 should support plan cancellation** — pause / cancel / restructure operations on `order_installments` rows are explicit, audit-logged, and operator-controlled.

### Bad: "Excessive commissions" reputation

Operators feel they pay too much. Effective rate is ~6% per one customer's math, vs the ~3% headline.

**Mingla's transparent pricing** (per ORCH-0825 audit on what Mingla already has — Stripe Connect direct, no Mingla margin on transactions in business app today) gives a cost advantage. The strategy question of whether to add a platform fee later is separate.

### Bad: Conditional intake fields absent

The intake schema doesn't support "if vegetarian, what kind?" or "if room-share opt-in, then preferences." Operators want this; WeTravel doesn't offer it.

**Mingla 1.2 Tr5** can ship without conditional fields as v1 (per the brief's Open Polish section), but as a Tr-future-polish it's a clear win.

### Bad: Booking deadline not auto-enforced

The trip page can show a deadline but doesn't automatically close bookings at midnight. Operators manually unpublish.

**Mingla 1.2 Tr4** auto-closes via cron. Operator UX win.

---

## 17. Small-Group Focus Alignment

WeTravel serves both enterprise tour operators and individual retreat hosts on the same platform. Many features are enterprise-shaped and aren't critical for the 8-30-traveler small-group focus Mingla 1.2 targets.

### Features small-group planners actually use

These are Mingla 1.2 targets:

- Trip page builder + day-by-day itinerary
- Payment plans (deposit + 2-4 installments typical)
- Package configuration (single, double, single supplement, shared)
- Custom intake form (passport, dietary, emergency contact)
- Pre-trip messaging (broadcast updates)
- eSignature for waivers
- Document collection (passport, insurance)
- Refund processing
- Marketplace listing
- Stripe-equivalent payment processing
- Mobile traveler view

### Features enterprise tour operators use that small-group doesn't need

These are NOT Mingla 1.2 targets:

- **AI-powered travel CRM** — enterprise lead pipeline tools. Small-group planners track relationships informally.
- **Abandoned cart automation** — enterprise volume play. Small-group converts via personal touch.
- **Inventory management with resource calendar** — enterprise multi-trip recurring inventory. Small-group runs one trip at a time with simple capacity caps.
- **Unlimited team members + role permissions** — enterprise team org. Small-group is 1-2 people running everything.
- **Webhooks + API + Zapier 8000-app integrations** — enterprise tool-stack integrations. Small-group works in WeTravel + email + Google Docs.
- **WeTravel Card / supplier transfer / instant payouts** — enterprise cashflow optimization. Small-group does standard bank payouts.
- **Custom branding / white-label** — enterprise B2B reselling. Small-group operates under their personal brand.
- **Advanced reporting dashboards** — enterprise analytics. Small-group cares about per-trip outcomes.
- **Seasonal pricing adjustments** — enterprise yield management. Small-group does early-bird via discount codes.

### Mingla 1.2 sizing implication

Small-group scope keeps the build focused:
- **Max trip capacity 100** (per project spec §8 DEC-15) — covers retreats, weekend trips, food tours, bachelorette weekends, yoga retreats
- **8-30 typical** — matches Mingla's brand positioning (experience-app curated outings)
- **No enterprise tooling** — defer AI CRM, abandoned-cart automation, unlimited integrations, advanced inventory abstractions

This is a conscious narrowing. WeTravel succeeds by serving both segments; Mingla 1.2 wins the small-group segment first, then potentially expands later.

---

## 18. Integrations & Extensibility

### Native integrations

WeTravel's Pro tier exposes:

- **Zapier** — 8,000+ apps including Mailchimp, Constant Contact, Salesforce, HubSpot, QuickBooks, Xero, Slack, Google Calendar, WordPress
- **Webhooks** — notify external systems on new booking, payment, cancellation events
- **Public APIs** — direct API access for custom CRMs / ERPs / tour management systems
- **Google Analytics** — built-in tracking
- **Stripe Connect** (standard, alternative to WeTravel native processing)

**All integrations are Pro tier only.** Basic users can't use any of them.

Confidence: `proven` per [WeTravel + Zapier](https://academy.wetravel.com/wetravel-zapier-integration), [WeTravel Webhooks](https://zapier.com/apps/wetravel/integrations/webhook), and [WeTravel Partner APIs](https://product.wetravel.com/api-overview).

### Embedding

WeTravel supports embedded booking widgets and popup checkouts that integrate directly into operator websites. WordPress integration via Zapier or direct embed code.

Confidence: `proven` per [WeTravel WordPress integration](https://zapier.com/apps/wetravel/integrations/wordpress).

### What's NOT integrated natively

- No Slack-style team coordination (Slack via Zapier only)
- No native CRM (relies on Pro-tier "AI-powered travel CRM" inside WeTravel)
- No tax automation (TaxJar, Avalara absent)
- No native survey tools (use questionnaire or external)
- No accounting beyond Xero/QuickBooks Zapier exports

### Mingla 1.2 integrations strategy

**For Phase 1 (1.2 scope):**
- Native Stripe Connect (already done)
- Native Resend email (already done)
- Native OneSignal push (already done)
- Native Google Places autocomplete (already done from ORCH-0824)
- Native Gemini AI (per Tr8 + Ve5-Ve7)
- **No** Zapier, webhooks, API exposure, third-party CRM in 1.2

**For Phase 2 (post-1.2 polish):**
- Webhooks for new booking / payment / cancellation events
- Public API for high-volume operators
- Calendar export (ICS) for travelers — small touch, big UX win
- Maybe Zapier integration

This deferral aligns with small-group focus — small-group planners don't have integration-heavy tool stacks.

---

## 19. Mingla 1.2 Implications (Per-Milestone Map)

Mapping every WeTravel feature/weakness to the relevant 1.2 milestone.

### M0 — Hub Tab Foundation

No direct WeTravel comparison. M0 is Mingla-specific infrastructure (unified data model + universal creator + Hub tab restructure).

### Tr1 — Trip Planner Brand Onboarding

| WeTravel | Mingla Tr1 |
|---|---|
| Custom verification flow (Trust & Verification tab) | Stripe Connect as identity proof — industry-standard, predictable, portable |
| Verification on signup | Same — required before brand is "active" |
| Public organizer profile | Mingla's `/b/{brandSlug}` page (richer than WeTravel's) |
| Brand assets capture (logo, bio) | Tr1 wizard captures name + bio + cover image |

**Tr1 ships parity + better identity-proof clarity.**

### Tr2 — Minimum Viable Trip

| WeTravel | Mingla Tr2 |
|---|---|
| Itinerary Builder (free-form tab) | Wizard pattern (5 steps, autosaved) — friendlier for first-timers |
| Trip page (public, mobile-friendly) | Public route `/t/{brandSlug}/{tripSlug}` (anon-tolerant) |
| Package configuration | `trip_pricing_tiers` sidecar — single tier in Tr2, multi-tier extension via existing ticket_types |
| Inclusions list | `trip_inclusions` sidecar |
| Cannot pause/resume booking | **Mingla wins:** session-storage resume support in Tr2 buyer flow |
| Mobile app view-only | **Mingla wins:** mobile-native end-to-end (operator + buyer) |
| Stripe Connect option | Mingla uses Stripe Connect natively (no own-processing option) |
| Confirmation email via Resend | Same |

**Tr2 ships parity-plus on UX + mobile + pause-resume.**

### Tr3 — Installment Payments

| WeTravel | Mingla Tr3 |
|---|---|
| 1-24 installments, custom dates | Match |
| Deposit always at booking, undelayable | Match |
| Auto-billing via saved card | Match (Stripe SetupIntent + scheduled PaymentIntent) |
| Auto-adjust on late bookings | Match (redistribute missed across remaining) |
| Reminder emails before due | Match (Resend dunning pipeline from ORCH-0785) |
| Failed installment → silent | **Mingla wins:** "at-risk" status flag + dunning email + operator notification |
| Cannot cancel active plan | **Mingla wins:** plan cancellation/restructure operations on `order_installments` |
| No installment-aware refund math | **MASSIVE WIN:** see Tr4 |
| Add-on after deposit messy | Mingla defers add-ons — single-tier first, get math right |

**Tr3 ships parity-plus on operator awareness + plan flexibility.**

### Tr4 — Refund Tiers + Booking Deadline (BIGGEST DIFFERENTIATION)

| WeTravel | Mingla Tr4 |
|---|---|
| Text-only cancellation policy | **MASSIVE WIN:** structured `events.refund_policy` JSONB with cascading tiers |
| Manual two-step refund | **MASSIVE WIN:** auto-computed refund per policy + installment ledger |
| No buyer-side refund preview | **MASSIVE WIN:** "You will receive $X back" preview at cancel time |
| No installment-aware math | **MASSIVE WIN:** ledger-driven refund distribution |
| Booking deadline soft-text | **MASSIVE WIN:** structured `events.booking_deadline` + cron auto-close |
| No auto-cancel-if-min-not-met | **MASSIVE WIN:** optional min-capacity gate |

**Tr4 is THE biggest WeTravel-beat in the entire project.** This single milestone produces "refunds that don't suck" — a tagline-worthy differentiation.

### Tr5 — Traveler Intake Forms

| WeTravel | Mingla Tr5 |
|---|---|
| Per-trip questionnaire | Match (`events.trip_intake_schema` JSONB) |
| Limited field types (inferred) | **Mingla wins:** 7 explicit types (short_text, long_text, single_choice, multi_choice, file_upload, date, phone) |
| Schema build from scratch per trip | **Mingla wins:** template defaults selector (passport, dietary, emergency contact, T-shirt, room-share) |
| File upload | Match (Supabase Storage with RLS, signed URLs for operator download) |
| Edit-after-submit | Match |
| Conditional fields absent | Match (defer; Tr-future-polish) |
| Excel export | **Defer in Tr5** (intake responses in operator UI is enough for 1.2; CSV export later) |

**Tr5 ships parity-plus on types + templates.**

### Tr6 — Discussion Board / Group Chat (SECOND-BIGGEST DIFFERENTIATION)

| WeTravel | Mingla Tr6 |
|---|---|
| Broadcast-only messaging | **MASSIVE WIN:** multi-party group chat scoped to confirmed buyers + brand members |
| No traveler-to-traveler chat | **MASSIVE WIN:** travelers can reply, see each other's messages |
| File attachments Pro-only | **Mingla wins:** attachments in base tier with RLS-scoped storage |
| Email-primary delivery | **Mingla wins:** OneSignal push + in-app (existing Mingla pipeline) |
| No optional broadcast mode | Match (`event_threads.is_broadcast_only` toggle) |
| Document sharing via messages | **Mingla wins:** dedicated Documents tab + scheduled sharing |
| No Ari summarization | **Mingla wins:** "summarize last 50 messages" Ari tool (optional polish) |

**Tr6 is the second-biggest WeTravel-beat.** Combined with Tr4, the value prop is "the platform that finally lets your travelers talk to each other AND automates your refund math."

### Tr7 — Room-Share Matching (THIRD-BIGGEST DIFFERENTIATION)

| WeTravel | Mingla Tr7 |
|---|---|
| Shared-room PACKAGES only | Match + extend |
| No opt-in matching algorithm | **MASSIVE WIN:** opt-in at checkout + preference fields |
| Operators match outside platform | **MASSIVE WIN:** in-platform matching dashboard |
| No compatibility indicators | **MASSIVE WIN:** color-coded compatibility on operator dashboard |
| No pricing recalc on pair | **Mingla wins:** auto pricing adjustment (refund or installment skip) |
| No paired notification | **Mingla wins:** push notification on pair |

**Tr7 is the third-biggest WeTravel-beat.**

### Tr8 — AI Itinerary Scaffolding

| WeTravel | Mingla Tr8 |
|---|---|
| AI text generation (sparkle icon) | Mingla has BOTH brochure-parse AND text generation (separate features) |
| No brochure parsing | **MASSIVE WIN:** snap your brochure → AI → structured day-by-day |
| Generate-from-prompt | Match (existing Ari pattern; not Tr8 scope but adjacent) |
| Generic AI accept/regenerate UX | **Mingla wins:** confirmation cards with explicit accept/edit/reject per day |

**Tr8 ships a genuinely new AI shortcut WeTravel doesn't offer.**

### Ve1-Ve7 — Physical Venues

No direct WeTravel comparison. Physical venues are outside WeTravel's domain entirely (WeTravel serves trip planners, not venue claims). Mingla 1.2 Ve track operates in a different category — adjacent but not directly competitive.

### C1-C2 — Consumer Surfacing

| WeTravel | Mingla C1-C2 |
|---|---|
| WeTravel marketplace (browse trips) | Match via Mingla's Trips tab in consumer Discover |
| Direct link sharing | Match (`/t/{brandSlug}/{tripSlug}`) |
| Categorical browsing | **Mingla wins:** intent-matched signal scoring (date_night, friends_chill, etc.) |
| No multi-stop curation | **MASSIVE WIN:** Mingla-composed multi-stops via C2's composer |
| Mobile traveler app view-only | **Mingla wins:** mobile-native end-to-end |

**C1-C2 wins on integrated discovery experience.**

---

## 20. Recommendations to the Orchestrator (Process)

### Required reading order for Tr3-Tr7 SPECs

When forensics writes the SPEC for any of Tr3-Tr7, the order of reading should be:

1. The milestone's brief at `Mingla_Artifacts/milestones/<Tr*>.md`
2. The project spec at `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` (especially §3 data model master plan)
3. **This document** — specifically the section that covers the relevant WeTravel feature
4. Any prior CLOSE notes from adjacent ORCHs (e.g., ORCH-0787 for refund flow extension)

### Findings that should inform multiple SPECs

- **§5 (Refund Tiers)** is the single most actionable finding — Tr3, Tr4 SPECs must read it
- **§7 (Group Chat)** informs Tr6 SPEC primarily, but Tr5 (intake) should note the absence of in-platform chat as a differentiation point for the operator
- **§9 (Room-Share)** informs Tr7 SPEC primarily
- **§4 (Installment Engine)** informs Tr3 SPEC primarily; Tr4 SPEC's refund logic must consume the ledger
- **§16 (What WeTravel Does Badly)** is a unified differentiation reference for all of Tr3-Tr7

### Process suggestions

1. **Add this document as a hard reference** in each Tr3-Tr7 milestone brief (update §10 "Pipeline Notes Seth-owned" to mention it explicitly)
2. **When writing each Tr SPEC**, forensics should produce a 1-paragraph "WeTravel comparison" section near the top, citing this research and stating where the SPEC differentiates
3. **At each Tr3-Tr7 CLOSE**, the orchestrator's commit message can call out the specific WeTravel weakness Mingla just shipped past — this builds a strong narrative arc

---

## 21. Open Questions for Operator

Items this research surfaced that the operator should consider as Tr3-Tr7 SPECs are written.

### Q1 — Should Mingla 1.2 support "currency selection at checkout" for trip buyers?

WeTravel's multi-currency checkout is mature. Mingla 1.2's small-group focus likely doesn't need it in Phase 1 (buyer pays in brand's `default_currency`, Stripe handles their bank conversion). But for retreat operators with international travelers, this might be a near-term ask.

**Forensics recommendation:** defer to post-1.2. Reopen if real operator demand surfaces in Tr2 TestFlight.

### Q2 — Should the Tr-public-trip page include WeTravel-style "ask a question" lead capture?

WeTravel has Ask-a-Question + Download-Brochure widgets that capture leads (avg 4+ per trip per the product page). Mingla 1.2 Tr2 doesn't include this — buyer flow is direct to Reserve.

**Forensics recommendation:** Tr-future-polish. The Marketing Hub from ORCH-0815 could power this via the existing `marketing_audiences` system. Not Phase 1.

### Q3 — Should Tr6's group chat support traveler-to-traveler DMs?

The Tr6 brief specifies multi-party chat (everyone sees everything in the thread). WeTravel doesn't have any traveler-to-traveler communication. The third tier — traveler-to-traveler DM (private message between two confirmed travelers without the operator) — is a different feature.

**Forensics recommendation:** defer DMs to post-1.2. Group thread is the most operator-valuable layer; DMs come if community demand surfaces.

### Q4 — Should Mingla support "Stripe Standard" connection (operator uses own Stripe)?

WeTravel allows operators to use their own Stripe account at the cost of losing WeTravel-native payout features. Mingla 1.2 doesn't offer this — Stripe Connect via Mingla is the only path.

**Forensics recommendation:** keep the current Mingla approach. Stripe Connect via Mingla is simpler for operators (one onboarding, one set of fees). Adding own-Stripe option doubles support complexity.

### Q5 — Should Tr8's brochure parser also offer "from prompt" generation (parity with WeTravel's sparkle icon)?

Tr8 ships brochure parsing. WeTravel offers "from prompt" + "rewrite existing." The two are complementary — brochure parsing for first-time setup, prompt-based for ongoing edits.

**Forensics recommendation:** Tr8 ships brochure parsing only. "Rewrite existing day" via Ari (using the existing chat pattern + agent_pending_actions) is a natural Tr-polish or future cycle. Don't bloat Tr8.

### Q6 — Should Ve experiences (Ve5-Ve7) carry similar refund tiers?

Mingla 1.2 Tr4 builds refund tiers for trips. Should the menu-derived experiences (Ve5) and other Ve experiences carry the same cascading-tier engine? Or are experiences too short-duration to warrant the same complexity?

**Forensics recommendation:** experiences are typically single-event (book on Saturday for Sunday brunch). Simpler refund policy is fine — extend Tr4's engine optionally to event_type='experience' if demand surfaces, but don't build it preemptively.

---

## 22. Confidence Statement

This research was conducted on 2026-05-13 via WebSearch + WebFetch. Direct fetches of `wetravel.com` (homepage, /features, /pricing) returned HTTP 403 (bot-blocked). Help center articles, academy articles, product page subdomains, and review sites (Capterra, G2, SquadTrip's comparison) were accessible.

Per-finding confidence:

| Finding | Confidence | Sources |
|---|---|---|
| Installment mechanics (§4) | High (`proven`) | Help Center articles |
| Refund-policy text-only (§5) | High (`proven`) | Help Center + customer reviews |
| Group chat absence (§7) | High (`proven` by absence of contrary docs) | Help Center messaging articles |
| Room-share matching absence (§9) | High (`proven` by absence + adjacent-company patterns) | Help Center + Travel Divas / Sisterhood Travels patterns |
| Pricing tiers + fees (§14) | High (`proven`) | Pricing page + reviews |
| AI itinerary text-only (§2) | High (`proven`) | Help Center AI article |
| Mobile app view-only (§12) | High (`proven`) | Help Center mobile-app article |
| Multi-currency (§13) | High (`proven`) | Help Center multi-currency article |
| Customer complaints (§16) | Medium (`documented externally`) | Capterra + G2 reviews |
| Intake form details (§6) | Medium (`inferred from sparse docs`) | Help Center + indirect evidence |
| Booking-deadline auto-enforcement (§10) | Medium (`inferred from absence`) | Help Center silence |
| Conditional intake fields (§6) | Medium (`inferred from absence`) | Help Center silence |

Overall research confidence: **High** for the headline findings (refund weakness, group chat absence, room-share absence, mobile app weakness, AI shortcut differentiation). **Medium** for the long-tail details. The findings that drive Mingla 1.2 differentiation (Tr3-Tr7 SPECs) are well-supported.

---

## 23. Sources

### WeTravel Help Center

- [Payment Plans — How They Work & Setup](https://help.wetravel.com/en/articles/1270486-payment-plans-how-they-work-setup)
- [How It Works](https://help.wetravel.com/en/articles/253921-how-it-works)
- [Cancellation/Refund Policies](https://help.wetravel.com/en/articles/253925-cancellation-refund-policies)
- [How to message specific participants at once](https://help.wetravel.com/en/articles/6781247-how-to-message-specific-participants-at-once)
- [Messaging Your Clients collection](https://help.wetravel.com/en/collections/1396236-messaging-your-clients)
- [How can I schedule messages to my participants](https://help.wetravel.com/en/articles/6786902-how-can-i-schedule-messages-to-my-participants-on-wetravel)
- [eSignature: How-To Guide](https://help.wetravel.com/en/articles/6306735-esignature-how-to-guide)
- [How to collect documents and other files from your clients](https://help.wetravel.com/en/articles/3135821-how-to-collect-documents-and-other-files-from-your-clients)
- [How to use AI to Write Amazing Itineraries in WeTravel](https://help.wetravel.com/en/articles/11157005-how-to-use-ai-to-write-amazing-itineraries-in-wetravel)
- [Creating your Itinerary](https://help.wetravel.com/en/articles/10842927-creating-your-itinerary)
- [How to Use the Pre-Registration Feature](https://help.wetravel.com/en/articles/8770633-how-to-use-the-pre-registration-feature)
- [Inventory Management: How-To Guide](https://help.wetravel.com/en/articles/8331461-inventory-management-how-to-guide)
- [How to update participant questionnaire information](https://help.wetravel.com/en/articles/6184099-how-to-update-participant-questionnaire-information-on-behalf-of-your-client)
- [How can I update my information in the questionnaire](https://help.wetravel.com/en/articles/1720779-how-can-i-update-my-information-in-the-questionnaire)
- [How to refund and cancel just one person of a multiple-person booking](http://help.wetravel.com/en/articles/415090-how-to-refund-and-cancel-just-one-person-of-a-multiple-person-booking)
- [How does Multi-Currency Checkout work on WeTravel](https://help.wetravel.com/en/articles/8694062-how-does-multi-currency-checkout-work-on-wetravel)
- [Convert Currencies Within WeTravel](https://help.wetravel.com/en/articles/9039078-convert-currencies-within-wetravel)
- [Connect your own Stripe account with WeTravel](https://help.wetravel.com/en/articles/3973462-connect-your-own-stripe-account-with-wetravel)
- [My Trips by WeTravel — Mobile App for Travelers](https://help.wetravel.com/en/articles/11165352-my-trips-by-wetravel-mobile-app-for-travelers)
- [Does WeTravel have a mobile app](https://help.wetravel.com/en/articles/2794463-does-wetravel-have-a-mobile-app)
- [Where to find a summary of booking and participant information per trip](https://help.wetravel.com/en/articles/2251567-where-to-find-a-summary-of-booking-and-participant-information-per-trip)
- [Pricing — Help Center](https://help.wetravel.com/en/articles/434422-pricing)
- [How to create an add-on and set up a payment plan for it](https://help.wetravel.com/en/articles/6309755-how-to-create-an-add-on-and-set-up-a-payment-plan-for-it)
- [How can I request missing eSignatures](https://help.wetravel.com/en/articles/10508389-how-can-i-request-missing-esignatures)
- [How to register cash or check payments](https://help.wetravel.com/en/articles/2105423-how-to-register-cash-or-check-payments)

### WeTravel Product Pages

- [Booking and Payments Software for Tour Operators](https://product.wetravel.com/tour-operators-us)
- [Multi-Day Group Travel Management Software](https://product.wetravel.com/multi-day-travel-businesses)
- [WeTravel Subscription Plans](https://product.wetravel.com/pricing)
- [Participant Manifest](https://product.wetravel.com/participant-manifest)
- [Travel Itinerary Building Software from WeTravel](https://product.wetravel.com/itinerary-builder)
- [WeTravel Partner APIs](https://product.wetravel.com/api-overview)

### WeTravel Academy

- [How To Create A Seamless Travel Booking and Payments Process](https://academy.wetravel.com/bookings-and-payments)
- [How To Offer Easy Online Communication](https://academy.wetravel.com/communication-tools-convert-travel-bookings)
- [Connect WeTravel To Thousands Of Other Apps With Zapier](https://academy.wetravel.com/wetravel-zapier-integration)
- [WeTravel vs Travefy](https://academy.wetravel.com/wetravel-vs-travefy-which-platform-is-right-for-tour-operators-travel-organizers-and-dmcs)
- [WeTravel Basic, Pro, and Enterprise Account Types](https://academy.wetravel.com/wetravel-pro-subscription-plan)

### Reviews + Comparison Sources

- [WeTravel Reviews on Capterra](https://www.capterra.com/p/163474/WeTravel/reviews/)
- [WeTravel Reviews on G2](https://www.g2.com/products/wetravel/reviews)
- [Best WeTravel Alternatives in 2025 — SquadTrip](https://www.squadtrip.com/guides/best-wetravel-alternatives/)
- [7 Best Group Travel Payment Platforms Compared](https://www.squadtrip.com/guides/best-group-travel-payment-platforms-compared/)
- [Top 10 WeTravel Alternatives — G2](https://www.g2.com/products/wetravel/competitors/alternatives)
- [Comparing Leading Travel Software (Medium)](https://youlivetotravel.medium.com/comparing-leading-travel-software-youli-wetravel-group-desk-retreat-guru-rezdy-mtrip-vamoos-cfba8157f201)
- [WeTravel on Capterra (product page)](https://www.capterra.com/p/163474/WeTravel/)
- [WeTravel on GetApp](https://www.getapp.com/hospitality-travel-software/a/wetravel/)

### Adjacent Travel Company Patterns (Room-Share Matching)

- [Travel Divas Roommate Match Program](https://thetraveldivas.com/roommate-match-program/)
- [Sisterhood Travels Roommate Matching](https://sisterhoodtravels.com/roommates/)
- [Flash Pack Sharing a Room](https://www.flashpack.com/us/solo/travel/sharing-room-tips/)

### Zapier Integration Pages

- [WeTravel Integrations on Zapier](https://zapier.com/apps/wetravel/integrations)
- [WeTravel Mailchimp Integration](https://zapier.com/apps/wetravel/integrations/mailchimp)
- [WeTravel Webhooks](https://zapier.com/apps/wetravel/integrations/webhook)
- [WeTravel WordPress Integration](https://zapier.com/apps/wetravel/integrations/wordpress)

---

*End of research report. Ingested into Mingla Business 1.2 planning on 2026-05-13. Tr3-Tr7 SPECs must reference this document.*
