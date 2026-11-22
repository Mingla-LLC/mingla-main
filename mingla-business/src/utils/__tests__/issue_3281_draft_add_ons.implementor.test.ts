// MINGLA-INVARIANT: I-ADDON-UNPUBLISHED-ONE-LIST | issue #3281 | The Add-ons editor on an unpublished event edits a one-list view of its tickets' add-ons and writes them back onto those tickets losslessly, so the stored event, its server blob and publish keep today's per-ticket shape.
/**
 * issue #3281 S3 (§6.4) — the Add-ons editor on an event draft.
 *
 * Proves on the real store options, mapper and editor model:
 *  - the persisted draft store is unchanged (v15) and a stored draft loads and
 *    saves exactly as before (the editor adds no stored field);
 *  - lifting tickets' extras into one list and lowering them back is lossless
 *    (an empty `extras: []`, a ticket with no key and live-only fields included);
 *  - an add-on added or removed in the editor lands on its ticket's extras in
 *    major units, so the server blob and publish read it as today.
 *
 * FAILS-ON-REVERT: drop a ticket's empty extras key, mis-convert minor units,
 * or let the editor write anything but tickets -> red.
 */

import { beforeEach, describe, expect, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
  type TicketExtraStub,
  type TicketStub,
} from "../../store/draftEventStore";
import { liftTicketAddOns, ticketsWithAddOns } from "../draftAddOns";
import { draftToServerUpdate } from "../serverDraftEventMapper";
import {
  draftAddOnsFromSave,
  draftAddOnsPayload,
} from "../../components/addOns/draftAddOnsSource";
import { buildSaveList, emptyAddOnForm } from "../../components/addOns/addOnsEditorModel";

const PERSIST_KEY = "mingla-business.draftEvent.v1";

const extra = (id: string, over: Partial<TicketExtraStub> = {}): TicketExtraStub => ({
  id,
  name: `Extra ${id}`,
  description: null,
  priceGbp: 12.5,
  isUnlimited: false,
  capacity: 30,
  maxPerTicket: 2,
  validDayIds: null,
  ...over,
});

const ticket = (id: string, over: Partial<TicketStub> = {}): TicketStub => ({
  id,
  name: `Ticket ${id}`,
  priceGbp: 20,
  capacity: 100,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  ...over,
});

/** A ticket list in every shape the old per-ticket JSON had. */
const legacyTickets = (): TicketStub[] => [
  ticket("t_a", { extras: [extra("x_1"), extra("x_2", { priceGbp: 19.99, validDayIds: ["d1"] })] }),
  ticket("t_b", { displayOrder: 1 }), // never had the key
  ticket("t_c", { displayOrder: 2, extras: [] }), // had it, empty
  ticket("t_d", {
    displayOrder: 3,
    isFree: true,
    priceGbp: null,
    extras: [extra("x_3", { priceGbp: 0, isUnlimited: true, capacity: null, soldCount: 4, capacityFloor: 4, soldDayIds: ["d2"] })],
  }),
];

const legacyDraft = (tickets: TicketStub[] = legacyTickets()): DraftEvent => ({
  ...buildDraftEvent("brand_3281"),
  id: "d_3281",
  tickets,
});

const blobTickets = (draft: DraftEvent): unknown => {
  const theme = draftToServerUpdate(draft, {}).theme as { business_draft: { tickets: unknown } };
  return theme.business_draft.tickets;
};

const seedPersisted = async (drafts: unknown[], version: number): Promise<DraftEvent[]> => {
  await AsyncStorage.setItem(PERSIST_KEY, JSON.stringify({ state: { drafts }, version }));
  await useDraftEventStore.persist.rehydrate();
  return useDraftEventStore.getState().drafts;
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useDraftEventStore.setState({ drafts: [] });
});

describe("the stored draft is unchanged", () => {
  test("store v15, and a stored draft with extras loads and saves exactly as before", async () => {
    expect(useDraftEventStore.persist.getOptions().version).toBe(15);
    const stored = legacyDraft();
    const [loaded] = await seedPersisted([stored], 15);
    expect(loaded).toEqual(stored);
    expect(blobTickets(loaded)).toEqual(legacyTickets());
  });
});

describe("lift and lower", () => {
  test("lossless both ways, and lifting the lowered tickets gives the same list", () => {
    const lifted = liftTicketAddOns(legacyTickets());
    expect(lifted.tickets.some((t) => "extras" in t)).toBe(false);
    expect(lifted.addOns?.map((a) => [a.id, a.priceMinor, a.targets])).toEqual([
      ["x_1", 1250, ["t_a"]],
      ["x_2", 1999, ["t_a"]],
      ["x_3", 0, ["t_d"]],
    ]);
    expect(lifted.addOnTicketIds).toEqual(["t_a", "t_c", "t_d"]);
    const lowered = ticketsWithAddOns(lifted);
    expect(lowered).toEqual(legacyTickets());
    expect(liftTicketAddOns(lowered)).toEqual(lifted);
  });
});

describe("the draft Add-ons editor", () => {
  test("a new add-on saved in the editor reaches the blob on its ticket, priced in major units", () => {
    const draft = legacyDraft();
    const payload = draftAddOnsPayload(draft);
    expect(payload.multiLinkEnabled).toBe(false);
    expect(payload.targets.map((t) => t.key)).toEqual(["tt:t_a", "tt:t_b", "tt:t_c", "tt:t_d"]);
    const form = { ...emptyAddOnForm(["tt:t_b"]), name: "Tote bag", priceText: "8.50", stockText: "" };
    const items = buildSaveList(payload, { payload, currency: "GBP", kind: "event" }, { form });
    const lowered = draftAddOnsFromSave(items, draft);
    expect(payload.addOns.map((a) => a.priceCents)).toEqual([1250, 1999, 0]);
    expect(lowered.find((t) => t.id === "t_b")?.extras?.map((e) => [e.name, e.priceGbp, e.isUnlimited])).toEqual([
      ["Tote bag", 8.5, true],
    ]);
    // Everything that was there before is still there, unchanged.
    expect(lowered.filter((t) => t.id !== "t_b")).toEqual(legacyTickets().filter((t) => t.id !== "t_b"));
  });

  test("removing an add-on in the editor removes it from its ticket", () => {
    const draft = legacyDraft();
    const payload = draftAddOnsPayload(draft);
    const items = buildSaveList(payload, { payload, currency: "GBP", kind: "event" }, { removeId: "x_1" });
    const lowered = draftAddOnsFromSave(items, draft);
    expect(lowered.find((t) => t.id === "t_a")?.extras?.map((e) => e.id)).toEqual(["x_2"]);
    expect(lowered.find((t) => t.id === "t_b")).toEqual(legacyTickets()[1]);
  });

  test("a lift of tickets with no add-ons anywhere adds no fields", () => {
    expect(liftTicketAddOns([ticket("t_a")])).toEqual({ tickets: [ticket("t_a")] });
  });
});
