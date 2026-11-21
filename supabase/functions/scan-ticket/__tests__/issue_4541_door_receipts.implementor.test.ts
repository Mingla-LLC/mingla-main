// #4541 R8.3 (SC-47, edge): "See all answers" opens only after this actor's
// fresh admission (success) of the ticket in the last 30 minutes. A duplicate
// scan is no longer a receipt. Drives the real handler with a stubbed client.
// MINGLA-INVARIANT: I-4541-DOOR-RECEIPT-FRESH-ADMISSION | issue #4541 | the scan-ticket and scan-rsvp full-answer reads accept only a success scan by the same actor at this event within 30 minutes as the receipt; a duplicate scan never opens full answers (this suite and scan-rsvp's).
//
// FAILS-ON-REVERT: putting "duplicate" back into DOOR_FULL_ANSWERS_RECEIPTS fails T-DUP.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createHandler,
  DOOR_FULL_ANSWERS_RECEIPTS,
  type ScanTicketClient,
} from "../index.ts";

const EVENT = "45410000-0000-4000-8000-0000000006e1";
const ORDER = "45410000-0000-4000-8000-0000000006a1";
const TICKET = "45410000-0000-4000-8000-0000000006b1";
const SCAN = "45410000-0000-4000-8000-0000000006c1";
const ACTOR = "45410000-0000-4000-8000-0000000006d1";
const NOW = Date.parse("2026-11-21T20:00:00Z");

function harness(scanRow: Record<string, unknown>) {
  const calls: string[] = [];
  const client: ScanTicketClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ACTOR } }, error: null }) },
    rpc: (fn: string) => {
      calls.push(fn);
      if (fn === "brand_form_door_full_answers") {
        return Promise.resolve({ data: { state: "answered" }, error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => {
          if (table === "scan_events") return Promise.resolve({ data: scanRow, error: null });
          if (table === "tickets") return Promise.resolve({ data: { order_id: ORDER }, error: null });
          throw new Error(`unexpected table ${table}`);
        },
      };
      return chain;
    },
  } as unknown as ScanTicketClient;
  const handler = createHandler({ client: () => client, pepper: () => "pepper", deadlineMs: 50, now: () => NOW });
  return { handler, calls };
}

const post = () =>
  new Request("https://x/scan-ticket", {
    method: "POST",
    headers: { authorization: "Bearer jwt", "content-type": "application/json" },
    body: JSON.stringify({ action: "door_full_answers", eventId: EVENT, scanId: SCAN }),
  });

const row = {
  ticket_id: TICKET,
  event_id: EVENT,
  scanner_user_id: ACTOR,
  scan_result: "success",
  scanned_at: new Date(NOW - 60_000).toISOString(),
};

Deno.test("T-FRESH a fresh admission by this actor opens the full answers", async () => {
  const h = harness(row);
  const res = await h.handler(post());
  assertEquals(res.status, 200);
  assert(h.calls.includes("brand_form_door_full_answers"));
});

Deno.test("T-DUP SC-47 a duplicate scan is not a receipt", async () => {
  const h = harness({ ...row, scan_result: "duplicate" });
  const res = await h.handler(post());
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "door_answers_scan_required" });
  assertEquals(h.calls.length, 0);
  assertEquals([...DOOR_FULL_ANSWERS_RECEIPTS], ["success"]);
});
