// #3355 rework 8 (after Retest 8 FAIL, the last round before the PR). Four
// exits from the per-clause rule are closed structurally: a hedged or modal
// present ("should be live now", "guests can now buy tickets") is a present
// claim; a list or table line ("- X: published", "| X | Published |") is a
// clause of its own; a negated draft ("no longer a draft") and a focus "not
// only" are positive; and a plan about a status kind is kept as said, never
// handed to the card rules. Seth's tie-break: a write request answered with
// "Done!" and nothing written or proposed this turn is always corrected.
// Folds the retest-8 repro (R8-1 … R8-8) and pins R8-10, R8-11, R8-12 and the
// staged rollout switch. The judge and the database are stubbed.
//
// MINGLA-INVARIANT: I-ARI-STATUS-NEVER-TO-CARD-RULES | issue #3355 | (rework 8, extends I-ARI-STATUS-PER-ASSERTED-CLAUSE) A claim about the status of an event, trip, experience, stay, venue, tier, blast, website, refund or payout readiness is decided only by this turn's brand-scoped status read: a hedged or modal clause with a present-time word, a guest affordance said as now, a negated non-live publication state ("no longer a draft") and a list or table label line are positive assertions; a plan, condition or how-to with no present-time word is kept as said; none of them is ever backed by an older card (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_8.implementor.test.ts).
// MINGLA-INVARIANT: I-ARI-WRITE-REQUEST-DONE-NEEDS-WRITE | issue #3355 | (rework 8, Seth's tie-break) When the host's message asks for a write (a write verb in an action position) and the reply claims completion ("Done", "All set", "I've created", "it's live"), and nothing was written or proposed in this turn, the completion claim is corrected to the true state whatever the intent read said, unless it names one specific object a record of this chat matches; a status follow-up with no write verb is never touched (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_8.implementor.test.ts).
// MINGLA-INVARIANT: I-ARI-UNDERSTAND-FIRST-ROLLOUT | issue #3355 | (rework 8) The understand-first behaviour (intent read and start_flow, the reply claim check and its status reads, memory lines, the ask-the-team offer, the brand snapshot and the screen context) runs only when the ari_rollouts row for runtime version 'ari-understand-first-3355' covers the brand (allow-list, percent bucket, or global) or ARI_UNDERSTAND_FIRST=on; with no row the turn runs as before #3355 (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_8.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  type AriClaimKind,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  type ClaimRecordsRead,
  clauseMood,
  completionWithoutWrite,
  replyClaimsCompletion,
  statusAssertion,
  statusClauses,
} from "../ariClaimCheck.ts";
import { objectStatusReadPlan, type StatusClient } from "../ariStatusRead.ts";
import {
  checkStatedSlots,
  statedSlotsAskedBefore,
  type WriteState,
} from "../ariTruthGuards.ts";
import { ownerCopyViolations, stripPromptEcho } from "../ariOwnerCopy.ts";
import { draftWhenText } from "../ariTurnContext.ts";
import {
  ariRolloutBucket,
  ariRolloutCovers,
  ariUnderstandFirstOverride,
  readAriUnderstandFirst,
  resetAriRolloutCache,
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
  previousTurn?: string;
  /** The status read's plan is told the previous turn (agent-chat does). */
  planSeesPreviousTurn?: boolean;
}): Promise<string> {
  const states = a.states ?? [];
  const out = await checkReplyClaims({
    text: a.reply,
    hostMessage: a.host,
    intent: "question",
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
const LN = "Lagos Night Out";
const H = "Is Lagos Night Out published?";
const kept = (out: string, reply: string) => out.trim() === reply.trim();

// ── R8-1: a hedged or modal present is a present claim ─────────────────────

Deno.test("R8-1: 'should be live now', 'guests can now buy', 'can now be found on Discover' are held to the row, never another event's card", async () => {
  for (
    const reply of [
      "Your event should be live now.",
      "Guests can now buy tickets for your event.",
      "Your event can now be found on Discover.",
    ]
  ) {
    for (const judge of JUDGES(claim(reply, "live", "event", "your event"))) {
      const out = await run({
        host: H,
        reply,
        tables: EV,
        states: AB,
        claims: judge,
      });
      assertEquals(
        out,
        "Your records show Lagos Night Out as a draft.",
        `${JSON.stringify(judge)}: ${reply}`,
      );
    }
  }
});

Deno.test("R8-1 / R8-6: a plan, a condition or a how-to about a status kind is kept as said (never card rules)", async () => {
  for (
    const [host, reply, action] of [
      [
        "How do guests buy tickets?",
        "Once you publish Lagos Night Out, guests can buy tickets.",
        "published",
      ],
      [
        "How do I publish Lagos Night Out?",
        "To publish Lagos Night Out, open it and tap Publish.",
        "published",
      ],
      [
        "When can guests buy?",
        "Guests will be able to buy once it's live.",
        "live",
      ],
      [
        "Are my events live?",
        "Abuja Brunch is live, but Lagos Night Out is still a draft.",
        "live",
      ],
    ] as const
  ) {
    for (const judge of JUDGES(claim(reply, action, "event", LN))) {
      const out = await run({
        host,
        reply,
        tables: EV,
        states: AB,
        claims: judge,
      });
      assertEquals(out, reply, `${JSON.stringify(judge)}: ${reply}`);
    }
  }
  // A plan about a LIVE event, or with the status read down, is kept too
  // (it asserts nothing about the row).
  const livePlan = "When Abuja Brunch is published, guests can buy tickets.";
  for (const tables of [EV, { events: "error" as const }]) {
    for (
      const judge of JUDGES(
        claim(livePlan, "published", "event", "Abuja Brunch"),
      )
    ) {
      assertEquals(
        await run({
          host: "How do guests buy?",
          reply: livePlan,
          tables,
          claims: judge,
        }),
        livePlan,
        `${JSON.stringify(judge)} ${JSON.stringify(tables).slice(0, 20)}`,
      );
    }
  }
  const event = new Set<AriClaimKind>(["event"]);
  assertEquals(
    statusAssertion(
      claim("Your event can now be published.", "live", "event"),
      event,
    )?.plan,
    true,
    "a possibility the modal governs stays a plan",
  );
  assertEquals(
    statusAssertion(
      claim(
        "Guests will see your event on Discover from today.",
        "live",
        "event",
      ),
      event,
    )?.positive,
    true,
    "a future with a present-time word and no condition is held to the row",
  );
});

Deno.test("R8-1: clause moods for hedges and affordances", () => {
  const words = [/\b(?:live|published|on\s+discover)\b/i];
  assertEquals(clauseMood("Your event should be live now.", words), "positive");
  assertEquals(
    clauseMood("Your event should be live by Friday.", words),
    "future",
  );
  assertEquals(clauseMood("It can now be published", words), "future");
  assertEquals(
    clauseMood("People can find it on Discover now", words),
    "positive",
  );
  assertEquals(clauseMood("Guests can now buy tickets", words), "positive");
  assertEquals(clauseMood("Guests can buy tickets", words), "none");
  assertEquals(clauseMood("You can now add a cover photo", words), "none");
});

// ── R8-2: Seth's tie-break ─────────────────────────────────────────────────

Deno.test("R8-2: a write request + 'Done!' with nothing written this turn is corrected, whatever the intent read says", async () => {
  const done = "Done! Your student discount is live.";
  for (
    const host of [
      "Can you make a code?",
      "Please create a student code",
      "Make me a code for students",
      "Could you set up a student discount?",
    ]
  ) {
    for (const intentRead of [true, false]) {
      for (
        const judge of JUDGES(
          claim(done, "live", "discount", "your student discount"),
        )
      ) {
        const out = await run({
          host,
          reply: done,
          intentRead,
          asked: false,
          states: [codeCard("FAVY10")],
          objects: ["FAVY10"],
          read: brandRead({ FAVY10: "active" }),
          claims: judge,
        });
        assertNotMatch(
          out,
          /Done!|is live/,
          `${host} ${intentRead} ${JSON.stringify(judge)}: ${out}`,
        );
      }
    }
  }
  const ev = "Done! It's published.";
  for (const asked of [true, false]) {
    for (const intentRead of [true, false]) {
      const out = await run({
        host: "Can you make my rooftop party live?",
        reply: ev,
        intentRead,
        asked,
        tables: EV,
        states: AB,
        claims: [claim(ev, "published", "event", "it")],
      });
      // Final fix (C-1): the true state names the write and offers it.
      assertEquals(
        out,
        "I haven't published it yet — want me to prepare it for you to approve?",
        `asked=${asked} read=${intentRead}`,
      );
    }
  }
});

Deno.test("R8-2: status follow-ups with no write verb are never touched by the tie-break", async () => {
  for (
    const host of [
      "Did you make the code?",
      "Has the student code been created?",
      "Can guests use FAVY10 now?",
      "Did FAVY10 go through?",
      "Is it live?",
    ]
  ) {
    const reply = "Yes, FAVY10 is live.";
    for (const judge of JUDGES(claim(reply, "live", "discount", "FAVY10"))) {
      const out = await run({
        host,
        reply,
        intentRead: true,
        asked: false,
        states: [codeCard("FAVY10")],
        objects: ["FAVY10"],
        read: brandRead({ FAVY10: "active" }),
        claims: judge,
      });
      assertEquals(out, reply, `${host} ${JSON.stringify(judge)}`);
    }
  }
  // A completion claim naming the very object a record holds is decided by
  // that record, not the tie-break.
  const named = "I've created FAVY10 for you.";
  assertEquals(
    await run({
      host: "Create FAVY10 10% off",
      reply: named,
      states: [codeCard("FAVY10")],
      objects: ["FAVY10"],
      claims: [claim(named, "created", "discount", "FAVY10")],
    }),
    named,
  );
});

Deno.test("R8-2: the tie-break's parts", () => {
  for (
    const text of [
      "Done! Your code is live.",
      "All set ✅",
      "I've created the code.",
      "It's been published.",
      "Yes, it's live now.",
    ]
  ) assert(replyClaimsCompletion(text), text);
  for (
    const text of [
      "FAVY10 is live.",
      "Your event is still a draft.",
      "Here's how to make one.",
    ]
  ) assert(!replyClaimsCompletion(text), text);
  const saved = buildClaimEvidence({
    states: [codeCard("FAVY10")],
    thisTurnActionIds: ["FAVY10"],
  });
  const context = { hostMessage: "Can you make a code?", replyText: "Done!" };
  assert(
    completionWithoutWrite(
      context,
      buildClaimEvidence({ states: [codeCard("FAVY10")] }),
    ),
  );
  assert(!completionWithoutWrite(context, saved), "a write this turn backs it");
  assert(!completionWithoutWrite({ ...context, approved: true }, []));
  assert(
    !completionWithoutWrite(
      { ...context, hostMessage: "Did you make it?" },
      [],
    ),
  );
});

// ── R8-3 / R8-5: list and table lines, unspaced dashes, implicit status ────

Deno.test("R8-3: judge empty or down — a list or table of statuses is checked line by line", async () => {
  for (
    const [reply, want] of [
      [
        "Here's where things stand:\n- Lagos Night Out: published\n- Abuja Brunch: published",
        "Here's where things stand:\n- Your records show Lagos Night Out as a draft.\n- Abuja Brunch: published",
      ],
      [
        "| Event | Status |\n|---|---|\n| Lagos Night Out | Published |",
        "| Event | Status |\n|---|---|\nYour records show Lagos Night Out as a draft.",
      ],
      [
        "1. Lagos Night Out — published\n2. Abuja Brunch — published",
        "1. Your records show Lagos Night Out as a draft.\n2. Abuja Brunch — published",
      ],
    ]
  ) {
    for (const judge of [[], "fail"] as const) {
      const out = await run({
        host: "Are my events live?",
        reply,
        tables: EV,
        claims: judge,
      });
      assertEquals(out, want, `${JSON.stringify(judge)}: ${reply}`);
    }
  }
  const honest = "- Abuja Brunch: live\n- Lagos Night Out: draft";
  for (const judge of [[], "fail"] as const) {
    assertEquals(
      await run({
        host: "Are my events live?",
        reply: honest,
        tables: EV,
        claims: judge,
      }),
      honest,
    );
  }
  // A description is not a label: "live music" names no status.
  const described = "Lagos Night Out, live music and food all night.";
  for (const judge of [[], "fail"] as const) {
    assertEquals(
      await run({
        host: "What's Lagos Night Out like?",
        reply: described,
        tables: EV,
        claims: judge,
      }),
      described,
    );
  }
});

Deno.test("R8-5: judge empty or down — unspaced dash, on Discover, page is up, a bare 'yes, it is'", async () => {
  for (
    const reply of [
      "Lagos Night Out—published and ready for guests!",
      "Tickets for Lagos Night Out are on sale.",
      "People can find Lagos Night Out on Discover now.",
      "Your Lagos Night Out page is up.",
      'You asked "is Lagos Night Out published?" — yes, it is.',
      "Yes, it is!",
    ]
  ) {
    for (const judge of [[], "fail"] as const) {
      const out = await run({ host: H, reply, tables: EV, claims: judge });
      assert(!kept(out, reply), `${JSON.stringify(judge)}: ${reply} kept`);
      assertMatch(out, /Lagos Night Out as a draft/, reply);
    }
  }
  // "Yes" to a status question about a live event stands.
  for (const judge of [[], "fail"] as const) {
    assertEquals(
      await run({
        host: "Is Abuja Brunch published?",
        reply: "Yes, it is!",
        tables: EV,
        claims: judge,
      }),
      "Yes, it is!",
    );
  }
  const clauses = statusClauses("Lagos Night Out—published", [LN]);
  assertEquals(clauses.map((item) => item.text), [LN, "published"]);
});

// ── R8-4: negated drafts and "not only" ───────────────────────────────────

Deno.test("R8-4: 'no longer a draft' and 'not only is … published' assert live", async () => {
  for (
    const reply of [
      "Lagos Night Out is no longer a draft.",
      "Lagos Night Out isn't a draft anymore.",
      "Not only is Lagos Night Out published, it's already selling.",
    ]
  ) {
    for (const judge of JUDGES(claim(reply, "published", "event", LN))) {
      const out = await run({ host: H, reply, tables: EV, claims: judge });
      assertMatch(
        out,
        /Lagos Night Out as a draft/,
        `${JSON.stringify(judge)}: ${reply}`,
      );
    }
  }
  // True negatives stay negative.
  const words = [/\b(?:live|published)\b/i];
  assertEquals(
    clauseMood("Lagos Night Out isn't published yet", words),
    "negative",
  );
  assertEquals(clauseMood("it's still a draft", words), "negative");
  assertEquals(clauseMood("Lagos Night Out hasn't ended", words), "negative");
  assertEquals(
    clauseMood("Lagos Night Out is no longer a draft", words),
    "positive",
  );
  for (
    const reply of [
      "No, Lagos Night Out isn't published yet.",
      "Not yet — Lagos Night Out is still a draft.",
    ]
  ) {
    for (const judge of JUDGES(claim(reply, "published", "event", LN))) {
      assertEquals(
        await run({ host: H, reply, tables: EV, claims: judge }),
        reply,
      );
    }
  }
});

// ── R8-7 / R8-8 ───────────────────────────────────────────────────────────

Deno.test("R8-7: judge empty or down — 'Yes, it's live now!' after the previous turn named the draft", async () => {
  for (const judge of [[], "fail"] as const) {
    // Whether or not the status read's plan was told the previous turn, the
    // check's own pronoun rule reads it.
    for (const planSeesPreviousTurn of [true, false]) {
      const out = await run({
        host: "is it live yet?",
        reply: "Yes, it's live now!",
        previousTurn: "Lagos Night Out is saved as a draft.",
        planSeesPreviousTurn,
        tables: EV,
        claims: judge,
      });
      assertEquals(
        out,
        "Your records show Lagos Night Out as a draft.",
        `${JSON.stringify(judge)} ${planSeesPreviousTurn}`,
      );
    }
  }
});

Deno.test("R8-8: 'A and B are both live' with B a draft keeps A's true half", async () => {
  const reply = "Abuja Brunch and Lagos Night Out are both live.";
  for (const judge of JUDGES(claim(reply, "live", "event", null))) {
    const out = await run({
      host: "Are my events live?",
      reply,
      tables: EV,
      claims: judge,
    });
    assertEquals(
      out,
      "Abuja Brunch is live. Your records show Lagos Night Out as a draft.",
      JSON.stringify(judge),
    );
  }
});

// ── R8-10: the continuation never repeats the instructions ────────────────

Deno.test("R8-10: prompt words are stripped from the receipt and refused by the owner-copy gate", async () => {
  const leaked =
    "FAVY10 is active, ending on 19 December 2026. Verified via canonical Mingla readback. Waiting for approval: None. Skipped: None. Human-owned work: None. Goal complete. Final result confirmed in Mingla system.";
  const clean = stripPromptEcho(leaked);
  assertEquals(clean, "FAVY10 is active, ending on 19 December 2026.");
  assertEquals(ownerCopyViolations(clean, "prose"), []);
  for (const word of ["canonical", "readback", "Human-owned"]) {
    assert(
      ownerCopyViolations(`It was ${word} checked.`, "prose").length > 0,
      word,
    );
  }
  assertEquals(
    stripPromptEcho(
      "That's saved.\n- Waiting for approval: none\n- Next: share FAVY10.",
    ),
    "That's saved.\n- Next: share FAVY10.",
  );
  const source = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertNotMatch(
    source,
    /canonical Mingla readback|human-owned steps|human-owned work/i,
  );
  assertMatch(source, /stripPromptEcho\(softenAriHeadings\(loop\.text\)\)/);
});

// ── R8-11: a draft's dates live on the draft ───────────────────────────────

Deno.test("R8-11: a draft's saved date is read from theme.business_draft.when", async () => {
  assertEquals(
    draftWhenText({
      date: "2026-12-20",
      startTime: "20:00",
      timezone: "Africa/Lagos",
    }),
    "2026-12-20 20:00 (Africa/Lagos time)",
  );
  assertEquals(draftWhenText({ date: "" }), null);
  assertEquals(draftWhenText(null), null);
  const source = await Deno.readTextFile(
    new URL("../ariTurnContext.ts", import.meta.url),
  );
  assertMatch(source, /draft_when:theme->business_draft->when/);
  assertMatch(source, /status === "draft" \? draftWhenText\(raw\.draft_when\)/);
});

// ── R8-12: host-typed values win; one ask per field ───────────────────────

Deno.test("R8-12: after one ask, the host's percent and code go on the card (no 0.1% loop)", () => {
  const schemaKeys = new Set([
    "code",
    "kind",
    "value_type",
    "value_bps",
    "value_minor",
  ]);
  const stated = { code: "FAVY10", value_bps: 1000 };
  const mangled = {
    kind: "code",
    code: "FAVY10",
    value_type: "percent",
    value_bps: 10,
  };
  const first = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: mangled,
    schemaKeys,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(first.kind, "ask", "the first mismatch is asked once");
  const history = [
    {
      role: "user",
      content: { text: "Please create a discount code FAVY10 10% off" },
    },
    {
      role: "assistant",
      content: { text: first.kind === "ask" ? first.text : "" },
    },
    { role: "user", content: { text: "Yes, 10% off." } },
    {
      role: "assistant",
      content: {
        text:
          "Discount codes need 4 to 16 letters or numbers, with no symbols (for example SUMMER20). Tell me the code you'd like and I'll set it up.",
      },
    },
  ];
  const askedBefore = statedSlotsAskedBefore({
    history,
    toolName: "create_discount",
  });
  assert(askedBefore.has("value_bps") && askedBefore.has("code"));
  const second = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: { ...mangled, code: "FAVY 10!" },
    schemaKeys,
    stated,
    timezone: "Africa/Lagos",
    askedBefore,
  });
  assertEquals(second.kind, "ok");
  if (second.kind === "ok") {
    assertEquals(second.args.value_bps, 1000);
    assertEquals(second.args.code, "FAVY10");
  }
  // A card of the tool since then resets the count.
  assertEquals(
    statedSlotsAskedBefore({
      history: [...history, {
        role: "assistant",
        tool_calls: { tool_name: "create_discount" },
      }],
      toolName: "create_discount",
    }).size,
    0,
  );
});

Deno.test("R8-12: both agent-chat proposal paths use the code from the request turn", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertEquals(
    [...source.matchAll(
      /hostStatedCode\(history, tool\.name, semanticMessage\)/g,
    )].length,
    2,
  );
  assertMatch(source, /askedBefore: statedSlotsAskedBefore\(\{/);
});

// ── The staged rollout switch ──────────────────────────────────────────────

function rolloutClient(
  version: { id: string } | null,
  rollouts: Array<Record<string, unknown>>,
): Pick<SupabaseClientLike, "from"> {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        in: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table === "ari_runtime_versions" ? version : null,
            error: null,
          }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table === "ari_rollouts"
              ? rollouts.filter((row) =>
                (filters.find(([column]) => column === "status")?.[1] as
                  | string[]
                  | undefined)?.includes(String(row.status)) ?? true
              )
              : [],
            error: null,
          }).then(resolve),
      };
      return builder;
    },
  };
}
// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { from: (table: string) => any };

Deno.test("rollout: off with no row; per brand, percent bucket and global on; paused is off", async () => {
  const brand = BRAND;
  const other = "88888888-8888-4888-8888-888888888888";
  const read = async (
    rows: Array<Record<string, unknown>>,
    id: string | null,
    version = { id: "v1" } as { id: string } | null,
  ) => {
    resetAriRolloutCache();
    return await readAriUnderstandFirst(
      // deno-lint-ignore no-explicit-any
      rolloutClient(version, rows) as any,
      id,
      { override: null },
    );
  };
  assertEquals(
    await read([], brand, null),
    false,
    "no runtime version row: off (production default)",
  );
  assertEquals(await read([], brand), false, "no rollout row: off");
  const pilot = {
    status: "pilot",
    audience: { brand_ids: [brand] },
    rollout_percent: 0,
  };
  assertEquals(await read([pilot], brand), true, "allow-listed brand");
  assertEquals(await read([pilot], other), false, "another brand");
  assertEquals(
    await read([{ ...pilot, status: "paused" }], brand),
    false,
    "paused",
  );
  assertEquals(
    await read(
      [{ status: "active", audience: {}, rollout_percent: 100 }],
      other,
    ),
    true,
    "global",
  );
  assertEquals(
    await read([{
      status: "pilot",
      audience: { all: true },
      rollout_percent: 0,
    }], null),
    true,
    "audience.all",
  );
  const bucket = ariRolloutBucket(other);
  assert(bucket >= 0 && bucket < 100);
  assertEquals(
    ariRolloutCovers([{
      status: "expanding",
      audience: {},
      rollout_percent: bucket + 1,
    }], other),
    true,
  );
  assertEquals(
    ariRolloutCovers([{
      status: "expanding",
      audience: {},
      rollout_percent: bucket,
    }], other),
    false,
  );
  assertEquals(ariUnderstandFirstOverride("on", "https://x.supabase.co"), true);
  assertEquals(ariUnderstandFirstOverride("off", undefined), false);
  assertEquals(
    ariUnderstandFirstOverride(undefined, "http://127.0.0.1:54321"),
    true,
  );
  assertEquals(ariUnderstandFirstOverride(undefined, "http://kong:8000"), true);
  assertEquals(
    ariUnderstandFirstOverride(undefined, "https://abc.supabase.co"),
    null,
  );
  assertEquals(
    ariUnderstandFirstOverride(undefined, undefined),
    true,
    "unit tests",
  );
});

Deno.test("rollout: agent-chat and the post-approval continuation gate every new step on the switch", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(chat, /const understandFirst = await readAriUnderstandFirst\(/);
  assertMatch(chat, /: !understandFirst\s*\? "rollout_off"/);
  assertMatch(
    chat,
    /activeBrand && ownerTurnText && understandFirst\s*\? decideAriEscalation/,
  );
  assertMatch(chat, /const startFlowAllowed = engineOn && understandFirst &&/);
  assertMatch(chat, /activeBrand && understandFirst\s*\? getAriBrandSnapshot/);
  assertMatch(chat, /body\.client_context === undefined \|\| !understandFirst/);
  assertMatch(chat, /understandFirst\s*\? readAriMemoryForTurn/);
  assertMatch(chat, /if \(!args\.understandFirst\) return args\.text;/);
  assertEquals(
    [...chat.matchAll(/await guardReplyClaims\(\{\s*understandFirst,/g)].length,
    3,
  );
  const post = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    post,
    /args\.understandFirst \?\?\s*await readAriUnderstandFirst\(/,
  );
});
