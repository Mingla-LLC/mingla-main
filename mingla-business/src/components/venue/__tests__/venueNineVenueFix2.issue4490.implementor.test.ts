/**
 * #4490 fix round 2 (nine-venue click test) — pure rules behind the fixes:
 * events at a venue (N84/N76: Where opens on the venue, the intent from "Add
 * an event here", the venue's time zone, events on the Calendar), timed entry
 * (N85 guest time chips, N82 host session preview and day total), the Entry
 * price list (N77 "Free – ₦x", ID and booking limit, N58 default names), the
 * checkout address carrying the session, the bar/restaurant lead (N90), menu
 * money and ordering words (N91), the room pass wording (N87) and the stay
 * header (N74 rule lives in the route; not here).
 */
import {
  entryDayTiles,
  entrySessionsFor,
  passWindowLine,
  pickEntrySession,
  type EntryBooking,
  type EntryDayRow,
} from "../../../../../packages/brand-rendering/venueOffers/entryModel";
import { deriveVenuePage, venueTypeLeadsWithTables, type PublicVenueFeaturesView } from "../../../../../packages/brand-rendering/venueFeaturePage";
import { formatMenuPrice } from "../../../../../packages/brand-rendering/PublicMenuSections";
import {
  VENUE_ORDER_COUNTER_TITLE,
  venueOrderingBarCopy,
} from "../../../../../packages/brand-rendering/venueOrdering/VenueOrderingStickyBar";
import { blocksFor, calendarRows, daySummary } from "../features/calendar/calendarModel";
import { mapVenueCalendar } from "../../../services/venueOffersService";
import {
  emptyOptionDraft,
  optionIssues,
  optionNameOrDefault,
  optionPayload,
  optionSummary,
  priceColumn,
  schedulePayload,
  timedDayTotal,
  timedSessionPreview,
  timedSessionStarts,
  type EntryDraft,
} from "../features/offers/offersModel";
import { entryCheckoutPath, parseEntryCheckoutParams } from "../offers/entryCheckoutPath";
import { initialWhereMode } from "../features/eventWhereModel";
import {
  clearEventVenueIntent,
  isVenueIdParam,
  readEventVenueIntent,
  setEventVenueIntent,
} from "../../../utils/eventVenueIntent";
import { venueTimezone } from "../../../utils/eventVenueTimezone";
import { hireReviewItems, hireDraftFrom } from "../features/offers/hireModel";
import { hourPlacesTitle } from "../features/members/membersModel";
import type { VenueOffer, VenuePriceOption } from "../../../types/venueOffers";

const VENUE = "44900000-0000-4000-8000-0000000000d1";
const BRAND = "44900000-0000-4000-8000-0000000000c2";

// ── N84 / N76 — Where at a venue ─────────────────────────────────────────────
describe("N84 — Where opens on the venue when it should", () => {
  test("no venues: the free-text fields, as before", () => {
    expect(initialWhereMode({ hasVenues: false, linkedVenueId: null, intentVenueId: null, hasOtherAddress: false })).toBe("other");
  });
  test("a linked event or one started from a venue opens on the venue", () => {
    expect(initialWhereMode({ hasVenues: true, linkedVenueId: VENUE, intentVenueId: null, hasOtherAddress: true })).toBe("venue");
    expect(initialWhereMode({ hasVenues: true, linkedVenueId: null, intentVenueId: VENUE, hasOtherAddress: false })).toBe("venue");
  });
  test("a draft that already has a typed address keeps it; a fresh one starts at the venues", () => {
    expect(initialWhereMode({ hasVenues: true, linkedVenueId: null, intentVenueId: null, hasOtherAddress: true })).toBe("other");
    expect(initialWhereMode({ hasVenues: true, linkedVenueId: null, intentVenueId: null, hasOtherAddress: false })).toBe("venue");
  });
});

describe("N76 — Add an event here carries the venue to Where", () => {
  afterEach(() => clearEventVenueIntent());
  test("the intent is kept for its brand and kind only, and cleared on demand", () => {
    expect(isVenueIdParam(VENUE)).toBe(true);
    expect(isVenueIdParam("not-a-venue")).toBe(false);
    setEventVenueIntent({ brandId: BRAND, venueId: VENUE, noun: "event" });
    expect(readEventVenueIntent(BRAND, "event")).toEqual({ brandId: BRAND, venueId: VENUE, noun: "event" });
    expect(readEventVenueIntent(BRAND, "experience")).toBeNull();
    expect(readEventVenueIntent("another-brand", "event")).toBeNull();
    clearEventVenueIntent();
    expect(readEventVenueIntent(BRAND, "event")).toBeNull();
  });
});

describe("N84 d — the event's time zone follows the venue, never New York by accident", () => {
  test("a Nigerian venue runs in Lagos; an unknown country keeps the draft's zone", () => {
    expect(venueTimezone("NG", "America/New_York")).toBe("Africa/Lagos");
    expect(venueTimezone(null, "Europe/London")).toBe("Europe/London");
  });
});

describe("N76 c — events on the venue Calendar", () => {
  const cal = mapVenueCalendar({
    timezone: "Africa/Lagos",
    from: "2026-12-05",
    to: "2026-12-05",
    spaces: [
      { id: "main", name: "Main floor", capacity: 600 },
      { id: "lounge", name: "The Lounge Side", capacity: 200 },
    ],
    combinations: [],
    claims: [],
    combinationBlocks: [],
    requests: [],
    days: [],
    events: [
      { eventId: "e1", title: "Games Night", spaceId: "main", spaceUse: "shared", status: "scheduled", startsAt: "2026-12-05T18:00:00Z", endsAt: "2026-12-05T22:00:00Z" },
      // the same date twice (a duplicated date row) shows once
      { eventId: "e1", title: "Games Night", spaceId: "main", spaceUse: "shared", status: "scheduled", startsAt: "2026-12-05T18:00:00Z", endsAt: "2026-12-05T22:00:00Z" },
      { eventId: "e2", title: "Open day", spaceId: null, spaceUse: "shared", status: "scheduled", startsAt: "2026-12-05T09:00:00Z", endsAt: "2026-12-05T12:00:00Z" },
    ],
  });
  const rows = calendarRows(cal);
  test("a shared-space event sits on its space; a whole-venue event on every space", () => {
    const main = blocksFor(cal, rows[0], "2026-12-05");
    expect(main.map((b) => `${b.tone}:${b.title}`)).toEqual(["event:Open day", "event:Games Night"]);
    expect(main[0].detail).toBe("10:00–13:00 · Whole venue");
    const lounge = blocksFor(cal, rows[1], "2026-12-05");
    expect(lounge.map((b) => b.title)).toEqual(["Open day"]);
  });
  test("the day counts each event once", () => {
    expect(daySummary(cal, "2026-12-05").events).toBe(2);
  });
});

// ── N85 — guest time chips ───────────────────────────────────────────────────
const row = (time: string, status: EntryDayRow["status"], remaining: number, date = "2026-11-19"): EntryDayRow => ({
  localDate: date,
  startsAt: `${date}T${time}:00+01:00`,
  endsAt: `${date}T${time.slice(0, 2)}:59:00+01:00`,
  windowId: `w-${date}-${time}`,
  status,
  reason: null,
  remaining,
  priceMinor: null,
});

describe("N85 — a timed day reads by its sessions", () => {
  const today = [row("10:00", "too_soon", 0), row("10:30", "too_soon", 0), row("13:30", "available", 25), row("14:00", "available", 4)];
  test("today is open while a session remains (never 'Too late')", () => {
    const [tile] = entryDayTiles(today, "2026-11-19", 1);
    expect(tile.state).toBe("open");
    expect(tile.bottom).toBe("");
    expect(tile.row?.windowId).toBe("w-2026-11-19-13:30");
  });
  test("each session is a chip with places left; started ones are Past and off", () => {
    const chips = entrySessionsFor(today, "2026-11-19", "Africa/Lagos");
    expect(chips.map((c) => `${c.label} ${c.note} ${c.usable}`)).toEqual([
      "10:00 Past false",
      "10:30 Past false",
      "13:30 25 left true",
      "14:00 Few left · 4 true",
    ]);
  });
  test("the quoted session is the picked one when usable, else the first usable", () => {
    const chips = entrySessionsFor(today, "2026-11-19", "Africa/Lagos");
    expect(pickEntrySession(chips, "w-2026-11-19-14:00")?.label).toBe("14:00");
    expect(pickEntrySession(chips, "w-2026-11-19-10:00")?.label).toBe("13:30");
    expect(pickEntrySession(chips, null)?.label).toBe("13:30");
  });
  test("a day whose sessions have all passed still says Too late", () => {
    const [tile] = entryDayTiles([row("10:00", "too_soon", 0)], "2026-11-19", 1);
    expect(tile.state).toBe("too_soon");
  });
  test("the checkout address carries the session and reads it back", () => {
    const windowId = "0f9a2c1e-1b2c-4d3e-8f90-123456789abc";
    const path = entryCheckoutPath({ brandSlug: "b", venueSlug: "v", offerId: "0f9a2c1e-1b2c-4d3e-8f90-123456789abd", date: "2026-11-20", counts: {}, windowId });
    expect(path).toContain(`t=${windowId}`);
    expect(parseEntryCheckoutParams({ date: "2026-11-20", t: windowId }).windowId).toBe(windowId);
    expect(parseEntryCheckoutParams({ date: "2026-11-20", t: "junk" }).windowId).toBeNull();
  });
});

// ── N82 / N70 — the host's timed editor ─────────────────────────────────────
const timed = (over: Partial<EntryDraft> = {}): EntryDraft => ({
  name: "Play session",
  summary: "",
  style: "timed_session",
  sessionCapacity: 25,
  options: [],
  dailyLimit: 0,
  keptForWalkIns: 0,
  scheduleWeekdays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "10:00",
  endTime: "18:00",
  sessionMinutes: 30,
  sessionEveryMinutes: 30,
  endDate: "",
  refundPreset: "none",
  customLadder: [],
  dateChange: false,
  dateChangeCutoffMinutes: 120,
  ...over,
});

describe("N82 — sessions explained in one line, capacity asked once", () => {
  test("10:00–18:00 every 30 minutes: 16 sessions, the preview line and the day total", () => {
    expect(timedSessionStarts(timed())).toHaveLength(16);
    expect(timedSessionPreview(timed())).toBe("10:00, 10:30 … 17:30 · 16 sessions · 25 each");
    expect(timedDayTotal(timed())).toBe(400);
  });
  test("one-hour sessions starting every 30 minutes stop when the last one would run past close", () => {
    expect(timedSessionStarts(timed({ sessionMinutes: 60 })).slice(-1)[0]).toBe("17:00");
  });
  test("no session fits: no preview", () => {
    expect(timedSessionPreview(timed({ startTime: "10:00", endTime: "10:15" }))).toBeNull();
  });
  test("Runs until goes to the server as the schedule's end date", () => {
    expect(schedulePayload(timed({ endDate: "2026-12-31" })).endDate).toBe("2026-12-31");
    expect(schedulePayload(timed()).endDate).toBeUndefined();
  });
});

// ── N77 / N58 — the Entry price list ────────────────────────────────────────
const option = (over: Partial<VenuePriceOption>): VenuePriceOption =>
  ({
    id: "o1",
    version: 1,
    name: "Adult",
    unit: "guest",
    guestMin: 1,
    guestMax: 6,
    priceMinor: 400000,
    weekdays: [],
    startTime: null,
    endTime: null,
    eligibility: null,
    busyRules: [],
    sortOrder: 0,
    ...over,
  }) as VenuePriceOption;

describe("N77 — what the offers list says about each price", () => {
  test("a free price beside paid ones reads Free – the paid price, never from ₦0", () => {
    const offer = { kind: "entry", options: [option({ priceMinor: 0, name: "Child" }), option({ id: "o2", priceMinor: 400000 })] } as unknown as VenueOffer;
    expect(priceColumn(offer, "NGN")).toBe("Free – ₦4,000 per guest");
  });
  test("each price names its ID check, its hours and its booking limit", () => {
    const line = optionSummary(option({ eligibility: { label: "Age 21+", checkAtGate: true } as never, startTime: "18:00", endTime: "23:00" }), "NGN");
    expect(line).toContain("Age 21+ checked at the gate");
    expect(line).toContain("18:00–23:00");
    expect(line).toContain("up to 6 on one booking");
  });
});

describe("N58 — no forced price name", () => {
  test("a blank name is not an error and saves as Entry, then Guest", () => {
    const blank = emptyOptionDraft();
    expect(optionIssues(blank, null).name).toBeNull();
    expect(optionNameOrDefault("", 0)).toBe("Entry");
    expect(optionNameOrDefault("  ", 1)).toBe("Guest");
    expect(optionNameOrDefault("", 2)).toBe("Guest 2");
    expect(optionPayload({ ...blank, priceMinor: 100000 }, 0).name).toBe("Entry");
  });
});

// ── N83 — words that follow the venue ───────────────────────────────────────
describe("N83 — by-the-hour places and hire defaults", () => {
  test("the plans card names rooms by the venue's type", () => {
    expect(hourPlacesTitle("coworking")).toBe("Meeting rooms");
    expect(hourPlacesTitle("creative_and_arts")).toBe("Studios and rooms");
    expect(hourPlacesTitle("bar_lounge")).toBe("Rooms by the hour");
  });
  test("the hire review says setup and cleanup are starting values the host can change", () => {
    const draft = hireDraftFrom(null);
    const items = hireReviewItems(draft, [], "NGN");
    expect(items.find((i) => i.key === "buffers")?.value).toMatch(/our starting times, change them on Times$/);
  });
});

// ── N90 / N91 / N87 — guest page words ──────────────────────────────────────
describe("N90 — a bar leads with its tables", () => {
  const view = {
    features: ["entry", "table_reservations"],
    offers: [{ id: "e", kind: "entry", entryStyle: "walk_in", name: "Friday deal", summary: null, fromMinor: 3000000, unit: "guest", guestMin: 1, guestMax: 4, confirmationMode: "instant", spaceIds: null, sortOrder: 0 }],
    tables: { partyMax: 8, pickATable: false, holdFromMinor: null, minSpendFromMinor: null, largePartyRequest: true, guestWaitlist: false, notifyMe: false },
    memberships: null,
    guestList: null,
    events: { upcoming: [] },
    hours: { weekly: [], specialDays: [] },
    spaces: [],
    currencyCode: "NGN",
    minorUnitExponent: 2,
  } as unknown as PublicVenueFeaturesView;
  test("bar and restaurant types lead with tables; a club keeps Entry", () => {
    expect(venueTypeLeadsWithTables("bar_lounge")).toBe(true);
    expect(venueTypeLeadsWithTables("restaurant")).toBe(true);
    expect(venueTypeLeadsWithTables("club")).toBe(false);
    const bar = deriveVenuePage(view, { menuTabVisible: false, tablesGate: "ready", tablesFirst: true });
    expect(bar.lead?.kind).toBe("tables");
    const club = deriveVenuePage(view, { menuTabVisible: false, tablesGate: "ready", tablesFirst: false });
    expect(club.lead?.kind).toBe("entry");
  });
});

describe("N91 — menu money and ordering words", () => {
  test("menu prices use the symbol; whole naira drop .00, other currencies keep two places", () => {
    expect(formatMenuPrice(1000000, "NGN")).toMatch(/^₦10,000$/);
    expect(formatMenuPrice(1250, "GBP")).toMatch(/^£12\.50$/);
    expect(formatMenuPrice(2000, "GBP")).toMatch(/^£20\.00$/);
  });
  test("with no table, the bar says what the chip says", () => {
    expect(venueOrderingBarCopy({ count: 0, totalCents: null, currency: null }).title).toBe(VENUE_ORDER_COUNTER_TITLE);
    expect(venueOrderingBarCopy({ count: 0, totalCents: null, currency: null, spotLabel: "T4" }).title).toBe("Order from your table");
  });
});

describe("N87 — a room pass is shown at the front desk", () => {
  const booking = {
    window: { localDate: "2026-11-20", startsAt: "2026-11-20T14:00:00Z", endsAt: "2026-11-20T16:00:00Z" },
    venue: { timezone: "Africa/Lagos" },
  } as unknown as EntryBooking;
  test("entry keeps the gate; a by-the-hour pass says the front desk", () => {
    expect(passWindowLine(booking)).toBe("Show this at the gate, any time from 15:00 to 17:00.");
    expect(passWindowLine(booking, "front_desk")).toBe("Show this at the front desk, any time from 15:00 to 17:00.");
  });
});
