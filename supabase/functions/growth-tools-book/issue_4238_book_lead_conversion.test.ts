// MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE-BOOK-LEAD | issue #4238 | a Host book-a-call booking with the page's ad context fires one host Lead (event_id lead:<book_call_leads.id>); a replayed booking fires nothing again; Creator and Local calls are not host leads.
/**
 * #4238 W3-3 (D7). Hermetic: the real recordBookingAdLead over an in-memory
 * table client with captured senders, plus a source pin on the handler wiring.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput, SenderResult } from "../_shared/adConversionFire.ts";
import { parseHostAdContext } from "../_shared/hostFunnelConversion.ts";
import { hostFakeDb } from "../_shared/__tests__/hostFunnelFakeDb.issue4238.ts";
import { recordBookingAdLead } from "./bookingAdLead.ts";

const LEAD = "3c4d5e6f-4238-4e00-8f00-000000000033";

function setup(audience = "host") {
  const db = hostFakeDb({
    book_call_leads: [{ id: LEAD, booking_key: "gcal:evt-1", audience, email: "venue@example.com" }],
    ad_attribution_touches: [],
    ad_connections: [{ platform: "meta", lane: "consumer", extra: { dataset_id: "ds" } }],
  });
  const sent: ConversionSendInput[] = [];
  const sender = (channel: SenderResult["channel"]) =>
  (input: ConversionSendInput): Promise<SenderResult> => {
    sent.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
  const fire = {
    senders: {
      meta: sender("meta"),
      tiktok: sender("tiktok"),
      snap: sender("snap"),
      reddit: sender("reddit"),
      google: sender("google"),
    },
  };
  return { db, sent, fire };
}

const req = new Request("https://fn/", { headers: { "user-agent": "UA/3" } });
const ad = parseHostAdContext({
  fbc: "fb.1.3.BOOK",
  tracking_opt_out: false,
  page_url: "https://usemingla.com/schedule",
}, req)!;
const config = { supabaseUrl: "https://x", serviceKey: "k" };

Deno.test("#4238 W3-3 a Host booking with ad context fires Lead once; a replay fires nothing", async () => {
  const { db, sent, fire } = setup();
  const id = await recordBookingAdLead("gcal:evt-1", ad, config, { db: db.client, fire });
  assertEquals(id, `lead:${LEAD}`);
  const meta = sent.filter((s) => s.eventName === "Lead" && s.fbc === "fb.1.3.BOOK");
  assertEquals(meta.length, 1);
  assertEquals(meta[0].eventId, `lead:${LEAD}`);
  assertEquals(meta[0].eventSourceUrl, "https://usemingla.com/schedule");
  const ctx = db.row("ad_match_contexts", (r) => r.subject_id === LEAD);
  assertEquals(ctx?.subject_type, "lead");
  const before = sent.length;
  const again = await recordBookingAdLead("gcal:evt-1", ad, config, { db: db.client, fire });
  assertEquals(again, `lead:${LEAD}`);
  assertEquals(sent.length, before, "the same booking_key sends nothing twice");
});

Deno.test("#4238 W3-3 recordBookingAdLead (host only) still refuses a Creator call", async () => {
  const { db, sent, fire } = setup("creator");
  assertEquals(await recordBookingAdLead("gcal:evt-1", ad, config, { db: db.client, fire }), null);
  assertEquals(sent.length, 0);
});

// #4452 §4.6 changed the wiring: every audience reads its ad context and fires a
// labelled Lead (issue_4452_book_labels.implementor.test.ts). The host id stays lead:<id>.
Deno.test("#4238 W3-3 / #4452 the handler reads the ad context for every audience and returns lead_event_id", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes("const ad = parseHostAdContext(body.ad, req);"));
  assert(src.includes('leadWrite === "written"'));
  assert(src.includes("lead_event_id: leadEventId"));
  const gate = await Deno.readTextFile(new URL("../growth-tools-gate/index.ts", import.meta.url));
  // #4452 B20: the gate's lead moved into recordToolGateLead (same id, plus the test-lead check).
  assert(gate.includes("subjectId: `tool:${input.runId}`"));
  assert(gate.includes("lead_event_id: leadEventId"));
});
