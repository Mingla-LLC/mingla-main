import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runAgentLoop } from "../agentLoop.ts";
import { buildAriTripCreationCall } from "../agentTripPlanner.ts";
import { lintAriCopy } from "../agentCopyLint.ts";
import {
  sanitizeAriPublicText,
  sanitizeAriText,
  sanitizeAriUserFacingDiagnostics,
  sanitizeAriValue,
} from "../agentSanitization.ts";
import {
  ariDeterministicReadPlan,
  ariDeterministicSafetyReply,
  buildAriCapabilityPlan,
  buildAriDeterministicReadReply,
  buildAriOnboardingResumeReply,
  buildAriOnboardingSetupPlanCall,
  buildAriOnboardingSetupReply,
  findAriCampaignDraftId,
  findAriRecentEventTitle,
  inferAriToolsets,
  isAriOnboardingPlanProgressMessage,
  needsAriCampaignDraftReview,
  needsAriCampaignPerformanceRead,
  needsAriCampaignWorkflow,
  needsAriCapabilityDiscovery,
  needsAriOnboardingResumeRead,
  needsAriOnboardingSetupRead,
  selectAriCampaignWorkflowTools,
  selectAriOnboardingSetupTools,
  selectAriTools,
} from "../agentToolsets.ts";
import type { AgentTool } from "../agentToolHelpers.ts";
import {
  compareListingCandidateSources,
  extractCandidates,
  searchAriCapabilities,
} from "../agentAri10xTools.ts";
import {
  assertSafePublicUrl,
  canCompleteResearchFromSearchIndex,
  canonicalizePublicResearchUrl,
  curatePublicResearchSources,
  isPrivateIpAddress,
  isStandalonePublicResearchRequest,
  parseBingPublicSearchResults,
  parseLocalPublicSearchResults,
} from "../agentWebResearch.ts";
import {
  ariUserFacingToolError,
  buildAgentRunRendition,
} from "../agentRenditions.ts";
import {
  buildBrandLaunchPlan,
  isAriEventLaunchReadinessRequest,
  isBrandLaunchPlanRequest,
  launchPlanInitialCalls,
  launchPlanNeedsPublicResearch,
} from "../agentLaunchPlan.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { AGENT_TOOLS, findTool } from "../agentTools.ts";
import {
  assertTaskState,
  createEventTaskState,
  IDLE_TASK_STATE,
  stateForNewAgentProposal,
} from "../agentConversationState.ts";
import {
  isCreateEventPlanningRequest,
  planEventTurn,
} from "../agentConversationPlanner.ts";
import {
  ARI_LOCAL_MODEL_REQUEST_TIMEOUT_MS,
  callGemini,
} from "../agentGemini.ts";
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../agentReliability.ts";
import {
  buildTicketTierReceipt,
  groundNewTicketTierFields,
  isFullySpecifiedTicketTierWriteRequest,
  ticketTierProposalMismatch,
  ticketTierTextBypassesApproval,
} from "../agentTicketPricing.ts";
import {
  detectAriQualitySignals,
  inferAriCapabilityGap,
} from "../agentQuality.ts";
import {
  detectAriMediaMime,
  verifyAriAttachment,
} from "../agentAttachments.ts";
// The executable catalogue is shared with the Node evaluation runner.
// @ts-ignore Deno can execute the local ESM catalogue without a declaration file.
import { ARI_EVAL_SCENARIOS } from "../../../../scripts/ari/eval/scenarios.mjs";

Deno.test("#3355 event proposals preserve an explicit guest limit", () => {
  const createEvent = findTool("create_event");
  assert(createEvent);
  const schema = createEvent.parameters as {
    properties?: Record<string, {
      description?: string;
      items?: { required?: string[]; properties?: Record<string, unknown> };
    }>;
  };
  const tickets = schema.properties?.tickets;
  assert(tickets);
  assertMatch(tickets.description ?? "", /20 guests.*capacity 20/i);
  assert(tickets.items?.required?.includes("capacity"));
  assert(tickets.items?.properties?.capacity);
});

Deno.test("#3355 trip creation can carry grounded schedule and guest limit", () => {
  const createTrip = findTool("create_trip");
  assert(createTrip);
  assertMatch(createTrip.description, /include timezone, start_date, end_date/i);
  assertMatch(createTrip.description, /do not invent price, itinerary/i);
  const schema = createTrip.parameters as {
    properties?: Record<string, unknown>;
  };
  for (const field of [
    "timezone",
    "start_date",
    "end_date",
    "destination_text",
    "max_guests",
  ]) {
    assert(schema.properties?.[field], `create_trip must expose ${field}`);
  }
});

Deno.test("#3355 complete trip creation requests use a grounded proposal", () => {
  assertEquals(
    buildAriTripCreationCall(
      "Create a private trip named ‘Lagos Wellness Weekend’ for Coastline Collective: January 8, 2027 through January 10, 2027, Africa/Lagos, maximum 20 guests. Do not invent a price.",
      "33550000-0000-4000-a000-000000000001",
    ),
    {
      name: "create_trip",
      args: {
        brand_id: "33550000-0000-4000-a000-000000000001",
        title: "Lagos Wellness Weekend",
        start_date: "2027-01-08",
        end_date: "2027-01-10",
        timezone: "Africa/Lagos",
        destination_text: "Lagos",
        max_guests: 20,
      },
    },
  );
  assertEquals(
    buildAriTripCreationCall(
      "Create a private trip called ‘Lagos Wellness Weekend’ for November 15th. Africa/Lagos.",
      "33550000-0000-4000-a000-000000000001",
    ),
    null,
    "a yearless date must stay in clarification rather than becoming a proposal",
  );
  assertEquals(
    buildAriTripCreationCall(
      "How do I create a trip?",
      "33550000-0000-4000-a000-000000000001",
    ),
    null,
    "an instructional question is not a create request",
  );
});

Deno.test("#3355 new ticket tiers omit ungrounded tier ids", () => {
  const tool = findTool("upsert_ticket_tier");
  assert(tool);
  assertMatch(tool.description, /new tier, omit tier_id/i);
  assertMatch(tool.description, /never invent a tier_id/i);
  const schema = tool.parameters as {
    properties?: Record<string, { description?: string }>;
  };
  assertMatch(
    schema.properties?.tier_id?.description ?? "",
    /omit.*new tier.*existing tier_id returned by a read/i,
  );
});

Deno.test("#3355 new ticket arguments derive required flags only from explicit facts", () => {
  const grounded = groundNewTicketTierFields({
    event_id: "33550000-0000-4000-a000-000000000073",
    tier_id: "invented-tier-id",
    name: "General Admission",
    price_cents: 2500,
    capacity: 80,
  }, "Add one ticket tier at $25, with capacity for 80 guests.");
  assertEquals(grounded, {
    event_id: "33550000-0000-4000-a000-000000000073",
    name: "General Admission",
    price_cents: 2500,
    capacity: 80,
    is_free: false,
    is_unlimited: false,
  });
  assertEquals(
    groundNewTicketTierFields({ name: "VIP" }, "Update VIP tier details."),
    { name: "VIP" },
    "an update must not be rewritten as a create",
  );
  assertEquals(
    groundNewTicketTierFields(
      { name: "Early Bird", price_cents: 2500000, capacity: 80 },
      "Add an Early Bird ticket tier priced at NGN 25,000 with capacity 80 to the Harmattan Club event Midnight Practice.",
    ),
    {
      name: "Early Bird",
      price_cents: 2500000,
      capacity: 80,
      is_free: false,
      is_unlimited: false,
    },
    "plain finite capacity wording grounds the create-only unlimited flag",
  );
  assertEquals(
    groundNewTicketTierFields(
      {
        event_id: "33550000-0000-4000-a000-000000000073",
        name: "General Admission",
        price_cents: 2000000,
        capacity: 80,
      },
      'Add a General Admission ticket to the draft event "Ari 3355 local QA Oct 31" for NGN 20,000, capacity 80.',
    ),
    {
      event_id: "33550000-0000-4000-a000-000000000073",
      name: "General Admission",
      price_cents: 2000000,
      capacity: 80,
      is_free: false,
      is_unlimited: false,
    },
    "natural-language ticket wording still grounds the required paid/finite flags",
  );
});

Deno.test("#3355 ticket approval receipt uses the canonical saved tier", () => {
  assertEquals(
    buildTicketTierReceipt({
      representation: "draft",
      effective_currency: "USD",
      tiers: [{
        name: "General Admission",
        isFree: false,
        priceGbp: 25,
        capacity: 80,
      }],
    }),
    "I saved and verified the “General Admission” ticket tier at USD 25, capacity 80. The event remains a draft and is not published.",
  );
  assertEquals(buildTicketTierReceipt({ tiers: [] }), null);
});

Deno.test("#3355 explicit ticket writes cannot be replaced by chat-only confirmation", () => {
  const request =
    "For the saved draft ‘Midnight Practice’, add one General Admission ticket tier at NGN 25,000 with capacity 80. Keep the event unpublished. Show me the exact ticket details and ask me to confirm before saving.";
  const response =
    "I’ll add a General Admission ticket tier at NGN 25,000. Would you like me to proceed with saving it? Please confirm.";
  assert(isFullySpecifiedTicketTierWriteRequest(request));
  assert(ticketTierTextBypassesApproval(request, response));
  assertEquals(
    ticketTierTextBypassesApproval(
      "For the saved draft ‘Midnight Practice’, add a ticket tier.",
      "Which price and capacity should I use?",
    ),
    false,
  );
  assertEquals(
    ticketTierTextBypassesApproval(
      request,
      "The ticket tier is blocked because this brand is not payout-ready.",
    ),
    false,
  );
});

Deno.test("#3355 named ticket requests accept natural wording without the word tier", () => {
  const request =
    'Add a General Admission ticket to the draft event "Ari 3355 local QA Oct 31" for NGN 20,000, capacity 80. Keep the event unpublished and ask me to confirm before saving the ticket.';
  assert(isFullySpecifiedTicketTierWriteRequest(request));
  assert(ticketTierProposalMismatch(request, "create_event"));
  assertEquals(
    ticketTierProposalMismatch(request, "upsert_ticket_tier"),
    false,
  );
});

Deno.test("#3355 existing-event ticket request is explicit and rejects event creation", () => {
  const request =
    "Add an Early Bird ticket tier priced at NGN 25,000 with capacity 80 to the Harmattan Club event Midnight Practice. Show me the exact change for approval. Do not publish.";
  assert(isFullySpecifiedTicketTierWriteRequest(request));
  assert(ticketTierProposalMismatch(request, "create_event"));
  assertEquals(
    ticketTierProposalMismatch(request, "upsert_ticket_tier"),
    false,
  );
});

Deno.test("#3355 payout readiness refusal keeps actionable user-facing semantics", () => {
  assertEquals(mapLegacyAriErrorCode("PAYOUT_NOT_READY"), "PAYOUT_NOT_READY");
  assertEquals(ARI_ERROR_REGISTRY.PAYOUT_NOT_READY.httpStatus, 409);
  assertEquals(ARI_ERROR_REGISTRY.PAYOUT_NOT_READY.operationState, "none");
  assertMatch(
    ARI_ERROR_REGISTRY.PAYOUT_NOT_READY.userMessage,
    /finish its Stripe or Paystack payout setup/i,
  );
});

Deno.test("#3355 a new proposal releases a completed event planner task", () => {
  const completed = {
    ...createEventTaskState({
      taskId: "33550000-0000-4000-a000-000000000001",
      brandId: "33550000-0000-4000-a000-000000000002",
      originMessageId: "33550000-0000-4000-a000-000000000003",
      nowIso: "2026-10-30T12:00:00.000Z",
      brief: {
        concepts: [],
        food: [],
        music: [],
        experience: [],
        notes: [],
      },
      title: "Afterglow Sessions",
    }),
    status: "completed" as const,
    last_completed_step: {
      intent: "create_event",
      outcome: "executed" as const,
      resource_kind: "event",
      resource_id: "33550000-0000-4000-a000-000000000004",
      pending_action_id: "33550000-0000-4000-a000-000000000005",
      completed_at: "2026-10-30T12:01:00.000Z",
    },
  };
  const next = stateForNewAgentProposal(completed);
  assertTaskState(next);
  assertEquals(next.status, IDLE_TASK_STATE.status);
  assertEquals(next.active_task, null);
  assertEquals(next.last_completed_step, completed.last_completed_step);
});

Deno.test("#3355 deterministic event planning carries capacity into the confirmed draft", () => {
  const planned = planEventTurn(
    {
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    },
    "Create a private dinner event called Capacity Proof on January 17, 2027 at 7 PM for exactly 20 guests",
    {
      now: new Date("2026-10-29T18:00:00-04:00"),
      timezone: "America/New_York",
      activeBrand: {
        id: "33550000-0000-4000-a000-000000000002",
        name: "Lantern Room",
      },
      originMessageId: "message-capacity",
      taskId: "task-capacity",
      questionId: "question-capacity",
    },
  );
  assertEquals(planned.state.status, "ready_to_propose");
  assertEquals(planned.proposal?.tool_name, "create_event");
  const tickets = planned.proposal?.tool_args.tickets as Array<
    Record<string, unknown>
  >;
  assertEquals(tickets[0].capacity, 20);
  assertEquals(tickets[0].isFree, true);
  assertMatch(planned.text, /limited to 20 guests/i);
});

Deno.test("#3355 event confirmation preserves year, explicit WAT, end time, venue, and grounded copy", () => {
  const planned = planEventTurn(
    {
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    },
    "Create a draft event called “Seth Is Popping” for Harmattan Club on November 15, 2026 from 6 PM to 11 PM WAT at Harmattan Club in Lagos. Make it free for 200 guests, use event copy based only on those details, and stop before publishing.",
    {
      now: new Date("2026-10-29T18:00:00-04:00"),
      timezone: "America/New_York",
      activeBrand: {
        id: "33550000-0000-4000-a000-000000000002",
        name: "Harmattan Club",
      },
      originMessageId: "message-event-grounding",
      taskId: "task-event-grounding",
      questionId: "question-event-grounding",
    },
  );

  assertEquals(planned.proposal?.tool_name, "create_event");
  assertEquals(planned.proposal?.tool_args.title, "Seth Is Popping");
  assertEquals(planned.proposal?.tool_args.timezone, "Africa/Lagos");
  assertEquals(
    planned.proposal?.tool_args.start_at,
    "2026-11-15T17:00:00.000Z",
  );
  assertEquals(planned.proposal?.tool_args.end_at, "2026-11-15T22:00:00.000Z");
  assertEquals(
    planned.proposal?.tool_args.location_text,
    "Harmattan Club in Lagos",
  );
  assertMatch(
    String(planned.proposal?.tool_args.description),
    /November 15, 2026/,
  );
  assertMatch(
    String(planned.proposal?.tool_args.description),
    /Harmattan Club in Lagos/,
  );
  assertMatch(planned.text, /Nov 15, 2026/);
  assertMatch(planned.text, /11:00 PM WAT/);
  assertMatch(planned.text, /Harmattan Club in Lagos/);
  assertMatch(planned.text, /Should I create this draft\?/);
});

Deno.test("#3355 abbreviated meridiem event range preserves both clocks without inventing free entry", () => {
  const planned = planEventTurn(
    {
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    },
    "Create a private draft event called Copy QA for Harmattan Club on January 20, 2027, 6:00–9:00 PM WAT at Harmattan Club in Lagos. Write a brief description using only those details, show it and ask me to confirm. Do not publish.",
    {
      now: new Date("2026-10-29T18:00:00-04:00"),
      timezone: "America/New_York",
      activeBrand: {
        id: "33550000-0000-4000-a000-000000000002",
        name: "Harmattan Club",
      },
      originMessageId: "message-event-shared-meridiem",
      taskId: "task-event-shared-meridiem",
      questionId: "question-event-shared-meridiem",
    },
  );

  assertEquals(planned.proposal?.tool_name, "create_event");
  assertEquals(planned.proposal?.tool_args.timezone, "Africa/Lagos");
  assertEquals(
    planned.proposal?.tool_args.start_at,
    "2027-01-20T17:00:00.000Z",
  );
  assertEquals(planned.proposal?.tool_args.end_at, "2027-01-20T20:00:00.000Z");
  assertMatch(planned.text, /6:00 PM WAT[\s\S]*9:00 PM WAT/);
  assertMatch(
    String(planned.proposal?.tool_args.description),
    /6:00 PM to 9:00 PM/,
  );
  assert(!/\bfree\b/i.test(String(planned.proposal?.tool_args.description)));
});

Deno.test("#3355 event titles exclude the active brand and parenthetical event style", () => {
  const planned = planEventTurn(
    {
      schema_version: 1,
      status: "idle",
      active_task: null,
      interruption_stack: [],
      pending_question: null,
      last_completed_step: null,
    },
    "Create an event called Afterglow Sessions for Lantern Room (live jazz) on December 5, 2026 at 7:30 PM America/New_York. Keep it as a draft.",
    {
      now: new Date("2026-10-29T18:00:00-04:00"),
      timezone: "America/New_York",
      activeBrand: {
        id: "33550000-0000-4000-a000-000000000003",
        name: "Lantern Room",
      },
      originMessageId: "message-brand-title-boundary",
      taskId: "task-brand-title-boundary",
      questionId: "question-brand-title-boundary",
    },
  );

  assertEquals(planned.proposal?.tool_name, "create_event");
  assertEquals(planned.proposal?.tool_args.title, "Afterglow Sessions");
  assertEquals(planned.proposal?.tool_args.timezone, "America/New_York");
  assertEquals(
    planned.proposal?.tool_args.start_at,
    "2026-12-06T00:30:00.000Z",
  );
});

Deno.test("#3355 general planning language does not become an event workflow", () => {
  assertEquals(
    isCreateEventPlanningRequest(
      "Show me a plan for improving Harmattan Club this week.",
    ),
    false,
  );
  assertEquals(
    isCreateEventPlanningRequest("Plan a live show for Friday."),
    true,
  );
  assertEquals(
    isCreateEventPlanningRequest("Create an event for Friday."),
    true,
  );
  assertEquals(
    isCreateEventPlanningRequest(
      "For Harmattan Club, build a complete launch plan. First show me the steps and identify what is missing.",
    ),
    false,
  );
  assertEquals(
    isCreateEventPlanningRequest(
      "Help me set up Harmattan House in Lagos. Its business is rooftop music. I have a logo and event flyer to add later.",
    ),
    false,
  );
  assertEquals(
    isCreateEventPlanningRequest(
      "Set up an event from the flyer for November 15.",
    ),
    true,
  );
});

Deno.test("#3355 narrow product questions use canonical reads instead of model guesses", () => {
  const brandId = "33550000-0000-4000-a000-000000000001";
  assertEquals(
    ariDeterministicReadPlan("Existing brand with admin invite", brandId),
    {
      intent: "existing_brands",
      calls: [{ name: "list_brands", args: { limit: 20 } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Owner invitation not found", brandId),
    {
      intent: "brand_team",
      calls: [{ name: "list_brand_team", args: { brand_id: brandId } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan("Naira bookable class", brandId),
    {
      intent: "listing_capabilities",
      calls: [{
        name: "get_listing_type_capabilities",
        args: { listing_type: "experience" },
      }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan(
      "What market pricing rules apply to a Lagos event when I manage it from a New York device?",
      brandId,
    ),
    {
      intent: "market_rules",
      calls: [{ name: "get_market_rules", args: { country_code: "NG" } }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan(
      "Create a private Lagos trip draft. Do not invent the price; ask for missing details and show it for confirmation.",
      brandId,
    ),
    null,
    "price constraints on a trip write must not become a market-rules-only completion",
  );
  assertEquals(
    ariDeterministicReadPlan(
      "Create a Lagos experience draft; do not invent its price or exact venue.",
      brandId,
    ),
    null,
    "experience creation must remain on the write-planning path",
  );
  assertEquals(
    ariDeterministicReadPlan(
      "Add a private Lagos venue listing; do not invent its location or fees.",
      brandId,
    ),
    null,
    "venue creation must not be swallowed by the market-rules read",
  );
  assertEquals(
    ariDeterministicReadPlan(
      "For the private trip draft Codex QA Local Trip, set the dates to January 8–10, 2027 in Africa/Lagos and guest capacity to 20. Do not invent a price.",
      brandId,
    ),
    null,
    "trip field updates must not be swallowed by the market-rules read",
  );
  assertEquals(
    ariDeterministicReadPlan("Flyer 1 PM vs text 2–10 PM", brandId),
    {
      intent: "listing_candidates",
      calls: [{
        name: "extract_listing_candidates",
        args: {
          text: "Flyer 1 PM",
          source_label: "supplied material",
          comparison_text: "text 2–10 PM",
          comparison_label: "message text",
        },
      }],
    },
  );
  assertEquals(
    ariDeterministicReadPlan(
      "Help me set up Harmattan House in Lagos. Its business is rooftop music. I have a logo and event flyer to add later.",
      brandId,
    ),
    null,
  );
  assertEquals(
    ariDeterministicReadPlan("Read the flyer for the event date", brandId)
      ?.intent,
    "listing_candidates",
  );
});

Deno.test("#3355 canonical product reads become concise public replies without model calls", () => {
  const plan = ariDeterministicReadPlan(
    "Per-hour charter rate card",
    "33550000-0000-4000-a000-000000000001",
  );
  assert(plan !== null);
  const reply = buildAriDeterministicReadReply(
    plan,
    [{
      tool: "get_listing_type_capabilities",
      args: { listing_type: "experience" },
      result: {
        listing_type: "experience",
        schedule: ["single", "open_hours"],
        commerce: ["person", "time_block"],
        location: ["single", "per_stop"],
      },
      elapsedMs: 2,
    }],
    "Harmattan Club",
  );
  assertMatch(reply ?? "", /experience capabilities/i);
  assertMatch(reply ?? "", /time block/i);
  assertMatch(reply ?? "", /Nothing was created or changed/);
});

Deno.test("#3355 saved event readback uses canonical date and timezone", () => {
  const brandId = "33550000-0000-4000-a000-000000000001";
  const plan = ariDeterministicReadPlan(
    "Read back the saved draft details, including the weekday and full year.",
    brandId,
    "Golden Hour Social",
  );
  assertEquals(plan, {
    intent: "saved_event",
    calls: [{
      name: "list_events",
      args: { brand_id: brandId, upcoming_only: false, limit: 50 },
    }],
    targetTitle: "Golden Hour Social",
  });
  assertEquals(
    ariDeterministicReadPlan(
      "Add one $25 ticket tier with capacity for 80 to Afterglow Sessions. Ask me to confirm before saving it, and keep the event unpublished.",
      brandId,
    ),
    null,
    "A write request that mentions confirmation must not be mistaken for a saved-event readback",
  );
  assertEquals(
    ariDeterministicReadPlan(
      "For the saved private draft ‘Afterglow Sessions’ on Lantern Room, add one General Admission ticket tier at USD 25 with capacity 80. Keep the event unpublished. Show me the exact tier details and ask me to confirm before saving.",
      brandId,
    ),
    null,
    "A request to show ticket proposal details must not be mistaken for an event listing",
  );
  const reply = buildAriDeterministicReadReply(
    plan!,
    [{
      tool: "list_events",
      args: { brand_id: brandId, upcoming_only: false },
      result: {
        events: [{
          title: "Golden Hour Social",
          status: "draft",
          visibility: "draft",
          timezone: "Africa/Lagos",
          location_text: "Harmattan House, Lagos",
          when: {
            date: "2026-11-15",
            doorsOpen: "18:00",
            endsAt: "23:00",
            timezone: "Africa/Lagos",
          },
        }],
      },
      elapsedMs: 2,
    }],
    "Harmattan House",
  );
  assertMatch(reply ?? "", /Sunday, November 15, 2026/);
  assertMatch(reply ?? "", /6:00 PM–11:00 PM WAT/);
  assertMatch(reply ?? "", /Venue: Harmattan House, Lagos/);
  assertMatch(reply ?? "", /not published/i);
  assert(!/Friday/.test(reply ?? ""));
});

Deno.test("#3355 launch readiness resolves the recently named event", () => {
  const title = findAriRecentEventTitle([
    "Create an event called Afterglow Sessions for Lantern Room (live jazz) on December 5, 2026.",
    "Add a General Admission tier to the saved private draft ‘Afterglow Sessions’.",
  ]);
  assertEquals(title, "Afterglow Sessions");
  const reply = buildAriDeterministicReadReply(
    {
      intent: "event_list",
      calls: [{
        name: "list_events",
        args: { brand_id: "brand-a", upcoming_only: false, limit: 50 },
      }],
      targetTitle: title ?? undefined,
    },
    [{
      tool: "list_events",
      args: {},
      result: {
        events: [
          { title: "Another Event", status: "live" },
          {
            title: "Afterglow Sessions",
            status: "draft",
            timezone: "America/New_York",
            when: {
              date: "2026-12-05",
              doorsOpen: "19:30",
              endsAt: "21:30",
              timezone: "America/New_York",
            },
          },
        ],
      },
      elapsedMs: 1,
    }],
    "Lantern Room",
  );
  assertMatch(reply ?? "", /Afterglow Sessions/);
  assertMatch(reply ?? "", /Draft — not published/);
  assert(!reply?.includes("Another Event"));
});

Deno.test("#3355 event listings use canonical local times and never call drafts live", () => {
  const brandId = "33550000-0000-4000-a000-000000000001";
  const plan = ariDeterministicReadPlan(
    "List my events for Harmattan Club. Show the event title and date for each one.",
    brandId,
  );
  assertEquals(plan?.intent, "event_list");
  assertEquals(plan?.calls, [{
    name: "list_events",
    args: { brand_id: brandId, upcoming_only: false, limit: 50 },
  }]);
  const reply = buildAriDeterministicReadReply(
    plan!,
    [{
      tool: "list_events",
      args: { brand_id: brandId, upcoming_only: false },
      result: {
        events: [{
          title: "Seth Is Popping",
          status: "draft",
          visibility: "draft",
          timezone: "Africa/Lagos",
          location_text: "Harmattan Club in Lagos",
          when: {
            date: "2026-11-15",
            doorsOpen: "18:00",
            endsAt: "23:00",
            timezone: "Africa/Lagos",
          },
        }],
      },
      elapsedMs: 2,
    }],
    "Harmattan Club",
  );
  assertMatch(reply ?? "", /Sunday, November 15, 2026/);
  assertMatch(reply ?? "", /6:00 PM–11:00 PM WAT/);
  assertMatch(reply ?? "", /Draft — not published/);
  assertMatch(reply ?? "", /Harmattan Club in Lagos/);
  assertEquals(reply?.includes("scheduled to be live"), false);
});

Deno.test("#3355 sensitive and invalid media inputs use deterministic safe copy", () => {
  const bank = ariDeterministicSafetyReply("Bank number typed in chat") ?? "";
  assertMatch(bank, /protected payout setup/i);
  assert(!/\d{6,}/.test(bank));
  const ambiguous = ariDeterministicSafetyReply(
    "Bank-like number offered as phone",
  ) ?? "";
  assertMatch(ambiguous, /won’t save or repeat/i);
  const video = ariDeterministicSafetyReply("Eighty-two second host video") ??
    "";
  assertMatch(video, /15-second limit/i);
  assertMatch(video, /did not upload or change/i);
});

Deno.test("#3355 local model lane is explicit and loopback-only", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  const originalBase = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL");
  const originalModel = Deno.env.get("ARI_LOCAL_MODEL_ID");
  let wireModel = "";
  let wireContext = 0;
  const requestSignals: AbortSignal[] = [];
  try {
    Deno.env.set("ARI_LOCAL_MODEL_ENABLED", "true");
    Deno.env.set(
      "ARI_LOCAL_MODEL_BASE_URL",
      "http://host.docker.internal:11434",
    );
    Deno.env.set("ARI_LOCAL_MODEL_ID", "qwen3:4b-instruct");
    globalThis.fetch = async (input, init) => {
      assertEquals(String(input), "http://host.docker.internal:11434/api/chat");
      requestSignals.push(init?.signal as AbortSignal);
      wireModel = String(
        (JSON.parse(String(init?.body)) as Record<string, unknown>).model ?? "",
      );
      wireContext = Number(
        ((JSON.parse(String(init?.body)) as Record<string, unknown>)
          .options as Record<string, unknown>)?.num_ctx ?? 0,
      );
      return new Response(
        JSON.stringify({
          message: { content: "I will show the plan before any changes." },
          done_reason: "stop",
          prompt_eval_count: 15,
          eval_count: 8,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await callGemini({
      systemPrompt: "Act safely.",
      contents: [{ role: "user", parts: [{ text: "Plan the launch." }] }],
      tools: [],
    });
    assertEquals(
      result.textResponse,
      "I will show the plan before any changes.",
    );
    assertEquals(result.usage.total_tokens, 23);
    assertEquals(wireModel, "qwen3:4b-instruct");
    // [TEST-MOD-APPROVED #2830] A live Website setup plan needs 32K context.
    assertEquals(wireContext, 32_768);
    assertEquals(ARI_LOCAL_MODEL_REQUEST_TIMEOUT_MS, 100_000);
    assertEquals(requestSignals.length, 1);
    assert(requestSignals[0] instanceof AbortSignal);
    assertEquals(requestSignals[0].aborted, false);

    Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", "https://example.com");
    let refused = false;
    try {
      await callGemini({
        systemPrompt: "Act safely.",
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        tools: [],
      });
    } catch (error) {
      refused = error instanceof Error && error.message.includes("loopback");
    }
    assert(refused, "external local-model endpoints must be refused");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) {
      Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    } else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", originalEnabled);
    if (originalBase === undefined) Deno.env.delete("ARI_LOCAL_MODEL_BASE_URL");
    else Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", originalBase);
    if (originalModel === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ID");
    else Deno.env.set("ARI_LOCAL_MODEL_ID", originalModel);
  }
});

Deno.test("#3355 local model refuses unsupported media instead of silently dropping it", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  const originalBase = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL");
  let fetchCalled = false;
  try {
    Deno.env.set("ARI_LOCAL_MODEL_ENABLED", "true");
    Deno.env.set(
      "ARI_LOCAL_MODEL_BASE_URL",
      "http://host.docker.internal:11434",
    );
    globalThis.fetch = () => {
      fetchCalled = true;
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    };

    let rejected: unknown;
    try {
      await callGemini({
        systemPrompt: "Inspect only evidence you received.",
        contents: [{
          role: "user",
          parts: [
            { text: "Summarize this voice note." },
            {
              inlineData: {
                mimeType: "audio/mp4",
                data: "c3ludGhldGljLWF1ZGlv",
              },
            },
          ],
        }],
        tools: [],
      });
    } catch (error) {
      rejected = error;
    }

    assertEquals(fetchCalled, false);
    assertEquals((rejected as { kind?: string })?.kind, "unsupported_input");
    assertMatch(
      (rejected as Error)?.message ?? "",
      /can’t read this attachment type/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) {
      Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    } else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", originalEnabled);
    if (originalBase === undefined) Deno.env.delete("ARI_LOCAL_MODEL_BASE_URL");
    else Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", originalBase);
  }
});

Deno.test("#3355 quality detector opens a case when Ari pursues the wrong goal", () => {
  const signals = detectAriQualitySignals({
    userId: "user-a",
    conversationId: "conversation-a",
    userText: "Show me a plan for improving Harmattan Club this week.",
    assistantText:
      "For Harmattan Club, I’ve kept the event direction you shared. What future date and time should I use?",
  });
  assert(signals.includes("intent_mismatch"));

  const realEvent = detectAriQualitySignals({
    userId: "user-a",
    conversationId: "conversation-b",
    userText: "Plan a dinner event and ask me for the date and time.",
    assistantText: "What future date and time should I use?",
  });
  assert(!realEvent.includes("intent_mismatch"));
});

Deno.test("#3355 unsupported requests aggregate into privacy-safe capability gaps", () => {
  const social = inferAriCapabilityGap(
    "Can you inspect https://instagram.com/example and compare it with our page?",
  );
  assertEquals(social.capabilityKey, "research.public_social");
  const unknown = inferAriCapabilityGap(
    "Email me at host@example.com and invent a capability we have never seen.",
  );
  assertMatch(unknown.capabilityKey, /^request\.[0-9a-f]{8}$/);
  assert(!unknown.exampleRequest.includes("host@example.com"));
});

Deno.test("#3355 multiword capability search ranks intent instead of one shared word", () => {
  const matches = searchAriCapabilities("tag waiters order");
  assert(matches.some((match) => match.name === "manage_venue_waitlist"));
  assert(!matches.some((match) => match.name === "cancel_order"));
  assert(!matches.some((match) => match.name === "delete_trip"));
  assert(
    !matches.some((match) => match.name === "get_event_order_reconciliation"),
  );
});

Deno.test("#3355 loop executes bounded reads then stops at the first write", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    callModel: async (observations) => {
      modelCalls += 1;
      return observations.length === 0
        ? {
          toolCalls: [{ name: "inspect", args: { id: "one" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }
        : {
          toolCalls: [{ name: "publish", args: { id: "one" } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        };
    },
    classifyTool: (call) => call.name === "inspect" ? "read" : "write",
    executeTool: async (call) => {
      executed.push(call.name);
      return { canonical: true };
    },
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.name, "publish");
  assertEquals(executed, ["inspect"]);
  assertEquals(modelCalls, 2);
  assertEquals(result.observations[0].result, { canonical: true });
});

Deno.test("#3355 loop returns proposal validation errors for one bounded repair", async () => {
  let modelCalls = 0;
  const result = await runAgentLoop({
    callModel: async (observations) => {
      modelCalls += 1;
      if (observations.length === 0) {
        return {
          toolCalls: [{
            name: "draft_campaign",
            args: { subject: "unverified" },
          }],
        };
      }
      assertEquals(observations[0].error?.code, "UNSUPPORTED_CAMPAIGN_CLAIM");
      return {
        toolCalls: [{ name: "draft_campaign", args: { subject: "grounded" } }],
      };
    },
    classifyTool: () => "write",
    validateProposal: (call) =>
      call.args.subject === "unverified"
        ? {
          code: "UNSUPPORTED_CAMPAIGN_CLAIM",
          message: "Remove the claim; it is not in the host's source details.",
        }
        : null,
    executeTool: async () => null,
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.args.subject, "grounded");
  assertEquals(modelCalls, 2);
  assertEquals(
    result.observations[0].error?.code,
    "UNSUPPORTED_CAMPAIGN_CLAIM",
  );
});

Deno.test("#3355 loop repairs chat-only write confirmation into the approval tool", async () => {
  const request =
    "For the saved draft ‘Midnight Practice’, add one General Admission ticket tier at NGN 25,000 with capacity 80. Keep the event unpublished. Show me the exact ticket details and ask me to confirm before saving.";
  let modelCalls = 0;
  const result = await runAgentLoop({
    callModel: async (observations) => {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          toolCalls: [],
          textResponse: "I'll add the tier. Please confirm to save it.",
        };
      }
      assertEquals(observations.at(-1)?.error?.code, "WRITE_PROPOSAL_REQUIRED");
      return {
        toolCalls: [{
          name: "upsert_ticket_tier",
          args: {
            event_id: "event-1",
            name: "General Admission",
            price_cents: 2500000,
            capacity: 80,
          },
        }],
      };
    },
    validateFinalText: (text) =>
      ticketTierTextBypassesApproval(request, text)
        ? {
          code: "WRITE_PROPOSAL_REQUIRED",
          message: "Return the protected write proposal.",
        }
        : null,
    classifyTool: () => "write",
    executeTool: async () => null,
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.name, "upsert_ticket_tier");
  assertEquals(modelCalls, 2);
  assertEquals(result.observations[0].error?.code, "WRITE_PROPOSAL_REQUIRED");
});

Deno.test("#3355 loop repairs wrong event creation into the requested ticket edit", async () => {
  const request =
    "Add an Early Bird ticket tier priced at NGN 25,000 with capacity 80 to the Harmattan Club event Midnight Practice. Show me the exact change for approval. Do not publish.";
  let modelCalls = 0;
  const result = await runAgentLoop({
    initialCalls: [{ name: "list_events", args: { brand_id: "brand-1" } }],
    callModel: async (observations) => {
      modelCalls += 1;
      if (modelCalls === 1) {
        assertEquals(observations[0]?.tool, "list_events");
        return {
          toolCalls: [{
            name: "create_event",
            args: { title: "Midnight Practice" },
          }],
        };
      }
      assertEquals(
        observations.at(-1)?.error?.code,
        "REQUESTED_TOOL_MISMATCH",
      );
      return {
        toolCalls: [{
          name: "upsert_ticket_tier",
          args: {
            event_id: "event-midnight-practice",
            name: "Early Bird",
            price_cents: 2500000,
            capacity: 80,
          },
        }],
      };
    },
    classifyTool: (call) => call.name === "list_events" ? "read" : "write",
    validateProposal: (call) =>
      ticketTierProposalMismatch(request, call.name)
        ? {
          code: "REQUESTED_TOOL_MISMATCH",
          message: "Use upsert_ticket_tier for the named existing event.",
        }
        : null,
    executeTool: async () => ({
      events: [{ id: "event-midnight-practice", title: "Midnight Practice" }],
    }),
  });
  assertEquals(result.kind, "proposal");
  if (result.kind !== "proposal") return;
  assertEquals(result.toolCall.name, "upsert_ticket_tier");
  assertEquals(modelCalls, 2);
  assertEquals(
    result.observations.at(-1)?.error?.code,
    "REQUESTED_TOOL_MISMATCH",
  );
});

Deno.test("#3355 repeated chat-only ticket confirmation stops without false completion", async () => {
  const request =
    "For the saved draft ‘Midnight Practice’, add one General Admission ticket tier at NGN 25,000 with capacity 80. Keep the event unpublished. Show me the exact ticket details and ask me to confirm before saving.";
  const result = await runAgentLoop({
    callModel: async () => ({
      toolCalls: [],
      textResponse: "I’ll add this ticket tier. Please confirm to save it.",
    }),
    validateFinalText: (text) =>
      ticketTierTextBypassesApproval(request, text)
        ? {
          code: "WRITE_PROPOSAL_REQUIRED",
          message: "Return the protected write proposal.",
        }
        : null,
    classifyTool: () => "read",
    executeTool: async () => null,
  });
  assertEquals(result.kind, "stopped");
  if (result.kind !== "stopped") return;
  assertEquals(result.reason, "errors");
  const rendition = buildAgentRunRendition({
    renditionId: "write-approval-required",
    goal: request,
    result,
  });
  assertEquals(rendition.title, "Ari reached a clear blocker");
  assert(!JSON.stringify(rendition).includes("Plan complete"));
});

Deno.test("#3355 required launch reads run before the model's first turn", async () => {
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [
      { name: "get_operator_snapshot", args: { brand_id: "brand-a" } },
      { name: "get_brand_site", args: { brand_id: "brand-a" } },
    ],
    callModel: async (observations) => {
      assertEquals(observations.map((item) => item.tool), [
        "get_operator_snapshot",
        "get_brand_site",
      ]);
      return { toolCalls: [], textResponse: "The plan is ready." };
    },
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return { canonical: true };
    },
  });
  assertEquals(result.kind, "text");
  assertEquals(executed, ["get_operator_snapshot", "get_brand_site"]);
});

Deno.test("#3355 standalone cited research completes without a redundant model pass", async () => {
  let modelCalls = 0;
  const result = await runAgentLoop({
    initialCalls: [
      {
        name: "search_public_web",
        args: { query: "Lantern Room latest events" },
      },
    ],
    completeAfterInitialReads: (observations) => {
      const result = observations[0]?.result as { answer?: string } | undefined;
      return result?.answer ?? null;
    },
    callModel: async () => {
      modelCalls += 1;
      return { toolCalls: [], textResponse: "This should not run." };
    },
    classifyTool: () => "read",
    executeTool: async () => ({
      answer: "I found two cited public pages.",
      sources: [{ url: "https://example.com" }],
    }),
  });
  assertEquals(result.kind, "text");
  if (result.kind !== "text") return;
  assertEquals(result.text, "I found two cited public pages.");
  assertEquals(result.usage.calls, 0);
  assertEquals(modelCalls, 0);
});

Deno.test("#3355 search-index shortcut never pretends it read or compared pages", () => {
  assert(
    isStandalonePublicResearchRequest(
      "Compare public sources for Lantern Room events.",
    ),
  );
  assert(
    canCompleteResearchFromSearchIndex(
      "Find public sources for Lantern Room and show citations with checked dates.",
    ),
  );
  assertEquals(
    canCompleteResearchFromSearchIndex(
      "Compare public sources for Lantern Room events and summarize the latest details.",
    ),
    false,
  );
  assertEquals(
    canCompleteResearchFromSearchIndex(
      "Search public sources for the latest Lantern Room events.",
    ),
    false,
  );
  assertEquals(
    isStandalonePublicResearchRequest(
      "Research Lantern Room and publish a new event.",
    ),
    false,
  );
});

Deno.test("#3355 premature research prose is replaced by required page reads", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [{ name: "search_public_web", args: { query: "Lantern" } }],
    callModel: async () => {
      modelCalls += 1;
      return modelCalls === 1
        ? { textResponse: "The search results are enough.", toolCalls: [] }
        : {
          textResponse: "I read the official page and found no named event.",
          toolCalls: [],
        };
    },
    recoverReadsFromPrematureText: (_text, observations) =>
      observations.some((item) => item.tool === "read_public_url") ? [] : [{
        name: "read_public_url",
        args: { url: "https://example.com/events" },
      }],
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return call.name === "search_public_web"
        ? { sources: [{ url: "https://example.com/events" }] }
        : { content: "No upcoming event is named." };
    },
  });
  assertEquals(result.kind, "text");
  if (result.kind === "text") {
    assertEquals(
      result.text,
      "I read the official page and found no named event.",
    );
  }
  assertEquals(modelCalls, 2);
  assertEquals(executed, ["search_public_web", "read_public_url"]);
});

Deno.test("#3355 search discovery expands into page reads before reasoning", async () => {
  let modelCalls = 0;
  const executed: string[] = [];
  const result = await runAgentLoop({
    initialCalls: [{ name: "search_public_web", args: { query: "Lantern" } }],
    expandInitialReads: (observations) => {
      assertEquals(observations[0]?.tool, "search_public_web");
      return [{
        name: "read_public_url",
        args: { url: "https://example.com/events" },
      }];
    },
    callModel: async (observations) => {
      modelCalls += 1;
      assertEquals(
        observations.map((item) => item.tool),
        ["search_public_web", "read_public_url"],
      );
      return {
        textResponse: "The official page names one upcoming event.",
        toolCalls: [],
      };
    },
    classifyTool: () => "read",
    executeTool: async (call) => {
      executed.push(call.name);
      return call.name === "search_public_web"
        ? { sources: [{ url: "https://example.com/events" }] }
        : { content: "The Maker's Table — June 17, 2026." };
    },
  });
  assertEquals(result.kind, "text");
  assertEquals(modelCalls, 1);
  assertEquals(executed, ["search_public_web", "read_public_url"]);
});

Deno.test("#3355 completed readbacks survive an unavailable reasoning model", async () => {
  const result = await runAgentLoop({
    initialCalls: [
      { name: "get_operator_snapshot", args: { brand_id: "brand-a" } },
    ],
    callModel: () => {
      throw new Error("The local Ari model returned no usable content.");
    },
    classifyTool: () => "read",
    executeTool: async () => ({ selected_brand: { name: "Harmattan Club" } }),
  });
  assertEquals(result.kind, "stopped");
  if (result.kind !== "stopped") return;
  assertEquals(result.reason, "errors");
  assertEquals(result.observations[0].tool, "get_operator_snapshot");
  assertEquals(result.observations[1].error?.code, "MODEL_UNAVAILABLE");
});

Deno.test("#3355 loop treats a recoverable tool failure as an observation", async () => {
  const result = await runAgentLoop({
    callModel: async (observations) =>
      observations.length === 0
        ? { toolCalls: [{ name: "primary", args: {} }] }
        : {
          toolCalls: [],
          textResponse: "The primary source failed, so I stopped.",
        },
    classifyTool: () => "read",
    executeTool: () => {
      throw new Error("upstream unavailable");
    },
    normalizeError: () => ({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Public source unavailable.",
      recoverable: true,
    }),
  });
  assertEquals(result.kind, "text");
  assertEquals(result.observations[0].error?.code, "UPSTREAM_UNAVAILABLE");
});

Deno.test("#3355 loop preserves the useful plan after two independent read failures", async () => {
  const result = await runAgentLoop({
    callModel: async (observations) =>
      observations.length === 0
        ? {
          toolCalls: [
            { name: "search_public_web", args: { query: "Harmattan Club" } },
            { name: "read_public_url", args: { url: "https://example.com" } },
          ],
        }
        : {
          toolCalls: [],
          textResponse:
            "Here is the launch plan from Mingla. I could not verify public sources, so public presence remains an evidence gap.",
        },
    classifyTool: () => "read",
    executeTool: () => {
      throw new Error("upstream unavailable");
    },
    normalizeError: () => ({
      code: "UPSTREAM_UNAVAILABLE",
      message: "Public source unavailable.",
      recoverable: true,
    }),
  });
  assertEquals(result.kind, "text");
  assertEquals(result.observations.length, 2);
});

Deno.test("#3355 loop enforces the safe tool budget", async () => {
  const result = await runAgentLoop({
    budget: { maxSteps: 5, maxModelCalls: 5, maxToolCalls: 1 },
    callModel: async () => ({
      toolCalls: [
        { name: "read_one", args: {} },
        { name: "read_two", args: {} },
      ],
    }),
    classifyTool: () => "read",
    executeTool: async () => ({ ok: true }),
  });
  assertEquals(result.kind, "stopped");
  if (result.kind === "stopped") assertEquals(result.reason, "budget");
  assertEquals(result.observations.length, 1);
});

Deno.test("#3355 strict archive sanitization removes identity and credentials", () => {
  const value = sanitizeAriText(
    "Email seth@example.com phone +1 (212) 555-0100 token=secret123 https://x.test/?signature=abc",
  );
  assertMatch(value.text, /\[email removed\]/);
  assertMatch(value.text, /\[phone removed\]/);
  assertMatch(value.text, /token=\[removed\]/);
  assertMatch(value.text, /signature=\[removed\]/);
  assert(!value.text.includes("seth@example.com"));
});

Deno.test("#3355 strict archive sanitization preserves freshness dates", () => {
  const value = sanitizeAriText(
    "The Lantern Room, Monterey, CA (2026) (2026-10-29); fetched 2026-10-30T14:05:00Z; call +1 (212) 555-0100.",
  );
  assert(value.text.includes("(2026) (2026-10-29)"));
  assert(value.text.includes("2026-10-29"));
  assert(value.text.includes("2026-10-30T14:05:00Z"));
  assert(value.text.includes("[phone removed]"));
  assertEquals(
    value.findings.filter((finding) => finding === "phone").length,
    1,
  );
});

Deno.test("#3355 public research preserves public facts but removes secrets", () => {
  const value = sanitizeAriPublicText(
    "Contact tickets@example.com at +44 20 7946 0958; api_key=private; https://x.test/?token=abc",
  );
  assert(value.text.includes("tickets@example.com"));
  assert(value.text.includes("+44 20 7946 0958"));
  assertMatch(value.text, /api_key=\[removed\]/);
  assertMatch(value.text, /token=\[removed\]/);
});

Deno.test("#3355 structured sanitization drops bank and auth fields", () => {
  assertEquals(
    sanitizeAriValue({
      bank: "123456789",
      Authorization: "Bearer private",
      nested: { email: "host@example.com" },
    }),
    {
      bank: "[removed]",
      Authorization: "[removed]",
      nested: { email: "[email removed]" },
    },
  );
});

Deno.test("#3355 copy lint refuses unsourced research and sensitive success copy", () => {
  const research = lintAriCopy("I compared the profiles.", {
    researchExpected: true,
    hasSources: false,
  });
  assert(research.violations.includes("UNSOURCED_RESEARCH"));
  const secret = lintAriCopy(
    "Bank account 123456789 was successfully created for you.",
  );
  assert(secret.violations.includes("BANK_DIGITS"));
  assert(secret.violations.includes("UNVERIFIED_SUCCESS"));

  const honestGap = lintAriCopy(
    "Here is the plan from Mingla. I could not verify any usable public sources, so public presence remains unverified.",
    { researchExpected: true, hasSources: false },
  );
  assert(!honestGap.violations.includes("UNSOURCED_RESEARCH"));
});

Deno.test("#3355 toolsets are inferred and capped without losing core tools", () => {
  const keys = inferAriToolsets(
    "Research Instagram, import my people CSV, launch our website, and create an event",
  );
  assert(keys.includes("research"));
  assert(keys.includes("people"));
  assert(keys.includes("sites"));
  assert(keys.includes("listings"));
  const tools = [
    "list_brands",
    "request_tools",
    "search_public_web",
    "manage_brand_people",
    "get_brand_site",
  ].map((name) => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    requiredRole: "self",
    resource: "none",
    executor: async () => null,
  })) satisfies AgentTool[];
  const selected = selectAriTools(tools, keys, 8).map((tool) => tool.name);
  assert(selected.includes("request_tools"));
  assert(selected.includes("search_public_web"));
  assert(selected.includes("manage_brand_people"));
  assert(selected.includes("get_brand_site"));

  const launchGoal =
    "For Harmattan Club, build a complete launch plan from the business information already in Mingla, research our public presence, and do not change anything.";
  const launchTools = selectAriTools(
    AGENT_TOOLS,
    inferAriToolsets(launchGoal),
    12,
    launchGoal,
  ).map((tool) => tool.name);
  assertEquals(launchTools.length, 12);
  for (
    const required of [
      "get_operator_snapshot",
      "get_brand_site",
      "search_public_web",
      "read_public_url",
    ]
  ) {
    assert(
      launchTools.includes(required),
      `${required} should stay discoverable`,
    );
  }
});

Deno.test("#3355 compact tool routing prioritizes directly requested write capabilities", () => {
  const tripRequest =
    "Set up a 3-day trip for Harmattan House, starting November 15, 2026. Draft only.";
  const tripTools = selectAriTools(
    AGENT_TOOLS,
    inferAriToolsets(tripRequest),
    12,
    tripRequest,
  ).map((tool) => tool.name);
  for (
    const required of [
      "create_trip",
      "manage_trip_days",
      "manage_trip_tiers",
    ]
  ) {
    assert(
      tripTools.includes(required),
      `${required} must fit in the compact trip tool window`,
    );
  }
  assert(!tripTools.includes("list_trip_installments"));
  assert(!tripTools.includes("get_trip_order_money"));

  // A follow-up can omit the word "trip" while still clearly asking for its
  // package. Brand currency must not crowd the trip-tier writer out.
  const packageRequest =
    "Set one per-person package at ₦180000. Use the brand currency and do not add instalments.";
  const packageTools = selectAriTools(
    AGENT_TOOLS,
    inferAriToolsets(packageRequest),
    12,
    packageRequest,
  ).map((tool) => tool.name);
  assert(packageTools.includes("manage_trip_tiers"));
  assert(!packageTools.includes("manage_brand_discovery_currency"));
  assert(!packageTools.includes("manage_brand_people"));

  const eventRequest =
    "Create an event called Golden Hour Social on November 15, 2026.";
  const eventTools = selectAriTools(
    AGENT_TOOLS,
    inferAriToolsets(eventRequest),
    12,
    eventRequest,
  ).map((tool) => tool.name);
  assert(eventTools.includes("create_event"));
});

Deno.test("#3355 event and trip guest capacity does not load team-management tools", () => {
  const tripRequest =
    "For this trip, set one per-person package at ₦15,000 with capacity for 120 guests.";
  const keys = inferAriToolsets(tripRequest);
  assert(keys.includes("listings"));
  assert(!keys.includes("people"));

  const guestListKeys = inferAriToolsets(
    "Show me the guest list for this trip",
  );
  assert(guestListKeys.includes("people"));
});

Deno.test("#3355 future onboarding materials do not trigger event or order tools", () => {
  const request =
    "Help me set up Harmattan House in Lagos. Its business is rooftop music. I have a logo and event flyer to add later.";
  assert(needsAriOnboardingSetupRead(request));
  const keys = inferAriToolsets(request);
  assert(keys.includes("onboarding"));
  assert(!keys.includes("listings"));
  const tools = selectAriTools(
    AGENT_TOOLS,
    ["core", "brand", "onboarding"],
    12,
    request,
  )
    .map((tool) => tool.name);
  assert(tools.includes("get_onboarding_plan"));
  assert(tools.includes("build_host_onboarding_blueprint"));
  assert(!tools.includes("list_event_orders"));
  assert(!tools.includes("get_event_order_reconciliation"));
  assert(!tools.includes("create_event"));
  assert(!needsAriOnboardingSetupRead("Create an event for the brand"));
  assert(needsAriOnboardingSetupRead("Help me launch my business"));
  assert(
    !needsAriOnboardingSetupRead(
      "Update the saved campaign draft title to Golden Hour Social — Lagos launch. Keep the approved message content and do not schedule it.",
    ),
  );
  assert(isAriOnboardingPlanProgressMessage(
    "Use NGN and Africa/Lagos. Mark the logo and flyer as still needed.",
  ));
  assert(!isAriOnboardingPlanProgressMessage("Create an event for Friday"));
  assert(!isAriOnboardingPlanProgressMessage(
    "Continue the saved trip setup. Set dates in Africa/Lagos and set guest capacity to 20.",
  ));
  const setupTools = selectAriOnboardingSetupTools(AGENT_TOOLS).map((tool) =>
    tool.name
  );
  assertEquals(setupTools, [
    "get_operator_snapshot",
    "get_onboarding_plan",
    "update_onboarding_plan",
    "get_market_rules",
    "build_host_onboarding_blueprint",
  ]);
  const progressCall = buildAriOnboardingSetupPlanCall({
    text: request,
    brandId: "c2c45be0-edbf-4b7c-aa5d-84b5c37fb3f9",
    brandName: "Harmattan House",
    existingPlan: {
      revision: 3,
      state: {
        owner_provided_details: ["Earlier detail"],
        steps: [{
          key: "brand",
          title: "Create or select the brand",
          status: "completed",
        }],
      },
    },
    hasAttachments: false,
  });
  assertEquals(progressCall.name, "update_onboarding_plan");
  assertEquals(progressCall.args.expected_revision, 3);
  const patch = progressCall.args.patch as Record<string, unknown>;
  assertEquals(patch.future_materials, ["logo", "event flyer"]);
  assertEquals(patch.owner_provided_details, ["Earlier detail", request]);
  const setupReply = buildAriOnboardingSetupReply([
    {
      tool: "update_onboarding_plan",
      args: {},
      result: { state: patch },
      elapsedMs: 0,
    },
  ], "Harmattan House");
  assert(setupReply?.includes("private onboarding checklist"));
  assert(setupReply?.includes("Location: Lagos"));
  assert(setupReply?.includes("Business type: rooftop music"));
  assert(setupReply?.includes("not attached or inspected"));
  assert(setupReply?.includes("unchanged"));
});

Deno.test("#3355 broad host promotion goals discover capabilities before reasoning", () => {
  assert(needsAriCapabilityDiscovery("Host promotion plan"));
  assert(needsAriCapabilityDiscovery("Build a marketing plan for this brand"));
  assert(!needsAriCapabilityDiscovery("Create an event called Autumn Table"));
  const selected = selectAriTools(AGENT_TOOLS, ["core", "marketing"], 8);
  assert(selected.some((tool) => tool.name === "search_capabilities"));
  const plan = buildAriCapabilityPlan(
    "Host promotion plan",
    "Harmattan Club",
    ["propose_ad_plan", "get_ad_campaign_report", "create_discount"],
  );
  assert(plan?.includes("practical promotion plan for Harmattan Club"));
  assert(plan?.includes("Nothing has been created, published or charged"));
  assert(!plan?.includes("propose_ad_plan"));
});

Deno.test("#3355 capability questions answer from relevant search matches", () => {
  const answer = buildAriCapabilityPlan(
    "What can Ari do to manage brand opening hours?",
    "Harmattan Club",
    [{
      name: "manage_brand_hours",
      description: "Read or update a brand venue's opening hours.",
    }],
  );
  assert(answer?.includes("Harmattan Club's venue opening hours"));
  assert(answer?.includes("complete seven-day schedule"));
  assert(answer?.includes("your approval"));
  assert(!answer?.includes("promotion plan"));
  assert(!answer?.includes("manage_brand_hours"));
});

Deno.test("#3355 terse continuation requests read the durable onboarding plan", () => {
  assert(needsAriOnboardingResumeRead("Next steps after accepting"));
  assert(needsAriOnboardingResumeRead("Greeting after silence resumes plan"));
  assert(!needsAriOnboardingResumeRead("Create an event called Autumn Table"));
  const noPlan = buildAriOnboardingResumeReply(null, "Harmattan Club");
  assert(noPlan.includes("no active plan to resume"));
  const resumed = buildAriOnboardingResumeReply({
    state: {
      steps: [
        { id: "brand_profile", status: "completed" },
        { id: "first_offering", status: "pending" },
      ],
    },
  }, "Harmattan Club");
  assert(resumed.includes("first offering"));
  assert(resumed.includes("will not repeat completed work"));
});

Deno.test("#3355 onboarding stays on the selected brand and treats future materials as absent", () => {
  assertEquals(PROMPT_VERSION, "v27");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  for (
    const phrase of [
      "ONBOARDING RULES:",
      "Do not create a duplicate brand when an existing brand is selected.",
      "CAMPAIGN DRAFT RULES:",
      "Do not invent event features, artists, past attendance, repeat editions, discounts, priority access, scarcity or results.",
      "said to be added later is not an attachment and has not been inspected.",
      "Save the host's stated setup progress in the versioned onboarding plan.",
    ]
  ) assert(prompt.includes(phrase), `missing onboarding rule: ${phrase}`);
});

Deno.test("#3355 campaign review reads brand performance and excludes wrong campaign reports", () => {
  const request = "Look at what has worked recently, then draft a campaign.";
  assert(needsAriCampaignWorkflow(request));
  assert(needsAriCampaignPerformanceRead(request));
  assert(
    !needsAriCampaignPerformanceRead(
      "Review the saved campaign draft against the goal and audience.",
    ),
  );
  assert(!needsAriCampaignWorkflow("Read the report for campaign 123"));
  const tools = selectAriCampaignWorkflowTools(AGENT_TOOLS).map((tool) =>
    tool.name
  );
  assertEquals(tools, [
    "draft_campaign",
    "update_campaign_draft",
    "get_brand_analytics",
    "get_campaign_draft",
  ]);
  assert(!tools.includes("get_campaign_report"));
});

Deno.test("#3355 campaign draft review reads the last saved draft and quotes canonical copy", () => {
  const campaignId = "ae01ca3d-65d9-4e7d-9db4-617abfbd2490";
  assert(needsAriCampaignDraftReview(
    "Review the saved campaign draft against the goal and audience.",
  ));
  assertEquals(
    findAriCampaignDraftId([
      {
        role: "tool",
        tool_results: {
          tool_name: "draft_campaign",
          result: { id: campaignId },
        },
      },
      {
        role: "assistant",
        tool_calls: {
          tool_name: "update_campaign_draft",
          args: { campaign_id: campaignId },
        },
      },
    ]),
    campaignId,
  );
  assertEquals(
    findAriCampaignDraftId([{
      role: "assistant",
      tool_calls: {
        tool_name: "update_campaign_draft",
        args: { campaign_id: "not-a-uuid" },
      },
    }]),
    null,
  );
  const plan = ariDeterministicReadPlan(
    "Review the saved campaign draft against the goal and audience.",
    "11111111-1111-4111-8111-111111111111",
    null,
    false,
    campaignId,
  );
  assertEquals(plan?.calls[0], {
    name: "get_campaign_draft",
    args: { campaign_id: campaignId },
  });
  assertEquals(
    buildAriDeterministicReadReply(plan!, [{
      tool: "get_campaign_draft",
      args: { campaign_id: campaignId },
      result: {
        id: campaignId,
        name: "Golden Hour Social — Lagos launch",
        status: "draft",
        channel: "email",
        channel_payload: {
          subject: "Golden Hour Social — early-bird access",
          body_text: "Join Harmattan House for Golden Hour Social.",
          body_html: "<p>Join Harmattan House for Golden Hour Social.</p>",
        },
      },
      elapsedMs: 1,
    }], "Harmattan House"),
    "I verified the saved email campaign draft for Harmattan House: “Golden Hour Social — Lagos launch”. Subject: Golden Hour Social — early-bird access. Message: Join Harmattan House for Golden Hour Social. Status: draft. It has not been scheduled or sent.",
  );
});

Deno.test("#3355 every active scenario's required capability exists in the real registry", () => {
  const registered = new Set(AGENT_TOOLS.map((tool) => tool.name));
  const scenarios = ARI_EVAL_SCENARIOS as unknown as Array<{
    id: string;
    status: string;
    expected: { required_tools?: string[] };
  }>;
  const missing = scenarios.flatMap(
    (scenario) =>
      scenario.status === "active"
        ? (scenario.expected.required_tools ?? [])
          .filter((name) => !registered.has(name))
          .map((name) => `${scenario.id}:${name}`)
        : [],
  );
  assertEquals(missing, []);
});

Deno.test("#3355 onboarding blueprint covers launch, verification and handover", async () => {
  const tool = findTool("build_host_onboarding_blueprint");
  assert(tool);
  const result = await tool.executor(
    {
      goal: "Set up Lantern Room from its flyer and voice note",
      mode: "self_serve",
      materials: ["flyer", "voice_note"],
    },
    {} as never,
    "11111111-1111-4111-8111-111111111111",
  ) as {
    steps: Array<Record<string, unknown>>;
    completion_contract: Record<string, unknown>;
  };
  const keys = result.steps.map((step) => step.key);
  for (
    const key of [
      "brand",
      "market",
      "listing",
      "tickets",
      "payouts",
      "terms",
      "preview",
      "publish",
      "verify",
      "handover",
    ]
  ) {
    assert(keys.includes(key), `missing onboarding step ${key}`);
  }
  assertEquals(result.completion_contract.verify_public_result, true);
  assertEquals(
    result.completion_contract.resume_without_repeating_completed_writes,
    true,
  );
  assert(result.steps.some((step) => step.human_owned === true));
});

Deno.test("#3355 multimodal candidates make cross-source conflicts blocking", () => {
  const flyer = extractCandidates(
    "October 30, 2026 at 1 PM. Tickets $40",
    null,
  );
  const message = extractCandidates(
    "October 30, 2026 at 2 PM. Tickets $50",
    null,
  );
  const conflicts = compareListingCandidateSources(
    flyer,
    message,
    ["flyer", "message"],
  );
  assert(conflicts.some((conflict) => conflict.field === "times"));
  assert(conflicts.some((conflict) => conflict.field === "prices"));
  assert(conflicts.every((conflict) => conflict.blocking === true));
});

Deno.test("#3355 voice notes and video require a matching verified container", async () => {
  const wav = new Uint8Array(44);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  wav.set(new TextEncoder().encode("WAVE"), 8);
  assertEquals(detectAriMediaMime(wav, "audio/wav"), {
    mime: "audio/wav",
    fileType: "audio",
    container: "wave",
  });
  assertEquals(detectAriMediaMime(wav, "video/mp4"), null);
  assertEquals(
    (await verifyAriAttachment(wav, "audio/x-wav", wav.length)).fileType,
    "audio",
  );

  const mp4 = new Uint8Array(32);
  mp4.set([0, 0, 0, 32], 0);
  mp4.set(new TextEncoder().encode("ftyp"), 4);
  mp4.set(new TextEncoder().encode("mp42"), 8);
  assertEquals(
    (await verifyAriAttachment(mp4, "video/mp4", mp4.length)).fileType,
    "video",
  );

  let mismatch = false;
  try {
    await verifyAriAttachment(mp4, "audio/mpeg", mp4.length);
  } catch (error) {
    mismatch = error instanceof Error &&
      ["CORRUPT_FILE", "MIME_MISMATCH"].includes(error.message);
  }
  assert(mismatch, "renamed media must be refused");
});

Deno.test("#3355 browser URL guard blocks private IPv4 and IPv6 forms", () => {
  for (
    const host of [
      "127.0.0.1",
      "10.0.0.4",
      "169.254.169.254",
      "172.16.4.2",
      "192.168.1.8",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]
  ) assert(isPrivateIpAddress(host), `${host} should be private`);
  for (
    const url of [
      "http://localhost/private",
      "http://127.0.0.1/private",
      "http://[::1]/private",
      "http://169.254.169.254/latest/meta-data",
    ]
  ) {
    let blocked = false;
    try {
      assertSafePublicUrl(url);
    } catch (error) {
      blocked = error instanceof Error &&
        error.message === "PUBLIC_URL_PRIVATE_NETWORK";
    }
    assert(blocked, `${url} should be blocked`);
  }
  assertEquals(
    assertSafePublicUrl("https://example.com/path").hostname,
    "example.com",
  );
});

Deno.test("#3355 local research parses cited public destinations without promoting private links", () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fharmattan&amp;rut=x">Harmattan &amp; Co</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%2Fsecret&amp;rut=x">Private</a>
    <a class="result__a" href="https://events.example.org/lantern">Lantern Room events</a>`;
  const sources = parseLocalPublicSearchResults(
    html,
    "2026-10-29T17:00:00.000Z",
  );
  assertEquals(sources.map((source) => source.url), [
    "https://example.com/harmattan",
    "https://events.example.org/lantern",
  ]);
  assertEquals(sources[0].title, "Harmattan & Co");
  assertEquals(sources[0].source_type, "search");
});

Deno.test("#3355 local research decodes Bing citations through the public URL guard", () => {
  const publicTarget = btoa("https://events.example.org/harmattan").replaceAll(
    "+",
    "-",
  ).replaceAll("/", "_").replace(/=+$/g, "");
  const privateTarget = btoa("http://127.0.0.1/secret").replaceAll("+", "-")
    .replaceAll("/", "_").replace(/=+$/g, "");
  const html = `
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${publicTarget}">Harmattan Club events</a></h2></li>
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${privateTarget}">Private</a></h2></li>`;
  const sources = parseBingPublicSearchResults(
    html,
    "2026-10-29T18:00:00.000Z",
  );
  assertEquals(sources.map((source) => source.url), [
    "https://events.example.org/harmattan",
  ]);
  assertEquals(sources[0].title, "Harmattan Club events");
});

Deno.test("#3355 research citations reject provider tracking and irrelevant same-name noise", () => {
  assertEquals(
    canonicalizePublicResearchUrl(
      "https://events.example.org/lantern?utm_source=bing&gclid=secret#results",
    ),
    "https://events.example.org/lantern",
  );
  let providerBlocked = false;
  try {
    canonicalizePublicResearchUrl(
      "https://www.bing.com/rebates/welcome?url=https%3A%2F%2Fevents.example.org",
    );
  } catch (error) {
    providerBlocked = error instanceof Error &&
      error.message === "RESEARCH_SOURCE_LOW_SIGNAL";
  }
  assert(providerBlocked, "Bing affiliate links must not become citations");

  const curated = curatePublicResearchSources([
    {
      url: "https://lanternroom.com/",
      title: "The Lantern Room | Official Site",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://lanternroom.com/events?utm_campaign=test",
      title: "Lantern Room events",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://lanternroom.com/about",
      title: "About the Lantern Room",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://calendar.google.com/",
      title: "Google Calendar - Appointments",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
    {
      url: "https://example.org/generic-agenda.pdf",
      title: "Meeting agenda",
      fetched_at: "2026-10-29T18:00:00.000Z",
      source_type: "search",
    },
  ], "Compare the official Lantern Room homepage and events calendar");
  assertEquals(curated.map((source) => source.url), [
    "https://lanternroom.com/events",
    "https://lanternroom.com/",
  ]);
});

Deno.test("#3355 server emits a visible plan with verified research sources", () => {
  const rendition = buildAgentRunRendition({
    renditionId: "run:11111111-1111-4111-8111-111111111111",
    goal: "Compare the public event page and prepare the next safe action",
    result: {
      kind: "text",
      text: "The page is verified.",
      observations: [{
        tool: "search_public_web",
        args: { query: "Lantern Room events" },
        result: {
          sources: [{
            url: "https://example.com/events",
            title: "Lantern Room events &amp; tickets",
            fetched_at: "2026-10-29T12:00:00.000Z",
            source_type: "search",
          }],
        },
        elapsedMs: 24,
      }],
      usage: { input: 10, output: 4, calls: 2 },
      exhausted: false,
    },
  });
  assertEquals(rendition.schema_version, 2);
  assertEquals(rendition.kind, "research");
  const blocks = rendition.blocks as Array<Record<string, unknown>>;
  assert(blocks.some((block) => block.type === "timeline"));
  assert(blocks.some((block) => block.type === "progress"));
  const sources = blocks.find((block) => block.type === "sources");
  assert(sources);
  assertEquals(
    (sources.items as Array<Record<string, unknown>>)[0].url,
    "https://example.com/events",
  );
  assertEquals(
    (sources.items as Array<Record<string, unknown>>)[0].label,
    "Lantern Room events & tickets",
  );
});

Deno.test("#3355 user-facing renditions never expose diagnostic error slugs", () => {
  assertEquals(
    ariUserFacingToolError({
      code: "TOOL_FAILED",
      message: "RESEARCH_NOT_CONFIGURED",
    }),
    "Public research is not available in this environment yet.",
  );
  const rendition = buildAgentRunRendition({
    renditionId: "run:error-copy",
    goal: "Research Harmattan Club",
    result: {
      kind: "stopped",
      reason: "errors",
      observations: [{
        tool: "search_public_web",
        args: { query: "Harmattan Club" },
        error: {
          code: "TOOL_FAILED",
          message: "RESEARCH_NOT_CONFIGURED",
        },
        elapsedMs: 10,
      }],
      usage: { input: 2, output: 1, calls: 1 },
      exhausted: false,
    },
  });
  const serialized = JSON.stringify(rendition);
  assert(!serialized.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!serialized.includes("TOOL_FAILED"));
  assert(serialized.includes("Public research is not available"));
});

Deno.test("#3355 plain Ari replies never expose diagnostic error slugs", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "Search public sources: RESEARCH_NOT_CONFIGURED (TOOL_FAILED).\n\nKeep the completed plan.",
  );
  assert(response.includes("Public research is temporarily unavailable"));
  assert(response.includes("Keep the completed plan"));
  assert(!response.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!response.includes("TOOL_FAILED"));
  assert(response.includes("\n\n"));
});

Deno.test("#3355 every committed assistant reply crosses the diagnostic sanitizer", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const commitBoundary = source.slice(
    source.indexOf("async function commitTextTurn"),
    source.indexOf(
      "function jsonResponse",
      source.indexOf("async function commitTextTurn"),
    ),
  );
  assertMatch(
    commitBoundary,
    /const publicText = sanitizeAriUserFacingDiagnostics\(args\.text\)/,
  );
  assertMatch(commitBoundary, /const content = \{\s*text: publicText,/);
  assertMatch(commitBoundary, /assistantText: publicText,/);
  assertMatch(commitBoundary, /kind: "text",\s*text: publicText,/);
  assert(!/text: args\.text/.test(commitBoundary));
});

Deno.test("#3355 unknown internal codes also fail closed to product copy", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "The operation stopped with EVENT_GRAPH_STALE and DATE_WINDOW_AMBIGUOUS.",
  );
  assert(!response.includes("EVENT_GRAPH_STALE"));
  assert(!response.includes("DATE_WINDOW_AMBIGUOUS"));
  assert(response.includes("This step needs attention"));
});

Deno.test("#3355 plain Ari replies never expose tool names or UUID routes", () => {
  const response = sanitizeAriUserFacingDiagnostics(
    "Create it using the tool create_site_draft, then open /brand/33550000-0000-4000-a000-000000000001/website.",
  );
  assert(!response.includes("create_site_draft"));
  assert(!response.includes("33550000-0000-4000-a000-000000000001"));
  assert(response.includes("website draft"));
  assert(response.includes("Website screen"));
});

Deno.test("#3355 complete launch requests receive a deterministic real-data plan", () => {
  const request =
    "For Harmattan Club, build a complete brand launch plan, research our public presence, and show every step.";
  assert(isBrandLaunchPlanRequest(request));
  assert(
    isAriEventLaunchReadinessRequest(
      "Show me the exact launch checklist and public event details. Do not publish until I approve the final preview.",
    ),
  );
  assert(
    !isAriEventLaunchReadinessRequest(
      "Create an event called Launch Details next Friday.",
    ),
    "ordinary event creation is not a launch-readiness request",
  );
  assert(
    launchPlanNeedsPublicResearch(
      "Check public evidence without guessing before launch.",
    ),
  );
  assertEquals(
    launchPlanInitialCalls({
      brandId: "brand-a",
      brandName: "Harmattan Club",
      includeResearch: true,
    }).map((call) => call.name),
    ["get_operator_snapshot", "get_brand_site", "search_public_web"],
  );
  const plan = buildBrandLaunchPlan({
    brandName: "Harmattan Club",
    observations: [
      {
        tool: "get_operator_snapshot",
        args: { brand_id: "brand-a" },
        result: {
          selected_brand: {
            name: "Harmattan Club",
            description: "A Lagos culture club",
            city: "Lagos",
            country_code: "NG",
            default_currency: "NGN",
            genuinely_missing: ["cover image", "public phone"],
          },
          offerings: [],
          payout_ready: false,
        },
        elapsedMs: 10,
      },
      {
        tool: "get_brand_site",
        args: { brand_id: "brand-a" },
        result: { website_state: "not_set_up" },
        elapsedMs: 10,
      },
      {
        tool: "search_public_web",
        args: { query: "Harmattan Club" },
        result: {
          sources: [
            {
              title: "Fall Festival Tickets",
              url: "https://example.com/fall-festival",
            },
            {
              title: "Harmattan Club Lagos",
              url: "https://directory.example/harmattan-club",
            },
          ],
        },
        elapsedMs: 10,
      },
    ],
  });
  assertEquals(plan.steps.length, 8);
  assert(plan.text.includes("Harmattan Club"));
  assert(plan.text.includes("Lagos"));
  assert(plan.text.includes("NGN"));
  assert(plan.text.includes("Nothing has been changed or published"));
  assert(plan.text.includes("cover image"));
  assert(!plan.text.includes("RESEARCH_NOT_CONFIGURED"));
  assert(!plan.text.includes("create_site_draft"));
  assertEquals(plan.sourceUrls, [
    "https://directory.example/harmattan-club",
  ]);
  assert(!plan.text.includes("2 public search leads"));

  const rendition = buildAgentRunRendition({
    renditionId: "run:launch-plan",
    goal: request,
    result: {
      kind: "text",
      text: plan.text,
      observations: [],
      usage: { input: 1, output: 1, calls: 1 },
      exhausted: false,
    },
    plan,
  });
  assertEquals(rendition.title, "Launch plan ready");
  assertEquals(rendition.state, "ready");
  const blocks = rendition.blocks as Array<Record<string, unknown>>;
  const timeline = blocks.find((block) => block.type === "timeline");
  assertEquals(
    (timeline?.items as Array<Record<string, unknown>>).length,
    8,
  );
  assert(blocks.some((block) => block.id === "genuinely-missing"));
  assertEquals(rendition.actions, undefined);

  const unavailableSitePlan = buildBrandLaunchPlan({
    brandName: "Harmattan Club",
    observations: [
      {
        tool: "get_operator_snapshot",
        args: { brand_id: "brand-a" },
        result: {
          selected_brand: { name: "Harmattan Club" },
          offerings: [],
          payout_ready: false,
        },
        elapsedMs: 1,
      },
      {
        tool: "get_brand_site",
        args: { brand_id: "brand-a" },
        error: { code: "SITE_SERVICE_UNAVAILABLE", message: "unavailable" },
        elapsedMs: 1,
      },
    ],
  });
  assertMatch(unavailableSitePlan.text, /couldn't verify the website status/i);
  assert(!unavailableSitePlan.text.includes("SITE_SERVICE_UNAVAILABLE"));
  assert(unavailableSitePlan.missing.includes("verified website status"));
});
