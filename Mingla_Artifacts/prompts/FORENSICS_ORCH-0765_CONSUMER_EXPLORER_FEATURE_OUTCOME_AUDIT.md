# Investigation: Consumer Explorer Feature And User Outcome Audit (ORCH-0765)

## Mission

Perform a thorough forensic sweep of the Mingla consumer app / Explorer surface and produce:

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0765_CONSUMER_EXPLORER_FEATURE_OUTCOME_AUDIT.md`

The report must give Mingla a source-backed understanding of:

1. What great consumer-facing features exist today.
2. What each feature lets the user do.
3. What user outcome each feature creates.
4. What user segment/JTBD each feature supports.
5. What Mingla can credibly strategize, position, message, and showcase based on current product reality.
6. What is real, what is partially real, what is hidden, what is fragile, and what should not be claimed yet.

This is an investigation only. Do not implement. Do not spec fixes unless the final report recommends follow-on ORCHs. Do not rewrite strategy docs directly.

## Context

The operator wants to strategize around the consumer app with real product evidence, not vibes. The current PMM hypothesis is that Mingla Explorer is for the Social Plan Captain: people who plan dates, friend outings, and new-city discovery moments. Existing strategy says Mingla is strongest when positioned as vibe-fit social planning, not generic local search.

Plain-English impact:

If this investigation is done well, Mingla can build App Store screenshots, onboarding, product strategy, GTM, pricing, retention loops, and roadmap priorities around features the app actually has. If it is done lazily, Mingla may overclaim, under-sell its best features, or miss a strategically powerful surface that is already in the code.

## Scope

IN:

- Consumer mobile app only: `app-mobile/`.
- Consumer-facing backend paths that power Explorer, discovery, planning, social, events, saved, feedback, personalization, and notifications.
- Consumer-specific rows in `Mingla_Roadmap/` and `Mingla_Artifacts/`.
- Current code, current docs, current artifact evidence, current i18n strings, current schema/RLS/migrations relevant to the consumer journey.
- Feature inventory, outcome inventory, JTBD mapping, strategy implications, screenshot/story implications, and launch/readiness risks.

OUT:

- Mingla Business implementation work.
- Admin implementation work except where it powers consumer inventory quality or place intelligence.
- Product code changes.
- PMM copy rewrites in source docs.
- App Store image/design production.
- User research recruitment or external market research.

NON-GOALS:

- Do not create a sales deck, landing page, App Store screenshots, or pricing package.
- Do not declare production readiness unless current evidence proves it.
- Do not treat old strategy docs as proof of implemented features.
- Do not treat file names as proof that a flow is live; verify JSX/render/call paths.

## Evidence Trail

Start with these current source documents:

- `README.md`
- `app-mobile/README.md`
- `Mingla_Roadmap/research/CONSUMER_EXPLORER_ICP_JTBD.md`
- `Mingla_Roadmap/living/CUSTOMER_AND_ICP.md`
- `Mingla_Roadmap/living/PRODUCT_STRATEGY.md`
- `Mingla_Roadmap/living/FEATURE_PORTFOLIO.md`
- `Mingla_Roadmap/living/GTM_AND_POSITIONING.md`
- `Mingla_Artifacts/POSITIONING_AND_GTM_STRATEGY.md`
- `Mingla_Artifacts/MINGLA_PRODUCT_COMPETITIVE_ANALYSIS.md`
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/COVERAGE_MAP.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md`
- `docs/DOMAIN_ADRS.md`
- `docs/QUERY_KEY_REGISTRY.md`
- `docs/MUTATION_CONTRACT.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/TRANSITIONAL_ITEMS_REGISTRY.md`

Known PMM context to preserve:

- Current consumer ICP: Social Plan Captain.
- Priority segments: Date-night/couple planners, Friend-group plan captains, New-city social rebuilders.
- Core positioning: vibe-fit social planning, not generic local search.
- Primary emotional job: reduce blank-page planning, decision fatigue, group-chat indecision, and fear of picking the wrong place.

Known product/feature evidence already surfaced in docs:

- Swipe-based discovery deck.
- Preference-driven card serving by category, intent, budget, travel mode/constraint, date/time, location, and toggles.
- Mood/category/intents around date nights, first dates, group fun, solo adventure, romantic, creative/arts, picnic, drinks, casual eats, fine dining, play, wellness, groceries/flowers, work/business.
- AI/place quality gate and reason generation.
- Pool-first place/card pipeline.
- Multi-stop curated itinerary generation.
- Holiday and seasonal experience generation.
- Companion stops and picnic/grocery support.
- Ticketmaster/event layer with genre/date/price filters.
- Saved cards, calendar, scheduling, share, post-experience feedback.
- Friends, pairing, collaboration sessions, boards, voting, RSVP, board discussion, direct messaging, notifications.
- Nearby people, paired people, profile, privacy modes, blocking/reporting, onboarding, consent, locale/currency.

Related historical evidence to consider:

- ORCH-0749 mobile auth/cache/RLS log storm closed: startup/auth transitions calmer; `test:orch-0749` exists.
- ORCH-0684 paired-person view rewire closed: paired profile recommendations now show real cards, ranking can incorporate saved/joint-pair signals, ghost-field regression gates exist.
- ORCH-0690 schedule date-picker closed: shared scheduling flow now respects selected date/time and opening-hours constraints across many card surfaces.
- ORCH-0641 discovery chips closed: previously dead chip types now serve real cards; curated stop hours fragility noted under ORCH-0644.
- Product Snapshot has older closed consumer/chat-domain work around DM realtime, saved-card share, add-to-session, deck distance/travel-time, Discover polish, and removed orphan map subtree.

## Starting Files And Areas

Use these as starting points, then follow imports/calls/schema as needed.

Mobile app shell and navigation:

- `app-mobile/app/index.tsx`
- `app-mobile/app/_layout.tsx`
- `app-mobile/src/components/GlassBottomNav.tsx`
- `app-mobile/src/components/HomePage.tsx`
- `app-mobile/src/components/DiscoverScreen.tsx`
- `app-mobile/src/components/LikesPage.tsx`
- `app-mobile/src/components/SavedExperiencesPage.tsx`
- `app-mobile/src/components/ConnectionsPage.tsx`
- `app-mobile/src/components/ProfilePage.tsx`
- `app-mobile/src/components/OnboardingFlow.tsx`

Discovery/cards/planning:

- `app-mobile/src/components/SwipeableCards.tsx`
- `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`
- `app-mobile/src/components/ExpandedCardModal.tsx`
- `app-mobile/src/components/expandedCard/ActionButtons.tsx`
- `app-mobile/src/components/expandedCard/CardInfoSection.tsx`
- `app-mobile/src/components/expandedCard/CompanionStopsSection.tsx`
- `app-mobile/src/components/expandedCard/EventDetailLayout.tsx`
- `app-mobile/src/components/expandedCard/ImageGallery.tsx`
- `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx`
- `app-mobile/src/components/expandedCard/TimelineSection.tsx`
- `app-mobile/src/components/PicnicShoppingList.tsx`
- `app-mobile/src/components/PreferencesSheet.tsx`
- `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx`
- `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx`

Social planning, boards, sessions, chat:

- `app-mobile/src/components/CollaborationSessions.tsx`
- `app-mobile/src/components/GlassSessionSwitcher.tsx`
- `app-mobile/src/components/SessionViewModal.tsx`
- `app-mobile/src/components/AddToBoardModal.tsx`
- `app-mobile/src/components/SwipeableBoardCards.tsx`
- `app-mobile/src/components/BoardDiscussion.tsx`
- `app-mobile/src/components/board/BoardTabs.tsx`
- `app-mobile/src/components/board/SwipeableSessionCards.tsx`
- `app-mobile/src/components/board/BoardDiscussionTab.tsx`
- `app-mobile/src/components/activity/BoardCard.tsx`
- `app-mobile/src/components/chat/CardPreview.tsx`
- `app-mobile/src/components/chat/MessageBubble.tsx`
- `app-mobile/src/components/MessageInterface.tsx`

Friends, pairing, people:

- `app-mobile/src/components/connections/FriendsManagementList.tsx`
- `app-mobile/src/components/connections/AddFriendView.tsx`
- `app-mobile/src/components/connections/RequestsView.tsx`
- `app-mobile/src/components/FriendRequestsModal.tsx`
- `app-mobile/src/components/PairRequestModal.tsx`
- `app-mobile/src/components/IncomingPairRequestCard.tsx`
- `app-mobile/src/components/PairedPeopleRow.tsx`
- `app-mobile/src/components/PairedSavesListScreen.tsx`
- `app-mobile/src/components/profile/PairedProfileSection.tsx`
- `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
- `app-mobile/src/hooks/useFriends.ts`
- `app-mobile/src/hooks/useFriendsQuery.ts`
- `app-mobile/src/hooks/usePairings.ts`
- `app-mobile/src/hooks/usePairedCards.ts`
- `app-mobile/src/hooks/usePairedSaves.ts`

Saved, calendar, visits, feedback:

- `app-mobile/src/components/activity/SavedTab.tsx`
- `app-mobile/src/components/activity/CalendarTab.tsx`
- `app-mobile/src/components/CalendarButton.tsx`
- `app-mobile/src/components/PostExperienceModal.tsx`
- `app-mobile/src/components/BetaFeedbackButton.tsx`
- `app-mobile/src/components/BetaFeedbackModal.tsx`
- `app-mobile/src/hooks/useSavedCards.ts`
- `app-mobile/src/hooks/useSaveQueries.ts`
- `app-mobile/src/hooks/useCalendarEntries.ts`
- `app-mobile/src/hooks/useCollaborationCalendar.ts`
- `app-mobile/src/hooks/useVisits.ts`
- `app-mobile/src/hooks/usePostExperienceCheck.ts`

Onboarding, preferences, monetization, trust:

- `app-mobile/src/components/onboarding/*`
- `app-mobile/src/components/signIn/WelcomeScreen.tsx`
- `app-mobile/src/components/CustomPaywallScreen.tsx`
- `app-mobile/src/components/profile/BillingSheet.tsx`
- `app-mobile/src/hooks/useRevenueCat.ts`
- `app-mobile/src/hooks/useSubscription.ts`
- `app-mobile/src/hooks/useFeatureGate.ts`
- `app-mobile/src/services/mixpanelService.ts`
- `app-mobile/src/services/appsFlyerService.ts`

Core hooks/services to trace:

- `app-mobile/src/hooks/useDeckCards.ts`
- `app-mobile/src/hooks/useShuffleCards.ts`
- `app-mobile/src/hooks/useMapCards.ts`
- `app-mobile/src/hooks/useBoardSession.ts`
- `app-mobile/src/hooks/useSessionCreationGate.ts`
- `app-mobile/src/hooks/useSessionManagement.ts`
- `app-mobile/src/hooks/useSessionVoting.ts`
- `app-mobile/src/hooks/useSessionDiscussion.ts`
- `app-mobile/src/hooks/useNotifications.ts`
- `app-mobile/src/hooks/queryKeys.ts`
- `app-mobile/src/store/appStore.ts`
- `app-mobile/src/contexts/RecommendationsContext.tsx`
- `app-mobile/src/contexts/CardsCacheContext.tsx`
- `app-mobile/src/services/*`

Copy/i18n proof:

- `app-mobile/src/i18n/locales/en/onboarding.json`
- `app-mobile/src/i18n/locales/en/cards.json`
- `app-mobile/src/i18n/locales/en/discover.json`
- `app-mobile/src/i18n/locales/en/expanded_details.json`
- `app-mobile/src/i18n/locales/en/board.json`
- `app-mobile/src/i18n/locales/en/social.json`
- `app-mobile/src/i18n/locales/en/saved.json`
- `app-mobile/src/i18n/locales/en/profile.json`
- `app-mobile/src/i18n/locales/en/paywall.json`

Consumer backend / edge functions:

- `supabase/functions/discover-cards/index.ts`
- `supabase/functions/generate-curated-experiences/index.ts`
- `supabase/functions/get-person-hero-cards/index.ts`
- `supabase/functions/ticketmaster-events/index.ts`
- `supabase/functions/replace-curated-stop/index.ts`
- `supabase/functions/record-visit/index.ts`
- `supabase/functions/submit-feedback/index.ts`
- `supabase/functions/notify-calendar-reminder/index.ts`
- `supabase/functions/notify-session-match/index.ts`
- `supabase/functions/upsert-leaderboard-presence/index.ts`
- `supabase/functions/send-friend-accepted-notification/index.ts`
- `supabase/functions/send-pair-accepted-notification/index.ts`

Schema/RLS/migrations to inspect by search:

- `supabase/migrations/*.sql`
- Search for: `saved_experiences`, `saved_card`, `collaboration_sessions`, `session_participants`, `boards`, `board_votes`, `board_rsvps`, `messages`, `message_reads`, `calendar_entries`, `preferences`, `profiles`, `pairings`, `friend_requests`, `blocked_users`, `muted_users`, `notifications`, `place_pool`, `card_pool`, `ticketmaster`, `user_visits`, `user_preference_learning`, `subscriptions`, `referral_credits`.

## Required Investigation Questions

Answer each with source-backed evidence.

### A. What can a user do in Mingla Explorer today?

Produce a feature inventory grouped by user-facing job, not by code folder. At minimum cover:

- Start and complete onboarding.
- Set identity, location, language/country, preferences, budget, category, intent, travel/time constraints.
- Discover solo cards.
- Discover curated/multi-stop plans.
- Understand why a recommendation fits.
- View place/event details.
- Swipe/reject/save/share.
- Shuffle or refresh recommendations.
- Browse timely events.
- Build or join collaboration sessions.
- Invite friends or phone contacts.
- Pair with close people.
- Plan on boards.
- Vote/RSVP/comment/chat around cards.
- Save places/plans.
- Schedule plans to calendar.
- Receive notifications/reminders.
- Record visits/post-experience feedback.
- Manage profile, interests, subscription, blocking/reporting/privacy.

For each feature, classify:

- `LIVE / PARTIAL / HIDDEN / DEAD / STRATEGIC ONLY / UNKNOWN`
- Confidence: `HIGH / MEDIUM / LOW`
- Evidence: file paths and line references.

### B. What outcome does each feature create for the user?

Do not stop at "feature exists." Translate into user outcomes:

- Decision relief.
- Confidence in taste.
- Better date/night plan.
- Less group-chat chaos.
- More social commitment.
- More city familiarity.
- Better repeat routines.
- More personalized recommendations.
- More trust/safety/privacy.
- Less missed timing/hours/reservation friction.

Map each outcome to:

- Date-night planner.
- Friend-group plan captain.
- New-city social rebuilder.
- Occasion micro-planner.
- Solo explorer.

### C. What is strategically differentiated?

Identify the strongest differentiators that Mingla should consider leading with. Rank them by:

- User pain intensity.
- Product proof strength.
- App Store / marketing clarity.
- Retention potential.
- Referral or social loop potential.
- Monetization potential.
- Competitive defensibility.
- Current implementation confidence.

The output should not be generic. Name specific product moments and why they matter.

### D. What should Mingla avoid claiming?

List features or promises that are not safe to claim yet because they are:

- Not live.
- Hidden behind incomplete flows.
- Too fragile.
- Not supported by current copy/UI.
- Strategy-only.
- Technically present but not user-legible.
- Dependent on data density or external fixtures.

Include the exact evidence gap.

### E. Where are there product/story gaps?

Identify product realities that may weaken strategy:

- Strong backend but weak UI visibility.
- Strong UI but fragile data/RLS/backend.
- Great feature hidden too deep.
- Feature name/copy does not communicate outcome.
- Missing screenshot-worthy proof.
- Missing analytics for strategic validation.
- Inconsistent source of truth or old/local-state path.
- Empty states that make feature value hard to see.
- Trust/privacy concerns.

### F. What are the best App Store / onboarding / GTM storylines?

Based only on proven product reality, propose the top storylines Mingla can use:

- For first three App Store screenshots.
- For onboarding promise.
- For date-night segment.
- For friend-group segment.
- For new-city segment.
- For Mingla+ premium upgrade if evidence supports it.

Separate:

- `Safe to claim now`
- `Claim with careful wording`
- `Do not claim yet`

### G. What metrics should validate the strategy?

From the actual product flows and instrumentation, identify the measurable strategy proof points:

- Events already tracked in Mixpanel/AppsFlyer.
- Missing events that should be tracked later.
- Activation metrics.
- Save/share/session/vote/lock-in metrics.
- Date/friend/new-city intent proxies.
- Retention indicators.
- Monetization triggers.
- Business flywheel signals from consumer demand.

Do not implement analytics. Just map what exists and what is missing.

## Required Output Structure

Create:

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0765_CONSUMER_EXPLORER_FEATURE_OUTCOME_AUDIT.md`

Use this structure:

1. Executive Summary
   - Top 10 strongest consumer app features.
   - Top 5 user outcomes Mingla can credibly own.
   - Top 5 strategy implications.
   - Top 5 claim risks / gaps.

2. Method
   - Files/docs inspected.
   - Searches run.
   - What was not runtime-tested.
   - Evidence confidence rules.

3. Consumer Journey Map
   - Onboarding.
   - Discover.
   - Decide.
   - Plan with people.
   - Commit/go.
   - Save/return.
   - Feedback/learning.
   - Trust/privacy.

4. Feature Inventory Matrix
   - Feature.
   - User action.
   - User outcome.
   - Segment/JTBD.
   - Current status.
   - Evidence.
   - Strategic note.

5. Differentiator Ranking
   - Ranked list with rationale and evidence.

6. Segment Outcome Maps
   - Date-night/couple planner.
   - Friend-group plan captain.
   - New-city social rebuilder.
   - Occasion micro-planner.
   - Solo explorer.

7. App Store / GTM Implications
   - Strongest story.
   - First-three screenshot recommendation at the idea level.
   - Feature/story proof to give designer/PMM.
   - Claims to avoid.

8. Readiness And Fragility
   - What is strong.
   - What is partial.
   - What is hidden.
   - What is dead/orphaned if any.
   - What needs runtime proof.
   - What needs follow-on ORCH investigation/spec.

9. Metrics And Validation Plan
   - Existing instrumentation.
   - Missing instrumentation.
   - Cohort proof needed.

10. Recommendations
   - Immediate strategy recommendations.
   - Product/UX surfacing recommendations.
   - Follow-on ORCH candidates, if any, with severity and rationale.

11. Appendix
   - Source evidence by file/path.
   - Relevant historical ORCHs.
   - Search terms used.

## Constraints

- Do not write product code.
- Do not mutate database, Supabase, Stripe, GitHub, or deployed services.
- Do not run destructive commands.
- Prefer `rg` for search.
- Use current code over old docs when they conflict.
- Mark inference explicitly.
- File/line evidence is required for all strong claims.
- If a feature appears in docs but not live code, label it `STRATEGIC ONLY` or `UNKNOWN`, not implemented.
- If a component exists but no JSX/render route reaches it, label it `HIDDEN` or `DEAD` and show evidence.
- If a backend exists but UI does not surface it, label it as backend-backed but user-hidden.
- Do not collapse into a spec or implementation request. Recommendations for follow-on work are enough.

## Anti-Patterns To Avoid

- Do not produce a generic feature list.
- Do not copy old strategy docs as fact.
- Do not confuse admin/business event functionality with consumer Explorer unless consumer app directly uses it.
- Do not overclaim "AI" unless source code and user-visible copy support it.
- Do not treat "map" as live without proving navigation/render path; prior artifact history says a map subtree was deleted/orphaned in earlier work.
- Do not ignore privacy/safety flows when evaluating friends, pairing, nearby people, or social planning.
- Do not ignore error/empty/loading states; a feature is not strategy-ready if its failure state undermines trust.

## Success Criteria

The investigation succeeds if a PMM/product/design lead can use the report to answer:

- What are Mingla Explorer's best consumer features?
- What can users actually accomplish with them?
- Which features should lead product positioning?
- Which features should lead App Store screenshots?
- Which features should be hidden from claims until repaired/proven?
- What follow-on investigations/specs are needed before launch or GTM escalation?

