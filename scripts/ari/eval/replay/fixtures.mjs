/**
 * #3355 Wave F (F1) — scripted host threads for the replay harness.
 *
 * PII: the production thread (Lagos, 2026-11-10) is replayed against the
 * SYNTHETIC brand "Harmattan Kitchen" (seed-flow-brands.mjs). The host's
 * name, brand, phone, email and event names are not here. The discount
 * codes are kept as they are: they are not personal data and they are the
 * values the guards must preserve.
 *
 * Each turn has:
 *   - say: the owner's words (typed, exactly as sent);
 *   - expect: what grade.mjs checks (see gradeTurn);
 *   - stub: what the CI replay feeds the deterministic layers instead of the
 *     model (the intent read, and the proposal or reply the model makes).
 */

import {
  EVENT_SETUP_TRAP,
  NOT_AVAILABLE,
  WEBSITE_OVER_PROMISE,
} from "./grade.mjs";

export const HOST_INFLUENCER_SENTENCE =
  "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";

export const HOST_FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';

const discountRead = (stated = {}) => ({
  intent: "tool",
  target: "create_discount",
  confidence: 0.95,
  stated_values: stated,
});

export const REPLAY_FIXTURES = [
  {
    id: "host_thread_2026_11_10",
    source:
      "Production thread 2026-11-10 09:47–09:59 Lagos (run 8a841954) and the team thread after it; PII-scrubbed (synthetic brand), codes kept.",
    brand: "ng",
    account: "ng_owner",
    timezone: "Africa/Lagos",
    turns: [
      {
        say: HOST_INFLUENCER_SENTENCE,
        expect: {
          route: ["text", "proposal:create_discount"],
          no_new_flow_run: true,
          reply_must: ["discount|code"],
          reply_must_not: [NOT_AVAILABLE, EVENT_SETUP_TRAP, "time zone"],
        },
        stub: {
          read: discountRead(),
          reply:
            "I can set up discount codes for your influencers and marketers. Tell me the code, how much off, and when it should end.",
        },
      },
      {
        say: HOST_FAVY10_SENTENCE,
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: {
              code: "FAVY10",
              value_bps: 1000,
              ends_at: "2026-12-19T22:59:59Z",
            },
          },
          reply_must_not: [EVENT_SETUP_TRAP, "time zone"],
        },
        stub: {
          read: discountRead({
            code: "FAVY10",
            percent_off: 10,
            ends_on: "2026-12-19",
          }),
          // Flash writes the day's end in UTC; the guard binds it to Lagos.
          proposal: {
            tool: "create_discount",
            args: {
              code: "FAVY10",
              kind: "code",
              value_type: "percent",
              value_bps: 1000,
              ends_at: "2026-12-19T23:59:59Z",
            },
          },
        },
      },
      {
        say: "Create the codes GIRLSTRIPLAGOS and FFBTSCOM10, 10% off each",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: {
              code: { oneOf: ["GIRLSTRIPLAGOS", "FFBTSCOM10"] },
              value_bps: 1000,
            },
          },
        },
        stub: {
          read: discountRead({ percent_off: 10 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "GIRLSTRIPLAGOS",
              kind: "code",
              value_type: "percent",
              value_bps: 1000,
            },
          },
        },
      },
      {
        // Nothing was confirmed (every card is cancelled between turns), so
        // the honest answer is "not yet" (production said "I proposed…"
        // with no card, 10:08:53).
        say: "Did you create FFBTSCOM10 already?",
        expect: {
          not_route: ["flow_card:"],
          no_new_flow_run: true,
          reply_must_not: [
            "\\bFFBTSCOM10 (?:is|was) (?:now )?(?:live|active|created|ready)\\b",
            "\\bI(?:'ve|’ve| have)? (?:already )?created\\b",
          ],
        },
        stub: {
          read: { intent: "question", target: null, confidence: 0.85, stated_values: {} },
          reply:
            "I proposed creating the discount code FFBTSCOM10 for you.",
        },
      },
    ],
  },
  {
    id: "issue_3355_customer_list_upload",
    source:
      "#3355 body: a host asks to upload a customer list; the answer is People → Import from the Feature Guide (marketing-contact-import).",
    brand: "ng",
    account: "ng_owner",
    timezone: "Africa/Lagos",
    turns: [
      {
        say: "I want to upload my customer list",
        expect: {
          route: ["text", "flow_card:import_contacts"],
          reply_must: ["People", "Import"],
          reply_must_not: [NOT_AVAILABLE],
        },
        stub: {
          read: { intent: "question", target: null, confidence: 0.85, stated_values: {} },
          reply:
            "You can upload it in Mingla Host: open the Blast tab, go to People, tap Import and choose your CSV. Or attach the file here and I'll import it with you.",
        },
      },
    ],
  },
  {
    id: "issue_3355_website_no_site",
    source:
      "#3355 body: a brand with no website asks Ari to create one; Ari must not say a site exists or is live.",
    brand: "new",
    account: "new_owner",
    timezone: "Europe/London",
    turns: [
      {
        say: "Can you create a website for my brand?",
        expect: {
          reply_must: ["website|site"],
          reply_must_not: [WEBSITE_OVER_PROMISE],
        },
        stub: {
          read: { intent: "flow", target: "website_setup", confidence: 0.9, stated_values: {} },
          reply:
            "Let's set up your Website. I'll go through the plan one part at a time and save each change only after you approve it.",
        },
      },
    ],
  },
  {
    // #4624 follow-up 1: ticket-capped codes. "N free tickets", "only / first
    // / up to N tickets" and "N tickets max" are a ticket limit
    // (ends_after_count); "N uses", "N times" and "N people can use it" are
    // Total uses (max_total_uses); a bare "limit it to N" is asked about. The
    // stubs make the model put each number in the wrong field, as Flash did
    // before the intent read had a ticket field.
    id: "issue_4624_ticket_limit_phrasings",
    source:
      "#4624 implementor discovery 1 and tester risk (7206081911): Ari read ticket limits as Total uses.",
    brand: "ng",
    account: "ng_owner",
    timezone: "Africa/Lagos",
    turns: [
      {
        say: "Create a code FREE5 for 100% off, 5 free tickets",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: { code: "FREE5", ends_after_count: 5, max_total_uses: null },
          },
        },
        stub: {
          read: discountRead({ code: "FREE5", percent_off: 100, max_total_uses: 5 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "FREE5",
              kind: "code",
              value_type: "percent",
              value_bps: 10000,
              max_total_uses: 5,
            },
          },
        },
      },
      {
        say: "Make EARLY20 20% off for the first 20 tickets",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: { code: "EARLY20", ends_after_count: 20, max_total_uses: null },
          },
        },
        stub: {
          read: discountRead({ code: "EARLY20", percent_off: 20, ends_after_count: 20 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "EARLY20",
              kind: "code",
              value_type: "percent",
              value_bps: 2000,
              ends_after_count: 20,
            },
          },
        },
      },
      {
        say: "Create VIP10 for 10% off, only 30 tickets",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: { code: "VIP10", ends_after_count: 30, max_total_uses: null },
          },
        },
        stub: {
          read: discountRead({ code: "VIP10", percent_off: 10, max_total_uses: 30 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "VIP10",
              kind: "code",
              value_type: "percent",
              value_bps: 1000,
              max_total_uses: 30,
            },
          },
        },
      },
      {
        say: "Create SQUAD15 for 15% off, 5 people can use it",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: { code: "SQUAD15", max_total_uses: 5, ends_after_count: null },
          },
        },
        stub: {
          read: discountRead({ code: "SQUAD15", percent_off: 15, max_total_uses: 5 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "SQUAD15",
              kind: "code",
              value_type: "percent",
              value_bps: 1500,
              ends_after_count: 5,
            },
          },
        },
      },
      {
        say: "Create TEN10 for 10% off, it can be used 10 times",
        expect: {
          route: "proposal:create_discount",
          no_new_flow_run: true,
          proposal: {
            tool: "create_discount",
            args: { code: "TEN10", max_total_uses: 10, ends_after_count: null },
          },
        },
        stub: {
          read: discountRead({ code: "TEN10", percent_off: 10, max_total_uses: 10 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "TEN10",
              kind: "code",
              value_type: "percent",
              value_bps: 1000,
              max_total_uses: 10,
            },
          },
        },
      },
      {
        // Rework (tester P1-1): tickets per person are neither a ticket limit
        // nor Total uses; a code can only cap uses per buyer, so Ari asks.
        say: "Create EACH5 for 100% off, max 5 tickets per person",
        expect: {
          route: "text",
          no_new_flow_run: true,
          reply_must: ["how many times each buyer uses it"],
        },
        stub: {
          read: discountRead({ code: "EACH5", percent_off: 100, max_total_uses: 5 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "EACH5",
              kind: "code",
              value_type: "percent",
              value_bps: 10000,
              ends_after_count: 5,
            },
          },
        },
      },
      {
        say: "Create HALF50 for 50% off and limit it to 50",
        expect: {
          route: "text",
          no_new_flow_run: true,
          reply_must: ["count tickets or checkouts"],
        },
        stub: {
          read: discountRead({ code: "HALF50", percent_off: 50, max_total_uses: 50 }),
          proposal: {
            tool: "create_discount",
            args: {
              code: "HALF50",
              kind: "code",
              value_type: "percent",
              value_bps: 5000,
              max_total_uses: 50,
            },
          },
        },
      },
    ],
  },
];

/** The flow evals (scripts/ari/eval/flows/) the live run also scores. */
export const LIVE_FLOW_EVAL_IDS = [
  // S3–S6 (Wave A, A7).
  "influencer_request_discount_path",
  "favy10_mid_flow_ends_at",
  "same_request_twice_never_same_card",
  "ng_brand_no_timezone_handoff",
  // The guided setups the engine owns.
  "event_create_minimal",
  "event_paid_blocked",
  "trip_create_lagos_3day",
  "experience_create_two_stops",
  "venue_create_picker",
  "stay_create_on_approved_venue",
  "website_setup_phone",
  "refund_role_refused_event_manager",
  "brand_gate_defer_remembered",
];

/** Turns that start a guided setup (latency is reported separately). */
export function isSetupStart(text) {
  return /^(?:create an event|set up a stay|add a venue|start website setup|i want to plan a trip|create an event called)/i
    .test(String(text ?? "").trim());
}
