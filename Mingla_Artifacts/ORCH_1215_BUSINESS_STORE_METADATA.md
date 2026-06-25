# ORCH-1215 — Mingla Business · Store Listing Metadata (DRAFT)

**For:** App Store Connect listing + Google Play Store listing copy.
**Bundle:** `com.sethogieva.minglabusiness` v1.0.0 · ASC App ID `6768737367` · Play package `com.sethogieva.minglabusiness`
**Date:** 2026-06-22
**Positioning:** organizer / venue owner / experience brand (the supply side). NOT consumer, NOT dating. Everything marked ⚠️ is a Seth product/positioning decision.

> **App name note:** the in-app `expo.name` is just `"Business"` (`app.json`). The marketing site uses **"Mingla Business"** with the tagline *"we give people a reason to show up for you."* (`mingla-marketing/app/organisers/page.tsx`). ⚠️ The actual STORE name is a Seth decision — recommend **"Mingla Business"** for brand consistency. ⚠️ UNVERIFIED whether a listing already exists under a different name in either store; check ASC App Information + the Play main store listing before publishing to avoid a name conflict.

---

## App Store Connect listing

### App Name (≤30 chars, ASC)
⚠️ DECISION — recommended:
```
Mingla Business
```
(15 chars.) Alternative if you want a descriptor and have room: `Mingla Business: Events` (23). ⚠️ Apple counts the name strictly at 30; keep it short.

### Subtitle (≤30 chars, ASC)
⚠️ DECISION — options (pick one):
```
Run your events & venues
```
(24) · or `Sell tickets. Fill the room.` (28) · or `Events, tickets, payouts` (24)

### Promotional Text (≤170 chars, editable anytime without review)
```
Create events, trips, and experiences, sell tickets, scan guests at the door, and run your marketing — all from one app built for organizers.
```
(≈142 chars.)

### Full Description (≤4000 chars)
```
Mingla Business is the home for venue owners, event organizers, and experience brands. Create, publish, and sell out your events — then scan your guests in at the door, all from your phone.

CREATE IN MINUTES
Build events, trips, and multi-stop experiences with a guided creator. Add a cover photo or video, set your tickets and pricing, and publish to a beautiful public page you can share anywhere.

SELL TICKETS, GET PAID
Sell tickets directly in the app. Buyers pay with card or Apple Pay, and your earnings are paid out straight to your bank — Stripe in the US, Paystack in Nigeria. Pricing is all-in and transparent, so there are no surprises at checkout.

SCAN AT THE DOOR
Turn your phone into a ticket scanner. Check guests in by scanning their ticket QR code, run door sales on the spot, and keep a live guest list as the room fills.

REACH YOUR GUESTS
Send branded email blasts to the people who've bought from you, and grow the audience that shows up again and again.

ONE CLEAR DASHBOARD
See sales, guests, and how each event is performing — without spreadsheets.

YOUR AI PARTNER
Ari, your built-in assistant, helps you name your vibe, shape your listing, and plan your marketing.

Mingla Business is the organizer side of Mingla — the experiences platform that puts your events in front of the right people at the right moment.

Questions or feedback? Tap Support in the app or email support@usemingla.com.
```
(≈1,430 chars — well under 4000. ⚠️ Trim/expand to taste.)

### Keywords field (≤100 chars, ASC — comma-separated, no spaces after commas to save chars)
⚠️ DRAFT — tune for ASO:
```
event,tickets,organizer,venue,box office,door,scanner,RSVP,experiences,payout,sell tickets,manage
```
(≈98 chars.) ⚠️ Do NOT repeat words already in the app name/subtitle (Apple indexes those separately). Avoid trademarked terms.

### Support URL
```
https://usemingla.com/support
```

### Marketing URL ⚠️ (recommended)
```
https://usemingla.com/organisers
```
(The marketing site has a dedicated organizer page.) Fallback: `https://usemingla.com`.

### Primary Category
⚠️ **Business** (per the brief). Secondary (optional): **Productivity**.

### Copyright
```
2026 MINGLA LLC
```

---

## Google Play listing

### App title (≤30 chars)
⚠️ DECISION — recommended:
```
Mingla Business
```

### Short description (≤80 chars)
⚠️ DRAFT — options:
```
Create events, sell tickets, scan guests, and grow — built for organizers.
```
(73) · or `Sell tickets, scan guests at the door, and run your events from one app.` (71)

### Full description (≤4000 chars)
```
Mingla Business is the home for venue owners, event organizers, and experience brands. Create, publish, and sell out your events — then scan your guests in at the door, all from your phone.

CREATE IN MINUTES
Build events, trips, and multi-stop experiences with a guided creator. Add a cover photo or video, set your tickets and pricing, and publish to a shareable public page.

SELL TICKETS, GET PAID
Sell tickets in the app. Buyers pay by card or Google Pay, and your earnings are paid out straight to your bank — Stripe in the US, Paystack in Nigeria. Pricing is all-in and transparent.

SCAN AT THE DOOR
Turn your phone into a ticket scanner. Check guests in by scanning their QR code, run door sales on the spot, and keep a live guest list.

REACH YOUR GUESTS
Send branded email blasts to people who've bought from you and grow an audience that returns.

ONE CLEAR DASHBOARD
See sales, guests, and event performance — without spreadsheets.

YOUR AI PARTNER
Ari, your built-in assistant, helps you name your vibe, shape your listing, and plan your marketing.

Mingla Business is the organizer side of Mingla — the experiences platform that puts your events in front of the right people.

Questions or feedback? Tap Support in the app or email support@usemingla.com.
```

### Category
⚠️ **Business** (per the brief).

### Contact details (Play main store listing)
- Email: `support@usemingla.com`
- Website: `https://usemingla.com/organisers` (or `https://usemingla.com`)
- Privacy Policy: `https://usemingla.com/privacy-policy`

---

## Assets checklist (not copy — flag for Seth/design)

- ⚠️ **App icon** — present (`assets/images/icon.png`, orange `#eb7825` brand).
- ⚠️ **Screenshots** — REQUIRED by both stores; must show the BUSINESS app (creator, dashboard, door scanner, public listing). Consumer screenshots do NOT apply. This is a design deliverable, not in this docs pack.
- ⚠️ **Feature graphic** (Play, 1024×500) — required.
- ⚠️ **App preview video** (optional, both stores).

---

## Decisions Seth must make (⚠️ summary)

1. ⚠️ **Store name** — recommend "Mingla Business" (confirm no existing listing under another name first).
2. ⚠️ **Subtitle / short description** — pick from the options above.
3. ⚠️ **Keyword field** — approve/tune the ASO keyword draft.
4. ⚠️ **Marketing URL** — `usemingla.com/organisers` vs root.
5. ⚠️ **Category** — Business (confirmed by brief) ± Productivity secondary.
6. ⚠️ **Screenshots + feature graphic** — business-specific assets must be produced (design task, out of scope here).
7. All long-form copy above is DRAFT — Seth/mingla-product owns final voice. None of it promises anything unbuilt (events/trips/experiences, ticketing, Stripe+Paystack payouts, door scanner, email blasts, Ari, dashboard are all verified shipped in `mingla-business/`).
