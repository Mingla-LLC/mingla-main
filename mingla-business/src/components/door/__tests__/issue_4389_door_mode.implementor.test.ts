// MINGLA-INVARIANT: I-4389-DOOR-MODE-APPLE-NAMING | issue #4389 | Door mode copy names Tap to Pay only through tapToPayName(os): iPhone screens say "Tap to Pay on iPhone" and Android screens never say iPhone.
// MINGLA-INVARIANT: I-4389-DOOR-MODE-FULL-SCREEN | issue #4389 | The door sale cart is a full-screen route (app/event/[id]/door/sell), never a sheet over another screen.
// MINGLA-INVARIANT: I-4389-DOOR-MODE-ONE-ORDER-PER-ATTEMPT | issue #4389 | A door sale attempt carries one clientRequestId, and a second press while that attempt is in flight never creates a second order.
/**
 * #4389 Door mode — regression tests for the full-screen door sale
 * (/event/[id]/door/sell, design "DM", approved 2026-11-11).
 *
 * Pure rules run directly; screen wiring is pinned by reading the source, the
 * way the #4271 door suites do (the stock config is node + ts-jest, no renderer).
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      clear: () => store.clear(),
    },
  };
});
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));

import type { TicketStub } from "../../../store/draftEventStore";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { DoorSaleRecord } from "../../../types/doorSales";
import { doorTierUnitPrice } from "../doorListPrice";
import { DOOR_MODE_COPY, doorModeChipLabel } from "../doorModeCopy";
import { readDoorMethodMemory, writeDoorMethodMemory } from "../doorModeMethodMemory";
import {
  addOneTicket,
  cartQuantity,
  defaultDoorMethod,
  DOOR_MODE_MAX_PER_TIER,
  DoorAttemptGate,
  doorBasketKeyOf,
  doorMethodMemoryKey,
  doorModeChips,
  doorModeCodeStep,
  doorModeTiers,
  doorSaleCandidates,
  doorTicketsSoldTonight,
  parseDoorMethodMemory,
  removeOneTicket,
  resolveDoorMethod,
  seedDoorCart,
} from "../doorModeState";
import { buildDoorPaymentOptions } from "../doorPaymentOptions";
import { doorSaleHref } from "../../../utils/openDoorSale";

jest.mock("../../../config/queryClient", () => ({ queryClient: { fetchQuery: jest.fn() } }));
jest.mock("../../../services/businessEvents", () => ({ fetchBusinessEventsForBrand: jest.fn() }));
jest.mock("../../../hooks/useBusinessEvents", () => ({
  businessEventKeys: { list: (id: string) => ["business-events", "list", id] },
}));

const root = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const SCREEN = "src/components/door/DoorModeScreen.tsx";
const CODE_SHEET = "src/components/door/DoorModePayCodeSheet.tsx";
const TAP_HOOK = "src/components/door/useDoorModeTapSale.ts";
const ROUTE = "app/event/[id]/door/sell.tsx";

const tier = (over: Partial<TicketStub>): TicketStub =>
  ({
    id: "t",
    name: "General",
    isFree: false,
    priceGbp: 25,
    currency: "GBP",
    visibility: "public",
    availableAt: "both",
    displayOrder: 0,
    validDayIds: null,
    ...over,
  }) as TicketStub;

const options = (tapAvailable: boolean) =>
  buildDoorPaymentOptions({
    eventCurrency: "GBP",
    tapToPay: { available: tapAvailable, needsSetup: false },
    platform: "ios",
  });

describe("#4389 Door mode — the method is remembered per event per phone", () => {
  test("a choice is read back for the same user and event, never for another event or user", async () => {
    await writeDoorMethodMemory("user-1", "event-a", { method: "cash", noted: true });
    expect(await readDoorMethodMemory("user-1", "event-a")).toEqual({ method: "cash", noted: true });
    expect(await readDoorMethodMemory("user-1", "event-b")).toEqual({ method: null, noted: false });
    expect(await readDoorMethodMemory("user-2", "event-a")).toEqual({ method: null, noted: false });
  });

  test("the key carries the user and the event", () => {
    expect(doorMethodMemoryKey("u", "e")).toBe("mingla-business.doorMode.method.v1:u:e");
  });

  test("an unreadable or unknown stored value reads as never set", () => {
    expect(parseDoorMethodMemory("{nope")).toEqual({ method: null, noted: false });
    expect(parseDoorMethodMemory(JSON.stringify({ method: "manual", noted: true }))).toEqual({ method: null, noted: true });
  });

  test("the screen picks nothing until the stored method has been read (hydration)", () => {
    const src = read(SCREEN);
    expect(src).toContain("readDoorMethodMemory(userId, eventId)");
    expect(src).toMatch(/const method: DoorModeMethod \| null = memoryReady\s*\?\s*resolveDoorMethod/);
    expect(src).toContain("writeDoorMethodMemory(userId, eventId, saved)");
  });

  test("the first change says once that it is remembered", () => {
    expect(DOOR_MODE_COPY.remembered("Cash")).toBe("Cash is remembered for this event on this phone.");
    const src = read(SCREEN);
    expect(src).toContain("const firstChange = memory !== null && !memory.noted;");
  });
});

describe("#4389 Door mode — default rules", () => {
  test("first time: Tap to Pay where it works, otherwise Buyer's phone", () => {
    expect(defaultDoorMethod(doorModeChips(options(true), "ios"))).toBe("tap_to_pay");
    expect(defaultDoorMethod(doorModeChips(options(false), "ios"))).toBe("pay_code");
  });

  test("the host's choice beats the remembered one, which beats the default", () => {
    const chips = doorModeChips(options(true), "ios");
    expect(resolveDoorMethod({ chosen: null, remembered: null, chips })).toBe("tap_to_pay");
    expect(resolveDoorMethod({ chosen: null, remembered: "cash", chips })).toBe("cash");
    expect(resolveDoorMethod({ chosen: "pay_code", remembered: "cash", chips })).toBe("pay_code");
    expect(resolveDoorMethod({ chosen: "manual", remembered: "cash", chips })).toBe("manual");
  });

  test("a remembered Tap to Pay on a phone without it falls back to Buyer's phone", () => {
    const chips = doorModeChips(options(false), "ios");
    expect(resolveDoorMethod({ chosen: null, remembered: "tap_to_pay", chips })).toBe("pay_code");
  });

  test("chips follow buildDoorPaymentOptions order and Manual is not a chip", () => {
    expect(doorModeChips(options(true), "ios")).toEqual(["tap_to_pay", "pay_code", "cash"]);
    expect(read(SCREEN)).toContain('pickMethod("manual")');
  });
});

describe("#4389 Door mode — web has no Tap to Pay chip", () => {
  test("even when the options list Tap to Pay, the web never shows it", () => {
    expect(doorModeChips(options(true), "web")).toEqual(["pay_code", "cash"]);
  });
});

describe("#4389 Door mode — tickets (I-30 filter, per-tier max)", () => {
  test("hidden and online-only tiers never show at the door; door and both do, in display order", () => {
    const tiers = doorModeTiers([
      tier({ id: "online", availableAt: "online", displayOrder: 0 }),
      tier({ id: "hidden", visibility: "hidden", displayOrder: 1 }),
      tier({ id: "both", availableAt: "both", displayOrder: 3 }),
      tier({ id: "door", availableAt: "door", displayOrder: 2 }),
    ]);
    expect(tiers.map((t) => t.id)).toEqual(["door", "both"]);
    expect(read(SCREEN)).toContain("doorModeTiers(event?.tickets ?? [])");
  });

  test("a tap adds one, the minus takes one off, capped at 99 like the old sheet", () => {
    let cart = addOneTicket([], "a");
    cart = addOneTicket(cart, "a");
    expect(cartQuantity(cart, "a")).toBe(2);
    cart = removeOneTicket(cart, "a");
    cart = removeOneTicket(cart, "a");
    expect(cart).toEqual([]);
    const full = [{ ticketTypeId: "a", quantity: DOOR_MODE_MAX_PER_TIER }];
    expect(addOneTicket(full, "a")).toEqual(full);
    expect(DOOR_MODE_MAX_PER_TIER).toBe(99);
  });

  test("a seeded draft keeps only door tiers, capped", () => {
    const tiers = [tier({ id: "a" })];
    expect(seedDoorCart([{ ticketTypeId: "a", quantity: 500 }, { ticketTypeId: "zz", quantity: 1 }], tiers)).toEqual([
      { ticketTypeId: "a", quantity: 99 },
    ]);
  });

  test("list price at the door: an online sale price never changes it; free is zero", () => {
    const t = { id: "tier-1", name: "Dinner", isFree: false, priceGbp: 4_000 } as TicketStub & Record<string, unknown>;
    t[["sale", "Price", "Gbp"].join("")] = 2_500;
    expect(doorTierUnitPrice(t)).toBe(4_000);
    expect(doorTierUnitPrice({ isFree: true, priceGbp: 4_000 })).toBe(0);
  });
});

describe("#4389 Door mode — the cart is kept after a sale and after a failure", () => {
  const src = read(SCREEN);
  const body = (name: string): string => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start).toBeGreaterThan(-1);
    // Up to its dependency list: the callback body only.
    return src.slice(start, src.indexOf("\n  }, [", start));
  };

  test("only the tiles and the one-time seed change the cart", () => {
    const writes = src.match(/setCart\(/g) ?? [];
    expect(writes).toHaveLength(3);
    expect(src).toContain("setCart(seedDoorCart(decodeDraftLines(rawDraft), tiers));");
    expect(src).toContain("setCart((prev) => addOneTicket(prev, tier.id));");
    expect(src).toContain("setCart((prev) => removeOneTicket(prev, tier.id));");
  });

  test("a completed sale and a failed one leave the tickets untouched", () => {
    for (const name of ["finishSale", "recordOffline", "showCode", "dismissPaid", "onCodeDone"]) {
      expect(body(name)).not.toContain("setCart");
    }
  });

  test("the tap hook never owns the basket", () => {
    expect(read(TAP_HOOK)).not.toContain("setCart");
  });
});

describe("#4389 Door mode — a double tap never makes two orders", () => {
  test("a second press while a sale is in flight is dropped", async () => {
    const gate = new DoorAttemptGate(() => "id");
    let release: () => void = () => undefined;
    const task = jest.fn(() => new Promise<string>((resolve) => (release = () => resolve("order"))));
    const first = gate.run(task);
    const second = await gate.run(task);
    expect(second).toEqual({ ran: false });
    release();
    expect(await first).toEqual({ ran: true, value: "order" });
    expect(task).toHaveBeenCalledTimes(1);
  });

  test("one clientRequestId per attempt: same basket keeps it, a sale or a new basket gets a new one", () => {
    let n = 0;
    const gate = new DoorAttemptGate(() => `id-${(n += 1)}`);
    const basket = doorBasketKeyOf([{ ticketTypeId: "a", quantity: 2 }], null);
    const id = gate.idFor(basket);
    expect(gate.idFor(basket)).toBe(id);
    expect(gate.idFor(doorBasketKeyOf([{ ticketTypeId: "a", quantity: 3 }], null))).not.toBe(id);
    const again = gate.idFor(basket);
    gate.completed();
    expect(gate.idFor(basket)).not.toBe(again);
  });

  test("the basket key ignores tap order", () => {
    expect(
      doorBasketKeyOf(
        [
          { ticketTypeId: "b", quantity: 1 },
          { ticketTypeId: "a", quantity: 2 },
        ],
        "d",
      ),
    ).toBe(doorBasketKeyOf([{ ticketTypeId: "a", quantity: 2 }, { ticketTypeId: "b", quantity: 1 }], "d"));
  });

  test("cash, manual and pay code go through the gate; the cash order carries its id", () => {
    const src = read(SCREEN);
    expect(src).toContain("const clientRequestId = gate.idFor(basketKey);");
    expect(src.match(/await gate\.run\(/g) ?? []).toHaveLength(2);
    expect(src).toContain("gateRef.current.completed();");
  });

  test("tap: one flow per attempt, a press while one runs never starts another", () => {
    const hook = read(TAP_HOOK);
    expect(hook).toContain("if (pendingRef.current !== null) return;");
    expect(hook).toContain('// In flight (starting, ready, reading, saving) or settled: never a second charge.');
    expect(hook).toContain("void flow.tryAnotherCard();");
    expect(hook).toContain("clientRequestId: randomUuid(),");
  });
});

describe("#4389 Door mode — the button follows the method, cash asks first", () => {
  test("labels", () => {
    expect(DOOR_MODE_COPY.charge("£50.00")).toBe("Charge £50.00");
    expect(DOOR_MODE_COPY.showCode("£50.00")).toBe("Show code · £50.00");
    expect(DOOR_MODE_COPY.cashTaken("£50.00")).toBe("Cash taken · £50.00");
  });

  test("cash confirm copy", () => {
    expect(DOOR_MODE_COPY.cashConfirmTitle("£50.00")).toBe("Cash taken: £50.00?");
    expect(DOOR_MODE_COPY.cashConfirmBody).toBe("Tickets are issued and checked in.");
    expect(DOOR_MODE_COPY.confirmCash).toBe("Confirm cash");
    expect(DOOR_MODE_COPY.back).toBe("Back");
  });

  test("Cash taken opens the confirm; only Confirm cash records the sale", () => {
    const src = read(SCREEN);
    expect(src).toMatch(/case "cash":\s*setOverlay\("cash"\);\s*return;/);
    expect(src).toMatch(/const confirmCash = useCallback\(\(\): void => \{\s*setOverlay\(null\);\s*void recordOffline\("cash"\);/);
    expect(src.match(/recordOffline\("cash"\)/g) ?? []).toHaveLength(1);
  });
});

describe("#4389 Door mode — Scan to pay moves on by itself", () => {
  test("the code's status maps to the sheet's step; paid advances", () => {
    expect(doorModeCodeStep("open")).toBe("live");
    expect(doorModeCodeStep("opened")).toBe("paying");
    expect(doorModeCodeStep("checking")).toBe("settling");
    expect(doorModeCodeStep("payment_landing")).toBe("settling");
    expect(doorModeCodeStep("paid")).toBe("paid");
    expect(doorModeCodeStep("expired")).toBe("ended");
    expect(doorModeCodeStep(null)).toBe("loading");
  });

  test("the sheet reads the live code (realtime + poll) and calls onPaid once when it turns paid", () => {
    const sheet = read(CODE_SHEET);
    expect(sheet).toContain("useDoorPayCode(visible ? codeId : null)");
    expect(sheet).toMatch(/if \(step !== "paid" \|\| row === null \|\| paidFor\.current === row\.id\) return;/);
    expect(sheet).toContain("onPaid({ total: amount");
    expect(sheet).toContain("DOOR_MODE_COPY.waitingForPayment");
    expect(sheet).toContain("DOOR_MODE_COPY.cancelSale");
    expect(sheet).toContain("cancelCode.mutateAsync()");
    // A live code can't be swiped away: only Cancel this sale closes it.
    expect(sheet).toContain("dismissDisabled={!canLeave}");
  });

  test("the copy", () => {
    expect(DOOR_MODE_COPY.scanToPay("£50.00")).toBe("Scan to pay £50.00");
    expect(DOOR_MODE_COPY.waitingForPayment).toBe(
      "Waiting for payment… This screen moves on by itself when they've paid.",
    );
    expect(DOOR_MODE_COPY.cancelSale).toBe("Cancel this sale");
  });
});

describe("#4389 Door mode — one full-screen route, no sheet stacking for the cart", () => {
  test("the route renders the screen directly, never inside a Sheet or Modal", () => {
    const route = read(ROUTE);
    expect(route).toContain("<LazyDoorModeScreen");
    expect(route).not.toMatch(/Sheet|Modal/);
  });

  test("the tiles and chips sit on the screen, before any sheet; one overlay at a time", () => {
    const src = read(SCREEN);
    const firstSheet = src.indexOf("<Sheet");
    expect(src.indexOf('testID="door-mode-tiles"')).toBeLessThan(firstSheet);
    expect(src.indexOf('testID="door-mode-chips"')).toBeLessThan(firstSheet);
    expect(src).not.toMatch(/<Modal\b/);
    expect(src).toContain('const [overlay, setOverlay] = useState<Overlay | null>');
    for (const v of ['overlay === "cash"', 'overlay === "code"', 'overlay === "menu"', 'overlay === "buyer"', 'overlay === "pick"']) {
      expect(src).toContain(`visible={${v}}`);
    }
  });

  test("the old door sale sheet is gone and Sell at door opens the route", () => {
    expect(fs.existsSync(path.join(root, "src/components/door/DoorSaleNewSheet.tsx"))).toBe(false);
    const hub = read("app/event/[id]/door/index.tsx");
    expect(hub).not.toContain("LazyDoorSaleNewSheet");
    expect(hub).toContain('openDoorSale(router, brand?.id ?? null, eventId, { source: "event_door" })');
    expect(doorSaleHref("e1", { pick: true, source: "home" })).toBe("/event/e1/door/sell?pick=1&source=home");
  });

  test("Ari's start_door_sale hands off to Door mode", () => {
    const tool = fs.readFileSync(path.join(root, "../supabase/functions/_shared/agentBrandSetupTools.ts"), "utf8");
    expect(tool).toContain("route: `/event/${eventId}/door/sell${draft}`");
  });
});

describe("#4389 Door mode — Apple naming", () => {
  const stringsOf = (src: string): string[] => src.match(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];

  test("Tap to Pay is named by tapToPayName: Tap to Pay on iPhone on iOS", () => {
    expect(doorModeChipLabel("tap_to_pay", "ios")).toBe("Tap to Pay on iPhone");
    expect(doorModeChipLabel("tap_to_pay", "android")).toBe("Tap to Pay");
    expect(doorModeChipLabel("pay_code", "ios")).toBe("Buyer's phone");
  });

  test("no door mode string says reader, terminal, hardware or business", () => {
    const copy = JSON.stringify(DOOR_MODE_COPY) + read("src/components/door/doorModeCopy.ts");
    for (const file of [SCREEN, CODE_SHEET, "src/components/door/DoorModeBuyerSheet.tsx"]) {
      const literals = stringsOf(read(file)).filter((s) => !s.includes("/") && !s.startsWith('"door-mode') && !s.startsWith('"door-tap'));
      for (const literal of literals) expect(literal).not.toMatch(/\b(reader|terminal|hardware|business)\b/i);
    }
    const copyStrings = stringsOf(read("src/components/door/doorModeCopy.ts")).filter((s) => !s.includes("/"));
    for (const literal of copyStrings) expect(literal).not.toMatch(/\b(reader|terminal|hardware|business)\b/i);
    expect(copy.length).toBeGreaterThan(0);
  });

  test("the screen never hard-codes the Tap to Pay name", () => {
    expect(read(SCREEN)).not.toMatch(/"Tap to Pay on iPhone"/);
  });
});

describe("#4389 Door mode — offline and header", () => {
  test("offline: card and phone payments are off, cash still works", () => {
    expect(DOOR_MODE_COPY.offline).toBe(
      "You're offline. Card and phone payments need a connection. Cash still works.",
    );
    const src = read(SCREEN);
    expect(src).toContain("const offline = network?.isConnected === false;");
    expect(src).toContain("(offline && method !== null && isDoorCardMethod(method))");
  });

  test("Door · n sold tonight counts tickets on recent unrefunded door sales", () => {
    const now = Date.parse("2026-11-11T23:00:00Z");
    const sale = (over: Partial<DoorSaleRecord>): DoorSaleRecord =>
      ({
        id: "s",
        status: "completed",
        recordedAt: "2026-11-11T22:00:00Z",
        lines: [{ quantity: 2 }],
        ...over,
      }) as unknown as DoorSaleRecord;
    expect(
      doorTicketsSoldTonight(
        [
          sale({}),
          sale({ status: "refunded_full" }),
          sale({ recordedAt: "2026-11-10T01:00:00Z" }),
          sale({ lines: [{ quantity: 3 }] as never }),
        ],
        now,
      ),
    ).toBe(5);
    expect(DOOR_MODE_COPY.soldTonight(5)).toBe("Door · 5 sold tonight");
  });

  test("Which event: live or today events only, soonest first", () => {
    const now = Date.now();
    const at = (ms: number): string => new Date(now + ms).toISOString();
    const ev = (id: string, startAtUtc: string, over: Partial<LiveEvent> = {}): LiveEvent =>
      ({ id, name: id, status: "scheduled", endedAt: null, date: null, masterStartAtUtc: startAtUtc, ...over }) as unknown as LiveEvent;
    const list = doorSaleCandidates(
      [
        ev("later-live", at(60 * 60 * 1000)),
        ev("live-now", at(-30 * 60 * 1000)),
        ev("cancelled", at(0), { status: "cancelled" }),
        ev("next-week", at(7 * 24 * 60 * 60 * 1000)),
      ],
      now,
    );
    expect(list.map((c) => c.eventId)).toEqual(["live-now", "later-live"]);
  });
});
