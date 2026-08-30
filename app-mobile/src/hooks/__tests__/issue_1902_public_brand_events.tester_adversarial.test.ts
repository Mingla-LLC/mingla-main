import { beforeEach, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    resolveTheme: () => ({
      color: "#000000",
      foregroundColor: "#ffffff",
      font: "inter",
      fontFamilyValue: "Inter",
      animation: "none",
    }),
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
    resolveEventAcquisitionState: (
      jest.requireActual(
        "../../../../packages/offering-rendering/eventAcquisitionLifecycle",
      ) as { resolveEventAcquisitionState: unknown }
    ).resolveEventAcquisitionState,
    forwardableAcquisitionState: (
      jest.requireActual(
        "../../../../packages/offering-rendering/eventAcquisitionLifecycle",
      ) as { forwardableAcquisitionState: unknown }
    ).forwardableAcquisitionState,
  }),
  { virtual: true },
);

import { fetchConsumerBrandBySlug } from "../useBrandBySlug";

const chain = (result: unknown) => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"])
    builder[method] = jest.fn(() => builder);
  builder.order = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  return builder;
};

const brand = {
  id: "b",
  slug: "brand",
  name: "Brand",
  description: null,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: null,
  custom_links: null,
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  theme_color: null,
  theme_font: null,
  theme_animation: null,
};
const row = (id: string, eventType: "event" | "rsvp" = "event") => ({
  id,
  brand_id: "b",
  brand_slug: "brand",
  title: id,
  slug: id,
  event_type: eventType,
  location_text: null,
  is_online: false,
  cover_media_url: null,
  cover_media_type: null,
  status: "scheduled",
  public_theme: null,
  currency: "USD",
  master_start_at: "2026-08-29T12:00:00Z",
  master_end_at: "2026-08-30T19:00:00Z",
  master_timezone: "Africa/Lagos",
});
const bundle = (id: string) => ({
  id,
  brandId: "b",
  brandSlug: "brand",
  eventSlug: id,
  name: id,
  status: "scheduled",
  brand: { id: "b", slug: "brand", name: "Brand" },
  currency: "USD",
  occurrences: [
    { id: `${id}-d1`, startAt: "2026-08-29T12:00:00Z", endAt: "2026-08-29T19:00:00Z", timezone: "Africa/Lagos", isMaster: true },
    { id: `${id}-d2`, startAt: "2026-08-30T12:00:00Z", endAt: "2026-08-30T19:00:00Z", timezone: "Africa/Lagos", isMaster: false },
  ],
  tickets: [
    { id: `${id}-ticket`, name: "Free", priceCents: 0, currency: "USD", isFree: true, isHidden: false, isDisabled: false, availableOnline: true, availableInPerson: false },
  ],
});

const installReads = (events: ReturnType<typeof row>[]) => {
  mockFrom.mockImplementation(((table: string) => {
    if (table === "business_public_brands_view") return chain({ data: brand, error: null });
    if (table === "business_public_events_view") return chain({ data: events, error: null });
    throw new Error(`unexpected table ${table}`);
  }) as never);
};
const nonEventRpc = (name: string): boolean =>
  name === "pg_public_trips_by_brand" ||
  name === "pg_public_experiences_by_brand" ||
  name === "pg_public_brand_upcoming";

beforeEach(() => {
  jest.restoreAllMocks();
  mockFrom.mockReset();
  mockRpc.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T13:01:00Z"));
});

test("issue #2582 tester adversarial: Consumer hydration is max-four, ordered, RSVP-free, and NULL-excluding", async () => {
  const events = [row("e0"), row("e1"), row("e2"), row("null"), row("e4"), row("e5"), row("r", "rsvp")];
  installReads(events);
  let active = 0;
  let maximum = 0;
  const bundleIds: string[] = [];
  mockRpc.mockImplementation(((name: string, args: Record<string, unknown>) => {
    if (nonEventRpc(name)) return Promise.resolve({ data: [], error: null });
    if (name !== "pg_direct_event_checkout_bundle") throw new Error(`unexpected RPC ${name}`);
    const id = String(args.p_event_id);
    bundleIds.push(id);
    active += 1;
    maximum = Math.max(maximum, active);
    return new Promise((resolve) => {
      const delay = id === "e0" ? 30 : id === "e1" ? 20 : 5;
      setTimeout(() => {
        active -= 1;
        resolve({ data: id === "null" ? null : bundle(id), error: null });
      }, delay);
    });
  }) as never);

  const result = await fetchConsumerBrandBySlug("brand");
  expect(maximum).toBe(4);
  expect(bundleIds.sort()).toEqual(["e0", "e1", "e2", "e4", "e5", "null"]);
  expect(result?.events.map((event) => event.id)).toEqual(["e0", "e1", "e2", "e4", "e5", "r"]);
  expect(result?.events.map((event) => event.terminalSource.kind)).toEqual([
    "occurrences", "occurrences", "occurrences", "occurrences", "occurrences", "single_end",
  ]);
});

test("issue #2582 tester adversarial: malformed and transport failures reject the whole Consumer brand query", async () => {
  installReads([row("bad")]);
  mockRpc.mockImplementation(((name: string) => {
    if (nonEventRpc(name)) return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: [], error: null });
  }) as never);
  await expect(fetchConsumerBrandBySlug("brand")).rejects.toThrow(
    "invalid_direct_event_checkout_bundle",
  );

  mockRpc.mockImplementation(((name: string) => {
    if (nonEventRpc(name)) return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: new Error("transport-down") });
  }) as never);
  await expect(fetchConsumerBrandBySlug("brand")).rejects.toThrow("transport-down");
});

test("issue #2582 tester adversarial: warm purchase source cannot bypass canonical pending/error ownership", () => {
  const screenSource = require("fs").readFileSync(
    require("path").join(process.cwd(), "src/screens/Event/ConsumerEventDetailScreen.tsx"),
    "utf8",
  ) as string;
  expect(screenSource).toContain("if (validatedDayCanonical === null || canonicalQuery.isError) return;");
  expect(screenSource).toContain("purchaseReady={canonicalLifecycleReady}");
  expect(screenSource).toContain("submitting={checkoutInFlight || !canonicalLifecycleReady}");
});
