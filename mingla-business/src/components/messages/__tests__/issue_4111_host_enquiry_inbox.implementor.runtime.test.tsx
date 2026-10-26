/**
 * #4111 Wave C — the Host inbox, rendered.
 *
 * WHAT RUNS: the REAL BrandEnquiryListSection and BrandEnquiryThreadScreen.
 * Data hooks and the enquiry RPC service are the boundary.
 *
 * Proves: the "Customer enquiries · {n} waiting" section with status pills and
 * the "See resolved" row; nothing at all for a scanner-only member (the server
 * returns nothing); each thread action calls its RPC (reply, resolve, reopen,
 * block, report); the enquiry mode has no Media / files / mentions; possible
 * spam is collapsed until Show.
 *
 * FAILS ON REVERT: delete the `setBrandEnquiryStatus(enquiryId, action)` call
 * in BrandEnquiryThreadScreen.toggleResolved and "Mark resolved calls the
 * status RPC" goes red.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockInvalidate = jest.fn(async () => undefined);
const mockRefetch = jest.fn(async () => undefined);
const mockReply = jest.fn(async (..._args: unknown[]) => "message-1");
const mockSetStatus = jest.fn(async (..._args: unknown[]) => "resolved");
const mockBlock = jest.fn(async (..._args: unknown[]) => undefined);
const mockReport = jest.fn(async (..._args: unknown[]) => undefined);

type ListData = { items: Record<string, unknown>[]; counts: Record<string, number> } | undefined;
let mockOpenList: ListData;
let mockResolvedList: ListData;
let mockThread: Record<string, unknown> | undefined;

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => ({
    data: options.queryKey[1] === "thread" ? mockThread : undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
  }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "user-a" } }) }));
jest.mock("../../../hooks/useBrandEnquiries", () => ({
  brandEnquiryKeys: {
    all: ["brandEnquiries"],
    thread: (userId: string, enquiryId: string) => ["brandEnquiries", "thread", userId, enquiryId],
  },
  useBrandEnquiries: (filter: string, options: { enabled?: boolean } = {}) => ({
    data: filter === "resolved" ? (options.enabled === false ? undefined : mockResolvedList) : mockOpenList,
    isError: false,
    error: null,
    refetch: mockRefetch,
  }),
}));
jest.mock("../../../services/brandEnquiriesService", () => ({
  getBrandEnquiryThread: jest.fn(),
  replyToBrandEnquiry: (...args: unknown[]) => mockReply(...args),
  setBrandEnquiryStatus: (...args: unknown[]) => mockSetStatus(...args),
  blockBrandEnquirySender: (...args: unknown[]) => mockBlock(...args),
  reportBrandEnquiry: (...args: unknown[]) => mockReport(...args),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: jest.fn(async () => undefined),
  },
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  DONE_BAR_OCCUPIED: 0,
  ScrollView: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ScrollViewProbe", props, props.children as React.ReactNode),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement(
      "ButtonProbe",
      { onPress: props.onPress, testID: props.testID, disabled: props.disabled, label: props.label },
      props.label as string,
    ),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SafeScreenProbe", props, props.children as React.ReactNode),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ToastProbe", props),
}));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ConfirmProbe", props),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandEnquiryListSection } = require("../BrandEnquiryListSection") as typeof import("../BrandEnquiryListSection");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandEnquiryThreadScreen } = require("../BrandEnquiryThreadScreen") as typeof import("../BrandEnquiryThreadScreen");

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const ENQUIRY = "4111c000-0000-4000-b800-0000000000e1";

function row(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    conversation_id: `conv-${id}`,
    brand_id: "brand-a",
    brand_name: "Lantern Room",
    brand_slug: "lantern-room",
    brand_photo_url: null,
    status: "new",
    source: "web",
    channel_label: "Web",
    guest_name: "Ada Obi",
    topic_label: "Private hire or big group",
    reason: "private_hire",
    context_kind: "none",
    context_id: null,
    spam_flag: false,
    email_confirmed: true,
    created_at: "2026-10-25T08:00:00.000Z",
    last_guest_at: "2026-10-25T08:00:00.000Z",
    last_brand_at: null,
    last_message_preview: "Hi",
    ...overrides,
  };
}

function thread(overrides: Record<string, unknown> = {}, guest: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enquiry: {
      id: ENQUIRY,
      conversation_id: "conv-thread",
      brand_id: "brand-a",
      brand_name: "Lantern Room",
      brand_slug: "lantern-room",
      status: "new",
      topic_label: "Refund or cancel",
      reason: "refund_cancel",
      source: "web",
      channel_label: "Web",
      context_kind: "order",
      context_id: "4111c000-0000-4000-b800-0000000000c1",
      context: {
        kind: "order",
        id: "4111c000-0000-4000-b800-0000000000c1",
        title: "Ctrl V3",
        summary: "2 tickets",
        starts_at: null,
        event_id: "4111c000-0000-4000-b800-0000000000e9",
      },
      created_at: "2026-10-25T08:00:00.000Z",
      resolved_at: null,
      spam_flag: false,
      reported: false,
      guest: { name: "Tunde K", email: "tunde@example.com", email_confirmed: true, phone: null, ok_to_call: false, has_account: true, ...guest },
      ...overrides,
    },
    messages: [
      { id: "m1", who: "guest", display: "Tunde K", body: "Can I get a refund?", at: "2026-10-25T08:00:00.000Z", mine: false },
    ],
  };
}

const texts = (renderer: Renderer): string[] =>
  renderer.root
    .findAll((node) => node.type === "Text")
    .map((node) => node.children.filter((child) => typeof child === "string").join(""));

const byTestId = (renderer: Renderer, testID: string): Node[] =>
  renderer.root.findAll((node) => node.props.testID === testID && typeof node.type === "string");

async function mount(element: React.ReactElement): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(element);
    await Promise.resolve();
  });
  return renderer;
}

async function press(node: Node): Promise<void> {
  await TestRenderer.act(async () => {
    await (node.props.onPress as () => Promise<void> | void)();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenList = undefined;
  mockResolvedList = undefined;
  mockThread = undefined;
});

describe("Customer enquiries section on Messages", () => {
  it("lists open enquiries with pills, the waiting count and See resolved", async () => {
    mockOpenList = {
      items: [
        row("e1", { guest_name: "Ada Obi", status: "new" }),
        row("e2", { guest_name: "Tunde K", status: "waiting", source: "explorer", channel_label: "App", topic_label: "Your reservation" }),
        row("e3", { guest_name: "Sam L", status: "replied", source: "site", channel_label: "Website" }),
      ],
      counts: { new: 1, waiting: 1, replied: 1, resolved: 12, needs_reply: 2 },
    };
    mockResolvedList = { items: [row("e9", { guest_name: "Rae", status: "resolved" })], counts: mockOpenList.counts };
    const onOpen = jest.fn();
    const renderer = await mount(<BrandEnquiryListSection onOpen={onOpen} />);
    const all = texts(renderer);
    expect(all).toContain("Customer enquiries · 2 waiting");
    expect(all).toEqual(expect.arrayContaining(["AO", "Ada Obi", "New", "TK", "Waiting on you", "Replied"]));
    expect(all).toContain("Lantern Room · Your reservation · App");
    expect(all).toContain("Lantern Room · Private hire or big group · Website");
    expect(byTestId(renderer, "brand-enquiry-pill-new")).toHaveLength(1);
    expect(byTestId(renderer, "brand-enquiry-pill-waiting")).toHaveLength(1);
    expect(byTestId(renderer, "brand-enquiry-pill-replied")).toHaveLength(1);
    expect(all).toContain("See resolved (12)");
    expect(all).not.toContain("Rae");

    await press(renderer.root.findAll((node) => node.props.testID === "brand-enquiry-row-e2")[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "e2" }));

    await press(renderer.root.findAll((node) => node.props.testID === "brand-enquiry-see-resolved")[0]);
    expect(texts(renderer)).toEqual(expect.arrayContaining(["Rae", "Resolved", "Hide resolved"]));
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("renders nothing for a scanner-only member (the server returns no enquiries)", async () => {
    mockOpenList = { items: [], counts: { new: 0, waiting: 0, replied: 0, resolved: 0, needs_reply: 0 } };
    const renderer = await mount(<BrandEnquiryListSection onOpen={jest.fn()} />);
    expect(renderer.root.findAll((node) => node.props.testID === "brand-enquiry-section")).toHaveLength(0);
    expect(texts(renderer)).toEqual([]);
    await TestRenderer.act(async () => renderer.unmount());
  });
});

describe("Enquiry thread", () => {
  it("shows the header, the context card with Open order and the email (no phone unless OK to call)", async () => {
    mockThread = thread({}, { phone: "+12015550147", ok_to_call: false });
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    const all = texts(renderer);
    expect(all).toEqual(expect.arrayContaining(["Tunde K", "Customer enquiry", "Lantern Room · Web · Email confirmed", "About", "Ctrl V3"]));
    expect(all).toContain("tunde@example.com");
    expect(all.join(" ")).not.toContain("+12015550147");
    const open = byTestId(renderer, "brand-enquiry-context-open")[0];
    expect(open.props.label).toBe("Open order");
    await press(open);
    expect(mockPush).toHaveBeenCalledWith(
      "/event/4111c000-0000-4000-b800-0000000000e9/orders/4111c000-0000-4000-b800-0000000000c1",
    );
    // Enquiry mode is text only.
    const labels = renderer.root.findAll((node) => typeof node.props.accessibilityLabel === "string").map((node) => node.props.accessibilityLabel);
    expect(labels).not.toEqual(expect.arrayContaining(["Add files", "chat.media_a11y", "Mute notifications"]));
    const composer = renderer.root.findAll((node) => node.props.testID === "brand-enquiry-composer" && node.type === "TextInput")[0];
    expect(composer.props.placeholder).toBe("Reply as Lantern Room");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("the phone shows when the guest said it is OK to call", async () => {
    mockThread = thread({}, { phone: "+12015550147", ok_to_call: true });
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    expect(texts(renderer)).toContain("tunde@example.com · +12015550147 · OK to call");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Mark resolved calls the status RPC", async () => {
    mockThread = thread();
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    const toggle = byTestId(renderer, "brand-enquiry-toggle-resolved")[0];
    expect(toggle.props.label).toBe("Mark resolved");
    await press(toggle);
    expect(mockSetStatus).toHaveBeenCalledWith(ENQUIRY, "resolve");
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["brandEnquiries"] });
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Reopen on a resolved enquiry calls the status RPC with reopen", async () => {
    mockThread = thread({ status: "resolved", resolved_at: "2026-10-25T09:00:00.000Z" });
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    const toggle = byTestId(renderer, "brand-enquiry-toggle-resolved")[0];
    expect(toggle.props.label).toBe("Reopen");
    await press(toggle);
    expect(mockSetStatus).toHaveBeenCalledWith(ENQUIRY, "reopen");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Send replies through the reply RPC and clears the composer", async () => {
    mockThread = thread();
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    const composer = renderer.root.findAll((node) => node.props.testID === "brand-enquiry-composer" && node.type === "TextInput")[0];
    await TestRenderer.act(async () => (composer.props.onChangeText as (v: string) => void)("  Yes, refunded today.  "));
    await press(byTestId(renderer, "brand-enquiry-send")[0]);
    expect(mockReply).toHaveBeenCalledWith(ENQUIRY, "Yes, refunded today.");
    const after = renderer.root.findAll((node) => node.props.testID === "brand-enquiry-composer" && node.type === "TextInput")[0];
    expect(after.props.value).toBe("");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Block sender asks first, then calls the block RPC", async () => {
    mockThread = thread();
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    await press(byTestId(renderer, "brand-enquiry-block")[0]);
    expect(mockBlock).not.toHaveBeenCalled();
    const dialog = renderer.root.findAll((node) => node.type === "ConfirmProbe")[0];
    expect(dialog.props.visible).toBe(true);
    await TestRenderer.act(async () => { await (dialog.props.onConfirm as () => Promise<void>)(); });
    expect(mockBlock).toHaveBeenCalledWith(ENQUIRY);
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("Report sends the chosen reason to the report RPC", async () => {
    mockThread = thread();
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    await press(byTestId(renderer, "brand-enquiry-report")[0]);
    await press(byTestId(renderer, "brand-enquiry-report-Spam or scam")[0]);
    expect(mockReport).toHaveBeenCalledWith(ENQUIRY, "Spam or scam");
    await TestRenderer.act(async () => renderer.unmount());
  });

  it("possible spam stays collapsed until Show", async () => {
    mockThread = thread({ spam_flag: true });
    const renderer = await mount(<BrandEnquiryThreadScreen enquiryId={ENQUIRY} />);
    expect(texts(renderer)).toContain("Possible spam");
    expect(texts(renderer)).not.toContain("Can I get a refund?");
    expect(renderer.root.findAll((node) => node.props.testID === "brand-enquiry-composer")).toHaveLength(0);
    await press(byTestId(renderer, "brand-enquiry-spam-show")[0]);
    expect(texts(renderer)).toContain("Can I get a refund?");
    expect(texts(renderer)).not.toContain("Possible spam");
    await TestRenderer.act(async () => renderer.unmount());
  });
});
