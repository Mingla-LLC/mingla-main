/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4111 Wave D — Explorer "Message {Brand}" from every entry point
 * (implementor happy path). MOUNTS the real controller, host and entry-point
 * components; only the shared sheet is replaced by a probe that records the
 * props it receives, so each test drives the sheet's own callbacks.
 *
 *   brand page   entry 'brand_page', no prefill → brand_enquiry_send args
 *   organiser    entry 'offering', the page's offering prefilled
 *   venue page   entry 'offering', the venue prefilled
 *   calendar     entry 'calendar', the plan prefilled; Cancel runs the
 *                Calendar's own cancel flow
 *   signed out   "Sign in to message {Brand}" → the app's sign-in; never sends
 *   sent         the thread route opens; shortcuts reach Likes → Calendar
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
  entry: string;
  prefill: { contextKind: string; contextId: string } | null;
  viewer: { kind: string; name?: string };
  onSend: (request: Record<string, unknown>) => Promise<{ ok: boolean }>;
  onSent?: (outcome: unknown, request: unknown) => void;
  onOpenCalendar?: () => void;
  onCancelSelf?: (pick: unknown, url: string | null) => void;
  onRequestRefund?: (pick: unknown) => void;
  closeOnSent?: boolean;
};

const mockSheetRenders: SheetProps[] = [];
jest.mock("@mingla/brand-rendering/enquiry/BrandMessageSheet", () => ({
  BrandMessageSheet: (props: SheetProps) => {
    mockSheetRenders.push(props);
    return null;
  },
}));

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
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
const mockToast = jest.fn();
jest.mock("../../ui/Toast", () => ({ toastManager: { show: (...args: unknown[]) => mockToast(...args) } }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../brand/PresentedByFollowButton", () => ({ PresentedByFollowButton: () => null }));
const mockCancelMyReservation = jest.fn();
jest.mock("../../../hooks/useMyReservations", () => ({
  cancelMyReservation: (...args: unknown[]) => mockCancelMyReservation(...args),
  myReservationsKeys: { byUser: (id: string) => ["myReservations", id] },
}));

const { Alert } = require("react-native") as typeof import("react-native");
const { useExplorerBrandMessage } =
  require("../useExplorerBrandMessage") as typeof import("../useExplorerBrandMessage");
const { PresentedByFollowAndMessage } =
  require("../PresentedByFollowAndMessage") as typeof import("../PresentedByFollowAndMessage");
const { CalendarPlanMessageButton } =
  require("../CalendarPlanMessageButton") as typeof import("../CalendarPlanMessageButton");
const { reservationMessageTarget } =
  require("../calendarPlanMessage") as typeof import("../calendarPlanMessage");
const { registerShellDestinationSink } =
  require("../../../services/deepLinkService") as typeof import("../../../services/deepLinkService");
const { resolveTheme } =
  require("@mingla/offering-rendering/themeResolver") as typeof import("@mingla/offering-rendering/themeResolver");

const USER = "41110000-0000-4000-8000-000000000001";
const BRAND = "41110000-0000-4000-8000-0000000000b1";
const ENQ = "41110000-0000-4000-8000-0000000000e1";
const CONV = "41110000-0000-4000-8000-0000000000c1";
const EVENT = "41110000-0000-4000-8000-0000000000a1";
const VENUE = "41110000-0000-4000-8000-0000000000d1";
const RES = "41110000-0000-4000-8000-0000000000f1";
const THEME = resolveTheme(null, null);
const BRAND_TARGET = { id: BRAND, name: "Lantern Room", slug: "lantern-room", theme: THEME };

let client: QueryClient;
let tree: import("react-test-renderer").ReactTestRenderer | null = null;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const lastSheet = (): SheetProps => {
  const props = mockSheetRenders[mockSheetRenders.length - 1];
  if (props === undefined) throw new Error("the message sheet never rendered");
  return props;
};

const mount = async (element: React.ReactElement): Promise<void> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
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

const rpcDefaults = (name: string): { data: unknown; error: null } => {
  if (name === "brand_enquiry_public_profile") return { data: { available: true, reply_minutes: null }, error: null };
  if (name === "brand_enquiry_my_plans") return { data: [], error: null };
  if (name === "brand_enquiry_send") return { data: { enquiry_id: ENQ, conversation_id: CONV }, error: null };
  return { data: null, error: null };
};

let controller: ReturnType<typeof useExplorerBrandMessage> | null = null;
function Probe(props: Parameters<typeof useExplorerBrandMessage>[0]): React.ReactElement {
  controller = useExplorerBrandMessage(props);
  return <>{controller.overlays}</>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockSheetRenders.length = 0;
  mockRpc.mockReset().mockImplementation(async (name: string) => rpcDefaults(name));
  mockFrom.mockReset();
  mockToast.mockReset();
  mockCancelMyReservation.mockReset();
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
  mockStore.user = { id: USER, email: "guest@example.com" };
  mockStore.profile = { first_name: "Ada", last_name: "Obi" };
  controller = null;
});

afterEach(async () => {
  await TestRenderer.act(async () => tree?.unmount());
  tree = null;
  client.clear();
  registerShellDestinationSink(null);
  jest.restoreAllMocks();
});

const sendRequest = (overrides: Record<string, unknown>) => ({
  reason: "general_question",
  body: "Hello, quick question please.",
  guest: null,
  hp: "",
  t0: 0,
  ...overrides,
});

test("brand page: signed-in sheet sends brand_enquiry_send as 'explorer' and opens the thread", async () => {
  await mount(<Probe brand={BRAND_TARGET} entry="brand_page" />);
  expect(controller?.available).toBe(true);
  await TestRenderer.act(async () => controller?.open());
  await flush();

  const sheet = lastSheet();
  expect(sheet.visible).toBe(true);
  expect(sheet.entry).toBe("brand_page");
  expect(sheet.prefill).toBeNull();
  expect(sheet.viewer).toEqual({ kind: "signed_in", name: "Ada Obi" });
  expect(sheet.closeOnSent).toBe(true);
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_my_plans", { p_brand_id: BRAND });

  const request = sendRequest({ entry: sheet.entry, contextKind: "none", contextId: null });
  let outcome: unknown;
  await TestRenderer.act(async () => {
    outcome = await sheet.onSend(request);
    sheet.onSent?.(outcome, request);
  });
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_send", {
    p_brand_id: BRAND,
    p_entry: "brand_page",
    p_context_kind: "none",
    p_context_id: null,
    p_reason: "general_question",
    p_body: "Hello, quick question please.",
    p_source: "explorer",
  });
  expect(outcome).toMatchObject({ ok: true, conversationId: CONV });
  expect(mockRouter.push).toHaveBeenCalledWith(`/enquiry/${ENQ}`);
});

test("signed out: Message is a sign-in step that routes to the app's sign-in and never sends", async () => {
  mockStore.user = null;
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await mount(<Probe brand={BRAND_TARGET} entry="brand_page" />);
  expect(controller?.available).toBe(true);
  await TestRenderer.act(async () => controller?.open());
  await flush();

  expect(alert).toHaveBeenCalledTimes(1);
  const [title, body, buttons] = alert.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
  expect(title).toBe("Sign in to message Lantern Room");
  expect(body).toContain("Lantern Room");
  expect(buttons.map((b) => b.text)).toEqual(["Not now", "Sign in"]);
  buttons[1].onPress?.();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
  expect(mockSheetRenders).toHaveLength(0);
  expect(mockRpc.mock.calls.some(([name]) => name === "brand_enquiry_send")).toBe(false);
});

test("organiser row: Message opens with this event picked and sends it as the offering", async () => {
  const offering = { id: EVENT, title: "Supper club", kind: "event" as const, startsAt: null, when: "upcoming" as const };
  await mount(
    <PresentedByFollowAndMessage
      brandId={BRAND}
      brandName="Lantern Room"
      brandSlug="lantern-room"
      palette={require("@mingla/offering-rendering").createThemePalette(THEME)}
      theme={THEME}
      offering={offering}
    />,
  );
  await press("presented-by-message");
  const sheet = lastSheet();
  expect(sheet.entry).toBe("offering");
  expect(sheet.prefill).toMatchObject({ contextKind: "offering", contextId: EVENT });

  await TestRenderer.act(async () => {
    await sheet.onSend(sendRequest({ entry: sheet.entry, contextKind: "offering", contextId: EVENT, reason: "access_needs" }));
  });
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_send", expect.objectContaining({
    p_entry: "offering",
    p_context_kind: "offering",
    p_context_id: EVENT,
    p_reason: "access_needs",
    p_source: "explorer",
  }));
});

test("organiser row renders Follow alone when the brand is not taking messages", async () => {
  mockRpc.mockImplementation(async (name: string) =>
    name === "brand_enquiry_public_profile" ? { data: { available: false }, error: null } : rpcDefaults(name),
  );
  await mount(
    <PresentedByFollowAndMessage
      brandId={BRAND}
      brandName="Lantern Room"
      brandSlug={null}
      palette={require("@mingla/offering-rendering").createThemePalette(THEME)}
      theme={THEME}
      offering={{ id: EVENT, title: "Supper club", kind: "event", startsAt: null, when: "upcoming" }}
    />,
  );
  expect(tree?.root.findAll((n) => n.props.testID === "presented-by-message")).toHaveLength(0);
});

test("venue page: the venue is picked and sent as the context", async () => {
  const venue = { id: VENUE, name: "Lantern Room Soho", orderingEnabled: false, reservationsOnline: true };
  await mount(<Probe brand={BRAND_TARGET} entry="offering" venue={venue} />);
  await TestRenderer.act(async () => controller?.open({ contextKind: "venue", contextId: VENUE }));
  await flush();
  const sheet = lastSheet();
  expect(sheet.entry).toBe("offering");
  expect(sheet.prefill).toEqual({ contextKind: "venue", contextId: VENUE });
  await TestRenderer.act(async () => {
    await sheet.onSend(sendRequest({ entry: "offering", contextKind: "venue", contextId: VENUE, reason: "private_hire" }));
  });
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_send", expect.objectContaining({
    p_entry: "offering", p_context_kind: "venue", p_context_id: VENUE, p_reason: "private_hire", p_source: "explorer",
  }));
});

test("Likes → Calendar: a reservation opens on that plan; Cancel uses the Calendar's own flow", async () => {
  mockFrom.mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: { id: BRAND, name: "Lantern Room", slug: "lantern-room", profile_photo_url: null, theme_color: null, theme_font: null, theme_animation: null },
        error: null,
      }),
    };
    return chain;
  });
  const onCancelReservation = jest.fn();
  const target = reservationMessageTarget(
    { id: RES, brand_id: BRAND, brand_name: "Lantern Room", reserved_for: "2099-01-01T19:00:00Z", party_size: 2, status: "confirmed" } as never,
  );
  await mount(<CalendarPlanMessageButton target={target} onCancelReservation={onCancelReservation} />);
  expect(mockFrom).not.toHaveBeenCalled();
  await press(`calendar-message-reservation-${RES}`);

  expect(mockFrom).toHaveBeenCalledWith("business_public_brands_view");
  const sheet = lastSheet();
  expect(sheet.entry).toBe("calendar");
  expect(sheet.prefill).toMatchObject({ contextKind: "reservation", contextId: RES, plan: { canCancel: true } });

  await TestRenderer.act(async () => {
    await sheet.onSend(sendRequest({ entry: "calendar", contextKind: "reservation", contextId: RES, reason: "running_late" }));
  });
  expect(mockRpc).toHaveBeenCalledWith("brand_enquiry_send", expect.objectContaining({
    p_entry: "calendar", p_context_kind: "reservation", p_context_id: RES, p_reason: "running_late", p_source: "explorer",
  }));

  await TestRenderer.act(async () => {
    sheet.onCancelSelf?.({ contextKind: "reservation", contextId: RES }, null);
  });
  expect(onCancelReservation).toHaveBeenCalledWith(RES);
  expect(mockCancelMyReservation).not.toHaveBeenCalled();
});

test("shortcuts: Can't find my tickets → Likes → Calendar; food refund → the order receipt", async () => {
  const destinations: unknown[] = [];
  registerShellDestinationSink((dest) => destinations.push(dest));
  await mount(<Probe brand={BRAND_TARGET} entry="brand_page" />);
  await TestRenderer.act(async () => controller?.open());
  await flush();

  await TestRenderer.act(async () => lastSheet().onOpenCalendar?.());
  expect(destinations).toEqual([{ kind: "page", page: "likes", params: { tab: "calendar" } }]);

  await TestRenderer.act(async () => lastSheet().onRequestRefund?.({ contextKind: "venue_order", contextId: "vo-1" }));
  expect(mockRouter.push).toHaveBeenCalledWith("/purchases/venue_order/vo-1");
});
