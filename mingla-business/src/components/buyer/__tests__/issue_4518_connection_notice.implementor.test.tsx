// MINGLA-INVARIANT: I-BUYER-ONE-CONNECTION-NOTICE | issue #4518 | buyer page and checkout load failures caused by the connection render the one connection notice with a working Try again and never raw error text or wording that blames the host.
/**
 * issue #4518 follow-up — one honest "couldn't connect" notice.
 *
 * Proves: the classifier (`isConnectionFailure`), the notice's states (idle →
 * "Trying again…" disabled + busy in the same render as the tap → "Still can't
 * connect"), the restricted-sale notice (testIDs kept, retry re-reads), every
 * route's error branch (source: the notice, the variant by error type, a
 * refetch, no raw `error.message`), the Pay-step mapping, and the copy.
 *
 * FAILS ON REVERT: restore any old error block ("Event could not load",
 * "Couldn't load trip" + raw message, "Tickets could not load", …) and its
 * route case in R-1 fails; drop the Pay-step mapping and P-1 fails; drop the
 * notice from TicketCheckoutAccessNotice and A-1 fails.
 */
import fs from "node:fs";
import path from "node:path";

import React from "react";

import { isConnectionFailure } from "../../../services/connectionFailure";
import { BUYER_CONNECTION_COPY as COPY } from "../buyerConnectionCopy";
import { BuyerConnectionNotice, MIN_RETRY_MS } from "../BuyerConnectionNotice";

const mockAccess = {
  state: "error" as string,
  retry: jest.fn(),
};
jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => mockAccess,
}));
jest.mock("react-native-svg", () => {
  const Leaf = (): null => null;
  return { __esModule: true, default: Leaf, Svg: Leaf, Path: Leaf, Circle: Leaf };
});

// eslint-disable-next-line import/first
import { TicketCheckoutAccessNotice } from "../../event/TicketCheckoutAccessNotice";

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
  root: {
    findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => Found[];
  };
  unmount: () => void;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUSINESS = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BUSINESS, rel), "utf8");

const byTestId = (r: Rendered, id: string): Found => {
  const hits = r.root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
  const all = hits.length > 0 ? hits : r.root.findAll((n) => n.props.testID === id);
  if (all.length === 0) throw new Error(`no node ${id}`);
  return all[0];
};
const textOf = (node: Found): string => {
  const walk = (n: unknown): string => {
    if (typeof n === "string") return n;
    if (n === null || typeof n !== "object") return "";
    const kids = (n as { children?: unknown[] }).children ?? [];
    return kids.map(walk).join("");
  };
  return walk(node);
};

describe("#4518 isConnectionFailure — one classifier", () => {
  test.each([
    ["fetch TypeError (Chrome)", new TypeError("Failed to fetch"), true],
    ["fetch TypeError (Safari)", new TypeError("Load failed"), true],
    ["abort", Object.assign(new Error("aborted"), { name: "AbortError" }), true],
    ["timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), true],
    ["edge lane fetch", Object.assign(new Error("x"), { name: "FunctionsFetchError" }), true],
    ["checkout re-thrown transport", new Error("Failed to send a request to the Edge Function"), true],
    ["checkout time limit", new Error("checkout_request_timed_out"), true],
    ["PostgREST no code", { code: "", message: "TypeError: Failed to fetch" }, true],
    ["PostgREST message only", { message: "Load failed" }, true],
    ["PostgREST server code", { code: "42501", message: "permission denied" }, false],
    ["edge HTTP refusal", Object.assign(new Error("Edge Function returned a non-2xx status code"), { status: 409 }), false],
    ["program TypeError", new TypeError("Cannot read properties of undefined"), false],
    ["program Error", new Error("invalid_trip_checkout_bundle"), false],
    ["null", null, false],
    ["string", "Failed to fetch", false],
  ])("%s", (_label, error, expected) => {
    expect(isConnectionFailure(error)).toBe(expected);
  });
});

describe("#4518 BuyerConnectionNotice — states", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const mount = async (element: React.ReactElement): Promise<Rendered> => {
    let r: Rendered | null = null;
    await TestRenderer.act(() => {
      r = TestRenderer.create(element);
    });
    return r as unknown as Rendered;
  };

  test("N-1 idle: connection copy, Try again with its a11y label, Back when given", async () => {
    const onBack = jest.fn();
    const r = await mount(
      <BuyerConnectionNotice variant="connection" onRetry={() => undefined} onBack={onBack} testID="n" />,
    );
    expect(textOf(byTestId(r, "n-title"))).toBe(COPY.CONNECTION_TITLE);
    expect(textOf(byTestId(r, "n-body"))).toBe(COPY.CONNECTION_BODY);
    const retry = byTestId(r, "n-retry");
    expect(retry.props.accessibilityLabel).toBe(COPY.TRY_AGAIN_A11Y);
    expect(retry.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(textOf(retry)).toBe(COPY.TRY_AGAIN);
    await TestRenderer.act(() => {
      (byTestId(r, "n-back").props.onPress as () => void)();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
    const live = r.root.findAll((n) => n.props.testID === "n" && n.props.accessibilityRole !== undefined);
    expect(live.length).toBeGreaterThan(0);
    expect(live[0].props.accessibilityRole).toBe("alert");
    expect(live[0].props.accessibilityLiveRegion).toBe("polite");
  });

  test("N-2 server variant says something went wrong, never 'check your signal'", async () => {
    const r = await mount(<BuyerConnectionNotice variant="server" onRetry={() => undefined} testID="s" />);
    expect(textOf(byTestId(r, "s-title"))).toBe(COPY.SERVER_TITLE);
    expect(textOf(byTestId(r, "s-body"))).toBe(COPY.SERVER_BODY);
    expect(textOf(byTestId(r, "s-body"))).not.toMatch(/signal/i);
  });

  test("N-3 Try again → 'Trying again…' at once, disabled + busy, one retry; failure → 'Still can't connect'", async () => {
    let settle: (() => void) | null = null;
    const onRetry = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const r = await mount(<BuyerConnectionNotice variant="connection" onRetry={onRetry} testID="n" />);
    await TestRenderer.act(() => {
      (byTestId(r, "n-retry").props.onPress as () => void)();
    });
    const busy = byTestId(r, "n-retry");
    expect(textOf(busy)).toBe(COPY.TRYING_AGAIN);
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    // A second tap while retrying is ignored (no double request).
    await TestRenderer.act(() => {
      (byTestId(r, "n-retry").props.onPress as () => void)();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => {
      (settle as unknown as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Held at least MIN_RETRY_MS so a fast failure still reads as a retry.
    expect(textOf(byTestId(r, "n-retry"))).toBe(COPY.TRYING_AGAIN);
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(MIN_RETRY_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(byTestId(r, "n-retry"))).toBe(COPY.TRY_AGAIN);
    expect(textOf(byTestId(r, "n-title"))).toBe(COPY.STILL_TITLE);
    expect(textOf(byTestId(r, "n-body"))).toBe(COPY.CONNECTION_BODY);
  });

  test("N-4 a retry that throws still returns to idle (no stuck spinner)", async () => {
    const onRetry = jest.fn(() => Promise.reject(new Error("x")));
    const r = await mount(<BuyerConnectionNotice variant="connection" onRetry={onRetry} testID="n" />);
    await TestRenderer.act(async () => {
      (byTestId(r, "n-retry").props.onPress as () => void)();
      await Promise.resolve();
    });
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(MIN_RETRY_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(byTestId(r, "n-retry"))).toBe(COPY.TRY_AGAIN);
  });
});

describe("#4518 restricted-sale notice (N-8)", () => {
  test("A-1 error state is the access-check notice; testIDs kept; Try again re-reads", async () => {
    mockAccess.retry.mockReset();
    let r: Rendered | null = null;
    await TestRenderer.act(() => {
      r = TestRenderer.create(<TicketCheckoutAccessNotice eventId="e-1" />);
    });
    const rendered = r as unknown as Rendered;
    const root = byTestId(rendered, "issue-2101-checkout-access-notice-error");
    expect(textOf(root)).toContain(COPY.ACCESS_CHECK_BODY);
    expect(textOf(root)).not.toMatch(/couldn.t check this sale|Buying is paused/);
    const retry = byTestId(rendered, "issue-2101-checkout-access-notice-retry");
    await TestRenderer.act(() => {
      (retry.props.onPress as () => void)();
    });
    expect(mockAccess.retry).toHaveBeenCalledTimes(1);
  });
});

describe("#4518 every buyer route's load failure uses the one notice (SC-8)", () => {
  const ROUTES: [string, string, RegExp[]][] = [
    ["app/e/[brandSlug]/[eventSlug].tsx", "publicEventQuery", [/Event could not load/, /Refresh this page/]],
    ["app/t/[brandSlug]/[tripSlug].tsx", "query", [/Couldn&rsquo;t load trip/, /errorMessage/]],
    ["app/exp/[brandSlug]/[experienceSlug].tsx", "query", [/Couldn&rsquo;t load experience/, /errorMessage/]],
    ["app/b/[brandSlug]/index.tsx", "publicBrandQuery", [/Brand could not load/, /Refresh this page/]],
    ["app/checkout/[eventId]/index.tsx", "publicEventQuery", [/Tickets could not load/]],
    ["app/checkout-trip/[tripEventId]/index.tsx", "publicTripQuery", [/Trip couldn't load/]],
    ["app/checkout-experience/[experienceEventId]/index.tsx", "query", [/Experience couldn't load/]],
  ];

  test.each(ROUTES)("R-1 %s", (rel, query, oldCopy) => {
    const src = read(rel);
    expect(src).toContain("<BuyerConnectionNotice");
    expect(src).toContain(`variant={isConnectionFailure(${query}.error) ? "connection" : "server"}`);
    expect(src).toContain(`onRetry={() => ${query}.refetch()}`);
    for (const old of oldCopy) expect(src).not.toMatch(old);
    // No raw error text reaches the buyer.
    expect(src).not.toMatch(/\{\s*errorMessage\s*\}/);
    expect(src).not.toMatch(/error\.message\s*\}/);
  });

  test("R-2 checkout steps keep Back beside Try again", () => {
    for (const rel of ROUTES.slice(4).map(([r]) => r)) {
      expect(read(rel)).toMatch(/<BuyerConnectionNotice[\s\S]{0,300}onBack=\{handleBack\}/);
    }
  });
});

describe("#4518 Pay step (N-9, SC-10)", () => {
  test.each([
    "app/checkout/[eventId]/payment.tsx",
    "app/checkout-trip/[tripEventId]/payment.tsx",
    "app/checkout-experience/[experienceEventId]/payment.tsx",
  ])("P-1 %s maps only a connection failure to the connection message", (rel) => {
    const src = read(rel);
    expect(src).toMatch(
      /const message = isConnectionFailure\(error\)\s*\?\s*BUYER_CONNECTION_COPY\.PAYMENT_CONNECTION_ERROR\s*:\s*error instanceof Error\s*\?\s*error\.message/,
    );
  });
});

describe("#4518 copy (SC-12)", () => {
  const BANNED = /insecure|secure|organi[sz]er|\bhost\b|payment setup/i;
  test("C-1 no notice wording blames the host or says insecure", () => {
    for (const value of Object.values(COPY)) expect(value).not.toMatch(BANNED);
    const sources = [
      read("src/components/buyer/buyerConnectionCopy.ts"),
      read("src/components/buyer/BuyerConnectionNotice.tsx"),
    ];
    // String literals only (comments may name the rule they follow).
    for (const src of sources) {
      const literals = src.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
      for (const literal of literals) expect(literal).not.toMatch(BANNED);
    }
  });

  test("C-2 the approved words", () => {
    expect(COPY.CONNECTION_TITLE).toBe("We couldn’t connect");
    expect(COPY.STILL_TITLE).toBe("Still can’t connect");
    expect(COPY.CONNECTION_BODY).toBe(
      "Your connection looks weak or unstable. Check your signal or Wi‑Fi, then try again.",
    );
    expect(COPY.PAYMENT_CONNECTION_ERROR).toBe(`${COPY.CONNECTION_TITLE}. ${COPY.CONNECTION_BODY}`);
    expect(COPY.ACCESS_CHECK_BODY).toMatch(/or Wi‑Fi, then try again\.$/);
    expect(COPY.TRYING_AGAIN).toBe("Trying again…");
  });
});
