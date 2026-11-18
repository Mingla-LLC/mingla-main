/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4459 QA retest — the booking card's Guest chat row (MOUNTED).
 *
 *   D1-b  Open / Rejoin go back to the EXISTING home shell
 *         (openShellDestination) and never replace onto a new "/" root,
 *         which mounted a second home screen and a second enquiries channel.
 *   P3    A rejoin announces itself (the Chats page drops its cached thread)
 *         and refetches the chat's member and participant queries.
 *   P3    The row matches the ticket screen's quiet rows (chevron, 16 inset,
 *         muted 600 label, 48 high).
 *
 * FAILS-ON-REVERT: put router.replace back as the open path (the open and
 * rejoin cases fail), drop announceBrandGuestRejoin or the invalidations (the
 * rejoin case fails), or drop the chevron / row style (the row case fails).
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

const mockGetStatus = jest.fn();
const mockRejoin = jest.fn();
jest.mock("../../../services/messagingService", () => ({
  messagingService: {
    getMyBrandGuestStatus: (...args: unknown[]) => mockGetStatus(...args),
    rejoinBrandGuestChat: (...args: unknown[]) => mockRejoin(...args),
  },
}));
jest.mock("../../brandEnquiry/useMessageBrandFromGuestChat", () => ({
  useMessageBrandFromGuestChat: () => ({ messageBrand: jest.fn(), busy: false, overlays: null }),
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Toast", () => ({ toastManager: { show: jest.fn() } }));
const mockAnnounce = jest.fn();
jest.mock("../../chat/brandGuestRejoin", () => ({
  announceBrandGuestRejoin: (...args: unknown[]) => mockAnnounce(...args),
}));

const { BrandGuestChatBookingAction } =
  require("../BrandGuestChatBookingAction") as typeof import("../BrandGuestChatBookingAction");
const { registerShellDestinationSink } =
  require("../../../services/deepLinkService") as typeof import("../../../services/deepLinkService");
const { chatKeys } = require("../../../hooks/queryKeys") as typeof import("../../../hooks/queryKeys");
const { StyleSheet, Text } = require("react-native") as typeof import("react-native");

const BRAND = "44590000-0000-4000-8000-0000000000b1";
const CONV = "44590000-0000-4000-8000-0000000000c1";

let client: QueryClient;
let tree: import("react-test-renderer").ReactTestRenderer | null = null;
const shellDestinations: unknown[] = [];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mount = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <BrandGuestChatBookingAction brandId={BRAND} brandSlug="lagos-vibes" brandName="Lagos Vibes" />
      </QueryClientProvider>,
    );
  });
  await flush();
};

const press = async (testID: string): Promise<void> => {
  const node = tree?.root.find((n) => n.props.testID === testID && typeof n.props.onPress === "function");
  if (node === undefined) throw new Error(`no pressable ${testID}`);
  await TestRenderer.act(async () => {
    node.props.onPress();
  });
  await flush();
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shellDestinations.length = 0;
  registerShellDestinationSink((dest) => shellDestinations.push(dest));
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
  mockAnnounce.mockReset();
  mockGetStatus.mockReset();
  mockRejoin.mockReset();
});

afterEach(async () => {
  await TestRenderer.act(async () => tree?.unmount());
  tree = null;
  client.clear();
  registerShellDestinationSink(null);
});

test("Open guest chat goes to the existing home shell, never a new '/' root", async () => {
  mockGetStatus.mockResolvedValue({ status: { status: "member", conversationId: CONV, canRejoin: false }, error: null });
  await mount();
  await press("booking-guest-chat-open");
  expect(shellDestinations).toEqual([{ kind: "conversation", conversationId: CONV }]);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test("Rejoin drops the cached thread, refetches the chat's queries and opens it in the existing shell", async () => {
  mockGetStatus.mockResolvedValue({ status: { status: "left", conversationId: CONV, canRejoin: true }, error: null });
  mockRejoin.mockResolvedValue({ conversationId: CONV, error: null });
  await mount();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await press("booking-guest-chat-rejoin");
  expect(mockAnnounce).toHaveBeenCalledWith(CONV);
  const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));
  expect(keys).toEqual(expect.arrayContaining([
    JSON.stringify(chatKeys.brandGuestMembers(CONV)),
    JSON.stringify(chatKeys.participants(CONV)),
  ]));
  expect(shellDestinations).toEqual([{ kind: "conversation", conversationId: CONV }]);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test("with no shell mounted (opened cold), Open falls back to the home route", async () => {
  registerShellDestinationSink(null);
  mockGetStatus.mockResolvedValue({ status: { status: "member", conversationId: CONV, canRejoin: false }, error: null });
  await mount();
  await press("booking-guest-chat-open");
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/", params: { tab: "messages", conversationId: CONV } });
});

test("the row matches the ticket screen's quiet rows: inset, height, label weight and a chevron", async () => {
  mockGetStatus.mockResolvedValue({ status: { status: "member", conversationId: CONV, canRejoin: false }, error: null });
  await mount();
  const row = tree!.root.find((n) => n.props.testID === "booking-guest-chat-open" && typeof n.props.onPress === "function");
  const style = StyleSheet.flatten(typeof row.props.style === "function" ? row.props.style({ pressed: false }) : row.props.style);
  expect(style).toEqual(expect.objectContaining({ minHeight: 48, paddingHorizontal: 16, gap: 12 }));
  const texts = row.findAllByType(Text).map((n) => ({ text: n.props.children, style: StyleSheet.flatten(n.props.style) }));
  expect(texts[0]?.style).toEqual(expect.objectContaining({ fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.70)" }));
  expect(texts[texts.length - 1]?.text).toBe("›");
});
