import { isRequiredPhoneValid, normalizePhoneE164 } from "../phone";

describe("phone validation", () => {
  test("requires an E.164-compatible phone number", () => {
    expect(normalizePhoneE164("+14155552671")).toBe("+14155552671");
    expect(normalizePhoneE164("(415) 555-2671")).toBe("+14155552671");
    expect(normalizePhoneE164("415")).toBeNull();
    expect(isRequiredPhoneValid("")).toBe(false);
  });
});
