jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    resolveTheme: () => ({}),
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);
import { consumerBrandEventUrl } from "../../hooks/useBrandBySlug";

const common = {
  id: "id",
  name: "Name",
  brandSlug: "brand",
  status: "scheduled",
  operatorEndedAtUtc: null,
  masterStartAtUtc: "2099-01-01T00:00:00Z",
  masterEndAtUtc: "2099-01-01T01:00:00Z",
  masterTimezone: "UTC",
  dateLine: "Date",
  venueName: null,
  format: "online",
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  tickets: [],
} as const;

test.each(["event", "rsvp"] as const)(
  "routes %s cards through the public event detail route",
  (eventType) => {
    expect(
      consumerBrandEventUrl({ ...common, eventType, eventSlug: eventType }),
    ).toBe(`https://host.usemingla.com/e/brand/${eventType}`);
  },
);
