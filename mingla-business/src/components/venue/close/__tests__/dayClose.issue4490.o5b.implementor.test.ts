/**
 * #4490 spec 08 O5 part B — Close the day, the drawer, the export, Till
 * settings and the Till device sign-out, as logic.
 *
 * FAILS-ON-REVERT: words a difference as a raw number and D-1 fails; lets a
 * Till device be listed by name and D-2 fails; sends the retired day start in
 * the settings patch and D-6 fails; drops the close entry's money rule and
 * D-8 fails; signs a Till device out from Account at once and D-10 fails.
 */

import * as fs from "fs";
import * as path from "path";

jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, from: jest.fn() } }));
jest.mock("../../../../utils/guestCsvExport", () => ({ exportCsvText: jest.fn(async () => ({ method: "downloaded" })) }));

import {
  ageLabel,
  blockingChecks,
  countPreview,
  dateProblem,
  dayLabel,
  dayView,
  differenceWords,
  methodLabel,
  personName,
  settingsPatchFrom,
  settingsValid,
} from "../dayCloseModel";
import { CLOSE_ERROR_COPY, closeErrorCopy } from "../dayCloseCopy";
import { closeEntryVisible, closeHref, tillSettingsHref } from "../closeRoute";
import {
  csvAmount,
  dayCloseCsvFilename,
  DAY_CLOSE_CSV_HEADER,
  serializeDayCloseCsv,
} from "../../../../utils/dayCloseCsv";
import {
  mapCashDrawer,
  mapDayExport,
  mapDaySummary,
  mapTillSettings,
  type TillSettings,
} from "../../../../services/venueDayCloseService";
import { tillSignOutHref } from "../../../../services/tillDeviceSignOut";
import {
  filterVenueModulesForCapabilities,
  venueAccessCanManageMoney,
  withCloseAccess,
} from "../../venueCapabilityGate";
import { deriveVenueNav } from "../../venueModules";
import { featureSetFrom } from "../../../../types/venueFeatures";

const root = path.resolve(__dirname, "../../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

describe("D-1 the difference reads in words", () => {
  test("short, over, balanced (the spec's words)", () => {
    expect(differenceWords(-50000, "NGN")).toEqual({ text: "₦500.00 short", tone: "warn" });
    expect(differenceWords(120000, "NGN")).toEqual({ text: "₦1,200.00 over", tone: "warn" });
    expect(differenceWords(0, "NGN")).toEqual({ text: "Balanced", tone: "ok" });
    expect(differenceWords(-250, "GBP").text).toBe("£2.50 short");
  });
  test("the typing preview is display only and null until something is counted", () => {
    expect(countPreview(12210000, null)).toBeNull();
    expect(countPreview(12210000, 12160000)).toBe(-50000);
  });
});

describe("D-2 people on the close", () => {
  // TEST-MOD-APPROVED #4490 (after #4579): the server's name for a Mingla admin is
  // #4579's public name with the Mingla mark ("Tola from Mingla"); Host shows it as is.
  test("a Till device is never a person; a Mingla admin reads '<name> from Mingla'; an unnamed member reads Team member", () => {
    expect(personName({ kind: "device", name: "Front till", userId: "d" })).toBe("Till device");
    expect(personName({ kind: "mingla_support", name: "Tola from Mingla", userId: "m" })).toBe("Tola from Mingla");
    expect(personName({ kind: "mingla_support", name: null, userId: "m" })).toBe("Mingla Team");
    expect(personName({ kind: "person", name: null, userId: "p" })).toBe("Team member");
    expect(personName({ kind: "system", name: null, userId: null })).toBe("Cleared by the Till");
    expect(personName(null)).toBe("Team member");
  });
});

describe("D-3 days and labels", () => {
  test("only today and the 7 days before it", () => {
    expect(dateProblem("2026-11-23", "2026-11-22")).toBe("future");
    expect(dateProblem("2026-11-15", "2026-11-22")).toBeNull();
    expect(dateProblem("2026-11-14", "2026-11-22")).toBe("too_old");
    expect(dateProblem("2026-11-22", "2026-11-22")).toBeNull();
  });
  test("labels need no device clock or time zone", () => {
    expect(dayLabel("2026-11-21")).toBe("Sat 21 Nov");
    expect(ageLabel(112)).toBe("1 h 52 min");
    expect(ageLabel(22)).toBe("22 min");
    expect(methodLabel("scan_transfer")).toBe("Scan to pay · bank transfer");
    expect(methodLabel("whatever")).toBe("Other");
  });
});

describe("D-4 the server's summary maps without inventing money", () => {
  const raw = {
    venueId: "v", venueName: "Close Club", businessDate: "2026-11-21", today: "2026-11-22", currency: "NGN",
    state: "closed",
    close: { closedAtLocal: "23:48", closedBy: { kind: "person", name: "Chioma" }, cashCountedMinor: 12160000,
      cashExpectedMinor: 12210000, differenceMinor: -50000, reopenCount: 1, canReopen: true },
    totals: {
      takings: { count: 18, amountMinor: 12900000, tipMinor: 215000 },
      reconcile: { byMethodMatches: true, byPersonMatches: true, atVenueMatches: true, onlineMatches: true },
      paidInToday: { paidInMinor: 950000, paidIn: { atVenue: 3000000, online: 0 } },
    },
    late: { count: 1, amountMinor: 550000, payments: [{ paymentId: "p", method: "scan_transfer", amountMinor: 550000, paidAtLocal: "23:55" }] },
    openChecks: [{ saleId: "a", spotLabel: "T9", blocks: true, server: { kind: "device" } },
      { saleId: "b", checkLabel: "Bar", blocks: false, waitingForScan: true, server: {} }],
    blockingCount: 1,
  };
  const s = mapDaySummary(raw);
  test("the close, the late list and the checks come through as sent", () => {
    expect(s.state).toBe("closed");
    expect(dayView(s)).toBe("closed");
    expect(s.close?.differenceMinor).toBe(-50000);
    expect(s.totals.takings.amountMinor).toBe(12900000);
    expect(s.late.payments[0].method).toBe("scan_transfer");
    expect(s.openChecks[0].label).toBe("T9");
    expect(blockingChecks(s).map((c) => c.saleId)).toEqual(["a"]);
    expect(s.totals.reconciles).toBe(true);
    expect(s.totals.paidInToday?.atVenueMinor).toBe(3000000);
  });
  test("missing numbers stay 0, never guessed; a broken reconcile says so", () => {
    const empty = mapDaySummary({ state: "weird", totals: { reconcile: { byMethodMatches: false } } });
    expect(empty.state).toBe("open");
    expect(empty.totals.cash.expectedMinor).toBe(0);
    expect(empty.totals.reconciles).toBe(false);
    expect(empty.totals.paidInToday).toBeNull();
  });
  test("the drawer: the newest float is the current one", () => {
    const d = mapCashDrawer({ floatMinor: 5500000, previousFloatMinor: 5000000, movements: [
      { id: "1", kind: "float", amountMinor: 5000000, current: false, by: { kind: "person", name: "Chioma" } },
      { id: "2", kind: "float", amountMinor: 5500000, current: true, by: {} },
      { id: "3", kind: "paid_out", amountMinor: 300000, note: "Ice", current: true, by: {} },
    ] });
    expect(d.movements.filter((m) => m.kind === "float" && m.current).map((m) => m.amountMinor)).toEqual([5500000]);
    expect(d.previousFloatMinor).toBe(5000000);
  });
});

describe("D-5 the export: one CSV row per payment, the server's numbers", () => {
  const data = mapDayExport({
    venueName: "Café Palm & Pepper", businessDate: "2026-11-21", currency: "NGN",
    rows: [
      { paymentId: "p1", reference: "AB12CD34", paidAtLocal: "2026-11-21 19:00", check: "Table 6, by the window", method: "cash",
        amountMinor: 1100000, serviceChargeMinor: 100000, tipMinor: 100000, guestFeeMinor: 0, refundedMinor: 0,
        takenBy: { kind: "person", name: "Ada" }, server: { kind: "person", name: "Ada" }, paidAfterCancel: false, late: false },
      { paymentId: "p2", reference: "EF56GH78", paidAtLocal: "2026-11-21 23:55", check: null, method: "scan_transfer",
        amountMinor: 550000, serviceChargeMinor: 50000, tipMinor: 0, guestFeeMinor: 8250, refundedMinor: 550000,
        takenBy: { kind: "device" }, server: { kind: "mingla_support", name: "Tola from Mingla" }, paidAfterCancel: true, late: true },
    ],
  });
  const csv = serializeDayCloseCsv(data);
  const lines = csv.trim().split("\r\n");
  test("a header and one row per payment", () => {
    expect(lines).toHaveLength(1 + data.rows.length);
    expect(lines[0]).toBe(DAY_CLOSE_CSV_HEADER.join(","));
  });
  test("plain decimal amounts in the day's currency; commas quoted; names only", () => {
    expect(lines[1]).toBe('2026-11-21 19:00,AB12CD34,"Table 6, by the window",Cash,NGN,11000.00,1000.00,1000.00,0.00,0.00,Ada,Ada,No,No');
    expect(lines[2]).toContain("Scan to pay - bank transfer,NGN,5500.00,500.00,0.00,82.50,5500.00,Till device,Tola from Mingla,Yes,Yes");
    expect(csv).not.toMatch(/@/);
    expect(csvAmount(1200, "JPY")).toBe("1200");
    expect(csvAmount(-1505, "NGN")).toBe("-15.05");
    expect(csvAmount(12345, "KWD")).toBe("12.345");
  });
  test("the file name is the venue and the day", () => {
    expect(dayCloseCsvFilename(data.venueName, data.businessDate)).toBe("cafe-palm-pepper-day-close-2026-11-21.csv");
  });
});

describe("D-6 Settings › Selling in person sends only what changed, never a day start", () => {
  const base: TillSettings = mapTillSettings({
    version: 3, tipsEnabled: true, tipBpsOptions: [1000, 1250, 1500], autoLockMinutes: 2, printPaper: "a4",
    defaultStation: "kitchen", targetMinutes: { kitchen: 15, bar: 5 }, screenStations: ["kitchen", "bar"],
    receiptFooter: null, dayStartsAt: "05:00",
  });
  test("nothing changed: an empty patch", () => {
    expect(settingsPatchFrom(base, base)).toEqual({});
    expect(Object.keys(base)).not.toContain("dayStartsAt");
  });
  test("each changed field, footer trimmed, an emptied footer cleared", () => {
    const draft: TillSettings = { ...base, autoLockMinutes: 5, screenStations: ["bar"], receiptFooter: "  Thanks  ",
      targetMinutes: { kitchen: 20, bar: 5 } };
    expect(settingsPatchFrom(base, draft)).toEqual({ autoLockMinutes: 5, screenStations: ["bar"], receiptFooter: "Thanks",
      targetMinutes: { kitchen: 20, bar: 5 } });
    expect(settingsPatchFrom({ ...base, receiptFooter: "Old" }, { ...base, receiptFooter: " " })).toEqual({ receiptFooter: null });
  });
  test("the limits the server enforces", () => {
    expect(settingsValid(base)).toBe(true);
    expect(settingsValid({ ...base, autoLockMinutes: 11 })).toBe(false);
    expect(settingsValid({ ...base, tipBpsOptions: [500, 750, 1000, 1250, 1500, 1800, 2000] })).toBe(false);
    expect(settingsValid({ ...base, tipBpsOptions: [3500] })).toBe(false);
    expect(settingsValid({ ...base, receiptFooter: "x".repeat(201) })).toBe(false);
  });
});

describe("D-7 every refusal has words, never a raw code", () => {
  test("each server code maps; unknown codes read the generic line", () => {
    for (const code of ["day_already_closed", "day_checks_open", "day_not_closed", "day_reopen_too_late", "day_out_of_range",
      "day_reason_required", "day_close_invalid", "cash_movement_invalid", "till_request_reused", "till_settings_changed",
      "not_authorized", "pin_session_required", "pin_session_invalid", "pin_step_up_cancelled", "network"]) {
      expect(CLOSE_ERROR_COPY[code]).toBeDefined();
      expect(closeErrorCopy(code)).not.toContain("_");
    }
    expect(closeErrorCopy("relation_missing")).toBe("That didn't go through. Try again.");
  });
  test("the server's safe codes are all mapped (venue-till dayClose.ts)", () => {
    const src = read("supabase/functions/venue-till/dayClose.ts");
    const block = src.slice(src.indexOf("DAY_CLOSE_SAFE_CODES = ["), src.indexOf("] as const;", src.indexOf("DAY_CLOSE_SAFE_CODES")));
    const codes = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) expect({ code, mapped: CLOSE_ERROR_COPY[code] !== undefined }).toEqual({ code, mapped: true });
  });
});

describe("D-8 who sees Close the day", () => {
  const features = featureSetFrom({ till: true, menu: true });
  test("released + Sell in person on + money rights", () => {
    expect(closeEntryVisible({ released: true, tillOn: true, canManageMoney: true })).toBe(true);
    expect(closeEntryVisible({ released: false, tillOn: true, canManageMoney: true })).toBe(false);
    expect(closeEntryVisible({ released: true, tillOn: true, canManageMoney: false })).toBe(false);
  });
  test("the rail lists it after the Till when released and on; never when the release is off", () => {
    const nav = deriveVenueNav({ features, activeSpaceCount: 0, tillReleased: true });
    expect(nav).toContain("close");
    expect(nav.indexOf("close")).toBeGreaterThan(nav.indexOf("till"));
    expect(deriveVenueNav({ features, activeSpaceCount: 0, tillReleased: false })).not.toContain("close");
  });
  test("money rights decide: finance managers and up, or venue.manage_money for venue staff", () => {
    expect(venueAccessCanManageMoney({ scoped: false, capabilities: [], role: "finance_manager" })).toBe(true);
    expect(venueAccessCanManageMoney({ scoped: false, capabilities: [], role: "marketing_manager" })).toBe(false);
    expect(venueAccessCanManageMoney({ scoped: true, capabilities: ["venue.sell"], role: null })).toBe(false);
    expect(venueAccessCanManageMoney({ scoped: true, capabilities: ["venue.manage_money"], role: null })).toBe(true);
    expect(withCloseAccess(["till", "close"], false)).toEqual(["till"]);
    expect(filterVenueModulesForCapabilities(["till", "close"], true, ["venue.sell"])).toEqual(["till"]);
    expect(filterVenueModulesForCapabilities(["till", "close"], true, ["venue.manage_money"])).toEqual(["close"]);
  });
  test("routes are opaque ids only", () => {
    expect(closeHref("v1")).toBe("/venue/v1/close");
    expect(tillSettingsHref("v1")).toBe("/venue/v1/till-settings");
  });
});

describe("D-9 the transport asks for a fresh PIN to reopen or export (part A's step-up)", () => {
  test("venueTillService maps day_reopen and day_export to their purposes", () => {
    const src = read("mingla-business/src/services/venueTillService.ts");
    expect(src).toMatch(/body\.action === "day_reopen" \? "reopen"/);
    expect(src).toMatch(/body\.action === "day_export" \? "export"/);
  });
  test("the day-close PDF carries the PIN session like a receipt", () => {
    const src = read("mingla-business/src/services/venueStationService.ts");
    expect(src).toMatch(/request\.kind === "receipt" \|\| request\.kind === "day_close"/);
  });
});

describe("D-10 Account › Sign out on a Till device goes through the Till's own sign-out step", () => {
  test("Account loads the check on use and routes a Till device to the sign-out step", () => {
    const src = read("mingla-business/app/(tabs)/account.tsx");
    expect(src).toMatch(/await import\("\.\.\/\.\.\/src\/services\/tillDeviceSignOut"\)/);
    expect(src).not.toMatch(/^import .*tillDeviceSignOut/m);
    const guard = src.indexOf("tillDeviceSignOutVenue(");
    const signOutCall = src.indexOf("await signOut({ scope });");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(signOutCall);
    expect(tillSignOutHref("v1")).toBe("/venue/v1/till?signout=1");
  });
  test("the Till route opens WhoIsSelling on the sign-out step (one flow, both entry points)", () => {
    // #4490 venue owners: the Till route's screen moved into the Host venue owner.
    const route = read("mingla-business/src/components/venue/host/venueHostRoutes.tsx");
    expect(route).toMatch(/startSigningOut=\{signout === "1"\}/);
    const who = read("mingla-business/src/components/venue/till/WhoIsSelling.tsx");
    expect(who).toMatch(/!startSigningOut \? \{ kind: "none" \} : staff\.managerHasPin \? \{ kind: "pick" \}/);
  });
});
