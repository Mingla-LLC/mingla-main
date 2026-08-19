/**
 * issue #2291 T-13 — the shared payload contract's case table.
 *
 * This exact table is mirrored in
 * `mingla-business/src/services/marketing/__tests__/campaignPayloadContract.test.ts`,
 * so the Deno copy and the RN copy are proven to return identical verdicts
 * rather than assumed to.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  campaignPayloadIssues,
  isCampaignPayloadSendable,
} from "./campaignPayloadContract.ts";

// [label, payload, expectedValid]
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

Deno.test("#2291 T-13 — the shared contract's full case table", () => {
  for (const [label, payload, expectedValid] of CASES) {
    const issues = campaignPayloadIssues(payload);
    assertEquals(
      issues.length === 0,
      expectedValid,
      `${label}: expected ${expectedValid ? "VALID" : "INVALID"}, got ${JSON.stringify(issues)}`,
    );
    assertEquals(isCampaignPayloadSendable(payload), expectedValid, label);
  }
});

// The whole point of this module over the dead `validateChannelPayload` it
// replaces: that one dereferenced `payload.subject.trim()` without a guard and
// would have THROWN on the malformed rows it existed to reject.
Deno.test("#2291 — never throws on hostile input; returns an issue instead", () => {
  const hostile: unknown[] = [
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
  // Indexed, not stringified: `String(Object.create(null))` itself throws, and
  // a test whose own message can throw hides the result it was written to show.
  hostile.forEach((value, index) => {
    const issues = campaignPayloadIssues(value);
    assert(issues.length > 0, `hostile[${index}] must produce an issue`);
    assertEquals(isCampaignPayloadSendable(value), false, `hostile[${index}]`);
  });
});

Deno.test("#2291 — the email issue names the right key, so Ari can self-correct", () => {
  const issues = campaignPayloadIssues({ kind: "email", subject: "S", body: "wrong key" });
  assertEquals(issues.length, 1);
  assertStringIncludes(issues[0], "body_html");
});

Deno.test("#2291 — a payload missing everything reports BOTH problems, not just the first", () => {
  assertEquals(campaignPayloadIssues({ kind: "email" }).length, 2);
});
