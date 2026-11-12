// #3355 tester retest 4 — adversarial angles on the claim check (Seth's
// design: an AI check against the records). The model's claim list is fixed
// here (the shape Gemini Flash returned for these replies in the retest 4
// live probe), so each case pins the server's reconcile, fallback and
// deadline behaviour, not the model.
//   - a cancelled card contradicts "live" inside a question;
//   - a table row and a sentence are decided per object (one backed, one not);
//   - a slow, failing or garbage judge falls back without blanking the read
//     or how-to answer;
//   - "nothing saved" is said only for the kind the host asked for;
//   - an unknown listing kind is still refused after the 3b target bind;
//   - a brand in a multi-zone country with no zone reads times labelled UTC.
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriClaim,
  buildClaimEvidence,
  checkReplyClaims,
} from "../ariClaimCheck.ts";
import type { WriteState } from "../ariTruthGuards.ts";
import {
  applyDiscountTargetDefault,
  canonicalizeCreateDiscountArgs,
  resolveDiscountTargetDefault,
} from "../ariDiscountArgs.ts";
import { ariBrandDisplayZone, ariLocalInstant } from "../ariLocalTime.ts";

function state(
  status: WriteState["status"],
  code: string,
): WriteState {
  return {
    actionId: `a-${code}`,
    toolName: "create_discount",
    status,
    object: code,
    args: { code, percent_off: 10 },
    receiptText: null,
  };
}

async function check(args: {
  host: string;
  reply: string;
  states?: WriteState[];
  objects?: string[];
  intent?: string;
  asked?: boolean;
  askedKinds?: string[];
  claims?: AriClaim[];
  call?: (request: { signal: AbortSignal }) => Promise<unknown>;
}) {
  return await checkReplyClaims({
    text: args.reply,
    hostMessage: args.host,
    intent: args.intent ?? "tool",
    recentWrite: (args.states ?? []).length > 0,
    objects: args.objects ?? [],
    evidence: buildClaimEvidence({ states: args.states ?? [] }),
    askedWriteThisTurn: args.asked ?? true,
    ...(args.askedKinds
      ? { askedKinds: new Set(args.askedKinds) as Set<never> }
      : {}),
    call: args.call ?? (() => Promise.resolve({ claims: args.claims ?? [] })),
  });
}

Deno.test("#3355 retest 4: a cancelled card contradicts 'now live' inside a question", async () => {
  const reply =
    "Since FAVY10 is now live, would you like me to share it with your guests?";
  const out = await check({
    host: "ok thanks",
    reply,
    states: [state("cancelled", "FAVY10")],
    objects: ["FAVY10"],
    intent: "chat",
    asked: false,
    claims: [{
      quote: "Since FAVY10 is now live",
      action: "live",
      object: "FAVY10",
      kind: "discount",
    }],
  });
  assertEquals(
    out.text,
    "The card for FAVY10 was cancelled, so nothing was saved.",
  );
});

Deno.test("#3355 retest 4: table rows are decided per code (FAVY10 saved, GIRLS20 not)", async () => {
  const reply =
    "Here's where your codes stand:\n\n| Code | Status |\n|---|---|\n| FAVY10 | ✅ Live |\n| GIRLS20 | ✅ Live |";
  const out = await check({
    host: "Make FAVY10 10% off and GIRLS20 20% off",
    reply,
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    askedKinds: ["discount"],
    claims: [
      {
        quote: "| FAVY10 | ✅ Live |",
        action: "live",
        object: "FAVY10",
        kind: "discount",
      },
      {
        quote: "| GIRLS20 | ✅ Live |",
        action: "live",
        object: "GIRLS20",
        kind: "discount",
      },
    ],
  });
  assert(out.text.includes("| FAVY10 | ✅ Live |"), out.text);
  assert(!out.text.includes("| GIRLS20 | ✅ Live |"), out.text);
  // #3355 rework 4 (R4-5): no read proved absence.
  assert(
    out.text.includes("I don't see GIRLS20 in this chat yet."),
    out.text,
  );
});

Deno.test("#3355 retest 4: a slow judge (past the 4 s cap) falls back and keeps the read answer", async () => {
  const reply =
    "FAVY10 ends on Sat 19 Dec 2026, 11:59 pm Lagos time. I've created GIRLS20 for 20% off.";
  const started = Date.now();
  const out = await check({
    host: "Create GIRLS20 20% off",
    reply,
    states: [state("executed", "FAVY10")],
    objects: ["FAVY10", "GIRLS20"],
    // A judge that honours the abort, like callGeminiStructured.
    call: ({ signal }) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ claims: [] }), 6_000);
        signal.addEventListener("abort", () => clearTimeout(timer));
      }),
  });
  assertEquals(out.source, "fallback");
  assertEquals(out.reason, "timeout");
  assert(Date.now() - started < 5_500, "the check waited past its cap");
  assertEquals(
    out.text,
    "FAVY10 ends on Sat 19 Dec 2026, 11:59 pm Lagos time.",
  );
});

Deno.test("#3355 retest 4: a failing or garbage judge never blanks a how-to answer", async () => {
  const reply =
    "Payouts are sent to your bank 3 working days after the event ends.";
  for (
    const call of [
      () => Promise.reject(new Error("503")),
      () => Promise.resolve("not json"),
      () =>
        Promise.resolve({
          claims: [{
            quote: "not in the reply",
            action: "sent",
            object: null,
            kind: "payout",
          }],
        }),
    ]
  ) {
    const out = await check({
      host: "How do payouts work?",
      reply,
      states: [state("executed", "FAVY10")],
      objects: ["FAVY10"],
      call,
    });
    assertEquals(out.source, "fallback");
    assertEquals(out.text, reply);
  }
});

Deno.test("#3355 retest 4: 'nothing saved' only for the asked kind; an unasked email claim is dropped", async () => {
  const out = await check({
    host: "Create GIRLS20 20% off",
    reply: "I've created GIRLS20. I've also emailed your guests about it.",
    objects: ["GIRLS20"],
    askedKinds: ["discount"],
    claims: [
      {
        quote: "I've created GIRLS20.",
        action: "created",
        object: "GIRLS20",
        kind: "discount",
      },
      {
        quote: "I've also emailed your guests about it.",
        action: "notified",
        object: "your guests",
        kind: "message",
      },
    ],
  });
  // #3355 rework 4 (R4-5): no read proved absence.
  assertEquals(out.text, "I don't see GIRLS20 in this chat yet.");
});

Deno.test("#3355 retest 4: an unknown listing kind is still refused after the target bind", () => {
  const args = {
    code: "FAVY10",
    kind: "percent_off",
    percent_off: 10,
    scope_kind: "listing_kinds",
    targets: [{ target_kind: "listing_kind", listing_kind: "banana" }],
  };
  // The bind leaves an invalid kind alone (it is not "unspecified").
  const bound = applyDiscountTargetDefault(
    args,
    resolveDiscountTargetDefault([], "FAVY10 10% off"),
  );
  assertEquals(
    (bound.targets as Array<Record<string, unknown>>)[0].listing_kind,
    "banana",
  );
  assertThrows(() => canonicalizeCreateDiscountArgs(bound));
});

Deno.test("#3355 retest 4: brands with no zone in a multi-zone country read times labelled UTC", () => {
  for (const country of ["US", "CA", "ES", "PT", null]) {
    const zone = ariBrandDisplayZone(null, country);
    assertEquals(zone, null, String(country));
    assertEquals(
      ariLocalInstant("2026-12-19T22:59:59Z", zone),
      "Sat 19 Dec 2026, 10:59 pm UTC",
    );
  }
  // An invalid stored zone falls back to the country's single zone.
  assertEquals(ariBrandDisplayZone("Not/AZone", "NG"), "Africa/Lagos");
  assertEquals(
    ariLocalInstant("2026-12-19T22:59:59Z", "Africa/Lagos"),
    "Sat 19 Dec 2026, 11:59 pm Lagos time",
  );
});
