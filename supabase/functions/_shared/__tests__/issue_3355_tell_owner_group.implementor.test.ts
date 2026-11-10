// Issue #3355 P6 follow-up — "Tell the owner" posts in the brand group chat
// (Seth, 2026-11-01). Implementor happy path + edges.
//
// MINGLA-INVARIANT: I-ARI-OWNER-NOTE-CONFIRMED-AS-CALLER | issue #3355 | Ari posts a "tell the owner" note only through the confirmed write tell_owner_in_brand_group: the server writes the exact words shown on the card, the confirm sends them as the caller at most once per approval (receipt-backed; a retry reads the posted note back), a cancel or unconfirmed proposal sends nothing, and a caller with no group they can post in is sent to the Team screen instead.
//
//   * open_handoff tells a teammate a group note is possible, or falls back
//     to the Team screen with a plain sentence when they can't post;
//   * proposing writes the note server-side (model words are ignored) and
//     never sends anything;
//   * confirming sends exactly one group message with the shown text, as the
//     caller, in brand mode;
//   * a non-member (no group they can post in) falls back, at propose and at
//     confirm;
//   * the note has no internal words; the tool is a confirmed write that is
//     registered everywhere the registry requires;
//   * the money step's "Tell them" choice becomes the same protected proposal.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_tell_owner_group.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import {
  ARI_10X_AGENT_STATE,
  ARI_10X_TOOLS,
  bindOwnerNoteProposal,
  OWNER_NOTE_TEAM_FALLBACK,
  OWNER_ONLY_HANDOFF_MESSAGE,
  ownerNoteText,
} from "../agentAri10xTools.ts";
import {
  AGENT_TOOL_AUTHORIZATION,
  OWNER_SPOKEN_REFUSAL_CODES,
} from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import { buildProposalPresentation } from "../ariPresentation/registry.ts";
import { WRITE_TOOL_OWNER_COPY } from "../ariPresentation/toolLabels.ts";
import { WRITE_TOOL_OWNER_COPY as HOST_COPY } from "../../../../mingla-business/src/components/ari/toolProposalCopy.ts";
import { moneyGateStep } from "../ariFlows/moneyGate.ts";
import {
  isAmbiguousExecutionFailure,
  requiresOperationReceipt,
  toolErrorHttpStatus,
} from "../../agent-confirm-action/executionOutcome.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_BRAND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const NOTE =
  "Ada asked Ari to set up payments for Lantern Supper Club. Only the owner can do this. Could you take a look? It's in Mingla Host under Lantern Supper Club > Payments.";

function chain(result: unknown): Any {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "limit"]) {
    self[method] = () => self;
  }
  self.maybeSingle = () => Promise.resolve({ data: result, error: null });
  return self;
}

interface SentMessage {
  p_operation_id: string;
  p_conversation_id: string;
  p_content: string;
}

/** A teammate's own Supabase client (their sign-in), with a call log. */
function teammateClient(opts: {
  groups?: Record<string, unknown>[];
  isOwner?: boolean;
  firstName?: string | null;
  /** The receipt a retried approval finds (#3355 bundle 5). */
  receipt?: Record<string, unknown> | null;
  brandName?: string;
  /** The send RPC's database error, if it refuses. */
  sendError?: string;
  /** The receipt read's error (a missing function before the migration). */
  receiptError?: string;
}) {
  const sent: SentMessage[] = [];
  const legacy: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const client = {
    rpc(name: string, params?: Record<string, unknown>) {
      calls.push(name);
      if (name === "issue_3720_list_brand_groups") {
        return Promise.resolve({
          data: opts.groups ?? [{
            conversation_id: GROUP,
            brand_id: BRAND,
            brand_name: "Lantern Supper Club",
            access_kind: "brand",
          }],
          error: null,
        });
      }
      if (name === "biz_can_mutate_payouts_for_brand_for_caller") {
        return Promise.resolve({ data: opts.isOwner === true, error: null });
      }
      if (name === "ari_tell_owner_receipt") {
        return Promise.resolve(
          opts.receiptError
            ? { data: null, error: { message: opts.receiptError } }
            : { data: opts.receipt ?? null, error: null },
        );
      }
      if (name === "issue_3720_send_brand_group_message") {
        legacy.push(params ?? {});
        return Promise.resolve({ data: SENT_ID, error: null });
      }
      if (name === "ari_tell_owner_in_brand_group" && opts.sendError) {
        return Promise.resolve({
          data: null,
          error: { message: opts.sendError },
        });
      }
      if (name === "ari_tell_owner_in_brand_group") {
        sent.push(params as unknown as SentMessage);
        return Promise.resolve({
          data: {
            sent: true,
            message_id: SENT_ID,
            conversation_id: params?.p_conversation_id,
            replayed: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "profiles") {
        return chain({
          first_name: opts.firstName === undefined ? "Ada" : opts.firstName,
          display_name: "Ada Obi",
        });
      }
      if (table === "brands") {
        return chain({ name: opts.brandName ?? "Lantern Supper Club" });
      }
      return chain(null);
    },
  };
  return { client: client as Any, sent, calls, legacy };
}

function rawTool(name: string): Any {
  return ARI_10X_TOOLS.find((t) => t.name === name)!;
}

Deno.test("owner note: open_handoff offers a group note to a teammate, or the Team screen when they can't post", async () => {
  const withGroup = teammateClient({});
  const offered = await rawTool("open_handoff").executor(
    { destination: "payment_onboarding", brand_id: BRAND },
    withGroup.client,
    USER,
  );
  assertEquals(offered.requires_owner, true);
  assertEquals(offered.message, OWNER_ONLY_HANDOFF_MESSAGE);
  assertEquals(offered.tell_owner.via, "brand_group");
  assertEquals(offered.tell_owner.about, "payment_setup");
  assertEquals(withGroup.sent.length, 0, "a handoff never sends anything");

  // Not a member of this brand's group (only another brand's, or support).
  for (
    const groups of [
      [],
      [{ conversation_id: GROUP, brand_id: OTHER_BRAND, access_kind: "brand" }],
      [{ conversation_id: GROUP, brand_id: BRAND, access_kind: "support" }],
    ]
  ) {
    const noGroup = teammateClient({ groups });
    const fallback = await rawTool("open_handoff").executor(
      { destination: "payment_onboarding", brand_id: BRAND },
      noGroup.client,
      USER,
    );
    assertEquals(fallback.tell_owner.via, "team_screen");
    assertEquals(fallback.tell_owner.route, `/brand/${BRAND}/team`);
    assertEquals(fallback.tell_owner.message, OWNER_NOTE_TEAM_FALLBACK);
    assertEquals(ownerCopyViolations(OWNER_NOTE_TEAM_FALLBACK, "prose"), []);
  }
});

Deno.test("owner note: proposing writes the exact words server-side and sends nothing", async () => {
  const teammate = teammateClient({});
  const args = await bindOwnerNoteProposal(
    "tell_owner_in_brand_group",
    {
      brand_id: BRAND,
      about: "payment_setup",
      message: "Pay up now or else", // model words are never used
    },
    teammate.client,
    USER,
  );
  assertEquals(args.message, NOTE);
  assertEquals(args.send_to, "Lantern Supper Club group chat");
  assertEquals(teammate.sent.length, 0);
  assert(!teammate.calls.includes("issue_3720_send_brand_group_message"));
  // The card shows exactly that text, plus where it goes.
  const card = buildProposalPresentation("tell_owner_in_brand_group", args);
  assertEquals(card.verb, "Message the owner");
  assertEquals(card.title, "Tell the owner");
  assert(card.fields.some((f) => f.label === "Message" && f.value === NOTE));
  assert(
    card.fields.some((f) =>
      f.label === "Send to" && f.value === "Lantern Supper Club group chat"
    ),
  );
  for (const field of card.fields) {
    assertEquals(ownerCopyViolations(field.value, "prose"), [], field.label);
  }
  // Other tools pass through untouched.
  const other = { brand_id: BRAND };
  assertEquals(
    await bindOwnerNoteProposal("update_brand", other, teammate.client, USER),
    other,
  );
});

Deno.test("owner note: confirming sends exactly one group message with the shown text, as the caller", async () => {
  const teammate = teammateClient({});
  const args = await bindOwnerNoteProposal(
    "tell_owner_in_brand_group",
    { brand_id: BRAND, about: "payment_setup" },
    teammate.client,
    USER,
  );
  const result = await rawTool("tell_owner_in_brand_group").executor(
    args,
    teammate.client,
    USER,
    { operationId: OP },
  );
  // #3355 bundle 5: one receipt-backed send, keyed by the approval.
  assertEquals(teammate.sent, [{
    p_operation_id: OP,
    p_conversation_id: GROUP,
    p_content: NOTE,
  }]);
  assertEquals(result.sent, true);
  assertEquals(result.message_id, SENT_ID);
  assertEquals(result.message, NOTE);
  // Without its approval the note is never sent.
  const unbound = teammateClient({});
  const refused = await assertRejects(
    () =>
      rawTool("tell_owner_in_brand_group").executor(
        args,
        unbound.client,
        USER,
        {},
      ),
    ToolError,
  );
  assertEquals(refused.code, "OPERATION_ID_REQUIRED");
  assertEquals(unbound.sent.length, 0);
});

Deno.test("owner note: cancel sends nothing — the note is a confirmed write, never run inline", () => {
  assert(!READ_ONLY_TOOL_NAMES.has("tell_owner_in_brand_group"));
  assert(!ARI_10X_AGENT_STATE.has("tell_owner_in_brand_group"));
  // Only the executor (reached only through agent-confirm-action) sends.
  const source = Deno.readTextFileSync(
    new URL("../agentAri10xTools.ts", import.meta.url),
  );
  // #3355 bundle 5: one receipt-backed send, and the pre-migration send
  // only behind the missing-function check.
  assertEquals(
    source.match(/"ari_tell_owner_in_brand_group"/g)?.length,
    1,
  );
  assertEquals(
    source.match(/"issue_3720_send_brand_group_message"/g)?.length,
    1,
  );
  const legacyAt = source.indexOf('"issue_3720_send_brand_group_message"');
  assert(source.lastIndexOf("if (!receipts) {", legacyAt) > source.indexOf("const tellOwnerInBrandGroup"));
  const binder = source.slice(
    source.indexOf("export async function bindOwnerNoteProposal"),
    source.indexOf("const tellOwnerInBrandGroup"),
  );
  assert(!binder.includes("ari_tell_owner_in_brand_group\""));
});

Deno.test("owner note: a teammate with no group they can post in falls back to the Team screen, at propose and at confirm", async () => {
  const outsider = teammateClient({ groups: [] });
  const refused = await assertRejects(
    () =>
      bindOwnerNoteProposal(
        "tell_owner_in_brand_group",
        { brand_id: BRAND, about: "payment_setup" },
        outsider.client,
        USER,
      ),
    ToolError,
  );
  assertEquals(refused.code, "OWNER_NOTE_UNAVAILABLE");
  assertEquals(refused.message, `${OWNER_NOTE_TEAM_FALLBACK} Nothing was sent.`);
  assert(OWNER_SPOKEN_REFUSAL_CODES.has("OWNER_NOTE_UNAVAILABLE"));
  // Removed from the group between the card and the confirm.
  const atConfirm = await assertRejects(
    () =>
      rawTool("tell_owner_in_brand_group").executor(
        { brand_id: BRAND, about: "payment_setup", message: NOTE },
        outsider.client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(atConfirm.code, "OWNER_NOTE_UNAVAILABLE");
  assertEquals(outsider.sent.length, 0);
  assertEquals(toolErrorHttpStatus("OWNER_NOTE_UNAVAILABLE"), 409);
  // The owner is told to do it themselves; nothing is sent.
  const owner = teammateClient({ isOwner: true });
  const notNeeded = await assertRejects(
    () =>
      bindOwnerNoteProposal(
        "tell_owner_in_brand_group",
        { brand_id: BRAND, about: "payment_setup" },
        owner.client,
        USER,
      ),
    ToolError,
  );
  assertEquals(notNeeded.code, "OWNER_NOTE_NOT_NEEDED");
  assertEquals(owner.sent.length, 0);
  // A note that doesn't match the server's words is never sent.
  const teammate = teammateClient({});
  const altered = await assertRejects(
    () =>
      rawTool("tell_owner_in_brand_group").executor(
        { brand_id: BRAND, about: "payment_setup", message: "Something else" },
        teammate.client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(altered.code, "OWNER_NOTE_CHANGED");
  assertEquals(teammate.sent.length, 0);
});

Deno.test("owner note: the text has no internal words", () => {
  for (const firstName of ["Ada", null, "  "]) {
    const text = ownerNoteText({
      teammateFirstName: firstName,
      brandName: "Lantern Supper Club",
      topic: "payment_setup",
    });
    assertEquals(ownerCopyViolations(text, "label"), []);
    assert(!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text), "no ids");
    assert(!/_/.test(text), "no keys or tool names");
    assertMatch(text, /Only the owner can do this\. Could you take a look\?/);
  }
  assertMatch(
    ownerNoteText({
      teammateFirstName: null,
      brandName: "Lantern",
      topic: "payment_setup",
    }),
    /^A teammate asked Ari to set up payments for Lantern\./,
  );
});

Deno.test("owner note: the write tool is registered everywhere the registry requires", () => {
  const tool = AGENT_TOOLS.find((t) => t.name === "tell_owner_in_brand_group");
  assert(tool, "registered in AGENT_TOOLS");
  assertEquals(AGENT_TOOL_AUTHORIZATION.tell_owner_in_brand_group, {
    requiredRole: "scanner",
    resource: "brand",
  });
  assertEquals(
    HOST_COPY.tell_owner_in_brand_group,
    WRITE_TOOL_OWNER_COPY.tell_owner_in_brand_group,
  );
  const prompt = Deno.readTextFileSync(
    new URL("../agentSystemPrompt.ts", import.meta.url),
  );
  assertMatch(prompt, /^- tell_owner_in_brand_group — /m);
  const chat = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  // Every proposal path (model loop, legacy model path, flow answer) binds.
  assertEquals(chat.match(/await bindOwnerNoteProposal\(/g)?.length, 3);
});

Deno.test("owner note: the money step's 'Tell them' becomes the same protected proposal", async () => {
  const outcome = await moneyGateStep.onAnswer!(
    {
      run: {
        brand_id: BRAND,
        current_artefact: {
          handoff: {
            item_label: "Ready to sell paid tickets",
            route: `/brand/${BRAND}/payments/onboard`,
          },
        },
      },
      state: { item_key: "money.can_sell" },
    } as Any,
    "tell_owner",
  );
  assertEquals(outcome?.propose, {
    tool_name: "tell_owner_in_brand_group",
    tool_args: { brand_id: BRAND, about: "payment_setup" },
  });
});

Deno.test("owner note: a retry after a dropped connection answers from the receipt, even if the brand was renamed or the group left since", async () => {
  const receipt = {
    sent: true,
    message_id: SENT_ID,
    conversation_id: GROUP,
    replayed: true,
  };
  for (
    const retry of [
      teammateClient({ receipt, brandName: "Lantern Dining Room" }),
      teammateClient({ receipt, groups: [] }),
    ]
  ) {
    const result = await rawTool("tell_owner_in_brand_group").executor(
      { brand_id: BRAND, about: "payment_setup", message: NOTE },
      retry.client,
      USER,
      { operationId: OP },
    );
    assertEquals(result.sent, true);
    assertEquals(result.message_id, SENT_ID);
    assertEquals(result.message, NOTE);
    // Nothing is posted again, and no freshness check runs first.
    assertEquals(retry.sent.length, 0);
    assertEquals(retry.calls[0], "ari_tell_owner_receipt");
    assert(!retry.calls.includes("ari_tell_owner_in_brand_group"));
  }
  // No receipt yet: a renamed brand still refuses the stale words.
  const fresh = teammateClient({ brandName: "Lantern Dining Room" });
  const stale = await assertRejects(
    () =>
      rawTool("tell_owner_in_brand_group").executor(
        { brand_id: BRAND, about: "payment_setup", message: NOTE },
        fresh.client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(stale.code, "OWNER_NOTE_CHANGED");
  assertEquals(fresh.sent.length, 0);
});

Deno.test("owner note: a certain refusal from the send ends the approval; only a transport failure stays unknown", async () => {
  const cases: Array<[string, string | null]> = [
    ["conversation_unavailable", "OWNER_NOTE_UNAVAILABLE"],
    ["operation_binding_mismatch", "OWNER_NOTE_CHANGED"],
    ["operation_not_executing", "OWNER_NOTE_CHANGED"],
    ["invalid_message", "OWNER_NOTE_CHANGED"],
    // A receipt exists, so a note may have posted: never "nothing was sent".
    ["idempotency_conflict", null],
    ["fetch failed: connection reset", null],
  ];
  for (const [dbError, code] of cases) {
    const teammate = teammateClient({ sendError: dbError });
    const err = await assertRejects(
      () =>
        rawTool("tell_owner_in_brand_group").executor(
          { brand_id: BRAND, about: "payment_setup", message: NOTE },
          teammate.client,
          USER,
          { operationId: OP },
        ),
      ToolError,
    );
    if (code) {
      assertEquals(err.code, code, dbError);
      assertEquals(isAmbiguousExecutionFailure(true, err), false, dbError);
      assertEquals(toolErrorHttpStatus(err.code), 409, dbError);
    } else {
      assertEquals(err.code, "RPC_FAILED");
      assertEquals(isAmbiguousExecutionFailure(true, err), true);
    }
  }
});

Deno.test("owner note: before its migration is applied the note still sends, and confirm doesn't wait for a receipt it never wrote", async () => {
  const missing =
    "Could not find the function public.ari_tell_owner_receipt(p_operation_id) in the schema cache";
  const teammate = teammateClient({ receiptError: missing });
  const result = await rawTool("tell_owner_in_brand_group").executor(
    { brand_id: BRAND, about: "payment_setup", message: NOTE },
    teammate.client,
    USER,
    { operationId: OP },
  );
  assertEquals(teammate.legacy, [{
    p_conversation_id: GROUP,
    p_content: NOTE,
    p_actor_mode: "brand",
  }]);
  assertEquals(teammate.sent.length, 0);
  assertEquals(result.sent, true);
  assertEquals(result.receipt_backed, false);
  assertEquals(requiresOperationReceipt(true, result), false);
  // Receipt-backed results (and every other tool) still need their receipt.
  assertEquals(requiresOperationReceipt(true, { sent: true }), true);
  assertEquals(requiresOperationReceipt(true, null), true);
  assertEquals(requiresOperationReceipt(false, { receipt_backed: false }), false);
  // Any other failure of the receipt read is not a reason to send: unknown.
  const flaky = teammateClient({ receiptError: "fetch failed" });
  const err = await assertRejects(
    () =>
      rawTool("tell_owner_in_brand_group").executor(
        { brand_id: BRAND, about: "payment_setup", message: NOTE },
        flaky.client,
        USER,
        { operationId: OP },
      ),
    ToolError,
  );
  assertEquals(err.code, "RPC_FAILED");
  assertEquals(isAmbiguousExecutionFailure(true, err), true);
  assertEquals(flaky.legacy.length + flaky.sent.length, 0);
});
