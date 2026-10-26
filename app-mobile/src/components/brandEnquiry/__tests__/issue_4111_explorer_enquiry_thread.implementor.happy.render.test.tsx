/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4111 Wave D — the Explorer enquiry thread and its chat-list row
 * (implementor happy path). MOUNTS the real EnquiryThreadScreen against a
 * recorded `brand_enquiry_get_thread` payload:
 *
 *   - header: brand name, "Enquiry" tag, topic; context card pinned on top
 *   - brand replies read "{first} at {Brand}"; the resolved banner copy
 *   - the composer sends through brand_enquiry_guest_reply
 *   - ⋯ → Report sends brand_enquiry_report with the chosen reason
 *   - live: realtime on messages + brand_enquiries filtered on conversation_id
 *   - the Friends-tab row: logo square + question badge + "Enquiry" tag
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

const mockRpc = jest.fn();
const mockUpsert = jest.fn(async () => ({ error: null }));
const mockChannelFilters: { table: string; filter: string }[] = [];
jest.mock("../../../services/supabase", () => {
  const channel = {
    on: (_event: string, config: { table: string; filter: string }) => {
      mockChannelFilters.push({ table: config.table, filter: config.filter });
      return channel;
    },
    subscribe: () => channel,
  };
  return {
    supabase: {
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: () => ({ upsert: mockUpsert }),
      channel: () => channel,
      removeChannel: jest.fn(async () => undefined),
    },
  };
});

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  // RNW's Modal portals into a DOM this node lane does not have.
  const Modal = ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null;
  // RNW's TextInput measures the DOM on mount; a host stub keeps its props.
  const TextInput = (props: Record<string, unknown>) =>
    jest.requireActual("react").createElement("TextInput", props);
  return { ...RN, Modal, TextInput };
});

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("react-i18next", () => {
  const en = require("../../../i18n/locales/en/enquiry.json") as Record<string, string>;
  const t = (key: string, options: Record<string, unknown> = {}): string => {
    const leaf = key.includes(":") ? key.split(":").pop() ?? key : key;
    return String(en[leaf] ?? key).replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) => String(options[name] ?? ""));
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("../../../store/appStore", () => ({
  useAppStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "41110000-0000-4000-8000-000000000001" } }),
}));
const mockToast = jest.fn();
jest.mock("../../ui/Toast", () => ({ toastManager: { show: (...args: unknown[]) => mockToast(...args) } }));
jest.mock("../../ui/ToastContainer", () => ({ ToastContainer: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/KeyboardAwareView", () => {
  const { View } = jest.requireActual("react-native");
  return { KeyboardAwareView: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

const { EnquiryThreadScreen } =
  require("../EnquiryThreadScreen") as typeof import("../EnquiryThreadScreen");
const { EnquiryChatListRow } =
  require("../EnquiryChatListRow") as typeof import("../EnquiryChatListRow");
const { toEnquiryConversation } = require("../enquiryChatRows") as typeof import("../enquiryChatRows");

const ENQ = "41110000-0000-4000-8000-0000000000e1";
const CONV = "41110000-0000-4000-8000-0000000000c1";
const BRAND = "41110000-0000-4000-8000-0000000000b1";

const threadPayload = (status: string) => ({
  enquiry: {
    id: ENQ,
    conversation_id: CONV,
    brand_id: BRAND,
    brand_name: "Lantern Room",
    brand_slug: "lantern-room",
    brand_logo_url: null,
    status,
    topic_label: "Supper club · Access needs",
    context: { kind: "order", title: "Supper club", summary: "2 tickets", starts_at: "2026-11-08T19:00:00Z" },
    reported: false,
  },
  messages: [
    { id: "m1", who: "guest", display: "Ada Obi", body: "Is there step-free access?", at: "2026-10-20T10:00:00Z", mine: true },
    { id: "m2", who: "brand", display: "Mina at Lantern Room", body: "Yes, ramp at the side door.", at: "2026-10-20T11:00:00Z", mine: false },
  ],
});

let client: QueryClient;
let tree: import("react-test-renderer").ReactTestRenderer | null = null;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const byTestId = (id: string) => tree?.root.find((n) => n.props.testID === id && typeof n.type !== "string") ??
  tree?.root.findByProps({ testID: id });
const textOf = (node: import("react-test-renderer").ReactTestInstance): string =>
  node.findAll((n) => typeof n.children?.[0] === "string")
    .flatMap((n) => n.children.filter((c): c is string => typeof c === "string"))
    .join(" ");
const allText = (): string => (tree === null ? "" : textOf(tree.root));
const press = async (id: string): Promise<void> => {
  const node = tree?.root.find((n) => n.props.testID === id && typeof n.props.onPress === "function");
  if (node === undefined) throw new Error(`no pressable ${id}`);
  await TestRenderer.act(async () => {
    node.props.onPress();
  });
  await flush();
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockRpc.mockReset();
  mockUpsert.mockClear();
  mockToast.mockReset();
  mockChannelFilters.length = 0;
});

afterEach(async () => {
  await TestRenderer.act(async () => tree?.unmount());
  tree = null;
  client.clear();
});

const mountThread = async (status = "replied"): Promise<void> => {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === "brand_enquiry_get_thread") return { data: threadPayload(status), error: null };
    if (name === "brand_enquiry_guest_reply") return { data: "m3", error: null };
    if (name === "brand_enquiry_report") return { data: true, error: null };
    return { data: null, error: null };
  });
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <EnquiryThreadScreen enquiryId={ENQ} />
      </QueryClientProvider>,
    );
  });
  await flush();
};

test("header, pinned context card, '{first} at {Brand}' replies, live on conversation_id", async () => {
  await mountThread();
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_get_thread", { p_enquiry_id: ENQ, p_limit: 200 });
  const text = allText();
  expect(text).toContain("Lantern Room");
  expect(text).toContain("Enquiry");
  expect(text).toContain("Supper club · Access needs");
  expect(textOf(byTestId("enquiry-thread-context")!)).toContain("Supper club");
  expect(textOf(byTestId("enquiry-message-m2")!)).toContain("Mina at Lantern Room");
  expect(textOf(byTestId("enquiry-message-m1")!)).toContain("You");
  expect(tree?.root.findAll((n) => n.props.testID === "enquiry-thread-resolved")).toHaveLength(0);
  expect(mockChannelFilters).toEqual(
    expect.arrayContaining([
      { table: "messages", filter: `conversation_id=eq.${CONV}` },
      { table: "brand_enquiries", filter: `conversation_id=eq.${CONV}` },
    ]),
  );
  // Opening the thread marks the brand's messages read (own receipts only).
  expect(mockUpsert).toHaveBeenCalledWith(
    [{ message_id: "m2", user_id: "41110000-0000-4000-8000-000000000001" }],
    { onConflict: "message_id,user_id" },
  );
});

test("resolved threads say so, and writing again goes through brand_enquiry_guest_reply", async () => {
  await mountThread("resolved");
  expect(textOf(byTestId("enquiry-thread-resolved")!)).toBe(
    "Lantern Room marked this as resolved. Write again to reopen it.",
  );
  const input = tree!.root.find((n) => n.props.testID === "enquiry-thread-input" && typeof n.props.onChangeText === "function");
  await TestRenderer.act(async () => input.props.onChangeText("  Thanks — one more thing  "));
  await press("enquiry-thread-send");
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_guest_reply", {
    p_enquiry_id: ENQ,
    p_body: "Thanks — one more thing",
  });
  expect(mockToast).not.toHaveBeenCalled();
});

test("a failed reply is shown, never swallowed", async () => {
  await mountThread();
  mockRpc.mockImplementation(async (name: string) =>
    name === "brand_enquiry_guest_reply"
      ? { data: null, error: { message: "enquiry_unavailable" } }
      : { data: threadPayload("replied"), error: null },
  );
  const input = tree!.root.find((n) => n.props.testID === "enquiry-thread-input" && typeof n.props.onChangeText === "function");
  await TestRenderer.act(async () => input.props.onChangeText("Hello again"));
  await press("enquiry-thread-send");
  expect(mockToast).toHaveBeenCalledWith("This conversation isn't available any more.", "error");
});

test("⋯ → Report sends brand_enquiry_report with the chosen reason", async () => {
  await mountThread();
  await press("enquiry-thread-more");
  await press("enquiry-thread-report");
  expect(byTestId("enquiry-report-dialog")).toBeDefined();
  await press("enquiry-report-reason-spam");
  await press("enquiry-report-submit");
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_report", { p_enquiry_id: ENQ, p_reason: "Spam or scam" });
  expect(mockToast).toHaveBeenCalledWith("Thanks. Mingla will review this conversation.", "success");
});

test("the chat-list row shows the logo square, question badge and Enquiry tag, and opens the thread", async () => {
  const conversation = toEnquiryConversation(
    {
      enquiryId: ENQ,
      conversationId: CONV,
      brandId: BRAND,
      brandName: "Lantern Room",
      brandSlug: "lantern-room",
      brandLogoUrl: null,
      status: "replied",
      topicLabel: "Supper club · Access needs",
      createdAt: "2026-10-20T10:00:00Z",
      lastActivityAt: "2026-10-20T11:00:00Z",
      lastMessage: { id: "m2", body: "Yes, ramp at the side door.", at: "2026-10-20T11:00:00Z", fromBrand: true },
      unreadCount: 1,
    },
    "41110000-0000-4000-8000-000000000001",
  );
  const onPress = jest.fn();
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<EnquiryChatListRow conversation={conversation} onPress={onPress} />);
  });
  const text = allText();
  expect(text).toContain("Lantern Room");
  expect(text).toContain("Enquiry");
  expect(text).toContain("Supper club · Access needs · Yes, ramp at the side door.");
  expect(tree!.root.findAll((n) => n.props.testID === "enquiry-brand-avatar-badge").length).toBeGreaterThan(0);
  expect(tree!.root.findAll((n) => n.props.testID === `enquiry-row-${ENQ}-unread`).length).toBeGreaterThan(0);
  await press(`enquiry-row-${ENQ}`);
  expect(onPress).toHaveBeenCalledWith(conversation);
});
