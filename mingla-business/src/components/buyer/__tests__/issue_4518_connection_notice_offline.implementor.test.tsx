/**
 * issue #4518 follow-up — the notice works with NO network.
 *
 * The designed card is a lazy chunk (an enhancement). Here that chunk's
 * import REJECTS, exactly as it would for a buyer whose connection is gone
 * entirely. The eager plain notice must still show the approved copy, a
 * working Try again with its retrying state, and "Still can't connect" after
 * a failed retry: never a blank space or a dead tap (rule 1).
 *
 * FAILS ON REVERT: render nothing (or a Suspense `null`) until the chunk
 * arrives, or let a rejected import throw, and every case here fails.
 */
import React from "react";

jest.mock("../BuyerConnectionNoticeFull", () => {
  throw new Error("ChunkLoadError: Loading chunk BuyerConnectionNoticeFull failed");
});

// eslint-disable-next-line import/first
import { BuyerConnectionNotice, MIN_RETRY_MS } from "../BuyerConnectionNotice";
// eslint-disable-next-line import/first
import { BUYER_CONNECTION_COPY as COPY } from "../buyerConnectionCopy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
interface Found {
  props: Record<string, unknown>;
  children: unknown[];
}
interface Rendered {
  root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Found[] };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (r: Rendered, id: string): Found => {
  const hits = r.root.findAll((n) => n.props.testID === id && typeof n.type === "string");
  if (hits.length === 0) throw new Error(`no host node ${id}`);
  return hits[0];
};
const text = (n: unknown): string =>
  typeof n === "string"
    ? n
    : n !== null && typeof n === "object"
      ? ((n as { children?: unknown[] }).children ?? []).map(text).join("")
      : "";
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

describe("#4518 — the notice with no network (lazy chunk rejected)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("O-1 the plain notice shows the approved copy and Try again re-runs the read", async () => {
    let settle: () => void = () => undefined;
    const onRetry = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const onBack = jest.fn();
    let r: Rendered | null = null;
    await TestRenderer.act(async () => {
      r = TestRenderer.create(
        <BuyerConnectionNotice variant="connection" onRetry={onRetry} onBack={onBack} testID="n" />,
      );
      await flush();
    });
    const tree = r as unknown as Rendered;
    // The rejected chunk left the plain notice in place.
    expect(text(node(tree, "n-title"))).toBe(COPY.CONNECTION_TITLE);
    expect(text(node(tree, "n-body"))).toBe(COPY.CONNECTION_BODY);
    expect(node(tree, "n").props.accessibilityRole).toBe("alert");
    expect(text(node(tree, "n-retry"))).toBe(COPY.TRY_AGAIN);
    expect(node(tree, "n-retry").props.accessibilityLabel).toBe(COPY.TRY_AGAIN_A11Y);

    await TestRenderer.act(async () => {
      (node(tree, "n-retry").props.onPress as () => void)();
      await flush();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(text(node(tree, "n-retry"))).toBe(COPY.TRYING_AGAIN);
    expect(node(tree, "n-retry").props.accessibilityState).toEqual({ disabled: true, busy: true });

    await TestRenderer.act(async () => {
      settle();
      await flush();
      jest.advanceTimersByTime(MIN_RETRY_MS);
      await flush();
    });
    expect(text(node(tree, "n-title"))).toBe(COPY.STILL_TITLE);
    expect(text(node(tree, "n-retry"))).toBe(COPY.TRY_AGAIN);

    await TestRenderer.act(() => {
      (node(tree, "n-back").props.onPress as () => void)();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("O-2 server and access-check variants keep their own approved copy", async () => {
    for (const [variant, title, body] of [
      ["server", COPY.SERVER_TITLE, COPY.SERVER_BODY],
      ["accessCheck", COPY.CONNECTION_TITLE, COPY.ACCESS_CHECK_BODY],
    ] as const) {
      let r: Rendered | null = null;
      await TestRenderer.act(async () => {
        r = TestRenderer.create(<BuyerConnectionNotice variant={variant} onRetry={() => undefined} testID={variant} />);
        await flush();
      });
      const tree = r as unknown as Rendered;
      expect(text(node(tree, `${variant}-title`))).toBe(title);
      expect(text(node(tree, `${variant}-body`))).toBe(body);
    }
  });
});
