/**
 * #4271 — Tap to Pay on iPhone review gaps, against Apple's Human Interface
 * Guidelines, before the publishing-review videos:
 *   G1 the awareness splash stays off until Apple's toolkit files are in
 *   G2 only someone who may accept Apple's terms sees the splash (one shared rule)
 *   G3 iPhone screens say "Tap to Pay on iPhone"; Android never says "iPhone"
 *   G4 every failed state offers "Get help", which opens Help & Support
 *   G5 Settings shows Apple's Tap to Pay symbol on iPhone
 * Mocks mirror issue_4271_apple_surfaces.render.test.tsx.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Platform } from "react-native";

// react-test-renderer ships no types in this app.
interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
  unmount: () => void;
  toJSON: () => unknown;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

// Every tree a test mounts is unmounted after it, so no screen keeps polling or
// ticking once Jest tears the environment down (the lane must exit 0).
const mountedTrees: ReactTestRenderer[] = [];
const createTree = renderer.create;
renderer.create = (element: React.ReactElement): ReactTestRenderer => {
  const created = createTree(element);
  mountedTrees.push(created);
  return created;
};
afterEach(() => {
  act(() => {
    for (let tree = mountedTrees.pop(); tree; tree = mountedTrees.pop()) tree.unmount();
  });
});

const mockIconNames: string[] = [];
jest.mock("../../ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => {
    mockIconNames.push(name);
    return null;
  },
}));
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    Button: (props: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
      ReactLocal.createElement(
        Pressable,
        { onPress: props.onPress, disabled: props.disabled, testID: props.testID },
        ReactLocal.createElement(Text, null, props.label),
      ),
  };
});

let mockLive = false;
let mockBrandId: string | null = "brand-1";
const mockInitialize = jest.fn(async () => ({}));
const mockEasyConnect = jest.fn(async (_params: Record<string, unknown>) => ({}));
const mockProviderMounts = jest.fn();
const mockSdk = {
  StripeTerminalProvider: ({ children }: { children: React.ReactNode }) => {
    mockProviderMounts();
    return children;
  },
  useStripeTerminal: () => ({
    initialize: mockInitialize,
    disconnectReader: jest.fn(async () => ({})),
    clearCachedCredentials: jest.fn(async () => ({})),
    getConnectedReader: jest.fn(async () => null),
    easyConnect: mockEasyConnect,
    supportsReadersOfType: jest.fn(async () => ({ readerSupportResult: true })),
  }),
  requestNeededAndroidPermissions: jest.fn(async () => ({})),
};
jest.mock("../../../services/terminal/terminalSdk", () => ({
  loadTerminalSdk: () => mockSdk,
  isTerminalNativeModulePresent: () => true,
}));
jest.mock("../../../hooks/useTapToPayRelease", () => ({
  useTapToPayRelease: () => ({ live: mockLive }),
  tapToPayLive: () => mockLive,
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "brand-1", displayName: "Door Brand", paymentProvider: "stripe", defaultCurrency: "GBP" } }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAuthReady: true }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandId: () => mockBrandId,
}));
let mockRole: { rank: number; isLoading: boolean } = { rank: 60, isLoading: false };
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => mockRole,
}));
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockAvailability: Record<string, unknown> = { available: true, needsSetup: true, reason: "ok" };
jest.mock("../../../hooks/useTapToPayAvailability", () => ({
  ...jest.requireActual("../../../hooks/useTapToPayAvailability"),
  useTapToPayAvailability: () => mockAvailability,
}));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    brand: { id: "brand-1", displayName: "Door Brand", defaultCurrency: "GBP" },
    event: { id: "event-1", brandId: "brand-1", currency: "GBP", tickets: [] },
  }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  Stack: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/IconChrome", () => {
  const mocked: { lastOnPress?: () => void; IconChrome?: unknown } = {};
  mocked.IconChrome = ({ onPress }: { onPress: () => void }) => {
    mocked.lastOnPress = onPress;
    return null;
  };
  return mocked;
});
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  doorSaleKeys: { byEvent: () => ["door-sales"] },
}));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { success: jest.fn() } }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../services/terminal/doorTapEdge", () => ({
  fetchDoorTapLocation: jest.fn(async () => "tml_1"),
  fetchTerminalConnectionToken: jest.fn(async () => "pst"),
  createDoorPayCodeForLines: jest.fn(async () => ({ codeId: "code-1" })),
  createDoorTapIntent: jest.fn(async () => ({
    paymentIntentId: "pi_1",
    clientSecret: "pi_1_secret",
    totalCents: 3135,
    currency: "GBP",
    stripeAccountId: "acct_1",
    locationId: "tml_1",
    feeCents: 135,
    subtotalCents: 3000,
  })),
  completeDoorTapIntent: jest.fn(async () => ({ orderId: "o1", ticketIds: ["t1"], receiptQueued: false, replayed: false })),
  cancelDoorTapIntent: jest.fn(async () => undefined),
  markDoorTapOutcomeSeen: jest.fn(async () => undefined),
  DoorTapError: class DoorTapError extends Error {
    code: string;
    detail: string | null;
    constructor(code: string, detail: string | null = null) {
      super(code);
      this.code = code;
      this.detail = detail;
    }
  },
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() },
}));
jest.mock("../../../services/terminal/howToTap", () => ({
  isTapToPayIphoneEntitled: () => true,
  showHowToTapEducation: jest.fn(async () => "shown"),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));


// eslint-disable-next-line import/first
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import { TapToPayAwarenessModal } from "../tap/TapToPayAwarenessModal";
// eslint-disable-next-line import/first
import { TapNotOnThisPhone } from "../tap/TapNotOnThisPhone";
// eslint-disable-next-line import/first
import { TapUpdateIos } from "../tap/TapUpdateIos";
// eslint-disable-next-line import/first
import { TapToPaySaleScreen } from "../tap/TapToPaySaleScreen";
// eslint-disable-next-line import/first
import { TapToPaySetupScreen } from "../tap/TapToPaySetupScreen";
// eslint-disable-next-line import/first
import { encodeTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
// eslint-disable-next-line import/first
import { resetTapToPaySessionForTests, updateTapToPaySession } from "../../../services/terminal/tapToPaySession";
// eslint-disable-next-line import/first
import { tapToPayMayAcceptTerms, BRAND_ROLE_RANK } from "../../../utils/brandRole";
// eslint-disable-next-line import/first
import { HELP_AND_SUPPORT_ROUTE } from "../../../constants/supportHostFacing";

jest.setTimeout(60_000);

const BIZ_ROOT = path.join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  return tree as ReactTestRenderer;
};
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");
const pressables = (root: ReactTestInstance, id: string): ReactTestInstance[] =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const withOs = (os: string, version: string): void => {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  Object.defineProperty(Platform, "Version", { value: version, configurable: true });
};

/** A bare "Tap to Pay" that isn't the start of "Tap to Pay on iPhone". */
const BARE_NAME = /Tap to Pay(?! on iPhone)/;

const DRAFT = encodeTapToPayDraft({
  lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
  eventDateId: null,
  buyerPhone: null,
  phoneCountryIso: null,
} as never);

const client = (overrides: Record<string, unknown> = {}) => ({
  ensureReaderConnected: async () => ({}),
  checkDeviceSupport: async () => ({ supported: true }),
  retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
  collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } }),
  confirmPaymentIntent: async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } }),
  cancelCollectPaymentMethod: async () => ({}),
  ...overrides,
});

const sale = async (
  session: Record<string, unknown>,
  availability: Record<string, unknown> = { available: true, needsSetup: false, reason: "ok" },
): Promise<ReactTestRenderer> => {
  resetTapToPaySessionForTests();
  mockAvailability = availability;
  updateTapToPaySession(session as never);
  const tree = mount(<TapToPaySaleScreen eventId="event-1" saleId="new" rawDraft={DRAFT} />);
  await settle();
  return tree;
};

const setup = async (
  availability: Record<string, unknown>,
  session: Record<string, unknown> = { status: "ready", client: client() },
): Promise<ReactTestRenderer> => {
  resetTapToPaySessionForTests();
  mockAvailability = availability;
  updateTapToPaySession(session as never);
  const tree = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
  await settle();
  return tree;
};

/** "Get help" is there, is one real tap, and opens Help & Support. */
const expectHelpOpensSupport = (root: ReactTestInstance): void => {
  const help = pressables(root, "tap-get-help");
  expect(help).toHaveLength(1);
  expect(textOf(help[0] as ReactTestInstance)).toContain("Get help");
  mockPush.mockClear();
  act(() => {
    (help[0] as ReactTestInstance).props.onPress();
  });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/account/support");
};

beforeEach(() => {
  withOs("ios", "18.1");
  mockRole = { rank: 60, isLoading: false };
  mockLive = true;
  mockBrandId = "brand-1";
  mockPush.mockClear();
  mockReplace.mockClear();
});
afterAll(() => withOs("ios", "18.1"));

describe("G1 the awareness splash waits for Apple's toolkit", () => {
  test("the assets are null, and the file says where the toolkit files go and what to set", () => {
    const marketing = read("src/constants/tapToPayMarketing.ts");
    expect(marketing).toContain("TAP_TO_PAY_AWARENESS: TapToPayAwarenessAssets | null = null");
    expect(marketing).toContain("mingla-business/assets/tap-to-pay/");
    expect(marketing).toContain('require("../../assets/tap-to-pay/awareness-hero.png")');
  });

  test("with no assets nothing renders, even for an owner on a live brand", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const tree = mount(<TapToPayAwarenessModal />);
    await settle();
    expect(tree.toJSON()).toBeNull();
  });
});

describe("G2 only someone who may accept Apple's terms sees the splash", () => {
  const ASSETS = { hero: 1, title: "Toolkit title", body: "Toolkit body" };
  const shown = async (rank: number): Promise<boolean> => {
    mockRole = { rank, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const { root } = mount(<TapToPayAwarenessModal assets={ASSETS} />);
    await settle();
    return root.findAll((n) => n.props.testID === "tap-awareness-modal").length > 0;
  };

  test("the one rule: brand owner and brand admin yes, everyone below no", () => {
    expect(tapToPayMayAcceptTerms(BRAND_ROLE_RANK.brand_owner)).toBe(true);
    expect(tapToPayMayAcceptTerms(BRAND_ROLE_RANK.brand_admin)).toBe(true);
    expect(tapToPayMayAcceptTerms(BRAND_ROLE_RANK.event_manager)).toBe(false);
    expect(tapToPayMayAcceptTerms(BRAND_ROLE_RANK.finance_manager)).toBe(false);
    expect(tapToPayMayAcceptTerms(BRAND_ROLE_RANK.scanner)).toBe(false);
    expect(tapToPayMayAcceptTerms(0)).toBe(false);
  });

  test("an event manager never sees it; a brand admin and owner do", async () => {
    expect(await shown(BRAND_ROLE_RANK.event_manager)).toBe(false);
    expect(await shown(BRAND_ROLE_RANK.brand_admin)).toBe(true);
    expect(await shown(BRAND_ROLE_RANK.brand_owner)).toBe(true);
  });

  test("setup and the splash both use the shared rule and restate no rank", () => {
    for (const rel of ["src/components/door/tap/TapToPaySetupScreen.tsx", "src/components/door/tap/TapToPayAwarenessModal.tsx"]) {
      const code = read(rel);
      expect([rel, code.includes('import { tapToPayMayAcceptTerms } from "../../../utils/brandRole";')]).toEqual([rel, true]);
      expect([rel, code.includes("tapToPayMayAcceptTerms(role.rank)")]).toEqual([rel, true]);
      expect([rel, /BRAND_ROLE_RANK/.test(code)]).toEqual([rel, false]);
      expect([rel, /export const tapToPayMayAcceptTerms/.test(code)]).toEqual([rel, false]);
    }
  });
});

describe("G3 iPhone says the full name, Android never says iPhone", () => {
  const screens = async (): Promise<Record<string, string>> => ({
    setupNotAvailable: textOf((await setup({ available: false, needsSetup: false, reason: "paystack" })).root),
    setupNotOnThisPhone: textOf((await setup({ available: false, needsSetup: false, reason: "unsupported_device" })).root),
    saleNotAvailable: textOf((await sale({ status: "ready", client: client() }, { available: false, needsSetup: false, reason: "paystack" })).root),
    saleDidNotStart: textOf((await sale({ status: "error", client: null, errorMessage: null })).root),
    notOnThisPhone: textOf(mount(<TapNotOnThisPhone onUsePayCode={jest.fn()} />).root),
  });

  test("iPhone: each limit and failure title and body names Tap to Pay on iPhone", async () => {
    const text = await screens();
    expect(text.setupNotAvailable).toContain("Tap to Pay on iPhone isn't available here");
    expect(text.saleNotAvailable).toContain("Tap to Pay on iPhone isn't available here");
    expect(text.saleDidNotStart).toContain("Tap to Pay on iPhone didn't start");
    expect(text.notOnThisPhone).toContain("Tap to Pay on iPhone needs an iPhone XS or newer");
    expect(text.setupNotOnThisPhone).toContain("Tap to Pay on iPhone needs an iPhone XS or newer");
    for (const [name, value] of Object.entries(text)) expect([name, BARE_NAME.test(value)]).toEqual([name, false]);
  });

  test("iPhone: the sale's failed results never say a bare Tap to Pay", async () => {
    const results = [
      await sale({ status: "ready", client: client({ collectPaymentMethod: async () => ({ error: { code: "CANCELED" } }) }) }),
      await sale({ status: "ready", client: client({ ensureReaderConnected: async () => ({ error: { nativeErrorCode: 3910 } }) }) }),
      await sale({ status: "ready", client: client({ ensureReaderConnected: async () => ({ error: { code: "STRIPE_API_CONNECTION_ERROR" } }) }) }),
    ];
    for (const tree of results) expect(BARE_NAME.test(textOf(tree.root))).toBe(false);
  });

  test("Android: the same screens never say iPhone", async () => {
    withOs("android", "34");
    const text = await screens();
    expect(text.setupNotAvailable).toContain("Tap to Pay isn't available here");
    expect(text.saleDidNotStart).toContain("Tap to Pay didn't start");
    for (const [name, value] of Object.entries(text)) expect([name, value.includes("iPhone")]).toEqual([name, false]);
  });

  test("no door/tap screen hard-codes the short name in a title", () => {
    const dir = path.join(BIZ_ROOT, "src/components/door/tap");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".tsx")) continue;
      const code = fs.readFileSync(path.join(dir, file), "utf8");
      expect([file, /title="Tap to Pay|title=\{`\$\{TAP_TO_PAY_SHORT\}/.test(code)]).toEqual([file, false]);
    }
  });
});

describe("G4 every failed state offers Get help, and it opens Help & Support", () => {
  test("it is the Account tab's own Help & Support route", () => {
    expect(HELP_AND_SUPPORT_ROUTE).toBe("/account/support");
    const account = read("app/(tabs)/account.tsx");
    expect(account).toContain("router.push(HELP_AND_SUPPORT_ROUTE as never);");
    expect(account).not.toContain('"/account/support"');
  });

  describe("setup", () => {
    test("Ask an admin", async () => {
      mockRole = { rank: BRAND_ROLE_RANK.scanner, isLoading: false };
      const { root } = await setup({ available: true, needsSetup: true, reason: "ok" });
      expect(textOf(root)).toContain("Ask an admin");
      expectHelpOpensSupport(root);
    });
    test("This phone can't take taps", async () => {
      const { root } = await setup({ available: false, needsSetup: false, reason: "unsupported_device" });
      expect(textOf(root)).toContain("This phone can't take taps");
      expectHelpOpensSupport(root);
    });
    test("Update iOS", async () => {
      const { root } = await setup({ available: false, needsSetup: false, reason: "ios_update_required" });
      expect(textOf(root)).toContain("Update iOS to use Tap to Pay on iPhone");
      expectHelpOpensSupport(root);
    });
    test("not available for this brand", async () => {
      const { root } = await setup({ available: false, needsSetup: false, reason: "paystack" });
      expect(textOf(root)).toContain("isn't available here");
      expectHelpOpensSupport(root);
    });
    test("a setup press that failed", async () => {
      const { root } = await setup(
        { available: true, needsSetup: true, reason: "ok" },
        { status: "ready", client: client({ ensureReaderConnected: async () => ({ error: { code: "STRIPE_API_CONNECTION_ERROR" } }) }) },
      );
      expect(pressables(root, "tap-get-help")).toHaveLength(0);
      await act(async () => {
        pressables(root, "tap-setup-start")[0]?.props.onPress();
        await Promise.resolve();
      });
      await settle();
      expect(textOf(root)).toContain("Couldn't finish setting up Tap to Pay on iPhone");
      expectHelpOpensSupport(root);
    });
  });

  describe("sale", () => {
    const failing: [string, Record<string, unknown>, Record<string, unknown> | undefined, string][] = [
      [
        "declined",
        {
          status: "ready",
          client: client({
            confirmPaymentIntent: async () => ({
              error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
            }),
          }),
        },
        undefined,
        "tap-state-declined",
      ],
      [
        "timed out",
        { status: "ready", client: client({ collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) }) },
        undefined,
        "tap-state-timed_out",
      ],
      [
        "cancelled",
        { status: "ready", client: client({ collectPaymentMethod: async () => ({ error: { code: "CANCELED" } }) }) },
        undefined,
        "tap-state-cancelled",
      ],
      [
        "card can't be tapped",
        { status: "ready", client: client({ collectPaymentMethod: async () => ({ error: { code: "x", message: "offline_pin_required" } }) }) },
        undefined,
        "tap-state-needs_pin",
      ],
      [
        "reader problem",
        { status: "ready", client: client({ ensureReaderConnected: async () => ({ error: { nativeErrorCode: 3910 } }) }) },
        undefined,
        "tap-state-reader_problem",
      ],
      ["didn't start", { status: "error", client: null, errorMessage: "Couldn't start." }, undefined, "tap-state-terminal_error"],
      [
        "not available here",
        { status: "ready", client: client() },
        { available: false, needsSetup: false, reason: "paystack" },
        "tap-state-not_available",
      ],
      [
        "not on this phone",
        { status: "ready", client: client() },
        { available: false, needsSetup: false, reason: "unsupported_device" },
        "tap-not-on-this-phone",
      ],
      [
        "update iOS",
        { status: "ready", client: client() },
        { available: true, needsSetup: false, reason: "ios_update_required" },
        "tap-state-ios_update_required",
      ],
    ];
    test.each(failing)("%s", async (_name, session, availability, stateId) => {
      const { root } = await sale(session, availability);
      expect(root.findAll((n) => n.props.testID === stateId).length).toBeGreaterThan(0);
      expectHelpOpensSupport(root);
    });

    test("payment didn't start", async () => {
      const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
        createDoorTapIntent: jest.Mock;
        DoorTapError: new (code: string, detail?: string | null) => Error;
      };
      edge.createDoorTapIntent.mockRejectedValueOnce(new edge.DoorTapError("door_ticket_capacity_exceeded"));
      const { root } = await sale({ status: "ready", client: client() });
      expect(textOf(root)).toContain("Payment didn't start");
      expectHelpOpensSupport(root);
    });

    test("payment didn't start because tax is added at checkout", async () => {
      const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
        createDoorTapIntent: jest.Mock;
        DoorTapError: new (code: string, detail?: string | null) => Error;
      };
      edge.createDoorTapIntent.mockRejectedValueOnce(new edge.DoorTapError("door_tax_added_at_checkout"));
      const { root } = await sale({ status: "ready", client: client() });
      expect(textOf(root)).toContain("Payment didn't start");
      expectHelpOpensSupport(root);
    });

    test("paid offers no Get help", async () => {
      const { root } = await sale({ status: "ready", client: client() });
      expect(root.findAll((n) => n.props.testID === "tap-state-approved").length).toBeGreaterThan(0);
      expect(pressables(root, "tap-get-help")).toHaveLength(0);
    });
  });

  test("the shared screens hide Get help when given nowhere to go (no dead tap)", () => {
    expect(pressables(mount(<TapNotOnThisPhone onUsePayCode={jest.fn()} />).root, "tap-get-help")).toHaveLength(0);
    expect(pressables(mount(<TapUpdateIos onUsePayCode={jest.fn()} />).root, "tap-get-help")).toHaveLength(0);
  });
});

describe("G5 Settings shows Apple's Tap to Pay symbol on iPhone", () => {
  test("the Tap to Pay row uses TapToPayIcon on iOS only; Android keeps its generic icon", () => {
    const account = read("app/(tabs)/account.tsx");
    expect(account).toContain('import { TapToPayIcon } from "../../src/components/door/tap/TapToPayIcon";');
    expect(account).toContain('leading={Platform.OS === "ios" ? <TapToPayIcon size={18} /> : undefined}');
    expect(account).toContain("{leading ?? (");
    expect(account).not.toMatch(/name="tap"|icon="tap"/);
  });
  test("TapToPayIcon on iPhone is Apple's wave.3.right.circle.fill SF Symbol", () => {
    jest.isolateModules(() => {
      jest.doMock("expo-symbols", () => ({
        SymbolView: (props: { name: string; testID?: string }) => {
          const { Text } = jest.requireActual("react-native");
          return React.createElement(Text, { testID: props.testID }, props.name);
        },
      }), { virtual: true });
      const { TapToPayIcon } = require("../tap/TapToPayIcon") as typeof import("../tap/TapToPayIcon");
      const { root } = mount(<TapToPayIcon size={18} />);
      expect(textOf(root)).toContain("wave.3.right.circle.fill");
    });
  });
});
