-- Issue #3720 Wave 8 — Feature Guide explorer catalog.
-- Static source and regression evidence only: claimed-Live entries intentionally
-- remain Needs review until a person records current production proof.
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-STATIC-SEED-EXPLORER","rule":"Catalog seed rows contain only pinned static evidence and cannot become Live without a later human-reviewed live check and release record."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL THEN
    RAISE EXCEPTION 'issue3720_product_truth_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TEMP TABLE issue_3720_feature_seed ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($catalog$
[
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-swipe-deck",
    "title": "Swipe a deck of places picked for you",
    "outcome_summary": "Swipe a deck of places picked for you helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen swipe a deck of places picked for you flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps.",
    "support_wording": "Swipe a deck of places picked for you is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/SwipeableCards.tsx",
    "source_path": "app-mobile/src/components/SwipeableCards.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/services/__tests__/deckService.issue1384.test.ts",
    "test_path": "app-mobile/src/services/__tests__/deckService.issue1384.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/SwipeableCards.tsx",
      "app-mobile/src/services/deckService.ts",
      "supabase/functions/discover-cards/index.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-preferences",
    "title": "Set categories, budget, transport and travel time",
    "outcome_summary": "Set categories, budget, transport and travel time helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen set categories, budget, transport and travel time flow. Check the cited evidence before describing its production status.",
    "limitations": "A custom start point needs Mingla+. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Set categories, budget, transport and travel time is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/PreferencesSheet.tsx",
    "source_path": "app-mobile/src/components/PreferencesSheet.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/PreferencesSheet.tsx",
      "app-mobile/src/services/preferencesService.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-curated-plans",
    "title": "Multi-stop plans, with any stop swappable",
    "outcome_summary": "Multi-stop plans, with any stop swappable helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen multi-stop plans, with any stop swappable flow. Check the cited evidence before describing its production status.",
    "limitations": "Saving curated plans needs Mingla+. This is limited to Explorer apps.",
    "support_wording": "Multi-stop plans, with any stop swappable is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/contexts/RecommendationsContext.tsx",
    "source_path": "app-mobile/src/contexts/RecommendationsContext.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/_shared/replaceCuratedStopSlugParity.test.ts",
    "test_path": "supabase/functions/_shared/replaceCuratedStopSlugParity.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/contexts/RecommendationsContext.tsx",
      "supabase/functions/generate-curated-experiences/index.ts",
      "app-mobile/src/hooks/useReplaceStop.ts",
      "supabase/functions/replace-curated-stop/index.ts",
      "supabase/functions/get-companion-stops/index.ts",
      "app-mobile/src/components/LikesPage.tsx",
      "app-mobile/src/services/savedCardsService.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-place-details",
    "title": "Place details: photos, weather, busyness, directions",
    "outcome_summary": "Place details: photos, weather, busyness, directions helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen place details: photos, weather, busyness, directions flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Place details: photos, weather, busyness, directions is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/ExpandedCardModal.tsx",
    "source_path": "app-mobile/src/components/ExpandedCardModal.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/ExpandedCardModal.tsx",
      "app-mobile/src/components/expandedCard/ActionButtons.tsx",
      "app-mobile/src/services/weatherService.ts",
      "app-mobile/src/services/busynessService.ts",
      "supabase/functions/weather/index.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-events",
    "title": "Find events near you, including Ticketmaster events",
    "outcome_summary": "Find events near you, including Ticketmaster events helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen find events near you, including ticketmaster events flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps.",
    "support_wording": "Find events near you, including Ticketmaster events is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/DiscoverScreen.tsx",
    "source_path": "app-mobile/src/components/DiscoverScreen.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/utils/__tests__/discoverEventsCache.adversarial.test.ts",
    "test_path": "app-mobile/src/utils/__tests__/discoverEventsCache.adversarial.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/DiscoverScreen.tsx",
      "supabase/functions/discover-merged-events/index.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-trips",
    "title": "Find trips",
    "outcome_summary": "Find trips helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen find trips flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Find trips is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/discover/TripsContent.tsx",
    "source_path": "app-mobile/src/components/discover/TripsContent.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/discover/TripsContent.tsx"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "check_flag",
    "app_only": true,
    "capability_key": "discover-stays",
    "title": "Find and book stays",
    "outcome_summary": "Find and book stays helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen find and book stays flow. Check the cited evidence before describing its production status.",
    "limitations": "Stay flags are off in code by default. A live check must read the production flag or setting before promotion. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Find and book stays is built for Explorer, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/discover/StaysContent.tsx",
    "source_path": "app-mobile/src/components/discover/StaysContent.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270131013812_issue_1389_stay_commerce_schema.sql",
    "migration_path": "supabase/migrations/20270131013812_issue_1389_stay_commerce_schema.sql",
    "claim_refs": [
      "app-mobile/src/components/discover/StaysContent.tsx",
      "supabase/migrations/20270131013812_issue_1389_stay_commerce_schema.sql",
      "mingla-business/src/components/stay/StaySuiteShell.tsx",
      "supabase/functions/manage-stay-inventory/index.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-save-and-schedule",
    "title": "Save places and schedule them, including to your phone calendar",
    "outcome_summary": "Save places and schedule them, including to your phone calendar helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen save places and schedule them, including to your phone calendar flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Save places and schedule them, including to your phone calendar is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/LikesPage.tsx",
    "source_path": "app-mobile/src/components/LikesPage.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/LikesPage.tsx",
      "app-mobile/src/services/savedCardsService.ts",
      "app-mobile/src/components/activity/CalendarTab.tsx",
      "app-mobile/src/services/deviceCalendarService.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-reviews",
    "title": "Mark “been here” and rate a place",
    "outcome_summary": "Mark “been here” and rate a place helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen mark “been here” and rate a place flow. Check the cited evidence before describing its production status.",
    "limitations": "Reviews are moderated before they're saved. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Mark “been here” and rate a place is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/services/visitService.ts",
    "source_path": "app-mobile/src/services/visitService.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/services/visitService.ts",
      "app-mobile/src/services/placeReviewService.ts",
      "supabase/functions/record-visit/index.ts",
      "app-mobile/src/components/PostExperienceModal.tsx"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "discover-dismissed",
    "title": "See and restore cards you swiped away",
    "outcome_summary": "See and restore cards you swiped away helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen see and restore cards you swiped away flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "See and restore cards you swiped away is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/DismissedCardsSheet.tsx",
    "source_path": "app-mobile/src/components/DismissedCardsSheet.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/DismissedCardsSheet.tsx"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "removed",
    "app_only": false,
    "capability_key": "discover-map-nearby",
    "title": "Map of places and nearby people",
    "outcome_summary": "Map of places and nearby people was removed, so customers get a clear current answer instead of an obsolete path.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Do not direct customers to an old flow. Explain that the capability was removed and offer the current support path.",
    "limitations": "Backend exists, no app screen.",
    "support_wording": "Mingla no longer offers map of places and nearby people. Backend exists, no app screen",
    "claimed_status": "retired",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/hooks/useMapCards.ts",
    "source_path": "app-mobile/src/hooks/useMapCards.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/hooks/useMapCards.ts",
      "supabase/functions/update-map-location/index.ts",
      "app-mobile/src/hooks/useNearbyPeople.ts"
    ]
  },
  {
    "area": "Discovery and planning",
    "start_as": "removed",
    "app_only": false,
    "capability_key": "discover-leaderboard",
    "title": "Leaderboard",
    "outcome_summary": "Leaderboard was removed, so customers get a clear current answer instead of an obsolete path.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Do not direct customers to an old flow. Explain that the capability was removed and offer the current support path.",
    "limitations": "Removed from the app.",
    "support_wording": "Mingla no longer offers leaderboard. Removed from the app",
    "claimed_status": "retired",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/services/userLevelService.ts",
    "source_path": "app-mobile/src/services/userLevelService.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/services/userLevelService.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "social-friends",
    "title": "Add friends by phone or username, or invite someone new",
    "outcome_summary": "Add friends by phone or username, or invite someone new helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen add friends by phone or username, or invite someone new flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Add friends by phone or username, or invite someone new is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/ConnectionsPage.tsx",
    "source_path": "app-mobile/src/components/ConnectionsPage.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/ConnectionsPage.tsx",
      "supabase/functions/send-phone-invite/index.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "social-pairing",
    "title": "Pair with someone and get birthday and holiday ideas for them",
    "outcome_summary": "Pair with someone and get birthday and holiday ideas for them helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen pair with someone and get birthday and holiday ideas for them flow. Check the cited evidence before describing its production status.",
    "limitations": "Free plan: 1 pairing. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Pair with someone and get birthday and holiday ideas for them is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/services/pairingService.ts",
    "source_path": "app-mobile/src/services/pairingService.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/services/pairingService.ts",
      "supabase/functions/send-pair-request/index.ts",
      "app-mobile/src/components/PersonHolidayView.tsx",
      "supabase/functions/get-person-hero-cards/index.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "social-chat",
    "title": "1:1 and group chat with reactions, photos and shared cards",
    "outcome_summary": "1:1 and group chat with reactions, photos and shared cards helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen 1:1 and group chat with reactions, photos and shared cards flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "1:1 and group chat with reactions, photos and shared cards is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/MessageInterface.tsx",
    "source_path": "app-mobile/src/components/MessageInterface.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/MessageInterface.tsx",
      "app-mobile/src/services/messagingService.ts",
      "app-mobile/src/components/connections/CreateGroupChatSheet.tsx"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "social-collab-decide",
    "title": "Decide together: swipe a shared deck in a chat",
    "outcome_summary": "Decide together: swipe a shared deck in a chat helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen decide together: swipe a shared deck in a chat flow. Check the cited evidence before describing its production status.",
    "limitations": "Free plan: 1 session; people who join use the creator's plan. This is limited to Explorer apps.",
    "support_wording": "Decide together: swipe a shared deck in a chat is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/connections/CollabDeckSheet.tsx",
    "source_path": "app-mobile/src/components/connections/CollabDeckSheet.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/connections/__tests__/CollabDeckSheet.adversarial.test.tsx",
    "test_path": "app-mobile/src/components/connections/__tests__/CollabDeckSheet.adversarial.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/connections/CollabDeckSheet.tsx",
      "app-mobile/src/services/sessionService.ts",
      "supabase/functions/send-collaboration-invite/index.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "social-share",
    "title": "Share places, plans and events by link or in chat",
    "outcome_summary": "Share places, plans and events by link or in chat helps Explorer complete this job through Explorer apps · web.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps",
      "web"
    ],
    "how_to": "Open Explorer apps and follow the on-screen share places, plans and events by link or in chat flow. Check the cited evidence before describing its production status.",
    "limitations": "Link creation is controlled by a production setting. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Share places, plans and events by link or in chat is built for Explorer, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/share/UnifiedShareProvider.tsx",
    "source_path": "app-mobile/src/components/share/UnifiedShareProvider.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql",
    "migration_path": "supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql",
    "claim_refs": [
      "app-mobile/src/components/share/UnifiedShareProvider.tsx",
      "supabase/functions/shared-card/index.ts",
      "supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "social-safety",
    "title": "Block, report and mute people",
    "outcome_summary": "Block, report and mute people helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen block, report and mute people flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Block, report and mute people is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/BlockUserModal.tsx",
    "source_path": "app-mobile/src/components/BlockUserModal.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/BlockUserModal.tsx",
      "supabase/functions/moderate-content/index.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "social-follow-brands",
    "title": "Follow brands, including automatically after a purchase",
    "outcome_summary": "Follow brands, including automatically after a purchase helps Explorer and Buyer complete this job through Explorer apps · buyer web.",
    "who_can_use": [
      "Explorer",
      "Buyer"
    ],
    "surfaces": [
      "Explorer apps",
      "buyer web"
    ],
    "how_to": "Open Explorer apps and follow the on-screen follow brands, including automatically after a purchase flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Follow brands, including automatically after a purchase is built for Explorer and Buyer on Explorer apps · buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/hooks/useBrandFollow.ts",
    "source_path": "mingla-business/src/hooks/useBrandFollow.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/hooks/useBrandFollow.ts",
      "app-mobile/src/services/brandFollowsService.ts",
      "supabase/functions/brand-follow-action/index.ts",
      "app-mobile/src/components/profile/BrandsYouFollowSection.tsx"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "removed",
    "app_only": false,
    "capability_key": "social-tag-along",
    "title": "Ask to tag along on someone's plan",
    "outcome_summary": "Ask to tag along on someone's plan was removed, so customers get a clear current answer instead of an obsolete path.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Do not direct customers to an old flow. Explain that the capability was removed and offer the current support path.",
    "limitations": "Backend exists, no app screen.",
    "support_wording": "Mingla no longer offers ask to tag along on someone's plan. Backend exists, no app screen",
    "claimed_status": "retired",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/send-tag-along/index.ts",
    "source_path": "supabase/functions/send-tag-along/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "supabase/functions/send-tag-along/index.ts"
    ]
  },
  {
    "area": "Friends and social",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "social-referrals",
    "title": "Invite friends and get credit",
    "outcome_summary": "Invite friends and get credit is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Incoming referral links are recorded; there is no invite button.",
    "support_wording": "Mingla does not currently offer invite friends and get credit. Incoming referral links are recorded; there is no invite button",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/ConnectionsPage.tsx",
    "source_path": "app-mobile/src/components/ConnectionsPage.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/ConnectionsPage.tsx",
      "supabase/functions/send-phone-invite/index.ts",
      "mingla-marketing/public/.well-known/apple-app-site-association",
      "app-mobile/app/+native-intent.tsx"
    ]
  },
  {
    "area": "Mingla+",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "plus-subscription",
    "title": "Mingla+ subscription and what it unlocks",
    "outcome_summary": "Mingla+ subscription and what it unlocks helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen mingla+ subscription and what it unlocks flow. Check the cited evidence before describing its production status.",
    "limitations": "Free plan limits: 1 pairing, 1 session, no saving curated plans. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Mingla+ subscription and what it unlocks is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/CustomPaywallScreen.tsx",
    "source_path": "app-mobile/src/components/CustomPaywallScreen.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/CustomPaywallScreen.tsx",
      "app-mobile/src/services/revenueCatService.ts",
      "app-mobile/src/constants/tierLimits.ts"
    ]
  }
]
$catalog$::jsonb) AS seed(
    area text, capability_key text, title text, outcome_summary text,
    who_can_use jsonb, surfaces jsonb, how_to text, limitations text,
    support_wording text, claimed_status text, required_evidence_kinds jsonb,
    source_url text, source_path text, test_url text, test_path text,
    migration_url text, migration_path text, claim_refs jsonb
  );

INSERT INTO public.product_capabilities(
  capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
  limitations, support_wording, claimed_status, required_evidence_kinds,
  verification_due_at
)
SELECT capability_key, title, outcome_summary,
       ARRAY(SELECT jsonb_array_elements_text(who_can_use)),
       ARRAY(SELECT jsonb_array_elements_text(surfaces)),
       how_to, limitations, support_wording, claimed_status,
       ARRAY(SELECT jsonb_array_elements_text(required_evidence_kinds)),
       now() + interval '90 days'
  FROM issue_3720_feature_seed
ON CONFLICT (capability_key) DO NOTHING;

WITH evidence AS (
  SELECT capability_key, 'source'::text AS kind, source_url AS evidence_url,
         'Pinned catalog source at the approved commit.'::text AS details
    FROM issue_3720_feature_seed
  UNION ALL
  SELECT capability_key, 'test', test_url,
         'Pinned regression proof at the approved catalog commit.'
    FROM issue_3720_feature_seed WHERE test_url IS NOT NULL
  UNION ALL
  SELECT capability_key, 'migration', migration_url,
         'Pinned schema or server authority used by this capability.'
    FROM issue_3720_feature_seed WHERE migration_url IS NOT NULL
)
INSERT INTO public.product_capability_evidence(
  capability_id, evidence_kind, evidence_url, verdict, details, observed_at
)
SELECT capability.id, evidence.kind, evidence.evidence_url, 'verified',
       evidence.details, '2026-10-18T23:59:59Z'::timestamptz
  FROM evidence
  JOIN public.product_capabilities capability USING (capability_key)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_capability_evidence current_evidence
    WHERE current_evidence.capability_id = capability.id
      AND current_evidence.evidence_kind = evidence.kind
      AND current_evidence.is_current
 );

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM issue_3720_feature_seed seed
    JOIN public.product_capabilities capability USING (capability_key)
    WHERE seed.claimed_status = 'live'
      AND public.issue_3720_feature_guide_effective_status(capability.id) <> 'Needs review'
  ) THEN
    RAISE EXCEPTION 'issue3720_static_seed_promoted_without_live_proof';
  END IF;
END;
$guard$;

COMMIT;
