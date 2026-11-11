// #3355 Retest 5 (tester, adversarial) — the claim check's EXACT matching,
// attacked from angles the rework 4 implementor test does not take:
//   - codes that differ by case, prefix or an inner space;
//   - a read row whose state is only in ends_at, in a nested result, or a
//     code recreated after an ended row;
//   - cancelled / expired cards against "is live";
//   - the brand records read: codes upper-cased, the active brand filtered,
//     deleted rows excluded;
//   - the discount fill-in: negated venue words never pick venue kinds.
// The judge is stubbed with the claim shape it returns; each case pins the
// server's matching, never the model.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
  recentRecordEvidence,
  rowReadState,
} from "../ariClaimCheck.ts";
import type { WriteState } from "../ariTruthGuards.ts";
import {
  resolveDiscountTargetDefault,
  statedMinimumOrderMinor,
} from "../ariDiscountArgs.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";

function card(status: WriteState["status"], code: string): WriteState {
  return {
    actionId: `a-${code}-${status}`,
    toolName: "create_discount",
    status,
    object: code,
    args: { code, value_bps: 1000 },
    receiptText: null,
  };
}

async function check(args: {
  host: string;
  reply: string;
  claims: AriClaim[];
  states?: WriteState[];
  observations?: ClaimObservation[];
  objects?: string[];
  question?: boolean;
}) {
  const question = args.question ?? false;
  return (await checkReplyClaims({
    text: args.reply,
    hostMessage: args.host,
    intent: question ? "question" : "tool",
    recentWrite: true,
    objects: args.objects ?? [],
    evidence: buildClaimEvidence({
      states: args.states ?? [],
      observations: args.observations ?? [],
      isReadTool: (tool) => /^(?:list_|get_)/.test(tool),
    }),
    askedWriteThisTurn: !question,
    ...(question ? {} : { askedKinds: new Set(["discount"]) as Set<never> }),
    call: () => Promise.resolve({ claims: args.claims }),
  })).text;
}

const live = (quote: string, object: string | null): AriClaim => ({
  quote,
  action: "live",
  object,
  kind: "discount",
});

Deno.test("retest 5: a code differing only by case is the same code", async () => {
  const reply = "favy10 is live now.";
  assertEquals(
    await check({
      host: "is favy10 live?",
      reply,
      claims: [live(reply, "favy10")],
      states: [card("executed", "FAVY10")],
      objects: ["FAVY10"],
      question: true,
    }),
    reply,
  );
});

Deno.test("retest 5: a prefix or an extra character is a different code", async () => {
  const shorter = "FAVY10 is live.";
  const a = await check({
    host: "Make FAVY100 for 10% off",
    reply: shorter,
    claims: [live(shorter, "FAVY10")],
    states: [card("executed", "FAVY100")],
    objects: ["FAVY100"],
  });
  assert(!/is live/.test(a), a);
  const longer = "FAVY100 is live.";
  const b = await check({
    host: "Make FAVY100 for 10% off",
    reply: longer,
    claims: [live(longer, "FAVY100")],
    states: [card("executed", "FAVY10")],
    objects: ["FAVY10", "FAVY100"],
  });
  assert(!/is live/.test(b), b);
});

Deno.test("retest 5: 'FAVY 10' (inner space) is not backed by another code saved this turn", async () => {
  const reply = "FAVY 10 is live too.";
  const out = await check({
    host: "Make GIRLS20 for 20% off",
    reply,
    claims: [live(reply, "FAVY 10")],
    states: [card("executed", "GIRLS20")],
    objects: ["GIRLS20"],
  });
  assert(!/is live/.test(out), out);
});

Deno.test("retest 5: a read row ended only by ends_at, or nested in the result, never backs 'live'", async () => {
  const reply = "Yes, FAVY10 is live.";
  const endsPast = await check({
    host: "is FAVY10 live?",
    reply,
    claims: [live(reply, "FAVY10")],
    observations: [{
      tool: "list_discounts",
      args: { brand_id: BRAND },
      result: [{
        code: "FAVY10",
        status: "active",
        ends_at: "2026-01-01T00:00:00+00:00",
      }],
    }],
    objects: ["FAVY10"],
    question: true,
  });
  assertEquals(endsPast, "Your records show FAVY10 as ended.");
  const nested = await check({
    host: "is FAVY10 live?",
    reply,
    claims: [live(reply, "FAVY10")],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: { discounts: [{ code: "FAVY10", status: "paused" }] },
    }],
    objects: ["FAVY10"],
    question: true,
  });
  assertEquals(nested, "Your records show FAVY10 as paused.");
  // A code recreated after an ended row: the live row backs "live".
  const recreated = await check({
    host: "is FAVY10 live?",
    reply,
    claims: [live(reply, "FAVY10")],
    observations: [{
      tool: "list_discounts",
      args: {},
      result: [{ code: "FAVY10", status: "ended" }, {
        code: "FAVY10",
        status: "active",
      }],
    }],
    objects: ["FAVY10"],
    question: true,
  });
  assertEquals(recreated, reply);
});

Deno.test("retest 5: rowReadState reads ends_at / starts_at against now", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assertEquals(
    rowReadState({ status: "active", ends_at: "2026-11-11T11:59:59Z" }, now)
      ?.label,
    "ended",
  );
  assertEquals(
    rowReadState({ status: "active", starts_at: "2026-11-12T00:00:00Z" }, now)
      ?.label,
    "scheduled",
  );
  assertEquals(
    rowReadState({ status: "active", ends_at: "2026-11-12T00:00:00Z" }, now)
      ?.live,
    true,
  );
});

Deno.test("retest 5: a cancelled or expired card is the truth for 'is live'", async () => {
  const reply = "Yes, FAVY10 is live.";
  for (const status of ["cancelled", "expired"] as const) {
    const out = await check({
      host: "is FAVY10 live?",
      reply,
      claims: [live(reply, "FAVY10")],
      states: [card(status, "FAVY10")],
      objects: ["FAVY10"],
      question: true,
    });
    assert(!/is live/.test(out), `${status}: ${out}`);
    assert(/nothing was saved/.test(out), `${status}: ${out}`);
  }
});

Deno.test("retest 5: the brand records read upper-cases codes, filters the active brand and skips deleted rows", async () => {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const chain: any = {};
      for (
        const method of [
          "select",
          "eq",
          "is",
          "gte",
          "or",
          "order",
          "limit",
          "in",
        ]
      ) {
        chain[method] = (...a: unknown[]) => {
          calls.push([`${table}.${method}`, a]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => void) =>
        resolve({
          data: table === "brand_discounts"
            ? [{ code: "FAVY10", status: "ended", deleted_at: null }]
            : [],
          error: null,
        });
      return chain;
    },
  };
  const read = await recentRecordEvidence({
    // deno-lint-ignore no-explicit-any
    client: client as any,
    userId: "22222222-2222-4222-8222-222222222222",
    kinds: new Set(["discount"]),
    brandId: BRAND,
    since: "2026-11-11T00:00:00Z",
    objects: ["favy10", "favy10", "GIRLS 20"],
  });
  const of = (name: string) =>
    calls.filter(([method]) => method === name).map(([, a]) => a);
  assertEquals(of("brand_discounts.in"), [["code", ["FAVY10"]]]);
  assertEquals(of("brand_discounts.eq"), [["brand_id", BRAND]]);
  assertEquals(of("brand_discounts.is"), [["deleted_at", null]]);
  assertEquals(read.checkedObjects, ["FAVY10"]);
  assertEquals(read.records[0]?.readState?.label, "ended");
  // A malformed brand id reads no brand codes at all.
  calls.length = 0;
  await recentRecordEvidence({
    // deno-lint-ignore no-explicit-any
    client: client as any,
    userId: "22222222-2222-4222-8222-222222222222",
    kinds: new Set(["discount"]),
    brandId: `${BRAND}) or (true`,
    since: "2026-11-11T00:00:00Z",
    objects: ["FAVY10"],
  });
  assertEquals(of("brand_discounts.in"), []);
});

Deno.test("retest 5: negated venue words never pick a venue kind; explicit ones do", () => {
  assertEquals(
    resolveDiscountTargetDefault(["event"], "10% off, not for venue orders"),
    { kind: "default", listingKinds: ["event"], reason: "brand_only_kind" },
  );
  assertEquals(
    resolveDiscountTargetDefault(
      ["event"],
      "FAVY10, no table deposit needed, 10% off",
    ).listingKinds,
    ["event"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], "10% off menu orders")
      .listingKinds,
    ["venue_order"],
  );
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], "10% off everything").kind,
    "ask",
  );
});

Deno.test("retest 5: money minimums in words the parser reads", () => {
  assertEquals(statedMinimumOrderMinor("10% off orders over N1.5k"), 150_000);
  assertEquals(
    statedMinimumOrderMinor("minimum spend of 5,000 naira"),
    500_000,
  );
  assertEquals(statedMinimumOrderMinor("no minimum order, 10% off"), null);
  assertEquals(statedMinimumOrderMinor("10% off the first 20 orders"), null);
});
