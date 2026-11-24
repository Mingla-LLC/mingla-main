/**
 * issue #4522 G-10 — naira on one checkout screen read "NGN 1,200,000.00" on
 * one line (the quote summary) and "₦1,200,000.00" on the next (the payment
 * page's own copy of the formatter). One owner now: quoteMoney.ts, with the
 * shared glyph rule. A naira total in minor units is the real shape (kobo).
 *
 * Calls the REAL formatter, mounts the REAL discount field and the REAL trip
 * payment step (inside the REAL CartProvider) and reads what they show.
 * Also (W-11 readable accent): the payment step's "Total due today" label and
 * amount paint with the readable accent text token, never the orange fill.
 *
 * FAILS ON REVERT: take withCurrencyGlyph out of quoteMoney.ts, give the
 * payment page / discount field their own Intl formatter again, or paint
 * dueTodayLabel / dueTodayValue with color.accent.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import { Platform, StyleSheet } from "react-native";

import { formatQuoteMoney } from "../quoteMoney";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: Array<Node | string>;
  findAll: (p: (n: Node) => boolean) => Node[];
};
type Renderer = { root: Node; toJSON: () => unknown; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_EVENT_ID = "45220000-0000-4000-8000-0000000000a1";
const TICKET_TYPE_ID = "45220000-0000-4000-8000-0000000000a2";
const V2_PLAN = {
  v: 2,
  deposit: { mode: "amount", amount_minor: 30000000 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
  flex: { enabled: false },
};
let mockPricingTiers: unknown[] = [];

const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock("../../../analytics/discountAnalytics", () => ({ captureDiscountEvent: () => undefined }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" } } },
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Path: () => null, Circle: () => null }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ tripEventId: "45220000-0000-4000-8000-0000000000a1" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: {
      trip: {
        id: "45220000-0000-4000-8000-0000000000a1",
        title: "Lagos Weekend",
        slug: "lagos-weekend",
        brandSlug: "minglanigeria",
        currency: "NGN",
        pricingTiers: mockPricingTiers,
        businessTrip: { startAt: "2027-12-01T18:00:00.000Z", endAt: "2027-12-03T18:00:00.000Z" },
      },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useIntakeSchema", () => ({
  useTripIntakeSchemasByEvent: () => ({ data: new Map(), isLoading: false, isFetching: false, isError: false }),
}));
jest.mock("../../../services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable
        testID={`btn-${props.label}`}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={props.disabled === true ? undefined : props.onPress}
      />
    ),
  };
});
jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return { GlassCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../CheckoutHeader", () => ({
  CheckoutHeader: () => null,
  CheckoutStatusBanner: ({ body }: { body: string }) => {
    const { Text } = jest.requireActual("react-native");
    const { createElement } = jest.requireActual("react");
    return createElement(Text, null, body);
  },
}));
jest.mock("../../trip/TripPaymentChoice", () => ({ TripPaymentChoice: () => null }));

import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CartProvider, useCart } from "../CartContext";
import { color } from "../checkoutTheme";
import { DiscountCodeField } from "../DiscountCodeField";
import { TicketQuoteSummary } from "../TicketQuoteSummary";
import { ticketQuoteFromLines } from "./ticketQuoteFixture";
import PaymentScreen from "../../../../app/checkout-trip/[tripEventId]/payment";

const textOf = (node: Node): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const allText = (tree: Renderer): string[] =>
  tree.root.findAll((n) => n.type === "Text").map(textOf);

/** 1,200,000 naira, in kobo. */
const TOTAL_KOBO = 120000000;

const SeedCart: React.FC<{ plan: boolean }> = ({ plan }) => {
  const { setLineQuantity, setBuyer, setQuoteState, setPaymentPlanChoice } = useCart();
  React.useEffect(() => {
    const line = {
      ticketTypeId: TICKET_TYPE_ID,
      ticketName: "Shared room",
      unitPrice: TOTAL_KOBO / 100,
      unitPriceAllIn: TOTAL_KOBO / 100,
      currency: "NGN",
      isFree: false,
      quantity: 1,
    };
    setLineQuantity(line);
    if (plan) setPaymentPlanChoice("installments");
    const quote = ticketQuoteFromLines([line]) as TicketQuote;
    setQuoteState(plan ? { ...quote, dueTodayNetCents: 30000000 } : quote, "ready");
    setBuyer({
      name: "Ada Guest",
      email: "ada@example.test",
      phone: "+2348012345678",
      termsAccepted: true,
      marketingOptIn: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const mounted: Renderer[] = [];
afterEach(async () => {
  while (mounted.length > 0) {
    const tree = mounted.pop();
    if (tree !== undefined) await act(async () => tree.unmount());
  }
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "web");
});

const mountPayment = async (plan: boolean): Promise<Renderer> => {
  mockPricingTiers = plan
    ? [{ ticketTypeId: TICKET_TYPE_ID, name: "Shared room", priceCents: TOTAL_KOBO, paymentPlan: V2_PLAN, installmentSchedule: null }]
    : [];
  let tree!: Renderer;
  await act(async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <CartProvider>
          <SeedCart plan={plan} />
          <PaymentScreen />
        </CartProvider>
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  return tree;
};

describe("#4522 G-10 one checkout money formatter", () => {
  test("naira reads with the glyph, never the NGN code", () => {
    const text = formatQuoteMoney(TOTAL_KOBO, "NGN");
    expect(text).toContain("₦");
    expect(text).not.toContain("NGN");
    expect(text).toContain("1,200,000.00");
  });

  test("dollars are unchanged", () => {
    expect(formatQuoteMoney(30000, "USD")).toContain("300.00");
  });

  test("the discount field shows a naira saving with the glyph", async () => {
    const quote = {
      ...(ticketQuoteFromLines([
        { ticketTypeId: TICKET_TYPE_ID, ticketName: "Room", unitPrice: 1000, unitPriceAllIn: 1000, currency: "NGN", isFree: false, quantity: 1 },
      ] as never) as TicketQuote),
      discounts: [{ discountId: "d1", kind: "code", name: "Save", code: "SAVE", amountMinor: TOTAL_KOBO, units: 1 }],
      codeOutcome: { status: "applied", reason: null, required: null, with: null, replaced: [] },
    } as unknown as TicketQuote;
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <DiscountCodeField value="SAVE" quote={quote} quoteStatus="ready" onApply={() => undefined} onRemove={() => undefined} />,
      );
    });
    mounted.push(tree);
    const saving = allText(tree).find((t) => t.startsWith("Saving"));
    expect(saving).toBeDefined();
    expect(saving).toContain("₦");
    expect(saving).toContain("1,200,000.00");
    expect(saving).not.toContain("NGN");
  });

  test("the trip payment step shows the naira total and Pay amount with the glyph", async () => {
    const tree = await mountPayment(false);
    const pay = tree.root.findAll((n) => String(n.props.testID ?? "").startsWith("btn-Pay"))[0];
    expect(String(pay?.props.accessibilityLabel)).toContain("₦1,200,000.00");
    const shown = allText(tree);
    expect(shown.some((t) => t.includes("₦1,200,000.00"))).toBe(true);
    expect(shown.filter((t) => /NGN\s?\d/.test(t))).toEqual([]);
  });
});

describe("#4522 W-11 — the payment step's Total due today is readable", () => {
  test("label and amount paint with the readable accent text token, not the orange fill", async () => {
    const tree = await mountPayment(true);
    // The order summary box also says "Total due today" (its own total row);
    // this is the step's own sticky line under it.
    const inSummary = (n: Node): boolean => {
      for (let p = n.parent; p !== null; p = p.parent) if (p.type === TicketQuoteSummary) return true;
      return false;
    };
    const label = tree.root.findAll(
      (n) => n.type === "Text" && textOf(n) === "Total due today" && !inSummary(n),
    );
    expect(label.length).toBe(1);
    let row = label[0].parent as Node;
    while (row.type !== "View") row = row.parent as Node;
    const texts = row.findAll((n) => n.type === "Text");
    expect(texts.length).toBe(2);
    expect(textOf(texts[1])).toContain("₦300,000.00");
    expect(color.accentText).not.toBe(color.accent);
    for (const t of texts) {
      expect(StyleSheet.flatten(t.props.style as never)).toMatchObject({ color: color.accentText });
    }
  });
});
