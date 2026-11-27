// MINGLA-INVARIANT: I-ARI-ONE-OWNER-COPY-CHOKEPOINT | issue #4637 | Host-visible Ari strings pass the owner emission gate before persistence.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emitOwnerText } from "../ariOwnerEmit.ts";
import { buildAriFailureReply } from "../ariFailureCopy.ts";
import {
  buildProposalPresentation,
  proposalOwnerLead,
} from "../ariPresentation/registry.ts";
import { isOwnerSafe } from "../ariOwnerCopy.ts";
import { buildToolReceiptRendition } from "../ariRendition.ts";

Deno.test("model prose drops pseudo calls, engine prefixes and JSON spans", () => {
  assertEquals(
    emitOwnerText(
      "reply",
      "Your event has 2 tiers. [mingla_tool_call name=list_events] {}",
    ),
    "Your event has 2 tiers.",
  );
  assertEquals(
    emitOwnerText("reply", 'Check: VALIDATION_FAILED. {"tool_code":"x"}'),
    "I have an answer, but I couldn't put it in plain words. Ask me again and I'll keep it simple.",
  );
  assertEquals(emitOwnerText("card_label", "Scope kind:"), "");
  assertEquals(emitOwnerText("card_label", "EVENT_SCOPE"), "");
  assertEquals(emitOwnerText("card_value", "create_discount"), "");
  assertEquals(
    emitOwnerText("reply", "Truth: INTERNAL_CODE", {
      fallback: "Check: SECRET_CODE",
    }),
    "I have an answer, but I couldn't put it in plain words. Ask me again and I'll keep it simple.",
  );
});

Deno.test("failure and proposal corpora are owner-safe and non-empty", () => {
  for (
    const code of [
      "MODEL_ERROR",
      "MODEL_TIMEOUT",
      "RPC_FAILED",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_ARGS",
      "RATE_LIMITED",
      "INTERNAL",
    ]
  ) {
    const reply = buildAriFailureReply({ errorCode: code });
    assert(reply.text.length > 0);
    assert(isOwnerSafe(reply.text, "prose"), `${code}: ${reply.text}`);
    assert(!/[A-Z]{2,}(?:_[A-Z]{2,})+/.test(reply.text));
  }
  const args = {
    name: "WELCOME20",
    value_bps: 2000,
    scope_kind: "items",
    targets: [{ target_kind: "ticket_type", target_id: crypto.randomUUID() }],
  };
  const presentation = buildProposalPresentation("create_discount", args);
  for (const field of presentation.fields) {
    assert(isOwnerSafe(field.label, "label"));
    assert(field.value.length > 0);
  }
  assertStringIncludes(proposalOwnerLead("create_discount", args), "Confirm");
});

Deno.test("proposal titles and flow rows cannot bypass the chokepoint", () => {
  const presentation = buildProposalPresentation("create_discount", {
    name: "WELCOME20",
    __proposal_context: {
      flow_title: "Truth: INTERNAL_CODE",
      flow_rows_only: true,
      flow_rows: [
        { label: "Dest:", value: '{"target":"all"}' },
        { label: "Scope", value: "OWNER_AMENDED" },
      ],
    },
  });
  assert(isOwnerSafe(presentation.title, "label"));
  assertEquals(presentation.title.includes("INTERNAL_CODE"), false);
  assertEquals(presentation.fields, [{ label: "Name", value: "WELCOME20" }]);
});

Deno.test("receipt result data cannot expose tool names or engine codes", () => {
  const receipt = buildToolReceiptRendition({
    toolName: "publish_event",
    result: { name: "create_discount", status: "PAYOUT_NOT_READY" },
    pendingActionId: crypto.randomUUID(),
    capabilities: {
      protocol_version: 2,
      max_schema_version: 2,
      block_version: 1,
      action_version: 1,
      block_types: ["key_value"],
      graphic_types: [],
      platform: "web",
      app_version: "test",
      runtime_version: null,
    },
    envValue: "true",
  });
  const serialized = JSON.stringify(receipt);
  assertEquals(serialized.includes("create_discount"), false);
  assertEquals(serialized.includes("PAYOUT_NOT_READY"), false);
  assertEquals(serialized.includes("PAYOUT NOT READY"), false);
  assertEquals(serialized.includes('"label":"Status"'), false);
});

Deno.test("authoritative persistence paths call the chokepoint", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const confirm = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  const confirmNext = await Deno.readTextFile(
    new URL("../../agent-confirm-action/confirmNext.ts", import.meta.url),
  );
  const flowEdge = await Deno.readTextFile(
    new URL("../ariFlows/edge.ts", import.meta.url),
  );
  const flowResume = await Deno.readTextFile(
    new URL("../../agent-turn-control/flowResume.ts", import.meta.url),
  );
  assertStringIncludes(chat, 'emitOwnerText(\n    "reply"');
  assertStringIncludes(chat, "proposalOwnerLead(args.toolName, proposalArgs)");
  assertStringIncludes(confirm, "buildAriFailureReply");
  assertStringIncludes(confirm, "proposalOwnerLead(");
  assertStringIncludes(confirmNext, "emitOwnerText(");
  assertEquals(confirmNext.includes("assertOwnerCopy"), false);
  assertStringIncludes(flowEdge, "flowOwnerText(args.text, args.artefact)");
  assertStringIncludes(flowEdge, 'emitOwnerText("reply"');
  assertStringIncludes(
    flowResume,
    "flowOwnerText(outcome.text, outcome.artefact)",
  );
});
