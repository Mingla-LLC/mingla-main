import {
  buildTurnoutInput,
  turnoutInputKey,
} from "../turnoutInput";

const futureDate = (): string => {
  const value = new Date();
  value.setDate(value.getDate() + 45);
  return value.toISOString().slice(0, 10);
};

const experienceSource = (resolvedTotalMajor: number) => ({
  kind: "experience" as const,
  title: "  Lagos Night Walk  ",
  intents: ["romantic" as const, "group-fun" as const],
  stops: [
    {
      clientId: "first",
      placeId: null,
      placeName: "  Art Roost  ",
      address: "2 Alexander Avenue",
      city: "  Lagos  ",
      region: null,
      countryCode: "NG",
      lat: 6.4,
      lng: 3.4,
      imageUrls: [],
      startTime: "18:00",
      priceMajor: "0",
      description: "Start here",
    },
  ],
  when: {
    whenMode: "single" as const,
    date: futureDate(),
    doorsOpen: "18:00",
    endsAt: "21:00",
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: null,
  },
  pricingMode: "whole" as const,
  resolvedTotalMajor,
  isFree: false,
  capacity: "0017",
  unlimited: false,
  brandDefaultCurrency: "ngn",
});

describe("#1742 independent Experience input adversary", () => {
  it("binds Experience to the shared canonical input and key truth", () => {
    const result = buildTurnoutInput(experienceSource(25.5));
    expect(result).toEqual({
      ok: true,
      input: {
        title: "Lagos Night Walk",
        category: "Romantic, Group Fun",
        city: "Lagos",
        venue_name: "Art Roost",
        date: futureDate(),
        indoor_outdoor: "indoor",
        ticket_price: 25.5,
        capacity: 17,
        budget: 0,
        audience_size: null,
        lineup: null,
        start_time: "18:00",
        currency: "NGN",
      },
    });
    if (!result.ok) throw new Error("Experience unexpectedly blocked");
    expect(turnoutInputKey(result.input)).toContain('"tool":"events"');
  });

  it("normalizes the modeled per-head price to the specified two decimals", () => {
    const result = buildTurnoutInput(experienceSource(25.555));
    expect(result).toMatchObject({
      ok: true,
      input: { ticket_price: 25.56 },
    });
  });
});
