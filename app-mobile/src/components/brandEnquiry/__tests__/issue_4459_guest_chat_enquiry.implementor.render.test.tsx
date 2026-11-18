/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4459 rework (QA D1, D7) — Explorer "Message <Brand>" from the Guest chat.
 *
 *   D1  The Chats page (useMyEnquiryRows) and an open Guest chat thread
 *       (useMessageBrandFromGuestChat) mount TOGETHER. The supabase mock
 *       behaves like supabase-js 2.103: a second `.channel(topic)` returns the
 *       already-subscribed channel, and `.on(...)` on it throws. The thread must
 *       not open a second `explorer-enquiries:<user>` channel.
 *   D7  After a send, the message sheet closes as the thread opens.
 *
 * FAILS-ON-REVERT: point useMessageBrandFromGuestChat back at useMyEnquiryRows
 * and the D1 mount throws; drop `setVisible(false)` from the host's onSent and
 * the D7 case sees the sheet still visible.
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

type SheetProps = Record<string, unknown> & {
  visible: boolean;
  onSend: (request: Record<string, unknown>) => Promise<{ ok: boolean }>;
  onSent?: (outcome: unknown, request: unknown) => void;
};

const mockSheetRenders: SheetProps[] = [];
jest.mock("@mingla/brand-rendering/enquiry/BrandMessageSheet", () => ({
  BrandMessageSheet: (props: SheetProps) => {
    mockSheetRenders.push(props);
    return null;
  },
}));

// supabase-js 2.103 channel semantics: one channel object per topic; adding
// callbacks after subscribe() throws.
const mockChannels = new Map<string, { subscribed: boolean }>();
const mockChannelCalls: string[] = [];
const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => {
      throw new Error("unexpected direct table read in this suite");
    },
    channel: (topic: string) => {
      mockChannelCalls.push(topic);
      let state = mockChannels.get(topic);
      if (state === undefined) {
        state = { subscribed: false };
        mockChannels.set(topic, state);
      }
      const ch = {
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
    removeChannel: async () => undefined,
  },
}));

const mockListMyEnquiries = jest.fn();
jest.mock("../../../services/brandEnquiryService", () => ({
  ...jest.requireActual("../../../services/brandEnquiryService"),
  listMyEnquiries: (...args: unknown[]) => mockListMyEnquiries(...args),
}));

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

const mockStore: { user: { id: string; email: string } | null; profile: Record<string, unknown> | null } = {
  user: null,
  profile: null,
};
jest.mock("../../../store/appStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../ui/Toast", () => ({ toastManager: { show: jest.fn() } }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../hooks/useMyReservations", () => ({
  cancelMyReservation: jest.fn(),
  myReservationsKeys: { byUser: (id: string) => ["myReservations", id] },
}));

const { useMyEnquiryRows } = require("../../../hooks/useBrandEnquiries") as typeof import("../../../hooks/useBrandEnquiries");
const { useMessageBrandFromGuestChat } =
  require("../useMessageBrandFromGuestChat") as typeof import("../useMessageBrandFromGuestChat");
const { useExplorerBrandMessage } =
  require("../useExplorerBrandMessage") as typeof import("../useExplorerBrandMessage");
const { resolveTheme } =
  require("@mingla/offering-rendering/themeResolver") as typeof import("@mingla/offering-rendering/themeResolver");

const USER = "44590000-0000-4000-8000-000000000001";
const BRAND = "44590000-0000-4000-8000-0000000000b1";
const ENQ = "44590000-0000-4000-8000-0000000000e1";
const CONV = "44590000-0000-4000-8000-0000000000c1";

let client: QueryClient;
let tree: import("react-test-renderer").ReactTestRenderer | null = null;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mount = async (element: React.ReactElement): Promise<void> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
  await flush();
};

function ChatsPage(): React.ReactElement | null {
  useMyEnquiryRows(USER);
  return null;
}

let guestChat: ReturnType<typeof useMessageBrandFromGuestChat> | null = null;
function GuestChatThread(): React.ReactElement {
  guestChat = useMessageBrandFromGuestChat({ brandId: BRAND, brandSlug: "lagos-vibes", brandName: "Lagos Vibes" });
  return <>{guestChat.overlays}</>;
}

let controller: ReturnType<typeof useExplorerBrandMessage> | null = null;
function SheetProbe(props: Parameters<typeof useExplorerBrandMessage>[0]): React.ReactElement {
  controller = useExplorerBrandMessage(props);
  return <>{controller.overlays}</>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockSheetRenders.length = 0;
  mockChannels.clear();
  mockChannelCalls.length = 0;
  mockListMyEnquiries.mockReset().mockResolvedValue([
    {
      enquiryId: ENQ,
      brandId: BRAND,
      conversationId: CONV,
      createdAt: "2026-11-16T10:00:00Z",
      lastActivityAt: "2026-11-16T11:00:00Z",
    },
  ]);
  mockRpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "brand_enquiry_public_profile") return { data: { available: true, reply_minutes: null }, error: null };
    if (name === "brand_enquiry_my_plans") return { data: [], error: null };
    if (name === "brand_enquiry_send") return { data: { enquiry_id: ENQ, conversation_id: CONV }, error: null };
    return { data: null, error: null };
  });
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
  mockStore.user = { id: USER, email: "guest@example.com" };
  mockStore.profile = { first_name: "Ada", last_name: "Obi" };
  guestChat = null;
  controller = null;
});

afterEach(async () => {
  await TestRenderer.act(async () => tree?.unmount());
  tree = null;
  client.clear();
});

test("D1: the Chats page and an open Guest chat mount together without a second enquiries channel", async () => {
  await mount(
    <>
      <ChatsPage />
      <GuestChatThread />
    </>,
  );
  expect(mockChannelCalls.filter((topic) => topic.startsWith(`explorer-enquiries:${USER}`))).toHaveLength(1);
  expect(guestChat).not.toBeNull();

  // Message <Brand> opens the existing #4111 thread from the shared rows.
  await TestRenderer.act(async () => guestChat?.messageBrand());
  await flush();
  expect(mockRouter.push).toHaveBeenCalledWith(`/enquiry/${ENQ}`);
});

test("D7: after a send the sheet closes as the thread opens", async () => {
  const brand = { id: BRAND, name: "Lagos Vibes", slug: "lagos-vibes", theme: resolveTheme(null, null) };
  await mount(<SheetProbe brand={brand} entry="brand_page" />);
  await TestRenderer.act(async () => controller?.open());
  await flush();
  const open = mockSheetRenders[mockSheetRenders.length - 1];
  expect(open?.visible).toBe(true);

  const request = { reason: "general_question", body: "Hello, quick question please.", guest: null, hp: "", t0: 0 };
  await TestRenderer.act(async () => {
    const outcome = await open!.onSend(request);
    open!.onSent?.(outcome, request);
  });
  await flush();
  expect(mockRouter.push).toHaveBeenCalledWith(`/enquiry/${encodeURIComponent(ENQ)}`);
  expect(mockSheetRenders[mockSheetRenders.length - 1]?.visible).toBe(false);
});
