// Issue #3355 Wave D (D2 gap logging, D4 escalation) — Ari logs where it
// falls short, and a stuck host can ask the Mingla team.
//
// MINGLA-INVARIANT: I-ARI-GAPS-CLASSIFIED | issue #3355 | Every Ari turn is classified server-side into gap signals (refusal, flow_parked, repeated_request, negative_feedback, frustration, empty_reply, tool_error, dropped_route), at most one per type per turn, with an excerpt scrubbed of emails, phone and card-like numbers and capped at 240 characters, written fail-soft through public.ari_record_turn_gaps with the service client.
// MINGLA-INVARIANT: I-ARI-ESCALATES-AFTER-SECOND-FAILURE | issue #3355 | A second refusal/repeat/park/frustration inside the last 5 owner turns, or one strong frustration signal, changes Ari's approach: the open setup is parked, the guide is read first, and "Ask the Mingla team" is offered.
// MINGLA-INVARIANT: I-ARI-ASK-TEAM-ONLY-ON-TAP | issue #3355 | "Ask the Mingla team" is a tell_owner_in_brand_group proposal whose PII-minimised words the server writes from the chat's gap rows; proposing sends nothing, and the host's confirm sends exactly one brand-group message through the receipt-backed ari_tell_owner_in_brand_group RPC, at most once per Ari conversation per hour.
//
// The SQL half (one row per type per turn, owner-only reads, admin view,
// "Turn into eval", the weekly digest card, the hourly rule) is proven in
// supabase/migrations/__tests__/issue_3355_ari_gap_logging.implementor.pg17.test.sql.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_d_gaps.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { ARI_10X_TOOLS, bindOwnerNoteProposal } from "../agentAri10xTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { ariGuideForcedCalls } from "../ariGuideKnowledge.ts";
import {
  ARI_ASK_TEAM_TOPIC,
  type AriGapSignal,
  type AriGapType,
  askTeamNoteText,
  classifyAriOwnerTurn,
  classifyAriReplyGaps,
  decideAriEscalation,
  detectAriFrustration,
  detectAriRepeat,
  recordAriTurnGaps,
} from "../ariGaps.ts";
import { scrubAriExcerpt } from "../ariPii.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import { ARI_ESCALATION_GUIDANCE } from "../agentSystemPrompt.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHAT = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const GAP1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const GAP2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";

// ── This morning's host thread (2026-11-10, Lagos), per the #3355 spec ──────
// Reconstructed from the forensic findings (no production read): the
// influencer request was routed into event setup, the FAVY10 sentence was
// answered "I didn't catch that" twice, and the time zone handoff pointed at
// a screen that could not fix it.
const HOST_INFLUENCER_SENTENCE =
  "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";
const HOST_FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';

interface ThreadTurn {
  owner: string;
  reply: string;
  errorCodes?: string[];
  droppedRoutes?: number;
  flowParked?: boolean;
  expected: AriGapType[];
}

const MORNING_THREAD: ThreadTurn[] = [
  {
    owner: HOST_INFLUENCER_SENTENCE,
    reply:
      "Let's set up your event. Before you publish, a few brand profile items are missing: tagline, phone, website, address, city and time zone.",
    expected: [],
  },
  {
    owner: HOST_FAVY10_SENTENCE,
    reply:
      "I didn't catch that as an answer to this step, so nothing was changed.",
    // The second discount-code ask (same request as turn 1, never served).
    // #3355 Wave F: the FAVY10 sentence brings the code, % and end date
    // the bare influencer ask lacked, so it answers it rather than repeating
    // it; the reply's refusal is still the first failure.
    expected: ["refusal"],
  },
  {
    owner: HOST_FAVY10_SENTENCE,
    reply:
      "I didn't catch that as an answer to this step, so nothing was changed.",
    expected: ["repeated_request", "refusal"],
  },
  {
    owner: "It's done, check now",
    reply:
      "The time zone still isn't set, and I can't set it from here. Add it in Brand profile and tell me when it's done.",
    errorCodes: ["READINESS_ITEM_OPEN"],
    droppedRoutes: 1,
    expected: ["refusal", "tool_error", "dropped_route"],
  },
];

function classifyTurn(turn: ThreadTurn, prior: string[]): AriGapSignal[] {
  return [
    ...classifyAriOwnerTurn({ text: turn.owner, priorOwnerTexts: prior }),
    ...classifyAriReplyGaps({
      replyText: turn.reply,
      ownerText: turn.owner,
      hasRendition: false,
      errorCodes: turn.errorCodes,
      droppedRoutes: turn.droppedRoutes,
      flowParked: turn.flowParked,
    }),
  ];
}

Deno.test("D2: replaying this morning's host thread yields the expected gap types, and the second failure escalates", () => {
  const prior: string[] = [];
  const logged: { type: string }[] = [];
  const escalations: boolean[] = [];
  for (const turn of MORNING_THREAD) {
    const owner = classifyAriOwnerTurn({
      text: turn.owner,
      priorOwnerTexts: prior,
    });
    escalations.push(
      decideAriEscalation({ ownerSignals: owner, recentGaps: logged })
        .escalate,
    );
    const signals = classifyTurn(turn, prior);
    assertEquals(
      signals.map((signal) => signal.type).sort(),
      [...turn.expected].sort(),
      `turn: ${turn.owner.slice(0, 40)}`,
    );
    logged.push(...signals);
    prior.unshift(turn.owner);
  }
  // Turn 2 is the first failure turn (the discount ask again, refused);
  // turn 3 (the FAVY10 sentence typed again) is the second: Ari changes
  // approach there, not before.
  assertEquals(escalations, [false, false, true, true]);
  // Every excerpt is the host's own words, scrubbed and capped.
  for (const turn of MORNING_THREAD) {
    for (const signal of classifyTurn(turn, [])) {
      assert(signal.excerpt.length <= 240);
    }
  }
});

Deno.test("D2: the frustration lexicon (why, again, not working, useless, !!, ALL CAPS)", () => {
  const cases: [string, boolean, boolean][] = [
    ["why is this not working", true, true],
    ["Why again?", true, true],
    ["This is useless", true, true],
    ["I SAID CREATE THE CODE", true, true],
    ["please!!", true, false],
    ["again", true, false],
    ["I already told you the end date", true, true],
    ["Why is my payout pending?", false, false],
    ["Create a code called FAVY10 for 10% off", false, false],
    ["OK", false, false],
  ];
  for (const [text, frustrated, strong] of cases) {
    const result = detectAriFrustration(text);
    assertEquals(result.frustrated, frustrated, `frustrated: ${text}`);
    assertEquals(result.strong, strong, `strong: ${text}`);
  }
});

Deno.test("D2: a repeated request is the same words or the same request within 3 owner turns", () => {
  assertEquals(
    detectAriRepeat(HOST_FAVY10_SENTENCE, [HOST_FAVY10_SENTENCE]).how,
    "same_text",
  );
  assertEquals(
    detectAriRepeat("make a promo code GIRLSTRIP for 15% off", [
      "thanks",
      "create a discount code FAVY10",
    ]).how,
    "same_intent",
  );
  assertEquals(
    detectAriRepeat("make a promo code GIRLSTRIP for 15% off", [
      "a",
      "b",
      "c",
      "create a discount code FAVY10",
    ]).repeated,
    false,
    "older than 3 owner turns is not a repeat",
  );
  assertEquals(
    detectAriRepeat("yes", ["yes"]).repeated,
    false,
    "short answers",
  );
});

Deno.test("D2: the reply side — refusal, empty reply, tool error, dropped route, park; one per type", () => {
  const types = (args: Parameters<typeof classifyAriReplyGaps>[0]) =>
    classifyAriReplyGaps(args).map((signal) => signal.type);
  assertEquals(
    types({
      replyText: "Mingla doesn't support that yet.",
      hasRendition: false,
    }),
    ["refusal"],
  );
  assertEquals(types({ replyText: "", hasRendition: false }), ["empty_reply"]);
  assertEquals(types({ replyText: "", hasRendition: true }), []);
  assertEquals(
    types({
      replyText: "Done.",
      hasRendition: false,
      errorCodes: ["READ_FAILED", "READ_FAILED"],
    }),
    ["tool_error"],
  );
  assertEquals(
    types({
      replyText: "Open Payments.",
      hasRendition: false,
      droppedRoutes: 2,
    }),
    ["dropped_route"],
  );
  assertEquals(
    types({ replyText: "Here you go.", hasRendition: false, flowParked: true }),
    ["flow_parked"],
  );
  assertEquals(types({ replyText: "Here you go.", hasRendition: false }), []);
});

Deno.test("D2: excerpts are PII-minimised (emails, phones, card-like numbers) and capped", () => {
  const scrubbed = scrubAriExcerpt(
    "Email ada@lantern.example or call +234 803 123 4567 / 08031234567, card 4111 1111 1111 1111, ends 2026-12-19 at 23:59, FAVY10 10%",
  );
  assertNotMatch(scrubbed, /ada@|803 123|08031234567|4111/);
  assertStringIncludes(scrubbed, "[email]");
  assertStringIncludes(scrubbed, "[phone]");
  assertStringIncludes(scrubbed, "[number]");
  assertStringIncludes(scrubbed, "2026-12-19");
  assertStringIncludes(scrubbed, "23:59");
  assertStringIncludes(scrubbed, "FAVY10 10%");
  assertEquals(scrubAriExcerpt("x".repeat(500)).length, 240);
});

Deno.test("D2: gaps are written once per turn through the service RPC, and a failure never throws", async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: 2, error: null });
    },
  } as unknown as SupabaseClient;
  const written = await recordAriTurnGaps({
    service,
    userId: USER,
    conversationId: CHAT,
    messageId: OP,
    turnKey: `${CHAT}:turn-1`,
    signals: [
      { type: "refusal", excerpt: "call me on 08031234567" },
      { type: "refusal", excerpt: "again" },
      { type: "frustration", excerpt: "WHY", strong: true },
    ],
  });
  assertEquals(written, 2);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "ari_record_turn_gaps");
  const gaps = calls[0].args.p_gaps as { type: string; excerpt: string }[];
  assertEquals(gaps.map((gap) => gap.type), ["refusal", "frustration"]);
  assertEquals(gaps[0].excerpt, "call me on [phone]");
  assertEquals(calls[0].args.p_turn_key, `${CHAT}:turn-1`);

  // Nothing to log: no call at all.
  calls.length = 0;
  assertEquals(
    await recordAriTurnGaps({
      service,
      userId: USER,
      conversationId: CHAT,
      messageId: null,
      turnKey: "t",
      signals: [],
    }),
    0,
  );
  assertEquals(calls.length, 0);

  // Fail-soft: an error (the migration not applied yet) and a throw.
  for (
    const failing of [
      {
        rpc: () =>
          Promise.resolve({
            data: null,
            error: { message: "Could not find the function" },
          }),
      },
      { rpc: () => Promise.reject(new Error("network")) },
    ]
  ) {
    assertEquals(
      await recordAriTurnGaps({
        service: failing as unknown as SupabaseClient,
        userId: USER,
        conversationId: CHAT,
        messageId: null,
        turnKey: "t",
        signals: [{ type: "refusal", excerpt: "x" }],
      }),
      0,
    );
  }
});

Deno.test("D4: escalation — a second failure or one strong frustration; one failure or a tool error alone does not", () => {
  const signal = (type: AriGapType, strong = false): AriGapSignal => ({
    type,
    excerpt: "x",
    strong,
  });
  assertEquals(
    decideAriEscalation({
      ownerSignals: [signal("repeated_request")],
      recentGaps: [{ type: "refusal" }],
    }),
    { escalate: true, reason: "second_failure" },
  );
  assertEquals(
    decideAriEscalation({
      ownerSignals: [],
      recentGaps: [{ type: "refusal" }],
    }).escalate,
    false,
  );
  assertEquals(
    decideAriEscalation({
      ownerSignals: [signal("frustration", true)],
      recentGaps: [],
    }),
    { escalate: true, reason: "strong_frustration" },
  );
  assertEquals(
    decideAriEscalation({
      ownerSignals: [],
      recentGaps: [{ type: "tool_error" }, { type: "dropped_route" }],
    }).escalate,
    false,
  );
  // The escalated turn reads the guide first, whatever the words.
  assertEquals(
    ariGuideForcedCalls("it's still not working")[0].name,
    "search_mingla_guide",
  );
  assertMatch(
    ARI_ESCALATION_GUIDANCE,
    /Do not continue, restart or offer any guided setup/,
  );
  assertMatch(ARI_ESCALATION_GUIDANCE, /name the exact screen/);
});

// ── "Ask the Mingla team" ─────────────────────────────────────────────────

function chain(rows: unknown, single?: unknown): Any {
  const self: Record<string, unknown> = {};
  for (
    const method of ["select", "eq", "is", "in", "order", "limit", "gte"]
  ) {
    self[method] = () => self;
  }
  self.maybeSingle = () =>
    Promise.resolve({ data: single ?? null, error: null });
  self.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: rows, error: null });
  return self;
}

/** The host's own client: their groups, gap rows, approvals and the send. */
function hostClient(opts: { recentAsk?: boolean; sendError?: string } = {}) {
  const sends: Record<string, unknown>[] = [];
  const directSends: Record<string, unknown>[] = [];
  const client = {
    sends,
    directSends,
    rpc(name: string, params?: Record<string, unknown>) {
      if (name === "issue_3720_list_brand_groups") {
        return Promise.resolve({
          data: [{
            conversation_id: GROUP,
            brand_id: BRAND,
            access_kind: "brand",
          }],
          error: null,
        });
      }
      if (name === "ari_tell_owner_receipt") {
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "issue_3720_send_brand_group_message") {
        directSends.push(params ?? {});
        return Promise.resolve({ data: "m1", error: null });
      }
      if (name === "ari_tell_owner_in_brand_group") {
        if (opts.sendError) {
          return Promise.resolve({
            data: null,
            error: { message: opts.sendError },
          });
        }
        sends.push(params ?? {});
        return Promise.resolve({
          data: {
            sent: true,
            message_id: "m1",
            conversation_id: GROUP,
            replayed: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `no ${name}` } });
    },
    from(table: string) {
      if (table === "profiles") return chain(null, { first_name: "Ada" });
      if (table === "brands") return chain(null, { name: "Favy Lagos" });
      if (table === "ari_capability_gap_events") {
        return chain([
          {
            id: GAP2,
            gap_type: "repeated_request",
            excerpt: "Create a discount code FAVY10, call me on [phone]",
            created_at: "2026-11-10T09:53:46Z",
          },
          {
            id: GAP1,
            gap_type: "refusal",
            excerpt: "Create a discount code FAVY10, call me on [phone]",
            created_at: "2026-11-10T09:51:52Z",
          },
        ]);
      }
      if (table === "agent_pending_actions") {
        return chain(opts.recentAsk ? [{ id: OP }] : []);
      }
      return chain([]);
    },
  };
  return client as unknown as SupabaseClient & {
    sends: typeof sends;
    directSends: typeof directSends;
  };
}

function tellTool(): Any {
  return ARI_10X_TOOLS.find((t) => t.name === "tell_owner_in_brand_group")!;
}

Deno.test("D4: offering 'Ask the Mingla team' writes the note server-side and sends nothing", async () => {
  const client = hostClient();
  const args = await bindOwnerNoteProposal(
    "tell_owner_in_brand_group",
    {
      brand_id: BRAND,
      about: ARI_ASK_TEAM_TOPIC,
      ari_conversation_id: CHAT,
      message: "MODEL WORDS ARE IGNORED",
    },
    client,
    USER,
  );
  assertEquals(args.about, ARI_ASK_TEAM_TOPIC);
  assertEquals(args.ari_conversation_id, CHAT);
  assertEquals(args.gap_ids, [GAP1, GAP2], "oldest first, bound by id");
  assertEquals(args.send_to, "Favy Lagos group chat");
  const message = String(args.message);
  assertMatch(
    message,
    /^Ada asked Ari for help with Favy Lagos and Ari couldn't finish it\./,
  );
  assertStringIncludes(
    message,
    '"Create a discount code FAVY10, call me on [phone]"',
  );
  assertStringIncludes(
    message,
    "Ari said it couldn't do it, then was asked the same thing again.",
  );
  assertStringIncludes(message, `(Ari chat ${CHAT.slice(0, 8)})`);
  assertNotMatch(message, /MODEL WORDS/);
  assertEquals(ownerCopyViolations(message), []);
  assertEquals(
    client.sends.length + client.directSends.length,
    0,
    "no send without the tap",
  );
});

Deno.test("D4: the host's tap sends exactly one brand-group note through the receipt-backed RPC", async () => {
  const client = hostClient();
  const args = await bindOwnerNoteProposal(
    "tell_owner_in_brand_group",
    { brand_id: BRAND, about: ARI_ASK_TEAM_TOPIC, ari_conversation_id: CHAT },
    client,
    USER,
  );
  const result = await tellTool().executor(args, client, USER, {
    operationId: OP,
  });
  assertEquals(result.sent, true);
  assertEquals(client.sends.length, 1);
  assertEquals(client.directSends.length, 0, "never a second rail");
  assertEquals(client.sends[0].p_operation_id, OP);
  assertEquals(client.sends[0].p_conversation_id, GROUP);
  assertEquals(client.sends[0].p_content, args.message);

  // Words that are not what the server would write are refused, unsent.
  const altered = hostClient();
  const error = await assertRejects(
    () =>
      tellTool().executor(
        { ...args, message: `${args.message} Please hurry.` },
        altered,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals((error as ToolError).code, "OWNER_NOTE_CHANGED");
  assertEquals(altered.sends.length, 0);
});

Deno.test("D4: once per Ari conversation per hour — at the offer and at the send", async () => {
  const offered = await assertRejects(
    () =>
      bindOwnerNoteProposal(
        "tell_owner_in_brand_group",
        {
          brand_id: BRAND,
          about: ARI_ASK_TEAM_TOPIC,
          ari_conversation_id: CHAT,
        },
        hostClient({ recentAsk: true }),
        USER,
      ),
    ToolError,
  );
  assertEquals((offered as ToolError).code, "ASK_TEAM_RECENTLY_SENT");
  assertMatch(
    (offered as ToolError).user_reason,
    /already asked the Mingla team/,
  );

  const client = hostClient({ sendError: "ask_team_recently_sent" });
  const args = await bindOwnerNoteProposal(
    "tell_owner_in_brand_group",
    { brand_id: BRAND, about: ARI_ASK_TEAM_TOPIC, ari_conversation_id: CHAT },
    hostClient(),
    USER,
  );
  const sent = await assertRejects(
    () => tellTool().executor(args, client, USER, { operationId: OP }),
    ToolError,
  );
  assertEquals((sent as ToolError).code, "ASK_TEAM_RECENTLY_SENT");
});

Deno.test("D4: the note words stay short and minimal", () => {
  const text = askTeamNoteText({
    firstName: null,
    brandName: "Favy Lagos",
    asked: ["a".repeat(400), "email ada@x.example", "third ask"],
    tried: ["refusal", "refusal", "frustration"],
    chatRef: "c1c1c1c1",
  });
  assert(text.length <= 600);
  assertMatch(text, /^A host asked Ari/);
  assertNotMatch(text, /ada@x|third ask/);
});

Deno.test("D2/D4: agent-chat, the flow engine and feedback are wired", () => {
  const chat = read("supabase/functions/agent-chat/index.ts");
  // Owner signals before the flow engine, recorded with the service client.
  const owner = chat.indexOf("classifyAriOwnerTurn({");
  const flow = chat.indexOf("const decision = await decideFlowTurn({");
  assert(
    owner > 0 && owner < flow,
    "owner signals are read before the flow engine",
  );
  assertMatch(chat, /escalate: escalation\.escalate,/);
  assertMatch(
    chat,
    /signals: \[\{ type: "flow_parked", excerpt: semanticMessage \}\]/,
  );
  // Reply signals at the one text commit boundary.
  assertMatch(chat, /signals: classifyAriReplyGaps\(\{/);
  // Escalation: guide first, guidance, then the offer as a protected proposal.
  assertMatch(
    chat,
    /escalation\.escalate\s*\? ariGuideForcedCalls\(semanticMessage\)/,
  );
  assertMatch(
    chat,
    /escalation\.escalate \? `\\n\\n\$\{ARI_ESCALATION_GUIDANCE\}` : ""/,
  );
  const offer = chat.indexOf("about: ARI_ASK_TEAM_TOPIC,");
  const authorize = chat.indexOf(
    "await authorizeAgentTool(tool, askArgs",
    offer,
  );
  const persist = chat.indexOf("return await commitPendingTurn({", offer);
  assert(
    offer > 0 && authorize > offer && persist > authorize,
    "bind → authorize → proposal",
  );
  // The flow engine parks the open run for a stuck host.
  const runner = read("supabase/functions/_shared/ariFlows/runner.ts");
  assertMatch(
    runner,
    /if \(input\.escalate && open\) return await parkOrPass\("repeated"\);/,
  );
  // A thumbs down is a gap.
  const feedback = read("supabase/functions/ari-message-feedback/index.ts");
  assertMatch(feedback, /type: "negative_feedback"/);
  assertMatch(feedback, /turnKey: `feedback:\$\{assistant\.id\}`/);
});
