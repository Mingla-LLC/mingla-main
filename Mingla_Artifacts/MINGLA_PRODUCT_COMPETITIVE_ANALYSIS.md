# Mingla Product And Competitive Analysis

**Purpose:** marketing brainstorm source document for Mingla consumer app + Mingla Business.  
**Date:** 2026-05-02  
**Primary framing:** Mingla helps people find the right place for the vibe. Mingla Business helps places and experience operators sell their venue, menu, events, and parties while automating marketing and outreach at scale with AI.

---

## 1. Executive Summary

Mingla should be framed as an AI-powered social discovery and hospitality growth platform.

For consumers, Mingla is not just an events app. It is a **vibe-matching app for places, plans, and people**. A user opens Mingla when they know the feeling they want but not the exact venue: cozy dinner, lively drinks, date-night energy, something fun with friends, a place to work, a first meet, a low-key solo adventure, or a full night out. Mingla turns taste, context, location, time, budget, travel mode, social graph, and saved behavior into a ranked set of places and experiences.

For businesses, Mingla Business should become the **AI growth OS for venues and experience brands**. Today the app has event-creator foundations. The larger opportunity is to expand from event organizers into restaurants, bars, bowling alleys, cafés, galleries, arcades, activity venues, nightlife venues, pop-ups, and hybrid hospitality operators. These businesses do not only need ticketing. They need demand, discovery, content, menu storytelling, private feedback, repeat customers, parties, reservations, offers, and automated outreach.

The strongest positioning is:

> **Mingla matches people to the places, menus, events, and parties that fit their vibe, then gives businesses the AI tools to turn that demand into booked tables, sold tickets, repeat visits, and measurable revenue.**

Mingla is best understood as the combination of:

- **222's foot-traffic promise:** bring people to venues, not just impressions.
- **Eventbrite's marketplace + ticketing infrastructure:** create, promote, sell, check in, and report.
- **POSH's culture/community layer:** beautiful event pages, SMS/CRM, affiliates, payouts, analytics, and social marketplace.
- **Mingla's differentiator:** taste graph + vibe matching + place intelligence + social planning + AI business automation across both everyday venues and events.

---

## 2. Product Thesis

### Consumer App Thesis

People rarely search only for a category. They search for a feeling:

- "Somewhere cute but not too loud."
- "A fun place for a group tonight."
- "A restaurant that feels right for a first date."
- "A bar with energy but not chaos."
- "Something different nearby."
- "A place my friend group will actually agree on."

Mingla's consumer app should own this language:

> **Find the place that matches the vibe.**

This is broader and more emotional than "find events near you." It covers restaurants, cafés, bars, bowling alleys, art galleries, date spots, group activities, concerts, markets, nightlife, work-friendly places, and curated multi-stop itineraries.

### Business App Thesis

Businesses do not want another dashboard. They want people through the door, spend per visit, repeat customers, content, and less manual marketing.

Mingla Business should own:

> **Sell the place, sell the menu, sell the party, and let AI market it at scale.**

This expands Mingla Business from event creation into a full hospitality marketing and commerce engine:

- Venue profile and brand storytelling.
- Menu, package, and party/product merchandising.
- Event, ticket, RSVP, reservation, and private-party creation.
- AI copy, campaign, outreach, audience segmentation, and follow-up.
- Consumer marketplace distribution through Mingla's vibe-matching feed.
- Check-in, feedback, analytics, and customer relationship memory.

---

## 3. What Mingla Already Has In The Repo

This section separates implemented/current foundations from strategic future surfaces.

### 3.1 Consumer App: Current Feature Inventory

Source evidence: `README.md`, `app-mobile/README.md`, `app-mobile/src/components/HomePage.tsx`, `app-mobile/src/components/DiscoverScreen.tsx`, consumer services/hooks, and Supabase functions.

#### Discovery And Vibe Matching

- Swipe-based discovery deck for experience cards.
- Preference-driven card serving using categories, intents, budget, travel mode, travel constraint, date/time, location, and toggles.
- 12 broad experience categories including nature, first meet, picnic, drinks, casual eats, fine dining, watch, creative/arts, play, wellness, groceries/flowers, and work/business.
- Intent framing including romantic, first dates, group fun, business, and solo adventure.
- AI quality gate for place/card suitability using OpenAI.
- AI reason generation for why a card is recommended.
- Pool-first card serving pipeline using `place_pool` and `card_pool`.
- Multi-stop curated itinerary generation.
- Holiday and seasonal experience generation.
- Companion stops and grocery/picnic support.
- Ticketmaster Night Out integration for real events.
- Genre, date, and price filtering for events.
- Saved card behavior and user-card impression tracking for freshness.

#### Map And Place Discovery

- Edge-to-edge Discover Map.
- Category filter pills.
- "For You" recentering on user location.
- Place pins and curated route pins.
- Multi-stop route visualization.
- Bottom sheet for preview/expanded details.
- Open-now filtering.
- Friends and paired people visible on map with privacy controls.
- Nearby people discovery with taste matching.
- Real-time activity feed overlay.
- Heatmap layer.
- Go Dark privacy mode.
- User activity status.

#### Social Planning

- Real-time collaboration sessions.
- Session switcher between solo and group planning.
- Friends, friend requests, phone invites, and collaboration invites.
- Boards for group planning.
- Voting and RSVP on board cards.
- Board discussion and messaging.
- Direct messaging.
- Notifications across friend, pair, board, message, calendar, and lifecycle events.
- Pairing system for closer preference learning.
- Paired saves and paired profile recommendations.

#### Save, Schedule, And Go

- Save experiences.
- Add saved experiences to calendar.
- Device calendar sync with event ID tracking.
- Scheduling validation against opening hours.
- Saved tab and calendar tab.
- Share cards.
- Post-experience/visit recording hooks.
- Feedback submission.

#### Identity, Preferences, And Trust

- Onboarding with name, phone verification, friends, collaboration, pairing, and consent.
- Country picker and locale-aware currency/units.
- Subscription tiers and feature gates.
- Blocking, reporting, profile controls, and privacy modes.
- Beta feedback system with screenshots/audio and admin triage support.

#### Consumer Product Meaning

The consumer product is already much closer to a **taste-aware planning layer** than a generic local search app. Its feature set supports a marketing claim like:

> "Tell Mingla what kind of night you want. It finds the places, routes, events, and friends that fit."

---

### 3.2 Mingla Business: Current Feature Inventory

Source evidence: `mingla-business/src/store/currentBrandStore.ts`, `draftEventStore.ts`, `liveEventStore.ts`, `EventCreatorWizard.tsx`, brand components, checkout components, and business specs.

#### Current App Foundation

- Separate Mingla Business app surface.
- Auth and onboarding entry points.
- Business landing screen positioned "For experience creators."
- Persistent current-brand state.
- Multi-brand support and brand switching.
- Brand profile, edit profile, public brand page, and public brand not-found state.
- Brand kind support: physical venue vs pop-up brand.
- Physical brands can show address; pop-ups can stay handle-only.
- Brand tagline, bio, photo, cover hue, contact fields, website, social links, and custom link fields.
- Brand stats: events, followers, revenue, attendees.
- Team member and invitation models.
- Roles: owner, brand admin, event manager, finance manager, marketing manager, scanner.

#### Payments And Finance Foundation

- Stripe Connect status model: not connected, onboarding, active, restricted.
- Payments dashboard shell.
- Stripe onboarding route.
- Available balance, pending balance, last payout.
- Payout and refund data structures.
- Finance reports view.
- Brand-level event revenue stubs for reporting.

#### Event Creation

- 7-step event creator wizard:
  1. Basics: name, description, format, category.
  2. When: date, time, recurrence, multi-date.
  3. Where: venue or online link.
  4. Cover: cover hue/theme.
  5. Tickets: types, prices, capacity.
  6. Settings: visibility, approvals, transfers.
  7. Preview: public page preview and publish gate.
- Event formats: in-person, online, hybrid.
- Event visibility: public, unlisted, private.
- Single-date, recurring, and multi-date events.
- Timezone handling.
- Venue name, address, online URL, and hide-address-until-ticket toggle.
- Public event preview.
- Publish validation with errors sheet.
- Stripe gate for paid tickets.
- Draft persistence and resume.
- Live event store after publish.
- Public event URL: `/e/{brandSlug}/{eventSlug}`.
- Edit published event surface.
- Edit-after-publish guardrails for mutable fields.

#### Ticketing

- Free and paid tickets.
- Capacity and unlimited tickets.
- Public, hidden, and disabled ticket visibility.
- Ticket ordering.
- Approval-required tickets.
- Password-protected tickets.
- Waitlist-enabled tickets.
- Min/max quantity per buyer.
- Transfer toggle.
- Ticket description.
- Sale start and sale end windows.
- Public event page ticket display.

#### Checkout Foundation

- Checkout routes:
  - cart/index.
  - buyer details.
  - payment.
  - confirmation.
- Quantity row components.
- Payment element stub.
- 3DS stub sheet.
- QR payload helper stubs for future ticket validation.

#### Event Management Foundation

- Event detail page.
- Event KPI cards.
- Event list cards.
- Event manage menu.
- End sales sheet.
- Multi-date override sheet.
- Change summary modal.
- Public event not-found state.

#### Important Current Limitation

Many Business capabilities are currently **client-side transitional implementations**. The stores explicitly note that draft events, live events, and brand lists are persisted locally in Zustand during a transitional phase and are intended to move to backend/server state later. The product strategy is ahead of backend production readiness.

Marketing brainstorming should therefore distinguish:

- **Now:** event-creator, brand, tickets, public page, payments shell, checkout shell.
- **Near-term:** backend-backed publishing, orders, real Stripe checkout/webhooks, scanner, refunds, payouts, analytics.
- **Strategic expansion:** restaurants, venues, menu selling, private parties, AI campaigns, CRM, and automated outreach.

---

## 4. Strategic Expansion: From Event Creators To Venues

Mingla Business should not be limited to event organizers. The bigger product can support several business types.

### 4.1 Restaurants

#### Consumer Need

Users want a restaurant that fits:

- Vibe: romantic, lively, cozy, quiet, trendy, upscale, casual.
- Occasion: first date, birthday, friend dinner, business lunch, solo meal.
- Constraints: open now, distance, budget, dietary preferences, group size, reservation availability.
- Taste: cuisine, previous saves, social graph, what similar users liked.

#### Business Need

Restaurants want:

- Fill quiet nights and off-peak tables.
- Promote signature menu items and limited-time specials.
- Drive repeat visits from ideal customers.
- Capture feedback privately.
- Reach people who are actually nearby and likely to enjoy the restaurant.
- Reduce dependence on Google/Yelp/Meta ads.

#### Mingla Features To Build

- Restaurant profile with vibe tags, cuisine, menu highlights, price, dress/energy/noise level, best-for occasions.
- Menu manager: dishes, drinks, tasting menus, brunch, happy hour, specials.
- AI menu storyteller: turns dishes into consumer-facing descriptions and campaign copy.
- Reservation integrations or native reservation requests.
- "Tonight's vibe" campaigns: fill tables based on real-time availability.
- Private party packages: birthdays, groups, corporate dinners, dates, celebrations.
- Table/party inquiry flow.
- Post-visit feedback and repeat-visit nudges.
- AI outreach to likely-fit consumers.

### 4.2 Bars, Nightlife, And Lounges

#### Consumer Need

Find the right energy: calm drinks, buzzy bar, dancing, date-night cocktails, after-work, sports night, live DJ, late-night, speakeasy.

#### Business Need

Drive attendance by night and segment:

- Thursday after-work crowd.
- Friday birthday groups.
- Saturday nightlife.
- Slow Sunday/Monday programming.
- New-to-city discovery.

#### Mingla Features To Build

- Night-by-night vibe calendar.
- Drink/menu features.
- Table/package selling.
- Guest list, RSVP, cover, and ticket support.
- AI campaign calendar.
- Creator/ambassador tracking.
- SMS/push/email outreach.
- Check-in and spend attribution.

### 4.3 Bowling Alleys, Arcades, Activity Venues

#### Consumer Need

Users want something social to do, not just a place to sit.

#### Business Need

Sell lanes, game packages, parties, corporate events, group nights, leagues, and off-peak sessions.

#### Mingla Features To Build

- Activity inventory: lanes, rooms, courts, tables, sessions.
- Group package builder.
- Birthday/corporate/private party pages.
- Time-slot booking.
- Add-ons: food, drinks, merch, deposits.
- AI-generated party pages and outreach.
- Group decision tools for friends.

### 4.4 Galleries, Cafés, Pop-Ups, Workshops, Wellness

#### Consumer Need

Discover niche, local, cultural, creative, or wellness experiences that match taste and schedule.

#### Business Need

Sell events/classes, build community, grow audience, capture repeat customers.

#### Mingla Features To Build

- Brand and event profile.
- Calendar of drops/classes/pop-ups.
- Ticketing/RSVP/waitlist.
- Membership/follower list.
- AI content and campaign generation.
- Creator collaboration and affiliate links.

---

## 5. Competitive Analysis

### 5.1 222

Source: [222 partner page](https://partners.222.place/)

#### Their Framing

222 frames itself around guaranteed in-person demand:

- "We bring the people. You provide the place."
- Social experience company.
- Members complete a personality questionnaire.
- Members are matched with strangers for dinner in groups of six.
- After dinner, groups come together at a second larger venue.
- 222 charges venues/restaurants per confirmed attendee/check-in.
- They position against Google/Meta ads by saying businesses should pay for actual customers, not impressions.
- They sell foot traffic, feedback, content creation, and discovery.
- They mention bars, cafés, art galleries, bowling alleys, restaurants, and other spaces.
- For restaurants, they integrate with OpenTable and Resy and charge per person sent.
- For curators, they sell tickets and take commission.

#### Strengths

- Extremely sharp business promise: real people through the door.
- Performance-based pricing is easy to understand.
- Strong social mechanic: strangers matched into groups.
- Clear venue value: fill quiet nights, get feedback, get content.
- "Private feedback, not public reviews" is a strong restaurant/venue wedge.
- Good demographic framing: young professionals, new to city, likely to spend.

#### Weaknesses / Gaps Mingla Can Exploit

- 222 appears more controlled and programmatic: users are sent to experiences rather than freely exploring.
- It is centered on curated social events and matched groups, not broad everyday discovery.
- It does not appear to be a full self-serve business operating system for menus, parties, campaigns, ticketing, checkout, scanner, and CRM.
- It is less about "what place fits my vibe right now" and more about "222 assigned me to a social experience."
- It may not give businesses deep AI automation beyond matching/logistics.

#### What Mingla Should Learn

- Sell outcomes, not dashboards.
- "Pay for customers, not impressions" is powerful.
- Check-ins, feedback rate, repeat visits, and revenue generated should become core Mingla Business metrics.
- Businesses need immediate language: "Fill slow nights," "turn open tables into booked tables," "bring the right crowd."

#### Mingla Positioning Against 222

> 222 sends matched groups to partner venues. Mingla can become the always-on vibe graph that helps every consumer find the right place anytime, while giving venues the AI tools to market, sell, host, and retain customers across ordinary nights, events, menus, and private parties.

### 5.2 Eventbrite

Sources: [Eventbrite features/pricing](https://www.eventbrite.com/features), [Eventbrite organizer marketing platform](https://www.eventbrite.com/organizer/features/event-marketing-platform/), [Eventbrite 2025 innovation announcement](https://investor.eventbrite.com/press-releases/press-releases-details/2025/Eventbrite-Announces-Listener-com-Partnership-and-Highlights-a-Year-of-Innovations-Designed-to-Help-Organizers-Reach-New-Audiences/default.aspx), [Eventbrite AI tools announcement](https://www.eventbrite.com/blog/press/newsroom/eventbrite-introduces-ai-powered-tools-to-empower-creators-and-reimagine-event-marketing)

#### Their Framing

Eventbrite is the mainstream event ticketing and discovery marketplace:

- Create events.
- Sell tickets.
- Get discovered in a large marketplace.
- Use email campaigns, ads, promo codes, smart audiences, reporting.
- Use AI for event descriptions, summaries, images, categories, email copy, and social ad copy.
- Use organizer app, mobile check-in, waitlists, automated reminders.
- Use timed entry, Tap to Pay, guest lists, buy now/pay later, lineup tools, social sharing.
- 2026 roadmap includes AI-powered recommendations during event creation.

#### Strengths

- Massive marketplace and strong brand awareness.
- Broad feature coverage.
- Trusted self-serve ticketing.
- Good SEO/discovery footprint.
- Marketing suite tied to exclusive event data.
- AI is already framed as a time-saving creator tool.
- Checkout, payouts, and event ops are mature compared with Mingla's current Business implementation.

#### Weaknesses / Gaps Mingla Can Exploit

- Eventbrite is event-first, not place-first.
- It is not optimized for "find a place that matches my vibe."
- It serves organizers broadly but does not deeply understand restaurant/bar/menu/package contexts.
- Discovery often feels search/category/date-led, not taste/social-context-led.
- Businesses can still feel like they are competing in a crowded marketplace.
- It is more infrastructure than intimacy.

#### What Mingla Should Learn

- Event creation must be fast.
- Marketing tools should be native, not separate from ticketing.
- AI should reduce blank-page work: titles, descriptions, images, categories, email, social, ads.
- Eventbrite's roadmap confirms that AI-assisted event creation is table stakes.

#### Mingla Positioning Against Eventbrite

> Eventbrite helps people create and sell tickets to events. Mingla helps consumers choose where to go based on vibe, taste, friends, and context, then helps businesses market every sellable moment: the table, the menu, the party, the event, the ticket, the package, and the return visit.

### 5.3 POSH

Sources: [POSH product page](https://posh.vip/product), [POSH platform page](https://posh.vip/platform), [POSH create event docs](https://docs.posh.vip/create-an-event), [POSH event attendees docs](https://docs.posh.vip/event-attendees), [POSH event settings docs](https://docs.posh.vip/event-settings), [POSH text blast docs](https://docs.posh.vip/text-blast-attendees)

#### Their Framing

POSH is a social experiences platform for organizers and communities:

- "Create timeless events in under a minute."
- Customizable event pages for paid and RSVP events.
- Images, music, performer/speaker lineups, flyers, accent colors, Spotify songs, password, YouTube video.
- Embedded marketing tools.
- SMS CRM and affiliate marketing.
- Kickback turns attendees into paid affiliates.
- Instant payouts and financial flexibility.
- Automated disputes and custom fees.
- Marketplace feed and personalized discovery.
- Real-time audience analytics and organization insights.
- POSH AI beta for event performance questions.
- Attendee filtering and sorting by gender, tags, tickets purchased, tracking links, spend, last purchase.
- Mass text attendees with personalization and tracking links.
- Mailchimp integration.
- Customer support actions from attendee dashboard: contact, refund, resend tickets.

#### Strengths

- Strong cultural/event-brand aesthetic.
- More youth/nightlife/community energy than Eventbrite.
- SMS CRM and affiliate/Kickback are strong revenue tools.
- Fast event creation and custom pages are compelling.
- Instant payouts and automated disputes speak to operator pain.
- Audience segmentation and text blasts are very practical.

#### Weaknesses / Gaps Mingla Can Exploit

- POSH is still primarily event/community/ticketing-led.
- It is less clearly a daily restaurant/bar/place discovery engine.
- Its consumer marketplace is event-oriented rather than all-place vibe matching.
- It does not appear to own the full "what place fits me tonight?" consumer problem.
- AI is currently more analytics/performance/Q&A oriented in public framing, not a full autonomous marketing agent for menus, parties, and outreach.

#### What Mingla Should Learn

- A business app has to feel like growth, not admin.
- SMS/CRM and affiliate/referral mechanics are crucial.
- Fast page creation and beautiful public pages matter.
- Operators care about payouts, disputes, and fees as much as event design.
- Audience segmentation should be a first-class feature, not an export.

#### Mingla Positioning Against POSH

> POSH helps organizers create and scale social events. Mingla can do that, plus connect those events to an everyday consumer vibe graph for restaurants, bars, activity venues, menus, parties, and repeat local discovery.

---

## 6. Competitive Positioning Matrix

| Capability | 222 | Eventbrite | POSH | Mingla Direction |
|---|---:|---:|---:|---|
| Consumer marketplace | Curated member experiences | Massive event marketplace | Social event marketplace | Vibe-based place + event + activity marketplace |
| Place discovery | Partner venues receive groups | Limited/event venue context | Event venue context | Core consumer promise |
| Taste/vibe matching | Personality questionnaire + group match | Personalization/event recommendations | Personalized marketplace | Taste graph across places, people, moments, menus |
| Restaurants | Strong partner promise via OpenTable/Resy | Event/venue use cases | Food & drink events | Full restaurant profile + menu + tables + parties |
| Bars/nightlife | Strong group/second venue model | Event ticketing | Strong nightlife culture | Vibe discovery + events + guest list + campaigns |
| Activity venues | Mentioned as venue partners | Timed entry/use cases | Activities use case | Bowling/arcade/package/time-slot engine |
| Ticketing | Curator tickets | Mature | Strong | Current foundation, needs backend hardening |
| Event creation | Curator dashboard | Mature self-serve | Fast/custom | Current 7-step wizard |
| SMS/CRM | Not core public framing | Email/social stronger | Strong SMS CRM | Strategic must-build |
| AI marketing | Matching/logistics implied | AI copy and recommendations | POSH AI performance Q&A beta | AI campaign autopilot across menu/place/event/party |
| Feedback | Strong private feedback | Reporting | Analytics | Private feedback + vibe intelligence |
| Check-in attribution | Core pricing mechanism | Mature check-in | Ticket scanning/ops | Strategic must-build for venue ROI |
| Business promise | Foot traffic | Ticket sales/discovery | Community monetization | Demand + AI growth OS for places |

---

## 7. Mingla's Differentiated Product Story

### 7.1 The Consumer Flywheel

1. User sets preferences or opens Mingla with context.
2. Mingla recommends places/events/routes that match the vibe.
3. User saves, swipes, shares, chats, votes, schedules, or visits.
4. Mingla learns from choices, friends, pairings, visits, and feedback.
5. Better recommendations create more confidence.
6. More consumer intent gives businesses stronger targeting.

### 7.2 The Business Flywheel

1. Business creates a profile, menu/package, event, party, or offer.
2. AI improves copy, imagery, categorization, audience, and campaign plan.
3. Mingla distributes to consumers whose vibe/taste/context matches.
4. Consumers book, buy, RSVP, save, share, or visit.
5. Check-ins, sales, feedback, saves, and repeat visits become measurement.
6. AI learns what works and automates the next campaign.

### 7.3 The Combined Flywheel

Mingla gets powerful when consumer and business surfaces reinforce each other:

- Consumer taste data improves business targeting.
- Business menus/events/packages enrich consumer discovery.
- Consumer saves and plans become intent signals.
- Business check-ins and feedback validate real-world outcomes.
- AI turns the loop into automated growth.

This is where Mingla can be "all of them put together, but better":

- Like 222, Mingla can prove foot traffic and real attendance.
- Like Eventbrite, Mingla can create, sell, promote, and report.
- Like POSH, Mingla can make organizers feel culturally relevant and growth-focused.
- Unlike all three, Mingla can connect everyday place discovery, social planning, venue menus, private parties, and events into one taste-aware system.

---

## 8. Feature Map For Brainstorming

### 8.1 Consumer App Features

#### Find The Vibe

- Vibe search: "cozy", "lively", "romantic", "good for groups", "low-key", "new in town", "work-friendly."
- Swipe discovery.
- Map discovery.
- Grid/event discovery.
- AI reasons: why this place/event fits.
- Mood and occasion filters.
- Category and intent filters.
- Budget and travel filters.
- Open-now and time-aware recommendations.
- Date/time planning.
- Location and custom-location support.
- Weather-aware suggestions.
- Multi-stop itineraries.
- Ticketmaster live events.
- Venue/place expanded details.
- Images, practical details, opening hours, travel, busyness, companion stops.

#### Plan Together

- Create collaborative sessions.
- Invite friends and non-users.
- Shared decks.
- Shared boards.
- Votes and RSVPs.
- Board discussion.
- Direct messages.
- Mentions and reactions.
- Add to calendar.
- Share card.
- Pairing and paired recommendations.
- Nearby people/taste matching.

#### Remember And Learn

- Saves.
- Dismissed cards.
- Calendar history.
- Visits.
- Preference learning.
- Paired saves.
- Feedback.
- Notifications and reminders.

#### Trust And Control

- Privacy controls.
- Go Dark.
- Friend visibility settings.
- Blocking/reporting.
- Account settings.
- Subscription tiers.
- Locale/currency/units.

### 8.2 Business App Features: Current And Planned

#### Brand / Venue Presence

- Business/brand profile.
- Physical venue vs pop-up brand type.
- Address handling.
- Bio, tagline, contact, social links.
- Public brand page.
- Cover/theme customization.
- Stats.

#### Event Creation

- Draft event creation.
- Single, recurring, and multi-date events.
- In-person, online, hybrid.
- Venue/address or online URL.
- Cover styling.
- Public/unlisted/private visibility.
- Preview and publish.
- Edit after publish.

#### Tickets And Checkout

- Free/paid tickets.
- Public/hidden/disabled ticket states.
- Capacity/unlimited.
- Approval-required.
- Password-protected.
- Waitlist.
- Min/max quantity.
- Transferable tickets.
- Sale windows.
- Checkout flow.
- Payment and 3DS stubs.
- Confirmation and QR payload stubs.

#### Payments And Finance

- Stripe Connect state.
- Payments onboarding.
- Available/pending balance.
- Payouts.
- Refunds.
- Finance reports.

#### Teams And Permissions

- Brand team.
- Invitations.
- Role picker.
- Member detail.
- Roles: owner, admin, event manager, finance manager, marketing manager, scanner.

#### Event Operations

- Event details.
- Event KPIs.
- Manage menu.
- End sales.
- Multi-date override.
- Change summary.
- Future scanner role and check-in journey.

### 8.3 Strategic Business Features To Add

#### Place And Menu Selling

- Venue page optimized for vibe, not just facts.
- Menu manager.
- Signature dishes and drinks.
- Specials and limited drops.
- Happy hour module.
- Brunch module.
- Table packages.
- Group packages.
- Private party packages.
- Occasion pages: birthdays, dates, corporate, celebrations.
- AI menu descriptions.
- AI "best for" tags.

#### AI Marketing Autopilot

- Campaign generator from event/menu/place data.
- Audience segmentation from Mingla consumer graph.
- SMS, push, email, and social copy.
- Campaign calendar.
- Auto-send rules with approval controls.
- Follow-up after saves, abandoned checkout, event attendance, and visits.
- Winback campaigns.
- Slow-night campaigns.
- "Fill this Friday" one-click campaign.
- A/B testing of copy/images/offers.
- AI learns which vibe converts.

#### Outreach At Scale

- Audience lists based on:
  - saved venue.
  - viewed menu.
  - attended event.
  - visited similar places.
  - nearby now.
  - matching vibe.
  - friend group intent.
  - birthdays/occasions.
- Contact import.
- CRM timeline per customer.
- Consent and opt-out management.
- Campaign tracking links.
- Creator/affiliate codes.
- Automated promoter payouts.

#### Measurement

- Impressions, saves, shares, clicks, RSVPs, bookings, purchases, check-ins.
- Cost per check-in.
- Revenue from Mingla.
- Repeat visit rate.
- Menu item interest.
- Event sell-through.
- Party/package inquiries.
- Private feedback summaries.
- AI insight summaries: "What worked, what to try next."

#### Venue Demand Generation

- Confirmed check-ins.
- Reservation attribution.
- QR/table check-in.
- POS/reservation integration.
- Private feedback after visit.
- Return-visit nudges.
- Predictive demand by night.
- "Quiet night fill" product.

---

## 9. Messaging Angles

### 9.1 Consumer Messaging

- "Find a place that matches the vibe."
- "Know the feeling, not the venue? Start with Mingla."
- "Swipe into tonight."
- "Plans your group can actually agree on."
- "The city, tuned to your taste."
- "Restaurants, bars, events, and things to do, picked for your mood."
- "Less searching. More going."
- "The easiest way to answer: where should we go?"

### 9.2 Business Messaging

- "Turn your place into the plan."
- "Sell the room, the menu, the party, and the night."
- "AI marketing for venues that need real guests, not more dashboards."
- "Fill slow nights with people who fit your vibe."
- "Create events and parties in minutes. Let Mingla find the crowd."
- "Your menu, events, and private parties, marketed automatically."
- "From open tables to sold-out nights."
- "The growth OS for restaurants, bars, venues, and experience brands."

### 9.3 Investor / Strategic Messaging

- "Mingla is building the taste graph for real-world hospitality."
- "A consumer discovery app and business growth platform in one loop."
- "The marketplace where vibe-based demand meets AI-powered venue supply."
- "Eventbrite for creation, POSH for community, 222 for foot traffic, but unified by consumer taste intelligence."

---

## 10. Recommended Positioning Architecture

### Core Brand

**Mingla**  
Find places, events, and experiences that match the vibe.

### Consumer Surface

**Mingla App**  
Personalized place and experience discovery for nights out, dates, groups, solo plans, and everyday city life.

### Business Surface

**Mingla Business**  
AI growth tools for venues, restaurants, bars, activity spaces, and experience creators.

### Product Pillars

1. **Discover:** Match people to the right place or event.
2. **Plan:** Save, share, vote, chat, schedule, and go together.
3. **Sell:** Help businesses package places, menus, events, tickets, and parties.
4. **Automate:** Let AI create campaigns and outreach at scale.
5. **Measure:** Prove foot traffic, sales, feedback, and repeat demand.

---

## 11. Product Gaps To Prioritize

### Consumer Gaps

- A clearer "vibe" vocabulary in the UI and marketing.
- Natural-language vibe search.
- Direct support for menus, specials, reservations, packages, and parties.
- Stronger consumer-to-business conversion tracking: save -> click -> book -> check in -> feedback.
- More explicit group-decision flows for venues, not only cards.
- Stronger "tonight" and "near me now" product moments.

### Business Gaps

- Backend-backed brand, event, order, ticket, and checkout state.
- Real Stripe checkout/webhooks.
- Scanner/check-in product.
- Restaurant/venue profile schema beyond event organizer brand profile.
- Menu/package/private-party management.
- CRM and campaign database.
- SMS/email/push consent and compliance system.
- AI campaign generation.
- Audience segmentation.
- Analytics and attribution.
- Feedback dashboard.
- Integration layer: POS, reservation systems, Google Business Profile, OpenTable/Resy, Mailchimp, social pixels.

### Marketing Gaps

- Need one crisp category name.
- Need proof points once data exists: check-ins, revenue generated, repeat visits, conversion lift, feedback rate.
- Need separate landing pages for:
  - restaurants.
  - bars/nightlife.
  - activity venues.
  - event organizers.
  - consumers.
- Need a stronger "why Mingla vs Eventbrite/POSH/222" comparison narrative.

---

## 12. Brainstorm Prompts

### Consumer Brainstorm

- What are the 20 most common "vibe" phrases people use before going out?
- What would the app ask if it were a friend who knows the city?
- How can Mingla make choosing a place feel easier than texting a group chat?
- What are the strongest before/after stories?
  - Before: endless Google/Yelp/TikTok search.
  - After: open Mingla, pick the vibe, go.
- What does Mingla know that Google Maps does not?
- What does Mingla know that TikTok does not?
- How do we turn "saved" into "went"?

### Business Brainstorm

- What does a restaurant want to sell besides a reservation?
- What does a bowling alley want to sell besides a lane?
- What does a bar want to sell besides a ticket?
- What should an AI marketing agent do every Monday morning for a venue?
- What campaign would a restaurant run when it has 20 empty tables tonight?
- What customer segments should Mingla automatically create?
- What would a business pay for: impressions, check-ins, bookings, revenue, repeat visits, or automation?

### Competitive Brainstorm

- If 222 says "pay for customers, not impressions," what is Mingla's sharper version?
- If Eventbrite says "create and sell tickets," what is Mingla's broader version?
- If POSH says "grow your community," what is Mingla's place/venue version?
- What feature would make a restaurant say, "This is not another Eventbrite"?
- What proof would make a venue trust Mingla after one campaign?

---

## 13. Suggested Product Narrative

### Short

Mingla helps people find the right place for the vibe, and helps businesses turn their place, menu, events, and parties into revenue with AI-powered marketing.

### Medium

Mingla is a social discovery and business growth platform for real-world experiences. Consumers use Mingla to find restaurants, bars, events, activities, and plans that match their taste, mood, friends, budget, and location. Businesses use Mingla Business to create beautiful pages, sell tickets and packages, promote menus and parties, automate campaigns, reach the right audience, and measure real visits and sales.

### Competitive

Mingla brings together the best parts of 222, Eventbrite, and POSH: foot traffic, ticketing, discovery, CRM, and community growth. But Mingla goes further by connecting them through a consumer taste graph, so businesses are not just posting events into a marketplace. They are matched with people who are most likely to love the place, show up, spend, and come back.

---

## 14. Source Notes

### Internal Repo Sources

- `README.md` for Mingla product architecture, consumer feature list, backend functions, and behavioral contracts.
- `app-mobile/README.md` for consumer app feature overview.
- `app-mobile/src/components/HomePage.tsx` for swipe deck, session switcher, notifications, and collaboration surface.
- `app-mobile/src/components/DiscoverScreen.tsx` for event discovery, Ticketmaster Night Out, filters, save behavior, and expanded details.
- `mingla-business/src/store/currentBrandStore.ts` for brand, team, Stripe, finance, public brand, and venue/pop-up model.
- `mingla-business/src/store/draftEventStore.ts` for draft event, recurrence, multi-date, ticket modifier, and publish model.
- `mingla-business/src/store/liveEventStore.ts` for published event model and public slug routing.
- `mingla-business/src/components/event/EventCreatorWizard.tsx` for current event-creator flow.
- `Mingla_Artifacts/specs/SPEC_BUSINESS_USER_JOURNEYS.md` and `SPEC_BUSINESS_DESIGN_SYSTEM_AND_SCREENS.md` for strategic Business product direction.

### External Sources

- 222 partner framing: https://partners.222.place/
- Eventbrite features/pricing: https://www.eventbrite.com/features
- Eventbrite marketing platform: https://www.eventbrite.com/organizer/features/event-marketing-platform/
- Eventbrite 2025 innovation announcement: https://investor.eventbrite.com/press-releases/press-releases-details/2025/Eventbrite-Announces-Listener-com-Partnership-and-Highlights-a-Year-of-Innovations-Designed-to-Help-Organizers-Reach-New-Audiences/default.aspx
- Eventbrite AI tools announcement: https://www.eventbrite.com/blog/press/newsroom/eventbrite-introduces-ai-powered-tools-to-empower-creators-and-reimagine-event-marketing
- POSH product/platform: https://posh.vip/product and https://posh.vip/platform
- POSH create event docs: https://docs.posh.vip/create-an-event
- POSH event attendees docs: https://docs.posh.vip/event-attendees
- POSH event settings docs: https://docs.posh.vip/event-settings
- POSH text blast docs: https://docs.posh.vip/text-blast-attendees

