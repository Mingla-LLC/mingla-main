/**
 * #4111 Wave C — the enquiry card in a Brand group, and push routing.
 *
 * WHAT RUNS: the REAL /messages/[conversationId] route (a Brand group) with a
 * brand_enquiry_card message, plus the REAL businessNotificationRouting.
 *
 * Proves: the card renders as a "Customer enquiry" card with the server's
 * guest-free copy (never a chat bubble with Reply/Select), and Open enquiry
 * goes to /messages/enquiry/{id}; an enquiry push opens that thread.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockListMessages = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const ENQUIRY = "4111c000-0000-4000-b800-0000000000e1";
const CONVERSATION = "4111c000-0000-4000-b800-0000000000c9";

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ conversationId: "conversation-a" }),
  useRouter: () => ({ back: jest.fn(), push: mockPush, replace: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@tanstack/react-query", () => ({
  // The enquiry lookup answers "not an enquiry": this is a Brand group.
  useQuery: (options: { queryKey: readonly unknown[] }) => ({
    data: options.queryKey[1] === "byConversation" ? null : [],
    isPending: false,
    fetchStatus: "idle",
  }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../i18n", () => ({ useBusinessMediaTranslation: () => ({ t: (key: string) => key, language: "en" }) }));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "user-a" } }) }));
// Stable identities, as the real hook gives: the thread's refresh depends on them.
const mockGroupsValue = {
  groups: [{ conversation_id: "conversation-a", brand_name: "Lantern Room", member_count: 3, access_kind: "brand", muted: false }],
  refresh: jest.fn(async () => undefined),
  setMuted: jest.fn(async () => undefined),
};
jest.mock("../../../hooks/useBrandGroups", () => ({
  useBrandGroups: () => mockGroupsValue,
}));
jest.mock("../../../services/brandGroupFileMetaService", () => ({ fileMeta: async () => [] }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../hooks/useSupportStaff", () => ({ useSupportStaff: () => ({ isStaff: false }) }));
jest.mock("../../../services/brandGroupsService", () => ({
  listBrandGroupMessages: (...args: unknown[]) => mockListMessages(...args),
  listBrandGroupMentionCandidates: jest.fn(async () => ({ candidates: [], error: null })),
  markBrandGroupRead: jest.fn(async () => undefined),
  sendBrandGroupMessage: jest.fn(),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: jest.fn(async () => undefined),
  },
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  DONE_BAR_OCCUPIED: 0,
  ScrollView: (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react");
    return R.forwardRef((props: Record<string, unknown>, _ref: unknown) =>
      R.createElement("ScrollViewProbe", props, props.children as React.ReactNode));
  })(),
}));
jest.mock("../BrandGroupSignalModal", () => ({ BrandGroupSignalModal: () => null }));
jest.mock("../BrandGroupFilePreviewModal", () => ({ BrandGroupFilePreviewModal: () => null }));
jest.mock("../BrandGroupFileUploadSheet", () => ({ BrandGroupFileUploadSheet: () => null }));
jest.mock("../BrandGroupMediaPanel", () => ({ BrandGroupMediaPanel: () => null }));
jest.mock("../BrandGroupMediaBubble", () => ({ BrandGroupMediaBubble: () => null }));
jest.mock("../BrandEnquiryThreadScreen", () => ({ BrandEnquiryThreadScreen: () => null }));
jest.mock("../../media/MediaThumb", () => ({ MediaThumb: () => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", { onPress: props.onPress, testID: props.testID, label: props.label }, props.label as string),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("SafeScreenProbe", props, props.children as React.ReactNode),
}));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: null }) },
}));
jest.mock("../../../services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ThreadRoute = require("../../../../app/messages/[conversationId]").default as React.ComponentType;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveBusinessNavTarget } = require("../../../services/businessNotificationRouting") as typeof import("../../../services/businessNotificationRouting");

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; unmount: () => void }

const textOf = (node: Node): string => node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");

describe("#4111 enquiry card in the Brand group", () => {
  it("renders a guest-free Customer enquiry card whose Open goes to the enquiry", async () => {
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: "card-1",
          conversation_id: "conversation-a",
          sender_id: null,
          sender_display_name: "Customer enquiry",
          sender_role: null,
          content: "New customer enquiry · Private hire or big group",
          created_at: "2026-10-25T09:41:00.000Z",
          reply_to_id: null,
          related_message_ids: [],
          reply_content: null,
          reply_sender_display_name: null,
          message_type: "brand_enquiry_card",
          file_id: null,
          file_name: null,
          file_size: null,
          file_mime: null,
          card_payload: { kind: "brand_enquiry_card", enquiry_id: ENQUIRY, topic_label: "Private hire or big group" },
        },
      ],
      error: null,
    });
    let renderer!: Renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<ThreadRoute />);
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    });
    const cards = renderer.root.findAll((node) => node.props.testID === "brand-enquiry-card" && typeof node.type === "string");
    expect(cards).toHaveLength(1);
    const cardText = textOf(cards[0]);
    expect(cardText).toContain("Customer enquiry");
    expect(cardText).toContain("New customer enquiry · Private hire or big group");
    // A card, not a chat bubble: no Reply / Select under it.
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === "Reply to Customer enquiry")).toHaveLength(0);
    const open = renderer.root.findAll((node) => node.type === "ButtonProbe" && node.props.testID === "brand-enquiry-card-open")[0];
    expect(open.props.label).toBe("Open enquiry");
    await TestRenderer.act(async () => { (open.props.onPress as () => void)(); });
    expect(mockPush).toHaveBeenCalledWith(`/messages/enquiry/${ENQUIRY}`);
    await TestRenderer.act(async () => renderer.unmount());
  });
});

describe("#4111 enquiry push routing", () => {
  it("opens the enquiry thread for each team category", () => {
    for (const type of ["business.brand_enquiry_new", "business.brand_enquiry_message", "business.brand_enquiry_nudge"]) {
      expect(resolveBusinessNavTarget({
        type,
        enquiry_id: ENQUIRY,
        conversation_id: CONVERSATION,
        deepLink: `mingla-business://messages/${CONVERSATION}`,
      })).toBe(`/messages/enquiry/${ENQUIRY}`);
    }
  });

  it("falls back to the conversation route, then Messages, never the account tab", () => {
    expect(resolveBusinessNavTarget({
      type: "business.brand_enquiry_new",
      deepLink: `mingla-business://messages/${CONVERSATION}`,
    })).toBe(`/messages/${CONVERSATION}`);
    expect(resolveBusinessNavTarget({ type: "business.brand_enquiry_message", conversation_id: CONVERSATION })).toBe(
      `/messages/${CONVERSATION}`,
    );
    expect(resolveBusinessNavTarget({ type: "business.brand_enquiry_nudge", enquiry_id: "not-a-uuid" })).toBe("/messages");
  });
});
