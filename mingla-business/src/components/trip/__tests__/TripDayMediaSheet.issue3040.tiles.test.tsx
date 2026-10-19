/**
 * #3040 B-C12 / Appendix A §6 — the trip-day sheet's tiles, driven for real.
 *
 * Renders TripDayMediaSheet with the picker and the upload service stubbed,
 * then walks the tile states a host sees: an offline failure parks the tile
 * as G-04 Paused and resumes it by itself on reconnect; an online failure is
 * G-06 "Tap to retry" and a tap retries the SAME file in place; a refusal is
 * G-07 "Can't use"; a failure keeps the sheet open with an in-sheet alert and
 * the sheet closes once everything settled. The itinerary passes the day key.
 * MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | a trip-day item that failed in flight keeps a visible owner (retry, resume or remove), never a silent drop
 * FAILS ON REVERT: drop the paused auto-resume, the in-place retry, the
 * keep-open-on-failure close rule, or the dayKey the parent passes.
 */
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    update: (element: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const network: { isConnected: boolean | null } = { isConnected: true };
const upload = jest.fn();

jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: network.isConnected, isInternetReachable: network.isConnected }),
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: "EventCoverMedia" }));
jest.mock("../../ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../../ui/Button", () => ({ Button: "Button" }));
jest.mock("react-native-svg", () => ({ __esModule: true, default: "Svg", Circle: "Circle" }));
jest.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: "ScrollView" }));
jest.mock("../../../utils/platformImagePicker", () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));
jest.mock("../../../utils/browserFilePicker", () => ({
  pickBrowserFiles: jest.fn(async () => ({
    canceled: false,
    files: [{ name: "day.mp4", size: 40_000_000, mimeType: "video/mp4", uri: "blob:day", file: {} }],
  })),
  validateBrowserFile: jest.fn(),
  revokeBrowserPickedFiles: jest.fn(),
}));
jest.mock("../../ui/pickedVideoDuration", () => ({ readPickedVideoDurationMs: jest.fn(async () => 45_000) }));
jest.mock("../../../utils/normalizeTripDayImage", () => ({ normalizeTripDayImage: jest.fn(async (asset: unknown) => asset) }));
jest.mock("../../../services/giphyEventCoverService", () => ({ searchGiphyEventCovers: jest.fn() }));
jest.mock("../../../services/pexelsEventCoverService", () => ({ searchPexelsEventCovers: jest.fn() }));
jest.mock("../../../services/coverProviderBrowseService", () => ({
  curatedPexelsCovers: jest.fn(),
  trendingGiphyCovers: jest.fn(),
}));
jest.mock("../../../services/tripDayMediaService", () => ({
  uploadTripDayMedia: (...args: unknown[]) => upload(...args),
  MAX_TRIP_DAY_MEDIA: 8,
  TRIP_DAY_MEDIA_IMAGE_MAX_BYTES: 25 * 1024 * 1024,
  TRIP_DAY_MEDIA_VIDEO_MAX_BYTES: 104_857_600,
  tripDayVideoErrorCopy: () => "Couldn't upload that video. Try again.",
}));

// eslint-disable-next-line import/first
import { TripDayMediaSheet } from "../TripDayMediaSheet";

const coded = (code: string): Error => Object.assign(new Error(code), { code });
const MEDIA = { url: "https://cdn.example/g/play_1080p.mp4", type: "video" as const, provider: "bunny" };

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const mount = async (props: { onAddMedia: jest.Mock; onClose: jest.Mock; onShowToast: jest.Mock }) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const element = (): React.ReactElement => (
    <TripDayMediaSheet
      visible
      brandId="brand-1"
      eventId="event-1"
      currentCount={0}
      dayKey="day-2"
      {...props}
    />
  );
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(element());
  });
  const tile = (stateId: string): Node[] =>
    renderer.root.findAll((node) => node.props.testID === `trip-day-tile-${stateId}` && typeof node.type !== "string");
  const pick = async (): Promise<void> => {
    const [button] = renderer.root.findAll((node) => node.type === "Button" && node.props.label === "Choose from library");
    await TestRenderer.act(async () => {
      (button.props.onPress as () => void)();
      await flush();
    });
  };
  const rerender = async (): Promise<void> => {
    await TestRenderer.act(async () => {
      renderer.update(element());
      await flush();
    });
  };
  const alerts = (): string[] =>
    renderer.root
      .findAll((node) => node.type === "Text" && node.props.accessibilityRole === "alert")
      .map((node) => String(node.props.children));
  return { renderer, tile, pick, rerender, alerts };
};

describe("#3040 trip-day sheet tiles (rendered)", () => {
  beforeEach(() => {
    upload.mockReset();
    network.isConnected = true;
  });

  it("offline failure → G-04 Paused (no ×), then resumes by itself on reconnect and closes", async () => {
    const props = { onAddMedia: jest.fn(), onClose: jest.fn(), onShowToast: jest.fn() };
    network.isConnected = false;
    upload.mockRejectedValueOnce(coded("source_upload_failed")).mockResolvedValueOnce(MEDIA);
    const sheet = await mount(props);
    await sheet.pick();
    expect(sheet.tile("G-04")).toHaveLength(1);
    expect(sheet.renderer.root.findAll((node) => /^(Cancel|Remove) video 1$/.test(String(node.props.accessibilityLabel)))).toHaveLength(0);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onAddMedia).not.toHaveBeenCalled();
    // The same file, the same day key: the service resumes its own operation.
    expect(upload.mock.calls[0][4]).toEqual(expect.objectContaining({ dayKey: "day-2" }));

    network.isConnected = true;
    await sheet.rerender();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][2]).toEqual(upload.mock.calls[0][2]);
    expect(props.onAddMedia).toHaveBeenCalledWith([MEDIA]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    sheet.renderer.unmount();
  });

  it("online failure → G-06 'Tap to retry' with an in-sheet alert; a tap retries the same file", async () => {
    const props = { onAddMedia: jest.fn(), onClose: jest.fn(), onShowToast: jest.fn() };
    upload.mockRejectedValueOnce(coded("edge_error")).mockResolvedValueOnce(MEDIA);
    const sheet = await mount(props);
    await sheet.pick();
    const [failed] = sheet.tile("G-06");
    expect(failed).toBeDefined();
    expect(sheet.alerts()).toEqual(["Couldn't upload that video. Try again."]);
    expect(props.onShowToast).toHaveBeenCalledWith("Couldn't upload that video. Try again.");
    expect(props.onClose).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      (failed.props.onPress as () => void)();
      await flush();
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][2]).toEqual(upload.mock.calls[0][2]);
    expect(props.onAddMedia).toHaveBeenCalledWith([MEDIA]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    sheet.renderer.unmount();
  });

  it("a refusal about the file → G-07 'Can't use'; × removes it and the sheet can close", async () => {
    const props = { onAddMedia: jest.fn(), onClose: jest.fn(), onShowToast: jest.fn() };
    upload.mockRejectedValueOnce(coded("video_file_too_large"));
    const sheet = await mount(props);
    await sheet.pick();
    expect(sheet.tile("G-07")).toHaveLength(1);
    const [remove] = sheet.renderer.root.findAll(
      (node) => node.props.accessibilityLabel === "Remove video 1" && typeof node.props.onPress === "function",
    );
    await TestRenderer.act(async () => {
      (remove.props.onPress as () => void)();
      await flush();
    });
    expect(sheet.tile("G-07")).toHaveLength(0);
    expect(upload).toHaveBeenCalledTimes(1);
    sheet.renderer.unmount();
  });

  it("the itinerary hands the sheet each day's key", () => {
    const parent = readFileSync(join(__dirname, "..", "TripCreatorStep2Itinerary.tsx"), "utf8");
    expect(parent).toMatch(/dayKey=\{tripDayMediaKey\(days\[mediaSheetDayIndex\], mediaSheetDayIndex\)\}/);
  });
});
