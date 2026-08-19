/**
 * issue #2323 — a bought ticket must reach the app, and a FREE one never did.
 *
 * ─── THE MEASUREMENT THIS SUITE ENCODES ─────────────────────────────────────
 *
 * Production, 2026-08-19. The founder reserved a free two-day ticket
 * (order 0485b385-…, session 72f19024-… `free_completed`), installed Explorer,
 * verified the SAME phone that is on the order, and the ticket was not there.
 *
 *   orders.attendance_identity_claim_armed_at → NULL
 *   attendance_claim_deliveries for the order → 0
 *   free_completed orders 9 → armed 0
 *   paid_completed orders 5 → armed 1   (the one created after #2241)
 *
 * Instrumented on the DEPLOYED confirmation screen — desktop Chrome and a real
 * Samsung Galaxy A72 on Chrome 151, both against
 * host.usemingla.com/checkout/2b05b5df-…/confirm holding a completed free
 * order — the count of `attendance-claim-link` requests was ZERO. The screen
 * never asked. `#2241` had already made the function reachable; nothing on the
 * free path ever called it.
 *
 * Cause: both former call sites hung off the PAID Stripe return leg (`?cs=`),
 * and a free reservation arrives at /confirm with no query string at all.
 *
 * ─── FAILS-ON-REVERT ────────────────────────────────────────────────────────
 *
 * F-1  Drop `buyerStatusToken` from the free path's `recordResult(...)`
 *      → "a free order with no query string still mints" fails (nothing to
 *      mint with), and so does the founder-shaped end-to-end case.
 * F-2  Move the mint back behind an arrival-path condition
 *      → "the mint does not depend on how the screen was reached" fails.
 * F-3  Accept a sessionStorage entry without matching the checkout session
 *      → "a stale resume payload for a DIFFERENT checkout authorises nothing"
 *      fails. That check is the security floor of the storage fallback.
 * F-4  Re-arm on every render → "exactly one mint per checkout session" fails.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/**
 * `react-test-renderer` ships no type declarations and `@types/react-test-renderer`
 * is not installed; package manifests are do-not-touch on this issue. A plain
 * `import` would add TS7016 to the repo-wide baseline the #1403 delta ratchet
 * watches. Same `require`-with-a-local-interface shape
 * `composerBandContract.issue2262.render.test.tsx` uses, for the same reason.
 */
interface RenderNode {
  type: unknown;
  props: Record<string, unknown> & { testID?: string; onPress?: () => void; children?: unknown };
  children: unknown[];
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void;
};
const act = TestRenderer.act as (cb: () => void | Promise<void>) => void;


const mockCreateAttendanceClaimLink = jest.fn();

jest.mock("../../services/attendanceClaimLinkService", () => ({
  __esModule: true,
  createAttendanceClaimLink: (...args: unknown[]) =>
    (mockCreateAttendanceClaimLink as unknown as (...a: unknown[]) => unknown)(...args),
}));

const createAttendanceClaimLink = mockCreateAttendanceClaimLink;

import {
  resolveBuyerStatusToken,
  useAttendanceClaimArm,
  type AttendanceClaimArm,
  type AttendanceClaimOrder,
  type AttendanceClaimPhase,
} from "../useAttendanceClaimArm";
import { checkoutResumeStorageKey } from "../../components/checkout/checkoutPersistence";

// The founder's real order, in the shape `buyer.tsx` hands to `recordResult`
// on the FREE path: an order id, the checkout session, the possession proof —
// and no URL, no query string, no sessionStorage anywhere near it.
const FREE_ORDER: AttendanceClaimOrder = {
  checkoutSessionId: "72f19024-be21-435d-92fd-5e0efab34fdf",
  buyerStatusToken: "free-path-possession-proof",
};
const EVENT_ID = "2b05b5df-b8a0-4192-beb6-bc16111a2d85";

const MINTED = {
  ok: true as const,
  kind: "order" as const,
  eventId: EVENT_ID,
  sourceId: "0485b385-2631-4059-b4c5-329bacfd836c",
  webClaimUrl: "https://host.usemingla.com/attendance/claim#v=1",
  appClaimUrl: "com.mingla.app.v2://attendance-claim#v=1",
};

/**
 * The shape `attendanceClaimLinkService` throws: an Error carrying a bounded
 * `code`. Declared once, at module scope, so every case constructs the same
 * class the hook's `error instanceof Error && "code" in error` guard reads.
 */
class ClaimError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const fakeStorage = (entries: Record<string, string>): Storage =>
  ({
    getItem: (k: string) => (k in entries ? entries[k] : null),
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  }) as unknown as Storage;

/** Mount the hook and hand back its live value. */
const mountArm = async (
  order: AttendanceClaimOrder | null,
  eventId: string | null,
): Promise<{ current: () => AttendanceClaimArm; rerender: (o: AttendanceClaimOrder | null) => Promise<void> }> => {
  let latest: AttendanceClaimArm | null = null;
  const Probe = ({ o }: { o: AttendanceClaimOrder | null }): null => {
    latest = useAttendanceClaimArm(o, eventId);
    return null;
  };
  let renderer: RenderTree | null = null;
  await (act as unknown as (cb: () => Promise<void>) => Promise<void>)(async () => {
    renderer = TestRenderer.create(<Probe o={order} />);
  });
  return {
    current: () => latest as AttendanceClaimArm,
    rerender: async (o) => {
      await (act as unknown as (cb: () => Promise<void>) => Promise<void>)(async () => {
        (renderer as unknown as RenderTree).update(<Probe o={o} />);
      });
    },
  };
};

beforeEach(() => {
  createAttendanceClaimLink.mockReset();
  (createAttendanceClaimLink as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue(MINTED);
});

describe("#2323 — the mint is driven by the ORDER, not by the arrival path", () => {
  test("a free order that arrived with no query string still mints its claim", async () => {
    const arm = await mountArm(FREE_ORDER, EVENT_ID);
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
    expect(createAttendanceClaimLink).toHaveBeenCalledWith(
      FREE_ORDER.checkoutSessionId,
      FREE_ORDER.buyerStatusToken,
    );
    expect(arm.current().phase).toBe("ready");
    expect(arm.current().link?.appClaimUrl).toBe(MINTED.appClaimUrl);
  });

  test("the mint does not depend on how the screen was reached", async () => {
    // No `?cs=`, no realtime subscription, no resume payload — the three things
    // the old call sites required. The order alone is enough.
    const arm = await mountArm(FREE_ORDER, null);
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
    expect(arm.current().phase).toBe("ready");
  });

  test("exactly one mint per checkout session, however often the screen renders", async () => {
    const arm = await mountArm(FREE_ORDER, EVENT_ID);
    await arm.rerender({ ...FREE_ORDER });
    await arm.rerender({ ...FREE_ORDER });
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
  });

  test("no order means no mint — the screen is not yet holding a ticket", async () => {
    await mountArm(null, EVENT_ID);
    expect(createAttendanceClaimLink).not.toHaveBeenCalled();
  });

  test("a mint failure degrades to a phase, never to a thrown render", async () => {
    (createAttendanceClaimLink as unknown as { mockRejectedValue: (v: unknown) => void })
      .mockRejectedValue(new ClaimError("rate_limited"));
    const arm = await mountArm(FREE_ORDER, EVENT_ID);
    expect(arm.current().phase).toBe("rate");
    expect(arm.current().link).toBeNull();
  });
});

describe("#871 — every observed finalization still mints, through the ONE owner", () => {
  // #871 pinned mint-on-sync, mint-on-realtime and mint-on-retry by counting
  // `prepareAttendanceClaim` occurrences in each confirmation route. #2323
  // replaced those three per-route copies with this hook, so the guarantee is
  // re-proven here by EXECUTION rather than by counting an identifier — and
  // #871's route assertions now pin the reachability that feeds it (that every
  // finalization path puts the possession proof on the order).

  test("SYNC — the ?cs= confirm leg mints as soon as it records the order", async () => {
    // `recordResult({… buyerStatusToken: payload.buyerStatusToken})` is the
    // whole of that leg's contribution; the mint follows from the result.
    const arm = await mountArm(
      { checkoutSessionId: "sync-session", buyerStatusToken: "sync-proof" },
      EVENT_ID,
    );
    expect(createAttendanceClaimLink).toHaveBeenCalledWith("sync-session", "sync-proof");
    expect(arm.current().phase).toBe("ready");
  });

  test("REALTIME — an order that only lands via the webhook backup still mints", async () => {
    // The realtime leg starts with NO result at all (the screen is showing
    // "Confirming your tickets…"), then `onOrderReady` records the order with
    // `pendingSession`'s proof.
    const arm = await mountArm(null, EVENT_ID);
    expect(createAttendanceClaimLink).not.toHaveBeenCalled();
    await arm.rerender({ checkoutSessionId: "rt-session", buyerStatusToken: "rt-proof" });
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
    expect(createAttendanceClaimLink).toHaveBeenCalledWith("rt-session", "rt-proof");
    expect(arm.current().phase).toBe("ready");
  });

  test("RETRY — a transient failure can be re-minted with the same authority", async () => {
    (createAttendanceClaimLink as unknown as { mockRejectedValueOnce: (v: unknown) => void })
      .mockRejectedValueOnce(new Error("network"));
    const arm = await mountArm(FREE_ORDER, EVENT_ID);
    expect(arm.current().phase).toBe("error");
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
    await act(async () => {
      arm.current().retry();
    });
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(2);
    expect(createAttendanceClaimLink).toHaveBeenNthCalledWith(
      2,
      FREE_ORDER.checkoutSessionId,
      FREE_ORDER.buyerStatusToken,
    );
    expect(arm.current().phase).toBe("ready");
  });

  test("retry before any authority exists is inert, never a throw", async () => {
    const arm = await mountArm(null, EVENT_ID);
    await act(async () => {
      arm.current().retry();
    });
    expect(createAttendanceClaimLink).not.toHaveBeenCalled();
  });

  test("a SECOND checkout on the same screen mints again — the guard is per session", async () => {
    const arm = await mountArm(FREE_ORDER, EVENT_ID);
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(1);
    await arm.rerender({ checkoutSessionId: "second-session", buyerStatusToken: "second-proof" });
    expect(createAttendanceClaimLink).toHaveBeenCalledTimes(2);
    expect(createAttendanceClaimLink).toHaveBeenNthCalledWith(2, "second-session", "second-proof");
  });

  test("every terminal phase is reachable and none of them withholds the card", async () => {
    const cases: Array<[string, AttendanceClaimPhase]> = [
      ["rate_limited", "rate"],
      ["invalid", "terminal"],
      ["ineligible", "terminal"],
      ["network", "error"],
    ];
    for (const [code, phase] of cases) {
      createAttendanceClaimLink.mockReset();
      (createAttendanceClaimLink as unknown as { mockRejectedValue: (v: unknown) => void })
        .mockRejectedValue(new ClaimError(code));
      const arm = await mountArm(
        { checkoutSessionId: "phase-" + code, buyerStatusToken: "proof" },
        EVENT_ID,
      );
      expect(arm.current().phase).toBe(phase);
      expect(arm.current().link).toBeNull();
    }
  });
});

describe("#2323 — resolving the possession proof", () => {
  test("the token carried on the order is used verbatim", () => {
    expect(resolveBuyerStatusToken(FREE_ORDER, EVENT_ID, undefined)).toEqual({
      sessionId: FREE_ORDER.checkoutSessionId,
      token: FREE_ORDER.buyerStatusToken,
    });
  });

  test("an order with no checkout session cannot be armed at all", () => {
    expect(resolveBuyerStatusToken({ buyerStatusToken: "t" }, EVENT_ID, undefined)).toBeNull();
  });

  test("the #2150 resume payload is the fallback when the order carries no token", () => {
    const storage = fakeStorage({
      [checkoutResumeStorageKey(EVENT_ID)]: JSON.stringify({
        checkoutSessionId: FREE_ORDER.checkoutSessionId,
        buyerStatusToken: "from-session-storage",
        lines: [],
        buyer: { name: "", email: "", phone: "", marketingOptIn: false },
      }),
    });
    expect(
      resolveBuyerStatusToken({ checkoutSessionId: FREE_ORDER.checkoutSessionId }, EVENT_ID, storage),
    ).toEqual({ sessionId: FREE_ORDER.checkoutSessionId, token: "from-session-storage" });
  });

  test("a stale resume payload for a DIFFERENT checkout authorises nothing", () => {
    // The security floor of the storage fallback: a token proves possession of
    // the checkout it was issued for and of no other.
    const storage = fakeStorage({
      [checkoutResumeStorageKey(EVENT_ID)]: JSON.stringify({
        checkoutSessionId: "a-completely-different-session",
        buyerStatusToken: "someone-elses-proof",
        lines: [],
        buyer: { name: "", email: "", phone: "", marketingOptIn: false },
      }),
    });
    expect(
      resolveBuyerStatusToken({ checkoutSessionId: FREE_ORDER.checkoutSessionId }, EVENT_ID, storage),
    ).toBeNull();
  });

  test("the carried token WINS over storage — native has no storage at all", () => {
    const storage = fakeStorage({
      [checkoutResumeStorageKey(EVENT_ID)]: JSON.stringify({
        checkoutSessionId: FREE_ORDER.checkoutSessionId,
        buyerStatusToken: "stale-storage-copy",
        lines: [],
        buyer: { name: "", email: "", phone: "", marketingOptIn: false },
      }),
    });
    expect(resolveBuyerStatusToken(FREE_ORDER, EVENT_ID, storage)?.token).toBe(
      FREE_ORDER.buyerStatusToken,
    );
  });
});
