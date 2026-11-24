// MINGLA-INVARIANT: I-ADDON-PUBLIC-SLOT-OPT-IN | issue #3281 | The shared offering bodies list add-ons under a ticket, package or option only through the page's addOns slot, which is null while the add-ons switch is off.
/**
 * issue #3281 S2 (checkpoint 15) — "Add at checkout:" placed on the public
 * pages. The shared bodies (event, trip, experience) take an `addOns` slot and
 * call it once under each ticket, package or option with that card's raw
 * reader list; the Host web / buyer web shells pass `publicAddOnsSlot`
 * (components/addOns/publicAddOnsSlot), which is null while EXPO_PUBLIC_FF_EXTRAS_ENABLED is off
 * and otherwise renders the block from its on-use chunk.
 *
 * Mounts the REAL EventOfferingBody, ExperienceOfferingBody and
 * TripOfferingBody, and the REAL slot with its lazy block.
 *
 * FAILS-ON-REVERT: delete the slot call under a ticket / package / option in
 * any of the three bodies, or the flag check in `publicAddOnsSlot` -> red.
 * A chunk that fails to load renders nothing (logged), never an error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";
import { Text } from "react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

jest.mock("../../../../../packages/offering-rendering/LucideIcons", () => {
  const icon = (): null => null;
  return new Proxy({}, { get: () => icon });
});
jest.mock(
  "react-native-svg",
  () => {
    const node = (): null => null;
    return { __esModule: true, default: node, Svg: node, Path: node, Circle: node, Rect: node, G: node, Line: node };
  },
  { virtual: true },
);
jest.mock("../../../../../packages/offering-rendering/EventCoverMedia", () => ({
  EventCoverMedia: (): null => null,
}));
jest.mock("../../../../../packages/offering-rendering/StopSpine", () => ({
  StopSpine: (): null => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${p}` } }),
      }),
    },
  },
}));
const mockFlags = { extras: false };
jest.mock("../../../config/featureFlags", () => {
  const actual = jest.requireActual("../../../config/featureFlags") as { featureFlags: Record<string, unknown> };
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (target: Record<string, unknown>, key: string) => (key === "extras" ? mockFlags.extras : target[key]),
    }),
  };
});

// eslint-disable-next-line import/first
import { EventOfferingBody } from "../../../../../packages/offering-rendering/EventOfferingBody";
// eslint-disable-next-line import/first
import { ExperienceOfferingBody } from "../../../../../packages/offering-rendering/ExperienceOfferingBody";
// eslint-disable-next-line import/first
import type { OfferingAddOnsSlot } from "../../../../../packages/offering-rendering/OfferingAddOnsBlock";

const palette = {
  page: "#fffaf5",
  accent: "#ae591b",
  accentText: "#ffffff",
  primaryText: "#101418",
  secondaryText: "#3a3f47",
  tertiaryText: "#8a8f99",
  panel: "#ffffff",
  panelStrong: "#ffffff",
  panelBorder: "#e6e0da",
  card: "#fcfbfb",
  cutoutBorder: "#eeeeee",
  glass: "#ffffff",
  glassTint: "light",
  accentWash: "#fbeee3",
} as never;
const theme = { color: "#eb7825", foregroundColor: "#ffffff", font: "inter", fontFamilyValue: "Inter", animation: "none" } as never;

const ADD_ON = {
  id: "x1",
  name: "Friday dinner",
  description: null,
  priceCents: 2500,
  priceAllInCents: 2750,
  maxPerTicket: 2,
  isUnlimited: true,
  validOccurrenceIds: null,
  remaining: null,
  showOnPublicPage: true,
  photoPath: "add-ons/e/x1.jpg",
  photoThumbPath: "add-ons/e/x1_thumb.jpg",
};

/** A recording slot: one marker per call, so placement and arguments are visible. */
const recordingSlot = (): { slot: OfferingAddOnsSlot; calls: unknown[][] } => {
  const calls: unknown[][] = [];
  const slot: OfferingAddOnsSlot = (id, addOns, currency, pal) => {
    calls.push([id, addOns, currency, pal]);
    return <Text testID={`slot-${id}`}>{`add-ons for ${id}`}</Text>;
  };
  return { slot, calls };
};

const ids = (tree: Renderer): string[] =>
  tree.root
    .findAll((n) => typeof n.type === "string" && typeof n.props.testID === "string")
    .map((n) => n.props.testID as string);

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

const ticket = (id: string, buyerExtras?: unknown) => ({
  id,
  name: `Ticket ${id}`,
  description: null,
  priceGbp: 25,
  priceAllInGbp: 27.5,
  currency: "GBP",
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
  ...(buyerExtras !== undefined ? { buyerExtras } : {}),
});

const eventFixture = (tickets: unknown[]) =>
  ({
    id: "e-3281",
    name: "Rooftop Sessions",
    brandId: "b-1",
    brandSlug: "sunset",
    eventSlug: "rooftop",
    description: "Late sets.",
    dateLine: "Sat 3 Oct",
    dateSubline: "8pm",
    datesList: [],
    status: "published",
    endedAt: null,
    format: "in-person",
    venueName: "The Roof",
    address: "1 High Street",
    hideAddressUntilTicket: false,
    locationGeo: null,
    cityGeo: null,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverGallery: [],
    tickets,
    currency: "GBP",
  }) as never;

const renderEvent = (tickets: unknown[], addOns?: OfferingAddOnsSlot | null): Promise<Renderer> =>
  mount(
    <EventOfferingBody
      event={eventFixture(tickets)}
      brand={{ id: "b-1", slug: "sunset", displayName: "Sunset", theme: null } as never}
      variant={"published" as never}
      bookable
      palette={palette}
      theme={theme}
      ticketQuantities={{}}
      onChangeTicketQuantity={() => undefined}
      onProceedToCart={() => undefined}
      refundPolicyState={{ status: "unknown" }}
      {...(addOns !== undefined ? { addOns } : {})}
    />,
  );

const experienceTicket = (ticketTypeId: string, buyerExtras?: unknown) => ({
  ticketTypeId,
  name: `Option ${ticketTypeId}`,
  priceCents: 2500,
  priceAllInCents: 2750,
  currency: "USD",
  isFree: false,
  isUnlimited: true,
  ticketsRemaining: null,
  quantityTotal: null,
  ...(buyerExtras !== undefined ? { buyerExtras } : {}),
});

const renderExperience = (extra: Record<string, unknown>, addOns?: OfferingAddOnsSlot | null): Promise<Renderer> =>
  mount(
    <ExperienceOfferingBody
      data={
        {
          id: "x-3281",
          title: "Lagos Food Walk",
          description: null,
          currency: "USD",
          timezone: "UTC",
          coverMediaUrl: null,
          coverMediaType: null,
          cityCountry: null,
          datesLabel: null,
          seatsLabel: null,
          startTimeLabel: null,
          intents: [],
          stops: [],
          ticket: experienceTicket("tt-1", [ADD_ON]),
          occurrences: [],
          openDaily: false,
          bookable: true,
          refundPolicyState: { status: "unknown" },
          ...extra,
        } as never
      }
      brand={{ id: "b-2", slug: "walks", name: "Walks", bio: null, coverMediaUrl: null, coverMediaType: null, coverHue: null, verified: false } as never}
      palette={palette}
      theme={theme}
      callbacks={{ onReserve: () => undefined }}
      variant="phone"
      {...(addOns !== undefined ? { addOns } : {})}
    />,
  );

// --- the trip body, loaded through the #2829 harness technique (its leaves stubbed) ---
const PACKAGE = path.resolve(__dirname, "..", "..", "..", "..", "..", "packages", "offering-rendering");
const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, { testID: props.testID }, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const TRIP_BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "./themePalette": () => jest.requireActual("@mingla/offering-rendering/themePalette"),
  "./themeAccentStyle": () => jest.requireActual("@mingla/offering-rendering/themeAccentStyle"),
  "./designTokens": () => ({}),
  "./EventCoverMedia": () => ({ EventCoverMedia: leaf("EventCoverMedia") }),
  "./ChipGroup": () => ({ ChipGroup: leaf("ChipGroup") }),
  "./DayByDay": () => ({ DayByDay: leaf("DayByDay") }),
  "./LazyOfferingRefundLadder": () => ({
    LazyOfferingRefundLadder: leaf("TripRefundLadder"),
    LazySaleAvailabilityText: leaf("SaleAvailabilityText"),
  }),
  "./TripPaymentChoice": () => ({ TripPaymentChoice: leaf("TripPaymentChoice") }),
  "./TripCountdownPill": () => ({ TripCountdownPill: leaf("TripCountdownPill") }),
  "./LucideIcons": () => new Proxy({}, { get: (_t, name) => leaf(`Icon.${String(name)}`) }),
  "./PresentedByFollowerCount": () => ({ PresentedByFollowerCount: leaf("PresentedByFollowerCount") }),
  "./OfferingMomentum": () => ({ OfferingMomentum: leaf("OfferingMomentum") }),
  "./OfferingFactRows": () => ({ OfferingFactRows: leaf("OfferingFactRows") }),
  "./OfferingSectionTitle": () => ({ OfferingSubLabel: leaf("OfferingSubLabel") }),
  "./OfferingDecideParts": () => ({ OfferingDotList: leaf("OfferingDotList") }),
  "./socialProofTypes": () => ({}),
  "./staticMapImage": () => ({ buildStaticMapUrl: () => "https://map.fixture/static.png" }),
  "./StaticMapFrame": () => jest.requireActual("../../../../../packages/offering-rendering/StaticMapFrame"),
  "./tripOfferingTypes": () => ({}),
  "./useTripOfferingState": () => jest.requireActual("@mingla/offering-rendering/useTripOfferingState"),
  "./tripGuide": () => jest.requireActual("@mingla/offering-rendering/tripGuide"),
};
const loadTripBody = (): React.ComponentType<Record<string, unknown>> => {
  const output = ts.transpileModule(fs.readFileSync(path.join(PACKAGE, "TripOfferingBody.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const req = (specifier: string): unknown => {
    const supply = TRIP_BOUNDARY[specifier];
    if (supply === undefined) throw new Error(`Unclassified TripOfferingBody boundary: ${specifier}`);
    return supply();
  };
  const module = { exports: {} as { TripOfferingBody: React.ComponentType<Record<string, unknown>> } };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports.TripOfferingBody;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tripState = require("@mingla/offering-rendering/useTripOfferingState") as {
  useTripOfferingState: (input: Record<string, unknown>) => Record<string, unknown>;
};
const tripTier = (ticketTypeId: string, buyerExtras?: unknown) => ({
  id: `t-${ticketTypeId}`,
  ticketTypeId,
  tierName: `Package ${ticketTypeId}`,
  priceCents: 180000,
  currency: "USD",
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 4,
  installmentSchedule: null,
  ...(buyerExtras !== undefined ? { buyerExtras } : {}),
});
const tripData = (tiers: unknown[]): Record<string, unknown> => ({
  id: "trip-3281",
  title: "Albania coast",
  description: "Eight days.",
  startAt: "2026-06-28T08:00:00.000Z",
  endAt: "2026-07-02T18:00:00.000Z",
  durationLabel: "5 days",
  dateRangeLabel: "Jun 28 – Jul 2, 2026",
  departureCityCountry: "Tirana, Albania",
  destinationCityCountry: "Sarandë, Albania",
  destinationText: "Sarandë",
  spotsLabel: null,
  bookingDeadlineIso: null,
  days: [],
  inclusions: [],
  refundPolicy: null,
  tiers,
  currency: "USD",
  destinationLat: null,
  destinationLng: null,
  bookable: true,
  bookingsClosed: false,
});
const renderTrip = async (
  tiers: unknown[],
  addOns: OfferingAddOnsSlot | null | undefined,
  selector: boolean,
): Promise<Renderer> => {
  const TripOfferingBody = loadTripBody();
  const data = tripData(tiers);
  const pal = (jest.requireActual("@mingla/offering-rendering/themePalette") as {
    createThemePalette: (t: Record<string, string>) => unknown;
  }).createThemePalette({ color: "#eb7825", font: "inter", animation: "none" });
  const Harness = (): React.ReactElement => {
    const state = tripState.useTripOfferingState({
      data,
      paymentPlanChoice: "full",
      onReserve: () => undefined,
      now: new Date("2026-06-01T00:00:00Z"),
    });
    return React.createElement(TripOfferingBody, {
      data,
      brand: { id: "b1", slug: "y", name: "Y", bio: null, coverMediaUrl: null, coverMediaType: null, coverHue: null, verified: false },
      palette: pal,
      theme: { color: "#eb7825", font: "inter", animation: "none" },
      state,
      callbacks: { onReserve: () => undefined },
      variant: "phone",
      paymentPlanChoice: "full",
      onPaymentPlanChoiceChange: () => undefined,
      ...(selector ? { quantities: {}, onChangeQuantity: () => undefined } : {}),
      ...(addOns !== undefined ? { addOns } : {}),
    });
  };
  return mount(<Harness />);
};

afterEach(() => {
  mockFlags.extras = false;
});

describe("#3281 S2 the shared bodies call the add-ons slot under each card", () => {
  test("event: once per ticket, right after that ticket, with its raw list and currency; omitted -> none", async () => {
    const plain = await renderEvent([ticket("t-a", [ADD_ON]), ticket("t-b")]);
    expect(ids(plain).filter((id) => id.startsWith("slot-"))).toEqual([]);
    plain.unmount();

    const { slot, calls } = recordingSlot();
    const tree = await renderEvent([ticket("t-a", [ADD_ON]), ticket("t-b")], slot);
    expect(calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["t-a", [ADD_ON], "GBP"],
      ["t-b", undefined, "GBP"],
    ]);
    expect(calls[0][3]).toBe(palette);
    const order = ids(tree).filter((id) => id === "slot-t-a" || id === "slot-t-b");
    expect(order).toEqual(["slot-t-a", "slot-t-b"]);
    tree.unmount();
  });

  test("experience: the single ticket, or each price option", async () => {
    const single = recordingSlot();
    const one = await renderExperience({}, single.slot);
    expect(single.calls.map((c) => [c[0], c[1], c[2]])).toEqual([["tt-1", [ADD_ON], "USD"]]);
    one.unmount();

    const many = recordingSlot();
    const options = await renderExperience(
      { options: [experienceTicket("o-1", [ADD_ON]), experienceTicket("o-2")] },
      many.slot,
    );
    expect(many.calls.map((c) => c[0])).toEqual(["o-1", "o-2"]);
    expect(ids(options)).toEqual(expect.arrayContaining(["slot-o-1", "slot-o-2"]));
    options.unmount();

    const none = await renderExperience({});
    expect(ids(none).filter((id) => id.startsWith("slot-"))).toEqual([]);
    none.unmount();
  });

  test("trip: each package row in the selector, and the single read-only package", async () => {
    const rows = recordingSlot();
    const selector = await renderTrip([tripTier("p-1", [ADD_ON]), tripTier("p-2")], rows.slot, true);
    expect(rows.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ["p-1", [ADD_ON], "USD"],
      ["p-2", undefined, "USD"],
    ]);
    selector.unmount();

    const single = recordingSlot();
    const readOnly = await renderTrip([tripTier("p-1", [ADD_ON])], single.slot, false);
    expect(single.calls.map((c) => c[0])).toEqual(["p-1"]);
    expect(ids(readOnly)).toContain("slot-p-1");
    readOnly.unmount();

    const off = await renderTrip([tripTier("p-1", [ADD_ON])], undefined, true);
    expect(ids(off).filter((id) => id.startsWith("slot-"))).toEqual([]);
    off.unmount();
  });
});

describe("#3281 S2 the Host web / buyer web slot (addOns/publicAddOnsSlot)", () => {
  // The slot is fixed when the module loads (like the flag), so each case loads
  // a fresh copy with its own React and renderer.
  type Isolated = {
    slot: OfferingAddOnsSlot | null;
    R: typeof React;
    renderer: typeof TestRenderer;
  };
  const load = (failChunk = false): Isolated => {
    let out!: Isolated;
    jest.isolateModules(() => {
      if (failChunk) {
        jest.doMock("../../addOns/PublicAddOnsBlock", () => {
          throw new Error("chunk failed");
        });
      }
      out = {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        slot: (require("../../addOns/publicAddOnsSlot") as { publicAddOnsSlot: OfferingAddOnsSlot | null }).publicAddOnsSlot,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        R: require("react") as typeof React,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        renderer: require("react-test-renderer") as typeof TestRenderer,
      };
    });
    return out;
  };

  test("flag off: no slot, so the pages render as before", () => {
    mockFlags.extras = false;
    expect(load().slot).toBeNull();
  });

  test("flag on: the block loads on use and lists the add-on with its all-in price and stored thumbnail", async () => {
    mockFlags.extras = true;
    const { slot, R, renderer } = load();
    expect(slot).not.toBeNull();
    let tree!: Renderer;
    await renderer.act(async () => {
      tree = renderer.create(R.createElement(R.Fragment, null, slot?.("t-a", [ADD_ON], "USD", palette)));
    });
    for (let i = 0; i < 3; i++) {
      await renderer.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("Add at checkout:");
    expect(json).toContain("issue-3281-offering-add-ons-t-a");
    expect(json).toContain("Friday dinner");
    expect(json).toContain("https://cdn.example/event_covers/add-ons/e/x1_thumb.jpg");
    expect(json).not.toContain("render/image");
    await renderer.act(async () => tree.unmount());
  });

  test("a chunk that fails to load is logged and renders nothing (the page stays up)", async () => {
    mockFlags.extras = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { slot, R, renderer } = load(true);
    let tree!: Renderer;
    await renderer.act(async () => {
      tree = renderer.create(R.createElement(R.Fragment, null, slot?.("t-a", [ADD_ON], "USD", palette)));
    });
    for (let i = 0; i < 3; i++) {
      await renderer.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(tree.toJSON()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    jest.dontMock("../../addOns/PublicAddOnsBlock");
    await renderer.act(async () => tree.unmount());
  });
});
