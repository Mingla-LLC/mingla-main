// #1541 [SMS sole send path] — RENDER PROOF for the dark-market operator copy.
//
// ===========================================================================
// WHY THIS TEST EXISTS.
// ===========================================================================
// The edge fn returns 503 `sms_market_unavailable` and the hook throws a typed
// SmsMarketUnavailableError carrying the operator copy. Both were verified at
// their own layers. NEITHER PROVES THE OPERATOR EVER SEES IT.
//
// Before this change, VenueWaitlistModule rendered a HARDCODED string —
// "Couldn't send the text. Check the guest's phone number." — and never read
// `notify.error`. So a correctly-thrown, correctly-typed, correctly-worded
// message died one layer short of the screen, and the operator was told to go
// fix a phone number that was never the problem while their guest kept waiting.
//
// That is a SILENT FAILURE, which is the exact class this whole chain exists to
// eliminate (#1518 -> #1529 -> #1537 -> #1541). A message that cannot reach the
// human who needs it is not a message. So this test mounts the REAL component
// and asserts on the REAL rendered tree.
//
// It is deliberately built so it CANNOT pass vacuously:
//   - the expected copy is read from the hook's exported constant, never
//     retyped here, so the render and the contract cannot drift apart;
//   - the constant's literal wording is pinned ONCE, so "they both changed
//     together" is still caught;
//   - the type guard under test is `requireActual`'d, never mocked — mocking it
//     would make this test assert its own stub;
//   - a NEGATIVE CONTROL renders an ordinary Error and proves the generic copy
//     still wins, so the branch is genuinely conditional rather than the new
//     string being hardcoded in place of the old one;
//   - every case asserts the tree produced text nodes at all before asserting
//     what is in them (#1529 — a lookup that matches nothing proves nothing).
//
// fails-on-revert: restoring the hardcoded `<Text>` (deleting the
// isSmsMarketUnavailableError branch) makes T-1 and T-4 FAIL. T-2 correctly
// still passes under that revert — it is the control for the GENERIC path,
// which the revert does not change. Verified by running it, not by assuming it.
//
// NOTE: this file must NOT be named `*.render.test.tsx` — the default jest config
// blanket-ignores that suffix (those suites need dedicated RN+RTL configs). It is
// named `.operatorCopy.test.tsx` so it actually RUNS under the default config; a
// render proof that CI silently skips is the same dark-test problem as #1541 itself.
//
// Runs under the DEFAULT mingla-business jest config (node + ts-jest, with
// react-native mapped to __manual_mocks__/react-native.js), using
// react-test-renderer — the same in-config render pattern as
// GuestVenueReservationRequiredContact.issue1386.happy.test.tsx. No RTL needed.

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// --- The state each case puts the notify mutation in.
let notifyState: { isError: boolean; error: unknown } = {
  isError: false,
  error: null,
};

// The hook module is mocked ONLY for its hooks. `SmsMarketUnavailableError`,
// `isSmsMarketUnavailableError` and `SMS_MARKET_UNAVAILABLE_MESSAGE` come from
// requireActual — the guard and the copy under test are the REAL ones. Mocking
// them would leave this test asserting against its own fixture.
jest.mock("../../../hooks/useVenueWaitlist", () => {
  const actual = jest.requireActual(
    "../../../hooks/useVenueWaitlist",
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    ...actual,
    useVenueWaitlist: () => ({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
    useAddToWaitlist: () => ({ mutate: jest.fn(), isPending: false }),
    useConvertWaitlist: () => ({ mutate: jest.fn(), isPending: false }),
    useMarkWaitlistLost: () => ({ mutate: jest.fn(), isPending: false }),
    useNotifyWaitlist: () => ({
      mutate: jest.fn(),
      isPending: false,
      isError: notifyState.isError,
      error: notifyState.error,
    }),
  };
});

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  __esModule: true,
  useCurrentBrandRole: () => ({ rank: 60, role: "owner", isLoading: false }),
}));

const stub = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props?.children as never);
};

jest.mock("lucide-react-native", () => ({
  __esModule: true,
  Clock: stub("Clock"),
  MessageSquare: stub("MessageSquare"),
  X: stub("X"),
}));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: stub("Button") }));
jest.mock("../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: stub("GlassCard"),
}));
jest.mock("../WaitlistAddSheet", () => ({
  __esModule: true,
  WaitlistAddSheet: stub("WaitlistAddSheet"),
}));
jest.mock("../WaitlistConvertSheet", () => ({
  __esModule: true,
  WaitlistConvertSheet: stub("WaitlistConvertSheet"),
}));

interface TestRendererInstance {
  toJSON: () => unknown;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
  act: (cb: () => void | Promise<void>) => Promise<void>;
};

const {
  SmsMarketUnavailableError,
  SMS_MARKET_UNAVAILABLE_MESSAGE,
} = require("../../../hooks/useVenueWaitlist") as {
  SmsMarketUnavailableError: new () => Error;
  SMS_MARKET_UNAVAILABLE_MESSAGE: string;
};

const { VenueWaitlistModule } = require("../VenueWaitlistModule") as {
  VenueWaitlistModule: React.ComponentType<{
    brandId: string | null;
    venueId?: string | null;
  }>;
};

/** Every string the rendered tree actually contains. */
function renderedStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const c of node) renderedStrings(c, out);
    return out;
  }
  if (node !== null && typeof node === "object") {
    const children = (node as { children?: unknown }).children;
    if (children !== undefined && children !== null) renderedStrings(children, out);
  }
  return out;
}

async function renderModule(state: { isError: boolean; error: unknown }): Promise<
  { strings: string[]; unmount: () => Promise<void> }
> {
  notifyState = state;
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      React.createElement(VenueWaitlistModule, {
        brandId: "00000000-0000-4000-8000-0000000000b1",
        venueId: "00000000-0000-4000-8000-0000000000v1",
      }),
    );
  });
  const strings = renderedStrings(tree.toJSON());
  // unmount inside act() — React warns otherwise, and a test that prints
  // warnings trains readers to ignore its output.
  return {
    strings,
    unmount: async (): Promise<void> => {
      await TestRenderer.act(async () => {
        tree.unmount();
      });
    },
  };
}

const GENERIC_COPY = "Couldn't send the text. Check the guest's phone number.";

describe("#1541 — the dark-market message reaches the operator's screen", () => {
  test("T-0: the operator copy is exactly the wording the SPEC fixed", () => {
    // Pinned ONCE, here. Every other assertion in this file reads the constant,
    // so the render and the contract cannot drift — but this line means they
    // cannot drift TOGETHER either.
    expect(SMS_MARKET_UNAVAILABLE_MESSAGE).toBe(
      "Text not sent — SMS is switched off for this region. Let your guest know in person.",
    );
  });

  test("T-1: a dark-market skip RENDERS the real operator copy", async () => {
    const { strings, unmount } = await renderModule({
      isError: true,
      error: new SmsMarketUnavailableError(),
    });
    try {
      // Vacuity guard first (#1529): if the tree produced no text at all, every
      // assertion below would be about an empty set.
      expect(strings.length).toBeGreaterThan(0);
      expect(strings).toContain(SMS_MARKET_UNAVAILABLE_MESSAGE);
      // And the misleading advice is GONE — this is the half that proves the
      // branch switched rather than merely appended.
      expect(strings).not.toContain(GENERIC_COPY);
    } finally {
      await unmount();
    }
  });

  test("T-2: NEGATIVE CONTROL — an ordinary send failure still renders the generic copy", async () => {
    const { strings, unmount } = await renderModule({
      isError: true,
      error: new Error("sms_send_failed"),
    });
    try {
      expect(strings.length).toBeGreaterThan(0);
      expect(strings).toContain(GENERIC_COPY);
      // If this fired, the fix would have replaced one hardcoded string with
      // another and told every failing operator the region was switched off.
      expect(strings).not.toContain(SMS_MARKET_UNAVAILABLE_MESSAGE);
    } finally {
      await unmount();
    }
  });

  test("T-3: with no error, neither message renders", async () => {
    const { strings, unmount } = await renderModule({
      isError: false,
      error: null,
    });
    try {
      expect(strings.length).toBeGreaterThan(0);
      expect(strings).not.toContain(SMS_MARKET_UNAVAILABLE_MESSAGE);
      expect(strings).not.toContain(GENERIC_COPY);
    } finally {
      await unmount();
    }
  });

  test("T-4: a duplicated module instance cannot downgrade the message", async () => {
    // `instanceof` is the primary test, but a bundler split or hot reload can
    // produce a structurally identical error from a DIFFERENT class object. The
    // `code` discriminator is the fallback, and this proves it is load-bearing
    // rather than decorative.
    const foreign = Object.assign(
      new Error(SMS_MARKET_UNAVAILABLE_MESSAGE),
      { code: "sms_market_unavailable" },
    );
    const { strings, unmount } = await renderModule({
      isError: true,
      error: foreign,
    });
    try {
      expect(strings.length).toBeGreaterThan(0);
      expect(strings).toContain(SMS_MARKET_UNAVAILABLE_MESSAGE);
      expect(strings).not.toContain(GENERIC_COPY);
    } finally {
      await unmount();
    }
  });
});
