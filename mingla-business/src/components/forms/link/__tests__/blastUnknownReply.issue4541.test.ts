/**
 * #4541 R4.4 / R4.5 / R8.2 / R8.5 — the link page for a Blast form.
 *
 *   - `?c={campaign}` with no personal link opens the Unknown reply: the
 *     `blast_form` read's form and bot ticket; a closed form, a campaign that
 *     did not carry the form, and the off switch each have their page state.
 *   - The Unknown submit sends the campaign, the bot ticket and the honeypot
 *     field (empty from a person), and never a token or a contact.
 *   - Every refusal (§15): the daily limit, the bot check, the rate limit, a
 *     changed form, invalid answers.
 *   - A personal Blast link that needs a code it cannot get offers "Answer
 *     without confirming" in that Blast; a revoked link reads "This link has
 *     been replaced".
 *
 * FAILS-ON-REVERT: dropping the campaign parse, the botTicket or website in
 * the submit body, the open_reply_limit / bot_check_failed mapping, or the
 * unknownCampaignId on the code step turns a named case RED.
 */

const invoke = jest.fn();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  campaignFromSearch,
  parseLinkRead,
  phaseFromBlastRead,
  phaseFromBlastReadError,
  phaseFromRead,
  phaseFromReadError,
  unknownSubmitOutcome,
} from "../brandFormLinkModel";
import { LINK_COPY } from "../brandFormLinkCopy";
import { readBlastForm, saveBlastAnswers } from "../../../../services/brandFormLinkService";

const FORM = "45410000-0000-4000-8000-000000000004";
const CAMPAIGN = "45410000-0000-4000-8000-0000000000c1";
const def = { questions: [{ id: "q1", position: 0, type: "short_text", label: "What will you perform?", required: true }] };

beforeEach(() => invoke.mockReset());

describe("#4541 R4.5 a Blast form with no personal link", () => {
  test("the campaign comes from ?c= only, as a uuid", () => {
    expect(campaignFromSearch(`?c=${CAMPAIGN}`)).toBe(CAMPAIGN);
    expect(campaignFromSearch(`?x=1&c=${CAMPAIGN.toUpperCase()}`)).toBe(CAMPAIGN);
    expect(campaignFromSearch("?c=nope")).toBeNull();
    expect(campaignFromSearch("")).toBeNull();
  });

  test("the read opens the Unknown form with its bot ticket; closed and refused reads have their states", () => {
    const open = phaseFromBlastRead(
      { form: { id: FORM, name: "Open mic", status: "live", versionId: "v1", definition: def }, campaignId: CAMPAIGN, botTicket: "abc.def" },
      CAMPAIGN,
    );
    expect(open).toMatchObject({
      kind: "unknown_open",
      campaignId: CAMPAIGN,
      botTicket: "abc.def",
      form: { formId: FORM, formName: "Open mic", versionId: "v1", identity: null, doorFullAnswers: false },
      answers: {},
    });
    expect(phaseFromBlastRead({ form: { id: FORM, name: "Open mic", status: "closed" } }, CAMPAIGN))
      .toEqual({ kind: "closed", formName: "Open mic", last: null });
    expect(phaseFromBlastReadError("form_not_on_event")).toEqual({ kind: "invalid" });
    expect(phaseFromBlastReadError("forms_paused")).toEqual({ kind: "paused" });
    expect(phaseFromBlastReadError("form_closed")).toMatchObject({ kind: "closed" });
    expect(phaseFromBlastReadError("network")).toEqual({ kind: "load_failed" });
  });

  test("the read asks blast_form; a refusal throws the server's code", async () => {
    invoke.mockResolvedValueOnce({ data: { form: { id: FORM, name: "x", status: "live" }, botTicket: "t" }, error: null });
    await readBlastForm({ formId: FORM, campaignId: CAMPAIGN });
    expect(invoke).toHaveBeenCalledWith("brand-form-submit", { body: { op: "blast_form", formId: FORM, campaignId: CAMPAIGN } });
    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ ok: false, error: "form_not_on_event" }), { status: 403 }) },
    });
    await expect(readBlastForm({ formId: FORM, campaignId: CAMPAIGN })).rejects.toMatchObject({ code: "form_not_on_event" });
  });

  test("the submit carries the campaign, the bot ticket and the honeypot, never a token", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, created: true, editable: false }, error: null });
    const r = await saveBlastAnswers({
      formId: FORM, versionId: "v1", answers: { q1: "Two songs" }, campaignId: CAMPAIGN, botTicket: "abc.def", website: "",
    });
    expect(r).toEqual({ ok: true, editCount: 0 });
    const body = invoke.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).toEqual({
      formId: FORM, versionId: "v1", answers: { q1: "Two songs" }, campaignId: CAMPAIGN, botTicket: "abc.def", website: "",
    });
    expect(body).not.toHaveProperty("token");
  });

  test("each refusal reads as §15 says", () => {
    expect(unknownSubmitOutcome(null)).toEqual({ next: "saved" });
    expect(unknownSubmitOutcome("open_reply_limit")).toEqual({ next: "limit" });
    expect(unknownSubmitOutcome("bot_check_failed")).toEqual({ next: "error", error: "bot_check" });
    expect(unknownSubmitOutcome("rate_limited")).toEqual({ next: "error", error: "rate_limited" });
    expect(unknownSubmitOutcome("form_changed")).toEqual({ next: "error", error: "changed" });
    expect(unknownSubmitOutcome("form_closed")).toEqual({ next: "closed" });
    expect(unknownSubmitOutcome("forms_paused")).toEqual({ next: "paused" });
    expect(unknownSubmitOutcome("form_not_on_event")).toEqual({ next: "invalid" });
    expect(unknownSubmitOutcome("form_answers_invalid", [{ questionId: "q1", code: "required" }]))
      .toEqual({ next: "error", error: "invalid", fieldErrors: { q1: "Answer this question." } });
    expect(LINK_COPY.unknownLimitTitle).toBe("This form isn't taking more answers right now.");
    expect(LINK_COPY.botCheckFailed).toBe("Something went wrong. Reload and try again.");
    expect(LINK_COPY.unknownNotice("Harmattan Club")).toBe(
      "Harmattan Club won't see who you are, only your answers. Got this by text or email? Use the link in that message.",
    );
  });
});

describe("#4541 R4.4 / R8.2 personal links", () => {
  test("a Blast link that needs a code it cannot get offers Unknown in that Blast", () => {
    const read = parseLinkRead({
      state: "code_required", answered: true, recognized: true, identity: "Kemi L.",
      codeAvailable: false, unknownAllowed: true, campaignId: CAMPAIGN,
      form: { id: FORM, name: "Open mic", status: "live" },
    });
    expect(read).not.toBeNull();
    const phase = phaseFromRead(read as NonNullable<typeof read>);
    expect(phase).toMatchObject({ kind: "code", reason: "answered", unknownCampaignId: CAMPAIGN });
  });

  test("a page link keeps the code step as before", () => {
    const read = parseLinkRead({
      state: "code_required", answered: true, identity: "Kemi L.",
      form: { id: FORM, name: "Open mic", status: "live" },
    });
    const phase = phaseFromRead(read as NonNullable<typeof read>);
    expect(phase.kind).toBe("code");
    expect(phase).not.toHaveProperty("unknownCampaignId");
  });

  test("a revoked link: 'This link has been replaced'", () => {
    expect(phaseFromReadError("link_revoked")).toEqual({ kind: "replaced" });
    expect(LINK_COPY.replacedTitle).toBe("This link has been replaced");
    expect(LINK_COPY.replacedBody("Harmattan Club")).toBe(
      "Harmattan Club sent you a newer link. Open the latest message from Harmattan Club.",
    );
  });
});
