// MINGLA-INVARIANT: I-FAILED-READ-IS-NOT-A-NO | issue #4518 | on a buyer page paid supply is closed only when the server answered that the brand cannot collect; a request that never got an answer is retried and then resolves bookable, with the checkout re-check as the backstop.
/**
 * issue #4518 N2 — a failed read is not "the organizer is finishing payment
 * setup".
 *
 * FAILS ON REVERT: restore `if (error !== null) return false` and B-1, B-2 and
 * B-7 fail (a dropped connection closes the sale and blames the host).
 */
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const queue: RpcResult[] = [];
const rpc = jest.fn(async (): Promise<RpcResult> => {
  const next = queue.shift();
  if (next === undefined) throw new Error("unexpected rpc call");
  return next;
});

jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) } }));

import {
  bookableFromCanCollect,
  isTransportFailure,
  readBrandCanCollect,
  resolveOfferingBookable,
} from "../brandCanCollect";
import { resolveOfferingCta } from "@mingla/offering-rendering/offeringCta";

const DROPPED: RpcResult = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
const SERVER_ERROR: RpcResult = { data: null, error: { code: "42501", message: "permission denied" } };
const NO_DELAY = [0, 0] as const;

beforeEach(() => {
  queue.length = 0;
  rpc.mockClear();
});

describe("#4518 — three answers, not two", () => {
  test("B-1 a connection that never answers is retried, then is UNKNOWN (never NO)", async () => {
    queue.push(DROPPED, DROPPED, DROPPED);
    expect(await readBrandCanCollect("brand-1", NO_DELAY)).toBe("unknown");
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  test("B-2 a blip that recovers on the retry is YES", async () => {
    queue.push(DROPPED, { data: true, error: null });
    expect(await readBrandCanCollect("brand-1", NO_DELAY)).toBe("yes");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  test("B-3 the server saying false is NO, first time, no retry", async () => {
    queue.push({ data: false, error: null });
    expect(await readBrandCanCollect("brand-1", NO_DELAY)).toBe("no");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test("B-4 the server answering with its own error stays closed (NO), no retry", async () => {
    queue.push(SERVER_ERROR);
    expect(await readBrandCanCollect("brand-1", NO_DELAY)).toBe("no");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  test("B-5 only a codeless error is a transport failure", () => {
    expect(isTransportFailure({ code: "", message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isTransportFailure({ message: "Load failed" })).toBe(true);
    expect(isTransportFailure({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isTransportFailure(null)).toBe(false);
  });
});

describe("#4518 — what the buyer is shown", () => {
  test("B-6 free offerings never ask; an answer carried by the page bundle is used as is", async () => {
    expect(await resolveOfferingBookable("brand-1", false)).toBe(true);
    expect(await resolveOfferingBookable("brand-1", true, true)).toBe(true);
    expect(await resolveOfferingBookable("brand-1", true, false)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("B-7 unknown resolves BOOKABLE; only a server NO closes the sale", () => {
    expect(bookableFromCanCollect("yes")).toBe(true);
    expect(bookableFromCanCollect("unknown")).toBe(true);
    expect(bookableFromCanCollect("no")).toBe(false);
  });

  test("B-8 the payment-setup message is reachable ONLY from a server NO", () => {
    const cta = (bookable: boolean) =>
      resolveOfferingCta({
        variant: "published",
        bookable,
        tickets: [
          { id: "t", name: "Single", isFree: false, priceGbp: 60000, currency: "NGN", availableAt: "online" } as never,
        ],
        currency: "NGN",
      });
    const closed = cta(bookableFromCanCollect("no"));
    expect(closed).toMatchObject({
      kind: "unavailable",
      title: "Booking unavailable",
      subline: "The organizer is finishing payment setup.",
    });
    const dropped = cta(bookableFromCanCollect("unknown"));
    expect(JSON.stringify(dropped)).not.toContain("finishing payment setup");
    expect(JSON.stringify(dropped)).not.toContain("Booking unavailable");
  });
});
