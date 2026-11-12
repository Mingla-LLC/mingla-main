// #3355 final fix (after the confirm test, before the PR; Seth 2026-11-12:
// the new Ari is on for every brand at launch).
//   C-1  Seth's tie-break is deterministic: a write request answered with a
//        completion claim (any tense or voice) and no write or card this turn
//        is corrected to the true state whatever the judge did (listed it,
//        listed nothing, timed out, failed), and the agent loop asks the
//        model once for the proposal instead. The tester's publish / update /
//        create table is corrected; status follow-ups, how-to and read
//        answers are kept.
//   C-2  an Ari card keeps its brand (related_brand_id), and the post-approval
//        switch read resolves the brand from the event / trip it changed.
//   C-3  the Improvement Lab's "Complete" keeps the rollout's audience on.
//   P3   second person in receipts, no invented "publish the code" step, a
//        question step title asked again, "Type: Code".
// The judge and the database are stubbed.
//
// MINGLA-INVARIANT: I-ARI-WRITE-REQUEST-DONE-NEEDS-WRITE | issue #3355 | When the host's message is a write request and the reply claims a write is done ("I've updated…", "Published!", "Done", "is live now") while nothing was written or proposed this turn, every such sentence is replaced deterministically by the true state, whatever the claim-check judge returned; a status follow-up with no write verb, a how-to and a read answer are never touched.
// MINGLA-INVARIANT: I-ARI-ROLLOUT-COMPLETE-STAYS-ON | issue #3355 | A rollout of 'ari-understand-first-3355' with status completed keeps its audience on (completed at 100 % covers every brand); only paused or rolled_back switch it off (enforced by supabase/functions/_shared/__tests__/issue_3355_final_fix.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  type ClaimRecordsRead,
  completionClaimWithoutProposal,
  replyClaimsCompletion,
  writeRequestThisTurn,
  writeRequestTrueState,
} from "../ariClaimCheck.ts";
import { objectStatusReadPlan, type StatusClient } from "../ariStatusRead.ts";
import { type WriteState } from "../ariTruthGuards.ts";
import { speakToHost } from "../ariOwnerCopy.ts";
import { stepLine, waitingText } from "../ariFlows/runner.ts";
import {
  ariRolloutCovers,
  pendingActionBrandId,
  readAriUnderstandFirst,
  resetAriRolloutCache,
  resolveApprovedActionBrandId,
} from "../ariRollout.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const EV1 = "22222222-2222-4222-8222-222222222222";
const EV2 = "22222222-2222-4222-8222-333333333333";

type Rows = Array<Record<string, unknown>>;

/** A caller client over in-memory tables (eq / in filters honoured). */
function fake(tables: Record<string, Rows | "error"> = {}): StatusClient {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        is: () => builder,
        not: () => builder,
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

const card = (
  tool: string,
  object: string | null,
  args: Record<string, unknown> = {},
): WriteState => ({
  actionId: `a-${tool}-${object}`,
  toolName: tool,
  status: "executed",
  object,
  args: { ...(object ? { title: object } : {}), ...args },
  receiptText: null,
});
const codeCard = (code: string): WriteState => ({
  actionId: code,
  toolName: "create_discount",
  status: "executed",
  object: code,
  args: { code },
  receiptText: null,
});
const brandRead = (codes: Record<string, string>) =>
(
  _kinds: ReadonlySet<AriClaimKind>,
  objects: readonly string[],
): Promise<ClaimRecordsRead> =>
  Promise.resolve({
    records: objects.filter((code) => codes[code.toUpperCase()]).map((
      code,
    ) => ({
      status: "read" as const,
      kind: "discount" as const,
      toolName: "list_discounts",
      objects: [code.toUpperCase()],
      state: null,
      thisTurn: false,
      readState: {
        live: codes[code.toUpperCase()] === "active",
        label: codes[code.toUpperCase()],
      },
    })),
    checkedKinds: ["note", "support"],
    checkedObjects: [...objects],
  });
const claim = (
  quote: string,
  action: AriClaim["action"],
  kind: AriClaimKind,
  object: string | null = null,
): AriClaim => ({ quote, action, kind, object });

async function run(a: {
  host: string;
  reply: string;
  claims: readonly AriClaim[] | "fail";
  states?: WriteState[];
  tables?: Record<string, Rows | "error">;
  observations?: ClaimObservation[];
  objects?: string[];
  read?: ReturnType<typeof brandRead>;
  asked?: boolean;
  intentRead?: boolean;
  intent?: string;
  previousTurn?: string;
  /** The status read's plan is told the previous turn (agent-chat does). */
  planSeesPreviousTurn?: boolean;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: a.intent ?? "question",
    recentWrite: true,
    objects: a.objects ??
      states.flatMap((state) => state.object ? [state.object] : []),
    evidence: buildClaimEvidence({
      states,
      observations: a.observations ?? [],
      isReadTool: (tool) => /^(?:list|get)_/.test(tool),
    }),
    statusRead: objectStatusReadPlan({
      client: fake(a.tables ?? {}),
      brandId: BRAND,
      text: a.reply,
      cards: states,
      hostMessage: a.host,
      brandRole: null,
      ...(a.previousTurn && a.planSeesPreviousTurn !== false
        ? { previousTurn: a.previousTurn }
        : {}),
    }),
    ...(a.read ? { moreEvidence: a.read } : {}),
    askedWriteThisTurn: a.asked ?? false,
    ...(a.intentRead !== undefined ? { intentRead: a.intentRead } : {}),
    ...(a.previousTurn ? { previousTurn: a.previousTurn } : {}),
    call: () =>
      a.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : Promise.resolve({ claims: a.claims }),
  });
  return out.text;
}

/** The three judge states every status case is held to. */
const JUDGES = (one: AriClaim): Array<readonly AriClaim[] | "fail"> => [
  [one],
  [],
  "fail",
];

const draftNight = {
  id: EV1,
  brand_id: BRAND,
  title: "Lagos Night Out",
  status: "draft",
  event_type: "event",
};
const pubBrunch = {
  id: EV2,
  brand_id: BRAND,
  title: "Abuja Brunch",
  status: "scheduled",
  event_type: "event",
};

const EV = { events: [draftNight, pubBrunch] };
const AB = [card("publish_event", "Abuja Brunch", { event_id: EV2 })];

const fav = {
  states: [codeCard("FAVY10")],
  objects: ["FAVY10"],
  read: brandRead({ FAVY10: "active" }),
};

/** The true-state sentences (no claim that anything was done). */
const TRUE_STATE =
  /^I haven't (?:published it|created it|changed it|changed anything|sent anything) yet — want me to prepare (?:it for you to approve|the update|that for you to approve)\?$/;

// ── C-1: the tester's table, corrected in every judge state ────────────────

const EVENT_REPLIES = [
  "Done! It's published.",
  "Done! Your rooftop party is live.",
  "Done, your event is published.",
  "All set, your rooftop party is live!",
  "All set! It's live.",
  "I've published it for you.",
  "I've published your rooftop party.",
  "I published it.",
  "Your rooftop party has been published.",
  "Published! Guests can now buy tickets.",
];
const EVENT_HOSTS = [
  "Can you make my rooftop party live?",
  "Please publish my event",
  "Publish Lagos Night Out",
];

Deno.test("C-1: publish requests answered 'done' with no write this turn are corrected whatever the judge did (tester table)", async () => {
  let rows = 0;
  for (const host of EVENT_HOSTS) {
    for (const reply of EVENT_REPLIES) {
      for (const states of [AB, []]) {
        // The tester's two shapes: intent question / no write asked, and
        // intent tool / write asked.
        for (
          const shape of [
            { intent: "question", asked: false },
            { intent: "tool", asked: true },
          ]
        ) {
          for (
            const judge of JUDGES(
              claim(
                reply,
                "published",
                "event",
                host.includes("Lagos") ? "Lagos Night Out" : "it",
              ),
            )
          ) {
            const out = await run({
              host,
              reply,
              intentRead: true,
              ...shape,
              tables: EV,
              states,
              claims: judge,
            });
            rows++;
            const label = `${host} | ${reply} | ${states.length} | ${
              JSON.stringify(shape)
            } | ${JSON.stringify(judge).slice(0, 20)}: ${out}`;
            assertNotEquals(out.trim(), reply, label);
            assert(!replyClaimsCompletion(out), label);
            assertNotMatch(out, /can now buy|is live|is published/i, label);
          }
        }
      }
    }
  }
  assertEquals(rows, 360);
});

Deno.test("C-1: create requests answered 'done' with no write this turn are corrected (code side, Pidgin, 'Created!')", async () => {
  const replies = [
    "I've created the code for you.",
    "I created your student code.",
    "Your student code has been created.",
    "All set, your student code is live!",
    "I've set up a 15% student discount.",
    "Created! Students can now use it.",
    "Done! Your student discount is live.",
  ];
  const hosts = [
    "Can you make a code for students?",
    "Please create a student code",
    "abeg make code for my students",
    "Abeg create one student code",
    "I need you to create a student code",
  ];
  for (const host of hosts) {
    for (const reply of replies) {
      for (const states of [fav, { states: [], objects: [] }]) {
        for (const intentRead of [true, false]) {
          for (
            const judge of JUDGES(
              claim(reply, "created", "discount", "your student code"),
            )
          ) {
            const out = await run({
              host,
              reply,
              intentRead,
              intent: "tool",
              asked: true,
              ...states,
              claims: judge,
            });
            const label = `${host} | ${reply} | ${intentRead} | ${
              JSON.stringify(judge).slice(0, 20)
            }: ${out}`;
            assert(!replyClaimsCompletion(out), label);
            assertNotMatch(out, /can now use|is live|been created/i, label);
          }
        }
      }
    }
  }
});

Deno.test("C-1: the 10 Nov device turn ('change the description' → 'now saved') is corrected with the judge timed out", async () => {
  const reply =
    "I've updated the description for Lagos Night Out. The change is now saved in your draft event.";
  for (
    const judge of JUDGES(claim(reply, "updated", "event", "the description"))
  ) {
    for (const intentRead of [true, false]) {
      const out = await run({
        host:
          "Can you change the Lagos Night Out description to 'A night of Afrobeats on the rooftop'?",
        reply,
        intentRead,
        intent: "tool",
        asked: true,
        tables: EV,
        states: [],
        claims: judge,
      });
      // The judge listing it unbacked keeps the claim check's own true
      // state; with the judge empty or down the tie-break says it.
      assertMatch(
        out,
        judge === "fail" || judge.length === 0
          ? /^I haven't changed it yet — want me to prepare the update\?$/
          : /^I haven't (?:saved or sent anything for that|changed it) yet/,
        `${JSON.stringify(judge)}: ${out}`,
      );
    }
  }
  // Each claim shape alone, in any tense or voice.
  for (
    const reply of [
      "Done. It's saved.",
      "It's now saved.",
      "Your event is live now.",
      "The description is now updated.",
      "Updated!",
      "Lagos Night Out's description has been changed.",
      "We've updated it.",
    ]
  ) {
    const out = await run({
      host: "Please update the Lagos Night Out description",
      reply,
      intentRead: false,
      tables: EV,
      claims: "fail",
    });
    // The tie-break's true state, or the status read's own true state.
    assert(
      TRUE_STATE.test(out) ||
        out === "Your records show Lagos Night Out as a draft.",
      `${reply}: ${out}`,
    );
  }
});

Deno.test("C-1: a reply about ANOTHER recorded object keeps that sentence; only its 'Done!' goes", async () => {
  for (const judge of JUDGES(claim("Done!", "completed", "other", null))) {
    assertEquals(
      await run({
        host: "Can you make a student code too?",
        reply: "Done! FAVY10 is live.",
        intentRead: true,
        ...fav,
        claims: judge,
      }),
      "FAVY10 is live.",
    );
    assertEquals(
      await run({
        host: "Please publish Lagos Night Out",
        reply: "Done! Abuja Brunch is published.",
        intentRead: true,
        tables: EV,
        states: AB,
        claims: judge,
      }),
      "Abuja Brunch is published.",
    );
  }
});

// ── C-1: what must survive ─────────────────────────────────────────────────

Deno.test("C-1: status follow-ups, how-to and read answers are never touched by the tie-break", async () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["Did you make the code?", "Yes, FAVY10 is live.", fav],
    ["Is the code you made live?", "Yes, FAVY10 is live.", fav],
    ["Has the student code been created?", "Yes, FAVY10 is live.", fav],
    ["Can guests use FAVY10 now?", "Yes, FAVY10 is live.", fav],
    ["Did FAVY10 go through?", "Yes, FAVY10 is live.", fav],
    ["Is it live?", "Yes, FAVY10 is live.", fav],
    ["Thanks! Is FAVY10 working?", "Yes, FAVY10 is live.", fav],
    ["Is Abuja Brunch live?", "Yes, Abuja Brunch is live.", {
      tables: EV,
      states: AB,
    }],
    [
      "How do I make a discount code?",
      "Open Marketing, tap Discounts, then tap Create code. Choose the percent and the dates, then tap Save.",
      {},
    ],
    [
      "How do I publish my event?",
      "Open the event and tap Publish. Once you publish it, people can buy tickets.",
      { tables: EV },
    ],
    [
      "Tell me how to publish Lagos Night Out",
      "Open Lagos Night Out and tap Publish when you're ready.",
      { tables: EV },
    ],
    [
      "Show me my events",
      "You have two events: Lagos Night Out (a draft) and Abuja Brunch.",
      { tables: EV },
    ],
    [
      "What happens when I publish?",
      "When you publish, your event shows on Explore and people can buy tickets.",
      { tables: EV },
    ],
  ];
  for (const [host, reply, extra] of cases) {
    for (const intentRead of [true, false]) {
      for (const asked of [true, false]) {
        for (const judge of [[], "fail"] as const) {
          const out = await run({
            host,
            reply,
            intentRead,
            asked,
            intent: asked ? "tool" : "question",
            claims: judge,
            ...extra,
          });
          assertEquals(out, reply, `${host} | ${intentRead} | ${asked}`);
        }
      }
    }
  }
});

Deno.test("C-1: a write saved or proposed in this turn keeps its completion words", async () => {
  const observations: ClaimObservation[] = [{
    tool: "remember_note",
    args: { content: "Fridays work best" },
    result: { ok: true, note: { content: "Fridays work best" } },
  }];
  const out = await run({
    host: "Please remember that Fridays work best for my events",
    reply: "Done! I've saved that.",
    intentRead: true,
    asked: true,
    observations,
    claims: "fail",
  });
  assertNotMatch(out, /I haven't/);
});

Deno.test("C-1: writeRequestThisTurn — write verbs, Pidgin, a write intent; never how-to, tell-me, a status follow-up or after approval", () => {
  for (
    const host of [
      "Can you make my rooftop party live?",
      "Publish Lagos Night Out",
      "abeg make code for my students",
      "Kindly update the description",
    ]
  ) assert(writeRequestThisTurn({ hostMessage: host }), host);
  assert(
    writeRequestThisTurn({
      hostMessage: "Can I get a 15% code for students?",
      intentRead: true,
      askedWriteThisTurn: true,
    }),
  );
  for (
    const host of [
      "How do I make a code?",
      "Tell me how to publish my event",
      "Show me my codes",
      "Did you make the code?",
      "Is it live?",
    ]
  ) {
    assert(
      !writeRequestThisTurn({
        hostMessage: host,
        intentRead: true,
        askedWriteThisTurn: true,
      }),
      host,
    );
  }
  assert(
    !writeRequestThisTurn({
      hostMessage: "Publish Lagos Night Out",
      approved: true,
    }),
  );
  assertEquals(
    writeRequestTrueState("Can you change the description?"),
    "I haven't changed it yet — want me to prepare the update?",
  );
  assertEquals(
    writeRequestTrueState("Publish Lagos Night Out"),
    "I haven't published it yet — want me to prepare it for you to approve?",
  );
});

Deno.test("C-1: the loop asks the model once for the proposal when it says 'done' with no write", () => {
  const isReadTool = (tool: string) => /^(?:list|get)_/.test(tool);
  const issue = completionClaimWithoutProposal({
    text: "I've updated the description. The change is now saved.",
    hostMessage: "Can you change the Lagos Night Out description?",
    intentRead: true,
    askedWriteThisTurn: true,
    observations: [{ tool: "list_events", args: {} }],
    isReadTool,
  });
  assertEquals(issue?.code, "WRITE_PROPOSAL_REQUIRED");
  assertMatch(issue?.message ?? "", /tool call/);
  // A write ran this turn, a status follow-up, a plain answer: no bounce.
  assertEquals(
    completionClaimWithoutProposal({
      text: "Done! I've saved that.",
      hostMessage: "Remember that Fridays work best",
      observations: [{ tool: "remember_note", args: {} }],
      isReadTool,
    }),
    null,
  );
  assertEquals(
    completionClaimWithoutProposal({
      text: "Yes, it's live.",
      hostMessage: "Is it live?",
      observations: [],
      isReadTool,
    }),
    null,
  );
  assertEquals(
    completionClaimWithoutProposal({
      text: "Want me to publish it?",
      hostMessage: "Publish Lagos Night Out",
      observations: [],
      isReadTool,
    }),
    null,
  );
});

Deno.test("C-1: agent-chat runs the bounce on the on path, once per turn", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    source,
    /understandFirst && !completionClaimBounced &&\s*\(completionClaimIssue = completionClaimWithoutProposal\(/,
  );
  assertMatch(source, /\(completionClaimBounced = true\)/);
});

// ── C-2: the card's brand ──────────────────────────────────────────────────

function brandClient(
  events: Record<string, string>,
  fail = false,
): Pick<StatusClient, "from"> {
  return {
    from(table: string) {
      let id: unknown = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (_column: string, value: unknown) => {
          id = value;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve(
            fail
              ? { data: null, error: { code: "XX000" } }
              : table === "events" && typeof id === "string" && events[id]
              ? { data: { brand_id: events[id] }, error: null }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
  } as unknown as Pick<StatusClient, "from">;
}

Deno.test("C-2: update_event and publish_trip cards resolve their brand for the switch read", async () => {
  const service = brandClient({ [EV1]: BRAND, [EV2]: BRAND });
  // update_event / publish_trip carry no brand_id: the event decides.
  for (
    const toolArgs of [
      { event_id: EV1, description: "Rooftop" },
      { event_id: EV2, expected_updated_at: "2027-01-01T00:00:00Z" },
    ]
  ) {
    assertEquals(
      await resolveApprovedActionBrandId({ toolArgs, service }),
      BRAND,
    );
  }
  // The stored card brand wins; then the args' brand_id.
  const OTHER = "99999999-9999-4999-8999-999999999999";
  assertEquals(
    await resolveApprovedActionBrandId({
      brandId: OTHER,
      toolArgs: { event_id: EV1 },
      service,
    }),
    OTHER,
  );
  assertEquals(
    await resolveApprovedActionBrandId({
      toolArgs: { brand_id: OTHER },
      service,
    }),
    OTHER,
  );
  // A failed read and a missing id resolve nothing (the switch reads off).
  assertEquals(
    await resolveApprovedActionBrandId({
      toolArgs: { event_id: EV1 },
      service: brandClient({}, true),
    }),
    null,
  );
  assertEquals(
    await resolveApprovedActionBrandId({ toolArgs: {}, service }),
    null,
  );
  assertEquals(pendingActionBrandId("not-a-uuid"), null);
  assertEquals(pendingActionBrandId(BRAND), BRAND);
});

Deno.test("C-2: agent-chat stores the brand on every Ari card and agent-confirm-action passes it on", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /related_brand_id: pendingActionBrandId\(args\.brandId\)/,
  );
  const calls = chat.split("return await commitPendingTurn({").slice(1);
  assertEquals(calls.length, 7);
  for (const call of calls) {
    assertMatch(call.slice(0, 400), /brandId: activeBrand\?\.id \?\? null,/);
  }
  const post = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(post, /await resolveApprovedActionBrandId\(\{/);
  const confirm = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assertMatch(confirm, /brandId: pending\.related_brand_id \?\? null,/);
});

// ── C-3: "Complete" keeps it on ────────────────────────────────────────────

function rolloutClient(
  rows: Array<Record<string, unknown>>,
  seen: string[][],
): Pick<StatusClient, "from"> {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: { id: "v1" }, error: null }),
        in: (_column: string, statuses: string[]) => {
          seen.push(statuses);
          return Promise.resolve({
            data: table === "ari_rollouts"
              ? rows.filter((row) => statuses.includes(String(row.status)))
              : [],
            error: null,
          });
        },
      };
      return builder;
    },
  } as unknown as Pick<StatusClient, "from">;
}

Deno.test("C-3: a completed rollout keeps its audience on; paused and rolled back are off", async () => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  assert(
    ariRolloutCovers([{
      status: "completed",
      audience: {},
      rollout_percent: 100,
    }], OTHER),
  );
  assert(
    ariRolloutCovers([{
      status: "completed",
      audience: { all: true },
      rollout_percent: 0,
    }], null),
  );
  assert(
    ariRolloutCovers([{
      status: "completed",
      audience: { brand_ids: [BRAND] },
      rollout_percent: 0,
    }], BRAND),
  );
  assert(
    !ariRolloutCovers([{
      status: "completed",
      audience: { brand_ids: [BRAND] },
      rollout_percent: 0,
    }], OTHER),
  );
  for (const status of ["paused", "rolled_back", "draft"]) {
    assert(
      !ariRolloutCovers([{
        status,
        audience: { all: true },
        rollout_percent: 100,
      }], BRAND),
      status,
    );
  }
  // The switch reads completed rows from the database.
  resetAriRolloutCache();
  const seen: string[][] = [];
  const on = await readAriUnderstandFirst(
    rolloutClient([{
      status: "completed",
      audience: {},
      rollout_percent: 100,
    }], seen),
    BRAND,
    { override: null, now: 1 },
  );
  resetAriRolloutCache();
  assert(on);
  assert(seen.some((statuses) => statuses.includes("completed")));
});

// ── P3 ─────────────────────────────────────────────────────────────────────

Deno.test("P3: receipts speak to the host as 'you' and never add a 'publish the code' step", () => {
  assertEquals(
    speakToHost(
      "FAVY10 is active until 19 December. The host still needs to share this code with the influencer.",
    ),
    "FAVY10 is active until 19 December. You still need to share this code with the influencer.",
  );
  assertEquals(
    speakToHost("The host's guests can use it at checkout."),
    "Your guests can use it at checkout.",
  );
  assertEquals(
    speakToHost(
      "1. Open Marketing.\n2. Tap Create code.\n3. Publish the code.\n4. Share it.",
    ),
    "1. Open Marketing.\n2. Tap Create code.\n4. Share it.",
  );
  assertEquals(
    speakToHost("Publish your event when ready."),
    "Publish your event when ready.",
  );
});

Deno.test("P3: a step title that is a question is asked again, never pasted into a sentence", () => {
  assertEquals(
    stepLine("Where is it?"),
    "Here's the question again: Where is it?",
  );
  assertEquals(stepLine("Website design"), "We're on Website design:");
  const text = waitingText(
    { title: "Where is it?", text: "Search for the venue." } as never,
    "other" as never,
  );
  assertNotMatch(text, /We're on Where is it\?:/);
  assertMatch(text, /Here's the question again: Where is it\?/);
});
