import { buildAdViewContentPayload } from "../adViewContentPayload";

test("#3697 ViewContent chooses the lowest real offering value and carries identity", () => {
  expect(
    buildAdViewContentPayload({
      contentId: "event-1",
      brandId: "brand-1",
      currency: "gbp",
      valuesMajor: [35, null, 20, Number.NaN],
    }),
  ).toEqual({
    contentId: "event-1",
    brandId: "brand-1",
    value: 20,
    currency: "GBP",
  });
});

test("#3697 ViewContent preserves a known free offering at value zero", () => {
  expect(
    buildAdViewContentPayload({
      contentId: "rsvp-1",
      brandId: "brand-1",
      currency: "USD",
      valuesMajor: [],
      freeWhenUnpriced: true,
    }),
  ).toEqual({
    contentId: "rsvp-1",
    brandId: "brand-1",
    value: 0,
    currency: "USD",
  });
});

test("#3697 ViewContent fails closed without product identity, currency or value", () => {
  expect(
    buildAdViewContentPayload({
      contentId: "",
      brandId: "brand-1",
      currency: "USD",
      valuesMajor: [10],
    }),
  ).toBeNull();
  expect(
    buildAdViewContentPayload({
      contentId: "event-1",
      brandId: "brand-1",
      currency: null,
      valuesMajor: [10],
    }),
  ).toBeNull();
  expect(
    buildAdViewContentPayload({
      contentId: "event-1",
      brandId: "brand-1",
      currency: "USD",
      valuesMajor: [],
    }),
  ).toBeNull();
});

test("#3697 resolved event, trip and experience data produce provider-safe payloads", () => {
  const offerings = [
    { contentId: "event-1", brandId: "brand-1", currency: "usd", valuesMajor: [25, 10] },
    { contentId: "trip-1", brandId: "brand-2", currency: "gbp", valuesMajor: [120] },
    { contentId: "experience-1", brandId: "brand-3", currency: "ngn", valuesMajor: [8_500, 7_500] },
  ] as const;

  expect(offerings.map((offering) => buildAdViewContentPayload(offering))).toEqual([
    { contentId: "event-1", brandId: "brand-1", currency: "USD", value: 10 },
    { contentId: "trip-1", brandId: "brand-2", currency: "GBP", value: 120 },
    { contentId: "experience-1", brandId: "brand-3", currency: "NGN", value: 7_500 },
  ]);
});
