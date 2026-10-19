/**
 * #3040 Appendix A §6 G-05 — saved trip-day videos show "▶ m:ss" in the day
 * grid. The length is stored on the media item (`durationMs`), kept by the
 * jsonb coercion, and rendered by the real TripDayEditor.
 * FAILS ON REVERT: drop the chip text, or let coercion drop `durationMs`.
 */
import React from "react";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/EventCoverMedia", () => ({ EventCoverMedia: "EventCoverMedia" }));
jest.mock("../../ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../../ui/Input", () => ({ Input: "Input" }));
jest.mock("../../../services/tripDayMediaService", () => ({ MAX_TRIP_DAY_MEDIA: 8 }));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { TripDayEditor } from "../TripDayEditor";
// eslint-disable-next-line import/first
import { tripDayVideoChip } from "../tripDayTileModel";
// eslint-disable-next-line import/first
import { coerceTripDayMedia } from "../../../services/tripsService";

describe("#3040 G-05 — the saved day grid's video chip", () => {
  it("keeps a video's stored length through the jsonb coercion (and only a video's)", () => {
    expect(coerceTripDayMedia([
      { url: "https://cdn.example/a.mp4", type: "video", durationMs: 44_960.4 },
      { url: "https://cdn.example/b.jpg", type: "image", durationMs: 5_000 },
      { url: "https://cdn.example/c.mp4", type: "video", durationMs: -1 },
      { url: "https://cdn.example/d.mp4", type: "video" },
    ])).toEqual([
      { url: "https://cdn.example/a.mp4", type: "video", durationMs: 44_960 },
      { url: "https://cdn.example/b.jpg", type: "image" },
      { url: "https://cdn.example/c.mp4", type: "video" },
      { url: "https://cdn.example/d.mp4", type: "video" },
    ]);
  });

  it("formats ▶ m:ss, and ▶ alone for a video saved without a length", () => {
    expect(tripDayVideoChip(45_000)).toBe("▶ 0:45");
    expect(tripDayVideoChip(60_000)).toBe("▶ 1:00");
    expect(tripDayVideoChip(null)).toBe("▶");
  });

  it("the real day editor renders the chip on video tiles only", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <TripDayEditor
          day={{
            ordinal: 2,
            title: "Day two",
            narrative: "",
            media: [
              { url: "https://cdn.example/a/play_1080p.mp4", type: "video", provider: "bunny", durationMs: 45_000 },
              { url: "https://cdn.example/b.jpg", type: "image" },
              { url: "https://cdn.example/c/play_720p.mp4", type: "video", provider: "bunny" },
            ],
          }}
          index={1}
          total={3}
          onChange={() => undefined}
          onDelete={() => undefined}
          onMoveUp={() => undefined}
          onMoveDown={() => undefined}
          brandId="brand-1"
          eventId="event-1"
          onAddMedia={() => undefined}
          onRemoveMedia={() => undefined}
          onReorderMedia={() => undefined}
        />,
      );
    });
    const chips = renderer.root.findAll(
      (node) => typeof node.props.testID === "string" && /^trip-day-2-media-\d+-chip$/.test(node.props.testID as string) && typeof node.type === "string",
    );
    expect(chips.map((chip) => chip.props.testID)).toEqual(["trip-day-2-media-0-chip", "trip-day-2-media-2-chip"]);
    expect(chips.map((chip) => chip.props.accessibilityLabel)).toEqual(["Video, 0:45", "Video"]);
    expect(chips.map((chip) => (chip.props.children as React.ReactElement<{ children: string }>).props.children))
      .toEqual(["▶ 0:45", "▶"]);
    renderer.unmount();
  });
});
