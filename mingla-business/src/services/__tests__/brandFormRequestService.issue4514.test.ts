/**
 * #4514 wave 4 — Ask guests to answer / Remind: the request the host app sends
 * and how a refusal reads.
 *
 * FAILS-ON-REVERT: dropping the Remind → "unanswered" pin in requestBody, or the
 * read of a non-2xx body's code, turns a case below red. Wave 4 review:
 * Ask-for-named-guests back on "unanswered", or letting an unpriced send
 * through canSendRequest turns a case red. #4541 changed two rules on purpose:
 * Push is offered (R3, behind the server's switch) and a text limit never
 * blocks the send (R5.5: texts are off for that send); the delivery log names
 * a guest not texted for that reason (R5.5).
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
  type FormRequestPreview,
  parseFormRequestLog,
  previewFormRequest,
  sendFormRequest,
  setFormAutoRemind,
} from "../brandFormRequestService";
import { canSendRequest, costLine, initialAudience, REQUEST_CHANNELS } from "../../utils/formRequestCost";
import { FORM_REQUEST_COPY, FORM_REQUEST_LOG_COPY } from "../../components/forms/brandFormsCopy";
import { logLine } from "../../utils/formRequestLog";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

const preview = (over: Partial<FormRequestPreview> = {}): FormRequestPreview => ({
  selectedCount: 1,
  reachableCount: 1,
  throttledCount: 0,
  smsOptedOutCount: 0,
  unreachableCount: 0,
  perChannelReachable: { push: 0, sms: 1, email: 0 },
  smsCount: 1,
  smsSegments: 1,
  estimatedCostMinor: 2,
  currency: "USD",
  textsToday: 0,
  textCap: 300,
  overTextCap: false,
  textsWaitUntil: null,
  pushAvailable: false,
  monthlyTextCap: 500,
  textsLeftThisMonth: 500,
  textsThisSendUses: 1,
  textsTodayUsed: 0,
  dailyTextCap: 300,
  textsOff: null,
  ...over,
});

describe("brandFormRequestService (#4514 wave 4)", () => {
  it("Remind always asks the server for people who have not answered, with sorted channels", async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, reachableCount: 2, perChannelReachable: { sms: 1, email: 1 }, smsSegments: 2, textsToday: 5, textCap: 300 },
      error: null,
    });
    const p = await previewFormRequest({ formId: FORM, eventId: EVENT, kind: "remind", audience: "everyone", channels: ["sms", "email"] });
    expect(invoke).toHaveBeenCalledWith("guest-roster-actions", {
      body: { operation: "form_preview", eventId: EVENT, formId: FORM, kind: "remind", audience: "unanswered", channels: ["email", "sms"] },
    });
    expect(p.reachableCount).toBe(2);
    expect(p.perChannelReachable).toEqual({ push: 0, sms: 1, email: 1 });
    expect([p.smsSegments, p.textsToday, p.textCap, p.overTextCap]).toEqual([2, 5, 300, false]);
    expect(p.estimatedCostMinor).toBeNull();
  });

  it("a named guest goes as a subject; the send carries the previewed cost and the unpriced tick; the result says what is still on the way", async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, status: "queued", queued: 3, sent: 1, failed: 0, pending: 2, waitingForMorning: 2, skipped: { throttled: 1, unreachable: 1 } },
      error: null,
    });
    const r = await sendFormRequest({
      formId: FORM, eventId: EVENT, kind: "ask", audience: "everyone", channels: ["sms", "email"],
      subjects: [{ kind: "rsvp", id: EVENT }], expectedCostMinor: null, currency: null, confirmUnpriced: true,
    });
    expect(invoke.mock.calls[0][1].body).toEqual({
      operation: "form_send", eventId: EVENT, formId: FORM, kind: "ask", audience: "everyone", channels: ["email", "sms"],
      subjects: [{ kind: "rsvp", id: EVENT }], expectedCostMinor: null, currency: null, confirmUnpriced: true,
    });
    expect(r).toEqual({ queued: 3, sent: 1, failed: 0, pending: 2, waitingForMorning: 2, throttled: 1, answered: 0, unreachable: 1, textsOff: null });
  });

  it("a refusal reads the server's code from the reply body (never a guessed reason)", async () => {
    const context = new Response(JSON.stringify({ ok: false, code: "forbidden" }), { status: 403 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context } });
    await expect(previewFormRequest({ formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["email"] }))
      .rejects.toMatchObject({ name: "FormRequestError", code: "forbidden" });
    const cap = new Response(JSON.stringify({ ok: false, code: "text_cap" }), { status: 409 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context: cap } });
    await expect(sendFormRequest({ formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["sms"], expectedCostMinor: 0, currency: null }))
      .rejects.toMatchObject({ code: "text_cap" });
    const unpriced = new Response(JSON.stringify({ ok: false, code: "cost_unpriced" }), { status: 409 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context: unpriced } });
    await expect(sendFormRequest({ formId: FORM, eventId: EVENT, kind: "ask", audience: "unanswered", channels: ["sms"], expectedCostMinor: null, currency: null }))
      .rejects.toMatchObject({ code: "cost_unpriced" });
  });

  it("the automatic reminder switch maps a role refusal and returns the stored channels (push never)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "brand_form_forbidden" } });
    await expect(setFormAutoRemind({ attachmentId: FORM, on: true, channels: ["email"] })).rejects.toBeInstanceOf(FormRequestError);
    rpc.mockResolvedValueOnce({ data: { autoRemind: true, remindAt: "2028-12-01T10:00:00Z", channels: ["push", "sms"] }, error: null });
    await expect(setFormAutoRemind({ attachmentId: FORM, on: true, channels: ["sms", "email"] })).resolves.toEqual({
      autoRemind: true, remindAt: "2028-12-01T10:00:00Z", channels: ["sms"],
    });
    expect(rpc).toHaveBeenLastCalledWith("biz_brand_form_set_auto_remind", { p_attachment_id: FORM, p_on: true, p_channels: ["email", "sms"] });
  });

  it("the sheet offers push, text and email, Asks named guests as everyone (Ask again), and refuses unpriced sends", () => {
    expect(REQUEST_CHANNELS).toEqual(["push", "sms", "email"]);
    expect(initialAudience("ask", true)).toBe("everyone");
    expect(initialAudience("ask", false)).toBe("unanswered");
    expect(initialAudience("remind", true)).toBe("unanswered");
    expect(canSendRequest(preview(), false)).toBe(true);
    expect(canSendRequest(preview({ estimatedCostMinor: null, currency: null }), false)).toBe(false);
    expect(canSendRequest(preview({ estimatedCostMinor: null, currency: null }), true)).toBe(true);
    // #4541 R5.5: over a text limit texts are off for the send; it is never blocked.
    expect(canSendRequest(preview({ overTextCap: true }), true)).toBe(true);
    expect(canSendRequest(preview({ reachableCount: 0 }), true)).toBe(false);
  });

  it("the cost line never invents an amount", () => {
    expect(costLine(preview({ smsCount: 0, estimatedCostMinor: 0, currency: null }))).toBe(FORM_REQUEST_COPY.noCost);
    expect(costLine(preview({ smsCount: 3, estimatedCostMinor: null, currency: null }))).toBe(FORM_REQUEST_COPY.costUnpriced(3));
    expect(costLine(preview({ smsCount: 3, estimatedCostMinor: 125, currency: "USD" }))).toContain("1.25");
  });

  it("the delivery log reads each guest's request in words and drops malformed rows", () => {
    const log = parseFormRequestLog({
      sends: [
        { id: "s1", kind: "auto", subjectKind: "order", subjectId: EVENT, name: "Ada D.", channel: "sms", status: "failed", reason: "claim_expired", createdAt: "2028-03-01T10:00:00Z", settledAt: null },
        { id: "s2", kind: "ask", status: "bogus", createdAt: "2028-03-01T10:00:00Z" },
        { id: "s3", kind: "ask", name: "Val W.", channel: null, status: "unreachable", reason: "no_contact", createdAt: "2028-03-01T10:00:00Z" },
      ],
      counts: { sent: 0, queued: 0, failed: 1, unreachable: 1, skipped: 0 },
      runs: [{ startsAt: "2028-03-03T18:00:00Z", outcome: "failed" }],
    });
    expect(log.sends.map((r) => r.id)).toEqual(["s1", "s3"]);
    expect(logLine(log.sends[0])).toContain("Ada D. · Automatic reminder · Text · Failed (not delivered after 3 tries)");
    expect(logLine(log.sends[1])).toContain("Val W. · Ask · Can't be reached (no phone or email on file)");
    expect(log.runs).toEqual([{ startsAt: "2028-03-03T18:00:00Z", outcome: "failed" }]);
    expect(FORM_REQUEST_LOG_COPY.counts(0, 0, 1, 1)).toBe("0 sent · 0 on the way · 1 failed · 1 can't be reached");
  });

  it("the delivery log names a guest not texted because of the daily limit and a reminder too late to send", () => {
    const log = parseFormRequestLog({
      sends: [
        { id: "c1", kind: "auto", subjectKind: "rsvp", subjectId: EVENT, name: "Ike O.", channel: "sms", status: "skipped", reason: "text_cap", createdAt: "2028-03-01T10:00:00Z", settledAt: null },
        { id: "c2", kind: "auto", subjectKind: "rsvp", subjectId: EVENT, name: "Val W.", channel: "email", status: "sent", reason: "text_cap", createdAt: "2028-03-01T10:00:00Z", settledAt: null },
        { id: "c3", kind: "ask", subjectKind: "order", subjectId: EVENT, name: "Ada D.", channel: "sms", status: "skipped", reason: "event_started", createdAt: "2028-03-01T10:00:00Z", settledAt: null },
      ],
      counts: { sent: 1, queued: 0, failed: 0, unreachable: 0, skipped: 2 },
      runs: [],
    });
    expect(logLine(log.sends[0])).toContain("Ike O. · Automatic reminder · Text · Not sent · Not texted: daily limit");
    expect(logLine(log.sends[1])).toContain("Val W. · Automatic reminder · Email · Sent · Not texted: daily limit");
    expect(logLine(log.sends[2])).toContain("Ada D. · Ask · Text · Not sent (their date had already started)");
  });

  it("uses the contract wording for the prompt", () => {
    expect(FORM_REQUEST_COPY.earlierTitle).toBe("Ask earlier guests?");
    expect(FORM_REQUEST_COPY.earlierLine(3)).toBe("3 people signed up before this form existed. Ask them to answer?");
    expect(FORM_REQUEST_COPY.reachLine(4, 1, 2)).toBe("4 reachable · 1 opted out of texts · 2 can't be reached");
  });
});
