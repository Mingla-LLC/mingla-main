# Mingla Business — Optimized ASO Package (FINAL, both stores)

Synthesizes `ORCH_1215_BUSINESS_ASO_RESEARCH.md` (competitor + keyword) and `ORCH_1215_BUSINESS_POSITIONING_BRIEF.md` (code-grounded full scope + truth flags). Date 2026-06-22.

**Core decision:** position as the **create → sell → run → grow** platform for venues & organizers (NOT "tickets-first"). Biggest ASO lever (per research): a **head keyword in the title** — Apple weights the title far above the hidden keyword field; Play indexes title + short + full description.

---

## ✅ LOCKED FINAL (Seth-approved 2026-06-22)

| Field | Value | Chars |
|---|---|---|
| **App name / title** (both stores) | `Mingla: Host, Sell & Grow` | 25 |
| **iOS subtitle** | `Events, tickets, tables & AI` | 28 |
| **iOS keyword field** (100) | `venue,trip,experience,reservation,booking,checkin,boxoffice,organizer,promoter,rsvp,payout,attendee` | 99 |
| **Play short description** (80) | `Create events & experiences, sell tickets, take payments & run the door.` | 72 |
| **Category** (both) | Business | — |
| **Full description** | see the FULL DESCRIPTION block below (truth-checked, unchanged) | ~2,400 |

Title chosen = verb-led, audience-neutral (no "venue"/"business" pigeonhole). Breadth is carried by the subtitle (events/tickets/tables/AI), the keyword field (venue/trip/experience/reservation/booking/organizer/promoter/attendee), and the description. No title/subtitle word is duplicated in the keyword field.

---

---

## CATEGORY (both stores)
**Primary: Business.** (Apple optional secondary: none / Lifestyle.) Every operator analogue — Eventbrite Organizer, DICE Access, Universe BoxOffice, Ticket Tailor, Square, Toast — sits in Business. Avoid Food & Drink and Entertainment/Lifestyle.

---

## APP NAME / TITLE (≤30, both stores) — pick one (Seth's call)

| | Title | Chars | Why |
|---|---|---|---|
| **1 — max search (RECOMMEND)** | `Mingla: Sell Tickets & Events` | 29 | Leads with the #1 operator head term ("sell tickets") + "events". Best ranking. Scope breadth lives in subtitle + keywords + description. |
| **2 — balanced** | `Mingla: Events & Experiences` | 28 | Brand-forward, full-scope ("experiences"), but drops the top converting keyword from the title. |
| **3 — broad operator** | `Mingla: Event Management` | 24 | Owns the category head term; higher competition; less specific. |

Recommendation: **#1** for pure search; **#2** if you want the title itself to carry the "more than tickets" story. (Apple/Play both let you change this later, and you can A/B it via Custom Product Pages.)

---

## iOS SUBTITLE (≤30) — adds NEW keywords not in the title
**Recommended:** `Door scan, payments & guests` (28)
Alts: `Get paid & run the door` (23) · `Payments, check-in & guest list` (31 ✗ too long) → `Payments & guest check-in` (25)

## iOS KEYWORD FIELD (100 chars, comma-no-space, singular, no title/subtitle dupes, no brand names)
```
checkin,boxoffice,organizer,promoter,venue,host,rsvp,payout,attendee,experience,reservation,booking
```
(99 chars. No dupes of name/subtitle words: sell/ticket/event/door/scan/payment/guest are intentionally omitted since they're already in name/subtitle and Apple indexes those slots. Swap candidates if name changes: nightlife, fundraiser, workshop, tour, qr, marketing.)

## PLAY SHORT DESCRIPTION (≤80)
**Recommended:** `Create events & experiences, sell tickets, take payments & run the door.` (72)
Alt: `Sell tickets, get paid, scan guests & run events — for venues & organizers.` (75)

---

## FULL DESCRIPTION (≤4000, both stores; truth-checked — ~2,400 chars)

```
Mingla Business is the all-in-one app for venues, organizers, and experience brands to create, sell, run, and grow live events and experiences — all from your phone.

Your business has a vibe. Your community is looking for it. Mingla Business gives people a reason to show up for you, and brings everything you need to run the night into one place.

CREATE IN MINUTES
Build events, multi-day trips, and multi-stop experiences with a guided creator. Add a cover photo or video, set up your tickets, pricing, and any sign-up details, and publish a clean public page you can share anywhere. Manage your venue too — hours, menu, reservations, waitlist, and availability.

SELL TICKETS AND GET PAID
Sell tickets right from the app with all-in, transparent pricing, so what your guests see is what they pay — no surprises at checkout. Buyers pay by card or wallet, and your earnings are paid out to your bank. Payments and payouts work in the US (Stripe) and Nigeria (Paystack). Offer refunds and payment plans when you need to.

RUN THE DOOR
Turn your phone into a check-in station. Scan guests in by QR code, watch a live guest list as the room fills, add comps, and add team members to help work the door. Export your guest list when the night's done.

GROW THE AUDIENCE THAT SHOWS UP
Send branded email and text campaigns to the people who've bought from you, and build an audience that comes back again and again. Promote one event or your whole brand.

WORK SMARTER WITH ARI
Ari, your built-in AI partner, helps you name your vibe, shape your listing, and plan your marketing. Snap a menu or an activity list and Mingla turns it into ready-to-publish experiences in seconds.

SEE WHAT'S WORKING
Track sales, payouts, and how each event performs with clear finance reports and a live event view — no spreadsheets.

BUILT FOR YOUR JOB
Restaurants, nightlife and music venues, recurring-night organizers, tour and experience brands, and one-off hosts — Mingla Business is made to fill seats, sell out rooms, and keep your regulars coming back.

Mingla Business is the organizer side of Mingla — the experiences platform that puts your events in front of the right people at the right moment.

Questions or feedback? Tap Support in the app or email support@usemingla.com.
```

---

## Truth guardrails baked in (do NOT change copy to violate these)
- Door: "scan / check-in / live guest list / comps" only. **No "take card at the door"** (card reader + NFC are disabled in code). Buyer-side "card or wallet" refers to the online checkout, which is live.
- Marketing: "send email and text campaigns" — **no "track opens/clicks"** (attribution is a placeholder; code forbids an "Opened" label).
- No "know your attendees / CRM" (attendee insight is revenue/sold/scanned only).
- No web scanning / web push claims (native-only).
- No exact fee math (rates are [TRANSITIONAL] hard-coded).

## Keyword themes targeted
sell tickets · event ticketing · event management · box office · qr ticket scanner · event check-in · guest list · venue management · restaurant events · event payments / payouts · event marketing · experiences & trips · organizer/promoter · AI for events.

## ⚠️ Decisions for Seth
1. **Title:** option 1 (max search) vs 2 (brand/scope) vs 3 (category).
2. Subtitle pick. 3. Confirm category Business.
4. Verify no existing live listing under another name/package before overwriting (`com.sethogieva.minglabusiness`).
5. Graphics still required (icon 512, feature graphic 1024x500, phone + 7"/10" tablet screenshots).
