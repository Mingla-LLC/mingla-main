/**
 * #4514 wave 4 — Ask guests to answer / Remind: the request the host app sends
 * and how a refusal reads.
 *
 * FAILS-ON-REVERT: dropping the Remind → "unanswered" pin in requestBody, or the
 * read of a non-2xx body's code, turns a case below red.
 */

const invoke = jest.fn();
const rpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

import {
  FormRequestError,
  previewFormRequest,
  sendFormRequest,
  setFormAutoRemind,
} from "../brandFormRequestService";
import { costLine } from "../../utils/formRequestCost";
import { FORM_REQUEST_COPY } from "../../components/forms/brandFormsCopy";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

describe("brandFormRequestService (#4514 wave 4)", () => {
  it("Remind always asks the server for people who have not answered, with sorted channels", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, reachableCount: 2, perChannelReachable: { push: 1, sms: 1 } }, error: null });
    const p = await previewFormRequest({ formId: FORM, eventId: EVENT, kind: "remind", audience: "everyone", channels: ["sms", "push"] });
    expect(invoke).toHaveBeenCalledWith("guest-roster-actions", {
      body: { operation: "form_preview", eventId: EVENT, formId: FORM, kind: "remind", audience: "unanswered", channels: ["push", "sms"] },
    });
    expect(p.reachableCount).toBe(2);
    expect(p.perChannelReachable).toEqual({ push: 1, sms: 1, email: 0 });
    expect(p.estimatedCostMinor).toBeNull();
  });

  it("a named guest goes as a subject; the send carries the previewed cost", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, sent: 1, failed: 0, skipped: { throttled: 0 } }, error: null });
    const r = await sendFormRequest({
      formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["email"],
      subjects: [{ kind: "rsvp", id: EVENT }], expectedCostMinor: 0, currency: null,
    });
    expect(invoke.mock.calls[0][1].body).toEqual({
      operation: "form_send", eventId: EVENT, formId: FORM, kind: "ask", audience: "unanswered", channels: ["email"],
      subjects: [{ kind: "rsvp", id: EVENT }], expectedCostMinor: 0, currency: null,
    });
    expect(r).toEqual({ sent: 1, failed: 0, throttled: 0, answered: 0, unreachable: 0 });
  });

  it("a refusal reads the server's code from the reply body (never a guessed reason)", async () => {
    const context = new Response(JSON.stringify({ ok: false, code: "forbidden" }), { status: 403 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context } });
    await expect(previewFormRequest({ formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["push"] }))
      .rejects.toMatchObject({ name: "FormRequestError", code: "forbidden" });
    const closed = new Response(JSON.stringify({ ok: false, code: "form_closed" }), { status: 409 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context: closed } });
    await expect(sendFormRequest({ formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["push"], expectedCostMinor: 0, currency: null }))
      .rejects.toThrow("This form is closed. Reopen it to ask guests.");
  });

  it("the automatic reminder switch maps a role refusal", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "brand_form_forbidden" } });
    await expect(setFormAutoRemind({ attachmentId: FORM, on: true, channels: ["push"] })).rejects.toBeInstanceOf(FormRequestError);
    rpc.mockResolvedValueOnce({ data: { autoRemind: true, remindAt: "2028-12-01T10:00:00Z" }, error: null });
    await expect(setFormAutoRemind({ attachmentId: FORM, on: true, channels: ["sms", "push"] })).resolves.toEqual({ autoRemind: true, remindAt: "2028-12-01T10:00:00Z" });
    expect(rpc).toHaveBeenLastCalledWith("biz_brand_form_set_auto_remind", { p_attachment_id: FORM, p_on: true, p_channels: ["push", "sms"] });
  });

  it("the cost line never invents an amount", () => {
    const base = { selectedCount: 1, reachableCount: 1, throttledCount: 0, smsOptedOutCount: 0, unreachableCount: 0, perChannelReachable: { push: 0, sms: 1, email: 0 } };
    expect(costLine({ ...base, smsCount: 0, estimatedCostMinor: 0, currency: null })).toBe(FORM_REQUEST_COPY.noCost);
    expect(costLine({ ...base, smsCount: 3, estimatedCostMinor: null, currency: null })).toBe(FORM_REQUEST_COPY.costUnpriced(3));
    expect(costLine({ ...base, smsCount: 3, estimatedCostMinor: 125, currency: "USD" })).toContain("1.25");
  });

  it("uses the contract wording for the prompt", () => {
    expect(FORM_REQUEST_COPY.earlierTitle).toBe("Ask earlier guests?");
    expect(FORM_REQUEST_COPY.earlierLine(3)).toBe("3 people signed up before this form existed. Ask them to answer?");
    expect(FORM_REQUEST_COPY.reachLine(4, 1, 2)).toBe("4 reachable · 1 opted out of texts · 2 can't be reached");
  });
});
