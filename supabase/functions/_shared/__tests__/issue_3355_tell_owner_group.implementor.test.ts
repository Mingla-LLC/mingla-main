// Issue #3355 P6 follow-up — "Tell the owner" posts in the brand group chat
// (Seth, 2026-11-01). Implementor happy path + edges.
//
// MINGLA-INVARIANT: I-ARI-OWNER-NOTE-CONFIRMED-AS-CALLER | issue #3355 | Ari posts a "tell the owner" note in the brand group chat only through the confirmed write tool tell_owner_in_brand_group: the server writes the exact words shown on the card (no codes, ids or tool names), the confirm sends exactly that text once through issue_3720_send_brand_group_message as the caller, a cancel or an unconfirmed proposal sends nothing, and a caller with no group they can post in is sent to the Team screen instead.
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
import { toolErrorHttpStatus } from "../../agent-confirm-action/executionOutcome.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_BRAND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  p_conversation_id: string;
  p_content: string;
  p_actor_mode: string;
}

/** A teammate's own Supabase client (their sign-in), with a call log. */
function teammateClient(opts: {
  groups?: Record<string, unknown>[];
  isOwner?: boolean;
  firstName?: string | null;
}) {
  const sent: SentMessage[] = [];
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
      if (name === "issue_3720_send_brand_group_message") {
        sent.push(params as unknown as SentMessage);
        return Promise.resolve({
          data: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
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
      if (table === "brands") return chain({ name: "Lantern Supper Club" });
      return chain(null);
    },
  };
  return { client: client as Any, sent, calls };
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
    {},
  );
  assertEquals(teammate.sent, [{
    p_conversation_id: GROUP,
    p_content: NOTE,
    p_actor_mode: "brand",
  }]);
  assertEquals(result.sent, true);
  assertEquals(result.message, NOTE);
});

Deno.test("owner note: cancel sends nothing — the note is a confirmed write, never run inline", () => {
  assert(!READ_ONLY_TOOL_NAMES.has("tell_owner_in_brand_group"));
  assert(!ARI_10X_AGENT_STATE.has("tell_owner_in_brand_group"));
  // Only the executor (reached only through agent-confirm-action) sends.
  const source = Deno.readTextFileSync(
    new URL("../agentAri10xTools.ts", import.meta.url),
  );
  assertEquals(
    source.match(/"issue_3720_send_brand_group_message"/g)?.length,
    1,
  );
  const binder = source.slice(
    source.indexOf("export async function bindOwnerNoteProposal"),
    source.indexOf("const tellOwnerInBrandGroup"),
  );
  assert(!binder.includes("issue_3720_send_brand_group_message"));
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
        {},
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
        {},
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
