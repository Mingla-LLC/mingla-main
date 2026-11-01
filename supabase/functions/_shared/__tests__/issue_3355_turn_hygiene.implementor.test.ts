// Issue #3355 P1 — Ari turn and confirm hygiene (implementor happy path).
//
// Drives the shipped modules, not source text:
//   D-9  a deterministic money/publish refusal from the database becomes a
//        typed DOMAIN_REFUSED with an owner sentence (409, terminal), never
//        RPC_FAILED -> 202 "verifying"; a genuine transport failure stays
//        ambiguous.
//   D-5  every registered write tool has owner words; every presentation and
//        the generic proposal rendition are copy-gate clean; the Host table
//        carries the same words.
//   D-6  the owner copy gate refuses tool names, plumbing keys, ids, hashes
//        and engine lines, while handles, emails and URLs survive prose.
//   D-7/D-15/D-32  engine lines are plain and claim nothing that did not happen.
//   D-1/D-13/D-14  the rate limit honours replay and the DB reset time; the
//        confirm claim asks the database about expiry.
//   D-20 "set up a trip for my brand" is not brand onboarding.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_turn_hygiene.implementor.test.ts

import {
  assert,
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { callRpc, retypeAriRefusal, ToolError } from "../agentToolHelpers.ts";
import {
  ARI_REFUSAL_CODES,
  ARI_REFUSAL_COPY,
  DOMAIN_REFUSED_CODE,
} from "../ariRefusalCopy.ts";
import { mapLegacyAriErrorCode } from "../agentReliability.ts";
import {
  ARI_STOPPED_HERE_LINE,
  assertOwnerCopy,
  isOwnerSafe,
  OWNER_PROSE_FALLBACK,
  ownerCopyToolNames,
  ownerCopyViolations,
  reconciledApprovalLine,
} from "../ariOwnerCopy.ts";
import {
  buildProposalPresentation,
  receiptTitle,
  withProposalPresentation,
} from "../ariPresentation/registry.ts";
import { WRITE_TOOL_OWNER_COPY } from "../ariPresentation/toolLabels.ts";
import {
  buildGenericProposalRendition,
  buildToolReadRendition,
  buildToolReceiptRendition,
} from "../ariRendition.ts";
import { sanitizeAriUserFacingDiagnostics } from "../agentSanitization.ts";
import { buildAgentRunRendition } from "../agentRenditions.ts";
import { enforceTurnRateLimit } from "../agentRateLimit.ts";
import { postApprovalStopText } from "../agentPostApproval.ts";
import {
  ARI_DETERMINISTIC_TURN_CODES,
  isDeterministicTurnRefusal,
} from "../ariTurnRetry.ts";
import {
  isAriOnboardingPlanProgressMessage,
  needsAriOnboardingSetupRead,
} from "../agentToolsets.ts";
import {
  claimPendingForConfirm,
  pendingExpiredByDbClock,
} from "../../agent-confirm-action/pendingClaim.ts";

const REPO = new URL("../../../../", import.meta.url);
const CAPS = {
  protocol_version: 2,
  max_schema_version: 2,
  block_version: 1,
  action_version: 1,
  block_types: [],
  graphic_types: [],
  platform: "web",
  app_version: "1.0.0",
  runtime_version: null,
} as const;

const WRITE_TOOLS = AGENT_TOOLS.map((tool) => tool.name).filter((name) =>
  !READ_ONLY_TOOL_NAMES.has(name)
);

// ---------------------------------------------------------------------------
// D-9 typed refusals
// ---------------------------------------------------------------------------

function rpcClient(message: string) {
  return {
    rpc: () => Promise.resolve({ data: null, error: { message } }),
  } as unknown as Parameters<typeof callRpc>[0];
}

Deno.test("#3355 D-9 a paid publish on a brand that cannot collect is a typed refusal, not RPC_FAILED", async () => {
  const error = await callRpc(
    rpcClient("stripe_charges_disabled"),
    "business_publish_event_draft",
    {},
  ).then(() => null, (err) => err);
  assertInstanceOf(error, ToolError);
  assertEquals(error.code, DOMAIN_REFUSED_CODE);
  assertEquals(error.message, ARI_REFUSAL_COPY.stripe_charges_disabled.message);
  assert(isOwnerSafe(error.message, "prose"));
  // The envelope family every installed app already knows.
  assertEquals(mapLegacyAriErrorCode(error.code), "DOMAIN_ACTION_REFUSED");
});

Deno.test("#3355 D-9 receipt-backed executor refusals (WRITE_FAILED) are re-typed; transport stays ambiguous", () => {
  const refused = retypeAriRefusal(
    new ToolError("WRITE_FAILED", "P0001: offering_date_past"),
  );
  assertInstanceOf(refused, ToolError);
  assertEquals((refused as ToolError).code, DOMAIN_REFUSED_CODE);

  const transport = new ToolError(
    "RPC_FAILED",
    "ari_execute_event_operation: fetch failed",
  );
  assertEquals(retypeAriRefusal(transport), transport);

  // A longer code that merely contains a refusal code is a different refusal.
  const longer = new ToolError("RPC_FAILED", "stripe_charges_disabled_v2");
  assertEquals(retypeAriRefusal(longer), longer);

  // Already-typed failures keep their meaning.
  const typed = new ToolError("ORGANISER_TERMS_REQUIRED", "Accept the terms");
  assertEquals(retypeAriRefusal(typed), typed);
});

Deno.test("#3355 D-9 every closed-list refusal code has owner copy and every Host paid-publish reason is covered", async () => {
  for (
    const code of [
      "stripe_charges_disabled",
      "payment_collection_unavailable",
      "event_currency_required",
      "event_currency_unsupported",
      "offering_date_past",
      "city_required",
      "party_types_required",
      "party_types_not_canonical",
      "private_access_not_ready",
      "event_title_required",
      "event_ticket_required",
      "event_date_required",
      "insufficient_event_permission",
      "trip_pricing_tier_required",
      "bank_required_for_installments",
      "payout_not_ready",
      "ticket_currency_must_match_event_currency",
      "paid_currency_not_ready",
      "trip_date_past",
    ]
  ) {
    assert(ARI_REFUSAL_CODES.includes(code), `${code} must be mapped`);
    const copy = ARI_REFUSAL_COPY[code];
    assert(
      isOwnerSafe(copy.message, "prose"),
      `${code} copy must be gate-clean`,
    );
    assert(/nothing|ask me again|then/i.test(copy.message));
  }
  const host = await Deno.readTextFile(
    new URL("mingla-business/src/utils/paidPublishGuards.ts", REPO),
  );
  const reasons = new Set<string>();
  for (
    const block of host.matchAll(
      /export type (?:PaidPublishGuardReason|ProviderNeutralPaidPublishGuardReason) =([^;]+);/g,
    )
  ) {
    for (const match of block[1].matchAll(/"([a-z_]+)"/g)) {
      reasons.add(match[1]);
    }
  }
  assert(reasons.size >= 4, "Host reasons parsed");
  for (const reason of reasons) {
    assert(ARI_REFUSAL_CODES.includes(reason), `Host reason ${reason} missing`);
  }
});

// ---------------------------------------------------------------------------
// D-6 owner copy gate
// ---------------------------------------------------------------------------

Deno.test("#3355 D-6 the gate refuses plumbing in labels and engine lines", () => {
  for (
    const bad of [
      "expected_plan_revision",
      "Expected plan revision 7",
      "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
      "get_site_plan",
      "I reconciled the expired action.",
      "a".repeat(20) + "1234",
      "RPC_FAILED",
      "I started one durable Fix all job",
    ]
  ) {
    assert(ownerCopyViolations(bad, "label").length > 0, `must refuse: ${bad}`);
    assertEquals(
      assertOwnerCopy(bad, { fallback: "Review this change", surface: "test" }),
      "Review this change",
    );
  }
});

Deno.test("#3355 D-6 every registered tool name is refused (generated from the registry)", () => {
  assertEquals(ownerCopyToolNames().size, AGENT_TOOLS.length);
  for (const tool of AGENT_TOOLS) {
    assert(
      ownerCopyViolations(`Next I'll call ${tool.name}.`, "prose").length > 0,
      tool.name,
    );
  }
});

Deno.test("#3355 D-6 prose keeps handles, emails and URLs exactly; tool names become owner words", () => {
  const out = sanitizeAriUserFacingDiagnostics(
    "I'll update_brand_context with @seth_ogieva, first_last@example.com and https://example.com/a_b. expected_plan_revision 7",
  );
  assert(out.includes("@seth_ogieva"), out);
  assert(out.includes("first_last@example.com"), out);
  assert(out.includes("https://example.com/a_b"), out);
  assert(out.includes("save to your brand"), out);
  assert(!out.includes("update_brand_context"), out);
  assert(!/revision/i.test(out), out);
  assert(isOwnerSafe(out, "prose"), out);
  assert(isOwnerSafe(OWNER_PROSE_FALLBACK, "label"));
});

// ---------------------------------------------------------------------------
// D-5 presentation for every write tool
// ---------------------------------------------------------------------------

const PLUMBING_ARGS = {
  brand_id: "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
  event_id: "4f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
  expected_plan_revision: 7,
  expected_context_revision: "a".repeat(64),
  client_revision: 3,
  expected_state_version: 4,
  operation_id: "op-1",
  idempotency_key: "k",
  confirm_phrase: "CHARGE",
  why: "because",
  cites: ["https://example.com"],
  fingerprint: "b".repeat(40),
  title: "Lagos Rooftop Night",
  price_cents: 2500,
  currency: "NGN",
  visibility: "public",
  door_mode: "door_only",
  patch: { contact_email: "hi@example.com", state_version: 9 },
};

Deno.test("#3355 D-5 every registered write tool has owner words, all gate-clean", () => {
  const missing = WRITE_TOOLS.filter((name) =>
    !(name in WRITE_TOOL_OWNER_COPY)
  );
  assertEquals(missing, []);
  for (const [name, copy] of Object.entries(WRITE_TOOL_OWNER_COPY)) {
    for (const text of [copy.verb, copy.title, copy.done]) {
      assert(isOwnerSafe(text, "label"), `${name}: ${text}`);
    }
  }
});

Deno.test("#3355 D-5 presentations for every write tool hide plumbing and never show a tool name", () => {
  for (const name of WRITE_TOOLS) {
    const presentation = buildProposalPresentation(name, PLUMBING_ARGS);
    const serialized = JSON.stringify(presentation);
    assert(isOwnerSafe(presentation.verb, "label"), `${name} verb`);
    assertEquals(presentation.title, "Lagos Rooftop Night");
    for (const field of presentation.fields) {
      assert(isOwnerSafe(field.label, "label"), `${name} label ${field.label}`);
    }
    for (
      const leak of [
        "3f2a9c1e",
        "aaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbb",
        "op-1",
        "CHARGE",
        "revision",
        "Revision",
        "because",
        name,
      ]
    ) {
      assert(
        !serialized.includes(leak),
        `${name} leaked ${leak}: ${serialized}`,
      );
    }
    assert(
      serialized.includes("hi@example.com"),
      `${name} keeps nested values`,
    );
    assert(serialized.includes("Door only"), `${name} reads enums as words`);
  }
});

Deno.test("#3355 D-5 money reads in the currency's own minor units", () => {
  const ngn = buildProposalPresentation("upsert_ticket_tier", {
    price_cents: 250000,
    currency: "NGN",
  });
  assert(
    ngn.fields.some((f) => f.label === "Price" && f.value.includes("2,500")),
  );
  const isk = buildProposalPresentation("upsert_ticket_tier", {
    price_cents: 2500,
    currency: "ISK",
  });
  assert(isk.fields.some((f) => f.label === "Price" && !f.value.includes(".")));
});

Deno.test("#3355 D-5 the generic proposal and receipt renditions use owner words", () => {
  for (
    const name of [
      "manage_trip_tiers",
      "publish_trip",
      "schedule_campaign",
      "set_refund_policy",
    ]
  ) {
    const rendition = buildGenericProposalRendition({
      toolName: name,
      toolArgs: PLUMBING_ARGS,
      pendingActionId: "5f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
      capabilities: CAPS as never,
      envValue: "true",
    });
    assert(rendition);
    assertEquals(rendition.eyebrow, WRITE_TOOL_OWNER_COPY[name].verb);
    const shown = JSON.stringify([
      rendition.eyebrow,
      rendition.title,
      rendition.blocks,
    ]);
    assert(!shown.includes(name), shown);
    assert(!/revision|aaaaaaaaaaaaaaaa/i.test(shown), shown);

    const receipt = buildToolReceiptRendition({
      toolName: name,
      result: { state_version: 4, revision: "c".repeat(64), status: "saved" },
      pendingActionId: "5f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6",
      capabilities: CAPS as never,
      envValue: "true",
    });
    assert(receipt);
    assertEquals(receipt.title, receiptTitle(name));
    assert(!JSON.stringify(receipt).includes(name));
  }
  const read = buildToolReadRendition({
    toolName: "get_trip_overview",
    result: { revision: 3, name: "Trip" },
    capabilities: CAPS as never,
    envValue: "true",
  });
  assert(read);
  assert(!read.title.includes("_") && !/get trip overview/i.test(read.title));
});

Deno.test("#3355 D-5 the presentation rides in server-owned proposal context", () => {
  const args = withProposalPresentation("publish_trip", {
    trip_id: "x",
    __proposal_context: { refundable_total_cents: 10 },
  });
  const context = args.__proposal_context as Record<string, unknown>;
  assertEquals(context.refundable_total_cents, 10);
  assertEquals(
    (context.presentation as { verb: string }).verb,
    "Publish trip",
  );
});

Deno.test("#3355 D-5 the Host card table carries the same words as the server", async () => {
  const host = await Deno.readTextFile(
    new URL("mingla-business/src/components/ari/toolProposalCopy.ts", REPO),
  );
  const rows = new Map<string, [string, string, string]>();
  for (
    const match of host.matchAll(
      /^\s+([a-z_]+):\s*row\(\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",?\s*\),$/gm,
    )
  ) rows.set(match[1], [match[2], match[3], match[4]]);
  assertEquals(rows.size, Object.keys(WRITE_TOOL_OWNER_COPY).length);
  for (const [name, copy] of Object.entries(WRITE_TOOL_OWNER_COPY)) {
    assertEquals(rows.get(name), [copy.verb, copy.title, copy.done], name);
  }
});

// ---------------------------------------------------------------------------
// D-7 / D-15 / D-32 engine lines
// ---------------------------------------------------------------------------

Deno.test("#3355 D-32 reconcile lines are plain and gate-clean", () => {
  assertEquals(
    reconciledApprovalLine("executed"),
    "That earlier change finished saving.",
  );
  assertEquals(
    reconciledApprovalLine("expired"),
    "That earlier approval timed out; nothing was saved.",
  );
  for (
    const outcome of [
      "executed",
      "failed",
      "failed_unknown",
      "cancelled",
      "expired",
    ] as const
  ) {
    assert(isOwnerSafe(reconciledApprovalLine(outcome), "label"), outcome);
  }
});

Deno.test("#3355 D-7 a post-approval budget stop never claims the remaining plan was saved", () => {
  for (const reason of ["budget", "deadline"]) {
    const line = postApprovalStopText(reason);
    assertEquals(line, `That's saved. ${ARI_STOPPED_HERE_LINE}`);
    assert(!/remaining plan|resume without repeating/i.test(line));
  }
  assert(isOwnerSafe(postApprovalStopText("errors"), "label"));
});

Deno.test("#3355 D-7/D-15 a stopped run claims nothing was saved and an answer is not 'Plan complete'", () => {
  assert(isOwnerSafe(ARI_STOPPED_HERE_LINE, "label"));
  assert(!/saved/i.test(ARI_STOPPED_HERE_LINE));
  const stopped = buildAgentRunRendition({
    renditionId: "run:budget",
    goal: "Set up my launch",
    result: {
      kind: "stopped",
      reason: "budget",
      observations: [],
      usage: { input: 1, output: 1, calls: 1 },
      exhausted: true,
    } as never,
  });
  const serialized = JSON.stringify(stopped);
  assert(!/saved and ready|checkpoint/i.test(serialized), serialized);
  const answer = buildAgentRunRendition({
    renditionId: "run:answer",
    goal: "What's my next step?",
    result: {
      kind: "text",
      text: "Add a cover.",
      observations: [{
        tool: "manage_trip_tiers",
        args: {},
        result: {},
        elapsedMs: 1,
      }],
      usage: { input: 1, output: 1, calls: 1 },
      exhausted: false,
    } as never,
  });
  assert(answer.title !== "Plan complete");
  assert(!JSON.stringify(answer).includes("Manage Trip Tiers"));
});

// ---------------------------------------------------------------------------
// D-1 / D-13 / D-14 rate limit and claim on the DB clock
// ---------------------------------------------------------------------------

function rateClient(
  answer: { data?: unknown; error?: unknown },
  extra: Record<string, unknown> = {},
) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      (extra.calls as unknown[] | undefined)?.push([fn, args]);
      return Promise.resolve(answer);
    },
    from: extra.from,
  } as never;
}

Deno.test("#3355 D-1 a claimed turn id at the cap replays; a refusal carries the DB reset time", async () => {
  const calls: unknown[] = [];
  const replay = await enforceTurnRateLimit(
    "u",
    rateClient({ data: [{ allowed: true, replay: true }], error: null }, {
      calls,
    }),
    "11111111-1111-4111-8111-111111111111",
  );
  assertEquals(replay, { allowed: true, replay: true });
  assertEquals(calls[0], ["agent_turn_rate_window", {
    p_user_id: "u",
    p_client_turn_id: "11111111-1111-4111-8111-111111111111",
  }]);

  const refused = await enforceTurnRateLimit(
    "u",
    rateClient({
      data: [{
        allowed: false,
        reason: "rate_limited_daily",
        reset_at: "2026-11-02T09:00:00Z",
        retry_after_seconds: 3600,
      }],
      error: null,
    }),
    "22222222-2222-4222-8222-222222222222",
  );
  assertEquals(refused.allowed, false);
  assertEquals(refused.reason, "rate_limited_daily");
  assertEquals(refused.resetAt, "2026-11-02T09:00:00Z");
  assertEquals(refused.retryAfterSeconds, 3600);
});

Deno.test("#3355 D-1 before the migration, a claimed turn id still replays", async () => {
  const from = () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "a" }, error: null }),
        }),
      }),
    }),
  });
  const result = await enforceTurnRateLimit(
    "u",
    rateClient({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    }, { from }),
    "33333333-3333-4333-8333-333333333333",
  );
  assertEquals(result, { allowed: true, replay: true });
});

Deno.test("#3355 D-14 expiry and claim are answered by the database", async () => {
  const calls: unknown[] = [];
  const expired = await pendingExpiredByDbClock(
    rateClient({ data: "expired", error: null }, { calls }) as never,
    // The edge clock would call this live (expires in a year).
    {
      id: "p",
      userId: "u",
      expiresAt: new Date(Date.now() + 3e10).toISOString(),
    },
  );
  assertEquals(expired, true);
  assertEquals(
    (calls[0] as [string, Record<string, unknown>])[1].p_probe_only,
    true,
  );
  const live = await pendingExpiredByDbClock(
    rateClient({ data: "pending", error: null }) as never,
    // ...and this one expired (a year ago) — the database says it is live.
    {
      id: "p",
      userId: "u",
      expiresAt: new Date(Date.now() - 3e10).toISOString(),
    },
  );
  assertEquals(live, false);
  const claim = await claimPendingForConfirm(
    rateClient({ data: "claimed", error: null }) as never,
    { id: "p", userId: "u", toolArgs: { a: 1 } },
  );
  assertEquals(claim, { answer: "claimed", legacy: false });
});

Deno.test("#3355 D-1/D-2 deterministic refusals are never retried (server and Host agree)", async () => {
  for (
    const code of [
      "RATE_LIMITED",
      "CHOICE_STALE",
      "DOMAIN_REFUSED",
      "PROPOSAL_EXPIRED",
    ]
  ) {
    assert(isDeterministicTurnRefusal(code));
  }
  assert(!isDeterministicTurnRefusal("TRANSPORT_UNAVAILABLE"));
  assert(!isDeterministicTurnRefusal("INTERNAL"));
  const host = await Deno.readTextFile(
    new URL("mingla-business/src/hooks/ariTurnRetryPolicy.ts", REPO),
  );
  const list = host.match(
    /ARI_DETERMINISTIC_TURN_CODES[\s\S]*?Object\.freeze\(\[([^\]]*)\]/,
  )?.[1] ?? "";
  assertEquals(
    [...list.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]),
    [...ARI_DETERMINISTIC_TURN_CODES],
  );
});

// ---------------------------------------------------------------------------
// D-20 onboarding never captures offering work
// ---------------------------------------------------------------------------

Deno.test("#3355 D-20 setting up a trip or an event is not brand onboarding", () => {
  assert(needsAriOnboardingSetupRead("Help me set up my brand"));
  assert(!needsAriOnboardingSetupRead("Set up a trip for my brand"));
  assert(
    !needsAriOnboardingSetupRead("Can you set up my events for the brand"),
  );
  assert(
    !isAriOnboardingPlanProgressMessage("Set the trips timezone to Lagos"),
  );
});
