// #3355 Retest 7 (tester adversarial): the rework 6 structural status rule
// ("a status claim is backed only by a fresh row, read this turn, of the
// specific object it names"), attacked from angles the implementor's suite
// does not take. Every case holds at the tested commit and fails when its
// fix line is deleted (fails-on-revert recorded in the Retest 7 verdict):
//   1. the title the HOST names beats an older card for another event, for
//      the judge listing the claim, listing nothing, or down;
//   2. a title wrapped in bold, emoji and quotes is still that title;
//   3. a loop read from ANOTHER brand (list_events without a brand filter)
//      never backs a title the active brand's read shows as a draft;
//   4. a card that names its object only by id ("is it live?" after a
//      create card with no title) resolves to that row;
//   5. the caller's role is matched whatever its case and spacing, so a
//      scanner is told Ari can't check the website, never "not set up yet";
//   6. usefulness: a true named status, a how-to answer, a read listing and
//      a mixed "A is published, but B is still a draft" answer stand;
//   7. the post-approval path still holds a "now live" claim to the row;
//   8. model instructions from the proposal validators (ticket-tier and
//      campaign corrections) never reach the plan card.
// The judge is stubbed; the database is a fake caller client.

import {
  assertEquals,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
} from "../ariClaimCheck.ts";
import { objectStatusReadPlan, type StatusClient } from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";
import { ariUserFacingToolError } from "../agentRenditions.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "99999999-9999-4999-8999-999999999999";
const NIGHT = "22222222-2222-4222-8222-222222222222";
const BRUNCH = "22222222-2222-4222-8222-333333333333";

type Rows = Array<Record<string, unknown>>;

function fake(tables: Record<string, Rows | "error"> = {}): StatusClient {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(["eq", column, value]);
          return builder;
        },
        in: (column: string, value: unknown) => {
          filters.push(["in", column, value]);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) => {
          const rows = tables[table];
          if (rows === "error") {
            return Promise.resolve({ data: null, error: { message: "x" } })
              .then(resolve);
          }
          return Promise.resolve({
            data: (rows ?? []).filter((row) =>
              filters.every(([op, column, value]) =>
                !(column in row) ||
                (op === "eq"
                  ? row[column] === value
                  : (value as unknown[]).includes(row[column]))
              )
            ),
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc() {
      return Promise.resolve({ data: null, error: { message: "unknown" } });
    },
  };
}

const night = {
  id: NIGHT,
  brand_id: BRAND,
  title: "Lagos Night Out",
  status: "draft",
  event_type: "event",
};
const brunch = {
  id: BRUNCH,
  brand_id: BRAND,
  title: "Abuja Brunch",
  status: "scheduled",
  event_type: "event",
};

const card = (
  tool: string,
  title: string | null,
  args: Record<string, unknown>,
): WriteState => ({
  actionId: `a-${tool}-${title}`,
  toolName: tool,
  status: "executed",
  object: title,
  args: { ...(title ? { title } : {}), ...args },
  receiptText: null,
});

const claim = (
  quote: string,
  action: AriClaim["action"],
  kind: AriClaimKind,
  object: string | null,
): AriClaim => ({ quote, action, kind, object });

async function check(a: {
  host: string;
  reply: string;
  claims: readonly AriClaim[] | "fail";
  states?: WriteState[];
  observations?: ClaimObservation[];
  tables?: Record<string, Rows | "error">;
  role?: string | null;
  approved?: boolean;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: true,
    objects: states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({
      states,
      observations: a.observations ?? [],
      isReadTool: (tool) => /^(?:list|get)_/.test(tool),
    }),
    statusRead: objectStatusReadPlan({
      client: fake(a.tables ?? { events: [night, brunch] }),
      brandId: BRAND,
      text: a.reply,
      cards: states,
      hostMessage: a.host,
      brandRole: a.role ?? null,
    }),
    askedWriteThisTurn: false,
    ...(a.approved ? { approved: true } : {}),
    call: () =>
      a.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.claims }),
  });
  return out.text;
}

Deno.test("retest7 1: the title the host names beats an older card for another event", async () => {
  const reply = "Yes, your event is published!";
  for (
    const judge of [
      [claim(reply, "published", "event", "your event")],
      [],
      "fail",
    ] as const
  ) {
    const out = await check({
      host: "Is Lagos Night Out published?",
      reply,
      claims: judge,
      states: [card("publish_event", "Abuja Brunch", { event_id: BRUNCH })],
    });
    assertEquals(
      out,
      "Your records show Lagos Night Out as a draft.",
      JSON.stringify(judge),
    );
  }
});

Deno.test("retest7 2: a title in bold, emoji and quotes is still that title", async () => {
  for (
    const [reply, object] of [
      ["Yes! **Lagos Night Out** 🎉 is live.", "**Lagos Night Out** 🎉"],
      ["Yes, “Lagos Night Out” is live.", "“Lagos Night Out”"],
    ]
  ) {
    const out = await check({
      host: "Is it live?",
      reply,
      claims: [claim(reply, "live", "event", object)],
    });
    assertNotMatch(out, /is live/, out);
    assertNotMatch(out, /can't find/, out);
  }
});

Deno.test("retest7 3: another brand's loop row never backs a title the active brand shows as a draft", async () => {
  const reply = "Yes, Lagos Night Out is live.";
  const out = await check({
    host: "Is Lagos Night Out live?",
    reply,
    claims: [claim(reply, "live", "event", "Lagos Night Out")],
    tables: { events: [night] },
    observations: [{
      tool: "list_events",
      args: {},
      result: {
        events: [{
          id: "x",
          brand_id: OTHER_BRAND,
          title: "Lagos Night Out",
          status: "scheduled",
          event_type: "event",
        }],
      },
    }],
  });
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
});

Deno.test("retest7 4: a card that names its object only by id resolves to that row", async () => {
  const reply = "Yes, it's live!";
  const out = await check({
    host: "is it live?",
    reply,
    claims: [claim(reply, "live", "event", "it")],
    states: [card("create_event", null, { event_id: NIGHT })],
  });
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
});

Deno.test("retest7 5: the caller's role is matched whatever its case and spacing", async () => {
  const reply = "Yes, your website is live.";
  for (const role of ["scanner", " Scanner ", "SCANNER"]) {
    const out = await check({
      host: "Is my website live?",
      reply,
      claims: [claim(reply, "live", "website", "your website")],
      tables: { brand_sites: [] },
      role,
    });
    assertNotMatch(out, /not set up|is live/, `${role}: ${out}`);
  }
});

Deno.test("retest7 6: true status answers, how-to answers and read listings stand", async () => {
  const keep: Array<[string, string, readonly AriClaim[] | "fail"]> = [
    ["Is Abuja Brunch live?", "Yes, Abuja Brunch is live.", [
      claim("Yes, Abuja Brunch is live.", "live", "event", "Abuja Brunch"),
    ]],
    ["Is Abuja Brunch live?", "Yes, Abuja Brunch is live.", "fail"],
    ["is abuja brunch live", "Yes, abuja brunch is live.", [
      claim("Yes, abuja brunch is live.", "live", "event", "abuja brunch"),
    ]],
    [
      "How do I publish an event?",
      "Open Events, tap your event, then tap Publish. Once published, guests can buy tickets.",
      "fail",
    ],
    [
      "What events do I have?",
      "You have two events: Lagos Night Out (draft) and Abuja Brunch (published).",
      "fail",
    ],
    [
      "How are my events doing?",
      "Abuja Brunch is published, but Lagos Night Out is still a draft.",
      [
        claim(
          "Abuja Brunch is published, but Lagos Night Out is still a draft.",
          "published",
          "event",
          "Abuja Brunch",
        ),
      ],
    ],
  ];
  for (const [host, reply, judge] of keep) {
    assertEquals(await check({ host, reply, claims: judge }), reply, reply);
  }
});

Deno.test("retest7 7: the post-approval path holds 'now live' to the row", async () => {
  const reply = "Lagos Night Out is now live!";
  const out = await check({
    host: "publish Lagos Night Out",
    reply,
    claims: [claim(reply, "live", "event", "Lagos Night Out")],
    approved: true,
    tables: { events: [night] },
    observations: [{
      tool: "publish_event",
      args: { event_id: NIGHT },
      result: { ok: true },
    }],
  });
  assertEquals(out, "Your records show Lagos Night Out as a draft.");
});

Deno.test("retest7 8: proposal-validator corrections for the model never reach the plan card", () => {
  for (
    const error of [
      {
        code: "REQUESTED_TOOL_MISMATCH",
        message:
          "The user asked to add a ticket tier to an existing event. Do not create or edit an event. Use the canonical list_events result to identify the named event, then return upsert_ticket_tier for that event.",
      },
      {
        code: "INVALID_ARGS",
        message:
          "Remove unsupported campaign claims and provide a complete message.",
      },
      {
        code: "INVALID_ARGS",
        message:
          "Read the current discovery-currency state first, then include its positive expected_state_version.",
      },
    ]
  ) {
    const shown = ariUserFacingToolError(error);
    assertNotMatch(
      shown,
      /list_events|upsert_ticket_tier|expected_state_version|The user asked|Remove unsupported/,
      shown,
    );
  }
});
