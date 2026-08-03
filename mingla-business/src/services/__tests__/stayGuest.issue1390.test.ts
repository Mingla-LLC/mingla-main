import {
  buildStayRoomAllocations,
  buildStayRoomCartAllocations,
  formatStayMoney,
  parsePublicStayDetail,
  stayCheckoutMode,
  validateStayGuestCart,
  type PublicStayDetail,
} from "@mingla/brand-rendering/stayGuest";

const detail = (): PublicStayDetail => ({
  venueId: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  brandSlug: "lagoon",
  brandName: "Lagoon",
  venueSlug: "lagoon-stay",
  venueName: "Lagoon Stay",
  propertyKind: "resort",
  timezone: "Africa/Lagos",
  defaultBookingMode: "instant",
  checkInTime: "15:00:00",
  checkOutTime: "11:00:00",
  bookingHorizonDays: 365,
  houseRules: null,
  offerings: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      kind: "room",
      name: "Garden Room",
      summary: "",
      description: "",
      confirmationMode: "instant",
      inventoryBasis: "pooled_units",
      unitNamingMode: "interchangeable",
      quantity: 12,
      capacity: null,
      minGuests: 1,
      maxGuests: 4,
      maxAdults: 4,
      maxChildren: 3,
      placePricingBasis: null,
      minNoticeMinutes: 0,
      maxAdvanceDays: 365,
      amenities: ["Wi-Fi"],
      safetyRules: [],
      accessibilityFeatures: [],
      accessScope: "public",
      price: {
        amountMinor: "125000",
        currencyCode: "NGN",
        pricingUnit: "room_night",
      },
      fees: [],
      policy: {
        cancellationPolicy: "Flexible",
        freeCancelCutoffMinutes: 1440,
        requestTerms: null,
        houseRules: null,
      },
      media: [],
      placeWindows: [],
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      kind: "place",
      name: "Private Cabana",
      summary: "",
      description: "",
      confirmationMode: "request",
      inventoryBasis: "exclusive_units",
      unitNamingMode: "interchangeable",
      quantity: 4,
      capacity: null,
      minGuests: 1,
      maxGuests: 8,
      maxAdults: null,
      maxChildren: null,
      placePricingBasis: "per_booking",
      minNoticeMinutes: 0,
      maxAdvanceDays: 90,
      amenities: [],
      safetyRules: [],
      accessibilityFeatures: [],
      accessScope: "overnight_guests_only",
      price: {
        amountMinor: "50000",
        currencyCode: "NGN",
        pricingUnit: "place_booking",
      },
      fees: [],
      policy: {
        cancellationPolicy: "Standard",
        freeCancelCutoffMinutes: 0,
        requestTerms: "Approval required",
        houseRules: null,
      },
      media: [],
      placeWindows: [
        {
          id: "00000000-0000-4000-8000-000000000021",
          localDate: "2027-02-01",
          startsAt: "2027-02-01T12:00:00Z",
          endsAt: "2027-02-01T16:00:00Z",
          sellableUnits: 4,
          sellableCapacity: null,
          priceOverrideMinor: null,
          currencyCode: null,
        },
      ],
    },
  ],
});

describe("Issue #1390 Stay guest contracts", () => {
  test("formats source currency without a dollar fallback", () => {
    expect(formatStayMoney("12500000", "NGN", "en-NG")).toContain("125,000");
    expect(formatStayMoney("12500000", "NGN", "en-NG")).not.toContain("$");
    expect(formatStayMoney("5000", "JPY", "ja-JP")).toContain("5,000");
  });

  test("allocates guests across multiple rooms and rejects impossible occupancy", () => {
    expect(
      buildStayRoomAllocations({
        quantity: 2,
        adults: 2,
        children: 2,
        maxAdults: 2,
        maxChildren: 2,
      }),
    ).toEqual([
      { adults: 1, children: 1 },
      { adults: 1, children: 1 },
    ]);
    expect(
      buildStayRoomAllocations({
        quantity: 3,
        adults: 2,
        children: 0,
        maxAdults: 2,
        maxChildren: 2,
      }),
    ).toBeNull();
  });

  test("room allocations honor each Room's minimum and combined capacity", () => {
    expect(
      buildStayRoomAllocations({
        quantity: 2,
        adults: 2,
        children: 0,
        minGuests: 2,
        maxGuests: 4,
        maxAdults: 4,
        maxChildren: 3,
      }),
    ).toBeNull();
    expect(
      buildStayRoomAllocations({
        quantity: 2,
        adults: 3,
        children: 2,
        minGuests: 2,
        maxGuests: 3,
        maxAdults: 3,
        maxChildren: 2,
      }),
    ).toEqual([
      { adults: 2, children: 1 },
      { adults: 1, children: 1 },
    ]);
  });

  test("guest totals are distributed once across mixed Room types", () => {
    const plan = buildStayRoomCartAllocations({
      adults: 3,
      children: 1,
      rooms: [
        {
          offeringId: "garden",
          quantity: 1,
          minGuests: 1,
          maxGuests: 2,
          maxAdults: 2,
          maxChildren: 1,
        },
        {
          offeringId: "suite",
          quantity: 1,
          minGuests: 1,
          maxGuests: 3,
          maxAdults: 3,
          maxChildren: 2,
        },
      ],
    });
    const allocations = Object.values(plan ?? {}).flat();
    expect(allocations).toHaveLength(2);
    expect(
      allocations.reduce((sum, allocation) => sum + allocation.adults, 0),
    ).toBe(3);
    expect(
      allocations.reduce((sum, allocation) => sum + allocation.children, 0),
    ).toBe(1);
  });

  test("a Request Place makes the same-Stay mixed cart a Request", () => {
    const stay = detail();
    expect(
      stayCheckoutMode(stay, [
        {
          kind: "room",
          offeringId: stay.offerings[0].id,
          checkIn: "2027-02-01",
          checkOut: "2027-02-03",
          quantity: 2,
          allocations: [
            { adults: 1, children: 0 },
            { adults: 1, children: 0 },
          ],
        },
        {
          kind: "place",
          offeringId: stay.offerings[1].id,
          placeWindowId: stay.offerings[1].placeWindows[0].id,
          units: 1,
          guests: 2,
        },
      ]),
    ).toBe("request");
  });

  test("overnight-only Place fails without a Room and passes with one", () => {
    const stay = detail();
    const place = {
      kind: "place" as const,
      offeringId: stay.offerings[1].id,
      placeWindowId: stay.offerings[1].placeWindows[0].id,
      units: 1,
      guests: 2,
    };
    expect(validateStayGuestCart({ detail: stay, lines: [place] })).toContain(
      "overnight guests",
    );
    expect(
      validateStayGuestCart({
        detail: stay,
        lines: [
          {
            kind: "room",
            offeringId: stay.offerings[0].id,
            checkIn: "2027-02-01",
            checkOut: "2027-02-03",
            quantity: 1,
            allocations: [{ adults: 2, children: 0 }],
          },
          place,
        ],
      }),
    ).toBeNull();
  });

  test("one Place offering can contribute multiple scheduled windows", () => {
    const stay = detail();
    const place = stay.offerings[1];
    const secondWindow = {
      ...place.placeWindows[0],
      id: "00000000-0000-4000-8000-000000000022",
      startsAt: "2027-02-02T12:00:00Z",
      endsAt: "2027-02-02T16:00:00Z",
    };
    place.placeWindows.push(secondWindow);
    const room = {
      kind: "room" as const,
      offeringId: stay.offerings[0].id,
      checkIn: "2027-02-01",
      checkOut: "2027-02-03",
      quantity: 1,
      allocations: [{ adults: 2, children: 0 }],
    };
    const placeLine = (placeWindowId: string) => ({
      kind: "place" as const,
      offeringId: place.id,
      placeWindowId,
      units: 1,
      guests: 2,
    });
    expect(
      validateStayGuestCart({
        detail: stay,
        lines: [
          room,
          placeLine(place.placeWindows[0].id),
          placeLine(secondWindow.id),
        ],
      }),
    ).toBeNull();
  });

  test("public parser hydrates ready media paths without changing currency", () => {
    const source = detail();
    const raw = {
      ...source,
      offerings: source.offerings.map((offering, index) => ({
        ...offering,
        media:
          index === 0
            ? [{
                path: "brand/room.webp",
                mimeType: "image/webp",
                altText: "Garden room",
                isCover: true,
                sortOrder: 0,
              }]
            : [],
      })),
    };
    const parsed = parsePublicStayDetail(
      raw,
      (path) => `https://cdn.example/${path}`,
    );
    expect(parsed?.offerings[0].media[0].url).toBe(
      "https://cdn.example/brand/room.webp",
    );
    expect(parsed?.offerings[0].price.currencyCode).toBe("NGN");
  });
});
