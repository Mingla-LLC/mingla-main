// issue #3827 [buyer email on a live-listing change] — the client stub that
// pretended to notify buyers is gone, and nothing took its place.
//
// BEFORE: `services/eventChangeNotifier.ts` ran after every live-event save
// and wrote `[email-stub]` / `[sms-stub]` console lines while the screen told
// the host their buyers were being emailed and texted.
// AFTER: the server decides and sends. The store records the edit locally and
// says nothing to anyone.
//
// What is exercised for real: `useLiveEventStore.updateLiveEventFields` is
// called on a real store with a material change, and the console is watched.
//
// FAILS-ON-REVERT: restore `services/eventChangeNotifier.ts` and its call in
// `store/liveEventStore.ts` from origin/main and NS-1, NS-2 and NS-3 go red.

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const SRC = path.resolve(__dirname, "../..");
const APP = path.resolve(SRC, "../app");

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "node_modules" ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });

const productFiles = [...walk(SRC), ...walk(APP)];

describe("issue #3827 — the notifier stub is removed", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("NS-1: the file is gone and nothing imports it", () => {
    expect(fs.existsSync(path.join(SRC, "services/eventChangeNotifier.ts"))).toBe(false);
    expect(productFiles.length).toBeGreaterThan(500);
    const offenders = productFiles.filter((file) =>
      fs.readFileSync(file, "utf8").includes("eventChangeNotifier"),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  test("NS-2: no event-side email or text-message stub string remains", () => {
    const stubs = /\[email-stub\]|\[sms-stub\]|notifyEventChanged|deriveChannelFlags\b/;
    const offenders = productFiles.filter((file) => stubs.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  test("NS-3: a material live edit through the real store logs the edit and announces nothing", () => {
    const store = fs.readFileSync(path.join(SRC, "store/liveEventStore.ts"), "utf8");
    // The eager store gained no import for this work (bundle budget).
    expect(store).not.toMatch(/from "\.\.\/utils\/buyerNoticeCopy"/);
    expect(store).not.toMatch(/from "\.\.\/hooks\/useEventBuyerNoticeStatus"/);
    expect(store).not.toMatch(/from "\.\.\/hooks\/brandCache"/);

    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useLiveEventStore } = require("../../store/liveEventStore") as typeof import("../../store/liveEventStore");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEventEditLogStore } = require("../../store/eventEditLogStore") as typeof import("../../store/eventEditLogStore");

    const liveEvent = {
      id: "le_issue3827",
      serverEventId: null,
      brandId: "brand-3827",
      brandSlug: "casa-lenta",
      eventSlug: "sunset-sessions",
      name: "Sunset Sessions",
      description: "Doors at eight.",
      format: "in_person",
      venueName: "Waterside Event Centre",
      address: "5 Admiralty Road",
      onlineUrl: null,
      date: "2027-11-06",
      doorsOpen: "18:00",
      endsAt: "22:00",
      timezone: "Africa/Lagos",
      whenMode: "single",
      recurrenceRule: null,
      multiDates: null,
      tickets: [],
      status: "scheduled",
      visibility: "public",
      updatedAt: "2026-10-01T00:00:00.000Z",
      publishedAt: "2026-10-01T00:00:00.000Z",
    };
    useLiveEventStore.setState({
      events: [liveEvent as unknown as ReturnType<typeof useLiveEventStore.getState>["events"][number]],
    });
    const before = useEventEditLogStore.getState().entries.length;
    const result = useLiveEventStore.getState().updateLiveEventFields(
      "le_issue3827",
      { venueName: "The Deck at Landmark" },
      { soldCountByTier: {}, soldCountForEvent: 0 } as never,
      "The first room has a power fault",
    );
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(
      useLiveEventStore.getState().events.find((event) => event.id === "le_issue3827")?.venueName,
    ).toBe("The Deck at Landmark");
    expect(useEventEditLogStore.getState().entries.length).toBe(before + 1);
    expect(logs.filter((line) => /stub|email|sms|notif/i.test(line))).toEqual([]);
  });
});
