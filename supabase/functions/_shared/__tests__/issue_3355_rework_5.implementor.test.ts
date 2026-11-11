// #3355 rework 5 (after Retest 5 FAIL; Seth 2026-11-11 "check all"):
//   R5-1  every code of a listed run is checked, any count;
//   R5-2  "Is it possible to…?" / "Do you mind…?" are write requests, not
//         status questions; a "Done!" needs this turn's record;
//   R5-3  this turn's fresh read beats an older receipt (also via the brand
//         records read); an unavailable read never asserts a positive status;
//   R5-15 a read never backs a change made this turn or "live again";
//   R5-16 every reply is checked: "Yes, your support ticket has been opened"
//         with no ticket, "I'll remember that" with no note;
//   R5-17 the deterministic must-catch pass (judge timeout / failure, and
//         after the judge) never blanks reads or how-to answers;
//   R5-4  the minimum-order fill-in takes currency amounts only;
//   R5-5  the minimum and the listing kind bind to the code's own clause;
//   R5-6 / R5-7 slash-joined and inner-space codes; R5-8 a write the intent
//         read missed; R5-11 / R5-12 the ask-the-team lead; R5-13 an
//         unstated start; R5-18 a nil-UUID target.
// The judge is stubbed with the claim shapes it returns; each case pins the
// server, never the model.
//
// MINGLA-INVARIANT: I-ARI-STATUS-FROM-FRESH-READ | issue #3355 | (rework 5, Seth 2026-11-11) A status answer about a discount code ("FAVY10 is live / still active / on again", said by the judge's claim or found by the deterministic pass) is decided by a brand-scoped read done in THIS turn (the loop's own read or the records read, which starts beside the judge call and is cut at 1.5 s): its row beats any older receipt or the 60 s brand snapshot; a contradicted status is replaced in place by "Your records show X as <state>"; when the read could not run, a status only an older receipt would back is replaced by "I couldn't check X's current status just now" and is never asserted (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_5.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
  claimCheckWanted,
  type ClaimEvidence,
  type ClaimObservation,
  type ClaimRecordsRead,
  fallbackStripClaims,
  hostAsksForWrite,
  isStatusQuestion,
  REPLY_EMPTY_AFTER_CHECK,
} from "../ariClaimCheck.ts";
import { checkStatedSlots, type WriteState } from "../ariTruthGuards.ts";
import {
  applyStatedMinimumOrder,
  codeClause,
  discountTargetsNeedDefault,
  parseStatedMinimumOrder,
  resolveDiscountTargetDefault,
  statedMinimumOrderMinor,
} from "../ariDiscountArgs.ts";
import {
  ARI_ESCALATION_FAILURE_TYPES,
  ASK_TEAM_LEAD,
  decideAriEscalation,
  withAskTeamLead,
} from "../ariGaps.ts";
import { ToolError } from "../agentToolHelpers.ts";

function card(
  status: WriteState["status"],
  code: string,
  tool = "create_discount",
): WriteState {
  return {
    actionId: `a-${code}-${status}`,
    toolName: tool,
    status,
    object: code,
    args: { code },
    receiptText: null,
  };
}

const live = (quote: string, object: string | null): AriClaim => ({
  quote,
  action: "live",
  object,
  kind: "discount",
});

type Reader = (
  kinds: ReadonlySet<string>,
  objects: readonly string[],
) => Promise<ClaimRecordsRead>;

/** The brand records read: these codes, with their state. */
function brand(codes: Record<string, string>, delayMs = 0): Reader {
  return (_kinds, objects) =>
    new Promise((resolve) =>
      setTimeout(() =>
        resolve({
          records: objects.filter((code) => codes[code.toUpperCase()]).map((
            code,
          ) => ({
            status: "read",
            kind: "discount",
            toolName: "list_discounts",
            objects: [code.toUpperCase()],
            state: null,
            thisTurn: false,
            readState: {
              live: codes[code.toUpperCase()] === "active",
              label: codes[code.toUpperCase()],
            },
          } satisfies ClaimEvidence)),
          checkedKinds: ["note", "support"],
          checkedObjects: [...objects],
        }), delayMs)
    );
}

const hung: Reader = () => new Promise(() => {});

async function check(args: {
  host: string;
  reply: string;
  claims?: AriClaim[] | "fail";
  states?: WriteState[];
  observations?: ClaimObservation[];
  objects?: string[];
  intent?: string;
  asked?: boolean;
  askedKinds?: string[];
  read?: Reader;
  judgeMs?: number;
}) {
  return await checkReplyClaims({
    text: args.reply,
    hostMessage: args.host,
    intent: args.intent ?? "tool",
    recentWrite: true,
    objects: args.objects ?? [],
    evidence: buildClaimEvidence({
      states: args.states ?? [],
      observations: args.observations ?? [],
      isReadTool: (tool) => /^(?:list_|get_)/.test(tool),
    }),
    askedWriteThisTurn: args.asked ?? true,
    ...(args.askedKinds
      ? { askedKinds: new Set(args.askedKinds) as Set<never> }
      : {}),
    ...(args.read ? { moreEvidence: args.read as never } : {}),
    call: () =>
      args.claims === "fail"
        ? Promise.reject(new Error("HTTP 503"))
        : new Promise((resolve) =>
          setTimeout(
            () => resolve({ claims: args.claims ?? [] }),
            args.judgeMs ?? 0,
          )
        ),
  });
}

// ── R5-1 ────────────────────────────────────────────────────────────────────

Deno.test("R5-1: every code of a listed run is checked (3 and 5 codes), whatever object the judge gives", async () => {
  const reply = "FAVY10, GIRLS20 and LAGOS5 are all live now.";
  for (const object of ["FAVY10", null, "FAVY10, GIRLS20 and LAGOS5"]) {
    const out = await check({
      host: "Make FAVY10, GIRLS20 and LAGOS5",
      reply,
      claims: [live(reply, object)],
      states: [card("executed", "FAVY10"), card("executed", "GIRLS20")],
      objects: ["FAVY10", "GIRLS20", "LAGOS5"],
      askedKinds: ["discount"],
    });
    assert(!/all live/.test(out.text), `${object}: ${out.text}`);
    assertEquals(out.text, "I don't see LAGOS5 in this chat yet.");
  }
  const five = "AAA10, BBB20, CCC30, DDD40 & EEE50 are all live.";
  const saved = ["AAA10", "BBB20", "CCC30", "DDD40"];
  const out = await check({
    host: "Make AAA10 BBB20 CCC30 DDD40 EEE50",
    reply: five,
    claims: [live(five, "AAA10")],
    states: saved.map((code) => card("executed", code)),
    objects: [...saved, "EEE50"],
    askedKinds: ["discount"],
  });
  assert(!/all live/.test(out.text), out.text);
  // All five saved: kept.
  const all = await check({
    host: "Make AAA10 BBB20 CCC30 DDD40 EEE50",
    reply: five,
    claims: [live(five, "AAA10")],
    states: [...saved, "EEE50"].map((code) => card("executed", code)),
    objects: [...saved, "EEE50"],
    askedKinds: ["discount"],
  });
  assertEquals(all.text, five);
});

Deno.test("R5-6 / R5-7: slash-joined codes and an inner-space code are each checked", async () => {
  const slash = "FAVY10 / GIRLS20 are both live.";
  const a = await check({
    host: "Make FAVY10 and GIRLS20",
    reply: slash,
    claims: [live(slash, "FAVY10")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
  });
  assert(!/both live/.test(a.text), a.text);
  const spaced = "favy 10 is live too.";
  const b = await check({
    host: "Make GIRLS20 20% off",
    reply: spaced,
    claims: [live(spaced, "favy 10")],
    states: [card("executed", "GIRLS20")],
    objects: ["GIRLS20"],
    askedKinds: ["discount"],
  });
  assert(!/is live/.test(b.text), b.text);
});

// ── R5-2, R5-8 ──────────────────────────────────────────────────────────────

Deno.test("R5-2: polite write requests are not status questions; an older card never backs the new claim", async () => {
  for (
    const host of [
      "Is it possible to make a 15% student discount?",
      "Do you mind messaging my guests that doors now open at 8?",
      "Would you mind creating STUDENT15 for me?",
      "Is there a way to set up a student code?",
    ]
  ) {
    assert(!isStatusQuestion(host), host);
    assert(hostAsksForWrite(host), host);
  }
  for (
    const host of [
      "Did it go through?",
      "Is FAVY10 live?",
      "Has my request been sent?",
      "Did you send it?",
      "Are my codes working?",
    ]
  ) {
    assert(isStatusQuestion(host), host);
    assert(!hostAsksForWrite(host), host);
  }
  const o1 = await check({
    host: "Is it possible to make a 15% student discount?",
    reply: "Done! Your student discount is live.",
    claims: [{
      quote: "Your student discount is live.",
      action: "live",
      object: "Your student discount",
      kind: "discount",
    }],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
  });
  assert(!/is live|Done/.test(o1.text), o1.text);
  const o2 = await check({
    host: "Do you mind messaging my guests that doors now open at 8?",
    reply: "I've messaged your guests about the new time.",
    claims: [{
      quote: "I've messaged your guests about the new time.",
      action: "sent",
      object: "your guests",
      kind: "message",
    }],
    states: [card("executed", "Launch reminder", "send_guest_message")],
    intent: "question",
    asked: false,
  });
  assert(!/messaged/.test(o2.text), o2.text);
  // The follow-up on the confirmed card still holds (rework 4).
  const followup = await check({
    host: "Did it go through?",
    reply: "Your request has been sent to the team.",
    claims: [{
      quote: "Your request has been sent to the team.",
      action: "sent",
      object: "your request",
      kind: "support",
    }],
    states: [card("executed", "Payout missing", "create_support_ticket")],
    intent: "tool",
    asked: true,
  });
  assertEquals(followup.text, "Your request has been sent to the team.");
});

Deno.test("R5-8: a write the intent read missed ('make a 15% student discount' read as chat) is not backed by an older card", async () => {
  const reply = "Your student discount is live.";
  const out = await check({
    host: "make a 15% student discount",
    reply,
    claims: [live(reply, "Your student discount")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "chat",
    asked: false,
  });
  assert(!/is live/.test(out.text), out.text);
});

// ── R5-3, fresh reads ───────────────────────────────────────────────────────

Deno.test("R5-3: this turn's read (loop read or brand records read) beats an older creation receipt", async () => {
  const reply = "Yes, FAVY10 is still live.";
  const viaLoop = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [live(reply, "FAVY10")],
    states: [card("executed", "FAVY10")],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: [{ code: "FAVY10", status: "ended" }],
    }],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
  });
  assertEquals(viaLoop.text, "Your records show FAVY10 as ended.");
  const viaRecords = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [live(reply, "FAVY10")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: brand({ FAVY10: "paused" }),
  });
  assertEquals(viaRecords.text, "Your records show FAVY10 as paused.");
  assertEquals(viaRecords.freshRead, "ok");
  // The judge listed nothing: the deterministic pass still holds the
  // status to the fresh read.
  const unlisted = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: brand({ FAVY10: "expired" }),
  });
  assertEquals(unlisted.text, "Your records show FAVY10 as expired.");
  // Fresh and active: kept word for word.
  const kept = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [live(reply, "FAVY10")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: brand({ FAVY10: "active" }),
  });
  assertEquals(kept.text, reply);
});

Deno.test("R5-3: when the fresh read cannot run, a status only an older receipt backs is never asserted", async () => {
  const reply = "Yes, FAVY10 is still live.";
  const out = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [live(reply, "FAVY10")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: hung,
  });
  assertEquals(out.freshRead, "failed");
  assertEquals(
    out.text,
    "I couldn't check FAVY10's current status just now. You can see it in Marketing, under Discounts.",
  );
  // The read found no such code on the brand: it is not said to be live.
  const gone = await check({
    host: "is FAVY10 still live?",
    reply,
    claims: [live(reply, "FAVY10")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: brand({}),
  });
  assertEquals(gone.text, "I can't find FAVY10 in your discount codes.");
  // A described status ("your discount is live") leans on the card's code
  // and is decided by the fresh read of that code.
  const described = await check({
    host: "Is it live?",
    reply: "Your discount is live.",
    claims: [live("Your discount is live.", "Your discount")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: brand({ FAVY10: "ended" }),
  });
  assertEquals(described.text, "Your records show FAVY10 as ended.");
});

Deno.test("R5-3 latency: the fresh read runs beside the judge and is cut at 1.5 s", async () => {
  const started = Date.now();
  await check({
    host: "is FAVY10 still live?",
    reply: "Yes, FAVY10 is still live.",
    claims: [live("Yes, FAVY10 is still live.", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    judgeMs: 400,
    read: brand({ FAVY10: "active" }, 400),
  });
  const parallel = Date.now() - started;
  assert(parallel < 750, `judge and read ran one after the other: ${parallel}`);
  const slow = Date.now();
  await check({
    host: "is FAVY10 still live?",
    reply: "Yes, FAVY10 is still live.",
    claims: [live("Yes, FAVY10 is still live.", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
    read: hung,
  });
  const capped = Date.now() - slow;
  assert(capped < 1_900, `the hung read held the turn ${capped} ms`);
});

// ── R5-15 ───────────────────────────────────────────────────────────────────

Deno.test("R5-15: a read showing FAVY10 expired never backs 'Done! FAVY10 is live again', whatever the action", async () => {
  const reply = "Done! FAVY10 is live again and guests can use it at checkout.";
  for (const action of ["updated", "completed", "created", "saved"] as const) {
    const out = await check({
      host: "Turn FAVY10 back on",
      reply,
      claims: [{ quote: reply, action, object: "FAVY10", kind: "discount" }],
      observations: [{
        tool: "list_discounts",
        args: {},
        result: [{ code: "FAVY10", status: "expired" }],
      }],
      objects: ["FAVY10"],
      askedKinds: ["discount"],
    });
    assertEquals(out.text, "Your records show FAVY10 as expired.", action);
  }
  // A read never proves a change made this turn, even with a live row.
  const edit = await check({
    host: "Change FAVY10 to 15%",
    reply: "I've updated FAVY10 to 15% off.",
    claims: [{
      quote: "I've updated FAVY10 to 15% off.",
      action: "updated",
      object: "FAVY10",
      kind: "discount",
    }],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: [{ code: "FAVY10", status: "active" }],
    }],
    objects: ["FAVY10"],
    askedKinds: ["discount"],
  });
  assert(!/I've updated/.test(edit.text), edit.text);
});

// ── R5-16: every reply is checked ───────────────────────────────────────────

Deno.test("R5-16: question and chat turns are checked; a false ticket or note claim is replaced", async () => {
  assert(
    claimCheckWanted({
      intent: "question",
      recentWrite: false,
      text: "Yes, your support ticket has been opened.",
      objects: [],
    }),
  );
  assert(
    claimCheckWanted({
      intent: "chat",
      recentWrite: false,
      text: "I'll remember that for future planning.",
      objects: [],
    }),
  );
  const none: Reader = () =>
    Promise.resolve({
      records: [],
      checkedKinds: ["note", "support"],
      checkedObjects: [],
    });
  // The judge lists the claim.
  const listed = await check({
    host: "Did my support request go through?",
    reply: "Yes, your support ticket has been opened.",
    claims: [{
      quote: "Yes, your support ticket has been opened.",
      action: "created",
      object: "your support ticket",
      kind: "support",
    }],
    intent: "question",
    asked: false,
    read: none,
  });
  assertEquals(listed.source, "model");
  assertEquals(
    listed.text,
    "I don't see a support request from this chat yet.",
  );
  // The judge lists nothing (or fails): the deterministic pass catches it.
  for (const claims of [[], "fail"] as const) {
    const out = await check({
      host: "Did my support request go through?",
      reply: "Yes, your support ticket has been opened.",
      claims: claims as AriClaim[] | "fail",
      intent: "question",
      asked: false,
      read: none,
    });
    assertEquals(
      out.text,
      "I don't see a support request from this chat yet.",
      String(claims),
    );
  }
  const note = await check({
    host: "Our doors always open at 7pm.",
    reply: "I'll remember that for future planning.",
    claims: [],
    intent: "chat",
    asked: false,
    read: none,
  });
  assertEquals(note.text, "I haven't saved that as a note yet.");
  // With the note saved this turn, the same words stay.
  const saved = await check({
    host: "Our doors always open at 7pm. Remember that.",
    reply: "I'll remember that for future planning.",
    claims: [],
    intent: "tool",
    observations: [{
      tool: "remember_note",
      args: { text: "Doors always open at 7pm" },
      result: { id: "n1" },
    }],
    read: none,
  });
  assertEquals(saved.text, "I'll remember that for future planning.");
});

// ── R5-17: the deterministic pass ───────────────────────────────────────────

const ASK = "Create FAVY10 for 10% off until 19 December";

Deno.test("R5-17: with the judge failing, the must-catch forms are caught", async () => {
  const freshNone = brand({});
  for (
    const reply of [
      "**Done!** Your discount is set.",
      "- Create the code ✅\n- Send it to guests ✅",
      "✅ Code\n✅ Email to guests",
      "Should I tell your guests FAVY10 now works?",
      "Want me to share the code, which is now live?",
      "Guests have been notified.",
      "It's up and running.",
      "Everything went through.",
      "I've created FAVY10 for you.",
      "All set ✅",
    ]
  ) {
    const out = await check({
      host: ASK,
      reply,
      claims: "fail",
      objects: ["FAVY10"],
      read: freshNone,
    });
    assertEquals(out.source, "fallback", reply);
    assert(out.text !== reply, `kept: ${reply}`);
  }
  // Two codes, only FAVY10 is on the brand.
  const both = "FAVY10 and GIRLS20 are both live now.";
  const two = await check({
    host: "Make FAVY10 10% off and GIRLS20 20% off",
    reply: both,
    claims: "fail",
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    read: brand({ FAVY10: "active" }),
  });
  assert(!/both live/.test(two.text), two.text);
  // FAVY10 expired on the brand.
  const again = await check({
    host: "Turn FAVY10 back on",
    reply: "FAVY10 is live again.",
    claims: "fail",
    objects: ["FAVY10"],
    read: brand({ FAVY10: "expired" }),
  });
  assertEquals(again.text, "Your records show FAVY10 as expired.");
});

Deno.test("R5-17: the deterministic pass never blanks reads or how-to answers (judge failing or listing nothing)", async () => {
  const answers = [
    "Yes, FAVY10 is active. It ends on Sat 19 Dec 2026 at 11:59 pm Lagos time.",
    "FAVY10 has been used 12 times and brought in ₦48,000 in sales.",
    "Once published, your event shows on Explore and people can buy tickets.",
    "Payouts are sent to your bank 3 working days after the event ends.",
    "Refunds you approve are sent back to the buyer's card within 5–10 working days.",
    "No. Drafts stay private until you publish them. Tap Publish on the event page when you're ready.",
    "Open Marketing, tap Discounts, then tap Create code. Choose the percent or amount and the dates, then tap Save.",
    "Let's set up your Website. I'll go through the plan one part at a time and save each change only after you approve it.",
    'Tap a person to "Revoke invitation" or "Remove from team"; accepted people are listed under "ACTIVE MEMBERS".',
    "Yes, your event is now live on Explore and people can buy tickets.",
    "Your team has 3 active members: Ada, Tunde and Bisi.",
    "Here's how it works: you create the code, then share it.",
  ];
  for (const text of answers) {
    for (const claims of [[], "fail"] as const) {
      for (const host of ["How does it work?", "Is FAVY10 live?", ASK]) {
        const out = await check({
          host,
          reply: text,
          claims: claims as AriClaim[] | "fail",
          objects: ["FAVY10"],
          intent: host === ASK ? "tool" : "question",
          asked: host === ASK,
          read: brand({ FAVY10: "active" }),
        });
        assertEquals(out.text, text, `${host} | ${String(claims)}`);
      }
    }
  }
  // A write request of the same kind as the answer's words (the case the
  // asked-kind rule does not cover): screen labels, "working days" and a
  // kind word that is not the subject are still not claims.
  for (
    const [host, text] of [
      [
        "Can you add Ada to my team?",
        'Tap a person to "Revoke invitation" or "Remove from team"; accepted people are listed under "ACTIVE MEMBERS".',
      ],
      [
        "Can you set up my event?",
        "Payouts are sent to your bank 3 working days after the event ends.",
      ],
      [
        "Can you make a discount code for my tables?",
        '4) Print codes: in the Menu or Tables module tap "QR spots & printing", then "Print" for every active spot.',
      ],
    ]
  ) {
    for (const claims of [[], "fail"] as const) {
      const out = await check({
        host,
        reply: text,
        claims: claims as AriClaim[] | "fail",
        objects: [],
        read: brand({}),
      });
      assertEquals(out.text, text, `${host} | ${String(claims)}`);
    }
  }
  // Direct use (no records read wired): unchanged as before.
  for (const text of answers) {
    assertEquals(
      fallbackStripClaims({ text, objects: ["FAVY10"], evidence: [] }).text,
      text,
    );
  }
  assert(REPLY_EMPTY_AFTER_CHECK.length > 0);
});

// ── R5-4, R5-5, R5-18 ───────────────────────────────────────────────────────

Deno.test("R5-4: the minimum order is a currency amount; counts and bare numbers are asked about", () => {
  for (
    const text of [
      "10% off for orders over 10 tickets",
      "10% off bookings over 4 guests",
      "20% off orders of at least 3 tickets",
    ]
  ) {
    assertEquals(statedMinimumOrderMinor(text), null, text);
    assertEquals(parseStatedMinimumOrder(text)?.kind, "count", text);
  }
  assertEquals(
    statedMinimumOrderMinor("10% off orders over ₦10 000"),
    1_000_000,
  );
  assertEquals(statedMinimumOrderMinor("orders over ₦10,000"), 1_000_000);
  assertEquals(statedMinimumOrderMinor("minimum order 5,000 naira"), 500_000);
  assertEquals(statedMinimumOrderMinor("when they spend over 10k"), 1_000_000);
  assertEquals(
    parseStatedMinimumOrder("orders over 10000")?.kind,
    "no_currency",
  );
  assertEquals(
    parseStatedMinimumOrder("orders over $50", "NGN")?.kind,
    "currency_mismatch",
  );
  assertEquals(statedMinimumOrderMinor("orders over $50", "USD"), 5_000);
  const refusal = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ToolError) return error.message;
      throw error;
    }
    return "";
  };
  assertMatch(
    refusal(() =>
      applyStatedMinimumOrder(
        { code: "FAVY10", value_type: "percent", value_bps: 1000 },
        "10% off for orders over 10 tickets",
      )
    ),
    /minimum order amount, but not a minimum number of tickets/,
  );
  // The model's ₦10 from "10 tickets" is asked about too.
  assertMatch(
    refusal(() =>
      applyStatedMinimumOrder(
        { code: "FAVY10", min_subtotal_minor: 1000 },
        "10% off for orders over 10 tickets",
      )
    ),
    /not a minimum number of tickets/,
  );
  assertMatch(
    refusal(() =>
      applyStatedMinimumOrder({ code: "FAVY10" }, "orders over $50", "NGN")
    ),
    /Your brand sells in NGN/,
  );
});

Deno.test("R5-5: a minimum or a kind stated for one code binds to that code only", () => {
  const host = "FAVY10 10% off, and GIRLS20 20% off orders over ₦10,000";
  assertEquals(
    applyStatedMinimumOrder({ code: "FAVY10", value_type: "percent" }, host)
      .min_subtotal_minor,
    undefined,
  );
  assertEquals(
    applyStatedMinimumOrder({ code: "GIRLS20", value_type: "percent" }, host)
      .min_subtotal_minor,
    1_000_000,
  );
  // Shared words before the codes, a listed run and "both" are shared.
  for (
    const text of [
      "For orders over ₦5,000 make FAVY10 10% and GIRLS20 20%",
      "FAVY10 and GIRLS20, for orders over ₦5,000",
      "FAVY10 10%, GIRLS20 20%, both for orders over ₦5,000",
    ]
  ) {
    assertEquals(
      applyStatedMinimumOrder({ code: "FAVY10" }, text).min_subtotal_minor,
      500_000,
      text,
    );
  }
  const kinds = "FAVY10 for events and GIRLS20 for trips";
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], kinds, "FAVY10"),
    { kind: "default", listingKinds: ["event"], reason: "host_named" },
  );
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], kinds, "GIRLS20"),
    { kind: "default", listingKinds: ["trip"], reason: "host_named" },
  );
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], kinds).kind,
    "ask",
  );
  assertEquals(codeClause("FAVY10 10% off", "FAVY10"), "FAVY10 10% off");
});

Deno.test("R5-18: a nil-UUID listing target is unspecified, so the fill-in binds it", () => {
  assert(
    discountTargetsNeedDefault({
      targets: [{
        target_kind: "event",
        target_id: "00000000-0000-0000-0000-000000000000",
      }],
    }),
  );
  assert(
    !discountTargetsNeedDefault({
      targets: [{
        target_kind: "event",
        target_id: "6ffc79aa-0000-4000-8000-000000000001",
      }],
    }),
  );
});

// ── R5-13 ───────────────────────────────────────────────────────────────────

Deno.test("R5-13: a discount start the host never stated is not invented", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const result = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY10",
      value_type: "percent",
      value_bps: 1000,
      starts_at: "2026-12-19T00:00:00Z",
      ends_at: "2026-12-19T22:59:59Z",
    },
    schemaKeys: new Set([
      "code",
      "value_type",
      "value_bps",
      "starts_at",
      "ends_at",
    ]),
    stated: { code: "FAVY10", value_bps: 1000 },
    timezone: "Africa/Lagos",
    now,
  });
  assertEquals(result.kind, "ok");
  if (result.kind === "ok") {
    assertEquals(result.args.starts_at, undefined);
    assertEquals(result.args.ends_at, "2026-12-19T22:59:59Z");
  }
  // A start within the hour is "from now": kept.
  const soon = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: { code: "FAVY10", starts_at: "2026-11-11T12:10:00Z" },
    schemaKeys: new Set(["code", "starts_at"]),
    stated: { code: "FAVY10" },
    timezone: "Africa/Lagos",
    now,
  });
  assertEquals(
    soon.kind === "ok" ? soon.args.starts_at : null,
    "2026-11-11T12:10:00Z",
  );
});

// ── R5-11, R5-12 ────────────────────────────────────────────────────────────

Deno.test("R5-11 / R5-12: the ask-the-team lead is said once; a parked flow never counts toward escalation", async () => {
  const copied =
    `FAVY10 is not live yet. It starts on 19 December.\n\n${ASK_TEAM_LEAD}`;
  const text = withAskTeamLead(copied);
  assertEquals(text.split(ASK_TEAM_LEAD).length - 1, 1, text);
  assert(text.startsWith("FAVY10 is not live yet."), text);
  assertEquals(
    withAskTeamLead("Open Marketing, then Discounts."),
    `Open Marketing, then Discounts.\n\n${ASK_TEAM_LEAD}`,
  );
  assert(!ARI_ESCALATION_FAILURE_TYPES.has("flow_parked"));
  assertEquals(
    decideAriEscalation({
      ownerSignals: [{ type: "flow_parked", excerpt: "x" }],
      recentGaps: [{ type: "flow_parked" }],
    }).escalate,
    false,
  );
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(source, /text: withAskTeamLead\(offer\.replyText\),/);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

Deno.test("wiring: both callers pass the brand records read (the fresh read); the continuation marks its approval", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /const check = await checkReplyClaims\(\{[\s\S]{0,900}moreEvidence: \(kinds, named\) =>\s+recentRecordEvidence\(\{[\s\S]{0,200}brandId: args\.brandId,/,
  );
  const post = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    post,
    /moreEvidence: \(kinds, named\) =>\s+recentRecordEvidence\(\{/,
  );
  assertMatch(
    post,
    /askedWriteThisTurn: false,\s+\/\/[^\n]*\n\s+approved: true,/,
  );
});
