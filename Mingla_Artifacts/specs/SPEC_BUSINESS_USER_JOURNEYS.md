# Mingla Business — User Journeys (Companion to SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS)

> **Document type:** Section 6 of the design specification
> **Companion to:** `SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS.md`
> **Purpose:** Trace every user journey end-to-end, every branch, every failure state, mobile + web variants, time-on-task, and success metric. Cross-references back to Section 5 screen IDs.
>
> Every persona, every workflow. No path left untraced.

---

## How to read a journey entry

Each journey entry follows this structure:

- **Persona** — who is doing this
- **Pre-state** — what must be true before the journey starts
- **Goal** — what the user is trying to accomplish (their words)
- **Trigger** — what kicks the journey off
- **Happy path** — numbered steps, with screen IDs from Section 5 in `[brackets]`, and decisions called out as branches
- **Branches** — every meaningful decision point with each branch documented
- **Failure paths** — every way this journey can break, what the user sees, what the recovery is
- **Mobile / web divergence** — where the platforms differ
- **Time-on-task (happy path)** — designer-estimated, used as a usability bar
- **Success metric** — what proves this journey worked
- **Linked screens** — index of every screen the designer must mock for this journey

---

# 6.1 Personas

The journeys serve six personas. Personas inherit role permissions per PRD §11.

## 6.1.1 Account Owner — "Sara, founder of Lonely Moth"

**Background:** Independent promoter running monthly soul/R&B parties in Hackney. Solo operator scaling toward a small team. Mid-30s, fluent with mobile-first SaaS, frustrated by Posh + Eventbrite + Mailchimp duct tape. Wants one tool that respects her time.

**She is the journey reference point** — most journeys are documented through her eyes unless a different persona is specified.

## 6.1.2 Brand Admin — "Marcus, day-of-show ops"

**Background:** Sara's right-hand. Owns night-of operations. Doesn't write copy or set price; signs off on guest list, runs door, reconciles cash. Comfortable with phone-first tools.

## 6.1.3 Event Manager — "Aisha, programmer for one event series"

**Background:** Curates a comedy series under Lonely Moth. Has full event-creation rights for her series only; does not see brand finances.

## 6.1.4 Finance Manager — "Theo, accountant, fractional"

**Background:** Sees money, not events. Logs in once a week to reconcile, monthly to close books. Web-first.

## 6.1.5 Scanner — "Joel, door staff for the night"

**Background:** Hired for one night. Phone in hand, scans tickets, occasionally takes door-cash. Knows nothing about Mingla beyond the scanner UI.

## 6.1.6 Attendee variants

- **Attendee A (signed-out, web first-time):** Found the event via Sara's Instagram link, opens it on desktop. Wants to buy 2 tickets fast.
- **Attendee B (signed-in to consumer Mingla, mobile):** Has a Mingla consumer account; tapped "Get tickets" deep-link from Discover.
- **Attendee C (refund-seeker):** Bought tickets, can't make it, wants a refund 48 hours before the event.
- **Attendee D (transfer):** Bought 2 tickets, transferring 1 to a friend who can't pay back yet.

---

# 6.2 Organiser onboarding journeys

## 6.2.1 First-time sign-up via Google (Sara, mobile)

**Pre-state:** No Mingla Business account. App freshly installed. iOS device, signed into a Google account.
**Goal:** Get from app-icon-tap to "first event published" within one focused session.
**Trigger:** Taps Mingla Business app icon.

**Happy path:**
1. App boots → loading splash 1.4 s `[5.13.7]` → routes to Welcome `[5.1.1]`.
2. Sara reads the rotating headline cycle once (~9 s). Taps "Continue with Google."
3. OAuth popup opens. Sara picks her Google account; consent screen confirms scopes (name, email, profile photo). Returns to app.
4. App detects first session → routes to Onboarding Step 1 `[5.1.2]`. Step indicator 1 of 4. Sara taps Next.
5. Onboarding Step 2 `[5.1.3]` pre-fills "Sara Olsen" from Google. She adds phone +44 7700 900000. Next.
6. Onboarding Step 3 `[5.1.4]` — she types "Lonely Moth" in brand name input. Uploads a brand photo from Photos library (square crop). Continue.
7. Brand creation succeeds → BrandContext set → routes to Onboarding Step 4 `[5.1.5]`. She picks "Music" + "Nightlife." Done.
8. Routes to /(tabs)/home `[5.2.1 → Home pendant]`. Empty state: "No events yet. Build the first one — it takes about 4 minutes." CTA Create event.
9. Sara taps CTA → routes to /event/create `[5.4.1]`.

**Branches:**
- **Step 3 skip:** Sara taps Skip on brand creation → routes to home with "Create brand" CTA at top.
- **Brand name taken:** "Lonely Moth" is already a Mingla Business brand → inline error suggests "lonelymoth-london." Sara accepts.

**Failure paths:**
- **Google sign-in cancelled:** OAuth popup dismissed without consent → toast "Sign-in cancelled. Try again." Welcome remains.
- **Network down during sign-in:** Toast "Couldn't reach Mingla. Check your connection." Welcome remains.
- **Phone format invalid:** Inline error on Step 2 input.
- **Brand photo upload failed:** Inline retry on Step 3.

**Mobile / web divergence:** OAuth popup vs full-page redirect (web). Web onboarding uses centered modal-card pattern instead of full-screen steps.

**Time-on-task (happy path):** 90–120 seconds.
**Success metric:** ≥ 80% of new sign-ups complete onboarding through brand creation in one session.
**Linked screens:** 5.1.1, 5.1.2, 5.1.3, 5.1.4, 5.1.5, 5.2.1, 5.4.1, 5.13.7.

## 6.2.2 First-time sign-up via Apple (Sara, mobile)

Identical to 6.2.1 except step 2 uses Apple Sign In sheet, which may return a "Hide my email" relay address. If "Hide my email" is selected:
- Step 2 pre-fills name from Apple if first time; subsequent sign-ins return only the Apple ID.
- Email shown is the relay (`abc1234@privaterelay.appleid.com`).
- Onboarding step 5 (post-MVP) explains email relay implications for receipts.

## 6.2.3 Returning organiser, multi-brand (Sara, mobile, week 6)

**Pre-state:** Sara owns 2 brands (Lonely Moth, Curated Sundays). Last session was on Curated Sundays.
**Trigger:** Opens app.

**Happy path:**
1. Splash → /(tabs)/home — context resumes on Curated Sundays from last session.
2. Sara taps brand chip in top bar `[5.3.2 brand switcher]`.
3. Sheet slides up. Lonely Moth highlighted as current; Curated Sundays second. She taps Lonely Moth.
4. Sheet dismisses, Home reflows to Lonely Moth content (200 ms cross-fade), KPIs update.
5. She taps "+ Create event" CTA `[5.4.1]`.

**Branches:**
- **Many brands (≥ 6):** brand switcher search input appears at top.
- **Brand under suspension:** brand row shows warning pill; tapping routes to suspension landing `[5.13.4]`.

**Time-on-task:** under 8 seconds.
**Success metric:** brand-switch latency < 250 ms perceived.

## 6.2.4 Invited teammate accepts (Marcus)

**Pre-state:** Sara invited Marcus as Brand Admin yesterday. Marcus has no prior Mingla Business account.
**Trigger:** Marcus taps email link "Join Lonely Moth on Mingla Business."

**Happy path:**
1. Universal link opens app (or web if app not installed) → /invitation/:token `[5.1.6]`.
2. Card renders: Lonely Moth logo + "Sara Olsen invited you to join Lonely Moth as Brand Admin."
3. Marcus has no account → "Continue with Google / Continue with Apple" present below CTAs.
4. He taps Continue with Apple. OAuth completes. Account created.
5. App returns to /invitation/:token now in accept-confirm state. Tap Accept.
6. Routes to /(tabs)/home with Lonely Moth as current brand. KPIs visible. Marcus has full Brand Admin permissions.
7. Onboarding 4 steps NOT shown for invited members; abbreviated single-step "Welcome to Lonely Moth" briefer optional.

**Branches:**
- **Marcus already has Mingla Business account:** invitation routes him directly to accept-confirm step 5.
- **Token expired (>14 days):** "This invitation expired on [date]. Ask Sara to send a new one."
- **Token revoked:** "This invitation was cancelled."
- **Invitation already accepted (resending email tap):** routes to brand directly.

**Failure paths:** Same auth failure paths as 6.2.1.

**Time-on-task:** 60 seconds end-to-end.
**Success metric:** ≥ 90% of invited members accept within 24 hours.
**Linked screens:** 5.1.6, 5.1.1 (auth subflow), 5.2.1, 5.13.4 (suspension if brand suspended).

---

# 6.3 Brand operations

## 6.3.1 Connect Stripe end-to-end (Sara, mobile, post-onboarding)

**Pre-state:** Lonely Moth created. Stripe not yet connected.
**Goal:** Get to a state where she can sell paid tickets.
**Trigger:** Top banner "Connect Stripe to sell paid tickets" on Brand profile `[5.3.3]`.

**Happy path:**
1. Sara taps Connect → routes to /brand/:brandId/payments/onboard `[5.3.8]`.
2. WebView loads embedded Stripe onboarding. She enters business details, bank account, identity verification (passport upload).
3. Stripe completes ID checks asynchronously. WebView shows "Submitted — we'll email you when verified."
4. She taps Done → returns to /brand/:brandId/payments `[5.3.7]` with banner now "Onboarding submitted — verifying."
5. Two minutes later, push notification arrives "Stripe is ready. You can sell tickets now." She taps push → app opens, banner now "Stripe active." Available balance £0.
6. KPI tiles display Available £0, Pending £0, Last payout — none yet.

**Branches:**
- **Identity verification incomplete:** Stripe asks for additional document → banner "Stripe needs one more thing. Upload [doc]." CTA opens Stripe.
- **Onboarding stalls:** banner persists; reminder push 24 hr later.
- **Country not supported:** Stripe rejects → "Stripe doesn't support [country] yet. Email support for next steps."

**Failure paths:**
- **WebView fails to load:** error state with retry.
- **Mid-flow back-button:** progress saved; banner remains "Continue Stripe onboarding."

**Mobile / web divergence:** Web uses Stripe Connect.js embedded panel inside a 560-wide modal `[5.3.8]`; mobile uses WebView full-screen.

**Time-on-task:** 5–10 minutes (heavy lift on the user — most time is identity verification).
**Success metric:** ≥ 70% of brands complete Stripe within 48 hours of brand creation.
**Linked screens:** 5.3.3, 5.3.7, 5.3.8.

## 6.3.2 Stripe stalled (KYC review takes 5 days)

**Pre-state:** Onboarded; Stripe says "Verifying" for 5 days.
**Behavior:** Banner persists in payments view; cannot publish paid events. Daily reminder push (suppressible). Email reminder at days 2, 4. Status auto-refreshes via webhook.
**On final approval:** Push + banner update + (if events have been queued in draft state with paid tickets) gentle nudge "You can publish [N] events now."

## 6.3.3 Stripe rejected

**Pre-state:** KYC fails (e.g., document not legible).
**Behavior:** Banner turns `semantic.error`: "Stripe couldn't verify your identity. Open Stripe to fix it." Tap → Stripe dashboard. While rejected, paid tickets blocked; free tickets remain available.
**Recovery:** Once Sara re-submits and is approved, banner returns to active state.

## 6.3.4 Invite teammate (Sara invites Marcus)

**Trigger:** Sara on /brand/:brandId/team `[5.3.9]` taps "+ Invite teammate" FAB.

**Happy path:**
1. Sheet/modal opens `[5.3.10]`.
2. Sara enters email, picks role "Brand Admin," writes short note "Day-of-show ops."
3. Tap Send invitation → toast "Invitation sent to marcus@example.com."
4. Team list shows Marcus's pending row (greyed) with "Resend" / "Cancel" buttons.

**Branches & failures:** as documented in 5.3.10.

## 6.3.5 Change member role

**Pre-state:** Marcus is Brand Admin; Sara wants to demote him to Event Manager temporarily.
**Trigger:** Sara on /brand/:brandId/team/:memberId `[5.3.11]` taps Change role.

**Happy path:**
1. Sheet opens with role picker. Current role highlighted.
2. Sara picks Event Manager. Body shows diff: "Will lose: brand finances, team management. Will keep: event creation."
3. Tap Save → confirmation dialog. Confirm.
4. Toast "Marcus's role updated to Event Manager." If Marcus is signed in, his app refreshes UI within 2 s (realtime).

**Audit log writes:** role-change event with before/after.

## 6.3.6 Remove member

Similar to 6.3.5; final state "Marcus removed from Lonely Moth." His sessions revoked. Audit log entry.

## 6.3.7 Disconnect Stripe (during account deletion or cleanup)

**Pre-state:** Brand has active Stripe.
**Trigger:** /brand/:brandId/settings → Disconnect Stripe button.
**Confirmation:** "Disconnecting Stripe will block new ticket sales for Lonely Moth. Pending payouts will still settle. Continue?"
**On confirm:** brand state updates; banner re-enables Connect-Stripe CTA.

---

# 6.4 Event lifecycle journeys

## 6.4.1 Create draft single-date event (Sara, mobile)

**Pre-state:** Lonely Moth has Stripe active.
**Goal:** Publish a single-date paid event for next Saturday.
**Trigger:** Home → Create event CTA → /event/create `[5.4.1]`.

**Happy path (mobile, 7-step wizard):**
1. **Step 1 [5.4.1.1]** — Title "Lonely Moth: R&B Night." Description rich text "Soul, R&B, slow nights. Doors 9pm. Hackney." Auto-save indicator below title.
2. **Step 2 [5.4.1.2]** — Toggle Once. Date picker → Sat. 11 May. Start 21:00, End 02:00 next day. Timezone Europe/London (auto). Next.
3. **Step 3 [5.4.1.3]** — In-person toggle. Map picker → search "Hackney" → drops pin → adjust to exact address "44 Kingsland Road, London E2 8DA." Next.
4. **Step 4 [5.4.1.4]** — Image tab. Upload cover from Photos → crop 16:9 → confirm. Next.
5. **Step 5 [5.4.1.5]** — Font Inter Display. Color preset "warm-amber." Theme preview tile updates live. Next.
6. **Step 6 [5.4.1.6]** — Pre-filled with Sara's profile. She adds phone for organiser contact. Next.
7. **Step 7 [5.4.1.7]** — Toggle Public on Discover. Visibility Public. Slug auto-generated "lonelymoth-rnb-may-11"; Sara overrides to "rnb-may." Available — confirm.
8. End of wizard → Save Draft button activates. Sara taps Preview `[5.4.2]`.
9. Preview renders public event page exactly. She approves and taps Save Draft.
10. Routes to /event/:eventId `[5.8.1]`. Status pill "Draft." Banner "Draft saved. Add tickets to publish."

**Time-on-task:** 4–6 minutes.

## 6.4.2 Create tickets and publish

**Continuing from 6.4.1:**
1. Sara taps "Add tickets" CTA → /event/:eventId/tickets `[5.5.1]`. Empty state.
2. Tap "+ Create ticket type" → /event/:eventId/tickets/create `[5.5.2]`.
3. Name "General Admission." Price £15. Quantity 200. Sale start now, sale end Sat 18:00. No advanced flags. Done.
4. Toast "Ticket type created."
5. Returns to ticket list. One row: GA · £15 · 0/200 · Live.
6. Sara taps back to event overview → publish CTA in shelf `[5.4.3]`.
7. Validation runs → all-pass. Confirm modal "Ready to publish? This will make it visible on Discover and at minlga.com/e/rnb-may." Confirm.
8. Loading 1.5 s → toast "Live. Share this link: minlga.com/e/rnb-may." Status pill morphs to "Scheduled" (event in future) or "Live" (event in window).
9. Share modal `[5.6.9]` auto-presents with the link copied to clipboard ready.

**Branches:**
- **Stripe not active and paid ticket created:** publish gate blocks with "Connect Stripe to publish events with paid tickets" + Connect CTA.
- **No tickets:** publish gate blocks with "Add at least one ticket type."
- **Capacity issue:** if any ticket has invalid window, blocks with specifics.

**Time-on-task:** 8–12 minutes including ticket setup.

## 6.4.3 Create recurring event with per-date overrides

**Pre-state:** Sara wants a weekly Wednesday open-mic for 8 weeks.
**Wizard step 2 [5.4.1.2]:** Recurrence picker → Weekly · every 1 week · Wed · End after 8 occurrences. Preview shows 8 dates in chip strip below.
**Step 3–7 same.** Publish.
**Editing one date:** /event/:eventId/edit → date selector → pick week 4 → override location to a different venue. Save → change-summary modal previews "Week 4: location override applied." Confirm. Public page for week 4 reflects.

## 6.4.4 Create multi-date event (festival weekend)

**Wizard step 2:** Multi-date toggle → "Add date" thrice → Fri 9pm, Sat 9pm, Sun 6pm. Each date may carry different ticket types or per-date pricing. Publish flow same; Public page renders all 3 dates with per-date ticket selectors.

## 6.4.5 Publish with validation errors

**Trigger:** Sara taps Publish without setting an end-time.
**Behavior:** Publish gate modal lists "Almost there — 1 thing left: set an end time." CTA Fix → routes to step 2 with error highlight.

## 6.4.6 Edit-after-publish (price change)

**Pre-state:** Live event, 12 tickets sold.
**Trigger:** /event/:eventId/edit → ticket type → price change £15 → £20.
**Behavior:** Banner top "Editing live event. Changes go live on Save." On Save → change-summary modal shows "GA price: £15 → £20." Confirm. Existing 12 buyers unaffected (they paid £15); new buyers pay £20. Email notification optional ("Tell existing buyers" toggle, default off).

## 6.4.7 Cancel event with refund cascade

**Trigger:** Event overview → Settings → Cancel event.
**Confirm modal:** "Cancel R&B Night? This refunds 47 tickets totalling £705 and notifies all attendees. Cannot be undone."
**Type-to-confirm:** type "Cancel R&B Night."
**On confirm:** loading state with progress bar "Refunding… 12/47." Email cascade fires. Push to all attendees (those with consumer Mingla account). Audit log writes cancellation event. Public page renders Cancelled variant.

**Failure path:** any refund failure stops cascade and surfaces "[N] of [M] refunds failed. Retry?" with per-row retry.

---

# 6.5 Ticket management journeys

## 6.5.1 Create free ticket

Creator skip price (toggle Free). Quantity 100. Done. Buyers see "Free" instead of price; checkout skips Stripe.

## 6.5.2 Paid with sale window

GA £15, sale window opens Friday 9am, closes Saturday 6pm. Ticket invisible before window opens (buyers see "On sale Fri 9am · Notify me"). After 6pm, invisible (buyers see "Sale ended").

## 6.5.3 Approval-required ticket

VIP £50, approval required. Buyer applies via /public/e/:slug → Apply for tickets `[5.6.6]`. Application appears in /event/:eventId/guests/pending `[5.8.7]`. Sara reviews → Approve → ticket issued, email sent with checkout link. Buyer pays. Ticket valid.

## 6.5.4 Password-protected ticket

VIP £100 password "back2back." Sara shares password via DM. Buyer visits public page → enters password `[5.6.5]` → ticket revealed → checkout.

## 6.5.5 Waitlist flow

GA sells out. Buyer sees "Join waitlist" `[5.6.2]`. Joins with email + phone. Spot opens (refund freed inventory) → first-in-queue gets email "A spot opened — buy in the next 30 mins." If they don't, next in queue.

## 6.5.6 Ticket transfer

Buyer (Attendee D) goes to /my-tickets (consumer side or order detail link in email) → Transfer ticket → enters friend's email + name → friend receives new email with new QR. Original QR voids. Audit log writes transfer event.

## 6.5.7 Ticket refund initiated by attendee

Attendee C 48 hr before event submits refund request via order detail link (consumer side). Sara sees notification → Order detail [5.8.3] → Refund. Confirm. Stripe refund triggered. Email confirmation. 3–5 days to settle.

---

# 6.6 Attendee purchase journeys

## 6.6.1 Apple Pay purchase, mobile (Attendee B)

**Pre-state:** Attendee tapped Discover deep-link to public event page.
**Happy path:**
1. /public/e/:slug `[5.6.1]` renders. Hero, ticket selector visible.
2. Stepper +/- on GA → 2 tickets. Total £30.
3. Sticky "Get tickets · £30" → routes to /checkout/:eventId/buyer `[5.7.2]`. Pre-filled from consumer profile.
4. Continue → /checkout/:eventId/payment `[5.7.3]`. Apple Pay button prominent.
5. Tap Apple Pay → native sheet → Face ID confirms → 800 ms processing.
6. Routes to /checkout/:eventId/confirm `[5.7.4]`. QR cards render. Apple Wallet button.
7. Tap Add to Apple Wallet → native add intent → success.
8. Email + SMS arrive within 60 s.

**Time-on-task:** 35–60 seconds.

## 6.6.2 Card with 3DS challenge, web (Attendee A)

**Happy path:**
1. /public/e/:slug → ticket select → checkout/buyer → checkout/payment.
2. No Apple Pay (browser without). Stripe Payment Element shown.
3. Card details entered. Pay £30 button.
4. Bank requires 3DS → in-line iframe challenge. Attendee approves on phone or in-iframe.
5. Iframe closes → confirm screen renders.

**Failure path — declined:** "Couldn't take payment. Try a different card or contact your bank." Retry available.

## 6.6.3 Refund request (Attendee C, mobile)

Attendee opens email with order link → order detail page → Request refund button → reason dropdown ("Can't make it") → Submit. Toast "Refund request sent." Sara's notifications fire.

## 6.6.4 Wallet add (Apple Wallet)

QR ticket card has "Add to Apple Wallet" button → native intent → wallet opens with pass. On the day, wallet auto-surfaces near event time and venue.

## 6.6.5 Forgot ticket on day-of

Attendee opens email → "Resend ticket" link → routes to ticket display `[3.11.6]` with QR.

---

# 6.7 Door operations journeys

## 6.7.1 Scanner first-night setup (Joel)

**Pre-state:** Sara invited Joel as scanner for tonight's event. Joel installed Mingla Business and accepted invitation `[5.1.6 scanner variant]`.
**Trigger:** Joel opens app at venue.

**Happy path:**
1. Auth completes; routes to /scanner/ `[5.9.1]` (his role).
2. Tonight's event listed with ticket-progress bar 0/200. Tap "Open scanner."
3. Camera permission prompt (first-time only) → grants → camera preview opens `[5.9.2]`.
4. Reticle ready. Sticky context shelf shows "R&B Night · 0 / 200."
5. First guest hands phone with QR. Joel aims camera. Auto-detects in 200 ms. Reticle pulses green. "Welcome, Sara Olsen." Haptic success.
6. Counter increments to 1 / 200 with stat-value pulse.
7. Continues for the night.

**Time-on-task per scan:** under 4 seconds.

## 6.7.2 Duplicate scan

Joel scans an already-used ticket → reticle yellow pulse, "Already used at 21:42 by Joel." Haptic warning. Buzzer (if audible-scan enabled).

## 6.7.3 Wrong-event scan

Customer hands a ticket for a different night → "This ticket's for [Other event]. You're scanning [This event]." Haptic error.

## 6.7.4 Not-found / counterfeit scan

Random QR or printed counterfeit → "No ticket matches that code. Try manual lookup."

## 6.7.5 Void scan (refunded)

Scanned ticket was refunded → "Ticket void. Refunded on [date]."

## 6.7.6 Manual lookup

Customer lost phone. Joel taps "Manual lookup" → /scanner/lookup `[5.9.3]` → searches "olsen" → finds row → ID-checks customer → Manual check-in. Audit log: manual check-in by Joel.

## 6.7.7 Door card payment (walk-up)

Walk-up has no ticket. Joel taps "Sell at door" → /scanner/sale/select `[5.9.4]` → selects 1 GA → /scanner/sale/payment `[5.9.5]` → Card reader → Customer taps card → 1.2 s processing → ticket QR issued + email + receipt. Walk-up enters with QR (or printed).

## 6.7.8 Door NFC payment (mobile-only)

Same as 6.7.7 but NFC tap → /scanner/sale/payment/nfc `[5.9.7]` → "Hold customer's card or phone to back of device" → tap → success.

## 6.7.9 Door cash payment

Customer pays cash. Joel taps Cash → /scanner/sale/payment/cash `[5.9.8]` → cash entry pad → £20 tendered for £15 ticket → "Change £5" → confirm → ticket issued.

## 6.7.10 Manual entry (cheque, voucher)

Joel records non-cash, non-card → /scanner/sale/payment/manual `[5.9.9]` → amount + note "Voucher 100 redeemed" → confirm → ticket issued. Audit log records manual.

## 6.7.11 Offline scanning

Wi-Fi drops. Joel keeps scanning. Each scan stores locally. Banner: "Saved offline. Will sync when you reconnect." Counter still increments locally.
Wi-Fi returns → background sync runs → toast "[N] scans synced." Server reconciles; any conflicts (duplicates that scanned before sync) fall to last-writer-wins with audit log noting both.

## 6.7.12 End-of-night reconciliation

After event ends, Sara opens /event/:eventId/reconciliation `[5.10.1]`. Sees:
- Online: 138 tickets / £2,070
- Door card: 18 tickets / £270
- Door NFC: 6 tickets / £90
- Door cash: 12 tickets / £180 (tendered £200, change £20 — manual cash drawer count expected: £180)
- Manual: 0
- **Total system: £2,610. Total tendered: £2,610. Variance: £0.**

Sign off. Audit log writes reconciliation closed.

If variance non-zero (cash drawer £170 vs system £180), variance highlights `semantic.warning` with comment field "[Reason]." Brand admin must comment before closing.

---

# 6.8 Account lifecycle

## 6.8.1 Account deletion full flow (Sara, mobile)

**Pre-state:** Sara decides to wind down Mingla Business.
**Trigger:** Account → Delete account.

**Happy path:**
1. /account/delete/consequences `[5.2.4]` lists impact (2 brands, 0 active events, last payout settled). Continue.
2. /account/delete/stripe-detach `[5.2.5]` shows 2 brands with Stripe state. Sara taps Detach for each. Both succeed.
3. /account/delete/confirm `[5.2.6]` — types email + holds Delete button 1.5 s.
4. Loading 2 s → /account/delete/scheduled `[5.2.7]`. "Account deletion scheduled for May 28." Sign-out.
5. App returns to Welcome.

**Email sent:** "Your account is scheduled for deletion. Cancel before May 28."

**Cancellation flow:** Sara taps email link → routes to /account/delete/scheduled with Cancel deletion CTA → on cancel, account restored.

**After 30 days:** cron job hard-deletes; data unrecoverable.

**Branches:**
- **Has active events:** consequences screen blocks: "You have 2 active events. Cancel them or wait." CTA links to events.
- **Has unsettled payouts:** "You have £4,237 in unsettled payouts. Wait 7 days after your last event ends."
- **Stripe detach fails for one brand:** retry per row.

**Failure paths:** Network drop mid-detach → resume on next sign-in.

**Time-on-task:** 4–8 minutes (Stripe detach is the bottleneck).
**Success metric:** account deletion fully removes data (Supabase auth row, all owned brands transferred or deleted, Stripe disconnected, no orphan rows). 100% rate.

---

# 6.9 Cross-domain / fail-safety journeys

## 6.9.1 Forgotten brand context

Sara signs in on a new device. App resumes on first-listed brand alphabetically. She wonders why "Curated Sundays" is showing — taps brand chip → switcher → picks correct brand.

**Future enhancement:** persist last-active brand server-side.

## 6.9.2 Two organisers double-edit same event

Sara and Marcus both editing /event/:eventId/edit at the same time. When the second saver clicks Save, conflict-resolution modal: "Marcus also made changes (3 mins ago). [View their changes] [Overwrite] [Discard mine]."

**Happy path:** Sara views diff and selects "Merge mine + theirs" if non-conflicting; otherwise pick winner.

## 6.9.3 Delayed Stripe webhook

Buyer paid; webhook delayed 90 s. Order shows "Pending — confirming with Stripe…" with subtle pulse. Buyer's confirmation page does NOT show until webhook resolves; meanwhile shows "Hold on — confirming with your bank…"
**Resolution:** webhook arrives → order moves to Paid; buyer sees confirmation page.
**Failure:** webhook never arrives within 5 minutes → automated retry from Stripe; status reconciliation cron catches; if 60 minutes pass with no resolution → buyer email "Your payment is taking longer than usual — we'll email when confirmed."

## 6.9.4 App version too old (force update)

App boots → backend signals version unsupported → /system/update-required `[5.13.3]` modal. Cannot dismiss. Update CTA opens App Store.

## 6.9.5 Account suspended

Trust & Safety triages a report and suspends. On next sign-in → /system/suspended `[5.13.4]` with reason + Get help CTA. Public pages for Sara's events return 404 with "Event not found." No public surface attribution.

## 6.9.6 Network outage

Banner top of every screen. Operations that can run from cache (read events, view orders) work; mutations queue. On reconnect, queue replays.

---

# 6.10 Event-discovery journey (attendee, signed-out, web first-time)

**Persona:** Attendee A, found Lonely Moth's IG link.

**Happy path:**
1. Click IG link → /public/e/rnb-may on desktop browser.
2. Page loads with hero video poster (autoplay muted), description, organiser card, ticket selector.
3. Scrolls; sticky right panel shows ticket selector + "Get tickets · from £15" CTA.
4. Attendee picks 2 GA → £30 → Get tickets.
5. Slides to /checkout/:eventId/buyer. Form. Continue.
6. /checkout/:eventId/payment. No Apple Pay (Chrome on Linux). Stripe Element.
7. Pay → 3DS → success → confirm screen. QR rendered. Email + SMS sent.

**Time-on-task:** 90 seconds.

---

# 6.11 Multi-device handoff (start mobile, finish web)

Sara opens event creator on mobile, completes 3 of 7 steps, gets called away. Later opens web → resumes event creator at step 4 (state synced via Supabase draft event row). Web shows wizard as single-page form with sticky right preview pane; she fills remaining steps and publishes.

**Edge case:** mobile and web open simultaneously editing same draft → soft-locking notification: "This draft is being edited on another device. Take over?"

---

# 6.12 Emergency journeys

## 6.12.1 Refund all attendees urgently

Power outage at venue 1 hr before event → cancel-event flow → refund cascade → email all attendees within 60 s.

## 6.12.2 Lost scanner phone mid-event

Sara: brand admin → Event scanners → revoke Joel's access → invite replacement on a new phone → pick up scanning. All scans Joel had done are preserved.

## 6.12.3 Disputed scan (attendee insists they have a valid ticket)

Joel manually looks up → finds void status → routes attendee to a brand-admin-led resolution: Sara checks order detail, sees refund timestamp, explains. If error (wrong refund), Sara re-issues from Manual Add Guest.

---

# Linked Section 5 screens (master index for this journeys file)

5.1.1 · 5.1.2 · 5.1.3 · 5.1.4 · 5.1.5 · 5.1.6 · 5.2.1 · 5.2.2 · 5.2.3 · 5.2.4 · 5.2.5 · 5.2.6 · 5.2.7 · 5.3.1 · 5.3.2 · 5.3.3 · 5.3.4 · 5.3.5 · 5.3.6 · 5.3.7 · 5.3.8 · 5.3.9 · 5.3.10 · 5.3.11 · 5.3.12 · 5.4.1 · 5.4.1.1 · 5.4.1.2 · 5.4.1.3 · 5.4.1.4 · 5.4.1.5 · 5.4.1.6 · 5.4.1.7 · 5.4.2 · 5.4.3 · 5.4.4 · 5.4.5 · 5.4.6 · 5.5.1 · 5.5.2 · 5.5.3 · 5.5.4 · 5.5.5 · 5.5.6 · 5.6.1 · 5.6.2 · 5.6.3 · 5.6.4 · 5.6.5 · 5.6.6 · 5.6.7 · 5.6.8 · 5.6.9 · 5.6.10 · 5.7.1 · 5.7.2 · 5.7.3 · 5.7.4 · 5.7.5 · 5.8.1 · 5.8.2 · 5.8.3 · 5.8.4 · 5.8.5 · 5.8.6 · 5.8.7 · 5.8.8 · 5.8.9 · 5.8.10 · 5.9.1 · 5.9.2 · 5.9.3 · 5.9.4 · 5.9.5 · 5.9.6 · 5.9.7 · 5.9.8 · 5.9.9 · 5.9.10 · 5.9.11 · 5.10.1 · 5.11.1 · 5.11.2 · 5.11.3 · 5.11.4 · 5.12.1 · 5.12.2 · 5.12.3 · 5.13.1 · 5.13.2 · 5.13.3 · 5.13.4 · 5.13.5 · 5.13.6 · 5.13.7 · 5.13.8 · 5.14.1 · 5.14.2 · 5.14.3 · 5.14.4

---

**End of `SPEC_BUSINESS_USER_JOURNEYS.md`.**
