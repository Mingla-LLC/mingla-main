/**
 * #4490 P1-7 — smart-field models: money in exact minor units (conflict 69),
 * weekday chips, durations past 60 minutes, lead-time presets.
 */
import {
  FULL_DAY_MINUTES,
  durationLabel,
  durationOptions,
  formatMoneyInput,
  leadTimeLabel,
  leadTimeOptions,
  moneyFractionDigits,
  parseMoneyInput,
  toggleWeekday,
  weekdaysSummary,
} from "../fieldModels";

describe("MoneyField model — minor units", () => {
  it("NGN: typed 5000 is stored as 500000 kobo", () => {
    expect(parseMoneyInput("5000", "NGN")).toEqual({ kind: "valid", minor: 500000 });
  });
  it("GBP: typed 5000.00 is stored as 500000 pence", () => {
    expect(parseMoneyInput("5000.00", "GBP")).toEqual({ kind: "valid", minor: 500000 });
  });
  it("accepts grouping and a pasted glyph or code", () => {
    expect(parseMoneyInput("₦5,000", "NGN")).toEqual({ kind: "valid", minor: 500000 });
    expect(parseMoneyInput(" NGN 12,500.50 ", "NGN")).toEqual({ kind: "valid", minor: 1250050 });
    expect(parseMoneyInput("£7.5", "GBP")).toEqual({ kind: "valid", minor: 750 });
  });
  it("blank is blank, not zero", () => {
    expect(parseMoneyInput("   ", "NGN")).toEqual({ kind: "blank" });
  });
  it("refuses junk, too many decimals and amounts over the one-payment cap", () => {
    expect(parseMoneyInput("5k", "NGN")).toEqual({ kind: "invalid", reason: "format" });
    expect(parseMoneyInput("5.001", "GBP")).toEqual({ kind: "invalid", reason: "precision" });
    expect(parseMoneyInput("1.5", "JPY")).toEqual({ kind: "invalid", reason: "precision" });
    expect(parseMoneyInput("21474837", "NGN")).toEqual({ kind: "invalid", reason: "range" });
    expect(parseMoneyInput("21474836.47", "NGN")).toEqual({ kind: "valid", minor: 2147483647 });
  });
  it("zero-decimal currencies keep whole units", () => {
    expect(moneyFractionDigits("JPY")).toBe(0);
    expect(moneyFractionDigits("NGN")).toBe(2);
    expect(parseMoneyInput("1200", "JPY")).toEqual({ kind: "valid", minor: 1200 });
  });
  it("formats stored amounts back without trailing .00", () => {
    expect(formatMoneyInput(500000, "NGN")).toBe("5,000");
    expect(formatMoneyInput(500050, "NGN")).toBe("5,000.50");
    expect(formatMoneyInput(null, "NGN")).toBe("");
    expect(formatMoneyInput(1200, "JPY")).toBe("1,200");
  });
});

describe("WeekdayChips model", () => {
  it("toggles days and keeps Monday-first order", () => {
    expect(toggleWeekday([3, 0], 1)).toEqual([0, 1, 3]);
    expect(toggleWeekday([0, 1, 3], 1)).toEqual([0, 3]);
  });
  it("summarises in plain words", () => {
    expect(weekdaysSummary([0, 1, 2, 3])).toBe("Mon to Thu");
    expect(weekdaysSummary([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(weekdaysSummary([5, 6])).toBe("Weekends");
    expect(weekdaysSummary([0, 2, 4])).toBe("Mon, Wed, Fri");
    expect(weekdaysSummary([])).toBe("No days");
  });
});

describe("DurationSelect model — no 60-minute cap", () => {
  it("offers 15-minute steps past an hour, up to 24 hours", () => {
    const options = durationOptions();
    expect(options[0]).toEqual({ value: 15, label: "15 min" });
    expect(options.some((o) => o.value === 120 && o.label === "2 hours")).toBe(true);
    expect(options.some((o) => o.value === 90 && o.label === "1 hour 30 min")).toBe(true);
    expect(options[options.length - 1].value).toBe(24 * 60);
  });
  it("the hire version adds Full day", () => {
    const options = durationOptions({ includeFullDay: true });
    const full = options.filter((o) => o.value === FULL_DAY_MINUTES);
    expect(full).toEqual([{ value: FULL_DAY_MINUTES, label: "Full day" }]);
    expect(durationLabel(FULL_DAY_MINUTES, true)).toBe("Full day");
  });
});

describe("LeadTimeSelect model", () => {
  it("labels hours, days, weeks and months", () => {
    expect(leadTimeLabel(120)).toBe("2 hours");
    expect(leadTimeLabel(3 * 1440)).toBe("3 days");
    expect(leadTimeLabel(14 * 1440)).toBe("2 weeks");
    expect(leadTimeLabel(30 * 1440)).toBe("1 month");
    expect(leadTimeLabel(0)).toBe("No notice");
  });
  it("offers presets in increasing order", () => {
    const values = leadTimeOptions({ includeNone: true }).map((o) => o.value);
    expect(values[0]).toBe(0);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});
