// #3355 Retest 8 (tester adversarial): the rework 7 per-clause status rule
// (I-ARI-STATUS-PER-ASSERTED-CLAUSE) attacked through clause splitting itself
// and the intent read, from angles the implementor's suite does not take:
//   1. a false "Lagos Night Out is published" (it is a draft; an older
//      publish card for Abuja Brunch is in the chat) is corrected however the
//      sentence is cut: run-on with no punctuation, semicolons, parentheses,
//      emoji, Pidgin, French, a negation or condition in ANOTHER clause, a
//      "since / if / before / when" lead-in, a modal elsewhere, lowercase —
//      for the judge listing it, listing nothing, or down;
//   2. true answers stand: "still a draft", "isn't published yet; publish it
//      from …", a named live event, one event unnamed (live and draft), a
//      Pidgin negative;
//   3. the intent read: a status follow-up about an existing code ("Did you
//      make the code?", "Can guests use FAVY10 now?") stays a status turn
//      when the read says no write; a write the read names (or the grammar
//      names when the read failed) is never backed by an older code card.
// The judge is stubbed; the database is a fake caller client.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimRecordsRead,
} from "../ariClaimCheck.ts";
import { objectStatusReadPlan, type StatusClient } from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
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

const codeCard = (code: string): WriteState => ({
  actionId: code,
  toolName: "create_discount",
  status: "executed",
  object: code,
  args: { code },
  receiptText: null,
});

/** The brand's codes, read as the caller: FAVY10 is active. */
const codesRead = (
  _kinds: ReadonlySet<AriClaimKind>,
  objects: readonly string[],
): Promise<ClaimRecordsRead> =>
  Promise.resolve({
    records: objects.filter((code) => code.toUpperCase() === "FAVY10").map(
      (code) => ({
        status: "read" as const,
        kind: "discount" as const,
        toolName: "list_discounts",
        objects: [code.toUpperCase()],
        state: null,
        thisTurn: false,
        readState: { live: true, label: "active" },
      }),
    ),
    checkedKinds: ["note", "support"],
    checkedObjects: [...objects],
  });

async function check(a: {
  host: string;
  reply: string;
  claims: readonly AriClaim[] | "fail";
  states?: WriteState[];
  tables?: Record<string, Rows | "error">;
  codes?: boolean;
  asked?: boolean;
  intentRead?: boolean;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
    recentWrite: true,
    objects: states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({ states, observations: [] }),
    statusRead: objectStatusReadPlan({
      client: fake(a.tables ?? {}),
      brandId: BRAND,
      text: a.reply,
      cards: states,
      hostMessage: a.host,
      brandRole: null,
    }),
    ...(a.codes ? { moreEvidence: codesRead } : {}),
    askedWriteThisTurn: a.asked ?? false,
    ...(a.intentRead !== undefined ? { intentRead: a.intentRead } : {}),
    call: () =>
      a.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.claims }),
  });
  return out.text;
}

const JUDGES = (one: AriClaim): Array<readonly AriClaim[] | "fail"> => [
  [one],
  [],
  "fail",
];
const EVENTS = { events: [night, brunch] };
const BRUNCH_CARD = [
  card("publish_event", "Abuja Brunch", { event_id: BRUNCH }),
];

Deno.test("retest 8 (1): a false status is corrected however the sentence is cut", async () => {
  const replies = [
    "Yes Lagos Night Out is published you dont need to do anything else",
    "Yes; Lagos Night Out is published; nothing else to do.",
    "Lagos Night Out (published) is ready for guests.",
    "Lagos Night Out ✅ published 🎉",
    "Yes o, Lagos Night Out don dey live!",
    "Oui, Lagos Night Out est publié.",
    "Lagos Night Out isn't a draft anymore, it's published.",
    "Lagos Night Out has been published.",
    "**Lagos Night Out:** Published ✅",
    "If you were wondering, Lagos Night Out is published.",
    "Before you ask, Lagos Night Out is already live.",
    "When I checked just now, Lagos Night Out was live.",
    "Since Lagos Night Out is published, you can share the link.",
    "You can relax, Lagos Night Out is live.",
    "Lagos Night Out is live and guests will love it.",
    "yes lagos night out is live",
    "Yes, Lagos Night Out is live — e don dey for Discover.",
  ];
  for (const reply of replies) {
    for (
      const claims of JUDGES(
        claim(reply, "published", "event", "Lagos Night Out"),
      )
    ) {
      const out = await check({
        host: "Is Lagos Night Out published?",
        reply,
        claims,
        tables: EVENTS,
        states: BRUNCH_CARD,
      });
      assert(
        out.trim() !== reply.trim() && /draft/i.test(out),
        `${JSON.stringify(claims)} kept a false status: ${reply} -> ${out}`,
      );
    }
  }
});

Deno.test("retest 8 (2): true answers stand, whatever the judge does", async () => {
  const cases: Array<[string, string, Rows]> = [
    ["Is Lagos Night Out published?", "No, Lagos Night Out is still a draft.", [
      night,
      brunch,
    ]],
    [
      "Is Lagos Night Out published?",
      "Lagos Night Out isn't published yet; publish it from the event page.",
      [night, brunch],
    ],
    ["Is Abuja Brunch live?", "Yes, Abuja Brunch is live.", [night, brunch]],
    ["Is my event published?", "No, your event is still a draft.", [night]],
    ["Is my event live?", "Yes, your event is live.", [brunch]],
    [
      "Is Lagos Night Out published?",
      "Lagos Night Out never dey live, e still be draft.",
      [night, brunch],
    ],
  ];
  for (const [host, reply, events] of cases) {
    const object = /Abuja/.test(reply)
      ? "Abuja Brunch"
      : /your event/.test(reply)
      ? "your event"
      : "Lagos Night Out";
    for (const claims of JUDGES(claim(reply, "live", "event", object))) {
      const out = await check({ host, reply, claims, tables: { events } });
      assert(
        out.trim() === reply.trim(),
        `${JSON.stringify(claims)} changed a true answer: ${reply} -> ${out}`,
      );
    }
  }
});

Deno.test("retest 8 (3): the intent read decides write vs status in both directions", async () => {
  // A status follow-up about an existing code: the read says no write.
  for (
    const host of [
      "Did you make the code?",
      "Has the student code been created?",
      "Can guests use FAVY10 now?",
      "Did FAVY10 go through?",
    ]
  ) {
    const reply = "Yes, FAVY10 is live.";
    const out = await check({
      host,
      reply,
      claims: [claim(reply, "live", "discount", "FAVY10")],
      states: [codeCard("FAVY10")],
      codes: true,
      intentRead: true,
      asked: false,
    });
    assert(out.trim() === reply, `${host}: ${out}`);
  }
  // A write the read names, or the grammar names when the read failed: an
  // older code card never backs "Done!".
  const done = "Done! Your student discount is live.";
  for (
    const [asked, intentRead] of [[true, true], [false, false]] as const
  ) {
    const out = await check({
      host: "Can you make a code?",
      reply: done,
      claims: [claim(done, "live", "discount", "your student discount")],
      states: [codeCard("FAVY10")],
      codes: true,
      intentRead,
      asked,
    });
    assert(
      !/Done!|is live/.test(out),
      `asked=${asked} read=${intentRead}: ${out}`,
    );
  }
});
