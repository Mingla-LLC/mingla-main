/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4251 — Explorer Purchases covers and compact card (implementor happy path).
 *
 *   - RSVP rows read through fetch_user_going_rsvps carry cover_media_type, so
 *     the card can draw the event cover instead of the striped placeholder.
 *   - PurchaseCard MOUNTS the cover for a URL plus an image/video/gif type,
 *     and the shared resolver would draw that media (not its fallback).
 *   - The cover box is a fixed 72 x 72 whatever the media is; the card has no
 *     height of its own, so it can't grow with a tall poster.
 *   - An unknown type, or a cover that fails to load, shows the date tile and
 *     never hands EventCoverMedia a type it would draw as stripes.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 */
import React from "react";
import { StyleSheet } from "react-native";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
jest.mock("../../../services/userActivityService", () => ({
  userActivityService: {},
}));
jest.mock("../../../services/cardEngagementService", () => ({
  recordCardSchedule: jest.fn(),
}));

// A host stand-in that keeps every prop EventCoverMedia receives, so the test
// can check exactly what the card hands the shared cover component.
jest.mock("@mingla/offering-rendering", () => {
  const ReactActual = jest.requireActual("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) =>
      ReactActual.createElement("EventCoverMedia", props),
  };
});

const { CalendarService } = require("../../../services/calendarService");
const {
  PurchaseCard,
  PURCHASE_CARD_COVER_SIZE,
} = require("../PurchaseCard");
const {
  resolveEventCoverMediaPresentation,
} = require("../../../../../packages/offering-rendering/coverMediaPresentation");

type Item = import("../../../utils/purchaseTimeline").PurchaseTimelineItem;

const baseItem = (overrides: Partial<Item> = {}): Item => ({
  key: "rsvp:r1",
  id: "r1",
  kind: "rsvp",
  title: "Neighbors Night on Wythe",
  brandName: "Lantern Room",
  coverMediaUrl: "https://vz-test.b-cdn.net/guid/play_720p.mp4",
  coverMediaType: "video",
  startsAt: "2026-11-12T00:00:00.000Z",
  endsAt: "2026-11-12T04:00:00.000Z",
  timezone: "America/New_York",
  venueLine: "61 Wythe Ave",
  status: "going",
  count: 1,
  amountCents: null,
  refundedAmountCents: 0,
  currency: null,
  source: null,
  raw: null,
  ...overrides,
});

let tree: import("react-test-renderer").ReactTestRenderer | null = null;
const mount = (item: Item): void => {
  TestRenderer.act(() => {
    tree = TestRenderer.create(<PurchaseCard item={item} onPress={() => undefined} />);
  });
};
const composite = (id: string) =>
  tree!.root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
const coverMedia = () => tree!.root.findAll((n) => n.type === "EventCoverMedia");
const texts = (): string[] =>
  tree!.root
    .findAll((n) => typeof n.type === "string" && typeof n.children?.[0] === "string")
    .map((n) => String(n.children[0]));

afterEach(() => {
  TestRenderer.act(() => tree?.unmount());
  tree = null;
  mockRpc.mockReset();
});

const rpcRow = (cover_media_type: unknown) => ({
  rsvp_id: "r1",
  guest_id: null,
  role: "primary",
  qr_code: "qr",
  rsvp_status: "going",
  approval_status: "approved",
  plus_count: 0,
  display_name: "Seth",
  invited_by: null,
  event_id: "e1",
  event_title: "Neighbors Night on Wythe",
  event_slug: "neighbors-night",
  cover_media_url: "https://vz-test.b-cdn.net/guid/play_720p.mp4",
  cover_media_type,
  timezone: "America/New_York",
  location_text: "61 Wythe Ave",
  is_online: false,
  online_url: null,
  brand_id: "b1",
  brand_slug: "lantern-room",
  brand_name: "Lantern Room",
  master_start_at: "2026-11-12T00:00:00.000Z",
  master_end_at: "2026-11-12T04:00:00.000Z",
  created_at: "2026-10-01T00:00:00.000Z",
});

test("#4251 RSVP rows carry the cover media type from fetch_user_going_rsvps", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [rpcRow("video"), rpcRow("gif"), rpcRow("image"), rpcRow("svg"), rpcRow(null)],
    error: null,
  });
  const rows = await CalendarService.fetchUserGoingRsvps("u1");
  expect(mockRpc).toHaveBeenCalledWith("fetch_user_going_rsvps", { p_user_id: "u1" });
  expect(rows.map((row: { coverMediaType: unknown }) => row.coverMediaType)).toEqual([
    "video",
    "gif",
    "image",
    null,
    null,
  ]);

  // A server that predates the migration returns no cover_media_type at all.
  const legacy: Record<string, unknown> = rpcRow("video");
  delete legacy.cover_media_type;
  mockRpc.mockResolvedValueOnce({ data: [legacy], error: null });
  const [old] = await CalendarService.fetchUserGoingRsvps("u1");
  expect(old.coverMediaType).toBeNull();
  expect(old.coverMediaUrl).toBe("https://vz-test.b-cdn.net/guid/play_720p.mp4");
});

test("#4251 a cover with a URL and a known type renders the media, not the fallback", () => {
  for (const type of ["image", "video", "gif"] as const) {
    mount(baseItem({ coverMediaType: type }));
    const media = coverMedia();
    expect(media).toHaveLength(1);
    expect(media[0].props.mediaType).toBe(type);
    expect(media[0].props.autoplay).toBe(false);
    expect(media[0].props.playbackActive).toBe(false);
    expect(
      resolveEventCoverMediaPresentation({
        mediaUrl: media[0].props.mediaUrl,
        mediaType: media[0].props.mediaType,
      }),
    ).not.toBe("fallback");
    expect(composite("purchase-card-date-tile")).toHaveLength(0);
    TestRenderer.act(() => tree?.unmount());
  }
  tree = null;
});

test("#4251 the cover box is a fixed 72 x 72, independent of the media", () => {
  expect(PURCHASE_CARD_COVER_SIZE).toBe(72);
  mount(baseItem({ coverMediaType: "image" }));
  const [cover] = composite("purchase-card-cover");
  const style = StyleSheet.flatten(cover.props.style);
  expect(style.width).toBe(72);
  expect(style.height).toBe(72);
  expect(style.alignSelf).not.toBe("stretch");
  expect(style.overflow).toBe("hidden");
  const [media] = coverMedia();
  expect(media.props.width).toBe(72);
  expect(media.props.height).toBe(72);

  // The card's height comes from its text: no minHeight, no fixed height.
  const card = tree!.root.find(
    (n) => n.props.accessibilityRole === "button" && typeof n.type !== "string",
  );
  const cardStyle = StyleSheet.flatten(
    typeof card.props.style === "function" ? card.props.style({ pressed: false }) : card.props.style,
  );
  expect(cardStyle.minHeight).toBeUndefined();
  expect(cardStyle.height).toBeUndefined();

  // Every text row is a single line.
  const lines = tree!.root.findAll(
    (n) => typeof n.type !== "string" && n.props.numberOfLines !== undefined,
  );
  expect(lines.length).toBeGreaterThanOrEqual(4);
  for (const line of lines) expect(line.props.numberOfLines).toBe(1);
});

test("#4251 an unknown type shows the date tile and never the striped cover", () => {
  mount(baseItem({ coverMediaType: null }));
  expect(coverMedia()).toHaveLength(0);
  expect(composite("purchase-card-date-tile")).toHaveLength(1);
  const [tile] = composite("purchase-card-date-tile");
  const tileStyle = StyleSheet.flatten(tile.props.style);
  expect(tileStyle.width).toBe(72);
  expect(tileStyle.height).toBe(72);
  // 00:00 UTC on 12 Nov is Wednesday 11 Nov in New York.
  expect(texts()).toEqual(expect.arrayContaining(["WED", "11", "NOV"]));
});

test("#4251 a cover that fails to load falls back to the date tile", () => {
  mount(baseItem({ coverMediaType: "image" }));
  const [media] = coverMedia();
  TestRenderer.act(() => {
    media.props.onMediaError({
      mediaType: "image",
      mediaUrl: media.props.mediaUrl,
      surface: "image",
    });
  });
  expect(coverMedia()).toHaveLength(0);
  expect(composite("purchase-card-date-tile")).toHaveLength(1);
});

test("#4251 no start date shows the kind label in the tile", () => {
  mount(baseItem({ coverMediaUrl: null, startsAt: "" }));
  expect(composite("purchase-card-date-tile")).toHaveLength(1);
  expect(texts()).toContain("RSVP");
});
