/**
 * #4271 — the refund reason box tells hosts how much more to type, rendered.
 *
 * Seth's live refund went through, but the reason box only said "Min 10
 * characters" in grey and "Send refund" stayed disabled with no explanation.
 * Both RefundSheet (online orders) and DoorRefundSheet (door sales) are mounted
 * for real; only their data hooks and chrome are mocked.
 *   R1  door polish: ONE helper line counts down live: empty -> "At least 10
 *       characters.", "2 more characters needed.", "1 more character needed.",
 *       then quiet; no "0 / 200" counter until 180 characters.
 *   R2  tapping Send while the reason is too short turns that same line red
 *       ("N more characters needed. Reasons need at least 10."), focuses the
 *       box, and sends nothing; with a valid reason the same tap sends the refund.
 *
 *   R3  (PR #4303 rework) when the server says the refund failed (code
 *       "refund_failed"), the next Send uses a NEW idempotency key, so it starts
 *       a new refund; any other error keeps the same key (same refund).
 *
 * FAILS-ON-REVERT: dropping the key reset in RefundSheet fails R3; restoring the
 * old helper, the always-on counter, or `disabled={!canSubmit}` (the silent dead
 * button) in either sheet fails R1/R2.
 */
import React from "react";

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
// The RN jest preset's TextInput shares one focus() mock across instances.
const MockNativeMethods = require("react-native/jest/MockNativeMethods").default as {
  focus: jest.Mock;
};

const mountedTrees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (let tree = mountedTrees.pop(); tree; tree = mountedTrees.pop()) tree.unmount();
  });
});

const mockRefundOrder = jest.fn();
const mockRefundDoorSale = jest.fn();

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? children : null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Button", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    Button: ({
      label,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => (
      <Text
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: disabled === true }}
        onPress={disabled === true ? undefined : onPress}
      >
        {label}
      </Text>
    ),
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native");
  return { ScrollView: View };
});
jest.mock("../../../services/supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useEventOrders", () => ({
  useRefundOrder: () => ({ mutateAsync: mockRefundOrder, isPending: false }),
}));
jest.mock("../../../hooks/useRefundPreview", () => ({
  useRefundPreview: () => ({
    data: {
      amountCents: 2000,
      remainingCents: 2000,
      withinRemaining: true,
      lines: [{ orderLineItemId: "line-1", quantity: 2, amountCents: 2000 }],
    },
    isPending: false,
    isFetching: false,
    isDebouncing: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useRefundDoorSale: () => ({ mutateAsync: mockRefundDoorSale }),
}));

// eslint-disable-next-line import/first
import { RefundSheet } from "../RefundSheet";
// eslint-disable-next-line import/first
import { DoorRefundSheet } from "../../door/DoorRefundSheet";

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  mountedTrees.push(tree as ReactTestRenderer);
  return tree as ReactTestRenderer;
};

const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map(textOf);

const reasonBox = (tree: ReactTestRenderer): ReactTestInstance =>
  tree.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith("Refund reason") &&
      typeof node.props.onChangeText === "function",
  )[0];

const sendButton = (tree: ReactTestRenderer): ReactTestInstance =>
  tree.root.findAll(
    (node) => node.props.accessibilityLabel === "Send refund" && node.props.accessibilityState !== undefined,
  )[0];

const type = (tree: ReactTestRenderer, value: string): void => {
  act(() => {
    reasonBox(tree).props.onChangeText(value);
  });
};

const order = {
  id: "order-1",
  eventId: "event-1",
  brandId: "brand-1",
  currency: "GBP",
  totalCents: 2000,
  totalGbpAtPurchase: 20,
  refundedAmountGbp: 0,
  refundedAmountCents: 0,
  lines: [
    {
      orderLineItemId: "line-1",
      ticketTypeId: "tier-1",
      ticketNameAtPurchase: "General",
      unitPriceGbpAtPurchase: 10,
      quantity: 2,
      refundedQuantity: 0,
    },
  ],
} as unknown as React.ComponentProps<typeof RefundSheet>["order"];

const sale = {
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  currency: "GBP",
  totalAtSale: 20,
  totalGbpAtSale: 20,
  refundedAmount: 0,
  refundedAmountGbp: 0,
  refunds: [],
  lines: [
    {
      ticketTypeId: "tier-1",
      ticketNameAtSale: "General",
      unitPriceGbpAtSale: 10,
      quantity: 2,
      refundedQuantity: 0,
    },
  ],
} as unknown as React.ComponentProps<typeof DoorRefundSheet>["sale"];

const sheets: Array<[string, () => React.ReactElement, (tree: ReactTestRenderer) => void]> = [
  [
    "RefundSheet",
    () => <RefundSheet visible mode="full" order={order} onClose={jest.fn()} onSuccess={jest.fn()} />,
    () => undefined,
  ],
  [
    "DoorRefundSheet",
    () => <DoorRefundSheet visible sale={sale} onClose={jest.fn()} onSuccess={jest.fn()} />,
    (tree) => {
      // A door refund needs a ticket picked before Send is ready.
      const plus = tree.root.findAll(
        (node) => typeof node.props.accessibilityLabel === "string" &&
          /increase|add one|more/i.test(node.props.accessibilityLabel) &&
          typeof node.props.onPress === "function",
      )[0];
      act(() => {
        plus.props.onPress();
      });
    },
  ],
];

describe("#4271 refund reason countdown (rendered)", () => {
  beforeEach(() => {
    mockRefundOrder.mockReset().mockResolvedValue({ amountCents: 2000 });
    mockRefundDoorSale.mockReset().mockResolvedValue({
      amountCents: 1000,
      refundedAmountCents: 1000,
      refundId: "refund-1",
      status: "partial",
    });
  });

  test.each(sheets)("R1 %s counts down to the minimum and keeps the counter", (_name, element, ready) => {
    const tree = mount(element());
    ready(tree);
    expect(texts(tree)).toContain("At least 10 characters.");
    expect(texts(tree).some((line) => line.includes("/ 200"))).toBe(false);
    expect(texts(tree).some((line) => line.includes("Min 10"))).toBe(false);
    type(tree, "Too late");
    expect(texts(tree)).toContain("2 more characters needed.");
    type(tree, "Too late!");
    expect(texts(tree)).toContain("1 more character needed.");
    type(tree, "Too late!!");
    expect(texts(tree).some((line) => line.includes("needed"))).toBe(false);
    expect(texts(tree).some((line) => line.includes("/ 200"))).toBe(false);
    type(tree, "x".repeat(188));
    expect(texts(tree)).toContain("188 / 200");
  });

  test.each(sheets)("R2 %s explains a short reason on Send instead of doing nothing", async (name, element, ready) => {
    const tree = mount(element());
    ready(tree);
    type(tree, "Short");
    const focusCallsBefore = MockNativeMethods.focus.mock.calls.length;
    const send = sendButton(tree);
    expect(send.props.accessibilityState).toEqual({ disabled: false });
    await act(async () => {
      await send.props.onPress();
    });
    expect(texts(tree)).toContain("5 more characters needed. Reasons need at least 10.");
    const alert = tree.root.findAll(
      (node) => typeof node.type === "string" && node.props.accessibilityRole === "alert" && textOf(node).includes("Reasons need"),
    );
    expect(alert.length).toBeGreaterThan(0);
    expect(MockNativeMethods.focus.mock.calls.length).toBe(focusCallsBefore + 1);
    const submit = name === "RefundSheet" ? mockRefundOrder : mockRefundDoorSale;
    expect(submit).not.toHaveBeenCalled();

    type(tree, "Guest could not attend");
    expect(texts(tree).some((line) => line.includes("Reasons need at least"))).toBe(false);
    await act(async () => {
      await sendButton(tree).props.onPress();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].reason).toBe("Guest could not attend");
  });

  test("R4 RefundSheet's reason box tells a screen reader it is required, like the door one", () => {
    const tree = mount(<RefundSheet visible mode="full" order={order} onClose={jest.fn()} onSuccess={jest.fn()} />);
    expect(reasonBox(tree).props.accessibilityLabel).toBe("Refund reason, required, at least 10 characters");
  });

  test("R3 RefundSheet starts a new refund after a failed one, and reuses the key otherwise", async () => {
    const tree = mount(<RefundSheet visible mode="full" order={order} onClose={jest.fn()} onSuccess={jest.fn()} />);
    type(tree, "Guest could not attend");
    const send = async (): Promise<void> => {
      await act(async () => {
        await sendButton(tree).props.onPress();
      });
    };
    mockRefundOrder.mockReset();
    mockRefundOrder.mockRejectedValueOnce(Object.assign(new Error("declined"), { code: "stripe_declined" }));
    await send();
    mockRefundOrder.mockRejectedValueOnce(Object.assign(new Error("failed"), { code: "refund_failed" }));
    await send();
    mockRefundOrder.mockResolvedValueOnce({ amountCents: 2000 });
    await send();
    const keys = mockRefundOrder.mock.calls.map((call) => call[0].idempotencyKey as string);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});

// #4271 door polish (design items 5 and 7): the door refund sheet, rendered.
describe("#4271 door polish: door refund sheet", () => {
  const { StyleSheet } = jest.requireActual("react-native") as typeof import("react-native");
  const door = (): ReactTestRenderer =>
    mount(<DoorRefundSheet visible sale={sale} onClose={jest.fn()} onSuccess={jest.fn()} />);

  test("one sentence about check-in, no footer note, no filler, no Cancel", () => {
    const all = texts(door());
    expect(all).toContain("The buyer stays checked in. Only the money goes back.");
    expect(all.some((line) => line.includes("un-check-in"))).toBe(false);
    expect(all.some((line) => line.includes("Total updates as you select."))).toBe(false);
    expect(all).not.toContain("Cancel");
    expect(all).toContain("Reason");
    expect(all.some((line) => line.includes("*"))).toBe(false);
  });

  test("44pt steppers named for the ticket", () => {
    const tree = door();
    const more = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Refund one more General" && typeof node.props.onPress === "function",
    )[0];
    const fewer = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Refund one fewer General" && typeof node.props.onPress === "function",
    )[0];
    expect(StyleSheet.flatten(more.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(StyleSheet.flatten(fewer.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(texts(tree).some((line) => line.includes("2 left"))).toBe(true);
  });

  test("the reason box tells a screen reader it is required", () => {
    const box = reasonBox(door());
    expect(box.props.accessibilityLabel).toBe("Refund reason, required, at least 10 characters");
    expect(box.props.placeholder).toBe("e.g. Charged twice at the door");
  });
});
