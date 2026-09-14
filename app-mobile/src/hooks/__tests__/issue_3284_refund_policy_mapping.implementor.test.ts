// issue #3284 [refund terms on events and experiences] — implementor happy-path
// regression for the CONSUMER mappers (spec part 2 §C5 / §C8 "consumer mappers").
//
// The consumer app has no typecheck gate, so a mapper that silently dropped the
// new key would ship. This file pins, on the real mapper code:
//   M-1..M-4  the event bundle mapper: refundPolicy ABSENT → unknown, null → none,
//             a valid policy → set, an unreadable one → unknown;
//   M-5       the same through the hook's own query function;
//   M-6..M-8  the by-slug experience detail: the same three states, plus the
//             ended/cancelled closed flag;
//   M-9..M-12 the experience offering adapters: the detail path carries the
//             state and the flag; the DECK-CARD SEED has no policy and maps to
//             unknown unless the screen hands it the fresh read;
//   M-13      both consumer screens actually pass the state into the shared body
//             (source-level, because no test here can mount the native screens).
//
// FAILS-ON-REVERT: restore usePublicEventBySlug.ts, useConsumerExperienceDetail.ts,
// useConsumerExperienceOfferingData.ts or either screen from origin/main and the
// matching cases fail.

import { readFileSync } from "fs";
import { join } from "path";

let mockQueryOptions: Record<string, unknown>;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
}));
// A partial barrel factory, exactly like the #1929 / #2230 suites. The refund
// reader is NOT listed here on purpose: the mappers reach it by its deep
// specifier, so this factory cannot blank it. The helpers that ARE listed
// delegate to their real pure modules.
jest.mock("@mingla/offering-rendering", () => ({
  forwardableAcquisitionState: (
    jest.requireActual("@mingla/offering-rendering/eventAcquisitionLifecycle") as {
      forwardableAcquisitionState: (...a: unknown[]) => unknown;
    }
  ).forwardableAcquisitionState,
  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
  isOpenDailyExperience: (
    jest.requireActual("@mingla/offering-rendering/experienceOpenDaily") as {
      isOpenDailyExperience: (...a: unknown[]) => boolean;
    }
  ).isOpenDailyExperience,
  normalizeCityCountry: (
    jest.requireActual("@mingla/offering-rendering/normalizeCityCountry") as {
      normalizeCityCountry: (...a: unknown[]) => string | null;
    }
  ).normalizeCityCountry,
}));
jest.mock("../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import {
  mapRpcPayloadToPublicEvent,
  usePublicEventBySlug,
} from "../usePublicEventBySlug";
import {
  useConsumerExperienceDetail,
  type ConsumerExperienceDetail,
} from "../useConsumerExperienceDetail";
import {
  buildExperienceOfferingDataFromDetail,
  buildExperienceOfferingDataFromSeed,
} from "../useConsumerExperienceOfferingData";
import { supabase } from "../../services/supabase";

const mockRpc = supabase.rpc as jest.Mock;

const STANDARD = {
  kind: "standard",
  tiers: [
    { days_before_start: 14, refund_pct: 100 },
    { days_before_start: 7, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const UNREADABLE = {
  kind: "custom",
  tiers: [
    { days_before_start: 2, refund_pct: 50 },
    { days_before_start: 7, refund_pct: 100 },
  ],
};

const eventBundle = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-3284",
  brandId: "brand-1",
  brandSlug: "sunset",
  eventSlug: "rooftop",
  name: "Rooftop Sessions",
  status: "scheduled",
  timezone: "Europe/London",
  currency: "GBP",
  tickets: [],
  occurrences: [
    {
      id: "occ-1",
      startAt: "2099-10-03T19:00:00Z",
      endAt: "2099-10-03T23:00:00Z",
      timezone: "Europe/London",
      isMaster: true,
    },
  ],
  brand: { id: "brand-1", slug: "sunset", name: "Sunset Collective" },
  ...overrides,
});

const experiencePayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "exp-3284",
  brandId: "brand-2",
  brandSlug: "lagos-food-walks",
  experienceSlug: "island-walk",
  title: "Island Walk",
  description: null,
  status: "scheduled",
  timezone: "Africa/Lagos",
  currency: "NGN",
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaAlt: null,
  venueText: "Lagos, Nigeria",
  isRecurring: false,
  isMultiDate: false,
  recurrenceRules: null,
  intents: [],
  themeColorOverride: null,
  themeFontOverride: null,
  themeAnimationOverride: null,
  brand: {
    id: "brand-2",
    slug: "lagos-food-walks",
    name: "Lagos Food Walks",
    coverMediaUrl: null,
    coverMediaType: null,
    coverHue: null,
    verified: false,
    themeColor: null,
    themeFont: null,
    themeAnimation: null,
  },
  stops: [],
  ticket: null,
  dates: [],
  bookable: true,
  ...overrides,
});

const withoutKey = (payload: Record<string, unknown>): Record<string, unknown> => {
  const copy = { ...payload };
  delete copy.refundPolicy;
  return copy;
};

const readDetail = async (payload: Record<string, unknown>): Promise<ConsumerExperienceDetail> => {
  mockRpc.mockResolvedValue({ data: payload, error: null });
  useConsumerExperienceDetail("lagos-food-walks", "island-walk");
  return (mockQueryOptions.queryFn as () => Promise<ConsumerExperienceDetail>)();
};

const SEED = {
  eventId: "exp-3284",
  brandId: "brand-2",
  brandSlug: "lagos-food-walks",
  brandName: "Lagos Food Walks",
  brandProfilePhotoUrl: null,
  title: "Island Walk",
  description: null,
  currency: "NGN",
  timezone: "Africa/Lagos",
  coverMediaUrl: null,
  coverMediaType: null,
  city: "Lagos, Nigeria",
  venueName: null,
  address: null,
  experienceStops: [],
  experienceIntents: [],
  isRecurring: false,
  recurrenceRule: null,
} as never;

const SEED_EXTRAS = { ticket: null, occurrences: [], bookable: true };

beforeEach(() => {
  mockRpc.mockReset();
});

describe("#3284 consumer event bundle mapper", () => {
  test("M-1 an ABSENT refundPolicy key maps to unknown — never 'no policy'", () => {
    const result = mapRpcPayloadToPublicEvent(withoutKey(eventBundle()));
    expect(result.refundPolicyState).toEqual({ status: "unknown" });
  });

  test("M-2 a null refundPolicy maps to none", () => {
    const result = mapRpcPayloadToPublicEvent(eventBundle({ refundPolicy: null }));
    expect(result.refundPolicyState).toEqual({ status: "none" });
  });

  test("M-3 a valid refundPolicy maps to set with the policy", () => {
    const result = mapRpcPayloadToPublicEvent(eventBundle({ refundPolicy: STANDARD }));
    expect(result.refundPolicyState).toEqual({ status: "set", policy: STANDARD });
  });

  test("M-4 an unreadable refundPolicy maps to unknown", () => {
    const result = mapRpcPayloadToPublicEvent(eventBundle({ refundPolicy: UNREADABLE }));
    expect(result.refundPolicyState).toEqual({ status: "unknown" });
  });

  test("M-5 the hook's query function carries the state from the bundle RPC", async () => {
    mockRpc.mockResolvedValue({ data: eventBundle({ refundPolicy: STANDARD }), error: null });
    usePublicEventBySlug("sunset", "rooftop");
    const result = (await (mockQueryOptions.queryFn as () => Promise<unknown>)()) as {
      refundPolicyState: unknown;
    };
    expect(mockRpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle", {
      p_event_id: null,
      p_brand_slug: "sunset",
      p_event_slug: "rooftop",
    });
    expect(result.refundPolicyState).toEqual({ status: "set", policy: STANDARD });
  });
});

describe("#3284 consumer experience detail mapper", () => {
  test("M-6 absent → unknown, null → none, valid → set, unreadable → unknown", async () => {
    expect((await readDetail(experiencePayload())).refundPolicyState).toEqual({ status: "unknown" });
    expect((await readDetail(experiencePayload({ refundPolicy: null }))).refundPolicyState).toEqual({
      status: "none",
    });
    expect((await readDetail(experiencePayload({ refundPolicy: STANDARD }))).refundPolicyState).toEqual({
      status: "set",
      policy: STANDARD,
    });
    expect(
      (await readDetail(experiencePayload({ refundPolicy: UNREADABLE }))).refundPolicyState,
    ).toEqual({ status: "unknown" });
  });

  test.each([
    ["scheduled", false],
    ["live", false],
    ["ended", true],
    ["cancelled", true],
  ])("M-7 status %s → offeringClosed %s", async (status, closed) => {
    expect((await readDetail(experiencePayload({ status }))).offeringClosed).toBe(closed);
  });

  test("M-8 the detail read goes through the canonical experience RPC", async () => {
    await readDetail(experiencePayload({ refundPolicy: null }));
    expect(mockRpc).toHaveBeenCalledWith("pg_public_experience_by_slug", {
      p_brand_slug: "lagos-food-walks",
      p_experience_slug: "island-walk",
    });
  });
});

describe("#3284 consumer experience offering adapters", () => {
  test("M-9 the detail adapter carries the state and the closed flag", async () => {
    const detail = await readDetail(
      experiencePayload({ refundPolicy: STANDARD, status: "ended" }),
    );
    const data = buildExperienceOfferingDataFromDetail(detail);
    expect(data.refundPolicyState).toEqual({ status: "set", policy: STANDARD });
    expect(data.offeringClosed).toBe(true);
  });

  test("M-10 a detail object built before the field existed maps to unknown", async () => {
    const detail = await readDetail(experiencePayload({ refundPolicy: null }));
    const legacy = { ...detail } as Partial<ConsumerExperienceDetail>;
    delete legacy.refundPolicyState;
    delete legacy.offeringClosed;
    const data = buildExperienceOfferingDataFromDetail(legacy as ConsumerExperienceDetail);
    expect(data.refundPolicyState).toEqual({ status: "unknown" });
    expect(data.offeringClosed).toBe(false);
  });

  test("M-11 the deck-card SEED has no policy: it maps to unknown and not closed", () => {
    const data = buildExperienceOfferingDataFromSeed(SEED, SEED_EXTRAS);
    expect(data.refundPolicyState).toEqual({ status: "unknown" });
    expect(data.offeringClosed).toBe(false);
  });

  test("M-12 the seed adapter uses the fresh read the screen hands it", () => {
    const data = buildExperienceOfferingDataFromSeed(SEED, {
      ...SEED_EXTRAS,
      refundPolicyState: { status: "none" },
      offeringClosed: true,
    });
    expect(data.refundPolicyState).toEqual({ status: "none" });
    expect(data.offeringClosed).toBe(true);
  });
});

describe("#3284 consumer screens pass the state into the shared bodies", () => {
  const read = (rel: string): string =>
    readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  test("M-13 the event screen reads the validated bundle's state; the experience screen reads the fresh detail", () => {
    const eventScreen = read("screens/Event/ConsumerEventDetailScreen.tsx");
    expect(eventScreen).toMatch(
      /refundPolicyState=\{\s*validatedDayCanonical\?\.refundPolicyState \?\?\s*UNKNOWN_REFUND_POLICY_STATE\s*\}/,
    );
    expect(eventScreen).toMatch(/refundHostName=\{seed\.brandName\}/);

    const experienceScreen = read("screens/Experience/ConsumerExperienceDetailScreen.tsx");
    expect(experienceScreen).toMatch(/refundPolicyState: freshDetail\?\.refundPolicyState,/);
    expect(experienceScreen).toMatch(/offeringClosed: freshDetail\?\.offeringClosed,/);
  });
});
