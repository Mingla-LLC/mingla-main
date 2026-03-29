# Full Codebase Audit — Gap Analysis

**Date:** 2026-03-29
**Purpose:** Identify every feature, screen, and user flow NOT previously tracked in LAUNCH_READINESS_TRACKER.md

---

## Before This Audit

- **8 sections** tracked (Auth, Onboarding, Discovery, Collaboration, Social, Notifications, Saved/Boards, Profile)
- **~85 line items** across those sections
- **Heavy coverage** on card deck pipeline (40+ items, 10 hardening passes)
- **Zero coverage** on 10 major feature areas

## After This Audit

- **18 sections** + cross-cutting concerns + admin dashboard
- **~180 line items** tracked
- **~95 new F-grade items** added (completely unaudited)

---

## New Sections Added (All Grade F — Unaudited)

### 9. Map & Location (17 items)
The entire map system — dual map provider (MapLibre + React Native Maps), nearby people, place pins, heatmaps, curated routes, Go Dark privacy, activity feed overlay, filters. This is a massive surface area with 18 component files, 4 hooks, 2 edge functions, and multiple services.

### 10. Direct Messaging & Chat (8 items)
Full chat flow beyond the 4 responsiveness items already audited. Message send/receive, conversation list, presence/typing indicators, broadcast receiver, realtime sync, email notifications.

### 11. Payments & Subscriptions (8 items)
Both paywall screens, RevenueCat integration, subscription service, creator tier gating, feature gates, swipe limits, referral processing. Revenue-critical.

### 12. Calendar & Scheduling (8 items)
Calendar tab, device calendar sync, date picker modals, propose date/time, weekend selection, collaboration calendar, calendar buttons on cards.

### 13. Holidays & Events (7 items)
Holiday categories, holiday experiences, holiday cards, custom holidays CRUD, Ticketmaster events integration. Multiple edge functions.

### 14. People Discovery (10 items)
The people side of Discover — person grid cards, person hero cards, personalized cards, link request/consent flow, phone lookup, enhanced profiles.

### 15. Pairing System (12 items)
Send/receive pair requests, paired profile section, paired saves, paired map cards, pairing info. Some items (pair accepted notification, unpair RPC) already audited and pulled from other sections.

### 16. Sharing & Invites (12 items)
Share modal, user invite, phone invite, invite links, QR codes, invite codes, invite accept screen, collaboration invites, friend request emails, referral notifications.

### 17. Post-Experience & Reviews (9 items)
Post-experience modal, visit recording, voice reviews, experience feedback, visit badges, dismissed cards, deck history, feedback history.

### 18. Booking (2 items)
Booking service, enhanced favorites.

---

## Items Added to Existing Sections

### Section 1 — Auth (+2 items)
- Google Sign-In flow
- Apple Sign-In flow

### Section 2 — Onboarding (+5 items)
- Country/language picker
- Intent selection step
- Travel mode selection
- Friends & pairing onboarding step
- Consent step

### Section 5 — Social (+3 items)
- Friend search (search-users edge function)
- View friend profile
- Mute/unmute friends

### Section 8 — Profile (+5 items)
- Edit bio
- Edit interests
- Privacy controls
- Billing management
- Terms of Service / Privacy Policy screens

---

## Cross-Cutting Concerns Added

### Deep Linking (4 items)
Deep link service routing, session deep links (B grade — already partially audited), universal links, deferred deep links.

### App Lifecycle (11 items)
Splash screen, loading screen, error boundary, error state, offline indicator, app state manager, app handlers, notification system provider, mobile features provider, foreground refresh (B grade), lifecycle logger.

### Analytics & Tracking (8 items)
AppsFlyer, Mixpanel, screen logger, tracked pressable (A grade), user activity, user interaction, session tracker, A/B testing.

### Weather & External Data (6 items)
Weather service, busyness data, geocoding, currency, translation, locale preferences.

### UI Components & Design System (10 items)
Toast system, in-app browser (A), pull-to-refresh (A), image fallback, loading skeleton, keyboard-aware views, success animation, popularity indicators, confidence score, icon map (A).

---

## Admin Dashboard (22 items — ALL NEW)

### Admin Auth & Layout (5 items)
Login, invite setup, app shell, command palette, error boundary.

### Admin Pages (17 items)
Overview, user management, subscriptions, analytics, content moderation, photo pool, email campaigns, place pool builder, seed/scripts, reports, beta feedback, city launcher, table browser, settings, card pool (A grade — already audited), pool intelligence, admin users.

### Admin Components (5 items)
Data table, charts, map visualization, audit logging, CSV export.

---

## Summary by Grade

| Grade | Count | Meaning |
|-------|-------|---------|
| A | ~45 | Launch-ready, tested with evidence |
| B | ~12 | Solid, 1-2 edge cases unverified |
| C | ~5 | Functional, error handling incomplete |
| F | ~118 | Broken or unaudited — cannot ship without review |

---

## Recommended Audit Priority (by user impact × blast radius)

1. **Payments & Subscriptions** — revenue-critical, blocks monetization
2. **Map & Location** — core feature, huge surface area, privacy implications
3. **Direct Messaging** — social feature, realtime complexity
4. **People Discovery** — core social loop
5. **Pairing System** — core social feature
6. **Calendar & Scheduling** — user-facing, device integration
7. **Sharing & Invites** — growth loop
8. **App Lifecycle** — crashes, error boundaries, offline
9. **Post-Experience & Reviews** — engagement loop
10. **Admin Dashboard** — operational, not user-facing (lower priority for launch)
11. **Holidays & Events** — seasonal, can defer
12. **Booking** — unclear if active
13. **Analytics** — important but non-blocking for users
