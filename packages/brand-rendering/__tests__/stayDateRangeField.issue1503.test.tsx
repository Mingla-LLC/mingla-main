/**
 * Issue #1503 [stay-date-pickers] — WEB-RESOLVED render proof for the shared
 * Stay date control and for the guest booking form that mounts it.
 * SPEC §10.2 (T-13, T-15, T-16, T-17) + SC-1-Web / SC-3 / SC-4 / SC-5 / SC-6 /
 * SC-11. Append-only: NEW file, modifies and deletes nothing.
 *
 * WHY THIS SUITE IS WEB-RESOLVED (`react-native` -> `react-native-web`). This is
 * the direct answer to the #1484 P1-1 lesson: the Stay desktop uncap shipped
 * VISIBLY BROKEN while 29 headless react-test-renderer suites were green,
 * because plain `react-native` never runs react-native-web's style compiler or
 * emits DOM. The whole claim of this issue is "a REAL browser date control now
 * renders on buyer web", and only a render through RNW can see that. Assertions
 * therefore read the EMITTED MARKUP — the `<input type="date">` nodes, their
 * `min` / `max` attributes and their inline style — not a selected style object.
 *
 * EVERY block carries a VACUITY GUARD. A markup query that silently matches
 * nothing is the failure mode that made #1484 pass while broken, so each block
 * asserts a positive fact (an exact node count, a known attribute value) that
 * cannot hold if the lookup matched nothing.
 *
 * #4523: the date rows open the one Mingla range calendar (rendered by the host
 * app through `renderCalendar`), so this suite now proves: no date input reaches
 * the DOM, the rows keep their labels, the calendar is bounded by the venue
 * rules, and a committed range goes through the same rules in the same order.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION):
 *   - restore the UTC seed in StayGuestBooking (`setUTCDate` +
 *     `toISOString().slice(0,10)`)          -> W-3 RED (gets 2026-08-05, wants 2026-08-04)
 *   - drop `min` / `max` from the web inputs -> W-4 RED
 *   - put a plain TextInput back in the date rows -> W-1, W-3 RED
 *   - drop the check-out clearing rule       -> W-6 RED
 *
 * Run: cd mingla-business && npx jest --config jest.issue1503.cfg.cjs --runInBand
 */

import type { PublicStayDetail } from "../stayGuest";
import { StayDateRangeField, type StayRangeCalendarArgs } from "../StayDateRangeField";
import { StayGuestBooking } from "../StayGuestBooking";
import {
  addStayDays,
  stayDateBounds,
  type StayDateRange,
} from "../stayDateRules";
import { BrandRenderingReact as React } from "../PublicVenueTabs";

// `react-dom/server` and `react-test-renderer` ship no type declarations in
// this workspace, so use the repo's typed-require idiom (same form as the
// #1484 / #1027 render suites) instead of a bare import that would add a
// TS7016 to the issue-1403 typecheck-delta gate.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: unknown) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

/** The args the host calendar received, captured by the stub renderer. */
let lastCalendarArgs: StayRangeCalendarArgs | null = null;
const renderCalendar = (args: StayRangeCalendarArgs): null => {
  lastCalendarArgs = args;
  return null;
};

/**
 * Mounts the field (inside `act`, React 19), opens the calendar from the
 * check-in row, and returns the host calendar's args. FAILS LOUDLY when the
 * row or the calendar is missing — the vacuity guard for every block below.
 */
async function openCalendar(
  value: StayDateRange,
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void,
  detail: PublicStayDetail = stayDetail(),
): Promise<{ tree: Tree; args: StayRangeCalendarArgs }> {
  lastCalendarArgs = null;
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(fieldElement(value, detail, onChange));
  });
  const tree = created as Tree;
  const row = tree.root.findAll(
    (node) => node.props.testID === "stay-date-check-in" && typeof node.props.onPress === "function",
  )[0];
  expect(row).toBeDefined();
  await TestRenderer.act(() => {
    (row.props.onPress as () => void)();
  });
  expect(lastCalendarArgs).not.toBeNull();
  return { tree, args: lastCalendarArgs as unknown as StayRangeCalendarArgs };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** 2026-08-03 18:00 in Los Angeles — and already 2026-08-04 in UTC. */
const NOW = new Date(Date.UTC(2026, 7, 4, 1, 0, 0));

const PALETTE = {
  page: "#0c0e12",
  accent: "#eb7825",
  accentText: "#0c0e12",
  primaryText: "#ffffff",
  secondaryText: "rgba(255,255,255,0.72)",
  tertiaryText: "rgba(255,255,255,0.48)",
  panel: "#14171d",
  panelStrong: "#191d24",
  panelBorder: "#2b3038",
  card: "#14171d",
  cutoutBorder: "#2b3038",
  glass: "rgba(255,255,255,0.06)",
  glassTint: "dark" as const,
  accentWash: "rgba(235,120,37,0.16)",
};
const SURFACE = { card: {}, panel: {}, cutout: {} };
const THEME = { fontFamilyValue: "System", color: "#eb7825" };

function stayDetail(
  overrides: Partial<PublicStayDetail> = {},
): PublicStayDetail {
  return {
    venueId: "venue-1503",
    brandId: "brand-1503",
    brandSlug: "smokerhythm",
    brandName: "Smoke & Rhythm",
    venueSlug: "minglastay1503proof",
    venueName: "Mingla Stay Proof",
    propertyKind: "hotel",
    // The guest's device is deliberately NOT in this zone in CI (the suite runs
    // under TZ=UTC / America/New_York / Pacific/Auckland).
    timezone: "America/Los_Angeles",
    defaultBookingMode: "instant",
    checkInTime: "15:00:00",
    checkOutTime: "11:00:00",
    bookingHorizonDays: 365,
    houseRules: null,
    offerings: [],
    ...overrides,
  } as PublicStayDetail;
}

function renderMarkup(element: unknown): string {
  return ReactDOMServer.renderToStaticMarkup(element);
}

/** Every `<input …>` tag in the emitted markup, as raw strings. */
function inputTags(html: string): string[] {
  return html.match(/<input\b[^>]*>/g) ?? [];
}

function fieldElement(
  value: StayDateRange,
  detail: PublicStayDetail,
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void = () =>
    undefined,
): unknown {
  const bounds = stayDateBounds({
    timezone: detail.timezone,
    checkInTime: detail.checkInTime,
    bookingHorizonDays: detail.bookingHorizonDays,
    maxAdvanceDays: null,
    minNoticeMinutes: 0,
    checkIn: value.checkIn,
    checkOut: value.checkOut,
    now: NOW,
  });
  return React.createElement(
    StayDateRangeField as unknown as React.FC<Record<string, unknown>>,
    { value, bounds, palette: PALETTE, onChange, renderCalendar, timeZone: detail.timezone },
  );
}

describe("#1503 W-1/W-2 · #4523: the stay dates are picked from the Mingla calendar, never a date box", () => {
  test("W-1 no date input reaches the DOM; the two rows keep their labels", () => {
    const html = renderMarkup(
      fieldElement({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, stayDetail()),
    );
    // VACUITY GUARD — the markup really rendered both rows.
    expect(html.length).toBeGreaterThan(100);
    expect(inputTags(html)).toHaveLength(0);
    expect(html).not.toContain("showPicker");
    expect(html).toContain("Check-in");
    expect(html).toContain("Check-out");
    expect(html).toContain('aria-label="Check-in date, currently August 4, 2026"');
    expect(html).toContain('aria-label="Check-out date, currently August 6, 2026"');
  });

  test("W-2 the calendar is closed until a row is pressed, then opens once", async () => {
    lastCalendarArgs = null;
    const html = renderMarkup(
      fieldElement({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, stayDetail()),
    );
    expect(html.length).toBeGreaterThan(100); // vacuity guard
    expect(lastCalendarArgs).toBeNull();
    const { tree, args } = await openCalendar({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, () => undefined);
    expect(args.value).toEqual({ start: "2026-08-04", end: "2026-08-06" });
    expect(args.timeZone).toBe("America/Los_Angeles");
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("the check-out row is inert, and announced as inert, until check-in exists", () => {
    const html = renderMarkup(
      fieldElement({ checkIn: "", checkOut: "" }, stayDetail()),
    );
    expect(html).toContain('aria-label="Check-in date, currently not set"'); // vacuity guard
    const checkOut = /<[^>]*aria-label="Check-out date, currently not set"[^>]*>/.exec(html);
    expect(checkOut).not.toBeNull();
    expect(checkOut?.[0]).toContain('aria-disabled="true"');
    expect(html).toContain("Choose a check-in date first");
  });
});

describe("#1503 W-4 · past and beyond-horizon dates are UNSELECTABLE, not rejected later", () => {
  test("W-4 (SC-3, SC-4) the calendar starts at venue-local today and a stay starts no later than the clamped horizon", async () => {
    const detail = stayDetail({ bookingHorizonDays: 30 });
    const { tree, args } = await openCalendar({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, () => undefined, detail);
    // Venue-local today in Los Angeles at 2026-08-04T01:00Z is 2026-08-03.
    expect(args.min).toBe("2026-08-03");
    expect(args.maxStart).toBe(addStayDays("2026-08-03", 30));
    // A check-out can fall up to 365 nights after the last check-in.
    expect(args.max).toBe(addStayDays(addStayDays("2026-08-03", 30), 365));
    expect(args.maxLength).toBe(365);
    // VACUITY GUARD — the horizon clamp really moved the start ceiling.
    expect(args.maxStart).not.toBe(addStayDays("2026-08-03", 365));
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});

describe("#1503 W-3 · the default range is VENUE-local (the UTC seeding defect)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("W-3 (T-16, SC-6) a Los Angeles Stay at 18:00 local seeds tomorrow, not the day after", () => {
    jest.useFakeTimers({ now: NOW });
    const html = renderMarkup(
      React.createElement(
        StayGuestBooking as unknown as React.FC<Record<string, unknown>>,
        {
          detail: stayDetail(),
          state: "ready",
          palette: PALETTE,
          surface: SURFACE,
          theme: THEME,
          onSubmit: () => undefined,
          renderStayCalendar: renderCalendar,
        },
      ),
    );
    // VACUITY GUARD — the booking form really rendered the picker rows, and no
    // date box. If the rows regressed to a TextInput there would be an input.
    expect(inputTags(html).filter((tag) => /type="date"/.test(tag))).toHaveLength(0);
    // THE FIX. Venue-local today in Los Angeles is 2026-08-03, so tomorrow is
    // the 4th. UTC has already rolled over to the 4th, so the old
    // `setUTCDate(getUTCDate() + 1)` seed produced the 5th — a form silently
    // pre-filled two days past the guest's own tomorrow.
    expect(html).toContain('aria-label="Check-in date, currently August 4, 2026"');
    expect(html).toContain('aria-label="Check-out date, currently August 5, 2026"');
    expect(html).not.toContain('aria-label="Check-in date, currently August 5, 2026"');
  });

  test("SC-6 the same instant for an America/New_York Stay seeds the NY tomorrow", () => {
    jest.useFakeTimers({ now: NOW });
    const html = renderMarkup(
      React.createElement(
        StayGuestBooking as unknown as React.FC<Record<string, unknown>>,
        {
          detail: stayDetail({ timezone: "America/New_York" }),
          state: "ready",
          palette: PALETTE,
          surface: SURFACE,
          theme: THEME,
          onSubmit: () => undefined,
          renderStayCalendar: renderCalendar,
        },
      ),
    );
    expect(html).toContain("Check-in"); // vacuity guard
    // NY is 2026-08-03 21:00 at that instant, so tomorrow is the 4th.
    expect(html).toContain('aria-label="Check-in date, currently August 4, 2026"');
  });
});

describe("#1503 W-5/W-6 · a committed range goes through the shared rules, check-in first", () => {
  test("W-5 (SC-11) committing the same range changes nothing; closing keeps the dates", async () => {
    const seen: Array<[StayDateRange, string]> = [];
    const { tree, args } = await openCalendar(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next, field) => seen.push([next, field]),
    );
    await TestRenderer.act(() => {
      args.onCommit({ start: "2026-08-04", end: "2026-08-06" });
    });
    expect(seen).toHaveLength(0);
    await TestRenderer.act(() => {
      args.onClose();
    });
    expect(seen).toHaveLength(0);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("W-6 (T-17, SC-5) a check-in at or past check-out CLEARS check-out before the new check-out lands", async () => {
    const seen: Array<[StayDateRange, string]> = [];
    const { tree, args } = await openCalendar(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next, field) => seen.push([next, field]),
    );
    await TestRenderer.act(() => {
      args.onCommit({ start: "2026-08-07", end: "2026-08-09" });
    });
    expect(seen).toEqual([
      [{ checkIn: "2026-08-07", checkOut: "" }, "check_in"],
      [{ checkIn: "2026-08-07", checkOut: "2026-08-09" }, "check_out"],
    ]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("a check-in that still precedes check-out leaves the range intact (one change)", async () => {
    const seen: StayDateRange[] = [];
    const { tree, args } = await openCalendar(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next) => seen.push(next),
    );
    await TestRenderer.act(() => {
      args.onCommit({ start: "2026-08-05", end: "2026-08-06" });
    });
    expect(seen).toEqual([{ checkIn: "2026-08-05", checkOut: "2026-08-06" }]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});
