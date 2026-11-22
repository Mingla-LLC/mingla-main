// #4548 — Host guest pack: the validator and the payload builder.
//
// FAILS-ON-REVERT: deleting the https auto-fix in checkGuestPackLink (the
// BARE_DOMAIN branch) turns "bare domain gets https://" red.
import {
  buildGuestPackPayload,
  checkGuestPackItem,
  checkGuestPackLink,
  checkGuestPackNote,
  guestPackSummary,
  GUEST_PACK_COPY,
} from "../guestPackValidation";

describe("checkGuestPackLink", () => {
  test("a bare domain gets https:// added", () => {
    expect(checkGuestPackLink("example.com/parking")).toEqual({
      ok: true,
      url: "https://example.com/parking",
      fixed: true,
    });
  });

  test("a full https link is kept as typed", () => {
    expect(checkGuestPackLink("  https://example.com/menu.pdf ")).toEqual({
      ok: true,
      url: "https://example.com/menu.pdf",
      fixed: false,
    });
  });

  test("http:// is refused with the secure-link copy", () => {
    expect(checkGuestPackLink("http://example.com")).toEqual({
      ok: false,
      error: "Use a secure link (https)",
    });
  });

  test.each(["javascript:alert(1)", "data:text/html,hi", "ftp://example.com/a", "mailto:a@b.co", "tel:+15555550100"])(
    "%s is refused as not a web link",
    (raw) => {
      expect(checkGuestPackLink(raw)).toEqual({ ok: false, error: GUEST_PACK_COPY.urlScheme });
    },
  );

  test.each(["hello", "https://nodot", "https:// spaced.com", "just some words.com here"])(
    "%s is refused as not a full link",
    (raw) => {
      const result = checkGuestPackLink(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(GUEST_PACK_COPY.urlIncomplete);
    },
  );

  test("a link over 2,048 characters is refused", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(checkGuestPackLink(long)).toEqual({ ok: false, error: GUEST_PACK_COPY.urlTooLong });
  });

  test("an empty link says to add one or remove the row", () => {
    expect(checkGuestPackLink("   ")).toEqual({ ok: false, error: GUEST_PACK_COPY.urlMissing });
  });
});

describe("label, note and item checks", () => {
  test("a blank label is refused", () => {
    expect(checkGuestPackItem({ label: "  ", url: "https://example.com" }).labelError).toBe(
      GUEST_PACK_COPY.labelMissing,
    );
  });

  test("the note limit is 1,000 characters", () => {
    expect(checkGuestPackNote("a".repeat(1000))).toBeNull();
    expect(checkGuestPackNote("a".repeat(1001))).toBe(GUEST_PACK_COPY.noteTooLong);
  });
});

describe("buildGuestPackPayload", () => {
  test("keeps order, trims, adds https and sends a null note when blank", () => {
    const built = buildGuestPackPayload("   ", [
      { label: " Parking map ", url: "example.com/p" },
      { label: "Menu", url: "https://menu.example.com/x.pdf" },
    ]);
    expect(built).toEqual({
      ok: true,
      payload: {
        note: null,
        items: [
          { label: "Parking map", url: "https://example.com/p" },
          { label: "Menu", url: "https://menu.example.com/x.pdf" },
        ],
      },
    });
  });

  test("an empty pack is valid (saving it deletes the pack)", () => {
    expect(buildGuestPackPayload("", [])).toEqual({ ok: true, payload: { note: null, items: [] } });
  });

  test("reports each bad link and an over-long note", () => {
    const built = buildGuestPackPayload("a".repeat(1001), [
      { label: "", url: "https://example.com" },
      { label: "Ok", url: "http://example.com" },
      { label: "Fine", url: "https://example.com" },
    ]);
    expect(built).toEqual({
      ok: false,
      noteError: GUEST_PACK_COPY.noteTooLong,
      invalidItems: 2,
    });
  });

  test("a sixth link is refused", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: "https://example.com" }));
    expect(buildGuestPackPayload("", six).ok).toBe(false);
  });
});

describe("guestPackSummary", () => {
  test("names what is saved", () => {
    expect(guestPackSummary(null)).toBeNull();
    expect(guestPackSummary({ note: "hi", items: [1, 2, 3, 4] })).toBe("Note and 4 links");
    expect(guestPackSummary({ note: null, items: [1] })).toBe("1 link");
    expect(guestPackSummary({ note: "hi", items: [] })).toBe("Note");
  });
});
