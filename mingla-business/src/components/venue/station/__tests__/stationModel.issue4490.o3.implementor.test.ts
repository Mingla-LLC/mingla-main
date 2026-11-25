/**
 * #4490 spec 08 O3 part A — the kitchen and bar screens' pure state: columns,
 * the repeat timer, mute expiry, filters, timers, copy for every code, the
 * entry rule and the web print/sound wiring.
 *
 * fails-on-revert: the chime rule (once at once, every 20 s while New, never
 * muted), the mute expiry, the T2-style column sort and the copy table are
 * pinned here; the source pins keep held rounds off the board and audio out of
 * native.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

import {
  ageLabel,
  ageSeconds,
  clockOffsetMs,
  columnOf,
  columnTickets,
  isLate,
  isMuted,
  muteUntil,
  oldestNew,
  openLines,
  parseStationBoard,
  parseStationChoice,
  ringingKeys,
  shouldChime,
  STATION_REPEAT_MS,
  ticketKey,
  venueTime,
  type StationTicket,
} from "../stationModel";
import { STATION_COPY, STATION_ERROR_CODES, stationErrorCopy } from "../stationCopy";
import { stationHref, stationsEntryVisible } from "../stationRoute";
import { floorLayoutFor, stationBoardColumns } from "../../../../utils/floorLayout";

const ROOT = path.join(__dirname, "..");
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), "utf8");

const ticket = (over: Partial<StationTicket>): StationTicket => ({
  orderId: "o1",
  station: "kitchen",
  ticketNo: "0142",
  destination: "Table 6",
  movedFrom: null,
  guestOrder: false,
  sellerName: "Ada",
  tellName: "Ada",
  sentAt: "2026-11-21T19:41:00Z",
  orderStatus: "placed",
  stationRev: 1,
  state: "new",
  acceptedAt: null,
  acceptedByName: null,
  readyAt: null,
  readyByName: null,
  pickedUpAt: null,
  printedCount: 0,
  lines: [],
  ...over,
});

describe("08-O3 the chime rule", () => {
  const T0 = 1_000_000;
  test("plays at once for a ticket nobody has heard yet", () => {
    expect(shouldChime({ ringing: ["a"], heard: new Set(), lastChimeAt: null, now: T0, mutedUntil: null })).toBe(true);
  });
  test("then every 20 s while any ticket is New, not sooner", () => {
    const heard = new Set(["a"]);
    expect(shouldChime({ ringing: ["a"], heard, lastChimeAt: T0, now: T0 + STATION_REPEAT_MS - 1, mutedUntil: null })).toBe(false);
    expect(shouldChime({ ringing: ["a"], heard, lastChimeAt: T0, now: T0 + STATION_REPEAT_MS, mutedUntil: null })).toBe(true);
    expect(STATION_REPEAT_MS).toBe(20_000);
  });
  test("a second new ticket rings at once even inside the 20 s", () => {
    expect(shouldChime({ ringing: ["a", "b"], heard: new Set(["a"]), lastChimeAt: T0, now: T0 + 1000, mutedUntil: null })).toBe(true);
  });
  test("stops when every New ticket is accepted", () => {
    expect(shouldChime({ ringing: [], heard: new Set(["a"]), lastChimeAt: T0, now: T0 + 60_000, mutedUntil: null })).toBe(false);
  });
  test("muted: silent until the mute runs out, then rings again", () => {
    const until = muteUntil(T0, 15);
    expect(until - T0).toBe(15 * 60_000);
    expect(muteUntil(T0, 60) - T0).toBe(60 * 60_000);
    expect(shouldChime({ ringing: ["a"], heard: new Set(), lastChimeAt: null, now: T0 + 1000, mutedUntil: until })).toBe(false);
    expect(isMuted(until, until - 1)).toBe(true);
    expect(isMuted(until, until)).toBe(false);
    expect(shouldChime({ ringing: ["a"], heard: new Set(), lastChimeAt: null, now: until, mutedUntil: until })).toBe(true);
  });
  test("voided and accepted tickets never ring", () => {
    const keys = ringingKeys([
      ticket({ orderId: "n", state: "new" }),
      ticket({ orderId: "v", state: "voided" }),
      ticket({ orderId: "c", state: "cooking", acceptedAt: "x" }),
    ]);
    expect(keys).toEqual(["n:kitchen"]);
  });
  test("mute lives in memory only: nothing in the station code persists it", () => {
    const sources = ["StationScreen.tsx", "StationBoard.tsx", "stationModel.ts", "stationSound.ts", "stationSound.web.ts"].map(read).join("\n");
    expect(sources).not.toMatch(/AsyncStorage|localStorage|sessionStorage|SecureStore/);
  });
});

describe("08-O3 columns, filters and timers", () => {
  test("New, Cooking, Ready from the server's state; a voided ticket stays where it was", () => {
    expect(columnOf(ticket({ state: "new" }))).toBe("new");
    expect(columnOf(ticket({ state: "cooking", acceptedAt: "a" }))).toBe("cooking");
    expect(columnOf(ticket({ state: "ready", acceptedAt: "a", readyAt: "r" }))).toBe("ready");
    expect(columnOf(ticket({ state: "voided" }))).toBe("new");
    expect(columnOf(ticket({ state: "voided", acceptedAt: "a" }))).toBe("cooking");
    const list = [ticket({ orderId: "1" }), ticket({ orderId: "2", state: "cooking", acceptedAt: "a" })];
    expect(columnTickets(list, "new").map((t) => t.orderId)).toEqual(["1"]);
  });
  test("the board parser drops done tickets and anything malformed", () => {
    const board = parseStationBoard({
      venueId: "v", venueName: "Palm", brandId: "b", station: "bar", timezone: "Africa/Lagos", serverNow: "2026-11-21T20:00:00Z",
      settings: { targetMinutes: { kitchen: 12, bar: 4 }, printPaper: "roll_80", defaultStation: "bar" },
      noStationItems: 3,
      tickets: [
        { orderId: "a", station: "bar", state: "new", lines: [{ itemId: "i", name: "Chapman", quantity: 2 }] },
        { orderId: "b", station: "bar", state: "done" },
        { orderId: "c", station: "grill", state: "new" },
        { station: "bar", state: "new" },
      ],
    });
    expect(board.tickets.map(ticketKey)).toEqual(["a:bar"]);
    expect(board.tickets[0].lines[0]).toMatchObject({ name: "Chapman", quantity: 2, voided: false });
    expect(board.targetMinutes).toEqual({ kitchen: 12, bar: 4 });
    expect(board.defaultStation).toBe("bar");
    expect(parseStationChoice("all")).toBe("all");
    expect(parseStationChoice("grill")).toBeNull();
  });
  test("ages use the server clock, not the device clock; labels read m:ss then h mm", () => {
    const deviceNow = Date.parse("2026-11-21T19:00:00Z");
    const offset = clockOffsetMs("2026-11-21T19:42:00Z", deviceNow);
    expect(ageSeconds("2026-11-21T19:41:00Z", deviceNow, offset)).toBe(60);
    expect(ageLabel(38)).toBe("0:38");
    expect(ageLabel(17 * 60 + 5)).toBe("17:05");
    expect(ageLabel(3600 + 5 * 60)).toBe("1 h 05");
  });
  test("the timer turns danger past the station's target minutes", () => {
    const targets = { kitchen: 15, bar: 5 };
    expect(isLate(ticket({}), 15 * 60 - 1, targets)).toBe(false);
    expect(isLate(ticket({}), 15 * 60, targets)).toBe(true);
    expect(isLate(ticket({ station: "bar" }), 5 * 60, targets)).toBe(true);
    expect(isLate(ticket({ state: "ready" }), 99 * 60, targets)).toBe(false);
  });
  test("times are the venue's wall clock (24 h), never the device zone", () => {
    expect(venueTime("2026-11-21T20:40:00Z", "Africa/Lagos")).toBe("21:40");
    expect(venueTime("2026-11-21T20:40:00Z", "Europe/London")).toBe("20:40");
    expect(venueTime("2026-11-21T20:40:00Z", null)).toBeNull();
  });
  test("the New banner names the oldest New ticket; Cooking ticks list only open lines", () => {
    expect(oldestNew([ticket({ orderId: "c", state: "cooking" }), ticket({ orderId: "n" })])?.orderId).toBe("n");
    const t = ticket({ lines: [
      { itemId: "1", name: "A", quantity: 1, notes: null, modifiers: [], prepState: "fired", voided: false, voidedAt: null, voidedByName: null, readyAt: null },
      { itemId: "2", name: "B", quantity: 1, notes: null, modifiers: [], prepState: "ready", voided: false, voidedAt: null, voidedByName: null, readyAt: "r" },
      { itemId: "3", name: "C", quantity: 1, notes: null, modifiers: [], prepState: "voided", voided: true, voidedAt: "v", voidedByName: "Ada", readyAt: null },
    ] });
    expect(openLines(t).map((l) => l.itemId)).toEqual(["1"]);
  });
});

describe("08-O3 layout classes (useFloorLayout)", () => {
  const widths: [number, string, boolean][] = [
    [390, "phone", false],
    [599, "phone", false],
    [600, "tablet", true],
    [768, "tablet", true],
    [1023, "tablet", true],
    [1024, "desk", true],
    [1440, "desk", true],
  ];
  test.each(widths)("%i wide is %s; board columns %s", (width, layout, columns) => {
    expect(floorLayoutFor(width)).toBe(layout);
    expect(stationBoardColumns(floorLayoutFor(width))).toBe(columns);
  });
  test("the hook reads the window on every platform (not the web-only desktop flag)", () => {
    const hook = fs.readFileSync(path.join(__dirname, "../../../../hooks/useFloorLayout.ts"), "utf8");
    expect(hook).toContain("useWindowDimensions");
    expect(hook).not.toContain("useResponsiveLayout");
    expect(read("StationScreen.tsx")).toContain("useFloorLayout()");
  });
});

describe("08-O3 copy and entry", () => {
  test("every station and PDF refusal has its own words; an unknown code never leaks", () => {
    for (const code of ["not_authorized", "stations_not_enabled", "station_ticket_not_found", "station_ticket_closed",
      "station_ticket_not_ready", "floor_pdf_failed", "floor_pdf_not_found", "floor_pdf_not_ready",
      "floor_pdf_kind_not_ready", "floor_pdf_popup_blocked", "network"]) {
      expect(STATION_ERROR_CODES).toContain(code);
      expect(stationErrorCopy(code)).not.toContain("_");
    }
    expect(stationErrorCopy("something_new")).toBe("That didn't go through. Try again.");
    expect(stationErrorCopy("floor_pdf_failed")).toBe("Couldn't make the ticket. Try again");
  });
  test("spec copy is used as written", () => {
    expect(STATION_COPY.startService).toBe("Start service");
    expect(STATION_COPY.soundOffUntil("21:40")).toBe("Sound off until 21:40");
    expect(STATION_COPY.needsAppTitle).toBe("Sound needs the latest app");
    expect(STATION_COPY.soundLockedTitle).toBe("Tap to turn sound on");
    expect(STATION_COPY.emptyNew("bar")).toBe("No orders for the bar");
    expect(STATION_COPY.printTestTicket).toBe("Print a test ticket");
    expect(STATION_COPY.printReceipt).toBe("Print receipt");
    expect(STATION_COPY.alreadyAccepted("Ada")).toBe("Ada already accepted this.");
  });
  test("the entry shows only when released, the feature is on and the person may work the kitchen", () => {
    expect(stationsEntryVisible({ released: true, kitchenScreensOn: true, canKitchen: true })).toBe(true);
    expect(stationsEntryVisible({ released: false, kitchenScreensOn: true, canKitchen: true })).toBe(false);
    expect(stationsEntryVisible({ released: true, kitchenScreensOn: false, canKitchen: true })).toBe(false);
    expect(stationsEntryVisible({ released: true, kitchenScreensOn: true, canKitchen: false })).toBe(false);
    expect(stationHref("v1")).toBe("/venue/v1/station/kitchen");
    expect(stationHref("v1", "bar")).toBe("/venue/v1/station/bar");
  });
});

// TEST-MOD-APPROVED #4490 (O3 part B): the native player is no longer the
// transitional stub. These two tests now pin the part B contract; the native
// player's behaviour is in stationSound.native.issue4490.o3b.implementor.test.ts.
describe("08-O3 sound: one interface, web player and native expo-audio player", () => {
  test("the native player loads expo-audio only on use, after asking for the native module", () => {
    const native = read("stationSound.ts");
    expect(native).not.toContain("[TRANSITIONAL]");
    expect(native).not.toMatch(/^import [^;]*["']expo-audio["']/m);
    expect(native).toContain('requireOptionalNativeModule("ExpoAudio")');
    expect(native).toContain("playsInSilentMode: true");
  });
  test("the approved SDK 54 native modules are dependencies; no expo-av", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../../../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["expo-audio"]).toBe("~1.1.1");
    expect(pkg.dependencies["expo-screen-orientation"]).toBe("~9.0.9");
    expect(pkg.dependencies["expo-asset"]).toBe("~12.0.14");
    expect(pkg.dependencies["expo-av"]).toBeUndefined();
  });
  test("the web chime data is byte-identical to assets/sounds/new-order.mp3 and small", async () => {
    const { STATION_CHIME_DATA_URL } = await import("../stationChime.web");
    const file = fs.readFileSync(path.join(__dirname, "../../../../../assets/sounds/new-order.mp3"));
    expect(file.byteLength).toBeLessThanOrEqual(30 * 1024);
    expect(STATION_CHIME_DATA_URL).toBe(`data:audio/mpeg;base64,${file.toString("base64")}`);
  });
  test("the web player unlocks on a tap, plays, and reports a browser block as locked", async () => {
    const { createStationSoundPlayer } = await import("../stationSound.web");
    const calls: string[] = [];
    let refuse = true;
    const audio = {
      currentTime: 5,
      muted: false,
      volume: 0,
      preload: "",
      play: () => {
        calls.push(`play muted=${String(audio.muted)}`);
        if (refuse) {
          const e = new Error("play() failed because the user didn't interact with the document first.");
          e.name = "NotAllowedError";
          return Promise.reject(e);
        }
        return Promise.resolve();
      },
      pause: () => {
        calls.push("pause");
      },
    };
    const player = createStationSoundPlayer(() => audio);
    expect(player.support()).toBe("locked");
    await expect(player.play()).resolves.toBe(false);
    expect(player.support()).toBe("locked");
    refuse = false;
    await expect(player.unlock()).resolves.toBe("ready");
    expect(calls).toContain("play muted=true");
    await expect(player.play()).resolves.toBe(true);
    expect(calls[calls.length - 1]).toBe("play muted=false");
    expect(audio.currentTime).toBe(0);
    const none = createStationSoundPlayer(() => null);
    expect(none.support()).toBe("unsupported");
  });
});

describe("08-O3 wiring pins", () => {
  test("Start service unlocks sound and puts started=1 in the address (a reload keeps the board, T17)", () => {
    const screen = read("StationScreen.tsx");
    expect(screen).toMatch(/const start = async[\s\S]*await unlock\(\);[\s\S]*started: "1"/);
    expect(screen).toContain("STATION_COPY.soundLockedTitle");
    expect(screen).toContain('useScreenAwake(started, { tag: "station-board" })');
  });
  test("the board reads through venue-order-staff with realtime, a 30 s poll and a status dot", () => {
    const hook = fs.readFileSync(path.join(__dirname, "../../../../hooks/useStationBoard.ts"), "utf8");
    expect(hook).toContain("refetchInterval: VENUE_ORDERS_POLL_MS");
    expect(hook).toContain(".subscribe((status: string) =>");
    expect(hook).toContain('table: "venue_orders"');
  });
});
