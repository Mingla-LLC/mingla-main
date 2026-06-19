# VISION — META-ORCH-1148 — Mingla Venue Management Suite (Phase 2 of ORCH-1145)

> Status: BRAINSTORM / vision capture. NOT a build contract. Source of truth for the
> product+design vision spec that follows. Seth's verbatim vision is preserved below;
> the orchestrator's strategic framing precedes it.

## DECISIONS LOCKED (Seth, 2026-06-15)
1. **First ship = thin END-TO-END booking loop.** Operator tables+availability+reservations MVP AND
   a Mingla user can actually reserve from the app deck / public venue page. Prove the loop fast;
   real bookings generate the demand data that powers later modules. (Phases 2.0 + 2.1 + 2.2.)
2. **Next pillar after the loop = Demand + Campaigns** (leverages existing audience graph, Campaigns
   Phase A, place AI signals — the differentiator, lowest net-new). Then Menu CMS, then Guests/Feedback.
3. **Money model = venue's choice.** Reservations are FREE by default; each venue can OPTIONALLY set a
   reservation fee, charged through the existing all-in Stripe engine (brand fee/tax pass-or-absorb
   toggles, WYSIWYP shown all-in to the guest, native PaymentSheet — same as every other Mingla money
   surface). Deposits for packages / large parties layer on later via the same engine.
4. **Single "Reservations" capability toggle** on the venue listing unlocks the whole suite; the
   existing listing (status, AI match scores, gallery, feedback) stays the always-on Overview/Profile
   base. Not multiple toggles, not auto-on.

## FIRST-SHIP SCOPE (the agreed loop — the vision spec details this)
- 2.0 — "Reservations" toggle on the listing; Venue-tab restructured into the suite shell (two-column
  desktop / responsive web-phone / mobile) with the existing listing preserved as Overview/Profile;
  Settings (venue profile, hours, reservation rules, optional reservation fee, team roles); the
  net-new reservation/table/availability data model.
- 2.1 — Booking core: Tables (inventory + Smart Capacity Rules MVP), Availability (hours / turn-time
  by party size / buffers / max-per-slot / blackouts), Reservations (manual create + full lifecycle),
  Waitlist (MVP).
- 2.2 — Consumer booking surface: reserve a table from the app deck + public venue page; optional
  reservation fee via Stripe; confirmation + the reservation appears in the operator list (loop closes).
- Later ships: 2.3 Menu CMS, 2.4 Demand+Campaigns (first), then Guests/Feedback/Insights.

## DECISIONS LOCKED — round 2 (Seth, 2026-06-15)
5. **Mobile nav = REPLACE the Hub pills while inside Venue.** Entering the Venue tab swaps the
   Events/Experiences/Trips pill row for the venue module pills; leaving restores the offering pills.
   No stacked double-nav.
6. **"Fill open tables" hero CTA = FUNCTIONAL in ship 1, NOT "coming soon".** VERIFIED: Campaigns
   infra IS shipped (Marketing Hub Phase A / ORCH-0815 — `marketing-send` + `marketing-track-click` +
   `marketing-unsubscribe` edge fns, `orch_0815_marketing_hub_phase_a` schema, full business-app
   `app/(tabs)/marketing` UI + `useScheduleCampaign`). So the CTA wires to the EXISTING campaign
   engine. NET-NEW part = the venue-demand AUDIENCE (nearby + vibe-matched + reservation-demand users),
   which differs from Phase A's email-to-existing-buyers audience — scope that audience build, reuse
   the send/schedule/track pipeline.
7. **NO deferrals — build them in ship 1:**
   - **SMS waitlist-ready alerts via Twilio.** VERIFIED LIVE (2026-06-15): account `AC52c3…` active
     (Full, not trial); toll-free **+1 (888) 250-5351** SMS-capable; toll-free verification
     **TWILIO_APPROVED** for Mingla LLC; messaging service "Mingla Verification" (`MG1942…`). SMS is
     buildable now (a new `send-sms`/notification path on the toll-free number; creds in master keys —
     never commit them). The master-keys note "PENDING_REVIEW" (dated Jun 10) is STALE — now approved.
   - **No-show fee = build auto-forfeiture** (not flag-only) via the existing Stripe capture/charge
     engine. NOTE added complexity (payment capture + dispute handling) — scope it explicitly in the
     2.1/2.2 SPEC; keep it behind the venue's optional-fee setting.

## Architecture Seth specified
- A **capability TOGGLE** ("I take table reservations" / "I'm a restaurant") unlocks the suite.
- **All current listing details/features PRESERVED** and reimagined into a new menu shell.
- Robust but **compact, simple, innovative; intentional, modern, sleek**.
- **Two-column web desktop**, optimized **web-phone**, and **mobile app**. Fast adoption.

## Engineering-truth reality check (orchestrator recon 2026-06-15)
- NET-NEW: table-reservation schema, turn-time/availability engine, menu-item/menu-section CMS.
- REUSE (large): `parse-restaurant-menu` (Ve5) + `parse-play-activities` (menu photo→structured
  data + AI clean-up); `ticket-checkout-create` (Stripe deposits/prepay → deposits, packages,
  add-ons); `marketing-send` + brand/event audiences (Campaigns Phase A shipped); place AI signal
  scores + `run-place-intelligence-trial` (Demand); experiences engine (Packages = bookable
  experiences); ORCH-0948 event waitlist primitive.
- Net build ≈ **3 net-new pillars** (booking core, menu CMS, reservations data model) wired into
  substantial existing infra — NOT 11 systems from scratch.
- **Unstated gap:** Seth's doc is operator-side only. The **consumer booking surface** (reserve a
  table from the app deck + public venue page) is a major build and is what makes the operator
  tools non-empty. Must be sequenced explicitly.

## Recommended sequence (pending Seth's steering)
- 2.0 — Toggle + Venue-tab shell restructure (preserve listing as Overview/Profile) + Settings + data model.
- 2.1 — Booking core: Tables + Availability + Reservations + Smart Capacity Rules MVP (+ Waitlist).
- 2.2 — Consumer booking surface: reserve from app deck + public venue page.
- 2.3 — Menu CMS: All Menus / Items / Specials / Packages / Add-ons (leverage parsers + experiences + Stripe).
- 2.4 — Intelligence + growth: Demand + Guests (CRM) + Campaigns + Feedback + Menu Insights.

---

## Seth's verbatim vision — Mingla Venue Management Menu

### 1. Overview — venue command center
Today's reservations · Total covers booked · Open capacity left · Waitlist count · Most requested
time · Most requested party size · Revenue estimate · Top menu item interest · Demand alert.
Example cards: "42 covers booked today" · "18 seats still open" · "7:30 PM is your hottest time" ·
"Groups of 4 are trending" · "People are viewing your brunch menu" · "Push a dinner offer?"
Main CTA: **Fill open tables** → one-click campaign to Mingla users matching the venue's vibe.

### 2. Tables — inventory (not floors)
Add table · name/number · capacity · min/max party size · combineable toggle ·
indoor/outdoor/private room/bar/patio tag · accessible toggle · high-top/booth/lounge/standard ·
active/inactive · notes.
**Smart Capacity Rules:** no 2 people on a 6-top; allow 5 on a 4-top if venue approves; 8+ require
deposit; patio reservation-only on weekends; private room requires manager approval; bar = walk-in only.

### 3. Availability
Business hours · reservation windows · turn time by party size · buffer time · max reservations per
slot · blackout dates · holiday hours · special service periods.
Example turn times: P2 75min · P4 90min · P6+ 120min. Brunch Sat–Sun 10–3, Dinner Tue–Sun 5–10.
**Availability Suggestions:** "You're blocking too much capacity at 7 PM. Opening two more 2-top slots
could increase bookings without overloading the kitchen."

### 4. Reservations — main list
Upcoming · create manual · edit · cancel · confirm · mark arrived/seated/no-show/completed · party
size · table assigned · occasion · guest notes · deposit/payment status · source (Mingla/website/
phone/Instagram/walk-in) · tags (VIP/birthday/first-time/regular/high-risk no-show).
Views: Today · Upcoming · Waitlist · Completed · No-shows · Canceled.
Card: "Amaka Johnson · 7:30 PM · Party of 4 · Table T2 · Birthday · Deposit paid · First Mingla
booking" → Confirm/Message/Change table/Add note/Mark arrived/Cancel.

### 5. Waitlist
Add guest · estimated wait · party size · preferred seating · SMS when ready · auto-expire after X ·
convert to reservation · track lost guests.
Smart: "You lost 9 waitlist guests last Friday 8–9 PM. Add two more 2-top slots or reduce turn time."

### 6. Menu Management (major Mingla advantage — menu as demand/storytelling/conversion/marketing)
Sections: All menus · Menu items · Specials · Packages · Add-ons · Menu insights.

**6A. All Menus** — Dinner/Brunch/Lunch/Happy Hour/Drinks/Wine/Dessert/Late Night/Private Dining/
Catering/Event/Date Night/Birthday Package. Create/duplicate/schedule/attach to reservations-events-
packages/publish/preview/import from PDF-photo-link/AI clean-up. Settings: name, description,
days/times, dine-in/takeout/event/private, required-for-booking, public/private/unlisted, attach to
reservation flow.

**6B. Menu Items** — name · category · description · price · photo/video · ingredients · allergens ·
dietary tags · spice · prep time · availability · popularity · pairings · add-ons · upsells ·
best-for tags. Mingla tags: cozy date / group share / birthday table / first-date-safe /
instagrammable / comfort food / pre-game / late-night / business lunch / brunch favorite /
vegetarian-friendly / high-margin. **AI Menu Storyteller** rewrites bland item copy.

**6C. Specials** — create · LTO schedule · attach to slow nights / reservation windows · quantity
limit · promote to nearby/saved users · track redemptions · auto-expire. Smart: "Your Thursday 6–8 PM
demand is weak. Turn your cocktail special into a Mingla push?"

**6D. Packages** (huge — packages = bookable experiences) — Birthday Dinner / Date Night / Group
Brunch / Bottle Service / Private Room / Corporate / Proposal / Game Night / Lounge / Art Night.
Fields: name · description · price (per-person/flat) · min/max party · deposit · included items ·
add-ons · required table type · days/times · approval toggle · cancellation policy · guest
instructions · staff notes.

**6E. Add-ons** — cake/bottle/champagne/flowers/hookah/dessert/photographer/decor/DJ shoutout/
priority seating/private room/game tokens/bowling shoes/booth/valet/party favors. name · price ·
quantity · availability · attach to package-reservation-event · staff notes · approval toggle.

**6F. Menu Insights** — most viewed/saved · most booked packages · items driving reservations · click-
but-no-book · high-margin opportunities · best item by vibe/time/audience · trending nearby ·
conversion by photo/description quality.

### 7. Demand (Mingla's differentiator)
Search/save/reservation/waitlist/menu/package/event/nearby demand · by vibe/occasion/time.
Views: Today · This week · Slow nights · Popular times · Lost demand · Opportunity.
Actions: Fill open tables · Promote a menu item · Promote a package · Message saved users · Create an
offer · Boost a slow night.

### 8. Guests — lightweight CRM
Profiles · visit/reservation history · menu preferences · favorite packages · allergies · occasions ·
birthdays · no-show history · feedback · tags · messaging consent · private notes.
Actions: Message · Invite back · Add note · Offer package · View feedback.

### 9. Campaigns
Types: fill open tables · promote item/package/special · bring back regulars · convert saved users ·
win back no-shows · push slow night · promote event · birthday · group dining.
Builder: What to fill? · Who sees it? · What should Mingla say? · Send now or schedule?

### 10. Feedback (private, not public review drama)
Post-visit · reservation experience · menu-item · server · occasion · package feedback · sentiment
summary · common complaints/compliments · recovery messages.

### 11. Settings
Venue profile · address · contact · hours · reservation rules · cancellation policy · deposit rules ·
tax/service charges · team permissions · notifications · integrations · payment settings.
Team roles: Owner · Manager · Host · Server · Marketing · Finance · Scanner/check-in.
