/**
 * #4490 fix round 4 — the rules behind the fixes: the desktop flyer column
 * stays above the privacy strip (N116), the manage page says the time in the
 * venue's zone (N119), tables come right after Overview when they lead (N117),
 * the reserve sheet keeps one height and a Close (N118), and the Calendar week
 * stays readable (N115, N120).
 */
import { readFileSync } from "fs";
import path from "path";

import { flyerColumnStickyTop, flyerMaxHeight } from "../../../../../packages/offering-rendering/flyerColumnStickyTop";
import { deriveVenuePage, type PublicVenueFeaturesView } from "@mingla/brand-rendering/venueFeaturePage";
import { guestManageWhen } from "../../../utils/guestReservationManage";

const src = (relative: string): string => readFileSync(path.join(__dirname, "../../../..", relative), "utf8");

describe("N116 — the flyer column ends above the privacy strip", () => {
  test("a column that fits keeps 96; a taller one sticks higher so its foot stays in view", () => {
    expect(flyerColumnStickyTop(0, 0)).toBe(96);
    expect(flyerColumnStickyTop(824, 600)).toBe(96);
    // 824 scroll height (852 window minus the 28 strip), 770 tall column: foot gap 16.
    expect(flyerColumnStickyTop(824, 770)).toBe(38);
    expect(flyerColumnStickyTop(824, 770) + 770 + 16).toBeLessThanOrEqual(824);
  });
  test("at the top of a short window the flyer is cropped by the shortfall so the bar is in view at once", () => {
    // 420 wide flyer = 525 natural; column = 525 + 140 (gallery, actions, bar) = 665; top padding 84.
    const base = { flyerWidth: 420, flyerHeight: 525, columnHeight: 665 };
    expect(flyerMaxHeight({ ...base, scrollHeight: 824 })).toBeNull(); // 84 + 665 + 16 = 765 fits
    expect(flyerMaxHeight({ ...base, scrollHeight: 700 })).toBe(525 - (84 + 665 + 16 - 700)); // 460
    expect(flyerMaxHeight({ ...base, scrollHeight: 300 })).toBe(240); // never smaller than the floor
    // already cropped: the answer does not move (no feedback loop)
    expect(flyerMaxHeight({ flyerWidth: 420, flyerHeight: 460, columnHeight: 600, scrollHeight: 700 })).toBe(460);
    expect(flyerMaxHeight({ ...base, scrollHeight: 0 })).toBeNull();
  });
  test("the shell measures its own scroll area and column, not a hard-coded strip height", () => {
    const shell = src("../packages/offering-rendering/ParallaxCoverShell.tsx");
    expect(shell).toContain("flyerColumnStickyTop(deskScrollHeight, deskColHeight)");
    expect(shell).toContain("top: flyerStickyTop,");
    expect(shell).toContain("flyerCap !== null ? { maxHeight: flyerCap } : null");
  });
});

describe("N119 — the manage page's time", () => {
  test("a 19:00 Lagos booking reads 'Fri 20 Nov · 19:00' in the venue zone, whatever the device", () => {
    expect(guestManageWhen("2026-11-20T18:00:00.000Z", "Africa/Lagos")).toBe("Fri 20 Nov · 19:00");
    expect(guestManageWhen("2026-11-20T18:00:00.000Z", "Europe/London")).toBe("Fri 20 Nov · 18:00");
    expect(guestManageWhen("2026-11-20T23:30:00.000Z", "Africa/Lagos")).toBe("Sat 21 Nov · 00:30");
  });
  test("a bad time is empty and a bad or missing zone falls back without throwing", () => {
    expect(guestManageWhen("nope", "Africa/Lagos")).toBe("");
    expect(guestManageWhen("2026-11-20T18:00:00.000Z", "Not/AZone")).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2}$/);
    expect(guestManageWhen("2026-11-20T18:00:00.000Z", null)).toMatch(/ · \d{2}:\d{2}$/);
  });
  test("the page uses it, sets its tab title, and the button says what the page does", () => {
    const page = src("app/reserve/[brandId]/manage.tsx");
    expect(page).toContain("guestManageWhen(reservation.reservedForUtc, reservation.timezone)");
    expect(page).toContain("Your reservation · Mingla");
    expect(page).not.toContain("Intl.DateTimeFormat(undefined");
    const confirmation = src("src/components/venue/GuestVenueReservation.tsx");
    expect(confirmation).toContain(">Manage booking</Text>");
    expect(confirmation).not.toContain("Change or cancel");
  });
  test("the answer carries the venue's zone", () => {
    const view = readFileSync(path.join(__dirname, "../../../../../supabase/functions/_shared/guestReservationManageView.ts"), "utf8");
    expect(view).toContain('issue_4490_venue_timezone');
    expect(view).toContain("timezone,");
  });
});

describe("N117 — tables come right after Overview when they lead", () => {
  const view = {
    features: ["entry", "table_reservations", "private_hire"],
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
  test("a bar: Overview, Tables, then the rest", () => {
    const bar = deriveVenuePage(view, { menuTabVisible: true, tablesGate: "ready", tablesFirst: true });
    expect(bar.lead?.kind).toBe("tables");
    expect(bar.tabs[0]).toBe("overview");
    expect(bar.tabs[1]).toBe("reservations");
    expect(bar.labels.reservations).toBe("Tables");
  });
  test("a club keeps Entry first and Tables where it was", () => {
    const club = deriveVenuePage(view, { menuTabVisible: true, tablesGate: "ready", tablesFirst: false });
    expect(club.lead?.kind).toBe("entry");
    expect(club.tabs.indexOf("reservations")).toBeGreaterThan(club.tabs.indexOf("entry"));
  });
});

describe("N118 — the reserve sheet", () => {
  test("it carries the kit's sheet head with a Close, so the form and its confirmation both have one", () => {
    const sheet = src("src/components/venue/PublicVenueReservationSheet.tsx");
    expect(sheet).toContain("<PickerSheetHead title={title} onClose={onClose}");
  });
  test("the price area keeps one height while loading, the switch has a name", () => {
    const form = src("src/components/venue/GuestVenueReservation.tsx");
    expect(form).toContain("styles.priceArea");
    expect(form).toContain("priceAreaLoading");
    expect(form).toContain('accessibilityLabel="Send me occasional Mingla updates"');
  });
});

describe("N115 / N120 — the Calendar week", () => {
  const calendar = src("src/components/venue/features/calendar/VenueCalendarModule.tsx");
  test("a cell shows two lines and carries its full text as the label and the hover title", () => {
    expect(calendar).not.toMatch(/numberOfLines=\{compact \? 1 : 2\}/);
    expect(calendar).toContain("{...hoverTitle(block.label)}");
    expect(calendar).toContain('setAttribute("title", label)');
  });
  test("the week opens by itself only when all seven days fit beside the sidebars", () => {
    expect(calendar).toContain("export const WEEK_DEFAULT_MIN_WIDTH = 1280;");
    expect(calendar).toContain("isWideDesktop && width >= WEEK_DEFAULT_MIN_WIDTH");
  });
});

describe("the six earlier red suites", () => {
  test("the booking 'tell your group' share is classified for the #1615 gate", () => {
    const visit = src("src/components/venue/offers/VisitBooking.tsx");
    expect(visit).toMatch(/\/\/ SHARE-NON-CONTENT:receipt\n\s*await Share\.share\(\{ message \}\);/);
  });
});
