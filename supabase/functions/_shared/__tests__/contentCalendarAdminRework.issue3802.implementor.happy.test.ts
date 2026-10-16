import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canMoveTo,
  copyIsLocked,
  createLatestOnlyGate,
  createSingleFlight,
  monthWindow,
  moveNeedsFields,
  safeHttpsUrl,
} from "../../../../mingla-admin/src/lib/contentCalendarModel.js";

const readAdmin = (relative: string) =>
  Deno.readTextFileSync(
    new URL(`../../../../mingla-admin/src/${relative}`, import.meta.url),
  );
const PAGE = readAdmin("pages/ContentCalendarPage.jsx");
const DRAWER = readAdmin("components/contentCalendar/ContentDrawer.jsx");
const CARD = readAdmin("components/contentCalendar/ContentCard.jsx");
const MODAL = readAdmin("components/ui/Modal.jsx");
const SHELL = readAdmin("components/ui/Drawer.jsx");

Deno.test("#3802 Wave 2 rework: Add is one stable single-flight request", async () => {
  let resolve!: () => void;
  const held = new Promise<void>((done) => resolve = done);
  const keys: string[] = [];
  const flight = createSingleFlight(() => "stable_create_key");
  const first = flight.submit("One title", async (key: string) => {
    keys.push(key);
    await held;
  });
  const second = flight.submit("One title", async () => {
    throw new Error("a second request must not run");
  });
  assert(first === second);
  assert(flight.busy());
  resolve();
  await Promise.all([first, second]);
  assertEquals(keys, ["stable_create_key"]);
  assertEquals(flight.key(), "stable_create_key");
  assertMatch(
    PAGE,
    /disabled=\{busy\}[\s\S]*onKeyDown=.*Enter[\s\S]*onClick=\{create\}/,
  );
});

Deno.test("#3802 Wave 2 rework: approval and field gates have one shared shape", () => {
  assert(canMoveTo({ stage: "idea" }, "writing"));
  assert(!canMoveTo({ stage: "idea" }, "design"));
  assert(canMoveTo({ stage: "scheduled" }, "review"));
  assert(copyIsLocked({ stage: "design" }));
  assert(!copyIsLocked({ stage: "writing" }));
  assertEquals(
    moveNeedsFields({ stage: "review", channels: [] }, "scheduled"),
    {
      field: "content-publish",
      message: "Add a publish date and time before scheduling.",
    },
  );
  assertEquals(
    moveNeedsFields({
      stage: "review",
      publish_at: "2026-10-20T12:00:00Z",
      channels: [],
    }, "scheduled"),
    {
      field: "content-channel-first",
      message: "Choose at least one channel before scheduling.",
    },
  );
  for (const source of [PAGE, DRAWER, CARD]) assertMatch(source, /canMoveTo/);
  assertMatch(
    DRAWER,
    /Copy is read-only after Writing[\s\S]*Move this card back to Writing/,
  );
  assertMatch(PAGE, /openForField\(item, missing\.field, missing\.message\)/);
  assertMatch(PAGE, /openForField\(move\.item, "content-live"/);
});

Deno.test("#3802 Wave 2 rework: calendar is Monday-first and mobile becomes a selected-day agenda", () => {
  const window = monthWindow("2026-10");
  assertEquals(window.days[0].getDay(), 1);
  assertEquals(window.days.length, 42);
  assertMatch(PAGE, /\["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"\]/);
  assertMatch(
    PAGE,
    /md:hidden[\s\S]*data-calendar-date[\s\S]*min-h-11[\s\S]*Nothing scheduled/,
  );
  assertMatch(
    PAGE,
    /ArrowLeft[\s\S]*ArrowRight[\s\S]*ArrowUp[\s\S]*ArrowDown[\s\S]*Home[\s\S]*End/,
  );
  assertMatch(PAGE, /resolvedOptions\(\)\.timeZone/);
  assertMatch(PAGE, /hidden overflow-x-auto[\s\S]*md:block/);
});

Deno.test("#3802 Wave 2 rework: List, links, touch and motion states are explicit", () => {
  for (
    const heading of ["Title", "Stage", "Owners", "Publish time", "Channels"]
  ) {
    assert(PAGE.includes(`<span>${heading}</span>`), heading);
  }
  assertMatch(PAGE, /md:hidden">Stage:/);
  assertEquals(
    safeHttpsUrl("https://example.com/path"),
    "https://example.com/path",
  );
  assertEquals(
    safeHttpsUrl("http://example.com/path"),
    "http://example.com/path",
  );
  assertEquals(safeHttpsUrl("javascript:alert(1)"), null);
  assertMatch(DRAWER, /target="_blank" rel="noopener noreferrer"/);
  for (const source of [PAGE, DRAWER, CARD, MODAL, SHELL]) {
    assertMatch(source, /min-h-11|h-11/);
    assert(!source.includes("focus-visible:ring-[var(--color-brand-500)]"));
  }
  assertMatch(MODAL, /motion-safe:animate/);
  assertMatch(SHELL, /motion-safe:animate/);
});

Deno.test("#3802 Wave 2 rework: closing invalidates pending detail or save results", () => {
  const gate = createLatestOnlyGate();
  const old = gate.activate("card-a");
  assert(gate.accepts(old));
  gate.close();
  assert(!gate.accepts(old));
  const next = gate.activate("card-b");
  assert(!gate.accepts(old));
  assert(gate.accepts(next));
  assertMatch(PAGE, /detailGate\.current\.close\(\)[\s\S]*setDetail\(null\)/);
  assertMatch(
    DRAWER,
    /const close = \(\) => \{ gate\.current\.close\(\); onClose\(\); \}/,
  );
  assertMatch(DRAWER, /if \(gate\.current\.accepts\(ticket\)\)/);
});
