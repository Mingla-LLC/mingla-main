-- Issue #3720 Wave 8 — Feature Guide host operations catalog.
-- Static source and regression evidence only: claimed-Live entries intentionally
-- remain Needs review until a person records current production proof.
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-STATIC-SEED-HOST-OPERATIONS","rule":"Catalog seed rows contain only pinned static evidence and cannot become Live without a later human-reviewed live check and release record."}

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
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "account-explorer-sign-in",
    "title": "Sign in to Explorer with Apple, Google or an emailed code",
    "outcome_summary": "Sign in to Explorer with Apple, Google or an emailed code helps Explorer complete this job through Explorer iOS · Android.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer iOS",
      "Android"
    ],
    "how_to": "Open Explorer iOS and follow the on-screen sign in to explorer with apple, google or an emailed code flow. Check the cited evidence before describing its production status.",
    "limitations": "Apple sign-in is iOS only. This is limited to Explorer iOS · Android. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Sign in to Explorer with Apple, Google or an emailed code is built for Explorer on Explorer iOS · Android. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/signIn/WelcomeScreen.tsx",
    "source_path": "app-mobile/src/components/signIn/WelcomeScreen.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/signIn/WelcomeScreen.tsx",
      "app-mobile/src/hooks/useAuthSimple.ts",
      "app-mobile/src/services/emailOtpService.ts"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "account-host-sign-in",
    "title": "Sign in to Mingla Host with Google, Apple or an emailed code",
    "outcome_summary": "Sign in to Mingla Host with Google, Apple or an emailed code helps Host complete this job through Host iOS · Android · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host iOS",
      "Android",
      "web"
    ],
    "how_to": "Open Host iOS and follow the on-screen sign in to mingla host with google, apple or an emailed code flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Sign in to Mingla Host with Google, Apple or an emailed code is built for Host on Host iOS · Android · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/context/AuthContext.tsx",
    "source_path": "mingla-business/src/context/AuthContext.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/context/AuthContext.tsx"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "account-explorer-onboarding",
    "title": "Explorer onboarding: phone check, interests, launch-city check",
    "outcome_summary": "Explorer onboarding: phone check, interests, launch-city check helps Explorer complete this job through Explorer iOS · Android.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer iOS",
      "Android"
    ],
    "how_to": "Open Explorer iOS and follow the on-screen explorer onboarding: phone check, interests, launch-city check flow. Check the cited evidence before describing its production status.",
    "limitations": "Phone code by SMS, WhatsApp or call; picks up where you left off. This is limited to Explorer iOS · Android.",
    "support_wording": "Explorer onboarding: phone check, interests, launch-city check is built for Explorer on Explorer iOS · Android. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/OnboardingFlow.tsx",
    "source_path": "app-mobile/src/components/OnboardingFlow.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts",
    "test_path": "app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts",
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
    "migration_path": "supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
    "claim_refs": [
      "app-mobile/src/components/OnboardingFlow.tsx",
      "app-mobile/src/components/SpotlightOverlay.tsx",
      "app-mobile/src/services/otpService.ts",
      "supabase/functions/send-otp/index.ts",
      "app-mobile/src/hooks/useLaunchCityGate.ts",
      "supabase/functions/check-launch-city/index.ts",
      "supabase/migrations/20260810000000_orch_1027_launch_cities.sql"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "check_flag",
    "app_only": true,
    "capability_key": "account-launch-cities",
    "title": "Which cities Explorer is open in",
    "outcome_summary": "Which cities Explorer is open in helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen which cities explorer is open in flow. Check the cited evidence before describing its production status.",
    "limitations": "Read the live city list in production. A live check must read the production flag or setting before promotion. This is limited to Explorer apps.",
    "support_wording": "Which cities Explorer is open in is built for Explorer, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "feature_flag",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/hooks/useLaunchCityGate.ts",
    "source_path": "app-mobile/src/hooks/useLaunchCityGate.ts",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts",
    "test_path": "app-mobile/src/hooks/__tests__/useLaunchCityGate.adversarial.test.ts",
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
    "migration_path": "supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
    "claim_refs": [
      "app-mobile/src/hooks/useLaunchCityGate.ts",
      "supabase/functions/check-launch-city/index.ts",
      "supabase/migrations/20260810000000_orch_1027_launch_cities.sql",
      "mingla-admin/src/pages/LaunchCitiesPage.jsx"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "account-settings",
    "title": "Language, currency, privacy and quiet hours",
    "outcome_summary": "Language, currency, privacy and quiet hours helps Explorer complete this job through Explorer apps.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer apps"
    ],
    "how_to": "Open Explorer apps and follow the on-screen language, currency, privacy and quiet hours flow. Check the cited evidence before describing its production status.",
    "limitations": "29 languages. This is limited to Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Language, currency, privacy and quiet hours is built for Explorer on Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/ProfilePage.tsx",
    "source_path": "app-mobile/src/components/ProfilePage.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/ProfilePage.tsx",
      "app-mobile/src/components/profile/AccountSettings.tsx"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "account-notification-settings",
    "title": "Choose which notifications you get",
    "outcome_summary": "Choose which notifications you get helps Explorer and Host complete this job through All apps.",
    "who_can_use": [
      "Explorer",
      "Host"
    ],
    "surfaces": [
      "All apps"
    ],
    "how_to": "Open All apps and follow the on-screen choose which notifications you get flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Choose which notifications you get is built for Explorer and Host on All apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/hooks/useNotificationPrefs.ts",
    "source_path": "app-mobile/src/hooks/useNotificationPrefs.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/hooks/useNotificationPrefs.ts",
      "mingla-business/app/account/notifications.tsx"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "account-delete",
    "title": "Delete your account",
    "outcome_summary": "Delete your account helps Explorer and Host complete this job through All apps.",
    "who_can_use": [
      "Explorer",
      "Host"
    ],
    "surfaces": [
      "All apps"
    ],
    "how_to": "Open All apps and follow the on-screen delete your account flow. Check the cited evidence before describing its production status.",
    "limitations": "The server can block deletion, for example while money is owed.",
    "support_wording": "Delete your account is built for Explorer and Host on All apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/account/delete.tsx",
    "source_path": "mingla-business/app/account/delete.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/ari/__tests__/issue_1983_account_deletion_confirm.test.ts",
    "test_path": "mingla-business/src/components/ari/__tests__/issue_1983_account_deletion_confirm.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/account/delete.tsx",
      "supabase/functions/delete-user/index.ts"
    ]
  },
  {
    "area": "Accounts and sign-in",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "account-switch-explorer-host",
    "title": "Switch between Explorer and Host in one app",
    "outcome_summary": "Switch between Explorer and Host in one app is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Explorer",
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built; a dev-only preview card exists.",
    "support_wording": "Mingla does not currently offer switch between explorer and host in one app. Not built; a dev-only preview card exists",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/config/featureFlags.ts",
    "source_path": "app-mobile/src/config/featureFlags.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/config/featureFlags.ts",
      "mingla-business/src/config/featureFlags.ts"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-create",
    "title": "Create one or more brands and switch between them",
    "outcome_summary": "Create one or more brands and switch between them helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen create one or more brands and switch between them flow. Check the cited evidence before describing its production status.",
    "limitations": "The payout country is chosen at creation. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Create one or more brands and switch between them is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/new.tsx",
    "source_path": "mingla-business/app/brand/new.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/new.tsx"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-profile",
    "title": "Edit your brand profile, cover and logo",
    "outcome_summary": "Edit your brand profile, cover and logo helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen edit your brand profile, cover and logo flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Edit your brand profile, cover and logo is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/[id]/edit.tsx",
    "source_path": "mingla-business/app/brand/[id]/edit.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/[id]/edit.tsx",
      "packages/brand-rendering/index.ts"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-team-roles",
    "title": "Invite your team with roles: owner, admin, event, finance, marketing, scanner",
    "outcome_summary": "Invite your team with roles: owner, admin, event, finance, marketing, scanner helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen invite your team with roles: owner, admin, event, finance, marketing, scanner flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Invite your team with roles: owner, admin, event, finance, marketing, scanner is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/[id]/team.tsx",
    "source_path": "mingla-business/app/brand/[id]/team.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/[id]/team.tsx",
      "supabase/functions/invite-brand-member/index.ts"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-audit-log",
    "title": "Brand audit log",
    "outcome_summary": "Brand audit log helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen brand audit log flow. Check the cited evidence before describing its production status.",
    "limitations": "Admins and above; today you see only your own actions. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Brand audit log is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/[id]/audit-log.tsx",
    "source_path": "mingla-business/app/brand/[id]/audit-log.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/[id]/audit-log.tsx"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-organiser-terms",
    "title": "Accept the Organiser Terms before publishing",
    "outcome_summary": "Accept the Organiser Terms before publishing helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen accept the organiser terms before publishing flow. Check the cited evidence before describing its production status.",
    "limitations": "A new version asks you to accept again. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Accept the Organiser Terms before publishing is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/hooks/useOrganiserTermsPublishGate.ts",
    "source_path": "mingla-business/src/hooks/useOrganiserTermsPublishGate.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/hooks/useOrganiserTermsPublishGate.ts",
      "mingla-marketing/app/organiser-terms/page.tsx",
      "supabase/functions/brand-mingla-tos-accept/index.ts"
    ]
  },
  {
    "area": "Brands and teams",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "brand-pricing-defaults",
    "title": "Default rules for who covers fees and VAT",
    "outcome_summary": "Default rules for who covers fees and VAT helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen default rules for who covers fees and vat flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Default rules for who covers fees and VAT is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
    "source_path": "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "migration_path": "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "claim_refs": [
      "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
      "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
      "mingla-admin/src/pages/PricingPage.jsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-create",
    "title": "Create one-off, recurring or multi-date events",
    "outcome_summary": "Create one-off, recurring or multi-date events helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen create one-off, recurring or multi-date events flow. Check the cited evidence before describing its production status.",
    "limitations": "Up to 24 dates; recurring dates generated 14 days ahead. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Create one-off, recurring or multi-date events is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/event/create.tsx",
    "source_path": "mingla-business/app/event/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270702003313_issue_3313_recurring_event_occurrences.sql",
    "migration_path": "supabase/migrations/20270702003313_issue_3313_recurring_event_occurrences.sql",
    "claim_refs": [
      "mingla-business/app/event/create.tsx",
      "mingla-business/src/components/event/EventCreatorWizard.tsx",
      "mingla-business/src/store/draftEventStore.ts",
      "supabase/migrations/20270702003313_issue_3313_recurring_event_occurrences.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-cover-media",
    "title": "Event cover photo, GIF or video",
    "outcome_summary": "Event cover photo, GIF or video helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen event cover photo, gif or video flow. Check the cited evidence before describing its production status.",
    "limitations": "100 MB video limit.",
    "support_wording": "Event cover photo, GIF or video is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/ui/CoverPickerSheet.tsx",
    "source_path": "mingla-business/src/components/ui/CoverPickerSheet.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/ui/__tests__/CoverPickerSheet.freshSheetAfterTrimEditor.issue3280.test.tsx",
    "test_path": "mingla-business/src/components/ui/__tests__/CoverPickerSheet.freshSheetAfterTrimEditor.issue3280.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/ui/CoverPickerSheet.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-ticket-types",
    "title": "Ticket types: price, capacity, hidden, password, approval, sale window",
    "outcome_summary": "Ticket types: price, capacity, hidden, password, approval, sale window helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen ticket types: price, capacity, hidden, password, approval, sale window flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Ticket types: price, capacity, hidden, password, approval, sale window is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/event/CreatorStep5Tickets.tsx",
    "source_path": "mingla-business/src/components/event/CreatorStep5Tickets.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/event/CreatorStep5Tickets.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-fees-and-tax",
    "title": "Choose who covers the Mingla fee, service fee and VAT",
    "outcome_summary": "Choose who covers the Mingla fee, service fee and VAT helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen choose who covers the mingla fee, service fee and vat flow. Check the cited evidence before describing its production status.",
    "limitations": "VAT shows only with an active tax registration. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Choose who covers the Mingla fee, service fee and VAT is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
    "source_path": "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "migration_path": "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "claim_refs": [
      "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
      "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-visibility",
    "title": "Public or unlisted events",
    "outcome_summary": "Public or unlisted events helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen public or unlisted events flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Public or unlisted events is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/event/CreatorStep6Settings.tsx",
    "source_path": "mingla-business/src/components/event/CreatorStep6Settings.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/event/CreatorStep6Settings.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "events-private",
    "title": "Private, invite-only events",
    "outcome_summary": "Private, invite-only events is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Frozen on the server on purpose.",
    "support_wording": "Mingla does not currently offer private, invite-only events. Frozen on the server on purpose",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/services/privateEventAccessService.ts",
    "source_path": "mingla-business/src/services/privateEventAccessService.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270413001931_issue_1931_private_event_access.sql",
    "migration_path": "supabase/migrations/20270413001931_issue_1931_private_event_access.sql",
    "claim_refs": [
      "mingla-business/src/services/privateEventAccessService.ts",
      "supabase/migrations/20270413001931_issue_1931_private_event_access.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-named-buyers",
    "title": "Sell only to approved buyers",
    "outcome_summary": "Sell only to approved buyers helps Host complete this job through Host web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host web"
    ],
    "how_to": "Open Host web and follow the on-screen sell only to approved buyers flow. Check the cited evidence before describing its production status.",
    "limitations": "Web only. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Sell only to approved buyers is built for Host on Host web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx",
    "source_path": "mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270414002101_issue_2101_named_buyer_checkout_access.sql",
    "migration_path": "supabase/migrations/20270414002101_issue_2101_named_buyer_checkout_access.sql",
    "claim_refs": [
      "mingla-business/src/components/event/EventTicketCheckoutAccessCard.tsx",
      "supabase/migrations/20270414002101_issue_2101_named_buyer_checkout_access.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-edit-live",
    "title": "Edit a live event (buyers are warned)",
    "outcome_summary": "Edit a live event (buyers are warned) helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen edit a live event (buyers are warned) flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Edit a live event (buyers are warned) is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/event/EditPublishedScreen.tsx",
    "source_path": "mingla-business/src/components/event/EditPublishedScreen.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260820000001_schedule_change_buyer_protection_refund_all.sql",
    "migration_path": "supabase/migrations/20260820000001_schedule_change_buyer_protection_refund_all.sql",
    "claim_refs": [
      "mingla-business/src/components/event/EditPublishedScreen.tsx",
      "supabase/migrations/20260820000001_schedule_change_buyer_protection_refund_all.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "events-update-email",
    "title": "Email buyers automatically when a live event changes",
    "outcome_summary": "Email buyers automatically when a live event changes helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for email buyers automatically when a live event changes. Check the cited evidence before describing its production status.",
    "limitations": "Allowlist only in code. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Email buyers automatically when a live event changes is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20271014103827_issue_3827_live_edit_buyer_email.sql",
    "source_path": "supabase/migrations/20271014103827_issue_3827_live_edit_buyer_email.sql",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20271014103827_issue_3827_live_edit_buyer_email.sql",
    "migration_path": "supabase/migrations/20271014103827_issue_3827_live_edit_buyer_email.sql",
    "claim_refs": [
      "supabase/migrations/20271014103827_issue_3827_live_edit_buyer_email.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-cancel-refund-all",
    "title": "Cancel an event and refund every buyer",
    "outcome_summary": "Cancel an event and refund every buyer helps Host and Staff complete this job through Host apps · Admin.",
    "who_can_use": [
      "Host",
      "Staff"
    ],
    "surfaces": [
      "Host apps",
      "Admin"
    ],
    "how_to": "Open Host apps and follow the on-screen cancel an event and refund every buyer flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Cancel an event and refund every buyer is built for Host and Staff on Host apps · Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/event-cancel-refund-fanout/index.ts",
    "source_path": "supabase/functions/event-cancel-refund-fanout/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270721003645_issue_3645_cancel_refund_review.sql",
    "migration_path": "supabase/migrations/20270721003645_issue_3645_cancel_refund_review.sql",
    "claim_refs": [
      "supabase/functions/event-cancel-refund-fanout/index.ts",
      "supabase/migrations/20270721003645_issue_3645_cancel_refund_review.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-orders-refunds",
    "title": "See orders and give full or partial refunds",
    "outcome_summary": "See orders and give full or partial refunds helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen see orders and give full or partial refunds flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Host apps · web.",
    "support_wording": "See orders and give full or partial refunds is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/orders/RefundSheet.tsx",
    "source_path": "mingla-business/src/components/orders/RefundSheet.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/refunds/__tests__/issue_1221_source_refund_surfaces.test.tsx",
    "test_path": "mingla-business/src/components/refunds/__tests__/issue_1221_source_refund_surfaces.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/orders/RefundSheet.tsx",
      "supabase/functions/refund-order/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-guest-list",
    "title": "Guest list with search and CSV export",
    "outcome_summary": "Guest list with search and CSV export helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen guest list with search and csv export flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Guest list with search and CSV export is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/guest-roster-actions/index.ts",
    "source_path": "supabase/functions/guest-roster-actions/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql",
    "migration_path": "supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql",
    "claim_refs": [
      "supabase/functions/guest-roster-actions/index.ts",
      "supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-comp-guests",
    "title": "Add free (comp) guests",
    "outcome_summary": "Add free (comp) guests helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen add free (comp) guests flow. Check the cited evidence before describing its production status.",
    "limitations": "Saved on that device only (truth gap). No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Add free (comp) guests is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/store/doorSalesStore.ts",
    "source_path": "mingla-business/src/store/doorSalesStore.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/store/doorSalesStore.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-door-sales",
    "title": "Sell at the door",
    "outcome_summary": "Sell at the door helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen sell at the door flow. Check the cited evidence before describing its production status.",
    "limitations": "Saved on that device only (truth gap). No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Sell at the door is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/store/doorSalesStore.ts",
    "source_path": "mingla-business/src/store/doorSalesStore.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/store/doorSalesStore.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-reconciliation",
    "title": "Reconcile sales across online, door and comps",
    "outcome_summary": "Reconcile sales across online, door and comps helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen reconcile sales across online, door and comps flow. Check the cited evidence before describing its production status.",
    "limitations": "Finance role and above. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Reconcile sales across online, door and comps is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/store/doorSalesStore.ts",
    "source_path": "mingla-business/src/store/doorSalesStore.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql",
    "migration_path": "supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql",
    "claim_refs": [
      "mingla-business/src/store/doorSalesStore.ts",
      "supabase/functions/guest-roster-actions/index.ts",
      "supabase/migrations/20270319000873_issue_0873_guest_status_roster.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "events-check-in",
    "title": "Scan tickets at the door",
    "outcome_summary": "Scan tickets at the door helps Host and Scanner complete this job through Host iOS · Android.",
    "who_can_use": [
      "Host",
      "Scanner"
    ],
    "surfaces": [
      "Host iOS",
      "Android"
    ],
    "how_to": "Open Host iOS and follow the on-screen scan tickets at the door flow. Check the cited evidence before describing its production status.",
    "limitations": "Not on web. This is limited to Host iOS · Android.",
    "support_wording": "Scan tickets at the door is built for Host and Scanner on Host iOS · Android. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/event/[id]/scanner/index.tsx",
    "source_path": "mingla-business/app/event/[id]/scanner/index.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/services/__tests__/scanTicketService.test.ts",
    "test_path": "mingla-business/src/services/__tests__/scanTicketService.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/event/[id]/scanner/index.tsx",
      "supabase/functions/scan-ticket/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-scanner-team",
    "title": "Invite scanners for one event or the whole brand",
    "outcome_summary": "Invite scanners for one event or the whole brand helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen invite scanners for one event or the whole brand flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Invite scanners for one event or the whole brand is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/[id]/scanners.tsx",
    "source_path": "mingla-business/app/brand/[id]/scanners.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/[id]/scanners.tsx",
      "supabase/functions/invite-scanner/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": true,
    "capability_key": "events-group-chat",
    "title": "Event group chat for guests",
    "outcome_summary": "Event group chat for guests helps Host and Explorer complete this job through Host apps · Explorer apps.",
    "who_can_use": [
      "Host",
      "Explorer"
    ],
    "surfaces": [
      "Host apps",
      "Explorer apps"
    ],
    "how_to": "Open Host apps and follow the on-screen event group chat for guests flow. Check the cited evidence before describing its production status.",
    "limitations": "This is limited to Host apps · Explorer apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Event group chat for guests is built for Host and Explorer on Host apps · Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/event/[id]/group-chat.tsx",
    "source_path": "mingla-business/app/event/[id]/group-chat.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql",
    "migration_path": "supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql",
    "claim_refs": [
      "mingla-business/app/event/[id]/group-chat.tsx",
      "app-mobile/src/components/chat/TripCountdownBanner.tsx",
      "supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "events-ticket-delivery",
    "title": "Ticket confirmations by email and SMS, plus a ticket PDF",
    "outcome_summary": "Ticket confirmations by email and SMS, plus a ticket PDF helps Buyer complete this job through Email · SMS · web.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Email",
      "SMS",
      "web"
    ],
    "how_to": "Open Email and follow the on-screen ticket confirmations by email and sms, plus a ticket pdf flow. Check the cited evidence before describing its production status.",
    "limitations": "Nigerian SMS is held from 20:00 to 08:00; SMS has market switches. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Ticket confirmations by email and SMS, plus a ticket PDF is built for Buyer, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/ticket-confirmation-dispatch/index.ts",
    "source_path": "supabase/functions/ticket-confirmation-dispatch/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "supabase/functions/ticket-confirmation-dispatch/index.ts",
      "supabase/functions/_shared/adapters/smsAdapter.ts",
      "supabase/functions/termii-delivery-status/index.ts",
      "supabase/functions/twilio-inbound-sms/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-reminders",
    "title": "Event reminders 24 hours and 2 hours before",
    "outcome_summary": "Event reminders 24 hours and 2 hours before helps Buyer complete this job through Push · email.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Push",
      "email"
    ],
    "how_to": "Open Push and follow the on-screen event reminders 24 hours and 2 hours before flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Event reminders 24 hours and 2 hours before is built for Buyer on Push · email. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/notify-reminders/index.ts",
    "source_path": "supabase/functions/notify-reminders/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "supabase/functions/notify-reminders/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-tier-waitlist",
    "title": "Join the waitlist for a sold-out ticket type",
    "outcome_summary": "Join the waitlist for a sold-out ticket type helps Buyer complete this job through Buyer web.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "Open Buyer web and follow the on-screen join the waitlist for a sold-out ticket type flow. Check the cited evidence before describing its production status.",
    "limitations": "Hosts turn this on per ticket type. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Join the waitlist for a sold-out ticket type is built for Buyer on Buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx",
    "source_path": "mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "events-waiting-room",
    "title": "Waiting room for big on-sales",
    "outcome_summary": "Waiting room for big on-sales is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Checkout must opt in, and there's no host setting yet.",
    "support_wording": "Mingla does not currently offer waiting room for big on-sales. Checkout must opt in, and there's no host setting yet",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/checkout/[eventId]/queue.tsx",
    "source_path": "mingla-business/app/checkout/[eventId]/queue.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql",
    "migration_path": "supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql",
    "claim_refs": [
      "mingla-business/app/checkout/[eventId]/queue.tsx",
      "supabase/functions/_shared/ticketQueueV1.ts",
      "supabase/migrations/20271027002947_issue_2947_queue_admission_foundation.sql"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "events-turnout-forecast",
    "title": "Turnout forecast",
    "outcome_summary": "Turnout forecast helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen turnout forecast flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Turnout forecast is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/intel/TurnoutForecastCard.tsx",
    "source_path": "mingla-business/src/components/intel/TurnoutForecastCard.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/intel/TurnoutForecastCard.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "events-invite-people",
    "title": "Invite people while creating an event",
    "outcome_summary": "Invite people while creating an event helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for invite people while creating an event. Check the cited evidence before describing its production status.",
    "limitations": "Off in code by default. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Invite people while creating an event is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/invites/InvitePeopleStep.tsx",
    "source_path": "mingla-business/src/components/invites/InvitePeopleStep.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/invites/InvitePeopleStep.tsx",
      "supabase/functions/offering-invite-dispatch/index.ts"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "events-discount-codes",
    "title": "Discount codes",
    "outcome_summary": "Discount codes is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not on main; another chat is building it.",
    "support_wording": "Mingla does not currently offer discount codes. Not on main; another chat is building it",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/README.md",
    "source_path": "README.md",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "README.md"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "removed",
    "app_only": false,
    "capability_key": "events-ticket-transfers",
    "title": "Transfer a ticket to someone else",
    "outcome_summary": "Transfer a ticket to someone else was removed, so customers get a clear current answer instead of an obsolete path.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Do not direct customers to an old flow. Explain that the capability was removed and offer the current support path.",
    "limitations": "Removed. No current customer flow remains.",
    "support_wording": "Mingla no longer offers transfer a ticket to someone else. Removed",
    "claimed_status": "retired",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/event/CreatorStep6Settings.tsx",
    "source_path": "mingla-business/src/components/event/CreatorStep6Settings.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/event/CreatorStep6Settings.tsx"
    ]
  },
  {
    "area": "Events and tickets",
    "start_as": "removed",
    "app_only": false,
    "capability_key": "events-wallet-passes",
    "title": "Apple or Google Wallet passes",
    "outcome_summary": "Apple or Google Wallet passes was removed, so customers get a clear current answer instead of an obsolete path.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Do not direct customers to an old flow. Explain that the capability was removed and offer the current support path.",
    "limitations": "Removed. No current customer flow remains.",
    "support_wording": "Mingla no longer offers apple or google wallet passes. Removed",
    "claimed_status": "retired",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/activity/CalendarTab.tsx",
    "source_path": "app-mobile/src/components/activity/CalendarTab.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/activity/CalendarTab.tsx"
    ]
  },
  {
    "area": "RSVP events",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "rsvp-create",
    "title": "Free RSVP events",
    "outcome_summary": "Free RSVP events helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen free rsvp events flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Free RSVP events is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/rsvp/create.tsx",
    "source_path": "mingla-business/app/rsvp/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/rsvp/create.tsx"
    ]
  },
  {
    "area": "RSVP events",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "rsvp-approvals",
    "title": "Approve, decline or remove RSVPs",
    "outcome_summary": "Approve, decline or remove RSVPs helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen approve, decline or remove rsvps flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Approve, decline or remove RSVPs is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/rsvp/create.tsx",
    "source_path": "mingla-business/app/rsvp/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/rsvp/create.tsx"
    ]
  },
  {
    "area": "RSVP events",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "rsvp-passes",
    "title": "RSVP passes, pass recovery and door scanning",
    "outcome_summary": "RSVP passes, pass recovery and door scanning helps Host and Buyer complete this job through Host apps · buyer web.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host apps",
      "buyer web"
    ],
    "how_to": "Open Host apps and follow the on-screen rsvp passes, pass recovery and door scanning flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "RSVP passes, pass recovery and door scanning is built for Host and Buyer on Host apps · buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/rsvp/pass.tsx",
    "source_path": "mingla-business/app/rsvp/pass.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/rsvp/pass.tsx",
      "supabase/functions/rsvp-pass-fetch/index.ts",
      "mingla-business/app/rsvp/[id]/scanner/index.tsx",
      "supabase/functions/scan-rsvp/index.ts"
    ]
  },
  {
    "area": "RSVP events",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "rsvp-chip-in",
    "title": "Optional chip-in payments on RSVPs",
    "outcome_summary": "Optional chip-in payments on RSVPs helps Host and Buyer complete this job through All.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "All"
    ],
    "how_to": "Open All and follow the on-screen optional chip-in payments on rsvps flow. Check the cited evidence before describing its production status.",
    "limitations": "Needs a connected payout bank; on per event. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Optional chip-in payments on RSVPs is built for Host and Buyer on All. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/hooks/useRsvpContribution.ts",
    "source_path": "mingla-business/src/hooks/useRsvpContribution.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/hooks/useRsvpContribution.ts",
      "supabase/functions/rsvp-contribution-create/index.ts"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "experiences-create",
    "title": "Create a multi-stop experience sold as one ticket",
    "outcome_summary": "Create a multi-stop experience sold as one ticket helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen create a multi-stop experience sold as one ticket flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Create a multi-stop experience sold as one ticket is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/experience/create.tsx",
    "source_path": "mingla-business/app/experience/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/experience/create.tsx",
      "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "experiences-snap",
    "title": "Snap a menu or list and get a draft experience",
    "outcome_summary": "Snap a menu or list and get a draft experience helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen snap a menu or list and get a draft experience flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Snap a menu or list and get a draft experience is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/experience/snap.tsx",
    "source_path": "mingla-business/app/experience/snap.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/experience/snap.tsx",
      "supabase/functions/parse-restaurant-menu/index.ts"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "trips-create",
    "title": "Create trips and manage travellers",
    "outcome_summary": "Create trips and manage travellers helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen create trips and manage travellers flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Create trips and manage travellers is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/trip/create.tsx",
    "source_path": "mingla-business/app/trip/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/trip/create.tsx",
      "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "trips-intake-forms",
    "title": "Traveller intake forms",
    "outcome_summary": "Traveller intake forms helps Host and Buyer complete this job through Host apps · buyer web.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host apps",
      "buyer web"
    ],
    "how_to": "Open Host apps and follow the on-screen traveller intake forms flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Traveller intake forms is built for Host and Buyer on Host apps · buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/trip/create.tsx",
    "source_path": "mingla-business/app/trip/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/trip/create.tsx",
      "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
      "mingla-business/app/checkout-trip/[tripEventId]/__tests__/issue_2190_paid_checkout_provider_handoff.test.tsx"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "trips-installments",
    "title": "Let travellers pay in instalments",
    "outcome_summary": "Let travellers pay in instalments helps Host and Buyer complete this job through Host apps · buyer web.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host apps",
      "buyer web"
    ],
    "how_to": "Open Host apps and follow the on-screen let travellers pay in instalments flow. Check the cited evidence before describing its production status.",
    "limitations": "Trips only. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Let travellers pay in instalments is built for Host and Buyer on Host apps · buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/trip/[id]/money/index.tsx",
    "source_path": "mingla-business/app/trip/[id]/money/index.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/trip/[id]/money/index.tsx",
      "supabase/functions/process-scheduled-installments/index.ts"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "offerings-refund-policy",
    "title": "Set a refund policy and booking deadline",
    "outcome_summary": "Set a refund policy and booking deadline helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen set a refund policy and booking deadline flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Set a refund policy and booking deadline is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/booking/[orderId]/cancel.tsx",
    "source_path": "mingla-business/app/booking/[orderId]/cancel.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270703003284_issue_3284_offering_refund_terms.sql",
    "migration_path": "supabase/migrations/20270703003284_issue_3284_offering_refund_terms.sql",
    "claim_refs": [
      "mingla-business/app/booking/[orderId]/cancel.tsx",
      "supabase/functions/cancel-trip-booking/index.ts",
      "packages/offering-rendering/index.ts",
      "supabase/migrations/20270703003284_issue_3284_offering_refund_terms.sql"
    ]
  },
  {
    "area": "Experiences and trips",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "trips-cancel-booking",
    "title": "Travellers cancel from the email link and get their tier refund",
    "outcome_summary": "Travellers cancel from the email link and get their tier refund helps Buyer complete this job through Buyer web.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "Open Buyer web and follow the on-screen travellers cancel from the email link and get their tier refund flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Travellers cancel from the email link and get their tier refund is built for Buyer on Buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/booking/[orderId]/cancel.tsx",
    "source_path": "mingla-business/app/booking/[orderId]/cancel.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/booking/[orderId]/cancel.tsx",
      "supabase/functions/cancel-trip-booking/index.ts"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "venues-claim-or-add",
    "title": "Claim your venue or add a new one",
    "outcome_summary": "Claim your venue or add a new one helps Host and Staff complete this job through Host apps · Admin.",
    "who_can_use": [
      "Host",
      "Staff"
    ],
    "surfaces": [
      "Host apps",
      "Admin"
    ],
    "how_to": "Open Host apps and follow the on-screen claim your venue or add a new one flow. Check the cited evidence before describing its production status.",
    "limitations": "Staff review every claim. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Claim your venue or add a new one is built for Host and Staff on Host apps · Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/venue/create.tsx",
    "source_path": "mingla-business/app/venue/create.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/venue/create.tsx",
      "supabase/functions/claim-search-pool/index.ts"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "venues-reservations",
    "title": "Table reservations, with optional deposits",
    "outcome_summary": "Table reservations, with optional deposits helps Host and Buyer complete this job through Host apps · buyer web · Explorer.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host apps",
      "buyer web",
      "Explorer"
    ],
    "how_to": "Open Host apps and follow the on-screen table reservations, with optional deposits flow. Check the cited evidence before describing its production status.",
    "limitations": "Turned on per venue; deposits need payouts set up. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Table reservations, with optional deposits is built for Host and Buyer on Host apps · buyer web · Explorer. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/venue/VenueReservationsModule.tsx",
    "source_path": "mingla-business/src/components/venue/VenueReservationsModule.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/venue/VenueReservationsModule.tsx",
      "mingla-business/app/reserve/[brandId]/confirm.tsx",
      "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "check_flag",
    "app_only": true,
    "capability_key": "venues-waitlist-text",
    "title": "Text guests when their table is ready",
    "outcome_summary": "Text guests when their table is ready helps Host complete this job through Host apps.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps"
    ],
    "how_to": "Open Host apps and follow the on-screen text guests when their table is ready flow. Check the cited evidence before describing its production status.",
    "limitations": "SMS market switches. A live check must read the production flag or setting before promotion. This is limited to Host apps. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Text guests when their table is ready is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag",
      "app_release"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/send-venue-sms/index.ts",
    "source_path": "supabase/functions/send-venue-sms/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "supabase/functions/send-venue-sms/index.ts"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "venues-menu",
    "title": "Build your menu",
    "outcome_summary": "Build your menu helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen build your menu flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Build your menu is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/venue/VenueMenuModule.tsx",
    "source_path": "mingla-business/src/components/venue/VenueMenuModule.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/venue/VenueMenuModule.tsx"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "venues-qr-ordering",
    "title": "Guests order and pay from a table QR code",
    "outcome_summary": "Guests order and pay from a table QR code helps Host and Buyer complete this job through Host apps · buyer web.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host apps",
      "buyer web"
    ],
    "how_to": "Open Host apps and follow the on-screen guests order and pay from a table qr code flow. Check the cited evidence before describing its production status.",
    "limitations": "Verified venues only; off by default. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Guests order and pay from a table QR code is built for Host and Buyer on Host apps · buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/venue/VenueOrdersModule.tsx",
    "source_path": "mingla-business/src/components/venue/VenueOrdersModule.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/venue/VenueOrdersModule.tsx"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "venues-insights",
    "title": "Venue insights: site check, competitor watch, pricing",
    "outcome_summary": "Venue insights: site check, competitor watch, pricing helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen venue insights: site check, competitor watch, pricing flow. Check the cited evidence before describing its production status.",
    "limitations": "Competitor watch scheduling is off by default. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Venue insights: site check, competitor watch, pricing is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/venue/insights/CompetitorAddSheet.tsx",
    "source_path": "mingla-business/src/components/venue/insights/CompetitorAddSheet.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/venue/insights/CompetitorAddSheet.tsx",
      "supabase/functions/competitor-intel-worker/index.ts"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "venues-go-live-readiness",
    "title": "Check readiness to appear in Explorer",
    "outcome_summary": "Check readiness to appear in Explorer helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen check readiness to appear in explorer flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Check readiness to appear in Explorer is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/venue/deck-readiness.tsx",
    "source_path": "mingla-business/app/venue/deck-readiness.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/venue/deck-readiness.tsx"
    ]
  },
  {
    "area": "Venues and stays",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "stays-hosting",
    "title": "Host stays: rooms, bookings and payments",
    "outcome_summary": "Host stays: rooms, bookings and payments helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for host stays: rooms, bookings and payments. Check the cited evidence before describing its production status.",
    "limitations": "Seven stay flags are off in code by default. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Host stays: rooms, bookings and payments is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/stay/StaySuiteShell.tsx",
    "source_path": "mingla-business/src/components/stay/StaySuiteShell.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/stay/StaySuiteShell.tsx",
      "supabase/functions/manage-stay-inventory/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "marketing-campaigns",
    "title": "Email and SMS campaigns to your people",
    "outcome_summary": "Email and SMS campaigns to your people helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen email and sms campaigns to your people flow. Check the cited evidence before describing its production status.",
    "limitations": "Live sending is off in code by default. A live check must read the production flag or setting before promotion.",
    "support_wording": "Email and SMS campaigns to your people is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "source_path": "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "test_path": "mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
      "supabase/functions/marketing-send/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-templates",
    "title": "Email templates",
    "outcome_summary": "Email templates helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen email templates flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Host apps · web.",
    "support_wording": "Email templates is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "source_path": "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "test_path": "mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
      "supabase/functions/marketing-send/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-buyer-blasts",
    "title": "Message an event's buyers",
    "outcome_summary": "Message an event's buyers helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen message an event's buyers flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Host apps · web.",
    "support_wording": "Message an event's buyers is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "source_path": "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "test_path": "mingla-business/app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
      "supabase/functions/marketing-send/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-people",
    "title": "Your people: profiles, groups and duplicate merging",
    "outcome_summary": "Your people: profiles, groups and duplicate merging helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen your people: profiles, groups and duplicate merging flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Your people: profiles, groups and duplicate merging is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/people/PeoplePage.tsx",
    "source_path": "mingla-business/src/components/people/PeoplePage.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/people/PeoplePage.tsx",
      "supabase/functions/brand-person-ingest-worker/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "marketing-contact-import",
    "title": "Import contacts from CSV",
    "outcome_summary": "Import contacts from CSV helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for import contacts from csv. Check the cited evidence before describing its production status.",
    "limitations": "Off in code by default. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Import contacts from CSV is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/people/import.tsx",
    "source_path": "mingla-business/app/(tabs)/people/import.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/people/import.tsx",
      "supabase/functions/contact-import/index.ts"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-host-ads",
    "title": "Run Meta and TikTok ads from Mingla Host",
    "outcome_summary": "Run Meta and TikTok ads from Mingla Host helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen run meta and tiktok ads from mingla host flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Run Meta and TikTok ads from Mingla Host is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/marketing/ads/[id].tsx",
    "source_path": "mingla-business/app/(tabs)/marketing/ads/[id].tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/marketing/ads/[id].tsx",
      "mingla-admin/src/pages/CampaignBuilderPage.jsx"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-ad-credit",
    "title": "Ad credit wallet and top-ups",
    "outcome_summary": "Ad credit wallet and top-ups helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen ad credit wallet and top-ups flow. Check the cited evidence before describing its production status.",
    "limitations": "Naira top-ups through Paystack. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Ad credit wallet and top-ups is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/services/adCreditService.ts",
    "source_path": "mingla-business/src/services/adCreditService.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270821003697_issue_3697_wave6_ads_credit.sql",
    "migration_path": "supabase/migrations/20270821003697_issue_3697_wave6_ads_credit.sql",
    "claim_refs": [
      "mingla-business/src/services/adCreditService.ts",
      "supabase/functions/ad-credit/index.ts",
      "supabase/migrations/20270821003697_issue_3697_wave6_ads_credit.sql"
    ]
  },
  {
    "area": "Marketing and growth",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "marketing-analytics",
    "title": "Brand analytics and listing insights",
    "outcome_summary": "Brand analytics and listing insights helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen brand analytics and listing insights flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Brand analytics and listing insights is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/analytics.tsx",
    "source_path": "mingla-business/app/(tabs)/analytics.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/analytics.tsx"
    ]
  },
  {
    "area": "Ari and websites",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "ari-host-assistant",
    "title": "Ari, the Host assistant that can draft and do tasks after you confirm",
    "outcome_summary": "Ari, the Host assistant that can draft and do tasks after you confirm helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen ari, the host assistant that can draft and do tasks after you confirm flow. Check the cited evidence before describing its production status.",
    "limitations": "Finance role and above.",
    "support_wording": "Ari, the Host assistant that can draft and do tasks after you confirm is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/(tabs)/ari.tsx",
    "source_path": "mingla-business/app/(tabs)/ari.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "test_path": "mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/(tabs)/ari.tsx",
      "supabase/functions/agent-chat/index.ts",
      "mingla-business/src/components/ari/ToolProposalCard.tsx",
      "supabase/functions/agent-confirm-action/index.ts"
    ]
  },
  {
    "area": "Ari and websites",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "sites-brand-website",
    "title": "Mingla Sites: a brand website with Ari editing",
    "outcome_summary": "Mingla Sites: a brand website with Ari editing is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Private pilot with one brand.",
    "support_wording": "Mingla does not currently offer mingla sites: a brand website with ari editing. Private pilot with one brand",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-sites/src/components/RestaurantV1.tsx",
    "source_path": "mingla-sites/src/components/RestaurantV1.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270613002893_issue_2893_sites_readiness_activation.sql",
    "migration_path": "supabase/migrations/20270613002893_issue_2893_sites_readiness_activation.sql",
    "claim_refs": [
      "mingla-sites/src/components/RestaurantV1.tsx",
      "mingla-sites/src/lib/config.ts",
      "supabase/migrations/20270613002893_issue_2893_sites_readiness_activation.sql",
      "mingla-business/app/brand/[id]/website.tsx",
      "mingla-site-cms/src/endpoints/sitesEndpoints.ts",
      "supabase/functions/brand-site-control/index.ts",
      "mingla-business/app/brand/[id]/website/ari.tsx"
    ]
  },
  {
    "area": "Ari and websites",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "ari-explorer-assistant",
    "title": "An AI assistant inside Explorer",
    "outcome_summary": "An AI assistant inside Explorer is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built.",
    "support_wording": "Mingla does not currently offer an ai assistant inside explorer. Not built",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/PRODUCT_AND_STRATEGY.md",
    "source_path": "PRODUCT_AND_STRATEGY.md",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "PRODUCT_AND_STRATEGY.md"
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
