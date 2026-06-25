# ORCH-1215 — Mingla Business · Release Notes (v1.0.0 production launch)

**For:** Play Console "What's new" + App Store Connect "What's New in This Version".
**Version:** 1.0.0 (matches `mingla-business/app.json` `expo.version`).
**Locale:** English (en-US) primary; both stores fall back to default locale for untranslated markets.
**Modeled on:** `ORCH_0977_RELEASE_NOTES.md`. Positioning = **organizer / venue owner / experience brand** — NOT consumer, NOT dating.

---

## Google Play — "What's new" (500-character limit)

Paste this (≈430 chars):

```
Welcome to Mingla Business — the home for venue owners, event organizers, and experience brands.

• Create and publish events, trips, and experiences in minutes
• Sell tickets and get paid out directly to your bank
• Scan attendee tickets at the door
• Reach your guests with built-in email marketing
• Track sales and guests from one dashboard

This is our first public release. Tap Support in the app to send feedback — we read everything.
```

---

## App Store Connect — "What's New in This Version" (4000-character limit)

Paste this (≈760 chars):

```
Welcome to Mingla Business — the easiest way to run your events, venues, and experiences.

Built for venue owners, event organizers, and experience brands, Mingla Business gives you everything you need to fill the room and get paid.

What you can do:
• Create and publish events, trips, and experiences in minutes
• Sell tickets and receive payouts straight to your bank
• Scan attendee tickets at the door with your camera
• Reach your guests with built-in email marketing
• See sales, guests, and performance in one clear dashboard

This is our very first public release, and we're just getting started. Have feedback or a feature idea? Tap Support in the app — we read everything.
```

---

## Notes for the operator

- **Positioning:** copy is organizer/venue-owner focused (the supply side). It follows the house rule — Mingla is an experiences/venue-discovery platform, NEVER a dating app. No "dating," "matches," "singles," or consumer date-planning language.
- **No prohibited terms:** avoids "Best," "#1," "New," "Top," and price/promo language (both stores forbid these in promotional fields).
- **No false IAP claim:** the business app has no in-app subscription — copy promises only ticketing/payouts (real-world goods/services), consistent with the privacy/age-rating answers.
- **Support callout:** points to the in-app Support tab (`app/support/inbox.tsx`) + `support@usemingla.com`, which doubles as the published-contact path for store compliance.
- **Character counts:** Play ≈430/500; App Store ≈760/4000 — both have headroom.
- **Future releases:** swap to specific changelog bullets ("Added…", "Fixed…", "Improved…"). This launch copy is intentionally introductory since it's the first public version.
