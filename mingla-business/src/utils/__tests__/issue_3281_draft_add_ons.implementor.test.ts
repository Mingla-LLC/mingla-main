// MINGLA-INVARIANT: I-ADDON-DRAFT-ONE-LIST | issue #3281 | An event draft keeps its add-ons once at the top level in minor units, and the server blob and publish receive exactly the per-ticket add-ons the draft had before the move.
/**
 * issue #3281 S3 (§6.4) — event drafts keep add-ons in one top-level list.
 *
 * Proves, on the real store, mapper and persisted-store migrator:
 *  - v15 → v16 moves every ticket's extras to `draft.addOns` (priceMinor,
 *    targets = draft ticket ids) and a v15 draft with no extras loads unchanged;
 *  - lifting then lowering is lossless (an empty `extras: []`, a ticket with no
 *    key and live-only fields included), so the server blob, and the publish
 *    that reads it, get exactly today's per-ticket JSON;
 *  - the server echo comes back lifted and lowers to the same blob;
 *  - store writes: a ticket saved with extras replaces its add-ons, a ticket
 *    without the key keeps them, a deleted ticket takes them with it;
 *  - the draft Add-ons editor's whole-list save lowers to the per-ticket JSON.
 *
 * FAILS-ON-REVERT: drop the v16 migration step, the lift in updateDraft, or the
 * lowering in the server payload -> red.
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
import { liftDraftAddOns, liftTicketAddOns, ticketsWithAddOns } from "../draftAddOns";
import { draftToServerUpdate, serverRowToDraft, type ServerDraftEventRow } from "../serverDraftEventMapper";
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

describe("persisted drafts v15 → v16", () => {
  test("a v15 draft's per-ticket extras move to one list in minor units, nothing lost", async () => {
    const [migrated] = await seedPersisted([legacyDraft()], 15);
    expect(migrated.tickets.some((t) => "extras" in t)).toBe(false);
    expect(migrated.addOns?.map((a) => [a.id, a.priceMinor, a.targets])).toEqual([
      ["x_1", 1250, ["t_a"]],
      ["x_2", 1999, ["t_a"]],
      ["x_3", 0, ["t_d"]],
    ]);
    expect(migrated.addOnTicketIds).toEqual(["t_a", "t_c", "t_d"]);
    // Lowered back, the draft is the v15 draft (direction new → old).
    expect(ticketsWithAddOns(migrated)).toEqual(legacyTickets());
    // The server blob (and the publish that reads it) is what v15 sent.
    expect(blobTickets(migrated)).toEqual(blobTickets(legacyDraft()));
  });

  test("a v15 draft with no extras loads unchanged", async () => {
    const plain = legacyDraft([ticket("t_a"), ticket("t_b", { displayOrder: 1 })]);
    const [migrated] = await seedPersisted([plain], 15);
    expect(migrated).toEqual(plain);
    expect("addOns" in migrated).toBe(false);
  });

  test("an older store (v12) still climbs the whole chain and lands lifted", async () => {
    const { coverGallery: _gallery, ...v12 } = legacyDraft();
    const [migrated] = await seedPersisted([v12], 12);
    expect(migrated.addOns).toHaveLength(3);
    expect(ticketsWithAddOns(migrated)).toEqual(legacyTickets());
  });
});

describe("lift and lower", () => {
  test("lossless both ways, and lifting twice changes nothing", () => {
    const lifted = liftDraftAddOns(legacyDraft());
    expect(ticketsWithAddOns(lifted)).toEqual(legacyTickets());
    expect(liftDraftAddOns(lifted)).toEqual(lifted);
  });

  test("the server echo is read lifted and saved back as the same blob", () => {
    const original = legacyDraft();
    const update = draftToServerUpdate(original, {});
    const row = {
      id: original.id,
      brand_id: original.brandId,
      slug: "draft-3281",
      title: "Untitled draft",
      description: null,
      theme: update.theme,
      is_online: false,
      is_recurring: false,
      is_multi_date: false,
      created_at: original.createdAt,
      updated_at: original.updatedAt,
    } as unknown as ServerDraftEventRow;
    const echoed = serverRowToDraft(row);
    expect(echoed.tickets.some((t) => "extras" in t)).toBe(false);
    expect(echoed.addOns).toHaveLength(3);
    expect(blobTickets(echoed)).toEqual(blobTickets(original));
  });
});

describe("store writes", () => {
  const seed = (): void => {
    useDraftEventStore.setState({ drafts: [liftDraftAddOns(legacyDraft())] });
  };
  const current = (): DraftEvent => useDraftEventStore.getState().drafts[0];

  test("a ticket saved with extras replaces its add-ons; one saved without the key keeps them", () => {
    seed();
    const view = ticketsWithAddOns(current());
    useDraftEventStore.getState().updateDraft("d_3281", {
      tickets: view.map((t) =>
        t.id === "t_a" ? { ...t, extras: [extra("x_9")] } : t.id === "t_d" ? { ...t, extras: undefined } : t,
      ).map((t) => {
        if (t.id !== "t_d") return t;
        const { extras: _drop, ...rest } = t;
        return rest;
      }),
    });
    expect(current().addOns?.map((a) => a.id)).toEqual(["x_9", "x_3"]);
    expect(current().tickets.some((t) => "extras" in t)).toBe(false);
  });

  test("deleting a ticket takes its add-ons with it", () => {
    seed();
    useDraftEventStore.getState().updateDraft("d_3281", {
      tickets: current().tickets.filter((t) => t.id !== "t_a"),
    });
    expect(current().addOns?.map((a) => a.id)).toEqual(["x_3"]);
    expect(current().addOnTicketIds).toEqual(["t_c", "t_d"]);
  });

  test("a patch without tickets leaves the add-ons alone", () => {
    seed();
    useDraftEventStore.getState().updateDraft("d_3281", { name: "Renamed" });
    expect(current().addOns).toHaveLength(3);
  });
});

describe("the draft Add-ons editor", () => {
  test("a new add-on saved in the editor reaches the blob on its ticket, priced in major units", () => {
    const draft = liftDraftAddOns(legacyDraft());
    const payload = draftAddOnsPayload(draft);
    expect(payload.multiLinkEnabled).toBe(false);
    expect(payload.targets.map((t) => t.key)).toEqual(["tt:t_a", "tt:t_b", "tt:t_c", "tt:t_d"]);
    const form = { ...emptyAddOnForm(["tt:t_b"]), name: "Tote bag", priceText: "8.50", stockText: "" };
    const items = buildSaveList(payload, { payload, currency: "GBP", kind: "event" }, { form });
    const fields = draftAddOnsFromSave(items, draft);
    const next = { ...draft, ...fields };
    const tote = fields.addOns.find((a) => a.name === "Tote bag");
    expect(tote?.priceMinor).toBe(850);
    expect(tote?.targets).toEqual(["t_b"]);
    const lowered = ticketsWithAddOns(next);
    expect(lowered.find((t) => t.id === "t_b")?.extras?.map((e) => [e.name, e.priceGbp, e.isUnlimited])).toEqual([
      ["Tote bag", 8.5, true],
    ]);
    // Everything that was there before is still there, unchanged.
    expect(lowered.filter((t) => t.id !== "t_b")).toEqual(legacyTickets().filter((t) => t.id !== "t_b"));
  });

  test("removing an add-on in the editor removes it from its ticket", () => {
    const draft = liftDraftAddOns(legacyDraft());
    const payload = draftAddOnsPayload(draft);
    const items = buildSaveList(payload, { payload, currency: "GBP", kind: "event" }, { removeId: "x_1" });
    const next = { ...draft, ...draftAddOnsFromSave(items, draft) };
    expect(ticketsWithAddOns(next).find((t) => t.id === "t_a")?.extras?.map((e) => e.id)).toEqual(["x_2"]);
  });

  test("a lift of tickets with no add-ons anywhere adds no fields", () => {
    expect(liftTicketAddOns([ticket("t_a")])).toEqual({ tickets: [ticket("t_a")] });
  });
});
