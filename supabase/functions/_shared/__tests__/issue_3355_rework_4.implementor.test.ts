// #3355 rework 4 (Retest 4 FAIL) — the claim check's evidence is EXACT.
//
// The judge (Gemini Flash) lists claims well; Retest 4 found the server then
// took the wrong record as evidence. The claim lists below are fixed in the
// shape Flash returned for these replies in the retest 4 live probe, so each
// case pins the server's matching, not the model.
//   R4-1  a claim naming two codes is backed only when both are; "your new
//         discount is live" is matched to the code the host named this turn,
//         never to an older code's receipt;
//   R4-2  notes and tickets read outside the chat back a claim only by exact
//         text / subject, for this conversation and the active brand;
//   R4-3  bare "orders" / "deposit" never pick venue kinds; "orders over
//         ₦10,000" is the minimum order;
//   R4-4  a read backs only the state it shows (expired is not live);
//   R4-5  "Nothing has been saved" needs a read that proves absence;
//   R4-6  the records read has a 1.5 s deadline;
//   R4-7  the continuation's next discount gets the same fill-in (or asks);
//   R4-9  a bare "E don set!" goes with the claim it fronts;
//   R4-10 a turn with no action, no write and no chat object is not checked;
//   R4-11 a brand selling events AND trips with no kind named is asked;
//   R4-12 a "### heading" in the continuation is softened, not dropped;
//   R4-13 "till Easter" and "until the end of next month" are read.
//
// MINGLA-INVARIANT: I-ARI-CLAIM-EVIDENCE-EXACT | issue #3355 | (rework 4) A completion claim is backed only by a record of the SAME object by exact identity (normalised code, record title, note text, ticket subject), scoped to the active brand and this conversation; a claim naming several objects is backed only when every one is; a described claim ("your new discount") is matched to the codes the host named this turn, else only to this turn's records or (when the host asked for no new write) the latest card it follows; a read backs only the state its row shows; "Nothing has been saved or sent for X" is said only after a read proved X absent (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_4.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_CLAIM_RECORDS_TIMEOUT_MS,
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
  claimCheckWanted,
  type ClaimEvidence,
  type ClaimObservation,
  conversationSince,
  isStatusExclamation,
  objectsMatch,
  recentRecordEvidence,
} from "../ariClaimCheck.ts";
import type { WriteState } from "../ariTruthGuards.ts";
import { extractStatedSlots } from "../ariTruthGuards.ts";
import {
  applyDiscountTargetDefault,
  applyStatedMinimumOrder,
  resolveDiscountTargetDefault,
  statedMinimumOrderMinor,
} from "../ariDiscountArgs.ts";
import { softenAriHeadings } from "../agentCopyLint.ts";
import {
  type PostApprovalContinuation,
  prepareContinuationProposal,
} from "../agentPostApproval.ts";
import { bindDiscountTargetDefault } from "../agentAri10xTools.ts";
import { canonicalizeAgentProposalArgs } from "../agentTools.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";

function state(status: WriteState["status"], code: string): WriteState {
  return {
    actionId: `a-${code}`,
    toolName: "create_discount",
    status,
    object: code,
    args: { code, value_bps: 1000 },
    receiptText: null,
  };
}

type More = (
  kinds: ReadonlySet<string>,
  objects: readonly string[],
) => Promise<unknown>;

async function check(args: {
  host: string;
  reply: string;
  claims: AriClaim[];
  states?: WriteState[];
  observations?: ClaimObservation[];
  objects?: string[];
  intent?: string;
  asked?: boolean;
  askedKinds?: string[];
  more?: More;
  timeoutMs?: number;
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
    ...(args.more ? { moreEvidence: args.more as never } : {}),
    ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
    call: () => Promise.resolve({ claims: args.claims }),
  });
}

// ── R4-1 ────────────────────────────────────────────────────────────────────

Deno.test("R4-1: one claim naming two codes is kept only when BOTH are saved", async () => {
  const reply =
    "FAVY10 and GIRLS20 are both live now, so guests can use either at checkout.";
  const claims: AriClaim[] = [{
    quote: reply,
    action: "live",
    object: "FAVY10 and GIRLS20",
    kind: "discount",
  }];
  const one = await check({
    host: "Make FAVY10 10% off and GIRLS20 20% off",
    reply,
    claims,
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
  });
  assert(!/both live/.test(one.text), one.text);
  assertEquals(one.text, "I don't see GIRLS20 in this chat yet.");
  const both = await check({
    host: "Make FAVY10 10% off and GIRLS20 20% off",
    reply,
    claims,
    states: [state("executed", "FAVY10"), state("executed", "GIRLS20")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
  });
  assertEquals(both.text, reply);
});

Deno.test("R4-1: 'your new discount is live' is matched to the code the host named, not an older receipt", async () => {
  const reply = "Done! Your new discount is live and ready to share.";
  const out = await check({
    host: "Now make GIRLS20 for 20% off",
    reply,
    claims: [{ quote: reply, action: "live", object: null, kind: "discount" }],
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
  });
  assert(!/is live/.test(out.text), out.text);
  assertEquals(out.text, "I don't see GIRLS20 in this chat yet.");
});

Deno.test("R4-1: a described claim on a NEW write turn needs this turn's record; a follow-up question keeps the card it follows", async () => {
  const reply = "Your VIP discount is live.";
  const claims: AriClaim[] = [{
    quote: reply,
    action: "live",
    object: "Your VIP discount",
    kind: "discount",
  }];
  const asked = await check({
    host: "Make a discount for my VIP guests",
    reply,
    claims,
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10"],
    askedKinds: ["discount"],
  });
  assert(!/is live/.test(asked.text), asked.text);
  const followUp = await check({
    host: "Is it live?",
    reply: "Your discount is **live**.",
    claims: [{
      quote: "Your discount is **live**.",
      action: "live",
      object: null,
      kind: "discount",
    }],
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10"],
    intent: "question",
    asked: false,
  });
  assertEquals(followUp.text, "Your discount is **live**.");
});

Deno.test("R4-1: a follow-up 'did it go through?' is backed by the confirmed card, even with a later duplicate card waiting", async () => {
  const ticket = (status: WriteState["status"], id: string): WriteState => ({
    actionId: id,
    toolName: "create_support_ticket",
    status,
    object: id === "t1" ? "Payout missing" : "Missing Payout 693c12",
    args: { subject: "Payout missing" },
    receiptText: null,
  });
  const reply =
    "Your request has been sent to the team. They usually reply within a day.";
  const out = await check({
    host: "Did it go through?",
    reply,
    intent: "question",
    asked: false,
    states: [ticket("executed", "t1"), ticket("pending", "t2")],
    claims: [{
      quote: "Your request has been sent to the team.",
      action: "sent",
      object: "Your request",
      kind: "support",
    }],
  });
  assertEquals(out.text, reply);
  // With no saved card before it, the waiting card is the truth.
  const waiting = await check({
    host: "Did it go through?",
    reply,
    intent: "question",
    asked: false,
    states: [ticket("pending", "t2")],
    claims: [{
      quote: "Your request has been sent to the team.",
      action: "sent",
      object: "Your request",
      kind: "support",
    }],
  });
  assert(!/has been sent/.test(waiting.text), waiting.text);
});

Deno.test("R4-1 (live run 8): codes listed together in the quote are each checked, even when the judge names only one", async () => {
  const reply =
    "FAVY10 and GIRLS20 are both live now, so guests can use either at checkout.";
  const out = await check({
    host: "Make FAVY10 10% off and GIRLS20 20% off",
    reply,
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
    claims: [{
      quote: reply,
      action: "live",
      object: "FAVY10",
      kind: "discount",
    }],
  });
  assert(!/both live/.test(out.text), out.text);
  // A code mentioned beside, not listed with, the claimed one is not pulled in.
  const single = await check({
    host: "Is FAVY10 live? GIRLS20 can wait",
    reply: "FAVY10 is live. GIRLS20 is waiting for your Confirm.",
    states: [state("executed", "FAVY10"), state("pending", "GIRLS20")],
    objects: ["FAVY10", "GIRLS20"],
    intent: "question",
    asked: false,
    claims: [{
      quote: "FAVY10 is live.",
      action: "live",
      object: "FAVY10",
      kind: "discount",
    }],
  });
  assertEquals(
    single.text,
    "FAVY10 is live. GIRLS20 is waiting for your Confirm.",
  );
});

Deno.test("R4-1 (live run 7): 'Did it go through?' read as a write turn still follows the confirmed card", async () => {
  const reply =
    "Your request has been sent to the team. They usually reply within a day.";
  const ticket: WriteState = {
    actionId: "t1",
    toolName: "create_support_ticket",
    status: "executed",
    object: "Payout missing",
    args: { subject: "Payout missing" },
    receiptText: null,
  };
  const claims: AriClaim[] = [{
    quote: "Your request has been sent to the team.",
    action: "sent",
    object: "your request",
    kind: "support",
  }];
  const out = await check({
    host: "Did it go through?",
    reply,
    intent: "tool",
    asked: true,
    askedKinds: ["support"],
    states: [ticket],
    claims,
  });
  assertEquals(out.text, reply);
  // This turn's support-inbox read cannot back "sent"; it never hides the
  // confirmed ticket (live runs 11 and 12).
  const afterRead = await check({
    host: "Did my support request go through?",
    reply,
    intent: "tool",
    asked: true,
    askedKinds: ["support"],
    states: [ticket],
    observations: [{
      tool: "list_support_tickets",
      args: {},
      result: [{ subject: "Payout missing", status: "open" }],
    }],
    claims,
  });
  assertEquals(afterRead.text, reply);
  // A new request this turn still needs this turn's record.
  const fresh = await check({
    host: "Open another ticket: my event page won't load",
    reply,
    askedKinds: ["support"],
    states: [ticket],
    claims,
  });
  assert(!/has been sent/.test(fresh.text), fresh.text);
});

Deno.test("R4-1: exact identity only — no substring or paraphrase match", () => {
  assert(objectsMatch("FAVY10", ["favy10"]));
  assert(objectsMatch('"Lagos Food Fest"', ["Lagos Food Fest"]));
  assert(!objectsMatch("FAVY10 and GIRLS20", ["FAVY10"]));
  assert(!objectsMatch("FAVY", ["FAVY10"]));
  assert(!objectsMatch("Lagos Food Fest", ["Lagos Food Fest 2026"]));
  assert(
    !objectsMatch("doors open at 7pm for every event", [
      "Doors always open at 7pm for every event",
    ]),
  );
});

// ── R4-2 ────────────────────────────────────────────────────────────────────

Deno.test("R4-2: an older unrelated note or ticket never backs a save / send claim", async () => {
  const note = await check({
    host: "Remember that doors open at 7pm",
    reply: "I've noted that doors open at 7pm for every event.",
    askedKinds: ["note"],
    more: () =>
      Promise.resolve([
        {
          status: "done",
          kind: "note",
          toolName: "remember_note",
          objects: ["Our bar closes at 2am on Fridays"],
          state: null,
          thisTurn: false,
        } satisfies ClaimEvidence,
      ]),
    claims: [{
      quote: "I've noted that doors open at 7pm for every event.",
      action: "saved",
      object: "doors open at 7pm for every event",
      kind: "note",
    }],
  });
  assert(!/I've noted/.test(note.text), note.text);
  const ticket = await check({
    host: "Open a support ticket: my event page won't load",
    reply:
      "Your request has been sent to the team. They usually reply within a day.",
    askedKinds: ["support"],
    more: () =>
      Promise.resolve([
        {
          status: "done",
          kind: "support",
          toolName: "create_support_ticket",
          objects: ["Payout missing"],
          state: null,
          thisTurn: false,
        } satisfies ClaimEvidence,
      ]),
    claims: [{
      quote: "Your request has been sent to the team.",
      action: "sent",
      object: "your request",
      kind: "support",
    }],
  });
  assert(!/has been sent/.test(ticket.text), ticket.text);
  // A follow-up question (no new write asked): a record read outside the
  // chat is still never "the latest card" a claim can lean on.
  const question = await check({
    host: "Did you save my note about the doors?",
    reply: "Yes, I've saved your note about the doors.",
    intent: "question",
    asked: false,
    more: () =>
      Promise.resolve([
        {
          status: "done",
          kind: "note",
          toolName: "remember_note",
          objects: ["Our bar closes at 2am on Fridays"],
          state: null,
          thisTurn: false,
        } satisfies ClaimEvidence,
      ]),
    claims: [{
      quote: "Yes, I've saved your note about the doors.",
      action: "saved",
      object: "your note about the doors",
      kind: "note",
    }],
  });
  assert(!/I've saved/.test(question.text), question.text);
});

Deno.test("R4-2: the SAME note (exact text) read for this conversation backs the claim; this turn's remember_note backs a paraphrase", async () => {
  const saved = await check({
    host: "Remember that doors open at 7pm",
    reply: "I've noted that doors open at 7pm.",
    askedKinds: ["note"],
    more: () =>
      Promise.resolve([
        {
          status: "done",
          kind: "note",
          toolName: "remember_note",
          objects: ["Doors open at 7pm."],
          state: null,
          thisTurn: false,
        } satisfies ClaimEvidence,
      ]),
    claims: [{
      quote: "I've noted that doors open at 7pm.",
      action: "saved",
      object: "doors open at 7pm",
      kind: "note",
    }],
  });
  assertEquals(saved.text, "I've noted that doors open at 7pm.");
  const inline = await check({
    host: "Please remember: our doors always open at 7pm for every event.",
    reply: "Got it, I've saved that: doors open at 7pm for every event.",
    askedKinds: ["note"],
    observations: [{
      tool: "remember_note",
      args: { text: "Doors always open at 7pm for every event" },
      result: { id: "n1" },
    }],
    claims: [{
      quote: "Got it, I've saved that: doors open at 7pm for every event.",
      action: "saved",
      object: "doors open at 7pm for every event",
      kind: "note",
    }],
  });
  assertEquals(
    inline.text,
    "Got it, I've saved that: doors open at 7pm for every event.",
  );
});

/** A PostgREST-shaped fake that records every filter it is given. */
function recordingClient(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (name: string) => (...values: unknown[]) => {
        call.filters.push(
          `${name}:${values.map((v) => JSON.stringify(v)).join(",")}`,
        );
        return builder;
      };
      for (
        const name of [
          "select",
          "eq",
          "is",
          "gte",
          "in",
          "or",
          "order",
          "limit",
        ]
      ) builder[name] = chain(name);
      builder.then = (resolve: (value: unknown) => void) =>
        resolve({ data: rows[table] ?? [], error: null });
      return builder;
    },
  };
  return { client, calls };
}

Deno.test("R4-2: the records read is scoped to the active brand and this conversation (no 24 h window)", async () => {
  const since = "2026-11-11T10:00:00.000Z";
  const { client, calls } = recordingClient({
    ari_memory_notes: [{ content: "Doors open at 7pm" }],
    support_tickets: [{ subject: "Event page won't load" }],
    brand_discounts: [{
      code: "FAVY10",
      status: "active",
      starts_at: "2026-11-01T00:00:00Z",
      ends_at: "2026-12-19T22:59:59Z",
    }],
  });
  const read = await recentRecordEvidence({
    client: client as never,
    userId: USER,
    kinds: new Set(["note", "support", "discount"]),
    brandId: BRAND,
    since,
    objects: ["favy10", "GIRLS20"],
    now: new Date("2026-11-11T12:00:00Z"),
  });
  const notes = calls.find((call) => call.table === "ari_memory_notes")!;
  assert(
    notes.filters.includes(`gte:"updated_at","${since}"`),
    notes.filters.join(),
  );
  assert(
    notes.filters.includes(`or:"brand_id.is.null,brand_id.eq.${BRAND}"`),
    notes.filters.join(),
  );
  const tickets = calls.find((call) => call.table === "support_tickets")!;
  assert(
    tickets.filters.includes(`eq:"brand_id","${BRAND}"`),
    tickets.filters.join(),
  );
  assert(tickets.filters.includes(`gte:"last_message_at","${since}"`));
  const codes = calls.find((call) => call.table === "brand_discounts")!;
  assert(
    codes.filters.includes(`eq:"brand_id","${BRAND}"`),
    codes.filters.join(),
  );
  assert(
    codes.filters.includes(`in:"code",["FAVY10","GIRLS20"]`),
    codes.filters.join(),
  );
  assertEquals(read.checkedKinds, ["note", "support"]);
  assertEquals(read.checkedObjects, ["FAVY10", "GIRLS20"]);
  const favy = read.records.find((item) => item.kind === "discount")!;
  assertEquals(favy.readState, { live: true, label: "active" });
  // Another brand's id is never interpolated into a filter unchecked.
  const bad = recordingClient({});
  await recentRecordEvidence({
    client: bad.client as never,
    userId: USER,
    kinds: new Set(["note", "support"]),
    brandId: `${OTHER_BRAND}),brand_id.neq.(x`,
    since,
  });
  const badNotes = bad.calls.find((call) => call.table === "ari_memory_notes")!;
  assert(
    badNotes.filters.includes(`is:"brand_id",null`),
    badNotes.filters.join(),
  );
  assert(!bad.calls.some((call) => call.table === "support_tickets"));
  // The conversation starts at its oldest row in the window.
  assertEquals(
    conversationSince([{ created_at: since }, {
      created_at: "2026-11-11T11:00:00Z",
    }], 0),
    since,
  );
});

// ── R4-4 ────────────────────────────────────────────────────────────────────

Deno.test("R4-4: a read that shows the code expired never backs 'FAVY10 is live'", async () => {
  const reply = "Yes, FAVY10 is live and guests can use it at checkout.";
  const claims: AriClaim[] = [{
    quote: reply,
    action: "live",
    object: "FAVY10",
    kind: "discount",
  }];
  const expired = await check({
    host: "Is FAVY10 still working?",
    reply,
    claims,
    asked: false,
    objects: ["FAVY10"],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: { discounts: [{ code: "FAVY10", status: "expired" }] },
    }],
  });
  assertEquals(expired.text, "Your records show FAVY10 as expired.");
  const ended = await check({
    host: "Is FAVY10 still working?",
    reply,
    claims,
    asked: false,
    objects: ["FAVY10"],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: [{
        code: "FAVY10",
        status: "active",
        ends_at: "2020-01-01T00:00:00Z",
      }],
    }],
  });
  assertEquals(ended.text, "Your records show FAVY10 as ended.");
  const live = await check({
    host: "Is FAVY10 still working?",
    reply,
    claims,
    asked: false,
    objects: ["FAVY10"],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: [{
        code: "FAVY10",
        status: "active",
        ends_at: "2099-01-01T00:00:00Z",
      }],
    }],
  });
  assertEquals(live.text, reply);
});

// ── R4-5 ────────────────────────────────────────────────────────────────────

Deno.test("R4-5: 'Nothing has been saved' only after a read proved absence", async () => {
  const reply = "FAVY10 is already live on your brand.";
  const claims: AriClaim[] = [{
    quote: reply,
    action: "live",
    object: "FAVY10",
    kind: "discount",
  }];
  const unread = await check({
    host: "Create FAVY10 for 10% off",
    reply,
    claims,
    objects: ["FAVY10"],
    askedKinds: ["discount"],
  });
  assert(!/Nothing has been saved/.test(unread.text), unread.text);
  assertEquals(unread.text, "I don't see FAVY10 in this chat yet.");
  const absent = await check({
    host: "Create FAVY10 for 10% off",
    reply,
    claims,
    objects: ["FAVY10"],
    askedKinds: ["discount"],
    more: () =>
      Promise.resolve({
        records: [],
        checkedKinds: [],
        checkedObjects: ["FAVY10"],
      }),
  });
  assertEquals(absent.text, "Nothing has been saved or sent for FAVY10 yet.");
  // The brand already has it (made in Marketing): the read backs the claim.
  const exists = await check({
    host: "Create FAVY10 for 10% off",
    reply,
    claims,
    objects: ["FAVY10"],
    askedKinds: ["discount"],
    more: (_kinds, objects) => {
      assertEquals([...objects], ["FAVY10"]);
      return Promise.resolve({
        records: [
          {
            status: "read",
            kind: "discount",
            toolName: "list_discounts",
            objects: ["FAVY10"],
            state: null,
            thisTurn: false,
            readState: { live: true, label: "active" },
          } satisfies ClaimEvidence,
        ],
        checkedKinds: [],
        checkedObjects: ["FAVY10"],
      });
    },
  });
  assertEquals(exists.text, reply);
});

// ── R4-6 ────────────────────────────────────────────────────────────────────

Deno.test("R4-6: a hung records read is cut at 1.5 s and the chat's own records decide", async () => {
  assert(ARI_CLAIM_RECORDS_TIMEOUT_MS <= 1_500);
  const started = Date.now();
  let release: (() => void) | undefined;
  const out = await check({
    host: "Remember doors 7pm",
    reply: "I've noted that doors open at 7pm.",
    askedKinds: ["note"],
    more: () => new Promise((resolve) => (release = () => resolve([]))),
    claims: [{
      quote: "I've noted that doors open at 7pm.",
      action: "saved",
      object: "doors open at 7pm",
      kind: "note",
    }],
  });
  release?.();
  const took = Date.now() - started;
  assert(took < 2_500, `took ${took} ms`);
  assert(!/I've noted/.test(out.text), out.text);
  assertEquals(out.source, "model");
});

// ── R4-9, R4-10 ─────────────────────────────────────────────────────────────

Deno.test("R4-9: a bare status exclamation goes with the replaced claim it fronts", async () => {
  const reply = "Oga, e don set!\n- GIRLS20 ✅\n- Guests don hear ✅";
  const out = await check({
    host: "Make GIRLS20 and tell my guests",
    reply,
    objects: ["GIRLS20"],
    askedKinds: ["discount"],
    claims: [
      {
        quote: "- GIRLS20 ✅",
        action: "created",
        object: "GIRLS20",
        kind: "discount",
      },
      {
        quote: "- Guests don hear ✅",
        action: "notified",
        object: null,
        kind: "message",
      },
    ],
  });
  assert(!/e don set/i.test(out.text), out.text);
  assert(out.text.includes("I don't see GIRLS20 in this chat yet."), out.text);
  assert(isStatusExclamation("All set ✅"));
  assert(isStatusExclamation("**Done!**"));
  assert(!isStatusExclamation("Done! FAVY10 is live."));
});

Deno.test("R4-10 (accepted residual, pinned): no action, no write, no chat object -> not checked", async () => {
  assert(
    !claimCheckWanted({
      intent: "question",
      recentWrite: false,
      text: "All set ✅ your discount is live",
      objects: [],
    }),
  );
  let called = 0;
  const out = await checkReplyClaims({
    text: "All set ✅ your discount is live",
    hostMessage: "how do discounts work?",
    intent: "question",
    recentWrite: false,
    objects: [],
    evidence: [],
    askedWriteThisTurn: false,
    call: () => {
      called++;
      return Promise.resolve({ claims: [] });
    },
  });
  assertEquals(out.source, "skipped");
  assertEquals(called, 0);
  // Any one of the three signals turns the check on.
  assert(
    claimCheckWanted({
      intent: "tool",
      recentWrite: false,
      text: "x",
      objects: [],
    }),
  );
  assert(
    claimCheckWanted({
      intent: "question",
      recentWrite: true,
      text: "x",
      objects: [],
    }),
  );
  assert(
    claimCheckWanted({
      intent: "question",
      recentWrite: false,
      text: "FAVY10 is live",
      objects: ["FAVY10"],
    }),
  );
});

// ── R4-3, R4-11, minimum order ─────────────────────────────────────────────

Deno.test("R4-3: bare 'orders' / 'deposit' never pick venue kinds; explicit venue phrases do", () => {
  for (
    const text of [
      "FAVY10 10% off all orders over N10,000",
      "10% off for the first 20 orders",
      "FAVY10, no deposit needed, 10% off",
    ]
  ) {
    const resolved = resolveDiscountTargetDefault(["event"], text);
    assertEquals(resolved.kind, "default", text);
    assertEquals(resolved.listingKinds, ["event"], text);
  }
  assertEquals(
    resolveDiscountTargetDefault([], "FAVY10 10% off all orders over N10,000")
      .listingKinds,
    ["event"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event"], "10% off food orders at the venue")
      .listingKinds,
    ["venue_order"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event"], "10% off table deposits")
      .listingKinds,
    ["reservation_deposit"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event"], "no table deposit, 10% off events")
      .listingKinds,
    ["event"],
  );
  // "tickets" / "tour" count only for a brand that sells that kind.
  assertEquals(
    resolveDiscountTargetDefault(["trip"], "10% off when they buy tickets")
      .listingKinds,
    ["trip"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event"], "10% off the whole tour")
      .listingKinds,
    ["event"],
  );
});

Deno.test("R4-11: a brand that sells several kinds and the host named none is asked ONE question", () => {
  const resolved = resolveDiscountTargetDefault(
    ["event", "trip"],
    "FAVY10 10% off",
  );
  assertEquals(resolved, { kind: "ask", listingKinds: ["event", "trip"] });
  let message = "";
  try {
    applyDiscountTargetDefault({ code: "favy10" }, resolved);
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(
    message,
    "Which listings is FAVY10 for: your events or your trips? Tell me and I'll set it up.",
  );
  // A kind the host named that the brand does not sell asks too.
  const unsold = resolveDiscountTargetDefault(["event"], "FAVY10 for my trips");
  assertEquals(unsold, {
    kind: "ask",
    listingKinds: ["event"],
    notSold: ["trip"],
  });
  try {
    applyDiscountTargetDefault({ code: "FAVY10" }, unsold);
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(
    message,
    "You don't have any trips yet. Should FAVY10 be for your events? Tell me and I'll set it up.",
  );
  // Single-kind and no-listing brands keep their defaults.
  assertEquals(resolveDiscountTargetDefault(["trip"], "FAVY10").listingKinds, [
    "trip",
  ]);
  assertEquals(resolveDiscountTargetDefault([], "FAVY10").listingKinds, [
    "event",
  ]);
});

Deno.test("R4-3: 'orders over ₦10,000' sets the minimum order, never the kind", () => {
  assertEquals(
    statedMinimumOrderMinor("20% off all orders over 10,000"),
    1_000_000,
  );
  assertEquals(statedMinimumOrderMinor("orders over ₦10,000"), 1_000_000);
  assertEquals(statedMinimumOrderMinor("minimum order ₦5,000"), 500_000);
  assertEquals(statedMinimumOrderMinor("when they spend over 10k"), 1_000_000);
  assertEquals(
    statedMinimumOrderMinor("10% off for the first 20 orders"),
    null,
  );
  assertEquals(
    applyStatedMinimumOrder(
      { code: "X" },
      "GIRLS20 for 20% off all orders over N10,000",
    )
      .min_subtotal_minor,
    1_000_000,
  );
  // The model's own value is kept.
  assertEquals(
    applyStatedMinimumOrder({ min_subtotal_minor: 5 }, "orders over N10,000")
      .min_subtotal_minor,
    5,
  );
});

// ── R4-7 ────────────────────────────────────────────────────────────────────

function eventsClient(kinds: string[]) {
  return {
    from(table: string) {
      const rows = table === "events"
        ? kinds.map((event_type) => ({ brand_id: BRAND, event_type }))
        : [];
      const builder: Record<string, unknown> = {};
      for (const name of ["select", "eq", "is", "neq", "limit"]) {
        builder[name] = () => builder;
      }
      builder.then = (resolve: (value: unknown) => void) =>
        resolve({ data: rows, error: null });
      return builder;
    },
  };
}

function proposal(goalText: string): Extract<
  PostApprovalContinuation,
  { kind: "proposal" }
> {
  return {
    kind: "proposal",
    toolName: "create_discount",
    toolArgs: {
      brand_id: BRAND,
      kind: "code",
      code: "GIRLS20",
      value_type: "percent",
      value_bps: 2000,
      scope_kind: "listings",
      targets: [{ target_kind: "event" }],
    },
    text: "That's saved. The next change is ready for you to review.",
    observations: [],
    goalText,
  };
}

Deno.test("R4-7: the continuation's second code gets the fill-in (and the minimum order)", async () => {
  const out = await prepareContinuationProposal({
    continuation: proposal(
      "Make FAVY10 10% off and GIRLS20 20% off all orders over 10,000 naira",
    ),
    client: eventsClient(["event"]) as never,
    canonicalize: canonicalizeAgentProposalArgs,
  });
  assertEquals(out.kind, "proposal");
  if (out.kind !== "proposal") return;
  assertEquals(out.toolArgs.targets, [{
    target_kind: "listing_kind",
    listing_kind: "event",
  }]);
  assertEquals(out.toolArgs.min_subtotal_minor, 1_000_000);
});

Deno.test("R4-7: when the fill-in has to ask, the question is the continuation text (never dropped)", async () => {
  const out = await prepareContinuationProposal({
    continuation: proposal("Make FAVY10 10% off and GIRLS20 20% off"),
    client: eventsClient(["event", "trip"]) as never,
    canonicalize: canonicalizeAgentProposalArgs,
  });
  assertEquals(out.kind, "text");
  assertEquals(
    out.text,
    "That's saved. Which listings is GIRLS20 for: your events or your trips? Tell me and I'll set it up.",
  );
  // The real binder is the default, and agent-confirm-action calls it.
  const source = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assertMatch(source, /prepareContinuationProposal\(\{/);
  assert(
    source.indexOf("prepareContinuationProposal({") <
      source.indexOf("await authorizeAgentTool(\n                nextTool,"),
  );
  assertEquals(typeof bindDiscountTargetDefault, "function");
});

// ── R4-12, R4-13 ────────────────────────────────────────────────────────────

Deno.test("R4-12: a heading in the continuation is softened to a bold line; a code fence still trips the lint", async () => {
  const { lintAriCopy } = await import("../agentCopyLint.ts");
  const soft = softenAriHeadings(
    "That's saved.\n\n### Next steps\n- Share FAVY10\n***Tip***",
  );
  assertEquals(
    soft,
    "That's saved.\n\n**Next steps**\n- Share FAVY10\n**Tip**",
  );
  assert(lintAriCopy(soft).ok);
  assert(!lintAriCopy(softenAriHeadings("```\ncode\n```")).ok);
  const source = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    source,
    /const continuationText = softenAriHeadings\(loop\.text\);/,
  );
  assertMatch(source, /lintAriCopy\(continuationText,/);
});

Deno.test("R4-13: 'till Easter' and 'until the end of next month' are read as end dates", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const easter = extractStatedSlots(["Make FAVY10 10% off till Easter"], now)
    .ends_on as { year: number; month: number; day: number };
  assertEquals([easter.year, easter.month, easter.day], [2027, 3, 28]);
  const monday = extractStatedSlots(["FAVY10 until Easter Monday"], now)
    .ends_on as { year: number; month: number; day: number };
  assertEquals([monday.year, monday.month, monday.day], [2027, 3, 29]);
  const next = extractStatedSlots(
    ["FAVY10 10% off until end of next month"],
    now,
  )
    .ends_on as { year: number; month: number; day: number };
  assertEquals([next.year, next.month, next.day], [2026, 12, 31]);
  const thisMonth = extractStatedSlots(
    ["FAVY10 till the end of the month"],
    now,
  )
    .ends_on as { year: number; month: number; day: number };
  assertEquals([thisMonth.year, thisMonth.month, thisMonth.day], [
    2026,
    11,
    30,
  ]);
});
