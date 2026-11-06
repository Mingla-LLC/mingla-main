/**
 * #4271 retest 4 — the tester's close-race probe (probe_P3A_P3B), committed by the
 * implementor for P3-A and P3-B: closing the sale (or switching to a pay code)
 * interleaved at EVERY await of every Tap to Pay path, with C6 (nothing rejects)
 * checked on the tap-beats-cancel cases. Red at d89caf40e4 (4 cases), green
 * after the P3-A fix.
 *
 * The builder's P2-1 tests hold the flow at five chosen points. This file does
 * not choose: it runs each path once to count its awaits (every server and SDK
 * call is a held promise), then reruns it once per await with the close
 * injected there, and resolves the held calls both oldest-first and
 * newest-first (so the close's own cancel can land before or after the call
 * the flow is waiting on).
 *
 * The fake server behaves like door-tap-intent + Stripe: a create replays the
 * intent for the same clientRequestId, a cancel needs the intent's request id
 * and is refused with payment_succeeded once Stripe charged it, a canceled
 * intent can't be collected or confirmed, and a confirm on an open intent
 * charges the card (the guest taps as soon as a collect opens).
 *
 * Paths: first create; stale replacement (cancel in flight, then create in
 * flight); try another card; a replayed create past the limit. Each runs
 * through retrieve, collect, confirm and complete.
 *
 * Invariants checked after every run:
 *   C1 no collect opens after closeSale / abandonForPayCode;
 *   C2 no intent is left open on the server (every one is canceled or paid);
 *   C3 at most one intent is ever charged;
 *   C4 a charge the host didn't see approved before closing is recorded and
 *      the host is alerted (onPaidAfterClose);
 *   C5 a pay-code switch ("switch") never coexists with a card charge, so a
 *      guest can't pay by card and by code (or cash);
 *   C6 nothing the flow runs rejects.
 *
 * fails-on-revert (retest 4, at d1d8391154): delete both `this.closed = true`
 * lines in tapToPayFlow.ts (closeSale and abandonForPayCode) -> C1/C2 fail on
 * every path; delete the `if (this.closed) { settleIntentAfterClose }` branch in
 * createIntent -> C1/C2 fail for the create points.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  TAP_READY_LIMIT_MS,
  TapToPaySaleFlow,
  type PayCodeSwitchOutcome,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
  type TerminalCallResult,
  type TerminalPaymentIntentLike,
} from "../tapToPayFlow";
import { DoorTapError, type DoorTapIntent } from "../doorTapEdge";
import type { TapToPayDraft } from "../tapToPayDraft";

jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const MIN = 60 * 1000;

const DRAFT: TapToPayDraft = {
  lines: [{ ticketTypeId: "tt_general", quantity: 1 }],
  eventDateId: "date_1",
  buyerPhone: null,
  phoneCountryIso: null,
} as unknown as TapToPayDraft;

type Row = { requestId: string; status: "open" | "canceled" | "succeeded" };
type Held = { name: string; settle: () => void };
type Order = "oldest" | "newest";
type CloseKind = "closeSale" | "payCode";
type Path = "first_create" | "stale_replacement" | "try_another_card" | "replayed_create";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

type WorldOptions = {
  /** The guest's card is read just as the tap is cancelled: the collect succeeds. */
  tapBeatsCancelCollect?: boolean;
  /** Every server cancel sent after the close fails with a lost connection. */
  cancelFailsAfterClose?: boolean;
};

const world = (opts: WorldOptions = {}) => {
  const rows = new Map<string, Row>();
  const byRequest = new Map<string, string>();
  const held: Held[] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  const states: { seq: number; state: TapSaleState }[] = [];
  const paidAfterClose: { saved: boolean }[] = [];
  const completed: string[] = [];
  let seq = 0;
  let made = 0;
  let loseNextCreateAnswer = false;
  let closedAtSeq = Number.POSITIVE_INFINITY;
  const collectScript: Array<"decline" | "tap"> = [];
  let activeCollect: { pi: string; resolve: (r: TerminalCallResult) => void } | null = null;

  const log = (line: string): number => {
    seq += 1;
    events.push(`${seq}:${line}`);
    return seq;
  };
  const hold = <T,>(name: string, outcome: () => T | Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      held.push({
        name,
        settle: () => {
          try {
            Promise.resolve(outcome()).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        },
      });
    });

  const createIntent = jest.fn<TapToPayServer["createIntent"]>((input) =>
    hold("create", () => {
      let id = byRequest.get(input.clientRequestId);
      if (id === undefined) {
        made += 1;
        id = `pi_${made}`;
        rows.set(id, { requestId: input.clientRequestId, status: "open" });
        byRequest.set(input.clientRequestId, id);
        log(`create:${id}`);
      } else {
        log(`replay:${id}`);
      }
      if (loseNextCreateAnswer) {
        loseNextCreateAnswer = false;
        throw new DoorTapError("network_error", "answer lost");
      }
      const intent: DoorTapIntent = {
        paymentIntentId: id,
        clientSecret: `${id}_secret`,
        totalCents: 3000,
        currency: "GBP",
        stripeAccountId: "acct_1",
        locationId: "tml_1",
      };
      return intent;
    }),
  );
  const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>((input) => {
    const sentAfterClose = seq >= closedAtSeq;
    return hold("cancel", () => {
      if (opts.cancelFailsAfterClose === true && sentAfterClose) {
        log(`cancel-lost:${input.paymentIntentId}`);
        throw new DoorTapError("network_error", "connection lost");
      }
      const row = rows.get(input.paymentIntentId);
      if (row === undefined || row.requestId !== input.clientRequestId) {
        log(`cancel-refused:${input.paymentIntentId}`);
        throw new DoorTapError("not_found", "no such intent for this request");
      }
      if (row.status === "succeeded") {
        log(`cancel-paid:${input.paymentIntentId}`);
        throw new DoorTapError("payment_succeeded", "paid");
      }
      row.status = "canceled";
      log(`cancel:${input.paymentIntentId}`);
    });
  });
  const completeIntent = jest.fn<TapToPayServer["completeIntent"]>((input) =>
    hold("complete", () => {
      const row = rows.get(input.paymentIntentId);
      if (row === undefined || row.status !== "succeeded" || row.requestId !== input.clientRequestId) {
        throw new DoorTapError("payment_not_succeeded", "nothing to record");
      }
      completed.push(input.paymentIntentId);
      log(`complete:${input.paymentIntentId}`);
      return { orderId: "ord_1", ticketIds: ["t1"], receiptQueued: true, replayed: false };
    }),
  );

  const idOf = (pi: TerminalPaymentIntentLike): string => String(pi.id);
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(() => hold("connect", () => ({}))),
    retrievePaymentIntent: jest.fn((secret: string) =>
      hold("retrieve", () => {
        const id = secret.replace(/_secret$/, "");
        const status = rows.get(id)?.status === "canceled" ? "canceled" : "requires_payment_method";
        return { paymentIntent: { id, status } } as TerminalCallResult;
      }),
    ),
    collectPaymentMethod: jest.fn((pi: TerminalPaymentIntentLike) => {
      log(`collect:${idOf(pi)}`);
      if (rows.get(idOf(pi))?.status !== "open") log(`collect-on-dead:${idOf(pi)}`);
      if ([...rows.values()].filter((row) => row.status === "open").length > 1) log("two-open");
      return new Promise<TerminalCallResult>((resolve) => {
        const entry = { pi: idOf(pi), resolve };
        activeCollect = entry;
        held.push({
          name: "collect",
          settle: () => {
            if (activeCollect !== entry) return; // already ended by cancelCollect
            activeCollect = null;
            if (rows.get(entry.pi)?.status === "canceled") {
              resolve({ error: { code: "STRIPE_API_ERROR", paymentIntent: { id: entry.pi, status: "canceled" } } });
              return;
            }
            const next = collectScript.shift() ?? "tap";
            if (next === "decline") {
              resolve({ error: { code: "DECLINED_BY_STRIPE_API" } });
              return;
            }
            log(`tapped:${entry.pi}`);
            resolve({ paymentIntent: { id: entry.pi, status: "requires_confirmation" } });
          },
        });
      });
    }),
    confirmPaymentIntent: jest.fn((pi: TerminalPaymentIntentLike) =>
      hold("confirm", () => {
        const row = rows.get(idOf(pi));
        if (row === undefined || row.status !== "open") {
          return { error: { code: "STRIPE_API_ERROR", paymentIntent: { id: idOf(pi), status: row?.status ?? "canceled" } } } as TerminalCallResult;
        }
        row.status = "succeeded";
        log(`charged:${idOf(pi)}`);
        return { paymentIntent: { id: idOf(pi), status: "succeeded" } } as TerminalCallResult;
      }),
    ),
    cancelCollectPaymentMethod: jest.fn(async () => {
      log("cancelCollect");
      const entry = activeCollect;
      activeCollect = null;
      if (entry !== null && opts.tapBeatsCancelCollect === true && rows.get(entry.pi)?.status === "open") {
        log(`tapped:${entry.pi}`);
        entry.resolve({ paymentIntent: { id: entry.pi, status: "requires_confirmation" } });
        return { error: { code: "CANCEL_FAILED" } };
      }
      entry?.resolve({ error: { code: "CANCELED" } });
      return {};
    }),
  };

  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft: DRAFT,
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    terminal,
    server: { createIntent, completeIntent, cancelIntent },
    onState: (state) => {
      seq += 1;
      states.push({ seq, state });
    },
    onPaidAfterClose: ({ saved }) => {
      paidAfterClose.push({ saved });
      log(`alert:${saved ? "saved" : "pending"}`);
    },
  });

  const run = (promise: Promise<unknown>): void => {
    promise.catch((error: unknown) => errors.push(error));
  };

  /** Resolves held calls one by one until nothing is left. Calls `at(i)` before the i-th. */
  const drain = async (order: Order, at?: (i: number) => void): Promise<number> => {
    let i = 0;
    for (let guard = 0; guard < 400; guard += 1) {
      await flush();
      if (held.length === 0) {
        await flush();
        if (held.length === 0) {
          at?.(i);
          await flush();
          if (held.length === 0) return i;
        }
      }
      at?.(i);
      await flush();
      const next = order === "oldest" ? held.shift() : held.pop();
      if (next === undefined) continue;
      next.settle();
      i += 1;
    }
    throw new Error("drain did not settle");
  };

  return {
    flow,
    rows,
    events,
    errors,
    states,
    paidAfterClose,
    completed,
    collectScript,
    run,
    drain,
    mark: (line: string): number => log(line),
    markClosed: (line: string): number => {
      closedAtSeq = log(line);
      return closedAtSeq;
    },
    loseNextCreateAnswer: () => {
      loseNextCreateAnswer = true;
    },
  };
};

type World = ReturnType<typeof world>;

/** Brings the flow to the point where the path's operation starts; returns that operation. */
const prepare = async (w: World, path: Path): Promise<() => Promise<void>> => {
  if (path === "first_create") return () => w.flow.start();
  if (path === "replayed_create") {
    w.loseNextCreateAnswer();
    w.run(w.flow.start());
    await w.drain("oldest");
    expect(w.flow.getState().kind).toBe("failed");
    jest.advanceTimersByTime(TAP_READY_LIMIT_MS + MIN);
    return () => w.flow.start();
  }
  // stale_replacement and try_another_card start from a declined card.
  w.collectScript.push("decline");
  w.run(w.flow.start());
  await w.drain("oldest");
  expect(w.flow.getState().kind).toBe("declined");
  if (path === "stale_replacement") jest.advanceTimersByTime(TAP_READY_LIMIT_MS + MIN);
  return () => w.flow.tryAnotherCard();
};

/** "Show a pay code instead" at a point the screen offers it; the pay code fails, so the tap screen reopens. */
const runReopen = async (path: Path, order: Order, pressAt: number): Promise<{ w: World; outcome: PayCodeSwitchOutcome | null }> => {
  const w = world();
  const op = await prepare(w, path);
  // The next card is declined, so the run reaches a state where the screen offers a pay code.
  w.collectScript.push("decline");
  let outcome: PayCodeSwitchOutcome | null = null;
  let pressed = false;
  w.run(op());
  await w.drain(order, (i) => {
    if (pressed || i < pressAt || !PAY_CODE_SHOWN.has(w.flow.getState().kind)) return;
    pressed = true;
    w.mark("payCode");
    w.run(
      w.flow.abandonForPayCode().then((result) => {
        outcome = result;
        w.mark(`paycode-${result}`);
        if (result === "switch") {
          w.flow.reopen();
          w.mark("reopen");
        }
      }),
    );
  });
  // The host presses the screen's retry once (whatever it offers now).
  const kind = w.flow.getState().kind;
  if (kind === "failed" || kind === "reader_problem") w.run(w.flow.start());
  else if (kind === "declined" || kind === "needs_pin" || kind === "timed_out" || kind === "cancelled") w.run(w.flow.tryAnotherCard());
  await w.drain(order);
  return { w, outcome };
};

const seqOf = (line: string): number => Number(line.split(":")[0]);
const named = (w: World, prefix: string): string[] =>
  w.events.filter((line) => line.split(":")[1] === prefix);

type Outcome = { closeSeq: number; payCode: PayCodeSwitchOutcome | null };

/** Where the screen offers "Show a pay code instead" (TapToPaySaleScreen renderBody). */
const PAY_CODE_SHOWN: ReadonlySet<TapSaleState["kind"]> = new Set<TapSaleState["kind"]>([
  "declined",
  "needs_pin",
  "timed_out",
  "cancelled",
  "reader_problem",
  "failed",
  "not_on_this_phone",
  "ios_update_required",
  "idle",
  "starting",
  // Not idle/starting: only the terminal-status and availability views offer it
  // then, while a start may still be in flight (retest 4 P3-B, kept as a probe).
]);

const runOnce = async (
  path: Path,
  kind: CloseKind,
  order: Order,
  closeAt: number | null,
  opts: WorldOptions = {},
): Promise<{ w: World; out: Outcome; steps: number }> => {
  const w = world(opts);
  const op = await prepare(w, path);
  const out: Outcome = { closeSeq: Number.POSITIVE_INFINITY, payCode: null };
  w.run(op());
  const steps = await w.drain(order, (i) => {
    if (closeAt === null || i < closeAt || out.closeSeq !== Number.POSITIVE_INFINITY) return;
    // The pay-code button only exists in some states: wait for one (or never press it).
    if (kind === "payCode" && !PAY_CODE_SHOWN.has(w.flow.getState().kind)) return;
    out.closeSeq = w.markClosed(kind);
    if (kind === "closeSale") {
      w.run(w.flow.closeSale());
    } else {
      w.run(
        w.flow.abandonForPayCode().then((result) => {
          out.payCode = result;
          w.mark(`paycode-${result}`);
        }),
      );
    }
  });
  return { w, out, steps };
};

const check = (
  w: World,
  out: Outcome,
  kind: CloseKind,
  label: string,
  opts: WorldOptions = {},
  checkErrors = true,
): void => {
  const where = `${label}\n${w.events.join("\n")}`;
  // C6
  if (checkErrors) expect({ where, errors: w.errors.map(String) }).toEqual({ where, errors: [] });
  // C1
  const lateCollects = named(w, "collect").filter((line) => seqOf(line) > out.closeSeq);
  expect({ where, lateCollects }).toEqual({ where, lateCollects: [] });
  const charged = [...w.rows.entries()].filter(([, row]) => row.status === "succeeded").map(([id]) => id);
  // C3
  expect({ where, charged: charged.length <= 1 }).toEqual({ where, charged: true });
  // C2: blocked (an unknown result) is the only state that may keep its intent open.
  if (out.payCode !== "blocked" && opts.cancelFailsAfterClose !== true) {
    const open = [...w.rows.entries()].filter(([, row]) => row.status === "open").map(([id]) => id);
    expect({ where, open }).toEqual({ where, open: [] });
  }
  if (charged.length === 1) {
    const approvedBeforeClose = w.states.some((entry) => entry.seq < out.closeSeq && entry.state.kind === "approved");
    // C4
    expect({ where, recorded: w.completed.includes(charged[0]) || w.paidAfterClose.some((p) => !p.saved) }).toEqual({ where, recorded: true });
    if (kind === "closeSale" && !approvedBeforeClose) {
      expect({ where, alerted: w.paidAfterClose.length }).toEqual({ where, alerted: 1 });
    }
    // C5
    expect({ where, payCode: out.payCode }).not.toEqual({ where, payCode: "switch" });
  }
};

describe("#4271 retest 4: close or pay code at every await of every tap path", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const PATHS: Path[] = ["first_create", "stale_replacement", "try_another_card", "replayed_create"];
  const KINDS: CloseKind[] = ["closeSale", "payCode"];
  const ORDERS: Order[] = ["oldest", "newest"];

  for (const path of PATHS) {
    for (const kind of KINDS) {
      for (const order of ORDERS) {
        test(`${path}: ${kind} at every await, held calls settle ${order}-first`, async () => {
          const dry = await runOnce(path, kind, order, null);
          // The uninterrupted run ends charged and recorded once.
          expect(dry.w.completed.length).toBe(1);
          expect(dry.steps).toBeGreaterThanOrEqual(path === "try_another_card" ? 3 : 5);
          for (let at = 0; at <= dry.steps; at += 1) {
            const { w, out } = await runOnce(path, kind, order, at);
            check(w, out, kind, `${path} ${kind} ${order} at=${at}`);
          }
        });
      }
    }
  }

  // The tap that lands as the host closes, and a close whose server cancel is
  // lost: the money may move, but it is recorded and the host is alerted.
  // C6 is checked too (retest 4 P3-A): a tap that beats the close must never
  // throw "tap flow: no intent" when its confirm answers after the close's cancel.
  const HARD: WorldOptions[] = [
    { tapBeatsCancelCollect: true },
    { cancelFailsAfterClose: true },
    { tapBeatsCancelCollect: true, cancelFailsAfterClose: true },
  ];
  for (const path of PATHS) {
    for (const opts of HARD) {
      test(`${path}: closeSale at every await with ${JSON.stringify(opts)}`, async () => {
        for (const order of ORDERS) {
          const dry = await runOnce(path, "closeSale", order, null, opts);
          for (let at = 0; at <= dry.steps; at += 1) {
            const { w, out } = await runOnce(path, "closeSale", order, at, opts);
            check(w, out, "closeSale", `${path} closeSale ${order} at=${at} ${JSON.stringify(opts)}`, opts, true);
          }
        }
      });
    }
  }

  test("the paths really pass through the awaits they claim (create, cancel, retrieve, collect, confirm)", async () => {
    const stale = await runOnce("stale_replacement", "closeSale", "oldest", null);
    const kinds = stale.w.events.map((line) => line.split(":")[1]);
    expect(kinds).toEqual(expect.arrayContaining(["create", "cancel", "collect", "tapped", "charged", "complete"]));
    expect(named(stale.w, "cancel")).toHaveLength(1);
    const replay = await runOnce("replayed_create", "closeSale", "oldest", null);
    expect(replay.w.events.map((line) => line.split(":")[1])).toEqual(
      expect.arrayContaining(["replay", "cancel", "create", "collect", "charged", "complete"]),
    );
    // The replayed (stale) intent is never collected.
    expect(named(replay.w, "collect").map((line) => line.split(":")[2])).toEqual(["pi_2"]);
  });
});
