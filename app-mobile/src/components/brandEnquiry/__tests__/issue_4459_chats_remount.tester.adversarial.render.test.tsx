/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4459 tester retest — the booking card's "Open guest chat" / "Rejoin guest
 * chat" calls router.replace({ pathname: "/", params: { tab: "messages" } }).
 * When the Chats tab was already mounted, a second home screen mounts on top
 * of the first, so TWO Chats pages (useMyEnquiryRows) are alive at once. With
 * supabase-js 2.103 the second `.channel("explorer-enquiries:<user>")` returns
 * the first, already-subscribed channel and `.on(...)` throws. On device
 * (iOS sim, retest 2026-11-17) this is an ErrorBoundary crash every time.
 *
 * Asserts: two Chats pages for the same user can be mounted together, and a
 * remount right after an unmount (removeChannel is async in supabase-js) does
 * not throw either.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// supabase-js 2.103 channel semantics: one channel object per topic until the
// async removeChannel completes; adding callbacks after subscribe() throws.
const mockChannels = new Map<string, { subscribed: boolean }>();
const mockPendingRemovals: Array<() => void> = [];
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      throw new Error("unexpected direct table read in this suite");
    },
    channel: (topic: string) => {
      let state = mockChannels.get(topic);
      if (state === undefined) {
        state = { subscribed: false };
        mockChannels.set(topic, state);
      }
      const ch = {
        topic,
        on: () => {
          if (state!.subscribed) {
            throw new Error(`cannot add postgres_changes callbacks for realtime:${topic} after subscribe()`);
          }
          return ch;
        },
        subscribe: () => {
          state!.subscribed = true;
          return ch;
        },
      };
      return ch;
    },
    // The real client drops the topic only after the server acks the leave.
    removeChannel: (ch: { topic: string }) =>
      new Promise<void>((resolve) => {
        mockPendingRemovals.push(() => {
          mockChannels.delete(ch.topic);
          resolve();
        });
      }),
  },
}));

const mockListMyEnquiries = jest.fn();
jest.mock("../../../services/brandEnquiryService", () => ({
  ...jest.requireActual("../../../services/brandEnquiryService"),
  listMyEnquiries: (...args: unknown[]) => mockListMyEnquiries(...args),
}));

const { useMyEnquiryRows } = require("../../../hooks/useBrandEnquiries") as typeof import("../../../hooks/useBrandEnquiries");

const USER = "44590000-0000-4000-8000-0000000000a1";

function ChatsPage(): React.ReactElement | null {
  useMyEnquiryRows(USER);
  return null;
}

let client: QueryClient;
let tree: import("react-test-renderer").ReactTestRenderer | null = null;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockChannels.clear();
  mockPendingRemovals.length = 0;
  mockListMyEnquiries.mockReset().mockResolvedValue([]);
});

afterEach(async () => {
  await TestRenderer.act(async () => tree?.unmount());
  tree = null;
  client.clear();
});

const wrap = (element: React.ReactElement): React.ReactElement => (
  <QueryClientProvider client={client}>{element}</QueryClientProvider>
);

test("T-REMOUNT-1: two Chats pages alive together (booking card router.replace to /) do not throw", async () => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(wrap(<ChatsPage />));
  });
  // router.replace("/") from the booking card: a second home screen mounts
  // while the first one is still in the stack.
  await expect(
    TestRenderer.act(async () => {
      tree!.update(
        wrap(
          <>
            <ChatsPage />
            <ChatsPage />
          </>,
        ),
      );
    }),
  ).resolves.toBeUndefined();
});

test("T-REMOUNT-2: a Chats page remounted before removeChannel settles does not throw", async () => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(wrap(<ChatsPage />));
  });
  await TestRenderer.act(async () => {
    tree!.update(wrap(<></>));
  });
  await expect(
    TestRenderer.act(async () => {
      tree!.update(wrap(<ChatsPage />));
    }),
  ).resolves.toBeUndefined();
  mockPendingRemovals.forEach((settle) => settle());
});
