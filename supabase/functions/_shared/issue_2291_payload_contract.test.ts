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
  buildGroundedCampaignDraft,
  campaignDraftCopyIssues,
  campaignDraftPayloadIssues,
  campaignPayloadIssues,
  isCampaignPayloadSendable,
} from "./campaignPayloadContract.ts";
import { validateAriCampaignDraftProposal } from "./agentToolAuthorization.ts";
import { ToolError } from "./agentToolHelpers.ts";

// [label, payload, expectedValid]
const CASES: Array<[string, unknown, boolean]> = [
  ["email complete", {
    kind: "email",
    subject: "Doors at 9",
    body_html: "<p>See you.</p>",
  }, true],
  ["email complete + optional keys", {
    kind: "email",
    subject: "S",
    body_html: "B",
    body_text: "B",
    embedded_events: [],
  }, true],
  ["sms complete", { kind: "sms", body: "Doors at 9. Reply STOP." }, true],

  ["email bare kind", { kind: "email" }, false],
  [
    "email empty body_html",
    { kind: "email", subject: "S", body_html: "" },
    false,
  ],
  ["email whitespace body_html", {
    kind: "email",
    subject: "S",
    body_html: "  \n\t ",
  }, false],
  [
    "email empty subject",
    { kind: "email", subject: "", body_html: "B" },
    false,
  ],
  ["email whitespace subject", {
    kind: "email",
    subject: "   ",
    body_html: "B",
  }, false],
  ["email missing subject key", { kind: "email", body_html: "B" }, false],
  ["THE #2291 ARI SHAPE", {
    kind: "email",
    body: "Ari wrote the body under the SMS key",
  }, false],
  [
    "email subject non-string",
    { kind: "email", subject: 42, body_html: "B" },
    false,
  ],
  ["email body_html non-string", {
    kind: "email",
    subject: "S",
    body_html: ["B"],
  }, false],
  [
    "email subject json null",
    { kind: "email", subject: null, body_html: "B" },
    false,
  ],

  ["sms bare kind", { kind: "sms" }, false],
  ["sms empty body", { kind: "sms", body: "" }, false],
  ["sms whitespace body", { kind: "sms", body: "   " }, false],
  ["sms body non-string", { kind: "sms", body: 7 }, false],

  ["rcs with body", { kind: "rcs", body: "x" }, false],
  [
    "rcs with full email shape",
    { kind: "rcs", subject: "S", body_html: "B" },
    false,
  ],
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
      `${label}: expected ${expectedValid ? "VALID" : "INVALID"}, got ${
        JSON.stringify(issues)
      }`,
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
  const issues = campaignPayloadIssues({
    kind: "email",
    subject: "S",
    body: "wrong key",
  });
  assertEquals(issues.length, 1);
  assertStringIncludes(issues[0], "body_html");
});

Deno.test("#2291 — a payload missing everything reports BOTH problems, not just the first", () => {
  assertEquals(campaignPayloadIssues({ kind: "email" }).length, 2);
});

Deno.test("#3355 — invalid email drafts are refused before an approval card", () => {
  const issues = campaignDraftPayloadIssues({
    channel: "email",
    title: "Golden Hour Social",
    body: "A grounded message, but no subject.",
  });
  assertEquals(issues.length, 1);
  assertStringIncludes(issues[0], "subject line");

  let error: ToolError | null = null;
  try {
    validateAriCampaignDraftProposal({
      channel: "email",
      title: "Golden Hour Social",
      body: "A grounded message, but no subject.",
    });
  } catch (caught) {
    if (caught instanceof ToolError) error = caught;
    else throw caught;
  }
  assert(error instanceof ToolError);
  assertEquals(error.code, "INVALID_ARGS");
  assertStringIncludes(error.message, "subject line");
});

Deno.test("#3355 — complete email and SMS draft arguments pass the pre-approval gate", () => {
  validateAriCampaignDraftProposal({
    channel: "email",
    title: "Golden Hour Social",
    subject: "Join Golden Hour Social",
    body: "<p>Join us for rooftop music in Lagos.</p>",
  });
  validateAriCampaignDraftProposal({
    channel: "sms",
    title: "Golden Hour Social",
    body: "Join us for rooftop music in Lagos.",
  });
});

Deno.test("#3355 — campaign proposals reject claims and links absent from user facts", () => {
  const error = (() => {
    try {
      validateAriCampaignDraftProposal(
        {
          channel: "email",
          title: "Golden Hour Social: Early-Bird Access",
          subject: "Golden Hour Social is back",
          body:
            '<p>Join live music under the stars before it sells out!</p><a href="https://mingla.com/event/golden-hour-social">Join now</a>',
        },
        "Promote Golden Hour Social, a rooftop music event, with early-bird access.",
      );
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert(error instanceof ToolError);
  assertStringIncludes(error.message, "event history");
  assertStringIncludes(error.message, "scarcity or urgency");
  assertStringIncludes(error.message, "unverified performance details");
  assertStringIncludes(error.message, "unverified event setting");
  assertStringIncludes(error.message, "campaign link the host did not provide");

  validateAriCampaignDraftProposal(
    {
      channel: "email",
      title: "Golden Hour Social: Early-Bird Access",
      subject: "Golden Hour Social: Early-Bird Access",
      body:
        "<p>Join Harmattan House for Golden Hour Social, a rooftop music event in Lagos. Early-bird access is available.</p>",
    },
    "Promote Golden Hour Social, a rooftop music event, with early-bird access.",
  );
});

Deno.test("#3355 — risky campaign copy repairs to a small source-grounded draft", () => {
  const source =
    "Help Harmattan House promote Golden Hour Social to Lagos music fans using the early-bird access offer.";
  const repaired = buildGroundedCampaignDraft(
    {
      brand_id: "11111111-1111-4111-8111-111111111111",
      channel: "email",
      title: "Golden Hour Social is back before it sells out",
      subject: "Live music under the stars",
      body: '<a href="https://mingla.com/event/fake">Join us</a>',
    },
    source,
    "Harmattan House",
  );
  assert(repaired);
  assertEquals(repaired.title, "Golden Hour Social — early-bird access");
  assertEquals(repaired.subject, "Golden Hour Social — early-bird access");
  assertEquals(
    repaired.body,
    "<p>Hello,</p><p>Join Harmattan House for Golden Hour Social.</p><p>Ask Harmattan House about the early-bird access offer.</p>",
  );
  assertEquals(campaignDraftPayloadIssues(repaired), []);
  assertEquals(campaignDraftCopyIssues(repaired, source), []);
});

Deno.test("#3355 — the grounded email draft escapes host-typed brand and event names", () => {
  const source =
    "Help promote <i>Cats & Dogs</i> Night to Lagos fans using the early-bird access offer.";
  const repaired = buildGroundedCampaignDraft(
    {
      brand_id: "11111111-1111-4111-8111-111111111111",
      channel: "email",
      title: "x",
      subject: "x",
      body: "x",
    },
    source,
    "<b>Tom & Jerry</b>",
  );
  assert(repaired);
  assertEquals(
    repaired.body,
    "<p>Hello,</p><p>Join &lt;b&gt;Tom &amp; Jerry&lt;/b&gt; for &lt;i&gt;Cats &amp; Dogs&lt;/i&gt; Night.</p><p>Ask &lt;b&gt;Tom &amp; Jerry&lt;/b&gt; about the early-bird access offer.</p>",
  );
  assert(!String(repaired.body).includes("<b>"));
  // SMS is plain text, not HTML: the names stay as typed.
  const sms = buildGroundedCampaignDraft(
    { channel: "sms", body: "x" },
    source,
    "<b>Tom & Jerry</b>",
  );
  assert(sms);
  assertEquals(
    sms.body,
    "Join <b>Tom & Jerry</b> for <i>Cats & Dogs</i> Night. Ask <b>Tom & Jerry</b> about the early-bird access offer.",
  );
});
