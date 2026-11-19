/**
 * issue #4420 (C2, C3) — the buyer "Add to calendar" button opens a chooser,
 * and every row opens a REAL link from its own tap.
 *
 *   A-1 tapping the control opens the chooser (the same entry point every buyer
 *       control uses): the rows for this device appear, in platform order
 *   A-2 phone: each row's tap opens a real https link synchronously (window.open
 *       in a new tab; the .ics rows navigate), never a blob
 *   A-3 iPhone inside Instagram: Apple opens x-safari-https://..., the note shows,
 *       and the follow-up step offers Copy link and "Tap ••• then Open in external browser"
 *   A-4 Android inside Instagram: Other calendar is an intent:// link to Chrome
 *   A-5 desktop: the small menu lists Google, Outlook, Apple (.ics), Other (.ics)
 *   A-6 a blocked new tab still gets a real link (this tab)
 *   A-7 the page source: the old Blob / <a download> path is gone
 *
 * FAILS-ON-REVERT: drop the window.open / location.assign call in
 * openCalendarOption (A-2/A-6); put the Blob download back in
 * offeringCalendarAction (A-7); drop the follow-up step (A-3); remove the lazy
 * open from useAddToCalendar (A-1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockResponsive = { isWideDesktop: false };

jest.mock("react-native", () => ({
  Platform: { OS: "web" },
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {}, hairlineWidth: 1 },
  Modal: "Modal",
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 1280, height: 800 }),
  Linking: { openURL: jest.fn() },
}));
jest.mock("../../../constants/designSystem", () => ({
  color: {
    card2: "#222", line: "#333", text1: "#fff", text2: "#bbb", accentTint: "#411",
    fill: { pressed: "#444", tile: "#555" },
  },
  radius: { xs: 8, sm: 12, md: 16 },
  shadow: { menu: {} },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
  type: { row: {}, caption: {}, small: {} },
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => mockResponsive,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null),
}));
jest.mock("../../ui/Menu", () => ({
  MENU_POPOVER_WIDTH: 240,
  menuPopoverPosition: () => ({ left: 10, top: 10 }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("react-error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));
jest.mock("@mingla/offering-rendering/calendarChooser", () =>
  jest.requireActual("../../../../../packages/offering-rendering/calendarChooser"),
);
jest.mock("@mingla/offering-rendering/offeringCalendar.cjs", () =>
  jest.requireActual("../../../../../packages/offering-rendering/offeringCalendar.cjs"),
);

/* eslint-disable import/first */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: { findAllByProps: (p: Record<string, unknown>) => Array<{ props: Record<string, unknown>; type: unknown }>; findAll: (fn: (n: { props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> } };
  act: (fn: () => void | Promise<void>) => void | Promise<void>;
};
import { useAddToCalendar } from "../useAddToCalendar";
import { offeringCalendarEntry } from "../../../../../packages/offering-rendering/offeringCalendar.cjs";
/* eslint-enable import/first */

const ICS = "https://host.usemingla.com/e/brand/event/calendar.ics";
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/22A3354 Instagram 355.0.0.20.103 (iPhone16,2; iOS 18_0)",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidInstagram: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 355.0.0.0.0 Android",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
};

const entry = offeringCalendarEntry({
  title: "Foodie Fantasy",
  startIso: "2026-12-20T14:00:00Z",
  endIso: "2026-12-20T19:30:00Z",
  location: "Jameson Yard",
});

const calls = { open: [] as string[], assign: [] as string[], opened: { opener: "x" as unknown } };
let openReturnsNull = false;
let copied: string[] = [];

const setUa = (userAgent: string, maxTouchPoints = 0): void => {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent,
      maxTouchPoints,
      clipboard: { writeText: (t: string) => { copied.push(t); return Promise.resolve(); } },
    },
    configurable: true,
  });
};

beforeEach(() => {
  calls.open = [];
  calls.assign = [];
  calls.opened = { opener: "x" };
  openReturnsNull = false;
  copied = [];
  mockResponsive.isWideDesktop = false;
  Object.defineProperty(globalThis, "window", {
    value: {
      open: (href: string) => { calls.open.push(href); return openReturnsNull ? null : calls.opened; },
      location: { assign: (href: string) => calls.assign.push(href) },
    },
    configurable: true,
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "navigator");
});

function Harness(): React.ReactElement {
  const { open, chooser } = useAddToCalendar(entry, ICS);
  return (
    <>
      {React.createElement("Pressable", { testID: "trigger", onPress: open })}
      {chooser}
    </>
  );
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const ids = (root: ReturnType<typeof TestRenderer.create>["root"]): string[] =>
  root
    .findAll((n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("add-to-calendar-") && typeof n.props.onPress === "function")
    .map((n) => (n.props.testID as string).replace("add-to-calendar-", ""))
    .filter((id) => ["apple", "google", "outlook", "ics"].includes(id));
const press = (root: ReturnType<typeof TestRenderer.create>["root"], testID: string): void => {
  const node = root.findAllByProps({ testID }).find((n) => typeof n.props.onPress === "function");
  if (node === undefined) throw new Error(`no pressable ${testID}`);
  (node.props.onPress as () => void)();
};

const mountOpen = async (): Promise<ReturnType<typeof TestRenderer.create>> => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<Harness />);
  });
  await TestRenderer.act(async () => {
    press(renderer.root, "trigger");
    await flush();
    await flush();
  });
  return renderer;
};

describe("#4420 the Add to calendar chooser", () => {
  test("A-1 the control opens the chooser with the rows for this device, in order", async () => {
    setUa(UA.iphone);
    const { root } = await mountOpen();
    expect(ids(root)).toEqual(["apple", "google", "outlook"]);
  });

  test("A-2 every row opens a real link from its own tap (no blob)", async () => {
    setUa(UA.android);
    const { root } = await mountOpen();
    expect(ids(root)).toEqual(["google", "outlook", "ics"]);
    await TestRenderer.act(async () => { press(root, "add-to-calendar-google"); });
    expect(calls.open).toHaveLength(1);
    expect(calls.open[0]).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    expect(calls.opened.opener).toBeNull();
    const second = await mountOpen();
    await TestRenderer.act(async () => { press(second.root, "add-to-calendar-outlook"); });
    expect(calls.open[1]).toMatch(/^https:\/\/outlook\.live\.com\/calendar\/0\/action\/compose\?subject=Foodie%20Fantasy/);
    const third = await mountOpen();
    await TestRenderer.act(async () => { press(third.root, "add-to-calendar-ics"); });
    expect(calls.assign).toEqual([ICS]);
    for (const href of [...calls.open, ...calls.assign]) expect(href).not.toMatch(/^(blob|data):/);
  });

  test("A-3 iPhone in Instagram: Apple hands off to Safari; note and copy-link follow-up show", async () => {
    setUa(UA.iphoneInstagram);
    const { root } = await mountOpen();
    expect(root.findAllByProps({ testID: "add-to-calendar-note" }).length).toBeGreaterThan(0);
    await TestRenderer.act(async () => { press(root, "add-to-calendar-apple"); await flush(); });
    expect(calls.assign).toEqual(["x-safari-https://host.usemingla.com/e/brand/event/calendar.ics"]);
    expect(copied).toEqual([ICS]);
    expect(root.findAllByProps({ testID: "add-to-calendar-followup" }).length).toBeGreaterThan(0);
    await TestRenderer.act(async () => { press(root, "add-to-calendar-copy"); await flush(); });
    expect(copied).toEqual([ICS, ICS]);
  });

  test("A-4 Android in Instagram: Other calendar opens Chrome through an intent link", async () => {
    setUa(UA.androidInstagram);
    const { root } = await mountOpen();
    await TestRenderer.act(async () => { press(root, "add-to-calendar-ics"); });
    expect(calls.assign).toHaveLength(1);
    expect(calls.assign[0]).toMatch(/^intent:\/\/host\.usemingla\.com\/e\/brand\/event\/calendar\.ics#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=/);
  });

  test("A-5 desktop: Google, Outlook, Apple (.ics), Other (.ics)", async () => {
    setUa(UA.desktop);
    mockResponsive.isWideDesktop = true;
    const { root } = await mountOpen();
    expect(ids(root)).toEqual(["google", "outlook", "apple", "ics"]);
  });

  test("A-6 a blocked new tab still gets a real link in this tab", async () => {
    setUa(UA.android);
    openReturnsNull = true;
    const { root } = await mountOpen();
    await TestRenderer.act(async () => { press(root, "add-to-calendar-google"); });
    expect(calls.assign).toHaveLength(1);
    expect(calls.assign[0]).toMatch(/^https:\/\/calendar\.google\.com\//);
  });

  test("A-7 the Blob / <a download> path is gone and the page wires the chooser", () => {
    const action = readFileSync(path.join(__dirname, "../../../utils/offeringCalendarAction.ts"), "utf8");
    expect(action).not.toMatch(/new Blob|createObjectURL|\.download\s*=|offeringCalendarIcs/);
    const page = readFileSync(path.join(__dirname, "../PublicEventPage.tsx"), "utf8");
    expect(page).toContain("useAddToCalendar(calendarEntry, calendarIcsUrl, handleCalendarLoadError)");
    expect(page).not.toContain("addOfferingToCalendar(");
    expect((page.match(/onAddToCalendar=\{handleAddToCalendar\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((page.match(/\{addToCalendarChooser\}/g) ?? []).length).toBe(2);
  });
});
