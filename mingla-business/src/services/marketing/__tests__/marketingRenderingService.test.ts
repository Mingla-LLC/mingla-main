/**
 * T-B05 token insertion + preview rendering helpers.
 *
 * Covers `previewBlocks` and `substituteVariables`.
 * Pure-logic; no React Native render needed.
 *
 * [TEST-MOD-APPROVED #2291] — `validateChannelPayload` was DEAD CODE (zero
 * production callers; only this file referenced it) and is replaced by
 * `../campaignPayloadContract`. Its three cases are repointed below rather than
 * dropped, and the contract's full case table lives in
 * `./campaignPayloadContract.test.ts`.
 */

import {
  previewBlocks,
  substituteVariables,
} from "../marketingRenderingService";
import { campaignPayloadIssues } from "../campaignPayloadContract";

describe("substituteVariables", () => {
  it("substitutes known variables", () => {
    const out = substituteVariables("Hi {first_name}, {event_name} on {event_date}.", {
      first_name: "Alex",
      event_name: "Late Night Set",
      event_date: "Fri May 23",
    });
    expect(out).toBe("Hi Alex, Late Night Set on Fri May 23.");
  });

  it("leaves unknown braces alone", () => {
    const out = substituteVariables("Hi {first_name}, ref {something_else}", {
      first_name: "Alex",
    });
    expect(out).toBe("Hi Alex, ref {something_else}");
  });

  it("substitutes empty string when variable is null/undefined", () => {
    const out = substituteVariables("Hi {first_name}!", { first_name: null });
    expect(out).toBe("Hi !");
  });
});

describe("previewBlocks", () => {
  it("splits paragraphs around event card tokens", () => {
    const eventId = "11111111-2222-3333-4444-555555555555";
    const out = previewBlocks(
      `Hi {first_name},\n\nCheck this out:\n\n{{event:${eventId}}}\n\nSee you there.`,
      { first_name: "Alex" },
    );
    expect(out).toHaveLength(3);
    expect(out[0].kind).toBe("paragraph");
    expect(out[0].content).toContain("Hi Alex");
    expect(out[1].kind).toBe("event_card");
    expect(out[1].content).toBe(eventId);
    expect(out[2].kind).toBe("paragraph");
    expect(out[2].content).toContain("See you there");
  });

  it("returns empty when body is empty", () => {
    expect(previewBlocks("", {})).toEqual([]);
  });

  it("handles back-to-back event tokens", () => {
    const a = "11111111-2222-3333-4444-555555555555";
    const b = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const out = previewBlocks(`{{event:${a}}}{{event:${b}}}`, {});
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: "event_card", content: a });
    expect(out[1]).toEqual({ kind: "event_card", content: b });
  });
});

// [TEST-MOD-APPROVED #2291] — repointed from the deleted
// `validateChannelPayload` to `campaignPayloadIssues`. Same three scenarios,
// same file, so the coverage that existed here is not lost in the move.
describe("campaignPayloadIssues (was validateChannelPayload)", () => {
  it("returns empty issues for valid email payload", () => {
    expect(
      campaignPayloadIssues({
        kind: "email",
        subject: "Hello",
        body_html: "Body",
        body_text: "Body",
      }),
    ).toEqual([]);
  });

  it("flags missing subject + body", () => {
    expect(
      campaignPayloadIssues({
        kind: "email",
        subject: "",
        body_html: "",
        body_text: "",
      }),
    ).toHaveLength(2);
  });

  // [TEST-MOD-APPROVED ORCH-1283] — RCS channel decommissioned in ORCH-1283
  // (ChannelPayloadRcs, the "rcs" kind, and the marketing-send `case "rcs"`
  // were deleted). The rcs half of this case referenced a type that no longer
  // exists, so it is removed here.
  //
  // [TEST-MOD-APPROVED #2291] — the ASSERTION IS INVERTED, deliberately. The
  // old function answered "SMS channel not yet enabled"; SMS has been LIVE
  // since META-ORCH-1161, so that answer was wrong and had been wrong for
  // months — nobody noticed because nothing called it. A valid SMS payload is
  // valid.
  it("accepts a valid sms payload — SMS is live", () => {
    expect(campaignPayloadIssues({ kind: "sms", body: "x" })).toEqual([]);
  });
});
