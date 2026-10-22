import { buildAdViewContentPayload } from "../adViewContentPayload";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const businessRoot = resolve(__dirname, "../../..");

function routeSource(path: string): string {
  return readFileSync(resolve(businessRoot, path), "utf8");
}

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

test("#3697 offering routes fire ViewContent only after resolved product data", () => {
  const routes = [
    {
      path: "app/e/[brandSlug]/[eventSlug].tsx",
      contentId: "contentId: detail.event.id",
      brandId: "brandId: detail.event.brandId",
    },
    {
      path: "app/t/[brandSlug]/[tripSlug].tsx",
      contentId: "contentId: payload.trip.id",
      brandId: "brandId: payload.trip.brandId",
    },
    {
      path: "app/exp/[brandSlug]/[experienceSlug].tsx",
      contentId: "contentId: payload.experience.id",
      brandId: "brandId: payload.experience.brandId",
    },
  ];

  for (const route of routes) {
    const source = routeSource(route.path);
    expect(source).toContain(route.contentId);
    expect(source).toContain(route.brandId);
    expect(source).toContain("fireAdViewContent(");
    expect(source).not.toContain("fireAdViewContent();");
  }

  const brand = routeSource("app/b/[brandSlug]/index.tsx");
  expect(brand).not.toContain("fireAdViewContent");
});
