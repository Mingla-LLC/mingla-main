import { isoFromLocalDateTime, localDateTimeValue } from "../../components/discounts/discountDateTime";
import { isoFromSaleField, saleFieldValue } from "../saleWindowFields";

describe("issue #4523 saved date-time payloads do not change when the field becomes a calendar", () => {
  const instants = ["2027-03-12T19:00:00.000Z", "2027-12-31T23:45:00.000Z", "2028-02-29T00:15:00.000Z"];

  it("ticket sale window: iso -> calendar fields -> iso is the same instant (minute precision)", () => {
    for (const iso of instants) {
      expect(isoFromSaleField(saleFieldValue(iso))).toBe(iso);
    }
  });

  it("an unset or unreadable sale time shows empty fields, never today", () => {
    expect(saleFieldValue(null)).toEqual({ date: "", time: "" });
    expect(saleFieldValue("not a date")).toEqual({ date: "", time: "" });
  });

  it("discount window: the calendar's date + time reproduce the exact ISO the old input saved", () => {
    for (const iso of instants) {
      const local = localDateTimeValue(iso);
      const fields = { date: local.slice(0, 10), time: local.slice(11, 16) };
      expect(isoFromLocalDateTime(`${fields.date}T${fields.time}`)).toBe(isoFromLocalDateTime(local));
      expect(isoFromLocalDateTime(`${fields.date}T${fields.time}`)).toBe(iso);
    }
    expect(localDateTimeValue(null)).toBe("");
  });
});
