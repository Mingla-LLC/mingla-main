// issue #3284 [refund terms on events and experiences] — implementor happy-path
// regression for the PUBLIC rendering half (spec part 2 §C5, design part 1 §3.10,
// part 2 §4.6–4.7).
//
// WHAT THIS FILE PINS
//   R-*  the three-state reader: an ABSENT key is unknown, null is none, a valid
//        policy is set, and a policy the database could never store is unknown.
//   L-*  the shared OfferingRefundLadder: per-type copy, the all-sales-final strip,
//        the paid no-policy disclosure, the closing contact line, the trip copy
//        left as it was, and the accessibility fixes (header role, one accessible
//        stop per row, hidden check glyph, zero values in secondary text).
//   E-*  EventOfferingBody section 9: the gating matrix (unknown, none + free,
//        none + paid, all-zero, set, set + free, cancelled, ended) and its
//        position as the LAST body section, after Where you'll be.
//   X-*  ExperienceOfferingBody section 10: the same matrix plus a closed
//        experience, and its position immediately before the price card, with
//        the all-in line and the docked reserve still last.
//
// FAILS-ON-REVERT
//   - restore EventOfferingBody.tsx / ExperienceOfferingBody.tsx from origin/main
//     → every E-/X- case that expects terms fails, and both position cases fail;
//   - restore the pre-#3284 ladder body into OfferingRefundLadder.tsx → the L-
//     cases fail (no OfferingRefundLadder export, no event/experience copy).

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import { Text } from "react-native";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestInstance | string>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
  findByProps: (props: Record<string, unknown>) => TestInstance;
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// The same icon stub the #1902 / #2508 render suites use.
jest.mock("../../../../packages/offering-rendering/LucideIcons", () => {
  const icon = (): null => null;
  return new Proxy({}, { get: () => icon });
});
jest.mock(
  "react-native-svg",
  () => {
    const node = (): null => null;
    return { __esModule: true, default: node, Svg: node, Path: node, Circle: node, Rect: node, G: node, Line: node };
  },
  { virtual: true },
);
// The experience body imports these two for sections this file never populates
// (no brand cover, no stops); they pull in expo-video, so they are stubbed.
jest.mock("../../../../packages/offering-rendering/EventCoverMedia", () => ({
  EventCoverMedia: (): null => null,
}));
jest.mock("../../../../packages/offering-rendering/StopSpine", () => ({
  StopSpine: (): null => null,
}));

// eslint-disable-next-line import/first
import { OfferingRefundLadder } from "../../../../packages/offering-rendering/OfferingRefundLadder";
// eslint-disable-next-line import/first
import { EventOfferingBody } from "../../../../packages/offering-rendering/EventOfferingBody";
// eslint-disable-next-line import/first
import { ExperienceOfferingBody } from "../../../../packages/offering-rendering/ExperienceOfferingBody";
// eslint-disable-next-line import/first
import {
  readRefundPolicyState,
  type RefundPolicyReadState,
} from "../../../../packages/offering-rendering/offeringRefundPolicy";

const PACKAGE_DIR = path.join(__dirname, "..", "..", "..", "..", "packages", "offering-rendering");

const palette = {
  page: "#fffaf5",
  accent: "#ae591b",
  accentText: "#ffffff",
  primaryText: "#101418",
  secondaryText: "#3a3f47",
  tertiaryText: "#8a8f99",
  panel: "#ffffff",
  panelStrong: "#ffffff",
  panelBorder: "#e6e0da",
  card: "#fcfbfb",
  cutoutBorder: "#eeeeee",
  glass: "#ffffff",
  glassTint: "light",
  accentWash: "#fbeee3",
} as never;
const theme = {
  color: "#eb7825",
  foregroundColor: "#ffffff",
  font: "inter",
  fontFamilyValue: "Inter",
  animation: "none",
} as never;
const surface = {
  card: { backgroundColor: "#fcfbfb" },
  primaryText: { color: "#101418" },
  secondaryText: { color: "#3a3f47" },
  tertiaryText: { color: "#8a8f99" },
} as never;

const STANDARD = {
  kind: "standard" as const,
  tiers: [
    { days_before_start: 14, refund_pct: 100 },
    { days_before_start: 7, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const FLEXIBLE_EVENT = {
  kind: "flexible" as const,
  tiers: [
    { days_before_start: 7, refund_pct: 100 },
    { days_before_start: 2, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const FLEXIBLE_TRIP = {
  kind: "flexible" as const,
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 14, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const NO_REFUNDS = {
  kind: "custom" as const,
  tiers: [{ days_before_start: 0, refund_pct: 0 }],
};

const SET_STANDARD: RefundPolicyReadState = { status: "set", policy: STANDARD };
const SET_NO_REFUNDS: RefundPolicyReadState = { status: "set", policy: NO_REFUNDS };
const NONE: RefundPolicyReadState = { status: "none" };
const UNKNOWN: RefundPolicyReadState = { status: "unknown" };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const collectText = (node: unknown, out: string[] = []): string[] => {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  collectText((node as { children?: unknown }).children, out);
  return out;
};
const textOf = (tree: Renderer): string => collectText(tree.toJSON()).join("\n");

const flattenStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flattenStyle))
    : style !== null && typeof style === "object"
      ? (style as Record<string, unknown>)
      : {};

const hostText = (tree: Renderer, content: string): TestInstance[] =>
  tree.root.findAll(
    (node) => node.type === "Text" && collectText(node.props.children).join("") === content,
  );

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: "t-ga",
  name: "General admission",
  description: null,
  priceGbp: 25,
  priceAllInGbp: 27.5,
  currency: "GBP",
  isFree: false,
  isUnlimited: true,
  capacity: null,
  visibility: "visible",
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: false,
  availableAt: "online",
  displayOrder: 0,
  ...overrides,
});

const FREE_TICKET = ticket({ id: "t-free", priceGbp: null, priceAllInGbp: null, isFree: true });

const event = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "e-3284",
    name: "Rooftop Sessions",
    brandId: "b-1",
    brandSlug: "sunset",
    eventSlug: "rooftop",
    description: "Late sets on the roof.",
    dateLine: "Sat 3 Oct",
    dateSubline: "8pm",
    datesList: [],
    status: "published",
    endedAt: null,
    format: "in-person",
    venueName: "The Roof",
    address: "1 High Street",
    hideAddressUntilTicket: false,
    locationGeo: null,
    cityGeo: null,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverGallery: [],
    tickets: [ticket()],
    currency: "GBP",
    ...overrides,
  }) as never;

const BRAND = { id: "b-1", slug: "sunset", displayName: "Sunset Collective", theme: null } as never;

const renderEvent = (
  refundPolicyState: RefundPolicyReadState,
  options: {
    event?: Record<string, unknown>;
    variant?: string;
    refundHostName?: string | null;
  } = {},
): Promise<Renderer> =>
  mount(
    <EventOfferingBody
      event={event(options.event)}
      brand={BRAND}
      variant={(options.variant ?? "published") as never}
      bookable
      palette={palette}
      theme={theme}
      ticketQuantities={{}}
      onChangeTicketQuantity={() => undefined}
      onProceedToCart={() => undefined}
      refundPolicyState={refundPolicyState}
      {...(options.refundHostName !== undefined
        ? { refundHostName: options.refundHostName }
        : {})}
      testID="issue-3284-event-body"
    />,
  );

const experienceData = (
  refundPolicyState: RefundPolicyReadState,
  overrides: Record<string, unknown> = {},
) =>
  ({
    id: "x-3284",
    title: "Lagos Food Walk",
    description: null,
    currency: "USD",
    timezone: "UTC",
    coverMediaUrl: null,
    coverMediaType: null,
    cityCountry: null,
    datesLabel: null,
    seatsLabel: null,
    startTimeLabel: null,
    intents: [],
    stops: [],
    ticket: {
      ticketTypeId: "tt-1",
      name: "Walk",
      priceCents: 2500,
      priceAllInCents: 2750,
      currency: "USD",
      isFree: false,
      isUnlimited: true,
      ticketsRemaining: null,
      quantityTotal: null,
    },
    occurrences: [],
    openDaily: false,
    bookable: true,
    refundPolicyState,
    ...overrides,
  }) as never;

const EXPERIENCE_BRAND = {
  id: "b-2",
  slug: "lagos-food-walks",
  name: "Lagos Food Walks",
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  coverHue: null,
  verified: false,
} as never;

const renderExperience = (
  refundPolicyState: RefundPolicyReadState,
  overrides: Record<string, unknown> = {},
): Promise<Renderer> =>
  mount(
    <ExperienceOfferingBody
      data={experienceData(refundPolicyState, overrides)}
      brand={EXPERIENCE_BRAND}
      palette={palette}
      theme={theme}
      callbacks={{ onReserve: () => undefined }}
      variant="phone"
      dockedReserve={<Text testID="issue-3284-docked-reserve">Reserve now</Text>}
      testID="issue-3284-experience-body"
    />,
  );

// ---------------------------------------------------------------------------
// R — the three-state reader
// ---------------------------------------------------------------------------

describe("#3284 R — readRefundPolicyState keeps unknown apart from none", () => {
  test("R-1 an ABSENT refundPolicy key is unknown", () => {
    expect(readRefundPolicyState({ id: "e" })).toEqual({ status: "unknown" });
  });
  test("R-2 a null refundPolicy is none", () => {
    expect(readRefundPolicyState({ refundPolicy: null })).toEqual({ status: "none" });
  });
  test("R-3 a valid policy is set, copied to exactly the known keys", () => {
    const state = readRefundPolicyState({
      refundPolicy: { ...STANDARD, extra: true, tiers: STANDARD.tiers.map((t) => ({ ...t, note: "x" })) },
    });
    expect(state).toEqual({ status: "set", policy: STANDARD });
  });
  test.each([
    ["days not descending", { kind: "custom", tiers: [{ days_before_start: 2, refund_pct: 50 }, { days_before_start: 7, refund_pct: 0 }] }],
    ["percent rising", { kind: "custom", tiers: [{ days_before_start: 7, refund_pct: 50 }, { days_before_start: 2, refund_pct: 100 }] }],
    ["unknown kind", { kind: "lenient", tiers: [{ days_before_start: 0, refund_pct: 0 }] }],
    ["no tiers", { kind: "custom", tiers: [] }],
    ["nine tiers", { kind: "custom", tiers: [8, 7, 6, 5, 4, 3, 2, 1, 0].map((d) => ({ days_before_start: d, refund_pct: 0 })) }],
    ["fractional percent", { kind: "custom", tiers: [{ days_before_start: 0, refund_pct: 12.5 }] }],
    ["a string", "flexible"],
  ])("R-4 an unreadable policy (%s) is unknown, never a broken ladder", (_label, refundPolicy) => {
    expect(readRefundPolicyState({ refundPolicy })).toEqual({ status: "unknown" });
  });
});

// ---------------------------------------------------------------------------
// L — the shared ladder
// ---------------------------------------------------------------------------

describe("#3284 L — OfferingRefundLadder copy and accessibility", () => {
  test("L-1 trip copy is unchanged: 'before departure', no closing line", async () => {
    const tree = await mount(
      <OfferingRefundLadder policy={FLEXIBLE_TRIP} bookingDeadline={null} palette={palette} surface={surface} />,
    );
    const text = textOf(tree);
    expect(text).toContain("Cancellation policy");
    expect(text).toContain("Flexible — cancel for a full or partial refund based on how early you cancel.");
    expect(text).toContain("30+ days before departure");
    expect(text).toContain("14–29 days before");
    expect(text).toContain("Under 14 days");
    expect(text).not.toContain("To cancel, contact");
  });

  test("L-2 event copy: 'before the event' and the closing contact line", async () => {
    const tree = await mount(
      <OfferingRefundLadder
        policy={STANDARD}
        offeringType="event"
        hostName="Sunset Collective"
        palette={palette}
        surface={surface}
      />,
    );
    const rows = tree.root
      .findAll((node) => node.type === "View" && node.props.accessible === true)
      .map((node) => node.props.accessibilityLabel);
    expect(rows).toEqual([
      "14+ days before the event: 100% refund",
      "7–13 days before: 50% refund",
      "Under 7 days: no refund",
    ]);
    expect(textOf(tree)).toContain(
      "To cancel, contact Sunset Collective. Refunds follow the windows above.",
    );
  });

  test("L-3 experience copy: 'before the experience'", async () => {
    const tree = await mount(
      <OfferingRefundLadder
        policy={FLEXIBLE_EVENT}
        offeringType="experience"
        hostName="Lagos Food Walks"
        palette={palette}
        surface={surface}
      />,
    );
    const text = textOf(tree);
    expect(text).toContain("7+ days before the experience");
    expect(text).toContain("2–6 days before");
    expect(text).toContain("To cancel, contact Lagos Food Walks. Refunds follow the windows above.");
  });

  test("L-4 every tier at 0% reads 'All sales are final', with no rows, glyph or closing line", async () => {
    const tree = await mount(
      <OfferingRefundLadder policy={NO_REFUNDS} offeringType="event" hostName="Host" palette={palette} surface={surface} />,
    );
    const text = textOf(tree);
    expect(text).toContain("Cancellation policy");
    expect(text).toContain("All sales are final — no refunds.");
    expect(hostText(tree, "No refund")).toHaveLength(0);
    expect(text).not.toContain("To cancel, contact");
    expect(hostText(tree, "✓")).toHaveLength(0);
    expect(tree.root.findAll((node) => node.type === "View" && node.props.accessible === true)).toHaveLength(0);
  });

  test("L-5 a paid offering with no policy gets the plain disclosure — buy for events, book for experiences", async () => {
    const eventTree = await mount(
      <OfferingRefundLadder policy={null} offeringType="event" isPaid hostName="Sunset Collective" palette={palette} surface={surface} />,
    );
    expect(textOf(eventTree)).toBe(
      ["Cancellation policy", "No refund policy set. Ask Sunset Collective before you buy."].join("\n"),
    );
    const experienceTree = await mount(
      <OfferingRefundLadder policy={null} offeringType="experience" isPaid hostName="  " palette={palette} surface={surface} />,
    );
    expect(textOf(experienceTree)).toContain("No refund policy set. Ask the organizer before you book.");
  });

  test("L-6 a free offering with no policy, and a trip with neither policy nor deadline, render nothing", async () => {
    const free = await mount(
      <OfferingRefundLadder policy={null} offeringType="event" isPaid={false} palette={palette} surface={surface} />,
    );
    expect(free.toJSON()).toBeNull();
    const trip = await mount(
      <OfferingRefundLadder policy={null} bookingDeadline={null} palette={palette} surface={surface} />,
    );
    expect(trip.toJSON()).toBeNull();
  });

  test("L-7 a11y: header heading, one accessible stop per row, hidden glyph, zero value in secondary text", async () => {
    const tree = await mount(
      <OfferingRefundLadder policy={STANDARD} offeringType="event" palette={palette} surface={surface} />,
    );
    const heading = hostText(tree, "Cancellation policy");
    expect(heading).toHaveLength(1);
    expect(heading[0].props.accessibilityRole).toBe("header");

    const glyph = hostText(tree, "✓");
    expect(glyph).toHaveLength(1);
    expect(glyph[0].props.accessibilityElementsHidden).toBe(true);
    expect(glyph[0].props.importantForAccessibility).toBe("no");

    const zero = hostText(tree, "No refund");
    expect(zero).toHaveLength(1);
    expect(flattenStyle(zero[0].props.style).color).toBe("#3a3f47");
    expect(hostText(tree, "100% refund").map((n) => flattenStyle(n.props.style).color)).toEqual(["#101418"]);
  });

  test("L-8 the ladder carries no Animated value and no CSS transition style", () => {
    const source = fs.readFileSync(path.join(PACKAGE_DIR, "OfferingRefundLadder.tsx"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bAnimated\b/);
    expect(code).not.toMatch(/\btransition[A-Z]\w*/);
  });
});

// ---------------------------------------------------------------------------
// E — event body section 9
// ---------------------------------------------------------------------------

describe("#3284 E — EventOfferingBody section 9 gating, copy and position", () => {
  test.each([
    ["E-1 unknown (absent key) + paid", UNKNOWN, {}, null],
    ["E-2 none + free", NONE, { event: { tickets: [FREE_TICKET] } }, null],
    ["E-3 none + paid", NONE, {}, "No refund policy set. Ask Sunset Collective before you buy."],
    ["E-4 all tiers 0% + paid", SET_NO_REFUNDS, {}, "All sales are final — no refunds."],
    ["E-5 set + paid", SET_STANDARD, {}, "To cancel, contact Sunset Collective. Refunds follow the windows above."],
    ["E-6 set + free", SET_STANDARD, { event: { tickets: [FREE_TICKET] } }, null],
    [
      "E-7 set + paid, cancelled",
      SET_STANDARD,
      { variant: "cancelled", event: { status: "cancelled", acquisitionState: { kind: "cancelled" } } },
      null,
    ],
    [
      "E-8 set + paid, ended",
      SET_STANDARD,
      { variant: "past", event: { acquisitionState: { kind: "ended", reason: "master_end" } } },
      null,
    ],
  ] as const)("%s", async (_label, state, options, expectedLine) => {
    const tree = await renderEvent(state, options as never);
    const text = textOf(tree);
    // The gate anchor always mounts, whatever renders inside it.
    expect(tree.root.findAll((n) => n.type === "View" && n.props.testID === "orch-1167-cancellation")).toHaveLength(1);
    if (expectedLine === null) {
      expect(text).not.toContain("Cancellation policy");
      expect(text).not.toContain("No refund policy set");
    } else {
      expect(text).toContain("Cancellation policy");
      expect(text).toContain(expectedLine);
    }
  });

  test("E-9 the event noun reaches the rows, and the brand name is the default host", async () => {
    const tree = await renderEvent(SET_STANDARD);
    const text = textOf(tree);
    expect(text).toContain("14+ days before the event");
    expect(text).not.toContain("departure");
    expect(text).toContain("To cancel, contact Sunset Collective.");
  });

  test("E-10 an explicit null host falls back to 'the organizer'", async () => {
    const tree = await renderEvent(NONE, { refundHostName: null });
    expect(textOf(tree)).toContain("No refund policy set. Ask the organizer before you buy.");
  });

  test("E-11 section 9 is the LAST body section, after Where you'll be", async () => {
    const tree = await renderEvent(SET_STANDARD);
    const body = tree.root.findAll(
      (n) => n.type === "View" && n.props.testID === "issue-3284-event-body",
    )[0];
    const hostChildren = body.children.filter(
      (child): child is TestInstance => typeof child !== "string",
    );
    const last = hostChildren[hostChildren.length - 1];
    expect(last.props.testID).toBe("orch-1167-cancellation");

    const text = textOf(tree);
    expect(text.indexOf("Where you")).toBeGreaterThan(-1);
    expect(text.indexOf("Cancellation policy")).toBeGreaterThan(text.indexOf("Where you"));
  });
});

// ---------------------------------------------------------------------------
// X — experience body section 10
// ---------------------------------------------------------------------------

describe("#3284 X — ExperienceOfferingBody section 10 gating, copy and position", () => {
  test.each([
    ["X-1 unknown (absent key) + paid", UNKNOWN, {}, null],
    ["X-2 none + free", NONE, { ticket: { ticketTypeId: "tt-1", name: "Walk", priceCents: 0, priceAllInCents: null, currency: "USD", isFree: true, isUnlimited: true, ticketsRemaining: null, quantityTotal: null } }, null],
    ["X-3 none + paid", NONE, {}, "No refund policy set. Ask Lagos Food Walks before you book."],
    ["X-4 all tiers 0% + paid", SET_NO_REFUNDS, {}, "All sales are final — no refunds."],
    ["X-5 set + paid", SET_STANDARD, {}, "To cancel, contact Lagos Food Walks. Refunds follow the windows above."],
    ["X-6 set, zero-priced ticket", SET_STANDARD, { ticket: { ticketTypeId: "tt-1", name: "Walk", priceCents: 0, priceAllInCents: null, currency: "USD", isFree: false, isUnlimited: true, ticketsRemaining: null, quantityTotal: null } }, null],
    ["X-7 set + paid, experience closed", SET_STANDARD, { offeringClosed: true }, null],
    ["X-8 set, no ticket", SET_STANDARD, { ticket: null }, null],
  ] as const)("%s", async (_label, state, overrides, expectedLine) => {
    const tree = await renderExperience(state, overrides as never);
    const text = textOf(tree);
    expect(
      tree.root.findAll((n) => n.type === "View" && n.props.testID === "experience-body-cancellation"),
    ).toHaveLength(1);
    if (expectedLine === null) {
      expect(text).not.toContain("Cancellation policy");
      expect(text).not.toContain("No refund policy set");
    } else {
      expect(text).toContain("Cancellation policy");
      expect(text).toContain(expectedLine);
    }
  });

  test("X-9 the experience noun reaches the rows", async () => {
    const tree = await renderExperience(SET_STANDARD);
    const text = textOf(tree);
    expect(text).toContain("14+ days before the experience");
    expect(text).not.toContain("before the event");
  });

  test("X-10 section 10 sits immediately before the price card; the all-in line and docked reserve stay last", async () => {
    const tree = await renderExperience(SET_STANDARD);
    const body = tree.root.findAll(
      (n) => n.type === "View" && n.props.testID === "issue-3284-experience-body",
    )[0];
    const hostChildren = body.children.filter(
      (child): child is TestInstance => typeof child !== "string",
    );
    const ids = hostChildren.map((child) => child.props.testID ?? `<${String(child.type)}>`);
    const cancellation = ids.indexOf("experience-body-cancellation");
    const priceCard = ids.indexOf("experience-body-price-card");
    expect(cancellation).toBeGreaterThan(-1);
    expect(priceCard).toBe(cancellation + 1);
    expect(ids[ids.length - 1]).toBe("issue-3284-docked-reserve");

    const text = textOf(tree);
    expect(text.indexOf("Cancellation policy")).toBeLessThan(text.indexOf("All-in price"));
    expect(text.indexOf("All-in price")).toBeLessThan(text.indexOf("Reserve now"));
  });
});
