# ORCH-0765 Consumer Explorer Feature + Outcome Audit

Date: 2026-05-08  
Mode: Forensics  
Scope: Mingla consumer mobile app only (`app-mobile`)  
Requested outcome: Thoroughly identify the strongest consumer-app features, the outcomes they create for users, and the strategy implications for ICP/JTBD, positioning, and App Store creative.

## Executive Verdict

Mingla's consumer app is strongest when positioned as a **vibe-to-plan decision engine for social outings**, not as a generic events app, map app, or place directory.

The product's live center of gravity is:

1. **Set the vibe** through onboarding/preferences.
2. **Get a swipeable deck** of place and curated plan recommendations.
3. **Expand a card** for practical confidence: images, distance, travel time, price, hours, weather/busyness, directions, ticket/reservation links where available.
4. **Save or schedule** into Likes/Calendar.
5. **Bring people in** through friends, pairings, direct messages, collaboration sessions, boards, votes, RSVP, and lock-in.

For the initial consumer ICP, this directly supports the already-locked PMM direction: **Social Plan Captains**, with launch focus on **date-night couples** and **friend-group planners**, and new-city movers as a strategic expansion segment rather than the first headline.

## Confidence

Static code/documentation confidence: High.  
Runtime confidence: Medium. I did not run the app or inspect live device screenshots in this pass. This report proves feature wiring from code and existing Mingla artifacts, but any App Store screenshot brief should still use live current screenshots to confirm visual states and copy fit.

## Evidence Base

Key product docs:

- Root README says the consumer mobile app owns discovery, saving, planning, collaboration, events, feedback, and profile flows (`README.md:11`).
- App README repeats that `app-mobile` is the consumer-facing Expo app for discovery, saving, planning, collaboration, events, onboarding, profile, and feedback (`app-mobile/README.md:3`).
- Product quality constitution requires no dead taps, no fabricated data, no silent failures, and server state owned by React Query (`README.md:52-69`, `app-mobile/README.md:58-64`).
- PMM ICP research locks the beachhead as **urban/suburban 22-35 social plan captains**, with date-night, friend-group, and new-city segments prioritized in that order (`Mingla_Roadmap/research/CONSUMER_EXPLORER_ICP_JTBD.md:14-28`, `:199-205`).

Key app surfaces:

- Main authenticated tabs are Home/Explore, Discover, Friends, Likes, Profile (`app-mobile/app/index.tsx:2601-2722`, `:2734-2755`).
- Home mounts the preference top bar, session switcher, collaboration modal host, notifications, and `SwipeableCards` (`app-mobile/src/components/HomePage.tsx:221-342`).
- The live bottom nav labels are Explore, Discover, Friends, Likes, Profile (`app-mobile/app/index.tsx:2744-2750`).

## Feature Inventory

| Feature | Status | User Outcome | Evidence | App Store Claim Safety |
|---|---:|---|---|---|
| Vibe/preference onboarding | Live | User teaches Mingla what kind of outing they want | Onboarding copy covers value prop, intents, location, budget, transport, travel time, friends, collaborations (`app-mobile/src/i18n/locales/en/onboarding.json:73-199`) | Safe to claim "set your vibe" and "for dates, friends, solo runs." |
| Swipeable Explore deck | Live | Reduces search fatigue into fast yes/no decisions | `SwipeableCards` consumes unified recommendations and renders LIKE/PASS, saved/scheduled badges, distance, travel time, rating, price, category (`SwipeableCards.tsx:430-462`, `:1484-1615`, `:2286-2445`) | Safe to claim "swipe through places and plans that fit your vibe." |
| Signal-served place recommendations | Live | Better than generic nearby search because cards are served from selected category/intent signals | `discover-cards` uses multi-chip signal RPC fan-out and round-robin interleave, no external API call at serve time (`supabase/functions/discover-cards/index.ts:798-815`, `:944-1012`) | Safe to claim personalized/vibe-fit, but avoid "AI knows everything" unless paired with visible proof. |
| Curated multi-stop plans | Live, with caveat | User gets a full outing, not just a venue | Deck service runs category pipeline plus curated experiences, then interleaves (`app-mobile/src/services/deckService.ts:4-12`); expanded curated plans show stops, price, time, rating, travel between stops, replace/undo, directions (`ExpandedCardModal.tsx:595-720`, `:765-865`, `:1000-1178`) | Safe to show as "ready-made plans." Avoid promising perfect hours until ORCH-0644/curated hours caveat is cleared. |
| Stop replacement/customization | Live | User can keep the plan but swap one bad-fit stop | `MultiStopPlanView` fetches alternatives, applies `replaceStopInCard`, and provides undo (`ExpandedCardModal.tsx:662-720`, `:1000-1068`, `:1162-1170`) | Strong differentiator for screenshot/detail, especially couples. |
| Practical confidence details | Live | User can decide without opening five other apps | Expanded modal fetches weather, busyness, booking options, and shows sections for regular/curated/event cards (`ExpandedCardModal.tsx:1302-1402`, `:1640-1730`, `:1970-2025`) | Safe to claim "see the details before you go." Do not overclaim live booking coverage. |
| Save | Live | User can collect options without deciding now | Swipe right saves via `savedCardsService.saveCard`; expanded save is wired; Discover event grid can save/remove (`SwipeableCards.tsx:1533-1541`, `:1564-1570`; `DiscoverScreen.tsx:1029-1059`) | Safe. |
| Schedule / calendar | Live | User moves from idea to committed plan | `ActionButtons` blocks past dates, checks unknown/closed hours, writes `CalendarService.addEntryFromSavedCard`, then attempts device calendar sync (`ActionButtons.tsx:304-365`, `:470-615`) | Safe to claim schedule/lock in. Use "add to calendar" carefully because device calendar sync can fail without blocking saved app calendar. |
| Likes saved + calendar hub | Live | User can return to saved ideas and upcoming plans | Likes page receives saved cards and calendar entries (`app-mobile/app/index.tsx:2687-2706`); Saved/Calendar tabs support search/filter/refresh (`SavedTab.tsx:119-170`, `CalendarTab.tsx:91-133`, `:167-220`) | Safe. |
| Events / Night Out Discover | Live, narrower than core | User finds concerts/events by date, genre, price | Discover fetches Ticketmaster-style events by GPS/date/genre, caches per day/location/genre, filters price, saves and opens detail (`DiscoverScreen.tsx:830-955`, `:979-1118`, `:1235-1408`) | Safe to claim "find events nearby." Do not lead with this as the whole product. Discover event share is explicitly not implemented at one callsite (`DiscoverScreen.tsx:1403-1405`). |
| Ticket CTA / event detail | Live | User can act on an event | Event detail branch opens in-app ticket browser when `nightOutData` exists (`ExpandedCardModal.tsx:1703-1724`, `:1998-2005`) | Safe if screenshot shows event detail/tickets. Avoid broad "buy tickets for everything." |
| Friends + direct messages | Live | User can coordinate with real people, not just save alone | Connections includes friends, requests, blocked users, DMs, pairing pills, friend modal, search, and chat routing (`ConnectionsPage.tsx:61-96`, `:552-606`, `:1168-1426`, `:2420-2601`, `:2641-2896`) | Safe to claim "plan with friends." |
| Pairing | Live | Couples/best friends get shared personalization | Pairing hooks, pills, incoming pair requests, pair/unpair actions in Connections (`ConnectionsPage.tsx:73-74`, `:498-606`, `:2321-2360`) and product snapshot says paired-profile recs fixed with backend edge function v92 (`Mingla_Artifacts/PRODUCT_SNAPSHOT.md:65`) | Strong for couples. Avoid overpromising "relationship AI"; frame as "recommendations for both of you." |
| Collaboration sessions | Live | Turns a group chat into a shared planning mode | Session creation supports friends and phone invitees; session switcher opens invite/session modals; creation is tier-gated (`CollaborationSessions.tsx:221-238`, `:337-387`, `:407-529`, `:673-946`) | Very strong for friend groups. |
| Board cards, voting, RSVP, lock-in | Live | Group can compare options, vote, RSVP, and settle on a plan | Session view loads board cards/messages and renders board tabs (`SessionViewModal.tsx:193-288`, `:760-905`); `SwipeableSessionCards` sorts by votes, shows Locked In, RSVP progress, vote buttons (`SwipeableSessionCards.tsx:106-155`, `:247-270`, `:338-445`, `:520-537`); `useSessionVoting` reads/writes votes/RSVP/lock state (`useSessionVoting.ts:64-170`, `:172-280`) | This is one of Mingla's most differentiated features. Safe to claim "vote and lock in a plan" if screenshots show the actual board/locked state. |
| Board discussion + card comments | Live | Planning conversation stays attached to options | `BoardDiscussionTab` supports messages, attached card tags, mentions, replies, reactions, realtime read marking (`BoardDiscussionTab.tsx:97-255`, `:405-455`, `:529-570`); card-specific discussion modal exists (`SessionViewModal.tsx:834-843`) | Safe; likely secondary screenshot, not first three. |
| Invite and board management | Live | Group owner can keep the planning room useful | Board settings include editable name, notification mute, phone invites, friend invites, member list (`BoardSettingsDropdown.tsx:490-690`) | Safe, but operational; not App Store hero unless targeting group planning. |
| Post-experience feedback | Live/partial from shell evidence | User can close loop after plans | App renders `PostExperienceModal` when `pendingReview` exists (`app-mobile/app/index.tsx:2772-2783`); Mixpanel tracks reviews (`mixpanelService.ts:516-527`) | Not a launch screenshot priority unless runtime proves the modal. |
| Analytics | Live but incomplete for strategy-grade funnel | Product can measure onboarding, screen views, saves, schedule, sessions, friends | Mixpanel covers onboarding, preferences, collaboration, screens, friends, scheduling, reviews (`mixpanelService.ts:218-345`, `:364-513`); Swipeable tracks saves/dismisses and AppsFlyer wishlist (`SwipeableCards.tsx:1493-1525`) | Need event taxonomy audit before relying on every JTBD metric. |

## User Outcome Map

### Outcome 1: "I know where to go tonight."

Best-fit users:

- Date-night planner.
- Solo/local explorer.
- New city mover after activation.

What Mingla enables:

- Sets mood/intent, categories, budget, travel mode, travel time, and location.
- Serves a swipeable deck with practical badges.
- Lets user expand, save, share, schedule, and get directions.

Evidence:

- Onboarding value prop: "Know exactly where to go," "For dates, friends & solo runs," and "Swipe. Save. Go." (`onboarding.json:73-80`).
- Preferences include intent/category toggles, date, travel, location, and "Lock It In" (`preferences.json:1-84`).
- Explore cards show distance, travel time, rating, price, category, save/scheduled state, and share (`SwipeableCards.tsx:2375-2441`).

Strategic implication:

Lead with decision relief. The pain is not "I need a directory." It is "I want to go out, but I do not want to scroll forever or guess wrong."

### Outcome 2: "I can plan a date that feels thoughtful."

Best-fit users:

- Couples.
- First-date planners.
- Paired friends/partners.

What Mingla enables:

- Curated plans for first dates, romantic, picnic dates, strolls.
- Pairing to see experiences curated for both people.
- Multi-stop plan details with stop replacement, routes, price/time estimate, open hours, directions, and reservations.

Evidence:

- Intent copy includes First Dates, Romantic, Picnic Dates, Take a Stroll (`onboarding.json:81-97`).
- Pairing copy: "See experiences curated for both of you" (`onboarding.json:168-172`).
- Curated plan UI includes stop sequence, price/time/rating, replacement alternatives, weekly hours, directions, save/schedule/share (`ExpandedCardModal.tsx:595-1178`).

Strategic implication:

For couples, Mingla is not "date ideas." It is **date confidence**: less mental load, less awkwardness, more specificity.

### Outcome 3: "My group can actually pick something."

Best-fit users:

- Friend-group plan captains.
- Birthday/weekend organizers.
- People tired of group-chat indecision.

What Mingla enables:

- Create a planning session.
- Invite friends by app friend list or phone.
- Swipe in session mode.
- Promote mutually liked cards into board saved cards.
- Vote, RSVP, discuss, and lock in a plan.

Evidence:

- Collaboration onboarding promise: "Discover things to do, vote on favorites, and actually make it happen" (`onboarding.json:183-199`).
- Session creation/invites/phone invite are wired (`CollaborationSessions.tsx:337-387`, `:407-529`, `:673-946`).
- Board session shows saved cards, discussion, votes, RSVP, locked cards, and calendar prompt (`SessionViewModal.tsx:760-905`; `SwipeableSessionCards.tsx:106-155`, `:247-270`, `:338-445`).
- Collaboration calendar listens for card lock and prompts device-calendar sync (`useCollaborationCalendar.ts:32-83`, `:85-102`).

Strategic implication:

This is Mingla's clearest wedge against Yelp/Maps/Eventbrite/TikTok: those tools help one person browse; Mingla helps a group converge.

### Outcome 4: "I can save now and act later."

Best-fit users:

- Busy planners.
- New city movers building a local shortlist.
- Date-night planners comparing options.

What Mingla enables:

- Save from swipe, detail, or Discover.
- Search/filter saved cards.
- Schedule cards into a calendar entry.
- See upcoming and archive entries.

Evidence:

- Save writes through `savedCardsService.saveCard` from swipe and Discover (`SwipeableCards.tsx:1533-1541`; `DiscoverScreen.tsx:1029-1059`).
- Saved and Calendar tabs support search/filter/refresh (`SavedTab.tsx:119-170`, `CalendarTab.tsx:91-133`, `:167-220`).
- Schedule writes app calendar and attempts device calendar sync (`ActionButtons.tsx:566-615`).

Strategic implication:

This supports retention: saved cards and calendar entries create a reason to return after the first browse.

### Outcome 5: "I can discover real events, not just places."

Best-fit users:

- Night-out planners.
- Friend groups.
- Couples looking for date-night energy.

What Mingla enables:

- Discover tab for events.
- Date filters: tonight, weekend, next week, month.
- Price and genre filters.
- Save and ticket detail.

Evidence:

- Discover screen fetches events near GPS with radius/date/genre and caches them (`DiscoverScreen.tsx:911-955`).
- Date and filter chips are rendered in the header (`DiscoverScreen.tsx:1235-1311`).
- Event detail carries ticket URL/status and opens event layout (`DiscoverScreen.tsx:979-1017`; `ExpandedCardModal.tsx:1703-1724`).

Strategic implication:

Events should support the "night out" story, not replace the core story. The core is still plan choice and social decision-making.

## Claim Safety: What Not To Overclaim

1. **Do not lead with a map product.** Product snapshot says ORCH-0670 deleted the orphaned map subtree and dependencies; map claims in older competitive docs are stale (`Mingla_Artifacts/PRODUCT_SNAPSHOT.md:61`). The Discover tab still uses a map-outline icon, but the live feature is an events grid, not a consumer map surface.

2. **Do not claim Discover event sharing is fully implemented.** The expanded Discover event modal currently has a no-op share handler marked "Share not implemented for Discover events yet" (`DiscoverScreen.tsx:1403-1405`). Event cards can be saved and ticketed; sharing needs either runtime proof elsewhere or a fix.

3. **Do not promise curated plans always respect selected hours perfectly.** The app has scheduling-time checks for curated stops (`ActionButtons.tsx:473-505`), and the edge function filters curated stops by hours (`discover-cards/index.ts:456-515`, `:989-995`). But existing Product Snapshot flags curated-card hours fragility from ORCH-0641/ORCH-0644 (`Mingla_Artifacts/PRODUCT_SNAPSHOT.md:79-81`). Claim "checks hours before scheduling," not "every plan is always open."

4. **Do not overclaim booking/reservation coverage.** Expanded modal fetches booking options and opens policy/reservation URLs when websites exist (`ExpandedCardModal.tsx:1386-1402`; `ActionButtons.tsx:639-648`, `:860-865`). It is not evidence of universal reservation completion.

5. **Do not sell Mingla as only an events app.** Events are live and valuable, but the broader product is place + plan + people. Leading with events would flatten the differentiator.

6. **Be careful with "AI" language.** There are AI-like descriptions and curated experiences, but the safest external language is "vibe-fit recommendations" and "ready-made plans." Avoid black-box superlatives unless a runtime/demo surface explicitly names AI.

## ICP/JTBD Segmentation From Feature Reality

| Segment | Priority | Core JTBD | Best Features To Show | Why It Works |
|---|---:|---|---|---|
| Date-night couples | P0 | "Help me find a date plan that feels right without overthinking it." | Pairing, romantic/first-date intents, curated multi-stop plans, schedule, directions/reservations | The app has couple-specific intent language, pairings, and plan detail depth. |
| Friend-group plan captains | P0 | "Help my group choose something before the chat dies." | Collaboration sessions, shared deck, board cards, voting, RSVP, lock-in, discussion | This is Mingla's strongest differentiation versus search/review/event apps. |
| New city movers | P1 | "Help me quickly build taste-fit places and social routines in a city I don't know." | Explore deck, save hub, Discover events, friends/pairing after activation | Strong use case, but belonging/social graph claims should come after core discovery proof. |
| Solo explorers | P1/P2 | "Help me find something nearby that matches my mood now." | Explore deck, preferences, saved/calendar, events | Useful but less differentiated than social planning. |
| Occasion planners | P2 | "Help me plan a birthday/weekend/special outing." | Group sessions, curated plans, events, schedule | Likely strong later, but needs occasion-specific surfaced copy/screens. |

## App Store Screenshot Strategy Implications

The first three screenshots should communicate the product's hardest-working ideas:

1. **Mingla knows the vibe and gives you a plan.**  
   Recommended message: "Know exactly where to go."  
   Show: Explore deck with a visually strong card, preference/vibe context, distance/travel/price badges.

2. **It works for dates, friends, and solo outings.**  
   Recommended message: "Dates. Friends. Solo runs."  
   Show: curated plan or intent selection with date/friend/solo language. For couples, a multi-stop plan is more compelling than a generic venue card.

3. **It turns group indecision into a locked plan.**  
   Recommended message: "Pick the plan before the chat dies."  
   Show: collaboration board with vote/RSVP/Locked In state.

Secondary screenshots should cover:

4. Ready-made multi-stop plans with replaceable stops.
5. Expanded detail confidence: hours, weather/busyness, directions, reservations/tickets.
6. Discover events by tonight/weekend/genre/price.
7. Save ideas and schedule them.
8. Pair with someone and get recommendations for both of you.
9. Friends/direct messages/share saved cards.
10. Profile/preferences/privacy/localization if needed, but only after user-value screens.

## Product Gaps Worth Fixing Before Aggressive GTM

### Gap 1: Discover event share no-op

Evidence: `DiscoverScreen.tsx:1403-1405`.  
Impact: App Store or onboarding copy saying "share events with friends" could be false from that route.  
Recommendation: Either wire event share through `ShareModal` or avoid event-share claims.

### Gap 2: Map positioning debt

Evidence: Product snapshot says map subtree/deps deleted after being orphaned (`Mingla_Artifacts/PRODUCT_SNAPSHOT.md:61`).  
Impact: Competitive/product docs that mention map discovery can mislead designers and marketers.  
Recommendation: Remove map-forward copy from consumer positioning until a live map surface exists again.

### Gap 3: Curated hours trust caveat

Evidence: Edge/service code contains hours filtering and schedule-time warnings, but Product Snapshot still tracks curated-card hours fragility (`Mingla_Artifacts/PRODUCT_SNAPSHOT.md:79-81`).  
Impact: "Perfect date plan" claims can backfire if a stop is closed.  
Recommendation: Keep user-facing claim to "check hours before you go/schedule," and prioritize ORCH-0644 closeout if not already fixed.

### Gap 4: Analytics taxonomy is not yet enough for PMM funnel truth

Evidence: Mixpanel covers onboarding/preferences/screens/saves/schedules/sessions/friends/reviews (`mixpanelService.ts:218-513`), but there is no obvious complete JTBD funnel for "group plan created -> invite accepted -> card promoted -> vote -> locked -> calendar sync" in one named taxonomy.  
Impact: Harder to validate which ICP is activating/retaining.  
Recommendation: Create a consumer JTBD analytics spec before paid acquisition.

### Gap 5: Screenshot-worthy states may require seeded/demo data

Evidence: Best features depend on saved board cards, votes, RSVP, locked calendar entries, pairings, and curated cards.  
Impact: Random dev account screenshots may not show the strongest states.  
Recommendation: Build a launch screenshot demo account/data script or manual setup checklist.

## Recommended Positioning Language

Primary positioning:

> Mingla helps you find the right plan for the vibe, then make it happen with the people you care about.

Sharper App Store alternatives:

- "Know exactly where to go."
- "Find the plan that fits the vibe."
- "Swipe, save, and lock in the night."
- "Dates, friends, and solo runs without the endless search."
- "Turn group-chat maybes into a real plan."

Avoid:

- "The map for everything nearby."
- "Book anything instantly."
- "The best events app."
- "AI plans your entire life."

## Recommended Next Work

1. **ORCH-0765A: Runtime screenshot truth audit.** Launch the app with a demo account, capture each major surface, and map current visual states to App Store screenshot concepts.

2. **ORCH-0765B: Event share implementation or claim removal.** Fix Discover event share or mark event sharing out of App Store claims.

3. **ORCH-0765C: Curated hours closeout.** Re-open/resolve ORCH-0644 if still active; prove curated plans respect selected schedule at serve and schedule time.

4. **ORCH-0765D: Consumer JTBD analytics spec.** Define events for activation, first save, first share, first session, invite acceptance, board card promotion, vote, RSVP, lock-in, calendar sync, first return.

5. **ORCH-0765E: App Store creative brief refresh.** Rewrite the designer brief around the top ten claim-safe screenshots above, using current screenshots and giving design freedom on visual treatment.

## Final Read

Mingla's best consumer story is not "discover things to do." That is the category table stakes.

The stronger story is:

> Mingla starts with your vibe, gives you real options, turns those options into plans, and helps your people agree.

That story is specific enough for couples, friend groups, and new-city movers, while still broad enough to grow into solo discovery, occasions, and business-side marketplace loops later.
