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
import { StayDateRangeField } from "../StayDateRangeField";
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

/**
 * React 19 requires the initial mount to happen inside `act`, so `create` is
 * wrapped rather than called bare (the same shape as
 * `webDateTimeInput.adversarial.1027.test.tsx`). Returns the mounted tree and
 * its two date inputs, and FAILS LOUDLY if the lookup matched nothing — the
 * vacuity guard for every interaction block below.
 */
async function mountField(
  value: StayDateRange,
  onChange: (next: StayDateRange, field: "check_in" | "check_out") => void,
): Promise<{ tree: Tree; inputs: HostNode[] }> {
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(fieldElement(value, stayDetail(), onChange));
  });
  const tree = created as Tree;
  const inputs = tree.root.findAll((node) => node.type === "input");
  expect(inputs).toHaveLength(2);
  return { tree, inputs };
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

/** Read one attribute off a raw `<input …>` tag. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match === null ? null : match[1];
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
    { value, bounds, palette: PALETTE, onChange },
  );
}

describe("#1503 W-1/W-2 · the buyer web control is a REAL, visible date input", () => {
  test("W-1 (T-13, SC-1-Web) two <input type=\"date\"> nodes reach the DOM", () => {
    const html = renderMarkup(
      fieldElement({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, stayDetail()),
    );
    const tags = inputTags(html);
    // VACUITY GUARD — the markup really rendered, and the query really matched.
    expect(html.length).toBeGreaterThan(100);
    expect(tags).toHaveLength(2);
    expect(tags.every((tag) => attr(tag, "type") === "date")).toBe(true);
    expect(attr(tags[0], "aria-label")).toBe("Check-in");
    expect(attr(tags[1], "aria-label")).toBe("Check-out");
    expect(attr(tags[0], "value")).toBe("2026-08-04");
    expect(attr(tags[1], "value")).toBe("2026-08-06");
    // The labels the guest reads are rendered through RNW too.
    expect(html).toContain("Check-in");
    expect(html).toContain("Check-out");
  });

  test("W-2 the inputs are hit-testable — no hidden-input bridge survives", () => {
    const html = renderMarkup(
      fieldElement({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, stayDetail()),
    );
    const tags = inputTags(html);
    expect(tags).toHaveLength(2); // vacuity guard
    for (const tag of tags) {
      const style = attr(tag, "style") ?? "";
      expect(style.length).toBeGreaterThan(10); // vacuity guard
      expect(style).not.toMatch(/opacity:\s*0(?![.\d])/);
      expect(style).not.toContain("pointer-events:none");
      expect(style).not.toContain("display:none");
      expect(style).not.toContain("visibility:hidden");
      // colorScheme keeps the browser's own calendar popup readable on the
      // dark brand surface.
      expect(style).toContain("color-scheme:dark");
      expect(style).toContain("min-height:46px");
    }
  });

  test("the check-out input is inert, and announced as inert, until check-in exists", () => {
    const html = renderMarkup(
      fieldElement({ checkIn: "", checkOut: "" }, stayDetail()),
    );
    const tags = inputTags(html);
    expect(tags).toHaveLength(2); // vacuity guard
    expect(attr(tags[0], "disabled")).toBeNull();
    expect(tags[1]).toContain("disabled");
    expect(html).toContain("Choose a check-in date first");
  });
});

describe("#1503 W-4 · past and beyond-horizon dates are UNSELECTABLE, not rejected later", () => {
  test("W-4 (SC-3, SC-4) min is venue-local today and max is the clamped horizon", () => {
    const detail = stayDetail({ bookingHorizonDays: 30 });
    const html = renderMarkup(
      fieldElement({ checkIn: "2026-08-04", checkOut: "2026-08-06" }, detail),
    );
    const tags = inputTags(html);
    expect(tags).toHaveLength(2); // vacuity guard
    // Venue-local today in Los Angeles at 2026-08-04T01:00Z is 2026-08-03.
    expect(attr(tags[0], "min")).toBe("2026-08-03");
    expect(attr(tags[0], "max")).toBe(addStayDays("2026-08-03", 30));
    // Check-out is anchored on check-in: at least one night, at most 365.
    expect(attr(tags[1], "min")).toBe("2026-08-05");
    expect(attr(tags[1], "max")).toBe(addStayDays("2026-08-04", 365));
    // VACUITY GUARD — a dropped `min` would read `null`, and the horizon clamp
    // really moved the ceiling off the 365-day default.
    expect(attr(tags[0], "min")).not.toBeNull();
    expect(attr(tags[0], "max")).not.toBe(addStayDays("2026-08-03", 365));
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
        },
      ),
    );
    const tags = inputTags(html);
    // VACUITY GUARD — the booking form really rendered the picker. If the date
    // rows regressed to a TextInput this is 0 and the block fails here first.
    expect(tags).toHaveLength(2);
    expect(attr(tags[0], "aria-label")).toBe("Check-in");
    // THE FIX. Venue-local today in Los Angeles is 2026-08-03, so tomorrow is
    // the 4th. UTC has already rolled over to the 4th, so the old
    // `setUTCDate(getUTCDate() + 1)` seed produced the 5th — a form silently
    // pre-filled two days past the guest's own tomorrow.
    expect(attr(tags[0], "value")).toBe("2026-08-04");
    expect(attr(tags[1], "value")).toBe("2026-08-05");
    expect(attr(tags[0], "value")).not.toBe("2026-08-05");
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
        },
      ),
    );
    const tags = inputTags(html);
    expect(tags).toHaveLength(2); // vacuity guard
    // NY is 2026-08-03 21:00 at that instant, so tomorrow is the 4th.
    expect(attr(tags[0], "value")).toBe("2026-08-04");
    expect(attr(tags[0], "min")).toBe("2026-08-03");
  });
});

describe("#1503 W-5/W-6 · edits are committed through the shared rules", () => {
  test("W-5 (T-15, SC-11) clearing a control forwards \"\" and does not throw", async () => {
    const seen: Array<[StayDateRange, string]> = [];
    const { tree, inputs } = await mountField(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next, field) => seen.push([next, field]),
    );
    let threw = false;
    await TestRenderer.act(() => {
      try {
        (inputs[0].props.onChange as (event: unknown) => void)({
          target: { value: "" },
        });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toEqual({ checkIn: "", checkOut: "" });
    expect(seen[0][1]).toBe("check_in");
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("W-6 (T-17, SC-5) a check-in at or past check-out CLEARS check-out", async () => {
    const seen: StayDateRange[] = [];
    const { tree, inputs } = await mountField(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next) => seen.push(next),
    );
    await TestRenderer.act(() => {
      (inputs[0].props.onChange as (event: unknown) => void)({
        target: { value: "2026-08-07" },
      });
    });
    expect(seen).toEqual([{ checkIn: "2026-08-07", checkOut: "" }]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("a check-in that still precedes check-out leaves the range intact", async () => {
    const seen: StayDateRange[] = [];
    const { tree, inputs } = await mountField(
      { checkIn: "2026-08-04", checkOut: "2026-08-06" },
      (next) => seen.push(next),
    );
    await TestRenderer.act(() => {
      (inputs[0].props.onChange as (event: unknown) => void)({
        target: { value: "2026-08-05" },
      });
    });
    expect(seen).toEqual([{ checkIn: "2026-08-05", checkOut: "2026-08-06" }]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});
