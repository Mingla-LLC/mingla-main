# ORCH-1215 — Mingla Business · Google Play Store Listing Copy (FINAL)

**App:** Mingla Business (the organizer / venue / experience-brand side of Mingla)
**Play package:** `com.sethogieva.minglabusiness`
**Date:** 2026-06-22 · Owner: mingla-product
**Positioning:** experiences / events / venue platform for the supply side. NOT consumer, NOT dating.
**Grounding:** every feature named below is confirmed present in `mingla-business/src` (full audit at the end).

---

## 1) APP NAME (max 30 chars)

| # | Option | Chars | Note |
|---|--------|-------|------|
| A ✅ **RECOMMEND** | `Mingla Business` | 15 | Clean, brand-consistent with the marketing site. |
| B | `Mingla Business: Sell Tickets` | 29 | Adds the #1 ASO keyword ("sell tickets") in the indexed title. |
| C | `Mingla Business — Events` | 24 | Adds the "events" category keyword. |

**Recommendation: Option A — `Mingla Business`.** It matches the marketing site and keeps the brand clean. Play indexes the title heavily, so if Seth wants an ASO boost, **Option B (`Mingla Business: Sell Tickets`)** is the strongest keyword play and still reads clean. The short + full descriptions already carry the keywords, so A is the safe, on-brand default.

---

## 2) SHORT DESCRIPTION (max 80 chars)

| # | Option | Chars | Note |
|---|--------|-------|------|
| A ✅ **RECOMMEND** | `Sell tickets, scan guests at the door, and run your events from one app.` | 71 | Benefit-led, names the 3 hero jobs. |
| B | `Create events, sell tickets, scan guests, get paid — built for organizers.` | 73 | Keyword-dense, adds "get paid" + audience. |
| C | `Publish events, sell tickets, and get paid. The app for venues & organizers.` | 76 | Leads with "publish events," names the audience. |

**Recommendation: Option A.** It front-loads the buyer's top two jobs (sell tickets, run the door) in plain language and reads like a benefit, not a keyword list. Option B is the better pick if Seth wants "organizers" + "get paid" indexed in the short description.

---

## 3) FULL DESCRIPTION (max 4000 chars)

> First two lines below are the "before read-more" hook — front-loaded on purpose.

```
Mingla Business is the home for venue owners, event organizers, and experience brands. Create your events, sell tickets, scan guests in at the door, and get paid — all from your phone.

Your business has a vibe. Your community is looking for it. Mingla Business gives people a reason to show up for you — and brings everything you need to run the night into one app.

CREATE IN MINUTES
Build events, trips, and multi-stop experiences with a guided creator. Add a cover photo or video, set your tickets and pricing, and publish to a clean public page you can share anywhere. Editing later is just as easy.

SELL TICKETS AND GET PAID
Sell tickets right in the app. Buyers check out fast — card or Google Pay — and your earnings are paid straight to your bank. Payments and payouts work for the US (Stripe) and Nigeria (Paystack). Pricing is all-in and transparent, so what your guests see is what they pay, with no surprises at checkout.

RUN THE DOOR
Turn your phone into a ticket scanner. Check guests in by scanning their QR code, sell tickets on the spot for walk-ups, and watch a live guest list as the room fills. Add comp guests and export your list when the night's done.

REACH THE PEOPLE WHO SHOW UP
Send branded email blasts to the people who've bought from you, and grow an audience that comes back again and again. Promote a specific event or your whole brand.

SNAP YOUR MENU INTO EXPERIENCES
Got a menu? Snap it, and Mingla helps you turn your dishes and activities into ready-to-publish experiences in seconds.

ONE CLEAR DASHBOARD
See your sales, your guests, and how each event is performing — without spreadsheets. Track what's working so you can do more of it.

ARI, YOUR AI PARTNER
Ari, your built-in assistant, helps you name your vibe, shape your listing, and plan your marketing — so you're never staring at a blank screen.

BUILT FOR YOUR JOB
Whether you run a restaurant, a venue, a recurring night, a one-off event, or a brand built on experiences, Mingla Business is made to fill seats, sell out rooms, and keep your regulars coming back.

Mingla Business is the organizer side of Mingla — the experiences platform that puts your events in front of the right people at the right moment.

Questions or feedback? Tap Support in the app or email support@usemingla.com.
```

**Char count: ~2,360 / 4,000.** Comfortable headroom; trim or extend to taste. No banned claims (no "best/#1/top," no fake urgency, no competitor names, no price claims, no emoji-keyword spam, no unbackable testimonials).

---

## GRAPHICS STILL NEEDED (not copy — design deliverables)

These are **required by Google Play** for this listing and must be produced by design (mingla-designer / Seth). The app icon exists in-repo (`mingla-business/assets/images/icon.png`, orange `#eb7825`) but the Play-spec exports below still need to be cut:

| Asset | Spec | Status / Owner |
|-------|------|----------------|
| **App icon** | 512×512 PNG, 32-bit, ≤1MB | Source exists in-repo; needs 512×512 export. Design. |
| **Feature graphic** | 1024×500 PNG/JPG | REQUIRED — must be produced. Design. |
| **Phone screenshots** | 2–8, ≥1080px on the long edge, 16:9 or 9:16 | REQUIRED. Need **4+** for Play promotional/featuring eligibility. Must show the **BUSINESS** app: creator wizard, sell-tickets / public page, door scanner, live guest list, dashboard, Ari. NO consumer screenshots. Design + on-device capture. |
| **7-inch tablet screenshots** | ≥1080px, 1–8 | Play marks these required for this listing. Capture on a 7" emulator/device. Design. |
| **10-inch tablet screenshots** | ≥1080px, 1–8 | Play marks these required for this listing. Capture on a 10" emulator/device. Design. |
| **Promo / preview video** (optional) | YouTube URL | Optional, both stores. Nice-to-have. |

> ⚠️ Tablet screenshots are flagged **required** for this listing in Play Console — they are the most likely blocker. Assign to design now.

---

## KEYWORD THEMES TARGETED (for ASO)

The copy is built to rank for these themes (woven naturally, not stuffed):

1. **Sell tickets / online ticketing / ticket sales**
2. **Event management / event organizer / event app**
3. **Box office / door scanner / QR ticket scanner / check-in**
4. **Venue management / for restaurants, venues, organizers**
5. **Experiences / trips / multi-stop experiences**
6. **Get paid / payouts / accept payments (Stripe, Paystack, Google Pay)**
7. **Email blasts / event marketing / promote your event**
8. **Guest list / attendee management**
9. **AI assistant for events (Ari)**
10. **Nigeria + US payments** (Paystack / Stripe — regional discovery)

---

## ⚠️ DECISIONS FOR SETH TO CONFIRM

1. **App name** — recommend **A (`Mingla Business`)**; choose **B (`Mingla Business: Sell Tickets`)** only if you want the ASO keyword in the indexed title.
2. **Short description** — recommend **A**; pick **B** if you want "organizers" + "get paid" indexed.
3. **"Snap your menu" in the listing** — included as a feature paragraph because it's shipped (ORCH-1144/1151), but it's a niche/early feature. ⚠️ Confirm you want it surfaced to ALL businesses in the store copy, or cut that paragraph to keep the listing tighter.
4. **Existing listing check** — ⚠️ confirm no Play listing already exists under a different name/package before publishing (avoid a name/package conflict). Package is `com.sethogieva.minglabusiness`.
5. **Category** — **Business** (per brief). Optional but not set here.
6. **Contact details** (Play main store listing): Email `support@usemingla.com` · Website `https://usemingla.com/organisers` · Privacy `https://usemingla.com/privacy-policy`.
7. **Graphics** — tablet + phone screenshots + feature graphic are required and unbuilt; assign to design.

---

## FEATURE AUDIT — everything named above is shipped (verified in `mingla-business/src`)

| Feature in copy | Confirmed at |
|---|---|
| Brand/venue creation & management | `components/brand/BrandCreationFlow.tsx`, `BrandEditView.tsx` |
| Event publishing | `app/event/create.tsx`, `components/event/EventCreatorWizard.tsx` |
| Trip publishing | `app/trip/create.tsx`, `components/trip/TripCreatorWizard.tsx` |
| Experience publishing (multi-stop) | `app/experience/create.tsx`, `components/experience/ExperienceStopsStep.tsx` |
| Cover photo or video | `components/event/CreatorStep4Cover.tsx`, `utils/eventCoverNativeVideo.ts` |
| Public shareable page (event/trip/exp/brand) | `components/event/PublicEventPage.tsx`, `constants/publicUrls.ts` |
| Ticket sales via Stripe | `payments/StripeProviderWrapper.tsx`, `payments/nativeCheckoutFlow.ts` |
| Google Pay / Apple Pay | `payments/nativeCheckoutFlow.native.ts` (explicit applePay + googlePay) |
| Paystack (Nigeria) | `payments/nativeCheckoutFlow.native.ts`, `components/brand/BrandPaystackOnboardView.tsx` |
| Payouts — Stripe Connect | `components/brand/BrandPaymentsView.tsx`, `utils/brandPayout.ts` |
| Payouts — Paystack | `components/brand/BrandPaystackOnboardView.tsx`, `hooks/useBrandPaystack.ts` |
| All-in / transparent pricing | (ORCH-1147 shipped) cart reads server all-in |
| Door scanner (QR check-in) | `components/scanners/ScannerHome.tsx`, `app/event/[id]/scanner/index.tsx` |
| Door sales (walk-up) | `components/door/DoorSaleNewSheet.tsx`, `store/doorSalesStore.ts` |
| Live guest list + comp + CSV export | `app/event/[id]/guests/index.tsx`, `utils/guestCsvExport.ts` |
| Email blasts / marketing | `components/marketing/*`, `app/event/[id]/blasts/index.tsx` |
| Snap menu → experiences | `app/experience/snap.tsx`, `components/experience/MenuSnapInput.tsx` |
| Dashboard / analytics | `components/brand/BrandFinanceReportsView.tsx`, `hooks/marketing/useMarketingOverview.ts` |
| Ari AI assistant | `screens/ari/AriChatScreen.tsx`, `components/ari/*` |

Brand voice grounded in `mingla-marketing/app/organisers/page.tsx` + `components/sections/organiser-home/*` (tagline: *"we give people a reason to show up for you"*; *"Your business has a vibe. Your community is looking for it."*).
