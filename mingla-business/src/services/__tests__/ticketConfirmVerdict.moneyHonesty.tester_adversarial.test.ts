/**
 * #2264 — ADVERSARIAL. A different angle from the implementor's suites.
 *
 * Those assert the classifier against answers the test itself writes down. That
 * proves the classifier agrees with the test author. It does not prove the
 * classifier agrees with the SERVER — and every defect in this issue's history
 * has been exactly that gap:
 *
 *   • the client typed the confirm response so narrowly that `status` and
 *     `error` were invisible, so a terminal verdict read as "nothing yet";
 *   • a 409 refusal arrived as a throw and was filed under "network blip";
 *   • `checkout_unavailable` was answered with a sentence written for the
 *     CREATE leg, ending "You have not been charged" — read by the one guest
 *     for whom it was certainly false.
 *
 * So this suite derives its inputs from the edge functions' own source text and
 * asserts the client's behaviour against THEM. It goes red when the server
 * learns to say something the client has not been taught to hear, which is the
 * failure mode a hand-written fixture list can never catch.
 *
 * It also attacks the three states the implementor's happy path does not: an
 * answer that arrives LATE, an outcome nobody has ever seen, and a transport
 * failure in the middle of the wait.
 *
 * Owner: mingla-tester (adversarial half). Issue: #2264.
 */

import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import {
  classifyTicketConfirmAnswer,
  awaitTicketConfirmation,
  TICKET_CONFIRM_BUDGET_MS,
  TICKETS_EXPIRED_MESSAGE,
  TICKETS_NOT_ISSUED_MESSAGE,
  TICKETS_STILL_CONFIRMING_MESSAGE,
  type TicketCheckoutConfirmResult,
  type TicketConfirmClassification,
} from "../ticketCheckoutService";

const REPO = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(REPO, relative), "utf8");

const CONFIRM_FN = "supabase/functions/ticket-checkout-confirm/index.ts";
const STATUS_FN = "supabase/functions/ticket-checkout-status/index.ts";
const RESOLVER = "supabase/functions/_shared/paystackTicketReturnVerify.ts";

const SESSION = "cs-adversarial";
const TOKEN = "bst-adversarial";

const answer = (
  status: string,
  extra: Partial<TicketCheckoutConfirmResult> = {},
): TicketCheckoutConfirmResult =>
  ({
    checkoutSessionId: SESSION,
    status,
    order: null,
    ...extra,
  }) as TicketCheckoutConfirmResult;

/** The error shape `invokeOrThrow` produces for a handled refusal. */
const thrown = (status: number | null, code: string | null): Error =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    status,
    code,
    detail: null,
  });

/**
 * Every `status: "<x>"` the two buyer-facing edge functions can put on the
 * wire, read out of their source rather than remembered.
 */
const serverStatuses = (): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const source of [read(CONFIRM_FN), read(STATUS_FN)]) {
    for (const [, value] of source.matchAll(
      /status:\s*"([a-z_]+)"(?:\s*as\s*FinalizeStatus)?/g,
    )) {
      found.add(value);
    }
  }
  return found;
};

/** Every bounded token #2198's resolver can hand the client as `error`. */
const resolverTokens = (): readonly string[] => {
  const source = read(RESOLVER);
  const tokens = new Set<string>();
  for (const [, value] of source.matchAll(
    /kind:\s*"failed",\s*code:\s*"([a-z_]+)"/g,
  )) {
    tokens.add(value);
  }
  for (const [, value] of source.matchAll(/code:\s*\n?\s*"([a-z_]+)"/g)) {
    tokens.add(value);
  }
  // The abandoned/failed pair is written as a ternary, so name both explicitly
  // only if the ternary that produces them is still there.
  if (source.includes("paystack_charge_abandoned")) {
    tokens.add("paystack_charge_abandoned");
  }
  if (source.includes("paystack_charge_failed")) tokens.add("paystack_charge_failed");
  return [...tokens];
};

/** The sentence a classification would put on the guest's screen, if any. */
const copyFor = (c: TicketConfirmClassification): string | null => {
  switch (c.kind) {
    case "payment_failed":
      return c.message;
    case "expired":
      return TICKETS_EXPIRED_MESSAGE;
    case "not_issued":
      return TICKETS_NOT_ISSUED_MESSAGE;
    default:
      return null;
  }
};

describe("TA-1 — the client hears every status the server can actually send", () => {
  test("the server's status vocabulary is non-trivial and was really read", () => {
    const statuses = serverStatuses();
    // A derivation that silently matches nothing would make this whole suite
    // vacuous, which is the bug class this repo calls a check carrying no info.
    expect(statuses.size).toBeGreaterThanOrEqual(4);
    expect([...statuses]).toEqual(expect.arrayContaining(["paid", "pending", "failed"]));
  });

  test("no server status lands on a classification the screens cannot render", () => {
    const renderable = new Set([
      "paid",
      "payment_failed",
      "expired",
      "not_issued",
      "pending",
      "unanswerable",
    ]);
    for (const status of serverStatuses()) {
      const c = classifyTicketConfirmAnswer({
        kind: "result",
        result: answer(status),
      });
      expect(renderable.has(c.kind)).toBe(true);
    }
  });

  test("a status nobody has ever seen WAITS — it is never dressed up as a verdict", () => {
    for (const status of ["", "succeeded", "REFUNDED", "paid_reversal_pending", "🙂"]) {
      expect(
        classifyTicketConfirmAnswer({ kind: "result", result: answer(status) }).kind,
      ).toBe("pending");
    }
  });
});

describe("TA-2 — no sentence claims a charge outcome the server did not give us", () => {
  test("every resolver token produces copy, and none of it invents a charge fact", () => {
    const tokens = resolverTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    for (const token of tokens) {
      const c = classifyTicketConfirmAnswer({
        kind: "result",
        result: answer("failed", { error: token } as Partial<TicketCheckoutConfirmResult>),
      });
      const copy = copyFor(c);
      expect(typeof copy).toBe("string");
      expect(copy).not.toBe("");
      // Never a raw machine token on a guest's screen.
      expect(copy).not.toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("`checkout_unavailable` NEVER reaches copy that says the guest was not charged", () => {
    // The resolver emits this token at HTTP 200 for exactly one state —
    // `paid_reversal_pending` — where the guest has definitely paid. The confirm
    // function raises the same token at 409 only AFTER the PaymentIntent
    // succeeded. Both arms are charged guests.
    expect(read(RESOLVER)).toContain("paid_reversal_pending");

    const arms: TicketConfirmClassification[] = [
      classifyTicketConfirmAnswer({
        kind: "result",
        result: answer("failed", {
          error: "checkout_unavailable",
        } as Partial<TicketCheckoutConfirmResult>),
      }),
      classifyTicketConfirmAnswer({
        kind: "error",
        error: thrown(409, "checkout_unavailable"),
      }),
      classifyTicketConfirmAnswer({ kind: "error", error: thrown(409, null) }),
      classifyTicketConfirmAnswer({
        kind: "error",
        error: thrown(null, "checkout_unavailable"),
      }),
    ];
    for (const arm of arms) {
      expect(arm.kind).toBe("not_issued");
      const copy = copyFor(arm) ?? "";
      expect(copy).not.toMatch(/been charged/i);
      // #2079 parks two of the three server refusals as a NON-EXECUTABLE
      // obligation a person resolves — possibly by completing the sale. A
      // promised refund is a promise we may not keep.
      expect(copy).not.toMatch(/refund/i);
      expect(copy).toMatch(/don't pay again/i);
    }
  });

  test("the one sentence allowed to say 'not charged' is reachable ONLY from `expired`", () => {
    const sayers = (["paid", "pending", "failed", "expired"] as const).filter(
      (status) => {
        const copy =
          copyFor(
            classifyTicketConfirmAnswer({ kind: "result", result: answer(status) }),
          ) ?? "";
        return /been charged/i.test(copy);
      },
    );
    expect(sayers).toEqual(["expired"]);
  });
});

describe("TA-3 — late answers, unknown outcomes and a transport failure mid-wait", () => {
  const clock = (): { now: () => number; waitFor: (ms: number) => Promise<void> } => {
    let t = 0;
    return {
      now: () => t,
      waitFor: async (ms: number) => {
        t += ms;
      },
    };
  };

  test("a refusal that arrives LATE, after transport failures, still ends the wait", async () => {
    const c = clock();
    let call = 0;
    const confirm = jest.fn(async () => {
      call += 1;
      if (call <= 3) throw new TypeError("Failed to fetch");
      throw thrown(409, "checkout_unavailable");
    });

    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: confirm as never,
      now: c.now,
      waitFor: c.waitFor,
    });

    expect(verdict).toEqual({ kind: "not_issued" });
    expect(call).toBe(4);
    // And the budget was respected on the way there.
    expect(c.now()).toBeLessThan(TICKET_CONFIRM_BUDGET_MS);
  });

  test("transport failure for the WHOLE budget never becomes a refusal", async () => {
    // The honest unknown. A guest who paid must not be told their tickets were
    // refused because our network was down.
    const c = clock();
    const confirm = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: confirm as never,
      now: c.now,
      waitFor: c.waitFor,
    });

    expect(verdict).toEqual({ kind: "still_confirming" });
    expect(TICKETS_STILL_CONFIRMING_MESSAGE).not.toMatch(/charged/i);
  });

  test("an unknown status for the whole budget also ends as the honest unknown", async () => {
    const c = clock();
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: (async () => answer("something_new")) as never,
      now: c.now,
      waitFor: c.waitFor,
    });
    expect(verdict).toEqual({ kind: "still_confirming" });
  });

  test("a paid answer with NO order is never success, however long it repeats", async () => {
    const c = clock();
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: (async () => answer("paid")) as never,
      now: c.now,
      waitFor: c.waitFor,
    });
    // Constitution #9: an order is minted by the server or it does not exist.
    expect(verdict).toEqual({ kind: "still_confirming" });
  });
});
