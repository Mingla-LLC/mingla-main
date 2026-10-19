-- Issue #3720 Wave 8 — Feature Guide money catalog.
-- Static source and regression evidence only: claimed-Live entries intentionally
-- remain Needs review until a person records current production proof.
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-STATIC-SEED-MONEY","rule":"Catalog seed rows contain only pinned static evidence and cannot become Live without a later human-reviewed live check and release record."}

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
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-tickets",
    "title": "Buy tickets on web or in the app, with Apple Pay and Google Pay",
    "outcome_summary": "Buy tickets on web or in the app, with Apple Pay and Google Pay helps Buyer complete this job through Buyer web · Explorer apps.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer apps"
    ],
    "how_to": "Open Buyer web and follow the on-screen buy tickets on web or in the app, with apple pay and google pay flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Buyer web · Explorer apps.",
    "support_wording": "Buy tickets on web or in the app, with Apple Pay and Google Pay is built for Buyer on Buyer web · Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "source_path": "mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "test_path": "mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/checkout/[eventId]/__tests__/confirm_refused_after_payment.test.tsx",
      "supabase/functions/ticket-checkout-create/index.ts",
      "app-mobile/src/payments/nativeCheckoutFlow.ts",
      "app-mobile/src/components/expandedCard/TicketCartSheet.tsx"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-trips-experiences",
    "title": "Book trips and experiences",
    "outcome_summary": "Book trips and experiences helps Buyer complete this job through Buyer web · Explorer apps.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer apps"
    ],
    "how_to": "Open Buyer web and follow the on-screen book trips and experiences flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Book trips and experiences is built for Buyer on Buyer web · Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/checkout-trip/[tripEventId]/__tests__/issue_2190_paid_checkout_provider_handoff.test.tsx",
    "source_path": "mingla-business/app/checkout-trip/[tripEventId]/__tests__/issue_2190_paid_checkout_provider_handoff.test.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/checkout-trip/[tripEventId]/__tests__/issue_2190_paid_checkout_provider_handoff.test.tsx"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-free",
    "title": "Free tickets and RSVPs",
    "outcome_summary": "Free tickets and RSVPs helps Buyer complete this job through Buyer web · apps.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "apps"
    ],
    "how_to": "Open Buyer web and follow the on-screen free tickets and rsvps flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Free tickets and RSVPs is built for Buyer on Buyer web · apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql",
    "source_path": "supabase/migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql",
    "migration_path": "supabase/migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql",
    "claim_refs": [
      "supabase/migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-nigeria",
    "title": "Pay in naira with Paystack",
    "outcome_summary": "Pay in naira with Paystack helps Buyer complete this job through Buyer web · apps.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "apps"
    ],
    "how_to": "Open Buyer web and follow the on-screen pay in naira with paystack flow. Check the cited evidence before describing its production status.",
    "limitations": "Nigeria only. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Pay in naira with Paystack is built for Buyer on Buyer web · apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/ticket-checkout-create/index.ts",
    "source_path": "supabase/functions/ticket-checkout-create/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260915000000_meta_orch_1076_p1_payment_provider.sql",
    "migration_path": "supabase/migrations/20260915000000_meta_orch_1076_p1_payment_provider.sql",
    "claim_refs": [
      "supabase/functions/ticket-checkout-create/index.ts",
      "supabase/migrations/20260915000000_meta_orch_1076_p1_payment_provider.sql"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-hidden-link",
    "title": "Hidden, direct-link ticket sales",
    "outcome_summary": "Hidden, direct-link ticket sales helps Host and Buyer complete this job through Buyer web.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "Open Buyer web and follow the on-screen hidden, direct-link ticket sales flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Hidden, direct-link ticket sales is built for Host and Buyer on Buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql",
    "source_path": "supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql",
    "test_url": null,
    "test_path": null,
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql",
    "migration_path": "supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql",
    "claim_refs": [
      "supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-order-page",
    "title": "Order page with your QR code",
    "outcome_summary": "Order page with your QR code helps Buyer complete this job through Buyer web.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "Open Buyer web and follow the on-screen order page with your qr code flow. Check the cited evidence before describing its production status.",
    "limitations": "Some details come from that device. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Order page with your QR code is built for Buyer on Buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/o/[orderId].tsx",
    "source_path": "mingla-business/app/o/[orderId].tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/o/[orderId].tsx"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-claim-ticket",
    "title": "Add a ticket you bought as a guest to your account",
    "outcome_summary": "Add a ticket you bought as a guest to your account helps Buyer complete this job through Buyer web · Explorer apps.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer apps"
    ],
    "how_to": "Open Buyer web and follow the on-screen add a ticket you bought as a guest to your account flow. Check the cited evidence before describing its production status.",
    "limitations": "Availability is limited to Buyer web · Explorer apps.",
    "support_wording": "Add a ticket you bought as a guest to your account is built for Buyer on Buyer web · Explorer apps. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/AttendanceClaimSheet.tsx",
    "source_path": "app-mobile/src/components/AttendanceClaimSheet.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/app-mobile/src/components/__tests__/issue_2979_attendance_claim_android_cta.implementor.happy.test.tsx",
    "test_path": "app-mobile/src/components/__tests__/issue_2979_attendance_claim_android_cta.implementor.happy.test.tsx",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "app-mobile/src/components/AttendanceClaimSheet.tsx",
      "mingla-business/app/attendance/claim.tsx",
      "supabase/functions/claim-attendance/index.ts"
    ]
  },
  {
    "area": "Checkout",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "checkout-refund-bank",
    "title": "Enter bank details to finish a refund",
    "outcome_summary": "Enter bank details to finish a refund helps Buyer complete this job through Buyer web.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ],
    "how_to": "Open Buyer web and follow the on-screen enter bank details to finish a refund flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Enter bank details to finish a refund is built for Buyer on Buyer web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/refund/[refundId]/attention.tsx",
    "source_path": "mingla-business/app/refund/[refundId]/attention.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/refund/[refundId]/attention.tsx",
      "supabase/functions/source-refund-attention/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "payouts-stripe",
    "title": "Get paid through Stripe in 34 countries",
    "outcome_summary": "Get paid through Stripe in 34 countries helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen get paid through stripe in 34 countries flow. Check the cited evidence before describing its production status.",
    "limitations": "US, UK, Canada, Switzerland and the EEA; no Nigeria.",
    "support_wording": "Get paid through Stripe in 34 countries is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/connect-onboarding.web.tsx",
    "source_path": "mingla-business/app/connect-onboarding.web.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts",
    "test_path": "mingla-business/src/components/stripe/connect-pages/__tests__/connectOnboardingExit_adversarial_tester_1234.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/connect-onboarding.web.tsx",
      "supabase/functions/brand-stripe-onboard/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "payouts-paystack-nigeria",
    "title": "Get paid in Nigeria through Paystack",
    "outcome_summary": "Get paid in Nigeria through Paystack helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen get paid in nigeria through paystack flow. Check the cited evidence before describing its production status.",
    "limitations": "Nigeria only; Ghana not yet.",
    "support_wording": "Get paid in Nigeria through Paystack is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
    "source_path": "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/utils/__tests__/issue_3645_payouts_step_nigeria_copy.implementor.test.ts",
    "test_path": "mingla-business/src/utils/__tests__/issue_3645_payouts_step_nigeria_copy.implementor.test.ts",
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
      "supabase/functions/brand-paystack-onboard/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "payouts-timing",
    "title": "When payouts arrive (about 24 hours after each payment)",
    "outcome_summary": "When payouts arrive (about 24 hours after each payment) helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for when payouts arrive (about 24 hours after each payment). Check the cited evidence before describing its production status.",
    "limitations": "Payout execution is off in code by default; prove it in production. A live check must read the production flag or setting before promotion.",
    "support_wording": "When payouts arrive (about 24 hours after each payment) is built for Host, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "test",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/payout-release-sweep/index.ts",
    "source_path": "supabase/functions/payout-release-sweep/index.ts",
    "test_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/__tests__/issue_3645_payment_plus_24h.implementor.happy.pg17.test.sql",
    "test_path": "supabase/migrations/__tests__/issue_3645_payment_plus_24h.implementor.happy.pg17.test.sql",
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql",
    "migration_path": "supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql",
    "claim_refs": [
      "supabase/functions/payout-release-sweep/index.ts",
      "supabase/migrations/20270720003645_issue_3645_payment_plus_24h_payouts.sql"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "payouts-balances-reports",
    "title": "See balances, payouts and finance reports",
    "outcome_summary": "See balances, payouts and finance reports helps Host complete this job through Host apps · web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen see balances, payouts and finance reports flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "See balances, payouts and finance reports is built for Host on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/brand/[id]/payments/index.tsx",
    "source_path": "mingla-business/app/brand/[id]/payments/index.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/brand/[id]/payments/index.tsx",
      "supabase/functions/brand-stripe-balances/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "payouts-tax-registrations",
    "title": "Stripe tax registrations",
    "outcome_summary": "Stripe tax registrations helps Host complete this job through Host web.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host web"
    ],
    "how_to": "Open Host web and follow the on-screen stripe tax registrations flow. Check the cited evidence before describing its production status.",
    "limitations": "No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Stripe tax registrations is built for Host on Host web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/connect-tax-registrations/index.web.tsx",
    "source_path": "mingla-business/app/connect-tax-registrations/index.web.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/connect-tax-registrations/index.web.tsx",
      "supabase/functions/brand-stripe-tax-account-session/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "payouts-partner-program",
    "title": "Partner earnings and splits",
    "outcome_summary": "Partner earnings and splits helps Partner complete this job through Host apps · web.",
    "who_can_use": [
      "Partner"
    ],
    "surfaces": [
      "Host apps",
      "web"
    ],
    "how_to": "Open Host apps and follow the on-screen partner earnings and splits flow. Check the cited evidence before describing its production status.",
    "limitations": "Per-account opt-in. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Partner earnings and splits is built for Partner on Host apps · web. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/app/partner/earnings.tsx",
    "source_path": "mingla-business/app/partner/earnings.tsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/app/partner/earnings.tsx",
      "supabase/functions/partner-stripe-onboard/index.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "money-mingla-fee",
    "title": "Mingla's fee (1.5%)",
    "outcome_summary": "Mingla's fee (1.5%) helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for mingla's fee (1.5%). Check the cited evidence before describing its production status.",
    "limitations": "Plus payment processing; brand overrides are possible. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Mingla's fee (1.5%) is built for Host on the relevant Mingla workflow. Support must use the current evidence status when answering.",
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
    "migration_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "migration_path": "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql",
    "claim_refs": [
      "mingla-admin/src/pages/PricingPage.jsx",
      "supabase/migrations/20260802000000_orch_1006_pricing_switches.sql"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "money-currencies",
    "title": "Supported currencies",
    "outcome_summary": "Supported currencies helps Host complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for supported currencies. Check the cited evidence before describing its production status.",
    "limitations": "GBP, USD, CAD, CHF, EUR, BGN, CZK, DKK, HUF, ISK, NOK, PLN, RON, SEK, NGN. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Supported currencies is built for Host on the relevant Mingla workflow. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-business/src/hooks/useDraftFollowsBrandCurrency.ts",
    "source_path": "mingla-business/src/hooks/useDraftFollowsBrandCurrency.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-business/src/hooks/useDraftFollowsBrandCurrency.ts"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "live_candidate",
    "app_only": false,
    "capability_key": "money-disputes",
    "title": "How chargebacks and disputes are handled",
    "outcome_summary": "How chargebacks and disputes are handled helps Host and Staff complete this job through Admin.",
    "who_can_use": [
      "Host",
      "Staff"
    ],
    "surfaces": [
      "Admin"
    ],
    "how_to": "Open Admin and follow the on-screen how chargebacks and disputes are handled flow. Check the cited evidence before describing its production status.",
    "limitations": "The Paystack evidence submit is a stub. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "How chargebacks and disputes are handled is built for Host and Staff on Admin. Support must use the current evidence status when answering.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/mingla-admin/src/components/money/PaystackDisputeDetail.jsx",
    "source_path": "mingla-admin/src/components/money/PaystackDisputeDetail.jsx",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "mingla-admin/src/components/money/PaystackDisputeDetail.jsx"
    ]
  },
  {
    "area": "Getting paid",
    "start_as": "check_flag",
    "app_only": false,
    "capability_key": "money-provider-refunds",
    "title": "Refunds made directly in Stripe or Paystack are picked up",
    "outcome_summary": "Refunds made directly in Stripe or Paystack are picked up helps Staff complete this job through the relevant Mingla workflow.",
    "who_can_use": [
      "Staff"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "Use the relevant Mingla support workflow for refunds made directly in stripe or paystack are picked up. Check the cited evidence before describing its production status.",
    "limitations": "Off in code by default. A live check must read the production flag or setting before promotion. No feature-specific regression test was found at the pinned source commit.",
    "support_wording": "Refunds made directly in Stripe or Paystack are picked up is built for Staff, but Support must confirm the current production setting before calling it Live.",
    "claimed_status": "live",
    "required_evidence_kinds": [
      "source",
      "live_check",
      "release_record",
      "feature_flag"
    ],
    "source_url": "https://github.com/Mingla-LLC/mingla-main/blob/24d6c918c3e834751abb8884d39587073b9964fc/supabase/functions/source-refund-sweep/index.ts",
    "source_path": "supabase/functions/source-refund-sweep/index.ts",
    "test_url": null,
    "test_path": null,
    "migration_url": null,
    "migration_path": null,
    "claim_refs": [
      "supabase/functions/source-refund-sweep/index.ts"
    ]
  },
  {
    "area": "Plans and programs",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "plans-host-paid",
    "title": "Paid Mingla Host plans",
    "outcome_summary": "Paid Mingla Host plans is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built (#3681).",
    "support_wording": "Mingla does not currently offer paid mingla host plans. Not built (#3681)",
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
    "area": "Plans and programs",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "programs-creators",
    "title": "Creators program",
    "outcome_summary": "Creators program is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Creators"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built (#3872).",
    "support_wording": "Mingla does not currently offer creators program. Not built (#3872)",
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
    "area": "Plans and programs",
    "start_as": "not_available_yet",
    "app_only": false,
    "capability_key": "programs-app-giveaways",
    "title": "App-download giveaways",
    "outcome_summary": "App-download giveaways is not currently available; Support can answer without promising a date.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "how_to": "There is no customer-ready flow to open. Record the request and use the approved Not available yet wording.",
    "limitations": "Not built (#3922).",
    "support_wording": "Mingla does not currently offer app-download giveaways. Not built (#3922)",
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
