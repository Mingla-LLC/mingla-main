/**
 * issue #3827 — the private link page `/g/<token>`:
 *
 *   Defect 3: a video cover drew nothing, because the .mp4 went to an image.
 *   It now plays through the shared EventCoverMedia with its poster, and the
 *   poster is drawn as an image once the video cannot play.
 *   Defect 4: a multi-date event let a guest pick one date. The page now uses
 *   the shared multi-select day chooser and sends every chosen date; a paid
 *   link carries the days into normal checkout. Single-date links send exactly
 *   what they sent before.
 *
 * Fails on revert: restoring the plain <Image> loses the EventCoverMedia props
 * asserted below, and restoring the one-date radio list loses the checkbox
 * rows and the `eventDateIds` body.
 */
import React from "react";

import type { TicketLinkResolve } from "../../../services/ticketLinkPublicTypes";
import {
  ticketLinkCheckoutDates,
  ticketLinkCover,
  ticketLinkSignupDates,
} from "../../../utils/ticketLinkLandingModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL ??= "https://business.example.test";

const mockInvoke = jest.fn();
const mockPush = jest.fn();
const mockCoverProps: Array<Record<string, unknown>> = [];

jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "t".repeat(22) }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("../../ui/EventCoverMedia", () => {
  const { View } = jest.requireActual("react-native");
  return {
    EventCoverMedia: (props: Record<string, unknown>) => {
      mockCoverProps.push(props);
      return <View testID="cover-stub" />;
    },
  };
});
// The page's own controls are stand-ins: this suite pins the cover and the
// dates, not the design-system button or field (which load reanimated).
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable label={label} onPress={onPress}><Text>{label}</Text></Pressable>
    ),
  };
});
jest.mock("../../ui/Input", () => {
  const { TextInput } = jest.requireActual("react-native");
  return {
    Input: (props: Record<string, unknown>) => <TextInput {...props} />,
  };
});
jest.mock("../../ui/Icon", () => {
  const { View } = jest.requireActual("react-native");
  return { Icon: () => <View /> };
});
jest.mock("../../ui/PhoneField", () => {
  const { View } = jest.requireActual("react-native");
  return {
    usePhoneEntry: () => ({ e164: "+12025550111" }),
    PhoneField: () => <View />,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: {
      findAllByProps: (props: Record<string, unknown>) => Array<{ props: Record<string, unknown> }>;
      findAll: (pred: (node: { props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }>;
    };
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const DAY_ONE = "11111111-1111-4111-8111-111111111111";
const DAY_TWO = "22222222-2222-4222-8222-222222222222";

const event = (over: Partial<NonNullable<TicketLinkResolve["event"]>> = {}): NonNullable<TicketLinkResolve["event"]> => ({
  title: "Two Nights",
  brandName: "Brand",
  brandSlug: "brand",
  eventSlug: "two-nights",
  coverUrl: "https://vz.b-cdn.net/guid/play_720p.mp4",
  coverMediaType: "video",
  coverPosterUrl: "https://vz.b-cdn.net/guid/thumbnail.jpg",
  startAt: "2030-08-29T18:00:00Z",
  endAt: "2030-08-29T23:00:00Z",
  timezone: "Europe/London",
  venueLine: null,
  currency: "GBP",
  themeColor: null,
  themeFont: null,
  ...over,
});

const multiDate = (kind: "guest_list" | "private_ticket"): TicketLinkResolve => ({
  state: "active",
  kind,
  linkId: "link",
  eventId: "33333333-3333-4333-8333-333333333333",
  guestsMax: 0,
  approvalRequired: false,
  eventDateId: null,
  event: event(),
  tier: kind === "guest_list"
    ? { id: "tier-free", name: "Guest list" }
    : { id: "tier-paid", name: "Secret", priceCents: 1000, allInCents: 1100, currency: "GBP" },
  dates: [
    { id: DAY_ONE, startAt: "2030-08-29T18:00:00Z", endAt: "2030-08-29T23:00:00Z", timezone: "Europe/London" },
    { id: DAY_TWO, startAt: "2030-08-30T18:00:00Z", endAt: "2030-08-30T23:00:00Z", timezone: "Europe/London" },
  ],
  multiDatePricingMode: "per_day",
  allDaysPass: false,
});

const singleDate: TicketLinkResolve = { ...multiDate("guest_list"), dates: [], eventDateId: null };

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function renderLanding(resolve: TicketLinkResolve) {
  mockInvoke.mockImplementation(async (_name: string, options: { body: Record<string, unknown> }) =>
    options.body.op === "resolve"
      ? { data: resolve, error: null }
      : { data: { status: "issued", people: [] }, error: null });
  const { default: TicketLinkLanding } = await import("../TicketLinkLanding");
  let tree: ReturnType<typeof TestRenderer.create> | null = null;
  await act(async () => { tree = TestRenderer.create(<TicketLinkLanding />); });
  await flush();
  return tree as unknown as ReturnType<typeof TestRenderer.create>;
}

// The shared chooser's row for a date (the composite Pressable carries onPress).
const dayRow = (tree: ReturnType<typeof TestRenderer.create>, id: string) =>
  tree.root.findAll((node) => node.props.testID === `issue-2135-day-row-${id}` && typeof node.props.onPress === "function")[0];

const press = async (node: { props: Record<string, unknown> }) =>
  act(async () => { (node.props.onPress as () => void)(); });

beforeEach(() => {
  mockInvoke.mockReset();
  mockPush.mockReset();
  mockCoverProps.length = 0;
});

describe("#3827 cover model", () => {
  test("a video cover plays with its poster; a failed video shows the poster as an image", () => {
    expect(ticketLinkCover(event(), false)).toEqual({
      mediaUrl: "https://vz.b-cdn.net/guid/play_720p.mp4",
      mediaType: "video",
      posterUrl: "https://vz.b-cdn.net/guid/thumbnail.jpg",
    });
    expect(ticketLinkCover(event(), true)).toEqual({
      mediaUrl: "https://vz.b-cdn.net/guid/thumbnail.jpg",
      mediaType: "image",
      posterUrl: null,
    });
  });

  test("image covers, older payloads and missing covers", () => {
    expect(ticketLinkCover(event({ coverUrl: "https://x/c.jpg", coverMediaType: "image", coverPosterUrl: null }), false))
      .toEqual({ mediaUrl: "https://x/c.jpg", mediaType: "image", posterUrl: null });
    expect(ticketLinkCover(event({ coverMediaType: undefined, coverPosterUrl: undefined }), false)?.mediaType).toBe("video");
    expect(ticketLinkCover(event({ coverUrl: null }), false)).toBeNull();
    expect(ticketLinkCover(event({ coverPosterUrl: null }), true)).toBeNull();
  });
});

describe("#3827 date model", () => {
  test("a single-date link sends exactly the old fields", () => {
    expect(ticketLinkSignupDates(singleDate, [])).toEqual({ eventDateId: null });
    expect(ticketLinkSignupDates({ ...singleDate, eventDateId: DAY_ONE }, [])).toEqual({ eventDateId: DAY_ONE });
    expect(ticketLinkCheckoutDates(singleDate, [])).toBeNull();
    expect(ticketLinkCheckoutDates({ ...singleDate, eventDateId: DAY_ONE }, [])).toEqual([DAY_ONE]);
  });

  test("a multi-date link sends the chosen set in event order; an all-days pass sends none", () => {
    const resolved = multiDate("guest_list");
    expect(ticketLinkSignupDates(resolved, [DAY_TWO, DAY_ONE, "not-offered"])).toEqual({
      eventDateId: null,
      eventDateIds: [DAY_TWO, DAY_ONE],
    });
    expect(ticketLinkCheckoutDates(multiDate("private_ticket"), [DAY_TWO, DAY_ONE])).toEqual([DAY_ONE, DAY_TWO]);
    expect(ticketLinkSignupDates({ ...resolved, allDaysPass: true }, [])).toEqual({ eventDateId: null, eventDateIds: [] });
    expect(ticketLinkCheckoutDates({ ...resolved, allDaysPass: true }, [])).toBeNull();
  });
});

describe("#3827 link page", () => {
  test("renders a video cover through EventCoverMedia, then its poster after a playback failure", async () => {
    const tree = await renderLanding(multiDate("guest_list"));
    const last = mockCoverProps[mockCoverProps.length - 1];
    expect(last).toMatchObject({
      mediaUrl: "https://vz.b-cdn.net/guid/play_720p.mp4",
      mediaType: "video",
      posterUrl: "https://vz.b-cdn.net/guid/thumbnail.jpg",
    });
    await act(async () => { (last.onMediaError as () => void)(); });
    expect(mockCoverProps[mockCoverProps.length - 1]).toMatchObject({
      mediaUrl: "https://vz.b-cdn.net/guid/thumbnail.jpg",
      mediaType: "image",
    });
    tree.unmount();
  });

  test("a revoked link draws no cover", async () => {
    const tree = await renderLanding({ state: "revoked", event: event(), tier: { id: "t", name: "T" } });
    expect(mockCoverProps).toHaveLength(0);
    tree.unmount();
  });

  test("a guest picks both dates with checkbox rows and the sign-up carries both", async () => {
    const tree = await renderLanding(multiDate("guest_list"));
    expect(dayRow(tree, DAY_ONE).props.accessibilityRole).toBe("checkbox");
    await press(dayRow(tree, DAY_ONE));
    await press(dayRow(tree, DAY_TWO));
    expect(dayRow(tree, DAY_ONE).props.accessibilityState).toMatchObject({ checked: true });
    expect(dayRow(tree, DAY_TWO).props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => {
      (tree.root.findAllByProps({ accessibilityLabel: "Your details full name" })[0].props.onChangeText as (v: string) => void)("Ada");
    });
    await act(async () => {
      (tree.root.findAllByProps({ accessibilityLabel: "Your details email" })[0].props.onChangeText as (v: string) => void)("ada@example.com");
    });
    const join = tree.root.findAll((node) => node.props.label === "Join guest list" && typeof node.props.onPress === "function")[0];
    await press(join);
    await flush();
    const signup = mockInvoke.mock.calls.map((call) => call[1].body).find((body) => body.op === "signup");
    expect(signup).toMatchObject({ eventDateId: null, eventDateIds: [DAY_ONE, DAY_TWO] });
    tree.unmount();
  });

  test("a paid link waits for a day, then hands the chosen days to checkout", async () => {
    const tree = await renderLanding(multiDate("private_ticket"));
    const proceed = () => tree.root.findAll((node) => node.props.label === "Continue to checkout" && typeof node.props.onPress === "function")[0];
    await press(proceed());
    expect(mockPush).not.toHaveBeenCalled();
    await press(dayRow(tree, DAY_TWO));
    await press(dayRow(tree, DAY_ONE));
    await press(proceed());
    expect(mockPush).toHaveBeenCalledTimes(1);
    const path = String(mockPush.mock.calls[0][0]);
    expect(path).toContain(`eventDateIds=${encodeURIComponent(`${DAY_ONE},${DAY_TWO}`)}`);
    expect(path).toContain("ticketLink=");
    tree.unmount();
  });

  test("a single-date guest list shows no day chooser and sends no date set", async () => {
    const tree = await renderLanding(singleDate);
    expect(tree.root.findAll((node) => node.props.accessibilityRole === "checkbox")).toHaveLength(0);
    await act(async () => {
      (tree.root.findAllByProps({ accessibilityLabel: "Your details full name" })[0].props.onChangeText as (v: string) => void)("Ada");
    });
    await act(async () => {
      (tree.root.findAllByProps({ accessibilityLabel: "Your details email" })[0].props.onChangeText as (v: string) => void)("ada@example.com");
    });
    await press(tree.root.findAll((node) => node.props.label === "Join guest list" && typeof node.props.onPress === "function")[0]);
    await flush();
    const signup = mockInvoke.mock.calls.map((call) => call[1].body).find((body) => body.op === "signup");
    expect(signup).toBeDefined();
    expect(signup).toHaveProperty("eventDateId", null);
    expect(signup).not.toHaveProperty("eventDateIds");
    tree.unmount();
  });
});
