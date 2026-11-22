// #4541 wave 6, brand-form-submit (T-20 Blast parts): the blast_form read, who a
// Blast reply belongs to, and the bot protection on Unknown replies (R4.4, R4.5,
// R8.5; SC-32, SC-49). Hermetic: the real handler over an in-memory database.
// The SQL side (campaign window, open-reply limit, hashed recipient key) is
// proved by issue_4541_forms_blast_push.implementor.pg17.test.sql (T-14 to T-17).
// MINGLA-INVARIANT: I-4541-UNKNOWN-NEEDS-BOT-CHECK | issue #4541 | an Unknown Blast reply reaches the database only with an untampered bot ticket for its form and campaign, 3 seconds to 2 hours old, and an empty honeypot; a filled honeypot gets a fake success and nothing is written (this suite).
//
// FAILS-ON-REVERT: dropping the verifyBotTicket check fails T-BOT-*; dropping the honeypot
// branch fails T-HONEY; sending Unknown for a signed-in caller fails T-WHO.
//
// Replay within the window: a ticket is not single-use. It binds the form and the Blast
// and expires after 2 hours; repeated Unknown replies with one ticket are still bounded by
// the per-address submit limit (20 per 10 minutes) and the per-form open-reply limit
// (500 a day), both atomic in SQL. A single-use ticket would need a new table for little
// gain, so replay inside the window is accepted (stated on the issue).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";
import { issueBotTicket } from "./botTicket.ts";
import { parseBlastFormRequest } from "./blastForm.ts";

const FORM = "45410000-0000-4000-8000-0000000009f1";
const CAMPAIGN = "45410000-0000-4000-8000-0000000009c1";
const USER = "45410000-0000-4000-8000-0000000009a1";
const ORIGIN = "https://host.usemingla.com";
const KEY = () => Promise.resolve("k".repeat(64));
const NOW = 1_800_000_000_000;

function fake(opts: { user?: string | null; blast?: { data: unknown; error: { message: string } | null } } = {}) {
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(false),
    attemptAdmit: () => {
      calls.push("attemptAdmit");
      return Promise.resolve({ allowed: true });
    },
    userFromBearer: () => Promise.resolve(opts.user === undefined ? USER : opts.user),
    submitCore: (p) => {
      calls.push("submitCore");
      payloads.push(p);
      return Promise.resolve({
        data: { responseId: "r1", editCount: 0, versionId: "v1", created: true, editable: false },
        error: null,
      });
    },
  };
  const run = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await handleBrandFormSubmit(
      new Request("https://x.supabase.co/functions/v1/brand-form-submit", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9", ...headers },
        body: JSON.stringify(body),
      }),
      {
        db,
        log: () => {},
        ipSalt: () => Promise.resolve("s".repeat(64)),
        botTicketKey: KEY,
        nowMs: () => NOW,
        blast: {
          blastForm: (f, c) => {
            calls.push(`blastForm:${f}:${c}`);
            return Promise.resolve(opts.blast ?? { data: { form: { id: f }, brand: {}, campaignId: c }, error: null });
          },
        },
      },
    );
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  return { run, calls, payloads };
}

const answers = { "45410000-0000-4000-8000-000000000901": "Yes" };
const unknownBody = (over: Record<string, unknown> = {}) => ({ formId: FORM, campaignId: CAMPAIGN, answers, ...over });

Deno.test("T-READ blast_form returns the form with a bot ticket bound to the form and Blast", async () => {
  const f = fake();
  const r = await f.run({ op: "blast_form", formId: FORM, campaignId: CAMPAIGN });
  assertEquals(r.status, 200);
  assert(typeof r.body.botTicket === "string");
  assertEquals(f.calls, ["attemptAdmit", `blastForm:${FORM}:${CAMPAIGN}`]);
  assertEquals(parseBlastFormRequest({ op: "blast_form", formId: FORM }), null);
  assertEquals(parseBlastFormRequest({ op: "blast_form", formId: FORM, campaignId: CAMPAIGN, extra: 1 }), null);
});

Deno.test("T-READ-ERR the read maps the window and status refusals", async () => {
  for (const [msg, status] of [["form_not_on_event", 403], ["form_closed", 410], ["form_not_found", 404], ["forms_paused", 503]] as const) {
    const r = await fake({ blast: { data: null, error: { message: msg } } }).run({ op: "blast_form", formId: FORM, campaignId: CAMPAIGN });
    assertEquals([r.status, r.body.error], [status, msg]);
  }
});

Deno.test("T-BOT SC-49 an Unknown reply without a ticket, too fresh, or forged is bot_check_failed and writes nothing", async () => {
  const fresh = await issueBotTicket(FORM, CAMPAIGN, KEY, NOW - 1_000);
  const forged = await issueBotTicket(FORM, CAMPAIGN, () => Promise.resolve("x".repeat(64)), NOW - 60_000);
  const otherBlast = await issueBotTicket(FORM, FORM, KEY, NOW - 60_000);
  for (const botTicket of [undefined, fresh, forged, otherBlast]) {
    const f = fake({ user: null });
    const r = await f.run(unknownBody(botTicket === undefined ? {} : { botTicket }));
    assertEquals([r.status, r.body.error], [422, "bot_check_failed"]);
    assert(!f.calls.includes("submitCore"));
  }
});

Deno.test("T-BOT-OK SC-32 a valid ticket: the reply is written as Unknown", async () => {
  const f = fake({ user: null });
  const botTicket = await issueBotTicket(FORM, CAMPAIGN, KEY, NOW - 10_000);
  const r = await f.run(unknownBody({ botTicket, website: "" }));
  assertEquals(r.status, 200);
  assertEquals(r.body.editable, false);
  assertEquals(f.payloads[0].credential, { kind: "unknown", campaignId: CAMPAIGN });
  assertEquals([f.payloads[0].source, f.payloads[0].eventId], ["blast", null]);
});

Deno.test("T-HONEY SC-49 a filled honeypot gets a fake 200 and nothing is written", async () => {
  const f = fake({ user: null });
  const botTicket = await issueBotTicket(FORM, CAMPAIGN, KEY, NOW - 10_000);
  const r = await f.run(unknownBody({ botTicket, website: "http://spam.example" }));
  assertEquals([r.status, r.body.ok, r.body.created], [200, true, true]);
  assert(!f.calls.includes("submitCore"));
});

Deno.test("T-WHO SC-32 signed in: the person themselves (no ticket needed); a token: the link's recipient", async () => {
  const f = fake();
  const r = await f.run(unknownBody(), { authorization: "Bearer jwt" });
  assertEquals(r.status, 200);
  assertEquals(f.payloads[0].credential, { kind: "user", userId: USER, campaignId: CAMPAIGN });
  const g = fake({ user: null });
  await g.run(unknownBody({ token: "a".repeat(64) }));
  assertEquals((g.payloads[0].credential as Record<string, unknown>).kind, "link");
  assertEquals(g.payloads[0].source, "blast");
});

Deno.test("T-SHAPE a Blast reply never names a page or a held item", async () => {
  for (const extra of [{ eventId: FORM }, { orderId: FORM }, { rsvpId: FORM }]) {
    const r = await fake({ user: null }).run(unknownBody(extra));
    assertEquals([r.status, r.body.error], [400, "bad_request"]);
  }
});
