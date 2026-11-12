// #3355 ship-prep — fixture inputs for the rollout switch's off-path proof.
// The digests in issue_3355_ship_prep_gating.implementor.test.ts were made by
// running origin/main's (7ace80fa0a; first made at 811c033211) buildSystemPrompt on exactly these
// inputs. Keep this file free of imports so the same file runs against
// origin/main's builder.

const BRAND = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Lagos Night Out",
  slug: "lagos-night-out",
  defaultCurrency: "NGN",
  hasCover: true,
  hasBlockingEvents: true,
  role: "owner",
  effectiveRank: 100,
};

const OTHER = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Abuja <Brunch>",
  slug: "abuja-brunch",
  defaultCurrency: null,
  hasCover: false,
  hasBlockingEvents: false,
  role: "marketing_manager",
  effectiveRank: 40,
};

export const PROMPT_FIXTURES = [
  {
    name: "owner with an active brand, offerings and a task",
    profile: {
      display_name: "Favour",
      preferred_timezone: "Africa/Lagos",
      preferred_currency: "NGN",
      communication_style: "concise" as const,
    },
    brands: [BRAND, OTHER],
    options: {
      injectStrictReminder: false,
      business: {
        brands: [BRAND, OTHER],
        activeBrand: BRAND,
        offerings: [{
          id: "33333333-3333-4333-8333-333333333333",
          title: "Lagos Night Out: December",
          kind: "event",
          status: "draft",
          ticketSummary: "General ₦10,000",
          pricingSummary: null,
        }],
        payoutReady: false,
        roleHint: "owner",
        conversationSummary: null,
        taskContext: {
          status: "collecting",
          intent: "create_event",
          resolvedSlotKeys: ["title"],
          pendingSlotKeys: ["start_at"],
        },
        clockContext: {
          now_iso: "2026-11-12T10:00:00.000Z",
          local_date: "2026-11-12",
          timezone: "Africa/Lagos",
          utc_offset_at_target: "+01:00",
        },
      },
      firstRun: null,
    },
  },
  {
    name: "no profile, no brands, first run, injection reminder",
    profile: null,
    brands: [],
    options: {
      injectStrictReminder: true,
      business: {
        brands: [],
        activeBrand: null,
        offerings: [],
        payoutReady: null,
        roleHint: null,
        conversationSummary: null,
      },
      firstRun: { stage: "no_brand" as const, intent: "events" as const },
    },
  },
  {
    name: "teammate, payout ready, legacy unscoped summary",
    profile: {
      display_name: null,
      preferred_timezone: null,
      preferred_currency: null,
      communication_style: "detailed" as const,
    },
    brands: [OTHER],
    options: {
      injectStrictReminder: false,
      business: {
        brands: [OTHER],
        offerings: [],
        payoutReady: true,
        roleHint: "marketing_manager",
        conversationSummary: "Asked about <script> tickets",
      },
    },
  },
];

/** Owner messages whose off-path tool selection must match origin/main's. */
export const TOOLSET_MESSAGES = [
  "Create a discount code FAVY10 for 10% off until 19 December",
  "Actually, I always want prices in naira from now on",
  "Remember that our doors open at 8pm",
  "Refund the order for Ada",
  "Help me set up my website",
  "How do I add a ticket tier?",
  "Publish Lagos Night Out",
  "Never mind, list my events",
];
