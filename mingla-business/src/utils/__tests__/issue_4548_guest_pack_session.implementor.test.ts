// #4548 — Host guest pack: the working copy and the save-first rule.
//
// The server is mocked (the migration is not applied anywhere yet): every call
// the Host makes goes through `guestPackService`, so the arguments sent to
// `biz_set_event_guest_pack` are asserted here.
//
// FAILS-ON-REVERT: making flushGuestPack return `{ ok: true }` without saving
// turns "Continue saves a changed pack first" and the failure case red.
jest.mock("../../services/guestPackService", () => ({
  fetchEventGuestPack: jest.fn(),
  saveEventGuestPack: jest.fn(),
}));

import {
  fetchEventGuestPack,
  saveEventGuestPack,
} from "../../services/guestPackService";
import {
  addGuestPackItem,
  askRemoveGuestPackItem,
  blurGuestPackItemUrl,
  clearGuestPackFields,
  ensureGuestPackLoaded,
  flushGuestPack,
  getGuestPackSession,
  guestPackEventIdForDraft,
  hasPendingGuestPack,
  moveGuestPackItem,
  releaseGuestPackSession,
  removeGuestPackItem,
  resetAllGuestPackSessions,
  saveGuestPack,
  setGuestPackItemLabel,
  setGuestPackItemUrl,
  setGuestPackNote,
} from "../guestPackSession";

const fetchMock = fetchEventGuestPack as jest.Mock;
const saveMock = saveEventGuestPack as jest.Mock;
const EVENT = "11111111-1111-4111-8111-111111111111";

const add = (label: string, url: string): void => {
  const key = addGuestPackItem(EVENT);
  if (key === null) throw new Error("no key");
  setGuestPackItemLabel(EVENT, key, label);
  setGuestPackItemUrl(EVENT, key, url);
};

beforeEach(async () => {
  resetAllGuestPackSessions();
  fetchMock.mockReset();
  saveMock.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  fetchMock.mockResolvedValue(null);
  await ensureGuestPackLoaded(EVENT);
});

afterEach(() => jest.restoreAllMocks());

describe("working copy", () => {
  test("loads the saved pack in the host's order", async () => {
    resetAllGuestPackSessions();
    fetchMock.mockResolvedValue({
      note: "Gate code 0000",
      items: [
        { label: "Map", url: "https://example.com/map" },
        { label: "Menu", url: "https://example.com/menu.pdf" },
      ],
      updatedAt: "2026-11-21T10:00:00Z",
    });
    await ensureGuestPackLoaded(EVENT);
    const s = getGuestPackSession(EVENT);
    expect(s?.load).toBe("ready");
    expect(s?.items.map((i) => i.label)).toEqual(["Map", "Menu"]);
    expect(hasPendingGuestPack(EVENT)).toBe(false);
  });

  test("a failed read never looks like an empty pack", async () => {
    resetAllGuestPackSessions();
    fetchMock.mockRejectedValue(new Error("offline"));
    await ensureGuestPackLoaded(EVENT);
    expect(getGuestPackSession(EVENT)?.load).toBe("error");
    expect(hasPendingGuestPack(EVENT)).toBe(false);
  });

  test("the sixth link cannot be added", () => {
    for (let i = 0; i < 5; i += 1) add(`L${i}`, "https://example.com");
    expect(addGuestPackItem(EVENT)).toBeNull();
    expect(getGuestPackSession(EVENT)?.items).toHaveLength(5);
  });

  test("up and down buttons change the order", () => {
    add("A", "https://a.example.com");
    add("B", "https://b.example.com");
    add("C", "https://c.example.com");
    const keys = getGuestPackSession(EVENT)?.items.map((i) => i.key) ?? [];
    moveGuestPackItem(EVENT, keys[2] as string, -1);
    moveGuestPackItem(EVENT, keys[0] as string, 1);
    expect(getGuestPackSession(EVENT)?.items.map((i) => i.label)).toEqual(["C", "A", "B"]);
    // an end item cannot move past the end
    moveGuestPackItem(EVENT, keys[1] as string, 1);
    expect(getGuestPackSession(EVENT)?.items.map((i) => i.label)).toEqual(["C", "A", "B"]);
  });

  test("remove asks first; nothing is deleted until confirmed", () => {
    add("A", "https://a.example.com");
    const key = getGuestPackSession(EVENT)?.items[0]?.key as string;
    askRemoveGuestPackItem(EVENT, key, true);
    expect(getGuestPackSession(EVENT)?.items[0]?.confirmRemove).toBe(true);
    expect(getGuestPackSession(EVENT)?.items).toHaveLength(1);
    askRemoveGuestPackItem(EVENT, key, false);
    expect(getGuestPackSession(EVENT)?.items).toHaveLength(1);
    removeGuestPackItem(EVENT, key);
    expect(getGuestPackSession(EVENT)?.items).toHaveLength(0);
  });

  test("leaving the link field adds https:// to a bare domain", () => {
    add("Parking", "example.com/p");
    const key = getGuestPackSession(EVENT)?.items[0]?.key as string;
    blurGuestPackItemUrl(EVENT, key);
    const item = getGuestPackSession(EVENT)?.items[0];
    expect(item?.url).toBe("https://example.com/p");
    expect(item?.fixed).toBe(true);
    expect(item?.urlError).toBeNull();
  });

  test("leaving the link field shows the error for http://", () => {
    add("Parking", "http://example.com/p");
    const key = getGuestPackSession(EVENT)?.items[0]?.key as string;
    blurGuestPackItemUrl(EVENT, key);
    expect(getGuestPackSession(EVENT)?.items[0]?.urlError).toBe("Use a secure link (https)");
  });

  test("the note over 1,000 characters shows its error live", () => {
    setGuestPackNote(EVENT, "a".repeat(1001));
    expect(getGuestPackSession(EVENT)?.noteError).toBe("Shorten the note to 1,000 characters or fewer.");
    setGuestPackNote(EVENT, "a".repeat(1000));
    expect(getGuestPackSession(EVENT)?.noteError).toBeNull();
  });
});

describe("save-first rule (Continue, Publish, Save changes)", () => {
  test("nothing changed: the host may go on, nothing is sent", async () => {
    expect(await flushGuestPack(EVENT)).toEqual({ ok: true, saved: false });
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("a draft with no server id yet has nothing to save", async () => {
    expect(guestPackEventIdForDraft("d_abc")).toBeNull();
    expect(guestPackEventIdForDraft(EVENT)).toBe(EVENT);
    expect(await flushGuestPack(null)).toEqual({ ok: true, saved: false });
  });

  test("Continue saves a changed pack first, with the exact arguments", async () => {
    setGuestPackNote(EVENT, "  Use the side gate  ");
    add("Parking map", "example.com/p");
    add("Menu", "https://menu.example.com/m.pdf");
    expect(hasPendingGuestPack(EVENT)).toBe(true);
    saveMock.mockResolvedValue({
      note: "Use the side gate",
      items: [
        { label: "Parking map", url: "https://example.com/p" },
        { label: "Menu", url: "https://menu.example.com/m.pdf" },
      ],
      updatedAt: "2026-11-21T10:00:00Z",
    });

    expect(await flushGuestPack(EVENT)).toEqual({ ok: true, saved: true });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(EVENT, {
      note: "Use the side gate",
      items: [
        { label: "Parking map", url: "https://example.com/p" },
        { label: "Menu", url: "https://menu.example.com/m.pdf" },
      ],
    });
    expect(hasPendingGuestPack(EVENT)).toBe(false);
    expect(getGuestPackSession(EVENT)?.result).toBe("saved");
  });

  test("a failed save keeps the host on the step and keeps what they typed", async () => {
    setGuestPackNote(EVENT, "Gate code 0000");
    add("Map", "https://example.com/map");
    saveMock.mockRejectedValue(new Error("network"));

    const result = await flushGuestPack(EVENT);
    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "Couldn't save the guest pack. Check your connection and try again.",
    });
    expect(hasPendingGuestPack(EVENT)).toBe(true);
    expect(getGuestPackSession(EVENT)?.note).toBe("Gate code 0000");
    expect(getGuestPackSession(EVENT)?.items).toHaveLength(1);
    expect(getGuestPackSession(EVENT)?.saving).toBe(false);
  });

  test("an invalid link blocks the save, marks the field and sends nothing", async () => {
    add("Map", "http://example.com/map");
    const result = await flushGuestPack(EVENT);
    expect(result.ok).toBe(false);
    expect(saveMock).not.toHaveBeenCalled();
    expect(getGuestPackSession(EVENT)?.items[0]?.urlError).toBe("Use a secure link (https)");
  });

  test("clearing everything and saving deletes the pack", async () => {
    resetAllGuestPackSessions();
    fetchMock.mockResolvedValue({
      note: "hi",
      items: [{ label: "Map", url: "https://example.com/map" }],
      updatedAt: "2026-11-21T10:00:00Z",
    });
    await ensureGuestPackLoaded(EVENT);
    clearGuestPackFields(EVENT);
    saveMock.mockResolvedValue(null);
    expect(await saveGuestPack(EVENT)).toEqual({ ok: true, saved: true });
    expect(saveMock).toHaveBeenCalledWith(EVENT, { note: null, items: [] });
    expect(getGuestPackSession(EVENT)?.result).toBe("removed");
    expect(getGuestPackSession(EVENT)?.baseline).toBeNull();
  });

  test("a released session forgets typed changes", () => {
    setGuestPackNote(EVENT, "x");
    releaseGuestPackSession(EVENT);
    expect(getGuestPackSession(EVENT)).toBeUndefined();
    expect(hasPendingGuestPack(EVENT)).toBe(false);
  });
});
