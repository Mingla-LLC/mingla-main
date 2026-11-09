// #4273 tester P2 — the SMS opt-out page.
//   S-1 a GET (a link scanner, a preview, a person opening it) changes nothing
//       and shows one button that POSTs.
//   S-2 the POST writes a marketing_unsubscribes row: the number (looked up by
//       message id and campaign, never carried in the link), channel sms,
//       scope 'account' keyed to the host account that owns the sending brand
//       (Seth's Q1). It writes NO channel_suppressions row, so ticket, RSVP and
//       verification texts still arrive.
//   S-3 a second POST adds no second row.
//   S-4 a message that is not this campaign's is refused and writes nothing.
// The database half (the row withholds this host's brands only, transactional
// can_send still passes) is issue_4273_sms_optout_link.implementor.pg17.test.sql.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleSmsOptOut } from "./smsOptOut.ts";

const PAYLOAD = {
  campaign_id: "42730000-0000-4000-8000-0000000000c1",
  brand_id: "42730000-0000-4000-8000-0000000000b1",
  message_id: "42730000-0000-4000-8000-0000000000e1",
};
const HOST = "42730000-0000-4000-8000-0000000000a1";
const PHONE = "+447700904273";
type Write = { table: string; op: string; payload: unknown };

function fakeAdmin(
  writes: Write[],
  opts: { messageCampaign?: string; existing?: boolean } = {},
) {
  const reads: string[] = [];
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = "select";
    const result = () => {
      if (op !== "select") return { data: null, error: null };
      if (table === "marketing_messages") {
        return filters.id === PAYLOAD.message_id &&
            filters.campaign_id === (opts.messageCampaign ?? PAYLOAD.campaign_id)
          ? { data: { id: PAYLOAD.message_id, recipient_phone: PHONE }, error: null }
          : { data: null, error: null };
      }
      if (table === "brands") return { data: { account_id: HOST }, error: null };
      if (table === "marketing_unsubscribes") {
        return { data: opts.existing ? [{ id: "u1" }] : [], error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    chain.select = () => {
      reads.push(table);
      return chain;
    };
    chain.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    };
    chain.limit = () => chain;
    for (const kind of ["insert", "update", "upsert", "delete"]) {
      chain[kind] = (p?: unknown) => {
        op = kind;
        writes.push({ table, op: kind, payload: p ?? null });
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return { from: builder, reads };
}

const url = "https://usemingla.com/unsubscribe/token";

Deno.test("#4273 S-1 a GET changes nothing and offers one POST button", async () => {
  const writes: Write[] = [];
  const admin = fakeAdmin(writes);
  const response = await handleSmsOptOut(new Request(url), PAYLOAD, admin);
  assertEquals(response.status, 200);
  const html = await response.text();
  assert(html.includes('<form method="post">'), html);
  assertEquals((html.match(/<button/g) ?? []).length, 1);
  assertEquals(writes, [], "no write on GET");
  assertEquals(admin.reads, [], "not even a read on GET");
  assert(!html.includes(PHONE));
});

Deno.test("#4273 S-2 the POST opts the number out of this host's marketing only", async () => {
  const writes: Write[] = [];
  const response = await handleSmsOptOut(
    new Request(url, { method: "POST" }),
    PAYLOAD,
    fakeAdmin(writes),
  );
  assertEquals(response.status, 200);
  const html = await response.text();
  assert(html.includes("from this host"), html);
  assert(!html.includes(PHONE), "the page never shows the number");
  const inserts = writes.filter((w) => w.op === "insert");
  assertEquals(inserts, [{
    table: "marketing_unsubscribes",
    op: "insert",
    payload: {
      contact_phone: PHONE,
      channel: "sms",
      reason: "sms_opt_out_link",
      scope: "account",
      account_id: HOST,
    },
  }]);
  assertEquals(
    writes.some((w) => w.table === "channel_suppressions"),
    false,
    "no global suppression: transactional texts keep arriving",
  );
  assertEquals(
    writes.find((w) => w.table === "marketing_messages")?.payload,
    { status: "unsubscribed" },
  );
});

Deno.test("#4273 S-3 a second POST adds no second row", async () => {
  const writes: Write[] = [];
  await handleSmsOptOut(
    new Request(url, { method: "POST" }),
    PAYLOAD,
    fakeAdmin(writes, { existing: true }),
  );
  assertEquals(writes.filter((w) => w.op === "insert"), []);
});

Deno.test("#4273 S-4 a message from another campaign is refused", async () => {
  const writes: Write[] = [];
  const response = await handleSmsOptOut(
    new Request(url, { method: "POST" }),
    PAYLOAD,
    fakeAdmin(writes, { messageCampaign: "42730000-0000-4000-8000-0000000000c9" }),
  );
  assertEquals(response.status, 400);
  assertEquals(writes, []);
});
