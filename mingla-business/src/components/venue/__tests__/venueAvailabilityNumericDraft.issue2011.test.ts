/**
 * Issue #2011 implementor guard — local strings remain authoritative until one
 * deliberate save. Reverting hydration/validation/patch construction to
 * parse-and-clamp-on-change makes these assertions fail.
 */

import {
  availabilityDraftFromConfig,
  availabilityDraftsEqual,
  buildAvailabilityPatch,
  sanitizeAvailabilityDigits,
  validateAvailabilityDraft,
  VenueAvailabilityModule,
} from "../VenueAvailabilityModule";
import React from "react";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";
import {
  useDeleteVenueBlackout,
  useUpsertVenueAvailabilityConfig,
  useUpsertVenueBlackout,
  useVenueAvailabilityConfig,
  useVenueBlackouts,
} from "../../../hooks/useVenueAvailability";
import { useVenueTables } from "../../../hooks/useVenueTables";
import type { VenueAvailabilityConfig } from "../../../types/venueReservation";

jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => jest.fn() }),
}));
jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: {
    success: jest.fn(),
    warning: jest.fn(),
    selection: jest.fn(),
  },
}));
jest.mock("lucide-react-native", () => ({ ChevronRight: "ChevronRight" }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: jest.fn(),
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useDeleteVenueBlackout: jest.fn(),
  useUpsertVenueAvailabilityConfig: jest.fn(),
  useUpsertVenueBlackout: jest.fn(),
  useVenueAvailabilityConfig: jest.fn(),
  useVenueBlackouts: jest.fn(),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: jest.fn(),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: { getState: jest.fn() },
}));
jest.mock("../../../wrappers/KeyboardToolbarRoot", () => ({
  setAvailabilityNumericToolbarState: jest.fn(),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: "ScrollView",
}));
jest.mock("../../ui/Button", () => ({ Button: "Button" }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: "ConfirmDialog" }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: "GlassCard" }));
jest.mock("../../ui/Input", () => ({ Input: "Input" }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: "Skeleton" }));
jest.mock("../../ui/Toast", () => ({ Toast: "Toast" }));
jest.mock(
  "../../ui/useShareNetworkState",
  () => ({ useShareNetworkState: jest.fn() }),
  { virtual: true },
);
jest.mock("../VenueBlackoutSheet", () => ({
  VenueBlackoutSheet: "VenueBlackoutSheet",
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderNode {
  props: {
    value?: unknown;
    disabled?: unknown;
    onChangeText?: (value: string) => void;
    onPress?: () => void;
  };
}
interface RenderTree {
  root: {
    findByProps: (props: Record<string, unknown>) => RenderNode;
    findAllByProps: (props: Record<string, unknown>) => RenderNode[];
  };
  update: (element: React.ReactElement) => void;
}
// react-test-renderer has no bundled declarations in this repository.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
};
const { act } = TestRenderer;

const config: VenueAvailabilityConfig = {
  brandId: "brand-1",
  venueId: "venue-1",
  servicePeriods: [],
  turnTimes: { p2: 75, p4: 90, p6: 120, p8: 150 },
  bufferMinutes: 0,
  maxReservationsPerSlot: null,
  slotGranularityMinutes: 15,
  advanceWindowDays: 30,
  minNoticeMinutes: 0,
  ianaTimezone: "Africa/Lagos",
  ianaTimezoneSource: "operator",
};

let liveConfig = config;
const mutateConfig = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  liveConfig = config;
  jest.mocked(useCurrentBrandRole).mockReturnValue({ rank: 100 } as never);
  jest.mocked(useVenueAvailabilityConfig).mockImplementation(
    () =>
      ({
        data: liveConfig,
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: jest.fn(),
      }) as never,
  );
  jest
    .mocked(useUpsertVenueAvailabilityConfig)
    .mockReturnValue({ mutate: mutateConfig, isPending: false } as never);
  jest.mocked(useVenueBlackouts).mockReturnValue({ data: [] } as never);
  jest
    .mocked(useUpsertVenueBlackout)
    .mockReturnValue({ mutate: jest.fn(), isPending: false } as never);
  jest
    .mocked(useDeleteVenueBlackout)
    .mockReturnValue({ mutate: jest.fn(), isPending: false } as never);
  jest.mocked(useVenueTables).mockReturnValue({ data: [] } as never);
  const network = jest.requireMock("../../ui/useShareNetworkState") as {
    useShareNetworkState: jest.Mock;
  };
  network.useShareNetworkState.mockReturnValue(true);
});

describe("issue #2011 availability numeric draft", () => {
  it("hydrates editable strings and preserves the legacy zero-as-omitted turn meaning", () => {
    const draft = availabilityDraftFromConfig({
      ...config,
      turnTimes: { ...config.turnTimes, p2: 0 },
    });
    expect(draft["turnTimes.1-2"]).toBe("");
    expect(draft["turnTimes.3-4"]).toBe("90");
    expect(draft.maxReservationsPerSlot).toBe("");
    expect(draft.minNoticeMinutes).toBe("0");
  });

  it("keeps partial text visible and sanitizes paste without parsing or clamping", () => {
    expect(sanitizeAvailabilityDigits("12a0")).toBe("120");
    expect(sanitizeAvailabilityDigits("")).toBe("");
    expect(sanitizeAvailabilityDigits("99999")).toBe("99999");
  });

  it("reports exact range/set errors while leaving the invalid strings intact", () => {
    const draft = {
      ...availabilityDraftFromConfig(config),
      "turnTimes.1-2": "601",
      bufferMinutes: "",
      maxReservationsPerSlot: "0",
      slotGranularityMinutes: "16",
      advanceWindowDays: "366",
      minNoticeMinutes: "10081",
    };
    expect(validateAvailabilityDraft(draft)).toEqual({
      "turnTimes.1-2": "Enter 1–600 minutes, or leave blank.",
      "turnTimes.3-4": null,
      "turnTimes.5-6": null,
      "turnTimes.7+": null,
      bufferMinutes: "Enter 0–240 minutes.",
      maxReservationsPerSlot: "Enter 1–999, or leave blank for all tables.",
      slotGranularityMinutes: "Use 5, 10, 15, 20, 30, or 60 minutes.",
      advanceWindowDays: "Enter 0–365 days.",
      minNoticeMinutes: "Enter 0–10,080 minutes.",
    });
    expect(draft.minNoticeMinutes).toBe("10081");
    expect(() => buildAvailabilityPatch(draft)).toThrow(
      "availability_draft_invalid",
    );
  });

  it("builds one complete coherent patch only at save time", () => {
    const before = availabilityDraftFromConfig(config);
    const draft = {
      ...before,
      "turnTimes.1-2": "120",
      "turnTimes.7+": "",
      bufferMinutes: "30",
      maxReservationsPerSlot: "8",
      minNoticeMinutes: "120",
    };
    expect(availabilityDraftsEqual(before, draft)).toBe(false);
    expect(buildAvailabilityPatch(draft)).toEqual({
      turnTimes: { p2: 120, p4: 90, p6: 120 },
      bufferMinutes: 30,
      maxReservationsPerSlot: 8,
      slotGranularityMinutes: 15,
      advanceWindowDays: 30,
      minNoticeMinutes: 120,
    });
  });

  it("renders the real module, protects a dirty draft from refetch, then performs one save", () => {
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(VenueAvailabilityModule, {
          brandId: "brand-1",
          venueId: "venue-1",
        }),
      );
    });

    const p2 = () =>
      renderer!.root.findByProps({ testID: "venue-avail-turn-p2" });
    expect(p2().props.value).toBe("75");

    act(() => p2().props.onChangeText?.("120"));
    expect(mutateConfig).not.toHaveBeenCalled();
    expect(p2().props.value).toBe("120");

    liveConfig = { ...config, turnTimes: { ...config.turnTimes, p2: 30 } };
    act(() => {
      renderer!.update(
        React.createElement(VenueAvailabilityModule, {
          brandId: "brand-1",
          venueId: "venue-1",
        }),
      );
    });
    expect(p2().props.value).toBe("120");

    const save = renderer!.root.findByProps({ testID: "venue-avail-save" });
    expect(save.props.disabled).toBe(false);
    act(() => save.props.onPress?.());
    expect(mutateConfig).toHaveBeenCalledTimes(1);
    expect(mutateConfig.mock.calls[0]?.[0]).toEqual({
      turnTimes: { p2: 120, p4: 90, p6: 120, p8: 150 },
      bufferMinutes: 0,
      maxReservationsPerSlot: null,
      slotGranularityMinutes: 15,
      advanceWindowDays: 30,
      minNoticeMinutes: 0,
    });
  });

  it("renders numeric controls read-only without a save action for lower roles", () => {
    jest.mocked(useCurrentBrandRole).mockReturnValue({ rank: 10 } as never);
    let renderer!: RenderTree;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(VenueAvailabilityModule, {
          brandId: "brand-1",
          venueId: "venue-1",
        }),
      );
    });
    expect(
      renderer!.root.findByProps({ testID: "venue-avail-turn-p2" }).props
        .disabled,
    ).toBe(true);
    expect(
      renderer!.root.findAllByProps({ testID: "venue-avail-save" }),
    ).toHaveLength(0);
  });
});
