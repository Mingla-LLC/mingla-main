// #4541 wave 6 (T-25): a Blast's "+ Form" in marketing-send (R4.3, R4.10).
// Confirm refuses a form that is not live or not the brand's; a scheduled Blast
// whose form closed first is held (failed, form_closed) and nothing is sent; the
// email carries a per-recipient button that never goes through /m/ tracking; the
// text counts the form link at its real length; a recipient's link is minted only
// after Blast's consent and unsubscribe rules picked them (SC-35).
// MINGLA-INVARIANT: I-4541-BLAST-FORM-MARKETING-RULES | issue #4541 | a Blast form link is minted per recipient only after the audience's email or text consent and the brand unsubscribe let that recipient through, never passes through click tracking, and a Blast whose form is not live is refused at confirm and held at claim (this suite).
//
// FAILS-ON-REVERT: dropping the hold in processClaimedCampaigns fails T-HOLD; dropping the
// confirm check fails T-CONFIRM-SRC; minting before the consent skip fails T-ORDER; adding
// the form button before tracking fails T-EMAIL; dropping the quote suffix fails T-QUOTE.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { processClaimedCampaigns } from "./index.ts";
import { BLAST_FORM_URL_MARKER, blastFormConfirmRefusal } from "./blastForm.ts";
import { renderMarketingEmail } from "../_shared/marketingEmailRender.ts";
import { marketingBookSmsWireBody } from "../_shared/marketingBookQuote.ts";
import {
  BLAST_FORM_SAMPLE_URL,
  blastFormSmsLine,
  blastFormUrl,
} from "../_shared/blastFormLinks.ts";
import { computeSegments } from "../_shared/adapters/smsAdapter.ts";

const FORM = "45410000-0000-4000-8000-000000000af1";
const CAMPAIGN = "45410000-0000-4000-8000-000000000ac1";

function client(rpcs: Record<string, { data: unknown; error: unknown }>) {
  const called: string[] = [];
  return {
    called,
    rpc: (fn: string) => {
      called.push(fn);
      return Promise.resolve(rpcs[fn] ?? { data: null, error: null });
    },
    from: () => {
      const chain = { update: () => chain, eq: () => Promise.resolve({ error: null }) };
      return chain;
    },
  };
}

const campaign = (payload: Record<string, unknown>) => ({
  id: CAMPAIGN,
  account_id: "a",
  brand_id: "b",
  audience_id: "c",
  channel: "email",
  channel_payload: { kind: "email", subject: "Hi", body_html: "Hi", ...payload },
  name: "Spring news",
  scheduled_for: null,
});

Deno.test("T-HOLD SC-31 a scheduled Blast whose form closed first is held: nothing is dispatched", async () => {
  const c = client({ brand_form_blast_hold_if_closed: { data: true, error: null } });
  let dispatched = 0;
  const out = await processClaimedCampaigns(
    c,
    [campaign({ embedded_form: { form_id: FORM } }) as never],
    { live: true, resendApiKey: "" },
    () => {
      dispatched += 1;
      return Promise.resolve({ delivered: 1, deferred: 0, failed: 0, preview_skipped: 0 });
    },
  );
  assertEquals(dispatched, 0);
  assertEquals(out.errors, [{ campaign_id: CAMPAIGN, reason: "form_closed" }]);
  assert(!c.called.includes("mkt_finalize_campaign"));
});

Deno.test("T-HOLD a Blast without a form never reads the hold", async () => {
  const c = client({});
  let dispatched = 0;
  await processClaimedCampaigns(c, [campaign({}) as never], { live: true, resendApiKey: "" }, () => {
    dispatched += 1;
    return Promise.resolve({ delivered: 1, deferred: 0, failed: 0, preview_skipped: 0 });
  });
  assertEquals(dispatched, 1);
  assert(!c.called.includes("brand_form_blast_hold_if_closed"));
});

Deno.test("T-CONFIRM SC-30 confirm refuses a form that is not live (409) or not the brand's (403)", async () => {
  assertEquals(
    await blastFormConfirmRefusal(client({ brand_form_blast_check: { data: { ok: false, code: "embedded_form_not_live" }, error: null } }), CAMPAIGN),
    { status: 409, code: "embedded_form_not_live" },
  );
  assertEquals(
    await blastFormConfirmRefusal(client({ brand_form_blast_check: { data: { ok: false, code: "embedded_form_other_brand" }, error: null } }), CAMPAIGN),
    { status: 403, code: "embedded_form_other_brand" },
  );
  assertEquals(
    await blastFormConfirmRefusal(client({ brand_form_blast_check: { data: { ok: true, formId: null }, error: null } }), CAMPAIGN),
    null,
  );
});

Deno.test("T-CONFIRM-SRC both confirm lanes (Book and push) run the form check before the confirm RPC", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const rpc of ['"biz_confirm_marketing_book_send_v1"', '"biz_confirm_marketing_push_send_v1"']) {
    const at = src.indexOf(rpc);
    const check = src.lastIndexOf("blastFormConfirmRefusal(supabase, body.campaign_id)", at);
    // Read only when the payload carries a form (Blasts without one are untouched).
    const gate = src.lastIndexOf("embeddedFormIdOf(", check);
    assert(at > 0 && check > 0 && at - check < 1500 && check - gate < 300, rpc);
  }
});

Deno.test("T-ORDER SC-35 a recipient's form link is minted only after the consent and unsubscribe skip", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const email = src.slice(src.indexOf("async function sendEmail("), src.indexOf("function resolveRecipientTz("));
  const skip = email.indexOf("if (!contact.email_marketing_ok || contact.raw_email === null) {");
  const live = email.indexOf("if (!options.live) {");
  const mint = email.indexOf("await mintBlastFormUrl(");
  assert(skip > 0 && live > skip && mint > live, "email: skip, then the preview gate, then the mint");
  const sms = src.slice(src.indexOf("async function sendSms("), src.indexOf("async function writeBlastIntoEventChat("));
  assert(sms.indexOf("c.sms_marketing_ok && c.raw_phone !== null") > 0);
  assert(sms.indexOf("await mintBlastFormUrl(") > sms.indexOf("if (!options.live) {"), "sms: minted only on a live send");
});

Deno.test("T-EMAIL SC-30 the email button carries the recipient's own link and never the /m/ redirect", () => {
  const r = renderMarketingEmail({
    body_html: 'Hello <a href="https://example.com/x">x</a>',
    variables: {} as never,
    embedded_events: [],
    unsubscribe_url: "https://u.example/unsub",
    subject: "Hi",
    brand_name: "Lagos Supper",
    embedded_form: { name: "Dietary needs", url_marker: BLAST_FORM_URL_MARKER },
  });
  assert(r.html.includes(`href="${BLAST_FORM_URL_MARKER}"`));
  assert(r.html.includes("Answer: Dietary needs"));
  assert(r.text.includes(`Answer: Dietary needs: ${BLAST_FORM_URL_MARKER}`));
  assert(r.links.every((l) => !l.destination_url.includes(BLAST_FORM_URL_MARKER)));
  assertEquals(r.links.length, 1);
  const url = blastFormUrl(FORM, CAMPAIGN, "a".repeat(64));
  assertEquals(url, `https://host.usemingla.com/form/${FORM}?c=${CAMPAIGN}#t=${"a".repeat(64)}`);
  assert(!url.includes("/m/"));
});

Deno.test("T-QUOTE R4.10 the Blast text counts the form link at its real length", () => {
  assertEquals(BLAST_FORM_SAMPLE_URL.length, blastFormUrl(FORM, CAMPAIGN, "a".repeat(64)).length);
  const body = "Doors at 8. See you there.";
  const without = computeSegments(marketingBookSmsWireBody(body, "https://m.example"));
  const withForm = computeSegments(
    marketingBookSmsWireBody(body, "https://m.example", false, blastFormSmsLine(BLAST_FORM_SAMPLE_URL)),
  );
  assert(withForm > without, `${withForm} > ${without}`);
});
