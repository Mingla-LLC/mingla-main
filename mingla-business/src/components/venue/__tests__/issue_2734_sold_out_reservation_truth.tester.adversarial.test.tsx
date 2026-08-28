import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  Linking,
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";
import type { ThemePalette } from "@mingla/offering-rendering";
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

const mockCaptureWeb = jest.fn();
const mockCreateReservation = jest.fn((_input: unknown) =>
  Promise.resolve({
    kind: "free_completed" as const,
    reservationId: "reservation-2734-tester",
  }),
);
const mockOpenUrl = jest
  .spyOn(Linking, "openURL")
  .mockResolvedValue(undefined);
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

const DARK_PALETTE = createThemePalette(
  resolveTheme({ color: "#2563eb" }, { color: "#16a34a" }),
);
const LIGHT_PALETTE: ThemePalette = {
  ...DARK_PALETTE,
  page: "#ffffff",
  card: "#f8fafc",
  primaryText: "#111827",
  secondaryText: "#475569",
  tertiaryText: "#64748b",
  panelBorder: "#cbd5e1",
};

const OPEN_730: AvailableSlot = {
  slotStartUtc: "2026-08-29T23:30:00.000Z",
  slotLocalLabel: "7:30 PM",
  remaining: 2,
  isFull: false,
};
const FULL_730: AvailableSlot = { ...OPEN_730, remaining: 0, isFull: true };
const OPEN_800: AvailableSlot = {
  slotStartUtc: "2026-08-30T00:00:00.000Z",
  slotLocalLabel: "8:00 PM",
  remaining: 2,
  isFull: false,
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

const renderElement = (palette: ThemePalette): React.ReactElement => (
  <GuestVenueReservation
    venueId="venue-2734"
    brandId="brand-2734"
    currency="USD"
    analyticsSurface="buyer_web"
    palette={palette}
  />
);

const render = async (
  palette: ThemePalette = DARK_PALETTE,
): Promise<TestRendererInstance> => {
  let tree!: TestRendererInstance;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(renderElement(palette));
  });
  return tree;
};

const rerender = async (
  tree: TestRendererInstance,
  palette: ThemePalette = DARK_PALETTE,
): Promise<void> => {
  await TestRenderer.act(async () => {
    tree.update(renderElement(palette));
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

const press = (node: TestInstance): void => {
  const callback = node.props.onPress;
  if (typeof callback !== "function") throw new Error("Missing onPress");
  callback();
};

const pressCallback = (node: TestInstance): (() => void) => {
  const callback = node.props.onPress;
  if (typeof callback !== "function") throw new Error("Missing onPress");
  return callback as () => void;
};

const slotSelectedCalls = (): unknown[][] =>
  mockCaptureWeb.mock.calls.filter(
    ([event]) => event === "venue_reservation_slot_selected",
  );

const submittedCalls = (): unknown[][] =>
  mockCaptureWeb.mock.calls.filter(
    ([event]) => event === "public_venue_reservation_submitted",
  );

const fullLabelNode = (root: TestInstance, time: string): TestInstance => {
  const match = root.findAll(
    (node) =>
      Array.isArray(node.props.children) &&
      node.props.children.join("") === `${time} · Full`,
  )[0];
  if (match === undefined) throw new Error(`Missing visible ${time} · Full`);
  return match;
};

const expectFullContract = (
  root: TestInstance,
  palette: ThemePalette,
): TestInstance => {
  const full = findByProp(root, "accessibilityLabel", "7:30 PM, full");
  expect(full.type).toBe(Pressable);
  expect(full.props.disabled).toBe(true);
  expect(full.props.accessibilityState).toEqual({
    disabled: true,
    selected: false,
  });
  const fullStyle =
    StyleSheet.flatten(full.props.style as StyleProp<ViewStyle>) ?? {};
  expect(fullStyle.opacity ?? 1).toBe(1);
  expect(fullStyle.borderColor).toBe(palette.panelBorder);
  const textStyle =
    StyleSheet.flatten(
      fullLabelNode(root, "7:30 PM").props.style as StyleProp<TextStyle>,
    ) ?? {};
  expect(textStyle.color).toBe(palette.secondaryText);
  return full;
};

describe("issue #2734 sold-out reservation truth — tester adversarial", () => {
  beforeEach(() => {
    mockAvailabilityFixture = fixture([OPEN_730]);
    mockCaptureWeb.mockClear();
    mockCreateReservation.mockClear();
    mockOpenUrl.mockClear();
    mockRefetch.mockClear();
  });

  test("open → fetching → full invalidates selection and every captured action", async () => {
    const tree = await render();
    const initiallyOpen = findByProp(
      tree.root,
      "accessibilityLabel",
      "Select 7:30 PM",
    );
    const capturedOpenPress = pressCallback(initiallyOpen);
    await TestRenderer.act(async () => {
      press(initiallyOpen);
    });
    expect(slotSelectedCalls()).toHaveLength(1);
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
    expect(submittedCalls()).toHaveLength(0);

    mockAvailabilityFixture = fixture([FULL_730]);
    await rerender(tree);
    const currentFullPress = pressCallback(
      expectFullContract(tree.root, DARK_PALETTE),
    );
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.props.label === "Confirm reservation"),
    ).toHaveLength(0);

    await TestRenderer.act(async () => {
      capturedOpenPress();
      currentFullPress();
      capturedSubmit();
    });
    expect(slotSelectedCalls()).toHaveLength(1);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(submittedCalls()).toHaveLength(0);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    expectFullContract(tree.root, DARK_PALETTE);
    await unmount(tree);
  });

  test("a missing selected row cannot be revived by stale slot or submit callbacks", async () => {
    const tree = await render();
    const initiallyOpen = findByProp(
      tree.root,
      "accessibilityLabel",
      "Select 7:30 PM",
    );
    const capturedOpenPress = pressCallback(initiallyOpen);
    await TestRenderer.act(async () => {
      press(initiallyOpen);
    });
    const capturedSubmit = pressCallback(
      findByProp(tree.root, "label", "Confirm reservation"),
    );

    mockAvailabilityFixture = fixture([OPEN_800]);
    await rerender(tree);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    await TestRenderer.act(async () => {
      capturedOpenPress();
      capturedSubmit();
    });
    expect(slotSelectedCalls()).toHaveLength(1);
    expect(mockCreateReservation).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
    expect(submittedCalls()).toHaveLength(0);
    expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
    await unmount(tree);
  });

  test.each([
    ["dark", DARK_PALETTE],
    ["light", LIGHT_PALETTE],
  ])(
    "%s all-full rows keep exact readable tokens and reject direct activation",
    async (_mode, palette) => {
      mockAvailabilityFixture = fixture([FULL_730]);
      const tree = await render(palette);
      const full = expectFullContract(tree.root, palette);
      const fullPress = pressCallback(full);
      await TestRenderer.act(async () => {
        fullPress();
      });
      expect(slotSelectedCalls()).toHaveLength(0);
      expect(findText(tree.root, "NAME · REQUIRED")).toHaveLength(0);
      expectFullContract(tree.root, palette);
      await unmount(tree);
    },
  );
});
