// #4382 — Ari's support reply goes through support-send (status rules, audit
// and Support alerts apply) and never inserts into messages directly.
//
// Run:
//   deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_4382_ari_support.implementor.test.ts

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const USER = "77777777-7777-4777-8777-777777777777";
const TICKET = "43820000-0000-4000-8000-000000000101";
const CONV = "43820000-0000-4000-8000-0000000000c0";

function tool(name: string) {
  const found = DOMAIN_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

// deno-lint-ignore no-explicit-any
function client(
  invokeResult: { data: unknown; error: unknown },
): {
  client: any;
  inserts: string[];
  invokes: { name: string; body: unknown }[];
} {
  const inserts: string[] = [];
  const invokes: { name: string; body: unknown }[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (table: string): any => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) self[m] = () => self;
    self.insert = () => {
      inserts.push(table);
      return self;
    };
    self.single = () => Promise.resolve({ data: { id: "x" }, error: null });
    self.maybeSingle = () =>
      Promise.resolve({
        data: table === "support_tickets"
          ? { id: TICKET, conversation_id: CONV }
          : null,
        error: null,
      });
    return self;
  };
  return {
    client: {
      from: chain,
      functions: {
        invoke: (name: string, opts: { body: unknown }) => {
          invokes.push({ name, body: opts.body });
          return Promise.resolve(invokeResult);
        },
      },
    },
    inserts,
    invokes,
  };
}

Deno.test("reply goes through support-send as the requester", async () => {
  const { client: c, inserts, invokes } = client({
    data: { ok: true, message_id: "m-1" },
    error: null,
  });
  const out = await tool("manage_support_inbox").executor(
    { action: "reply", ticket_id: TICKET, content: "  Still broken  " },
    c,
    USER,
  ) as Record<string, unknown>;
  assertEquals(inserts, [], "no direct messages insert");
  assertEquals(invokes, [{
    name: "support-send",
    body: { ticketId: TICKET, content: "Still broken", actorMode: "requester" },
  }]);
  assertEquals(out.message_id, "m-1");
  assertEquals(out.replied, true);
});

Deno.test("a refused send surfaces as a tool error, not a silent success", async () => {
  const { client: c } = client({
    data: null,
    error: new Error("Edge Function returned a non-2xx status code"),
  });
  await assertRejects(
    () =>
      tool("manage_support_inbox").executor(
        { action: "reply", ticket_id: TICKET, content: "hi" },
        c,
        USER,
      ),
    ToolError,
  );
});
