/** #2230 implementor happy-path: real mapper + load-bearing screen wiring. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock("@mingla/offering-rendering", () => ({
  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
}));

import { mapRpcPayloadToPublicEvent } from "../../../hooks/usePublicEventBySlug";

const SCREEN = readFileSync(
  join(__dirname, "..", "ConsumerEventDetailScreen.tsx"),
  "utf8",
);
const HOOK = readFileSync(
  join(__dirname, "..", "..", "..", "hooks", "usePublicEventBySlug.ts"),
  "utf8",
);

const payload = (mode: unknown = "per_day"): Record<string, unknown> => ({
  id: "event-2230",
  brandId: "brand-1",
  brandSlug: "mingla",
  eventSlug: "two-days",
  name: "Two days",
  status: "scheduled",
  tickets: [],
  brand: null,
  timezone: "Africa/Lagos",
  isMultiDate: true,
  multiDatePricingMode: mode,
  occurrences: [
    {
      id: "day-2",
      startAt: "2026-08-23T10:00:00.000Z",
      endAt: "2026-08-23T17:00:00.000Z",
      timezone: "Not/AZone",
      isMaster: false,
    },
    {
      id: "day-1",
      startAt: "2026-08-22T10:00:00.000Z",
      endAt: "2026-08-22T17:00:00.000Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
    {
      id: "day-1",
      startAt: "2026-08-21T10:00:00.000Z",
      endAt: "2026-08-21T17:00:00.000Z",
      timezone: "UTC",
      isMaster: false,
    },
    { id: "bad-end", startAt: "2026-08-24T10:00:00.000Z", endAt: "nope" },
    {
      id: "",
      startAt: "2026-08-25T10:00:00.000Z",
      endAt: "2026-08-25T11:00:00.000Z",
    },
  ],
});

describe("#2230 mapper occurrence truth", () => {
  it("sorts chronologically, deduplicates ids, drops malformed instants, and repairs timezone only from the event fallback", () => {
    const mapped = mapRpcPayloadToPublicEvent(payload());
    expect(mapped.occurrences.map((day) => day.id)).toEqual(["day-1", "day-2"]);
    expect(mapped.occurrences[1].timezone).toBe("Africa/Lagos");
    expect(mapped.isMultiDate).toBe(true);
    expect(mapped.multiDatePricingMode).toBe("per_day");
  });

  it("coerces only the literal all_days to all_days", () => {
    expect(
      mapRpcPayloadToPublicEvent(payload("all_days")).multiDatePricingMode,
    ).toBe("all_days");
    for (const mode of [undefined, null, "weird"]) {
      expect(
        mapRpcPayloadToPublicEvent(payload(mode)).multiDatePricingMode,
      ).toBe("per_day");
    }
  });
});

describe("#2230 both route shapes hand canonical days to the sheet", () => {
  it("runs the canonical query from either seed slugs or route slugs without changing directEventColdReadPlan", () => {
    expect(SCREEN).toContain("seedProp?.brandSlug ?? brandSlug ?? null");
    expect(SCREEN).toContain("seedProp?.eventSlug ?? eventSlug ?? null");
    expect(SCREEN).toMatch(
      /directEventColdReadPlan\(\s*seedProp !== null,\s*canonicalQuery,\s*!!brandSlug && !!eventSlug,\s*\)/,
    );
    expect(HOOK).toContain(
      "const canonical = !seedPresent && canonicalQuery.data ? canonicalQuery.data : null;",
    );
  });

  it("validates event identity before warm data can supplement day truth", () => {
    expect(SCREEN).toMatch(
      /canonicalQuery\.data\.event\.id === eventId[\s\S]{0,80}\? canonicalQuery\.data\s*: null/,
    );
  });

  it("keeps the named #2242 ticket authority and passes controlled days only through TicketCartSheet", () => {
    expect(SCREEN).toContain(
      "const cartTickets = canonical?.event.tickets ?? ticketsQuery.data;",
    );
    expect(SCREEN).toContain("tickets={cartTickets}");
    expect(SCREEN).toContain("multiDaySelection={multiDaySelection}");
    expect(SCREEN).not.toMatch(/<EventDayChooser\b/);
  });

  it("selection starts empty, resets by event identity, survives sheet close, and is emitted in canonical chronology", () => {
    expect(SCREEN).toContain(
      "const [selectedEventDateIds, setSelectedEventDateIds] = useState<string[]>([]);",
    );
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*setSelectedEventDateIds\(\[\]\);[\s\S]{0,100}\}, \[eventId\]\)/,
    );
    const cancelStart = SCREEN.indexOf("const handleCartCancel");
    const cancelEnd = SCREEN.indexOf("// ORCH-1163", cancelStart);
    expect(SCREEN.slice(cancelStart, cancelEnd)).not.toContain(
      "setSelectedEventDateIds",
    );
    expect(SCREEN).toContain(
      "return validOccurrences.filter((day) => next.has(day.id)).map((day) => day.id);",
    );
  });

  it("fails malformed, missing, offline, and stale truth closed before checkout", () => {
    expect(SCREEN).toContain('status: "offline" as const');
    expect(SCREEN).toContain('status: "error" as const');
    expect(SCREEN).toContain(
      'dayTruthStale ? "stale" as const : "ready" as const',
    );
    expect(SCREEN).toContain(
      "validatedDayCanonical.isMultiDate === (validOccurrences.length > 1)",
    );
  });
});
