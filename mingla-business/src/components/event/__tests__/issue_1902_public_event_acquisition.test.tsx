import React from "react";
import { Platform, Text } from "react-native";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
type Renderer = {
  root: { findAllByProps: (props: Record<string, unknown>) => unknown[] };
  toJSON: () => unknown;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

jest.mock("../../../../../packages/offering-rendering/LucideIcons", () => {
  const icon = () => null;
  return new Proxy({}, { get: () => icon });
});
jest.mock(
  "react-native-svg",
  () => {
    const node = () => null;
    return {
      __esModule: true,
      default: node,
      Circle: node,
      Path: node,
      Rect: node,
      G: node,
    };
  },
  { virtual: true },
);
jest.mock(
  "../../../../../packages/offering-rendering/RsvpMomentumDecision",
  () => ({
    RsvpMomentumDecision: () => null,
  }),
);

import {
  EventAcquisitionNotice,
  EventOfferingBody,
} from "../../../../../packages/offering-rendering/EventOfferingBody";
import {
  RsvpOfferingBody,
  rsvpErrorMessageForCode,
  useRsvpOfferingState,
} from "../../../../../packages/offering-rendering/RsvpOfferingBody";

const palette = {
  page: "#fff",
  card: "#fff",
  panelBorder: "#ddd",
  accent: "#f60",
  accentWash: "#fee",
  accentText: "#fff",
  primaryText: "#111",
  secondaryText: "#333",
  tertiaryText: "#666",
  mutedText: "#777",
  danger: "#900",
  success: "#090",
} as never;
const theme = {
  color: "#f60",
  foregroundColor: "#fff",
  font: "inter",
  fontFamilyValue: "Inter",
  animation: "none",
} as never;
const brand = { id: "b", slug: "brand", displayName: "Brand", theme: null };
const baseEvent = {
  id: "e",
  name: "Night",
  brandId: "b",
  brandSlug: "brand",
  eventSlug: "night",
  description: "Read-only history",
  dateLine: "11 Aug",
  dateSubline: "7–9pm",
  datesList: [],
  status: "published",
  endedAt: null,
  format: "in-person",
  venueName: "Venue",
  address: "Street",
  hideAddressUntilTicket: false,
  locationGeo: null,
  cityGeo: null,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  tickets: [
    {
      id: "t",
      name: "General",
      description: null,
      priceGbp: 10,
      priceAllInGbp: 11,
      currency: "USD",
      isFree: false,
      isUnlimited: true,
      capacity: null,
      visibility: "visible",
      passwordProtected: false,
      password: null,
      saleStartAt: null,
      saleEndAt: null,
      approvalRequired: false,
      waitlistEnabled: false,
      availableAt: "online",
      displayOrder: 0,
    },
  ],
  currency: "USD",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  themeOverrides: null,
  acquisitionState: { kind: "ended", reason: "master_end" },
} as never;

const text = (tree: Renderer): string => JSON.stringify(tree.toJSON());

test("equality-ended ticket and RSVP renders exact notice and no acquisition subtrees", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  let notice!: Renderer;
  await act(async () => {
    notice = TestRenderer.create(
      <EventAcquisitionNotice
        state={{ kind: "ended", reason: "master_end" }}
        eventType="event"
        brandName="Brand"
        palette={palette}
        theme={theme}
      />,
    );
  });
  expect(text(notice)).toContain("PAST EVENT");
  expect(text(notice)).toContain(
    "This event has ended. Ticket sales are closed.",
  );
  const noticeNode = notice.root.findAllByProps({
    testID: "issue-1902-event-acquisition-notice",
  })[0] as { props: Record<string, unknown> };
  expect(noticeNode.props).toMatchObject({
    role: "status",
    "aria-live": "polite",
    "aria-atomic": true,
  });

  let ticket!: Renderer;
  await act(async () => {
    ticket = TestRenderer.create(
      <EventOfferingBody
        event={baseEvent}
        brand={brand}
        variant="past"
        bookable
        palette={palette}
        theme={theme}
        ticketQuantities={{}}
        onChangeTicketQuantity={() => undefined}
        onProceedToCart={() => undefined}
      />,
    );
  });
  expect(
    ticket.root.findAllByProps({ testID: "orch-1167-ticket-box" }),
  ).toHaveLength(0);
  expect(text(ticket)).toContain("Read-only history");

  const marker = (id: string) => <Text testID={id}>{id}</Text>;
  const rsvpState = {
    surface: { card: {}, primaryText: {}, secondaryText: {} },
    boldFamily: "Inter",
    ctaState: "open",
    plusCount: 0,
    submitting: false,
    contactReady: true,
    onGoingTap: () => undefined,
    onMaybe: () => undefined,
    onNotGoing: () => undefined,
    onFloatingGoing: () => undefined,
    onFloatingMaybe: () => undefined,
    onFloatingNotGoing: () => undefined,
    contactForm: marker("contact"),
    guestForms: marker("guests"),
    errorNode: null,
    confirmDialog: marker("confirm"),
    successPopup: marker("success"),
    detailsModal: marker("details"),
    chipInInlinePanel: marker("chip-in"),
    guestStatus: null,
    guestApproval: null,
  } as never;
  let rsvp!: Renderer;
  await act(async () => {
    rsvp = TestRenderer.create(
      <RsvpOfferingBody
        event={baseEvent}
        brand={brand}
        palette={palette}
        theme={theme}
        config={{
          capacity: null,
          goingCount: 0,
          allowPlusOnes: false,
          plusOnesMax: 0,
          waitlistEnabled: false,
          manualApproval: false,
        }}
        isLoggedIn
        onSubmit={async () => {
          throw new Error("unused");
        }}
        state={rsvpState}
      />,
    );
  });
  for (const id of [
    "contact",
    "guests",
    "confirm",
    "success",
    "details",
    "chip-in",
    "orch-1163-rsvp-inline-box",
  ])
    expect(rsvp.root.findAllByProps({ testID: id })).toHaveLength(0);
});

test("exact backend lifecycle tokens map to exact guest copy", () => {
  expect(rsvpErrorMessageForCode("rsvp_event_ended")).toBe(
    "This event has ended. RSVPs are closed.",
  );
  expect(rsvpErrorMessageForCode("rsvp_date_unavailable")).toBe(
    "RSVPs are unavailable right now. Try again later.",
  );
});

test("a stale ended write transitions the mounted RSVP page to its notice and removes decisions", async () => {
  let latestState: ReturnType<typeof useRsvpOfferingState> | null = null;
  const config = {
    capacity: null,
    goingCount: 0,
    allowPlusOnes: false,
    plusOnesMax: 0,
    waitlistEnabled: false,
    manualApproval: false,
  };
  const Harness = () => {
    const [closed, setClosed] = React.useState(false);
    const currentEvent = {
      ...(baseEvent as object),
      acquisitionState: closed
        ? { kind: "ended", reason: "master_end" }
        : { kind: "current" },
    } as never;
    const state = useRsvpOfferingState({
      event: currentEvent,
      brand,
      palette,
      theme,
      config,
      isLoggedIn: true,
      onSubmit: async () => {
        throw new Error("rsvp_event_ended");
      },
      onAcquisitionClosed: () => setClosed(true),
    });
    latestState = state;
    return (
      <>
        {closed ? (
          <EventAcquisitionNotice
            state={{ kind: "ended", reason: "master_end" }}
            eventType="rsvp"
            brandName="Brand"
            palette={palette}
            theme={theme}
            focusOnMount
          />
        ) : null}
        <RsvpOfferingBody
          event={currentEvent}
          brand={brand}
          palette={palette}
          theme={theme}
          config={config}
          isLoggedIn
          onSubmit={async () => {
            throw new Error("unused");
          }}
          state={state}
        />
      </>
    );
  };
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<Harness />);
  });
  await act(async () => {
    latestState?.onMaybe();
    await Promise.resolve();
  });
  expect(
    tree.root.findAllByProps({ testID: "issue-1902-rsvp-acquisition-notice" })
      .length,
  ).toBeGreaterThan(0);
  expect(
    tree.root.findAllByProps({ testID: "orch-1163-rsvp-inline-box" }),
  ).toHaveLength(0);
});
