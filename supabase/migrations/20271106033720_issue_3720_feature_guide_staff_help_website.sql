-- Issue #3720 Wave 8 — Feature Guide staff help website catalog.
-- Static source and regression evidence only: claimed-Live entries intentionally
-- remain Needs review until a person records current production proof.
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-STATIC-SEED-STAFF-HELP-WEBSITE","rule":"Catalog seed rows contain only pinned static evidence and cannot become Live without a later human-reviewed live check and release record."}

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
    "area": "Help and community",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "help-support",
    "title": "Contact Support inside Mingla Host",
    "outcome_summary": "Contact Support inside Mingla Host helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen contact support inside mingla host flow. Check the cited evidence before describing its production status.",
    "limitations": "Replies come from a named person at Mingla. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Contact Support inside Mingla Host is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/account/support.tsx",
    "source_path": "mingla-business/app/account/support.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/account/support.tsx"
    ]
  },
  {
    "area": "Help and community",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "help-announcements-roadmap",
    "title": "Announcements and the public roadmap",
    "outcome_summary": "Announcements and the public roadmap helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen announcements and the public roadmap flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Announcements and the public roadmap is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/components/community/AnnouncementsPanel.jsx",
    "source_path": "mingla-admin/src/components/community/AnnouncementsPanel.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/components/community/AnnouncementsPanel.jsx"
    ]
  },
  {
    "area": "Help and community",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "help-ideas-and-questions",
    "title": "Suggest ideas, vote, ask and answer questions",
    "outcome_summary": "Suggest ideas, vote, ask and answer questions helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen suggest ideas, vote, ask and answer questions flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Suggest ideas, vote, ask and answer questions is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/components/community/AnnouncementsPanel.jsx",
    "source_path": "mingla-admin/src/components/community/AnnouncementsPanel.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/components/community/AnnouncementsPanel.jsx"
    ]
  },
  {
    "area": "Help and community",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "help-video-guides",
    "title": "20 video guides in the Help Centre and in the app",
    "outcome_summary": "20 video guides in the Help Centre and in the app helps Host complete this job through Website · Host apps.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Website",
      "Host apps"
    ],
    "how_to": "Open Website and follow the on-screen 20 video guides in the help centre and in the app flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "20 video guides in the Help Centre and in the app is built for Host on Website · Host apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/content/help/registry.ts",
    "source_path": "mingla-marketing/content/help/registry.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/content/help/registry.ts",
      "packages/help-content/index.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-download",
    "title": "Download links that pick the right store",
    "outcome_summary": "Download links that pick the right store helps Everyone complete this job through Website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen download links that pick the right store flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Download links that pick the right store is built for Everyone on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/(explorer)/page.tsx",
    "source_path": "mingla-marketing/app/(explorer)/page.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/(explorer)/page.tsx",
      "mingla-marketing/lib/links-config.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-city-guides",
    "title": "City guides for 10 cities",
    "outcome_summary": "City guides for 10 cities helps Everyone complete this job through Website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen city guides for 10 cities flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "City guides for 10 cities is built for Everyone on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/content/cities/registry.ts",
    "source_path": "mingla-marketing/content/cities/registry.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/content/cities/registry.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-free-tools",
    "title": "Free tools: website grader, turnout predictor, trip quote, pricing audit",
    "outcome_summary": "Free tools: website grader, turnout predictor, trip quote, pricing audit helps Prospects complete this job through Website.",
    "who_can_use": [
      "Prospects"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen free tools: website grader, turnout predictor, trip quote, pricing audit flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Website.",
    "support_wording": "Free tools: website grader, turnout predictor, trip quote, pricing audit is built for Prospects on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/tools/events/EventPredictorExperience.tsx",
    "source_path": "mingla-marketing/app/tools/events/EventPredictorExperience.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/growth-tools-events/__tests__/turnout_advice_word_boundary.test.ts",
    "test_path": "supabase/functions/growth-tools-events/__tests__/turnout_advice_word_boundary.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/tools/events/EventPredictorExperience.tsx"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-book-a-call",
    "title": "Book a call with Mingla",
    "outcome_summary": "Book a call with Mingla helps Prospects complete this job through Website.",
    "who_can_use": [
      "Prospects"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen book a call with mingla flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Book a call with Mingla is built for Prospects on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/schedule/ScheduleClient.tsx",
    "source_path": "mingla-marketing/app/schedule/ScheduleClient.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/schedule/ScheduleClient.tsx",
      "supabase/functions/growth-tools-book/index.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-careers",
    "title": "Careers site and applications",
    "outcome_summary": "Careers site and applications helps Everyone complete this job through Website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen careers site and applications flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Careers site and applications is built for Everyone on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/careers/_components/apply-form.tsx",
    "source_path": "mingla-marketing/app/careers/_components/apply-form.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/careers/_components/apply-form.tsx",
      "supabase/functions/careers-apply/index.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-legal",
    "title": "Terms, privacy, organiser terms and SMS terms",
    "outcome_summary": "Terms, privacy, organiser terms and SMS terms helps Everyone complete this job through Website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen terms, privacy, organiser terms and sms terms flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Terms, privacy, organiser terms and SMS terms is built for Everyone on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/terms-of-service/page.tsx",
    "source_path": "mingla-marketing/app/terms-of-service/page.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/terms-of-service/page.tsx"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "web-unsubscribe",
    "title": "Unsubscribe from emails",
    "outcome_summary": "Unsubscribe from emails helps Everyone complete this job through Website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Website"
    ],
    "how_to": "Open Website and follow the on-screen unsubscribe from emails flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Unsubscribe from emails is built for Everyone on Website. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/app/unsubscribe/UnsubscribeForm.tsx",
    "source_path": "mingla-marketing/app/unsubscribe/UnsubscribeForm.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/app/unsubscribe/UnsubscribeForm.tsx",
      "supabase/functions/self-serve-unsubscribe/index.ts",
      "supabase/functions/marketing-unsubscribe/index.ts"
    ]
  },
  {
    "area": "Mingla website",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "web-waitlist",
    "title": "Waitlist or beta sign-up form",
    "outcome_summary": "Waitlist or beta sign-up form is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Prospects"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built on the site.",
    "support_wording": "Mingla does not currently offer waitlist or beta sign-up form. Not built on the site",
    "claimed_status": "planned",
    "required_evidence_kinds": [
      "source"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-marketing/components/ui/waitlist-hero.tsx",
    "source_path": "mingla-marketing/components/ui/waitlist-hero.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-marketing/components/ui/waitlist-hero.tsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-community-support",
    "title": "Community and Support console",
    "outcome_summary": "Community and Support console helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen community and support console flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Community and Support console is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/components/community/ModerationPanel.jsx",
    "source_path": "mingla-admin/src/components/community/ModerationPanel.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/components/community/ModerationPanel.jsx",
      "mingla-admin/src/pages/SupportDeskPage.jsx",
      "mingla-business/app/support/inbox.tsx",
      "supabase/functions/support-claim/index.ts",
      "mingla-admin/src/components/community/AnnouncementsPanel.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-support-desk",
    "title": "Support desk with internal notes and next-update dates",
    "outcome_summary": "Support desk with internal notes and next-update dates helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen support desk with internal notes and next-update dates flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Support desk with internal notes and next-update dates is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/SupportDeskPage.jsx",
    "source_path": "mingla-admin/src/pages/SupportDeskPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/SupportDeskPage.jsx",
      "mingla-business/app/support/inbox.tsx",
      "supabase/functions/support-claim/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-feature-guide",
    "title": "Feature Guide",
    "outcome_summary": "Feature Guide helps Staff complete this job through Admin · agents.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin",
      "agents"
    ],
    "how_to": "Open Admin and follow the on-screen feature guide flow. Check the cited evidence before describing its production status.",
    "limitations": "Admin and Support only. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Feature Guide is built for Staff on Admin · agents. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/components/community/FeatureGuidePanel.jsx",
    "source_path": "mingla-admin/src/components/community/FeatureGuidePanel.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/components/community/FeatureGuidePanel.jsx",
      "mingla-admin/src/services/featureGuideService.js"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-email",
    "title": "Email campaigns to hosts",
    "outcome_summary": "Email campaigns to hosts helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen email campaigns to hosts flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Email campaigns to hosts is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/EmailPage.jsx",
    "source_path": "mingla-admin/src/pages/EmailPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/EmailPage.jsx",
      "supabase/functions/admin-send-email/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-crm",
    "title": "Host and creator pipelines",
    "outcome_summary": "Host and creator pipelines helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen host and creator pipelines flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Host and creator pipelines is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/PipelinePage.jsx",
    "source_path": "mingla-admin/src/pages/PipelinePage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/PipelinePage.jsx",
      "mingla-admin/src/services/crmService.js"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-drafts",
    "title": "Drafts to send",
    "outcome_summary": "Drafts to send helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen drafts to send flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Drafts to send is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/DraftsPage.jsx",
    "source_path": "mingla-admin/src/pages/DraftsPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/DraftsPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-my-agent",
    "title": "My agent: connect your own Claude or Codex",
    "outcome_summary": "My agent: connect your own Claude or Codex helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen my agent: connect your own claude or codex flow. Check the cited evidence before describing its production status.",
    "limitations": "One personal key per person; role-scoped.",
    "support_wording": "My agent: connect your own Claude or Codex is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/AgentPage.jsx",
    "source_path": "mingla-admin/src/pages/AgentPage.jsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/__tests__/agent_connector_issue3802.tester.adversarial.test.js",
    "test_path": "mingla-admin/src/__tests__/agent_connector_issue3802.tester.adversarial.test.js",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/AgentPage.jsx",
      "supabase/functions/team-agent/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-team-roles",
    "title": "Invite teammates and set roles",
    "outcome_summary": "Invite teammates and set roles helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen invite teammates and set roles flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Invite teammates and set roles is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/AdminPage.jsx",
    "source_path": "mingla-admin/src/pages/AdminPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/AdminPage.jsx",
      "mingla-admin/src/lib/access.js",
      "supabase/functions/admin-team-invite/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-people-brands",
    "title": "Manage people and brands, including pausing payouts",
    "outcome_summary": "Manage people and brands, including pausing payouts helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen manage people and brands, including pausing payouts flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Manage people and brands, including pausing payouts is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/UserManagementPage.jsx",
    "source_path": "mingla-admin/src/pages/UserManagementPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270728003645_issue_3645_admin_payout_pause_and_debt.sql",
    "migration_path": "supabase/migrations/20270728003645_issue_3645_admin_payout_pause_and_debt.sql",
    "claim_refs": [
      "mingla-admin/src/pages/UserManagementPage.jsx",
      "mingla-admin/src/pages/BrandsConsolePage.jsx",
      "supabase/migrations/20270728003645_issue_3645_admin_payout_pause_and_debt.sql"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-venue-claims",
    "title": "Review venue claims and changes",
    "outcome_summary": "Review venue claims and changes helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen review venue claims and changes flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Review venue claims and changes is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/VenuesConsolePage.jsx",
    "source_path": "mingla-admin/src/pages/VenuesConsolePage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/VenuesConsolePage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-offerings",
    "title": "Manage live offerings",
    "outcome_summary": "Manage live offerings helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen manage live offerings flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Manage live offerings is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/OfferingsConsolePage.jsx",
    "source_path": "mingla-admin/src/pages/OfferingsConsolePage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/OfferingsConsolePage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-orders-money",
    "title": "Orders, refunds and the money ledger",
    "outcome_summary": "Orders, refunds and the money ledger helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen orders, refunds and the money ledger flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Orders, refunds and the money ledger is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/BusinessOrdersPage.jsx",
    "source_path": "mingla-admin/src/pages/BusinessOrdersPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/BusinessOrdersPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-stripe-tools",
    "title": "Stripe Connect status and onboarding links",
    "outcome_summary": "Stripe Connect status and onboarding links helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen stripe connect status and onboarding links flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Admin.",
    "support_wording": "Stripe Connect status and onboarding links is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/BusinessOrdersPage.jsx",
    "source_path": "mingla-admin/src/pages/BusinessOrdersPage.jsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts",
    "test_path": "mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/BusinessOrdersPage.jsx",
      "mingla-business/app/connect-onboarding.web.tsx",
      "supabase/functions/brand-stripe-onboard/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-subscriptions",
    "title": "Subscription overrides",
    "outcome_summary": "Subscription overrides helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen subscription overrides flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Subscription overrides is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/SubscriptionManagementPage.jsx",
    "source_path": "mingla-admin/src/pages/SubscriptionManagementPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/SubscriptionManagementPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-take-rate",
    "title": "Mingla fee settings",
    "outcome_summary": "Mingla fee settings helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen mingla fee settings flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Mingla fee settings is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/PricingPage.jsx",
    "source_path": "mingla-admin/src/pages/PricingPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/PricingPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-explorer-users",
    "title": "Manage Explorer users",
    "outcome_summary": "Manage Explorer users helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen manage explorer users flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Manage Explorer users is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/UserManagementPage.jsx",
    "source_path": "mingla-admin/src/pages/UserManagementPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/UserManagementPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-places-cities",
    "title": "Place pool, launch cities and signals",
    "outcome_summary": "Place pool, launch cities and signals helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen place pool, launch cities and signals flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Place pool, launch cities and signals is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/PlacePoolManagementPage.jsx",
    "source_path": "mingla-admin/src/pages/PlacePoolManagementPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/PlacePoolManagementPage.jsx",
      "supabase/functions/admin-seed-places/index.ts",
      "mingla-admin/src/pages/LaunchCitiesPage.jsx",
      "mingla-admin/src/pages/SignalLibraryPage.jsx",
      "supabase/functions/run-bouncer/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "staff-ads",
    "title": "Ads console and campaigns",
    "outcome_summary": "Ads console and campaigns helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen ads console and campaigns flow. Check the cited evidence before describing its production status.",
    "limitations": "Some builder parts are off. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Ads console and campaigns is built for Staff, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/CampaignBuilderPage.jsx",
    "source_path": "mingla-admin/src/pages/CampaignBuilderPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/CampaignBuilderPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-sites-ops",
    "title": "Brand Sites operations",
    "outcome_summary": "Brand Sites operations helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen brand sites operations flow. Check the cited evidence before describing its production status.",
    "limitations": "Pilot only. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Brand Sites operations is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/BrandSitesPage.jsx",
    "source_path": "mingla-admin/src/pages/BrandSitesPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/BrandSitesPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-data-room",
    "title": "Investor data room",
    "outcome_summary": "Investor data room helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen investor data room flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Investor data room is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/DataRoomPage.jsx",
    "source_path": "mingla-admin/src/pages/DataRoomPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/DataRoomPage.jsx",
      "supabase/functions/admin-data-room/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-careers",
    "title": "Careers postings",
    "outcome_summary": "Careers postings helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen careers postings flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Careers postings is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/CareersPage.jsx",
    "source_path": "mingla-admin/src/pages/CareersPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/CareersPage.jsx"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-health",
    "title": "API health and Stripe mode check",
    "outcome_summary": "API health and Stripe mode check helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen api health and stripe mode check flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "API health and Stripe mode check is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/ApiHealthPage.jsx",
    "source_path": "mingla-admin/src/pages/ApiHealthPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/ApiHealthPage.jsx",
      "supabase/functions/api-health-probe/index.ts",
      "app-mobile/src/services/stripeModeHandshake.ts",
      "mingla-admin/src/pages/StripeModePage.jsx",
      "supabase/functions/stripe-mode/index.ts"
    ]
  },
  {
    "area": "Mingla staff tools",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "staff-content-calendar",
    "title": "Content calendar",
    "outcome_summary": "Content calendar helps Staff complete this job through Admin.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen content calendar flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Content calendar is built for Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/pages/DraftsPage.jsx",
    "source_path": "mingla-admin/src/pages/DraftsPage.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/pages/DraftsPage.jsx"
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
