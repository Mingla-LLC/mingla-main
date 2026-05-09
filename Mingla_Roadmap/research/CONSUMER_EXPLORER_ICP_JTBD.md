# Consumer Explorer ICP And JTBD

> Status: first locked PMM segmentation draft.
> Owner: `$pmm-mingla`.
> Last updated: 2026-05-08.
> Product surface: Mingla Explorer / consumer app.
> Source artifacts: `Mingla_Roadmap/living/CUSTOMER_AND_ICP.md`, `Mingla_Roadmap/living/PRODUCT_STRATEGY.md`, `Mingla_Roadmap/living/GTM_AND_POSITIONING.md`, `app-mobile/src/i18n/locales/en/onboarding.json`, `app-mobile/src/i18n/locales/en/cards.json`, `app-mobile/src/i18n/locales/en/discover.json`.
> External validation sources: Sprout Social Q2 2025 Pulse Survey press release, Gensler City Pulse 2025 press release, OpenTable 2025 Dining Predictions, Cigna Loneliness in America, Community Mental Health Journal analysis of 2024 CDC Household Pulse Survey.
> Confidence: Medium. Strong directional validation; Mingla-specific quantitative demand and retention still need primary research.
> Staleness assessment: Current as of 2026-05-08; refresh after first consumer cohort analytics or city launch data.

## Recommendation

Mingla Explorer's initial consumer ICP should be **social planners with recurring intent**, not generic local discovery users.

The beachhead is:

**Urban/suburban 22-35 year old plan captains who regularly choose where to go for a partner, date, or small friend group and are tired of screenshot-driven, social-search-heavy planning that still ends in indecision.**

Within that beachhead, prioritize:

| Priority | Segment | Why |
|---:|---|---|
| 1 | Date-night and couple planners | Highest emotional cost of a bad pick, recurring need, strong fit with vibe/taste, clear Mingla+ upgrade path. |
| 2 | Friend-group plan captains | Strongest referral loop, best fit for collaboration sessions, high group dining/activity validation. |
| 3 | New-city social rebuilders | Deepest pain and strong mission fit, but acquisition and habit formation are harder without dense local supply/community loops. |

Do not lead with "everyone looking for things to do." That is too broad and pushes Mingla into Google Maps/Yelp/Eventbrite territory. Lead with the moment: **"we want to go out, but nobody knows what fits the vibe."**

## Market Validation

| Signal | What it supports | ICP implication |
|---|---|---|
| Sprout Social's Q2 2025 Pulse Survey says 41% of Gen Z search social platforms first, ahead of traditional search, and 35% of consumers use social first for local restaurants/activities. Source: https://sproutsocial.com/insights/press/new-research-from-sprout-social-finds-social-media-is-the-top-place-gen-z-turns-to-for-search-surpassing-traditional-search-engines/ | Local discovery has shifted from static search to visual, taste-led social discovery. | Mingla should not position as another directory. It should feel like a faster, more decisive layer after TikTok/Instagram inspiration. |
| OpenTable reports 71% of Gen Z and 68% of Millennials planned to dine out more in 2025, parties of 6+ were up 8% YoY, 43% planned to group dine more frequently, and 42% were more interested in experiential dining. Source: https://www.opentable.com/blog/press/page/opentable-serves-up-2025-dining-predictions/ | Younger consumers are still investing in in-person plans, group dining, and experience-led outings. | Friend-group planning is a real usage wedge, not a side feature. |
| Gensler City Pulse 2025 found that city retention is tied to belonging/pride and that people living in a city fewer than five years are more likely to consider leaving. Source: https://www.gensler.com/press-releases/city-pulse-magnetic-city-2025 | New movers need emotional connection to place, not just maps. | New-city users are a strong mission segment, especially in fast-growing launch cities, but need community/event density. |
| Cigna highlights lack of social support and infrequent meaningful interactions as contributors to loneliness; a 2026 analysis of 2024 CDC Household Pulse Survey data estimated frequent loneliness and perceived social isolation among U.S. adults in the post-COVID period. Sources: https://newsroom.cigna.com/index.php?cat=3211&s=20314 and https://link.springer.com/article/10.1007/s10597-026-01630-9 | Connection is a real customer context, not just an entertainment trend. | Mingla should frame Explorer around making plans and belonging, not passive browsing. |

## Primary ICP

| Attribute | Definition |
|---|---|
| Name | The Social Plan Captain |
| Age / life stage | 22-35; dating, partnered, early career, recently relocated, or socially active post-college/post-grad. |
| Geography | Dense enough city/suburb where restaurants, events, bars, pop-ups, parks, markets, and experiences are reachable within 5-45 minutes. |
| Behavior | Uses TikTok, Instagram, Google Maps, Yelp, Eventbrite/Posh, texts, screenshots, saved lists, and friend recs to decide where to go. |
| Trigger | A date, weekend, birthday, visiting friend, new-city exploration, after-work plan, or "we should do something" moment. |
| Pain | Too many options, stale recommendations, unclear fit, group indecision, pressure to pick well, and no easy way to convert inspiration into a plan. |
| Desired outcome | A short, vibe-fit set of options that feels personal, current, close enough, budget-aware, and easy to share or lock in. |
| Product fit | Onboarding taste capture, vibe/preferences, nearby cards, save/share, events filters, friend pairing, collaboration sessions, voting, calendar. |
| Monetization fit | Free for discovery/referral; Mingla+ for premium planning, more sessions, richer personalization, date/occasion modes, saved playbooks, and advanced collaboration. |

## Segment Map

| Segment | Priority | Core job | Pain intensity | Frequency | Virality | Monetization | Launch notes |
|---|---:|---|---:|---:|---:|---:|---|
| Date-night planner | 1 | Find a plan that feels thoughtful and low-risk for a partner/date. | High | Weekly/monthly | Medium | High | Best first positioning wedge because the emotional job is clear. |
| Friend-group plan captain | 1 | Get a small group to agree on where to go without chat chaos. | High | Weekly/monthly | High | Medium | Best organic growth wedge through invites, sessions, and voting. |
| New-city social rebuilder | 2 | Learn the city and build a social rhythm after moving. | Very high | Weekly | Medium | Medium | Strong city-launch angle; needs density and community partnerships. |
| Occasion micro-planner | 3 | Plan birthdays, visitors, holidays, anniversaries, or special nights. | Medium/high | Episodic | Medium | Medium/high | Useful packaged modes, but not enough alone for habit. |
| Solo explorer | 4 | Find something to do alone that fits mood, distance, and budget. | Medium | Weekly | Low | Low/medium | Good retention filler; weak launch ICP unless tied to new-city belonging. |
| Deal seeker / generic restaurant browser | Not ICP | Find cheap/nearby/high-rated options. | Low/medium | High | Low | Low | Too commodity; belongs to Google Maps/Yelp/OpenTable. |
| Tourist/trip planner | Not initial ICP | Plan a visit to an unfamiliar city. | Medium | Episodic | Low | Medium | Attractive later, but launch supply and repeat behavior are weaker. |

## Jobs To Be Done

| Job ID | Segment | Situation | Motivation | Desired outcome | Current workaround | Product implication | Confidence |
|---|---|---|---|---|---|---|---|
| `JTBD-CONS-01` | Date-night planner | When I need a date idea for tonight/this weekend | I want options that match our vibe, budget, distance, and energy | So the plan feels thoughtful without hours of searching | TikTok saves, Google Maps lists, Reddit, friend texts | Date-night mode, vibe filters, "why this fits", save/share, route/calendar | High |
| `JTBD-CONS-02` | Friend-group plan captain | When the group chat is stuck | I want everyone to react to the same shortlist | So we can pick something and stop debating | Screenshots, polls, long text threads | Collaboration sessions, swipe/vote, locked-in choice, invite links | High |
| `JTBD-CONS-03` | New-city social rebuilder | When I have free time but do not know the city yet | I want a trusted way to discover places/events that fit me | So I can build routines, memories, and belonging | Google/TikTok rabbit holes, Meetup, coworker recs | City starter packs, neighborhood learning, recurring rituals, social onboarding | Medium |
| `JTBD-CONS-04` | Occasion micro-planner | When a birthday/visitor/anniversary is coming up | I want a plan that feels special and appropriate | So I do not default to the same stale restaurant | Notes app, saved reels, booking apps | Occasion templates, budget/transport constraints, itinerary cards | Medium |
| `JTBD-CONS-05` | Solo explorer | When I want to get out alone | I want a safe, comfortable, vibe-fit option | So I can enjoy the city without needing a group | Maps, coffee lists, solo dining searches | Solo-friendly tags, time-of-day safety/context, low-friction saves | Medium/low |

## ICP Personas

### 1. The Date-Night Initiator

| Field | Detail |
|---|---|
| User story | "I want the plan to feel like I thought about it, but I do not want to spend my whole lunch break comparing places." |
| Who they plan for | Partner, first date, spouse, situationship, double date. |
| Failure mode | Too basic, too loud, too expensive, too far, not enough to do after dinner, awkward vibe mismatch. |
| Buying trigger | Weekend/date pressure, anniversary, Valentine's Day, birthday, relationship routine getting stale. |
| Mingla promise | "Find a date plan that actually fits the two of you." |
| Proof Mingla needs | Higher save-to-plan rate for date-intent users; repeat date-night usage within 30 days; willingness to pay for premium date modes. |

### 2. The Friend-Group Plan Captain

| Field | Detail |
|---|---|
| User story | "Everyone says they are down, but nobody wants to decide. I need three good options people can react to fast." |
| Who they plan for | 3-8 friends, birthday crew, brunch group, nightlife group, visiting friends. |
| Failure mode | Group chat dies, one person dominates, plan is too expensive/far, nobody commits. |
| Buying trigger | Weekend plan, birthday, concert/event night, friend visiting town, "we have not hung out in a while." |
| Mingla promise | "Turn the group chat into a plan." |
| Proof Mingla needs | Invites sent per session, participant response rate, locked plan rate, invite-to-signup conversion. |

### 3. The New-City Social Rebuilder

| Field | Detail |
|---|---|
| User story | "I moved here, I know the obvious places, but I do not know where my people go yet." |
| Who they plan for | Self, roommate, new coworkers, new dates, early local friends. |
| Failure mode | Feeling like an outsider, only finding touristy/obvious places, not knowing neighborhood norms, difficulty finding repeatable routines. |
| Buying trigger | Move within last 0-24 months, new job/school, breakup, post-grad transition, remote-work isolation. |
| Mingla promise | "Learn your city through plans that feel like you." |
| Proof Mingla needs | Local onboarding completion, D7/D30 retention, saves by neighborhood/category, conversion from solo discovery to social invite. |

## Product Implications

| Need | Product requirement |
|---|---|
| Reduce blank-page planning | Default to intent modes: Date Night, Group Night, New Here, Visitors, Birthday, Solo Reset. |
| Make recs feel trustworthy | Explain "why this fits" using vibe, distance, price, open status, event timing, and friend/partner taste overlap. |
| Convert inspiration into commitment | Every recommendation should support save, share, vote, calendar, directions, and ticket/reservation handoff where available. |
| Support social proof without becoming noisy social media | Use friend/partner reactions, matches, and saved cards more than public follower feeds. |
| Preserve privacy | Pairing and friend planning should be explicit, reversible, and clear about what taste/location data is shared. |
| Feed Business strategy | Consumer demand should create signal for event/venue categories, not just passive likes. Track intent, saves, shares, session locks, and ticket/reservation clicks. |

## Positioning

### Sharp Consumer Positioning

For social planners who are tired of stale searches and dead group chats, Mingla Explorer is a vibe-based planning app that turns "what should we do?" into a shortlist people can actually agree on.

Unlike Google Maps, Yelp, TikTok saves, or group texts, Mingla connects taste, context, friends, and local experiences in one planning flow.

### Segment-Specific Messages

| Segment | Message |
|---|---|
| Date-night planner | "Date night ideas that fit the two of you." |
| Friend-group plan captain | "Pick the plan before the chat dies." |
| New-city social rebuilder | "Find your places. Build your rhythm." |
| Occasion micro-planner | "Make the plan feel special without starting from scratch." |
| Solo explorer | "Get out without guessing where to go." |

## Metrics

| Funnel stage | Metric | Why it matters |
|---|---|---|
| Acquisition | Signup source by intent: date, friends, new city, solo, event | Identifies winning segment and channel. |
| Activation | Completed onboarding with location + >=3 intents + first save | Confirms taste/location foundation. |
| Planning | Cards viewed to saves; saves to shares; shares to accepted invites | Measures movement from browsing to planning. |
| Collaboration | Sessions created, invites sent, vote response rate, locked-in plan rate | Validates friend-group JTBD. |
| Retention | D7/D30 active planners by segment | Separates novelty from habit. |
| Monetization | Mingla+ trial/start rate by segment and premium feature used | Finds willingness to pay. |
| Business flywheel | Event/ticket/reservation clicks from Explorer | Connects consumer demand graph to Business revenue. |

## Research Plan

### Interviews

Run 8-10 interviews per priority segment in the launch geography.

| Segment | Screen for |
|---|---|
| Date-night planner | Planned at least 2 dates in last 60 days; used social/search/apps to choose. |
| Friend-group plan captain | Initiated at least 2 group outings in last 60 days; sent screenshots/links/polls. |
| New-city social rebuilder | Moved to current city within 24 months; actively trying to find places/events/community. |

### Must-Ask Questions

1. Tell me about the last time you planned going out with someone. What triggered it?
2. Where did you search first, second, and third?
3. What made an option feel safe/good enough to suggest?
4. What killed momentum?
5. What did you send to the other person or group?
6. How did the final decision happen?
7. What would have made the decision faster or more confident?
8. What would you pay for, if anything?
9. What would feel creepy or too invasive?
10. What would make you invite someone else into the app?

### Validation Targets

| Hypothesis | Pass signal |
|---|---|
| Date-night planners are the strongest monetization segment | >=25% say they would try premium for better date planning, and prototype test shows high repeat intent. |
| Friend groups are the strongest growth loop | >=40% of sessions send at least one invite; >=25% of invitees respond/vote. |
| New-city users have high retention potential | New-city cohort shows higher D30 retention than generic discovery users. |
| "Vibe" is meaningful, not decorative | Users can explain why a recommendation fits in their own words and trust the explanation. |

## Risks And Assumptions

| Type | Item |
|---|---|
| Fact | Current app copy already supports dates, friends, solo runs, group fun, location, friends/pairing, collaboration, saving, sharing, calendar, and event filters. |
| Fact | External data supports social-first local discovery, increased experiential/group dining interest, and young-adult connection pain. |
| Assumption | The launch city has enough high-quality local supply for recommendations to feel fresh. |
| Assumption | Users will invite friends/partners if the planning object is useful before the network is large. |
| Risk | If recommendations are stale or too generic, Mingla becomes a prettier Yelp/TikTok save list. |
| Risk | If collaboration requires too much setup, group users will stay in text threads. |
| Risk | If "new-city belonging" is overclaimed, Mingla may sound like a community platform before it has community density. |
| Open question | Which consumer wedge should own the first acquisition campaign: date nights, friend plans, or new-city discovery? |
| Open question | Which premium feature has highest willingness to pay: more personalized recs, more sessions, date/occasion templates, or concierge-like itinerary generation? |

## Locked Decision

Use **Social Plan Captain** as the umbrella ICP for Mingla Explorer.

Use **Date-Night Planner** and **Friend-Group Plan Captain** as the launch subsegments.

Keep **New-City Social Rebuilder** as the strategic expansion segment once city density, local partnerships, and repeat-use loops are proven.
