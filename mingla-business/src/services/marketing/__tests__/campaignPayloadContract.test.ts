/**
 * issue #2291 T-13 — the RN half of the shared payload contract.
 *
 * THE CASE TABLE BELOW IS THE SAME TABLE, IN THE SAME ORDER, AS
 * `supabase/functions/_shared/issue_2291_payload_contract.test.ts`. React
 * Native cannot import from `supabase/functions/`, so the rule exists twice;
 * these two tables are what prove the two copies answer identically instead of
 * merely being assumed to. If you change one, change the other.
 */
import {
  CAMPAIGN_DRAFT_INCOMPLETE_BANNER,
  campaignPayloadIssues,
  isCampaignPayloadSendable,
} from "../campaignPayloadContract";

const CASES: Array<[string, unknown, boolean]> = [
  ["email complete", { kind: "email", subject: "Doors at 9", body_html: "<p>See you.</p>" }, true],
  ["email complete + optional keys", { kind: "email", subject: "S", body_html: "B", body_text: "B", embedded_events: [] }, true],
  ["sms complete", { kind: "sms", body: "Doors at 9. Reply STOP." }, true],

  ["email bare kind", { kind: "email" }, false],
  ["email empty body_html", { kind: "email", subject: "S", body_html: "" }, false],
  ["email whitespace body_html", { kind: "email", subject: "S", body_html: "  \n\t " }, false],
  ["email empty subject", { kind: "email", subject: "", body_html: "B" }, false],
  ["email whitespace subject", { kind: "email", subject: "   ", body_html: "B" }, false],
  ["email missing subject key", { kind: "email", body_html: "B" }, false],
  ["THE #2291 ARI SHAPE", { kind: "email", body: "Ari wrote the body under the SMS key" }, false],
  ["email subject non-string", { kind: "email", subject: 42, body_html: "B" }, false],
  ["email body_html non-string", { kind: "email", subject: "S", body_html: ["B"] }, false],
  ["email subject json null", { kind: "email", subject: null, body_html: "B" }, false],

  ["sms bare kind", { kind: "sms" }, false],
  ["sms empty body", { kind: "sms", body: "" }, false],
  ["sms whitespace body", { kind: "sms", body: "   " }, false],
  ["sms body non-string", { kind: "sms", body: 7 }, false],

  ["rcs with body", { kind: "rcs", body: "x" }, false],
  ["rcs with full email shape", { kind: "rcs", subject: "S", body_html: "B" }, false],
  ["unknown kind", { kind: "carrier-pigeon", body_html: "B" }, false],
  ["empty kind string", { kind: "", body_html: "B" }, false],
  ["missing kind", { subject: "S", body_html: "B" }, false],
  ["kind non-string", { kind: 1, body_html: "B" }, false],
];

describe("campaignPayloadIssues — shared case table", () => {
  it.each(CASES)("%s", (_label, payload, expectedValid) => {
    expect(campaignPayloadIssues(payload).length === 0).toBe(expectedValid);
    expect(isCampaignPayloadSendable(payload)).toBe(expectedValid);
  });
});

describe("campaignPayloadIssues — never throws", () => {
  // The whole reason this replaced `validateChannelPayload`: that one
  // dereferenced `payload.subject.trim()` with no guard and would have THROWN
  // on the malformed row it existed to reject. A validator that can throw turns
  // a bad row into a crashed screen — #2291's Q4 exactly.
  const HOSTILE: unknown[] = [
    null,
    undefined,
    [],
    ["kind", "email"],
    "email",
    42,
    true,
    NaN,
    Object.create(null),
    new Date(),
  ];

  it.each(HOSTILE.map((v, i) => [i, v]))("hostile[%s] returns an issue", (_i, value) => {
    expect(() => campaignPayloadIssues(value)).not.toThrow();
    expect(campaignPayloadIssues(value).length).toBeGreaterThan(0);
    expect(isCampaignPayloadSendable(value)).toBe(false);
  });
});

describe("campaignPayloadIssues — message quality", () => {
  it("names body_html, so the reader knows which key is wrong", () => {
    const issues = campaignPayloadIssues({ kind: "email", subject: "S", body: "wrong key" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("body_html");
  });

  it("reports BOTH problems for a bare email payload, not just the first", () => {
    expect(campaignPayloadIssues({ kind: "email" })).toHaveLength(2);
  });

  it("the operator banner talks about what they do next, not about JSON keys", () => {
    expect(CAMPAIGN_DRAFT_INCOMPLETE_BANNER).toBe(
      "This draft is missing its message. Add your text below before sending.",
    );
    expect(CAMPAIGN_DRAFT_INCOMPLETE_BANNER).not.toContain("body_html");
    expect(CAMPAIGN_DRAFT_INCOMPLETE_BANNER).not.toContain("channel_payload");
  });
});
