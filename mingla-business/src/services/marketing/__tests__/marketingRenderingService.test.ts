/**
 * T-B05 token insertion + preview rendering helpers.
 *
 * Covers `previewBlocks`, `substituteVariables`, and `validateChannelPayload`.
 * Pure-logic; no React Native render needed.
 */

import {
  previewBlocks,
  substituteVariables,
  validateChannelPayload,
} from "../marketingRenderingService";

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

describe("validateChannelPayload", () => {
  it("returns empty issues for valid email payload", () => {
    expect(
      validateChannelPayload({
        kind: "email",
        subject: "Hello",
        body_html: "Body",
        body_text: "Body",
      }),
    ).toEqual([]);
  });

  it("flags missing subject + body", () => {
    expect(
      validateChannelPayload({
        kind: "email",
        subject: "",
        body_html: "",
        body_text: "",
      }),
    ).toEqual(["Subject required", "Body required"]);
  });

  it("rejects sms + rcs payloads in Phase B", () => {
    expect(
      validateChannelPayload({ kind: "sms", body: "x" }),
    ).toEqual(["SMS channel not yet enabled"]);
    expect(
      validateChannelPayload({
        kind: "rcs",
        rich_card: { title: "x" },
        fallback_sms: "x",
      }),
    ).toEqual(["RCS channel not yet enabled"]);
  });
});
