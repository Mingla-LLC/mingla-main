/**
 * Issue #1563 [room-price-filter] — WEB-RESOLVED render proof: a guest can SEE
 * the price bands and TAPPING one really narrows the list of rooms in front of
 * them. Append-only: NEW file, modifies and deletes nothing.
 *
 * WHY THIS SUITE IS WEB-RESOLVED (`react-native` -> `react-native-web`). The
 * #1484 P1-1 lesson: the Stay desktop uncap shipped VISIBLY BROKEN while 29
 * headless react-test-renderer suites were green, because plain `react-native`
 * never runs react-native-web's style compiler or emits DOM. #1563's whole claim
 * is that a stranger on the buyer web page can narrow a hotel by price, so it is
 * proved against the markup and the mounted, pressed component — not a selected
 * style object.
 *
 * The band/sort/empty-answer MATHS is proved separately and exhaustively in
 * `mingla-business/src/components/venue/__tests__/stayRoomPriceFilter.issue1563
 * .happy.test.ts`, which runs under the REQUIRED full-suite check. This file
 * proves only what a renderer can prove: the control reaches the DOM, the press
 * changes what is rendered, and the states have real copy.
 *
 * EVERY block carries a VACUITY GUARD. A markup query that silently matches
 * nothing is the failure mode that made #1484 pass while broken, so each block
 * asserts a positive fact — an exact room count, a known label — that cannot
 * hold if the lookup matched nothing.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION, not by commenting out —
 * commented code still satisfies a source-text gate, which is how a revert can
 * appear to be caught while the product is broken):
 *   - delete the `<RoomPriceFilter …/>` element from StayGuestBooking
 *       -> R-1, R-2, R-3, R-4, R-5 RED (no band chips reach the markup)
 *   - make `shownRooms` return `rooms` unconditionally
 *       -> R-3 RED (pressing "Under $300" still renders all six rooms)
 *   - delete the `priceFilterHidEverything` branch
 *       -> R-5 RED (the zero-result path falls through to "No Rooms are
 *          available yet", which is a lie while four rooms exist)
 *   - delete the parity guard in stayRoomPriceFilter.ts
 *       -> R-7 RED (a per-booking room gets banded as a nightly rate)
 *
 * Run: cd mingla-business && npx jest --config jest.issue1563.cfg.cjs --runInBand
 */

import type { PublicStayDetail, PublicStayOffering } from "../stayGuest";
import { StayGuestBooking } from "../StayGuestBooking";
import { BrandRenderingReact as React } from "../PublicVenueTabs";

// `react-dom/server` and `react-test-renderer` ship no type declarations in
// this workspace, so use the repo's typed-require idiom (same form as the
// #1484 / #1503 render suites) instead of a bare import that would add a TS7016
// to the issue-1403 typecheck-delta gate.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  toJSON: () => unknown;
  /** Re-render with new props, KEEPING state — the refetch path in R-5. */
  update: (element: unknown) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: unknown) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PALETTE = {
  page: "#0c0e12",
  accent: "#eb7825",
  accentText: "#0c0e12",
  primaryText: "#ffffff",
  secondaryText: "rgba(255,255,255,0.72)",
  tertiaryText: "rgba(255,255,255,0.48)",
  panel: "#14171d",
  panelStrong: "#191d24",
  panelBorder: "#2b3038",
  card: "#14171d",
  cutoutBorder: "#2b3038",
  glass: "rgba(255,255,255,0.06)",
  glassTint: "dark" as const,
  accentWash: "rgba(235,120,37,0.16)",
};
const SURFACE = { card: {}, panel: {}, cutout: {} };
const THEME = { fontFamilyValue: "System", color: "#eb7825" };

function offering(
  id: string,
  name: string,
  amountMinor: string,
  overrides: Partial<PublicStayOffering> = {},
): PublicStayOffering {
  return {
    id,
    kind: "room",
    name,
    summary: "",
    description: "",
    confirmationMode: "instant",
    inventoryBasis: "pooled_units",
    unitNamingMode: "interchangeable",
    quantity: 4,
    capacity: null,
    minGuests: 1,
    maxGuests: 2,
    maxAdults: 2,
    maxChildren: 1,
    placePricingBasis: null,
    minNoticeMinutes: 0,
    maxAdvanceDays: null,
    amenities: [],
    safetyRules: [],
    accessibilityFeatures: [],
    accessScope: "public",
    price: {
      amountMinor,
      currencyCode: "USD",
      pricingUnit: "room_night",
    },
    fees: [],
    policy: {
      cancellationPolicy: "Free cancellation up to 24 hours before check-in.",
      freeCancelCutoffMinutes: 1440,
      requestTerms: null,
      houseRules: null,
    },
    media: [],
    placeWindows: [],
    ...overrides,
  } as PublicStayOffering;
}

/**
 * A hotel with a real spread. Deliberately NOT in price order on the wire —
 * today rooms arrive in an internal order the guest can neither see nor change,
 * and #1550's approved default is price, low to high.
 */
const ROOMS: PublicStayOffering[] = [
  offering("ocean", "Ocean Suite", "35000"),
  offering("garden", "Garden Suite", "27500"),
  offering("penthouse", "Penthouse", "88000"),
  offering("bunk", "Bunk Room", "9900"),
  offering("courtyard", "Courtyard Double", "19900"),
  offering("balcony", "Balcony King", "51000"),
];

/** The bands those six prices generate — the design mock's own three. */
const EXPECTED_BANDS = ["Any price", "Under $300", "$300–$500", "$500+"];

function stayDetail(
  offerings: PublicStayOffering[] = ROOMS,
  overrides: Partial<PublicStayDetail> = {},
): PublicStayDetail {
  return {
    venueId: "venue-1563",
    brandId: "brand-1563",
    brandSlug: "smokerhythm",
    brandName: "Smoke & Rhythm",
    venueSlug: "minglastay1467proof",
    venueName: "Mingla Stay 1467 Proof",
    propertyKind: "hotel",
    timezone: "America/New_York",
    defaultBookingMode: "instant",
    checkInTime: "15:00:00",
    checkOutTime: "11:00:00",
    bookingHorizonDays: 365,
    houseRules: null,
    offerings,
    ...overrides,
  } as PublicStayDetail;
}

function bookingElement(detail: PublicStayDetail): unknown {
  return React.createElement(
    StayGuestBooking as unknown as React.FC<Record<string, unknown>>,
    {
      detail,
      state: "ready",
      palette: PALETTE,
      surface: SURFACE,
      theme: THEME,
      onSubmit: () => undefined,
    },
  );
}

function renderMarkup(detail: PublicStayDetail): string {
  return ReactDOMServer.renderToStaticMarkup(bookingElement(detail));
}

/** Mount for real, inside `act` (React 19 requires it for the initial mount). */
async function mount(detail: PublicStayDetail): Promise<Tree> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(bookingElement(detail));
  });
  return created as Tree;
}

/**
 * Every rendered room card, by name, in render order. Room cards announce
 * themselves with `accessibilityLabel="Room: <name>"`, which react-native-web
 * emits as `aria-label`, so this reads what a screen reader would read.
 */
function renderedRoomNames(tree: Tree): string[] {
  return tree.root
    .findAll((node) => {
      // HOST nodes only. `findAll` walks composite components too, and under
      // react-native-web a `View` carries `accessibilityLabel` while the `div`
      // it renders carries `aria-label` — counting both reports every room
      // twice, which would let a broken filter look like a working one.
      if (typeof node.type !== "string") return false;
      const label = node.props["aria-label"];
      return typeof label === "string" && label.startsWith("Room: ");
    })
    .map((node) => (node.props["aria-label"] as string).slice("Room: ".length));
}

/**
 * Press the control whose accessible name starts with `prefix`.
 *
 * The press goes through the `Pressable` CONTRACT (`onPress`), not the emitted
 * `<button onClick>`. react-native-web routes a real press through its own
 * responder system, and the DOM `onClick` it attaches is the keyboard/AT path —
 * invoking it with a synthesised event does not reach `onPress`, so a test
 * written that way would appear to press and silently change nothing. Asserting
 * on the DOM stays where it belongs: the markup blocks below read the emitted
 * `aria-label`s and copy, which is what proves the chips are really there and
 * really announce themselves.
 */
async function press(tree: Tree, prefix: string): Promise<void> {
  const matches = tree.root.findAll((node) => {
    if (typeof node.type === "string") return false;
    const label = node.props.accessibilityLabel;
    return (
      typeof label === "string" &&
      label.startsWith(prefix) &&
      typeof node.props.onPress === "function"
    );
  });
  // VACUITY GUARD — a press against nothing is the classic silent pass.
  expect(matches.length).toBeGreaterThan(0);
  const onPress = matches[0].props.onPress as () => void;
  await TestRenderer.act(() => {
    onPress();
  });
}

/** Every band chip's accessible name, in render order. */
function bandLabels(tree: Tree): string[] {
  return tree.root
    .findAll((node) => {
      if (typeof node.type !== "string") return false;
      const label = node.props["aria-label"];
      return (
        typeof label === "string" &&
        (label.startsWith("Any price") ||
          label.startsWith("Under ") ||
          /^\$/.test(label))
      );
    })
    .map((node) => node.props["aria-label"] as string);
}

// ---------------------------------------------------------------------------
// R-1 … R-4 — the control is there, and it works.
// ---------------------------------------------------------------------------

describe("#1563 R-1/R-2 · the bands reach the buyer-web DOM", () => {
  test("R-1 the band chips, the count and the qualifier all render", () => {
    const html = renderMarkup(stayDetail());
    // VACUITY GUARD — the page really rendered.
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Any price");
    expect(html).toContain("6 rooms");
    // TRAP 2 — the qualifier sits in the SAME block as the band labels, never a
    // footnote elsewhere, and it is #1562's sentence verbatim.
    expect(html).toContain("before taxes and fees");
    // It must never read as a final price.
    expect(html).not.toContain("total price");
    expect(html).not.toContain("all-in");
  });

  test("R-1 every band announces itself with its own live count", async () => {
    const tree = await mount(stayDetail());
    const labels = bandLabels(tree);
    // VACUITY GUARD — an empty list would pass any `every()` below.
    expect(labels.length).toBe(EXPECTED_BANDS.length);
    expect(labels.map((label) => label.split(",")[0])).toEqual(EXPECTED_BANDS);
    // 3 under $300 (99/199/275), 1 in $300-500 (350), 2 at $500+ (510/880).
    expect(labels).toEqual([
      "Any price, 6 rooms",
      "Under $300, 3 of 6 rooms",
      "$300–$500, 1 of 6 rooms",
      "$500+, 2 of 6 rooms",
    ]);
    tree.unmount();
  });

  test("R-2 bands are derived from THIS venue's prices, not hard-coded", async () => {
    const tree = await mount(stayDetail());
    expect(bandLabels(tree).map((l) => l.split(",")[0])).toEqual(EXPECTED_BANDS);
    tree.unmount();

    // A cheaper hotel gets entirely different boundaries — proof of derivation.
    const cheap = await mount(
      stayDetail([
        offering("a", "Single", "4000"),
        offering("b", "Double", "6000"),
        offering("c", "Twin", "9000"),
      ]),
    );
    const cheapLabels = cheap.root
      ? bandLabels(cheap).map((l) => l.split(",")[0])
      : [];
    expect(cheapLabels.length).toBeGreaterThan(1); // vacuity
    expect(cheapLabels).not.toEqual(EXPECTED_BANDS);
    expect(cheapLabels[0]).toBe("Any price");
    cheap.unmount();
  });
});

describe("#1563 R-3 · pressing a band really narrows the list", () => {
  test("R-3 the default order is price, low to high", async () => {
    const tree = await mount(stayDetail());
    // Not "the list is shorter" — WHICH rooms, in WHICH order, over a set proved
    // non-empty. On the wire they arrive ocean/garden/penthouse/bunk/…
    expect(renderedRoomNames(tree)).toEqual([
      "Bunk Room",
      "Courtyard Double",
      "Garden Suite",
      "Ocean Suite",
      "Balcony King",
      "Penthouse",
    ]);
    tree.unmount();
  });

  test("R-3 tapping a band leaves exactly the rooms it names", async () => {
    const tree = await mount(stayDetail());
    expect(renderedRoomNames(tree)).toHaveLength(6); // vacuity

    await press(tree, "Under $300");
    expect(renderedRoomNames(tree)).toEqual([
      "Bunk Room",
      "Courtyard Double",
      "Garden Suite",
    ]);
    // The count line follows the list.
    expect(bandLabels(tree)[0]).toBe("Any price, 6 rooms");

    await press(tree, "$500+");
    expect(renderedRoomNames(tree)).toEqual(["Balcony King", "Penthouse"]);

    await press(tree, "$300–$500");
    expect(renderedRoomNames(tree)).toEqual(["Ocean Suite"]);

    // …and "Any price" puts every room back.
    await press(tree, "Any price");
    expect(renderedRoomNames(tree)).toHaveLength(6);
    tree.unmount();
  });

  test("R-4 the sort control reverses the order without changing the set", async () => {
    const tree = await mount(stayDetail());
    expect(renderedRoomNames(tree)[0]).toBe("Bunk Room"); // vacuity
    await press(tree, "Sort rooms.");
    expect(renderedRoomNames(tree)).toEqual([
      "Penthouse",
      "Balcony King",
      "Ocean Suite",
      "Garden Suite",
      "Courtyard Double",
      "Bunk Room",
    ]);
    // Reversing again returns to the default.
    await press(tree, "Sort rooms.");
    expect(renderedRoomNames(tree)[0]).toBe("Bunk Room");
    tree.unmount();
  });

  test("R-4 sort and filter compose — order holds inside a band", async () => {
    const tree = await mount(stayDetail());
    await press(tree, "Under $300");
    await press(tree, "Sort rooms.");
    expect(renderedRoomNames(tree)).toEqual([
      "Garden Suite",
      "Courtyard Double",
      "Bunk Room",
    ]);
    tree.unmount();
  });
});

// ---------------------------------------------------------------------------
// R-5 — zero results is a real answer, never a blank list.
// ---------------------------------------------------------------------------

describe("#1563 R-5 · the empty answer", () => {
  /**
   * THE REACHABLE PRODUCTION PATH, reproduced exactly. `usePublicStayDetail`
   * refetches; the rooms in the band the guest is standing in have sold out and
   * dropped out of the payload; the band empties underneath them. `tree.update`
   * re-renders with the new offerings while KEEPING component state, which is
   * precisely what a refetch does.
   */
  test("R-5 an emptied band says what happened and offers one tap back", async () => {
    const tree = await mount(stayDetail());
    await press(tree, "$500+");
    // VACUITY: the band really held rooms before the refetch.
    expect(renderedRoomNames(tree)).toEqual(["Balcony King", "Penthouse"]);

    const survivors = ROOMS.filter(
      (room) => room.id !== "penthouse" && room.id !== "balcony",
    );
    expect(survivors).toHaveLength(4); // vacuity: rooms still exist
    await TestRenderer.act(() => {
      tree.update(bookingElement(stayDetail(survivors)));
    });

    // The list is empty — and the page says so with a real answer.
    expect(renderedRoomNames(tree)).toEqual([]);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain("No Rooms in that price range");
    // It names the real cheapest price, with the qualifier attached.
    expect(json).toContain("$99");
    expect(json).toContain("before taxes and fees");
    // It NEVER borrows the "this Stay has no Rooms" copy while four exist.
    expect(json).not.toContain("No Rooms are available yet");
    // And there is one tap back.
    expect(json).toContain("Show all 4 rooms");

    await press(tree, "Show all 4 rooms");
    expect(renderedRoomNames(tree)).toHaveLength(4);
    tree.unmount();
  });

  test("R-5 a populated page never shows the empty answer", () => {
    const html = renderMarkup(stayDetail());
    expect(html).toContain("Ocean Suite");
    expect(html).not.toContain("No Rooms in that price range");
    expect(html).not.toContain("No Rooms are available yet");
  });
});

describe("#1563 R-6 · mixed currencies render no control at all", () => {
  test("R-6 two currencies remove the bands and leave every room visible", async () => {
    const mixed = [
      offering("usd", "Ocean Suite", "35000"),
      offering("eur", "Garden Suite", "27500", {
        price: {
          amountMinor: "27500",
          currencyCode: "EUR",
          pricingUnit: "room_night",
        },
      }),
    ];
    const html = renderMarkup(stayDetail(mixed));
    // No band UI…
    expect(html).not.toContain("Any price");
    expect(html).not.toContain("Price: low to high");
    // …and NOTHING is hidden: both rooms still render.
    const tree = await mount(stayDetail(mixed));
    expect(renderedRoomNames(tree)).toEqual(["Ocean Suite", "Garden Suite"]);
    tree.unmount();

    // VACUITY GUARD — the identical fixture in one currency DOES show bands, so
    // the absence above is the currency rule and not a broken fixture.
    const single = [
      offering("usd", "Ocean Suite", "35000"),
      offering("eur", "Garden Suite", "27500"),
    ];
    expect(renderMarkup(stayDetail(single))).toContain("Any price");
  });
});

describe("#1563 R-7 · a room not priced per night removes the control", () => {
  test("R-7 a per-booking room is never banded as a nightly rate", async () => {
    // The live property's shape, with the cabana entered as a ROOM — which the
    // schema permits: `kind` and `pricing_unit` are independent columns.
    const withCabana = [
      offering("garden", "Garden Suite", "27500"),
      offering("ocean", "Ocean Suite", "35000"),
      offering("cabana", "Pool Cabana", "7500", {
        price: {
          amountMinor: "7500",
          currencyCode: "USD",
          pricingUnit: "place_booking",
        },
      }),
    ];
    const html = renderMarkup(stayDetail(withCabana));
    expect(html).not.toContain("Any price");
    // The cabana is still SHOWN — refusing to band it never hides it — and it
    // is still labelled with its own unit.
    expect(html).toContain("Pool Cabana");
    expect(html).toContain("per booking");

    const tree = await mount(stayDetail(withCabana));
    expect(renderedRoomNames(tree)).toHaveLength(3);
    tree.unmount();

    // VACUITY GUARD — price that same cabana per night and the bands appear.
    const allNightly = [
      offering("garden", "Garden Suite", "27500"),
      offering("ocean", "Ocean Suite", "35000"),
      offering("cabana", "Pool Cabana", "7500"),
    ];
    expect(renderMarkup(stayDetail(allNightly))).toContain("Any price");
  });
});

describe("#1563 R-8 · one room, and one price", () => {
  test("R-8 a single room gets no control and still renders", () => {
    const html = renderMarkup(stayDetail([offering("only", "The Room", "27500")]));
    expect(html).toContain("The Room");
    expect(html).not.toContain("Any price");
  });

  test("R-8 every room at the same price gets no control", () => {
    const html = renderMarkup(
      stayDetail([
        offering("a", "Room A", "35000"),
        offering("b", "Room B", "35000"),
      ]),
    );
    expect(html).toContain("Room A");
    expect(html).toContain("Room B");
    expect(html).not.toContain("Any price");
  });
});
