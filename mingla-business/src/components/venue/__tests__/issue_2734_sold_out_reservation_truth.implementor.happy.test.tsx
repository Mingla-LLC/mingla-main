import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";
import type { AvailableSlot } from "../../../types/venueReservation";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface AvailabilityFixture {
  data: AvailableSlot[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: jest.Mock;
}

const mockCaptureWeb = jest.fn();
const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({
    kind: "free_completed" as const,
    reservationId: "reservation-2734",
  }),
);
const mockRefetch = jest.fn();
let mockAvailabilityFixture: AvailabilityFixture;

jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: (...args: unknown[]) => mockCaptureWeb(...args),
  getStoredClickAttribution: () => ({ clickId: null }),
}));

jest.mock("../../../hooks/usePublicVenueAvailability", () => ({
  __esModule: true,
  usePublicVenueAvailability: () => mockAvailabilityFixture,
}));

jest.mock("../../../services/venueGuestReservationService", () => ({
  __esModule: true,
  createGuestVenueReservation: (input: unknown) => mockCreateReservation(input),
}));

jest.mock("../../../services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: async () => undefined,
  getVenueOrganicJourneyToken: () => null,
}));

jest.mock("../../../services/venueOrganicCapturePolicy", () => ({
  __esModule: true,
  runBuyerVenueOrganicCapture: () => undefined,
}));

jest.mock("../../../utils/phone", () => ({
  __esModule: true,
  composeE164: () => "+19195550180",
}));

jest.mock("@mingla/phone-input", () => ({
  __esModule: true,
  PhoneInput: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("PhoneInput", props);
  },
  getCountryByCode: () => ({ dialCode: "+1" }),
  getDefaultCountryCode: () => "US",
}));

jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Button", props);
  },
}));

jest.mock("../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof React;
    return ReactActual.createElement("Input", props);
  },
}));

jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
}));

import { GuestVenueReservation } from "../GuestVenueReservation";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestRendererInstance {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const PALETTE = createThemePalette(
  resolveTheme({ color: "#2563eb" }, { color: "#16a34a" }),
);
const OPEN_730: AvailableSlot = {
  slotStartUtc: "2026-08-29T23:30:00.000Z",
  slotLocalLabel: "7:30 PM",
  remaining: 2,
  isFull: false,
};
const FULL_730: AvailableSlot = { ...OPEN_730, remaining: 0, isFull: true };
const FULL_800: AvailableSlot = {
  slotStartUtc: "2026-08-30T00:00:00.000Z",
  slotLocalLabel: "8:00 PM",
  remaining: 0,
  isFull: true,
};

const fixture = (
  data: AvailableSlot[] | undefined,
  overrides: Partial<Omit<AvailabilityFixture, "data" | "refetch">> = {},
): AvailabilityFixture => ({
  data,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: mockRefetch,
  ...overrides,
});

const renderElement = (): React.ReactElement => (
  <GuestVenueReservation
    venueId="venue-2734"
    brandId="brand-2734"
    currency="USD"
    analyticsSurface="buyer_web"
    palette={PALETTE}
  />
);

const render = async (): Promise<TestRendererInstance> => {
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(renderElement());
  });
  return tree;
};

const rerender = async (tree: TestRendererInstance): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.update(renderElement());
  });
};

const unmount = async (tree: TestRendererInstance): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.unmount();
  });
};

const findByProp = (
  root: TestInstance,
  prop: string,
  value: unknown,
): TestInstance => {
  const match = root.findAll((node) => node.props[prop] === value)[0];
  if (match === undefined) throw new Error(`Missing ${prop}=${String(value)}`);
  return match;
};

const findText = (root: TestInstance, copy: string): TestInstance[] =>
  root.findAll(
    (node) => typeof node.type === "string" && node.props.children === copy,
  );

const invoke = (
  node: TestInstance,
  prop: "onPress" | "onChangeText",
  value?: string,
): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function") throw new Error(`Missing ${prop}`);
  callback(value);
};

const pressCallback = (node: TestInstance): (() => void) => {
  const callback = node.props.onPress;
  if (typeof callback !== "function") throw new Error("Missing onPress");
  return callback as () => void;
};

const flattenedViewStyle = (node: TestInstance): ViewStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {};

const flattenedTextStyle = (node: TestInstance): TextStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {};

const assertFullSlotContract = (root: TestInstance, time: string): void => {
  const chip = findByProp(root, "accessibilityLabel", `${time}, full`);
  const chipStyle = flattenedViewStyle(chip);
  expect(chip.props.disabled).toBe(true);
  expect(chip.props.accessibilityState).toEqual({
    disabled: true,
    selected: false,
  });
  expect(chipStyle.opacity ?? 1).toBe(1);
  expect(chipStyle.backgroundColor).toBeUndefined();
  expect(chipStyle.borderColor).toBe(PALETTE.panelBorder);
  expect(chipStyle.minHeight).toBe(44);
  expect(chipStyle.justifyContent).toBe("center");
  expect(chipStyle.borderWidth).toBe(1);
  expect(chipStyle.paddingHorizontal).toBe(16);

  const label = root.findAll(
    (node) =>
      Array.isArray(node.props.children) &&
      node.props.children.join("") === `${time} · Full`,
  )[0];
  if (label === undefined) throw new Error(`Missing visible ${time} · Full`);
  expect(flattenedTextStyle(label).color).toBe(PALETTE.secondaryText);
};

describe("issue #2734 sold-out reservation truth — implementor happy path", () => {
  beforeEach(() => {
    mockAvailabilityFixture = fixture([]);
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockClear();
    mockRefetch.mockClear();
  });

  test("keeps a settled empty result distinct from sold-out rows", async () => {
    const tree = await render();
    expect(findText(tree.root, "No tables for this day.")).toHaveLength(1);
    expect(findText(tree.root, "Try another date.")).toHaveLength(1);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.props.label === "Confirm reservation"),
    ).toHaveLength(0);
    await unmount(tree);
  });

  test("renders every all-full row in server order with readable exact semantics", async () => {
    mockAvailabilityFixture = fixture([FULL_730, FULL_800]);
    const tree = await render();

    expect(findText(tree.root, "No tables for this day.")).toHaveLength(0);
    const slotLabels = tree.root
      .findAll(
        (node) =>
          node.type === Pressable &&
          typeof node.props.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.endsWith(", full"),
      )
      .map((node) => node.props.accessibilityLabel);
    expect(slotLabels).toEqual(["7:30 PM, full", "8:00 PM, full"]);
    assertFullSlotContract(tree.root, "7:30 PM");
    assertFullSlotContract(tree.root, "8:00 PM");
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    expect(findText(tree.root, "Sold out")).toHaveLength(0);
    expect(findText(tree.root, "All tables are full")).toHaveLength(0);
    await unmount(tree);
  });

  test("keeps mixed rows in order and preserves open selection treatment", async () => {
    mockAvailabilityFixture = fixture([
      FULL_730,
      { ...OPEN_730, ...FULL_800, isFull: false, remaining: 2 },
    ]);
    const tree = await render();

    const labels = tree.root
      .findAll(
        (node) =>
          (node.type === Pressable &&
            node.props.accessibilityLabel === "7:30 PM, full") ||
          (node.type === Pressable &&
            node.props.accessibilityLabel === "Select 8:00 PM"),
      )
      .map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["7:30 PM, full", "Select 8:00 PM"]);
    assertFullSlotContract(tree.root, "7:30 PM");

    const open = findByProp(tree.root, "accessibilityLabel", "Select 8:00 PM");
    expect(open.props.disabled).toBe(false);
    expect(open.props.accessibilityState).toEqual({
      disabled: false,
      selected: false,
    });
    const openLabel = tree.root.findAll(
      (node) =>
        Array.isArray(node.props.children) &&
        node.props.children
          .filter((child) => typeof child === "string")
          .join("") === "8:00 PM",
    )[0];
    if (openLabel === undefined) throw new Error("Missing visible 8:00 PM");
    expect(flattenedTextStyle(openLabel).color).toBe(PALETTE.primaryText);
    await TestRenderer.act(async () => {
      invoke(open, "onPress");
    });
    const selected = findByProp(
      tree.root,
      "accessibilityLabel",
      "Select 8:00 PM",
    );
    expect(selected.props.accessibilityState).toEqual({
      disabled: false,
      selected: true,
    });
    const selectedStyle = flattenedViewStyle(selected);
    expect(selectedStyle.borderColor).toBe(PALETTE.accent);
    expect(selectedStyle.backgroundColor).toBe(PALETTE.accentWash);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(1);
    await unmount(tree);
  });

  test("submits the unchanged valid-open payload and analytics exactly once", async () => {
    mockAvailabilityFixture = fixture([OPEN_730]);
    const tree = await render();
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Select 7:30 PM"),
        "onPress",
      );
    });
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Name, required"),
        "onChangeText",
        "Ada Lovelace",
      );
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Email, required"),
        "onChangeText",
        "ada@example.com",
      );
    });
    await TestRenderer.act(async () => {
      invoke(findByProp(tree.root, "label", "Confirm reservation"), "onPress");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockCreateReservation).toHaveBeenCalledTimes(1);
    expect(mockCreateReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        reservedForUtc: OPEN_730.slotStartUtc,
        partySize: 2,
      }),
    );
    expect(
      mockCaptureWeb.mock.calls.filter(
        ([event]) => event === "public_venue_reservation_submitted",
      ),
    ).toHaveLength(1);
    await unmount(tree);
  });

  test("retains the open form but fails closed while a refresh is unsettled", async () => {
    mockAvailabilityFixture = fixture([OPEN_730]);
    const tree = await render();
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Select 7:30 PM"),
        "onPress",
      );
    });
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Name, required"),
        "onChangeText",
        "Ada Lovelace",
      );
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Email, required"),
        "onChangeText",
        "ada@example.com",
      );
    });
    const capturedSubmit = pressCallback(
      findByProp(tree.root, "label", "Confirm reservation"),
    );

    mockAvailabilityFixture = fixture([OPEN_730], { isFetching: true });
    await rerender(tree);
    expect(findText(tree.root, "Finding open tables…")).toHaveLength(1);
    expect(
      findByProp(tree.root, "label", "Confirm reservation").props.disabled,
    ).toBe(true);
    await TestRenderer.act(async () => {
      capturedSubmit();
    });
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(
      mockCaptureWeb.mock.calls.filter(
        ([event]) => event === "public_venue_reservation_submitted",
      ),
    ).toHaveLength(0);
    await unmount(tree);
  });

  test("keeps the retryable error state and blocks the prior selection", async () => {
    mockAvailabilityFixture = fixture([OPEN_730]);
    const tree = await render();
    await TestRenderer.act(async () => {
      invoke(
        findByProp(tree.root, "accessibilityLabel", "Select 7:30 PM"),
        "onPress",
      );
    });
    const capturedSubmit = pressCallback(
      findByProp(tree.root, "label", "Confirm reservation"),
    );
    mockAvailabilityFixture = fixture(undefined, { isError: true });
    await rerender(tree);

    expect(findText(tree.root, "We couldn’t load times.")).toHaveLength(1);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    await TestRenderer.act(async () => {
      invoke(findByProp(tree.root, "label", "Try again"), "onPress");
      capturedSubmit();
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    await unmount(tree);
  });
});
