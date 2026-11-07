/**
 * #4271 door polish — tester adversarial (rendered). Different angle from the
 * implementor's render suites: it presses the money controls and counts what
 * reached the card rail, instead of reading labels.
 *
 *   M1  "Paid, still saving": Save again re-saves the SAME payment (complete
 *       again, same intent and request id) and never creates, collects or
 *       confirms a new one; no pay code, no new-card path; the body never points
 *       at a button the screen doesn't have.
 *   M2  "Checking the payment": Check again only re-confirms; no new intent, no
 *       new card read, no pay code, no receipt link, no Try another card.
 *   M3  approved / declined / timed out keep Send receipt on the same handler,
 *       with the right outcome and no guest name in the shared text.
 *   S1  the sale sheet with Tap to Pay unavailable: the default pick is the pay
 *       code, there is no Tap to Pay row, and the one button follows the pick.
 *   S2  dock messages that only rendering shows: access-check failure outranks
 *       "no bank", a pay code refusal replaces the quote hint, no tiers means no
 *       button at all.
 *   S3  the header close is disabled while a pay code is being made and the
 *       sheet cannot be closed from it.
 *   F1  a fully refunded door sale shows no reason box and no Refund button.
 *   T1-T5  retest: the slim Tap to Pay button (one press opens one sale; off
 *       for a tax refusal or a sale in flight; a blocked reason survives
 *       re-renders that are not edits; cash cannot pre-know a tax refusal).
 *   T6-T9  retest: a tax refusal on the tap screen reads no card and says why;
 *       T7: its pay code fallback never blames the connection;
 *       VoiceOver hears a repeated unknown once; Android gets no direct call.
 */
import React from "react";
import { Platform, Share } from "react-native";

interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
  unmount: () => void;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

const mountedTrees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (let tree = mountedTrees.pop(); tree; tree = mountedTrees.pop()) tree.unmount();
  });
});

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../tap/TapToPayIcon", () => ({ TapToPayIcon: () => null }));
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
jest.mock("../../ui/IconChrome", () => {
  const { Pressable } = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    IconChrome: (props: Record<string, unknown>) =>
      ReactLocal.createElement(Pressable, {
        onPress: props.onPress,
        disabled: props.disabled,
        accessibilityLabel: props.accessibilityLabel,
        testID: props.testID ?? "icon-chrome",
      }),
  };
});
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children, visible }: { children: React.ReactNode; visible: boolean }) => (visible ? children : null),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native");
  return { ScrollView: View };
});
jest.mock("react-native-keyboard-controller", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }): React.ReactNode => children ?? null;
  return {
    KeyboardProvider: Passthrough,
    KeyboardToolbar: Passthrough,
    KeyboardAwareScrollView: Passthrough,
    useReanimatedKeyboardAnimation: () => ({ height: { value: 0 }, progress: { value: 0 } }),
    useKeyboardState: () => ({ isVisible: false }),
  };
});
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  Stack: () => null,
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("../../../hooks/useTapToPayRelease", () => ({
  useTapToPayRelease: () => ({ live: true }),
  tapToPayLive: () => true,
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "brand-1", displayName: "Door Brand", paymentProvider: "stripe", defaultCurrency: "GBP" } }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAuthReady: true }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandId: () => "brand-1",
}));
jest.mock("../../../services/terminal/terminalSdk", () => ({
  loadTerminalSdk: () => null,
  isTerminalNativeModulePresent: () => true,
}));
let mockAvailability: Record<string, unknown> = { available: true, needsSetup: false, reason: "ok" };
jest.mock("../../../hooks/useTapToPayAvailability", () => ({
  ...jest.requireActual("../../../hooks/useTapToPayAvailability"),
  useTapToPayAvailability: () => mockAvailability,
}));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    brand: { id: "brand-1", displayName: "Door Brand", defaultCurrency: "GBP" },
    event: { id: "event-1", brandId: "brand-1", name: "Night", currency: "GBP", tickets: [] },
  }),
}));
jest.mock("../../../hooks/useEventDateKeys", () => ({
  useEventDateKeys: () => ({ data: [], isLoading: false }),
}));
let mockPermission: Record<string, unknown> = { data: true, isError: false };
let mockQuote: Record<string, unknown> = { data: undefined, isLoading: true };
const mockCreatePayCode = jest.fn();
const mockRecordSale = jest.fn();
jest.mock("../../../hooks/useEventDoorSales", () => ({
  doorSaleKeys: { byEvent: () => ["door-sales"] },
  useRecordDoorSale: () => ({ mutateAsync: mockRecordSale }),
  useCreateDoorPayCode: () => ({ mutateAsync: mockCreatePayCode }),
  useCanTakeDoorPayment: () => mockPermission,
  useDoorPayCodeQuote: () => mockQuote,
  useRefundDoorSale: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100, isLoading: false }),
}));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { success: jest.fn() } }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn(), from: jest.fn() },
}));
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
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

// eslint-disable-next-line import/first
import { TapToPaySaleScreen } from "../tap/TapToPaySaleScreen";
// eslint-disable-next-line import/first
import { encodeTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
// eslint-disable-next-line import/first
import { resetTapToPaySessionForTests, updateTapToPaySession } from "../../../services/terminal/tapToPaySession";
// eslint-disable-next-line import/first
import { DoorSaleNewSheet } from "../DoorSaleNewSheet";
// eslint-disable-next-line import/first
import { DoorRefundSheet } from "../DoorRefundSheet";

Object.defineProperty(Platform, "Version", { value: "18.1", configurable: true });
jest.setTimeout(60_000);

const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  mountedTrees.push(tree as ReactTestRenderer);
  return tree as ReactTestRenderer;
};
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
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");
const pressables = (root: ReactTestInstance, testID: string): ReactTestInstance[] =>
  root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function" && typeof n.type !== "string");
const labelled = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
  root.findAll((n) => n.props.label === label && typeof n.props.onPress === "function");

const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as Record<string, jest.Mock>;

// ---------------------------------------------------------------------------
// Tap to Pay sale screen: money controls
// ---------------------------------------------------------------------------

describe("Tap to Pay money controls", () => {
  const terminal = (overrides: Record<string, jest.Mock | (() => unknown)> = {}) => {
    const t = {
      ensureReaderConnected: jest.fn(async () => ({})),
      retrievePaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_1" } })),
      collectPaymentMethod: jest.fn(async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } })),
      confirmPaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } })),
      cancelCollectPaymentMethod: jest.fn(async () => ({})),
      ...overrides,
    };
    return t;
  };
  const draft = (buyerName?: string): string =>
    encodeTapToPayDraft({
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: null,
      buyerPhone: null,
      phoneCountryIso: null,
      ...(buyerName !== undefined ? { buyerName } : {}),
    });
  const sale = async (t: Record<string, unknown>, rawDraft = draft()): Promise<ReactTestRenderer> => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: t as never });
    const tree = mount(<TapToPaySaleScreen eventId="event-1" saleId="new" rawDraft={rawDraft} />);
    await settle();
    return tree;
  };
  const noNewMoneyPath = (root: ReactTestInstance): void => {
    expect(root.findAll((n) => n.props.testID === "tap-show-pay-code")).toHaveLength(0);
    expect(textOf(root)).not.toContain("pay code");
    expect(labelled(root, "Try another card")).toHaveLength(0);
    expect(labelled(root, "Try again")).toHaveLength(0);
    expect(root.findAll((n) => n.props.testID === "tap-send-receipt")).toHaveLength(0);
  };

  beforeEach(() => {
    for (const fn of Object.values(edge)) if (typeof fn.mockClear === "function") fn.mockClear();
  });

  test("M1 Paid, still saving: Save again re-saves the same payment and never takes a new one", async () => {
    edge.completeDoorTapIntent.mockRejectedValueOnce(new Error("offline"));
    const t = terminal();
    const { root } = await sale(t);
    expect(textOf(root)).toContain("Paid, still saving");
    expect(textOf(root)).toContain("The guest has paid. Don't take this payment again.");
    expect(root.findAll((n) => n.props.testID === "tap-tone-caution" && typeof n.type === "string").length).toBe(1);
    noNewMoneyPath(root);
    expect(edge.completeDoorTapIntent).toHaveBeenCalledTimes(1);
    const first = edge.completeDoorTapIntent.mock.calls[0]?.[0] as Record<string, unknown>;

    await act(async () => {
      pressables(root, "tap-save-again")[0].props.onPress();
    });
    await settle();

    expect(edge.completeDoorTapIntent).toHaveBeenCalledTimes(2);
    expect(edge.completeDoorTapIntent.mock.calls[1]?.[0]).toEqual(first);
    expect(edge.createDoorTapIntent).toHaveBeenCalledTimes(1);
    expect(t.collectPaymentMethod).toHaveBeenCalledTimes(1);
    expect(t.confirmPaymentIntent).toHaveBeenCalledTimes(1);
    expect(textOf(root)).toContain("Paid £31.35");
  });

  test("M1 Paid, still saving: the body names the button the screen actually shows", async () => {
    edge.completeDoorTapIntent.mockRejectedValueOnce(new Error("offline"));
    const { root } = await sale(terminal());
    const buttons = root
      .findAll((n) => typeof n.props.label === "string" && typeof n.props.onPress === "function")
      .map((n) => n.props.label as string);
    expect(buttons).toEqual(["Save again"]);
    // The flow's message tells the host which button to press. It must be one that exists.
    const body = textOf(root);
    // The body must name a button, and that button must be the one on screen.
    const named = body.match(/Tap (Try again|Save again|[A-Z][a-z]+ again)/)?.[1];
    expect(named).toBe("Save again");
    expect(buttons).toContain(named);
    expect(body).not.toContain("Try again");
  });

  test("M2 Checking the payment: Check again re-confirms only, and offers nothing that charges", async () => {
    const confirm = jest
      .fn()
      .mockResolvedValueOnce({ error: { code: "STRIPE_API_ERROR" } })
      .mockResolvedValueOnce({ error: { code: "STRIPE_API_ERROR" } })
      .mockResolvedValue({ paymentIntent: { id: "pi_1", status: "succeeded" } });
    const t = terminal({ confirmPaymentIntent: confirm });
    const { root } = await sale(t);
    expect(root.findAll((n) => n.props.testID === "tap-tone-caution" && typeof n.type === "string").length).toBe(1);
    noNewMoneyPath(root);
    // Two presses while it is still unknown: still the same payment both times.
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        pressables(root, "tap-unknown-retry")[0].props.onPress();
      });
      await settle();
    }
    expect(confirm).toHaveBeenCalledTimes(3);
    for (const call of confirm.mock.calls) expect(call[0]).toEqual(confirm.mock.calls[0][0]);
    expect(edge.createDoorTapIntent).toHaveBeenCalledTimes(1);
    expect(t.collectPaymentMethod).toHaveBeenCalledTimes(1);
    expect(edge.cancelDoorTapIntent).not.toHaveBeenCalled();
    expect(edge.createDoorPayCodeForLines).not.toHaveBeenCalled();
  });

  test.each([
    ["approved", {}, "Approved."],
    [
      "declined",
      {
        confirmPaymentIntent: async () => ({
          error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
        }),
      },
      "Not approved. No money was taken.",
    ],
    ["timed out", { collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) }, "Not approved. No money was taken."],
  ] as const)("M3 %s keeps Send receipt, with the right outcome and no guest name", async (_label, overrides, line) => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    const { root } = await sale(terminal(overrides as never), draft("Ada Obi"));
    const link = pressables(root, "tap-send-receipt");
    expect(link).toHaveLength(1);
    expect(link[0].props.accessibilityRole).toBe("button");
    await act(async () => {
      link[0].props.onPress();
    });
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain(line);
    expect(message).not.toContain("Ada");
    share.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The sale sheet
// ---------------------------------------------------------------------------

const tier = {
  id: "tier-1",
  name: "General",
  isFree: false,
  priceGbp: 15,
  currency: "GBP",
  visibility: "public",
  availableAt: "both",
  displayOrder: 0,
  validDayIds: null,
};

const sheet = (props: Record<string, unknown> = {}, event: Record<string, unknown> = {}): React.ReactElement => (
  <DoorSaleNewSheet
    visible
    event={{ id: "event-1", currency: "GBP", tickets: [tier], ...event } as never}
    onClose={(props.onClose as () => void) ?? jest.fn()}
    onSuccess={jest.fn()}
    initialLines={[{ ticketTypeId: "tier-1", quantity: 2 }]}
    brand={null}
    {...props}
  />
);
const submit = (root: ReactTestInstance): ReactTestInstance => pressables(root, "door-sale-submit")[0];
const dockLine = (root: ReactTestInstance): string[] =>
  root
    .findAll(
      (n) =>
        typeof n.type === "string" &&
        ["door-sale-dock-message", "door-sale-tap-blocked", "door-sale-tax-refusal"].includes(n.props.testID),
    )
    .map((n) => textOf(n));

describe("Sale sheet", () => {
  beforeEach(() => {
    mockPermission = { data: true, isError: false };
    mockQuote = { data: { totalCents: 3135, subtotalCents: 3000, feeCents: 135, currency: "GBP" }, isLoading: false };
    mockCreatePayCode.mockReset();
    mockPush.mockClear();
  });

  test("S1 no Tap to Pay here: pay code is the pick, no Tap to Pay row, the button follows the pick", () => {
    mockAvailability = { available: false, needsSetup: false, reason: "unsupported" };
    const { root } = mount(sheet());
    expect(root.findAll((n) => n.props.testID === "door-sale-method-tap_to_pay")).toHaveLength(0);
    expect(textOf(root)).not.toContain("Tap to Pay");
    const payRow = root.findAll((n) => n.props.testID === "door-sale-method-pay_code" && typeof n.props.onPress === "function")[0];
    expect(payRow.props.accessibilityState).toEqual({ selected: true });
    expect(textOf(submit(root)).trim()).toBe("Show pay code");
    // Move to cash, then back: the one button follows every pick.
    act(() => {
      root.findAll((n) => n.props.testID === "door-sale-method-cash" && typeof n.props.onPress === "function")[0].props.onPress();
    });
    expect(textOf(submit(root)).trim()).toBe("Complete sale");
    expect(root.findAll((n) => n.props.testID === "door-sale-submit" && "label" in n.props)).toHaveLength(1);
  });

  test("S1 Paystack: the pay code row speaks Nigerian rails", () => {
    mockAvailability = { available: false, needsSetup: false, reason: "paystack" };
    const { root } = mount(sheet({}, { currency: "NGN", tickets: [{ ...tier, currency: "NGN" }] }));
    expect(textOf(root)).toContain("They scan a code and pay by card, bank transfer or USSD.");
    expect(textOf(root)).not.toContain("Tap to Pay");
  });

  test("S2 access check failed outranks no bank, and the cash button stays off", () => {
    mockAvailability = { available: false, needsSetup: false, reason: "unsupported" };
    mockPermission = { data: undefined, isError: true };
    const { root } = mount(sheet({ initialMethod: "cash" }, { currency: null }));
    expect(dockLine(root)).toEqual(["Couldn't check your door access. Check your connection and try again."]);
    expect(submit(root).props.disabled).toBe(true);
  });

  test("S2 a refused pay code replaces the quote hint, and picking another row clears it", async () => {
    mockAvailability = { available: false, needsSetup: false, reason: "unsupported" };
    mockQuote = { data: undefined, isLoading: true };
    const { DoorPayCodeError } = jest.requireActual("../../../services/doorPayCodeService") as {
      DoorPayCodeError: new (code: string, message?: string) => Error;
    };
    mockCreatePayCode.mockRejectedValueOnce(new DoorPayCodeError("door_ticket_capacity_exceeded", "x"));
    const { root } = mount(sheet());
    expect(dockLine(root)).toEqual(["The pay code shows the final total, with any fees."]);
    await act(async () => {
      await submit(root).props.onPress();
    });
    expect(dockLine(root)).toEqual(["Not enough tickets left for this sale."]);
    act(() => {
      root.findAll((n) => n.props.testID === "door-sale-method-cash" && typeof n.props.onPress === "function")[0].props.onPress();
    });
    expect(dockLine(root)).toEqual([]);
  });

  test("S2 no door tiers: no button at all, so nothing dead to press", () => {
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    const { root } = mount(sheet({ initialLines: [] }, { tickets: [] }));
    expect(textOf(root)).toContain("No tiers available for door sales");
    expect(pressables(root, "door-sale-submit")).toHaveLength(0);
  });

  test("S3 while a pay code is being made the header close is off and does nothing", async () => {
    mockAvailability = { available: false, needsSetup: false, reason: "unsupported" };
    let release: (value: unknown) => void = () => undefined;
    mockCreatePayCode.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const onClose = jest.fn();
    const { root } = mount(sheet({ onClose }));
    act(() => {
      void submit(root).props.onPress();
    });
    const close = pressables(root, "door-sale-close")[0];
    expect(close.props.disabled).toBe(true);
    act(() => {
      close.props.onPress();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      release({ codeId: "code-1" });
    });
    // The code was made: the sheet closes itself and opens it, exactly once.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/event/event-1/door/pay/code-1");
  });
});

// ---------------------------------------------------------------------------
// Door refund: fully refunded
// ---------------------------------------------------------------------------

describe("Door refund sheet", () => {
  test("F1 fully refunded: no reason box, no Refund button, only the close", () => {
    const sale = {
      id: "sale-1",
      eventId: "event-1",
      brandId: "brand-1",
      currency: "GBP",
      lines: [
        {
          ticketTypeId: "tier-1",
          ticketNameAtSale: "General",
          quantity: 2,
          refundedQuantity: 2,
          unitPriceGbpAtSale: 15,
          isFreeAtSale: false,
        },
      ],
      totalGbpAtSale: 30,
      totalAtSale: 30,
      refundedAmountGbp: 30,
      refundedAmount: 30,
      refunds: [],
      status: "refunded_full",
    };
    const { root } = mount(<DoorRefundSheet visible sale={sale as never} onClose={jest.fn()} onSuccess={jest.fn()} />);
    const text = textOf(root);
    expect(text).toContain("Already fully refunded.");
    expect(root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Refund reason"))).toHaveLength(0);
    expect(text).not.toMatch(/Refund £/);
    expect(pressables(root, "door-refund-close").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Retest of 6981d7956e: the slim Tap to Pay button, blocked reasons, announces
// ---------------------------------------------------------------------------

describe("Retest: the slim Tap to Pay button under the dock", () => {
  const slim = (root: ReactTestInstance): ReactTestInstance[] =>
    root.findAll((n) => n.props.testID === "door-sale-tap-dock" && typeof n.props.onPress === "function");
  beforeEach(() => {
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    mockPermission = { data: true, isError: false };
    mockQuote = { data: { totalCents: 3135, subtotalCents: 3000, feeCents: 135, currency: "GBP" }, isLoading: false };
    mockCreatePayCode.mockReset();
    mockRecordSale.mockReset();
    mockPush.mockClear();
  });

  test("T1 from the pay code pick: one press closes the sheet once and opens Tap to Pay with this basket", () => {
    const onClose = jest.fn();
    const { root } = mount(sheet({ initialMethod: "pay_code", onClose }));
    expect(slim(root)).toHaveLength(1);
    expect(slim(root)[0].props.disabled).toBe(false);
    act(() => {
      slim(root)[0].props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = String(mockPush.mock.calls[0]?.[0]);
    expect(href).toContain("/event/event-1/door/tap/new");
    expect(mockCreatePayCode).not.toHaveBeenCalled();
    expect(mockRecordSale).not.toHaveBeenCalled();
  });

  test("T2 the pay code pick on a tax-at-checkout event: the slim button is off and opens nothing", () => {
    mockQuote = { data: undefined, isLoading: false, isError: true, error: { code: "door_tax_added_at_checkout" } };
    const { root } = mount(sheet({ initialMethod: "pay_code" }));
    const button = slim(root)[0];
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("T3 while a cash sale is saving the slim button is off; it never takes over a sale in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    mockRecordSale.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { root } = mount(sheet({ initialMethod: "cash" }));
    expect(slim(root)[0].props.disabled).toBe(false);
    act(() => {
      void submit(root).props.onPress();
    });
    expect(slim(root)[0].props.disabled).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      release({ id: "sale-1" });
    });
  });

  test("T4 a blocked reason survives a re-render that changes nothing the host typed", () => {
    const tree = mount(sheet({ initialMethod: "cash", initialLines: [] }));
    act(() => {
      slim(tree.root)[0].props.onPress();
    });
    expect(dockLine(tree.root)).toEqual(["Pick at least one ticket first."]);
    // A fresh quote object and a permission refetch are not edits.
    mockQuote = { data: { totalCents: 3135, subtotalCents: 3000, feeCents: 135, currency: "GBP" }, isLoading: false };
    mockPermission = { data: true, isError: false };
    act(() => {
      (tree as unknown as { update: (e: React.ReactElement) => void }).update(sheet({ initialMethod: "cash", initialLines: [] }));
    });
    expect(dockLine(tree.root)).toEqual(["Pick at least one ticket first."]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test("T5 a cash pick on a tax-at-checkout event cannot know the refusal: the press opens Tap to Pay, the server refuses", () => {
    // The quote does not run for cash, so the sheet cannot pre-know. Pinned so a
    // change here is deliberate; the tap screen must explain it (T6).
    mockQuote = { data: undefined, isLoading: false, isError: true, error: { code: "door_tax_added_at_checkout" } };
    const { root } = mount(sheet({ initialMethod: "cash" }));
    expect(slim(root)[0].props.disabled).toBe(false);
    act(() => {
      slim(root)[0].props.onPress();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe("Retest: Tap to Pay screen refusals and VoiceOver", () => {
  const draftRaw = encodeTapToPayDraft({
    lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
    eventDateId: null,
    buyerPhone: null,
    phoneCountryIso: null,
  });
  const terminalOk = (overrides: Record<string, unknown> = {}) => ({
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_1" } })),
    collectPaymentMethod: jest.fn(async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } })),
    confirmPaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } })),
    cancelCollectPaymentMethod: jest.fn(async () => ({})),
    ...overrides,
  });
  const open = async (t: Record<string, unknown>): Promise<ReactTestRenderer> => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: t as never });
    const tree = mount(<TapToPaySaleScreen eventId="event-1" saleId="new" rawDraft={draftRaw} />);
    await settle();
    return tree;
  };
  const { AccessibilityInfo } = jest.requireActual("react-native") as typeof import("react-native");
  let announce: jest.SpyInstance;
  const originalOs = Platform.OS;
  beforeEach(() => {
    for (const fn of Object.values(edge)) if (typeof fn.mockClear === "function") fn.mockClear();
    announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
  });
  afterEach(() => {
    announce.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOs, configurable: true });
  });

  test("T6 tax added at checkout: no card is read, and the screen says why in words", async () => {
    const { DoorTapError } = edge as unknown as { DoorTapError: new (code: string) => Error };
    edge.createDoorTapIntent.mockRejectedValueOnce(new DoorTapError("door_tax_added_at_checkout"));
    const t = terminalOk();
    const { root } = await open(t);
    expect(root.findAll((n) => n.props.testID === "tap-state-failed" && typeof n.type !== "string").length).toBeGreaterThan(0);
    expect(textOf(root)).toContain("tax is added at checkout");
    expect(t.collectPaymentMethod).not.toHaveBeenCalled();
    expect(t.confirmPaymentIntent).not.toHaveBeenCalled();
    // The host can always leave: the close is live.
    const close = root.findAll((n) => n.props.accessibilityLabel === "Close" && typeof n.props.onPress === "function");
    expect(close.length).toBeGreaterThan(0);
    expect(close[0].props.disabled).not.toBe(true);
  });

  // Retest of 6981d7956e (P2, fixed): on that tax refusal the screen offered
  // "Show a pay code instead"; the pay code server refuses the same event for
  // the same reason, and the screen then blamed the connection.
  test("T7 tax refusal: Show a pay code instead never blames the connection", async () => {
    const { DoorTapError } = edge as unknown as { DoorTapError: new (code: string) => Error };
    edge.createDoorTapIntent.mockRejectedValueOnce(new DoorTapError("door_tax_added_at_checkout"));
    edge.createDoorPayCodeForLines.mockRejectedValueOnce(new Error("door_tax_added_at_checkout"));
    const { root } = await open(terminalOk());
    const payCode = root.findAll((n) => n.props.testID === "tap-show-pay-code" && typeof n.props.onPress === "function");
    if (payCode.length > 0) {
      await act(async () => {
        payCode[0].props.onPress();
      });
      await settle();
    }
    expect(textOf(root)).not.toContain("Check your connection");
  });

  test("T8 iOS: a re-check that comes back unknown again is not read out a second time", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const confirm = jest.fn(async () => ({ error: { code: "STRIPE_API_ERROR" } }));
    const { root } = await open(terminalOk({ confirmPaymentIntent: confirm }));
    expect(announce).toHaveBeenCalledTimes(1);
    await act(async () => {
      pressables(root, "tap-unknown-retry")[0].props.onPress();
    });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  test("T9 Android: caution and bad states use the live region, never a direct announcement", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    await open(terminalOk({ confirmPaymentIntent: async () => ({ error: { code: "STRIPE_API_ERROR" } }) }));
    expect(announce).not.toHaveBeenCalled();
  });
});
