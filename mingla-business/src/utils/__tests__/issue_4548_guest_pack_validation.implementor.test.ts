// #4548 — Host guest pack: the validator and the payload builder.
//
// FAILS-ON-REVERT: deleting the https auto-fix in checkGuestPackLink (the
// BARE_DOMAIN branch) turns "bare domain gets https://" red.
import {
  buildGuestPackPayload,
  checkGuestPackItem,
  checkGuestPackLabel,
  checkGuestPackLink,
  checkGuestPackNote,
  guestPackSummary,
  GUEST_PACK_COPY,
  trimGuestPackText,
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

// [TEST-MOD #4548] Retest 1 R2: invisible characters follow the server rule.
describe("invisible characters (server issue_4548_trim)", () => {
  const ZW = ["\u200b", "\u200c", "\u200d", "\u2060", "\u180e", "\u3164", "\u2800", "\ufeff", "\u00ad", "\u034f", "\u115f", "\u1160", "\u17b4", "\u17b5", "\uffa0"];
  test.each(ZW)("a label made only of U+%s is missing", (ch) => {
    expect(checkGuestPackLabel(ch + ch + " ")).toBe("Add a label so guests know what this is.");
  });
  test("leading and trailing invisible runs are trimmed; an interior joiner stays", () => {
    expect(trimGuestPackText("\u200b\u2060 Map \ufeff")).toBe("Map");
    const family = "\u{1F468}\u200d\u{1F469}";
    expect(trimGuestPackText(family)).toBe(family);
    expect(checkGuestPackLabel(family)).toBeNull();
  });
  test("a note made only of invisible characters saves as no note", () => {
    const built = buildGuestPackPayload("\u200b\u3164\u2800", []);
    expect(built).toEqual({ ok: true, payload: { note: null, items: [] } });
  });
  test("a link with an invisible character anywhere is refused inline", () => {
    expect(checkGuestPackLink("https://exa\u200bmple.com/m")).toEqual({
      ok: false,
      error: "That isn't a full link. Paste the whole web address, starting with https://",
    });
    expect(checkGuestPackLink("\u200bhttps://example.com/m\u2060")).toEqual({
      ok: true,
      url: "https://example.com/m",
      fixed: false,
    });
  });
});
