import {
  addDays,
  audienceLabel,
  bookingFeeMinor,
  briefLintMessage,
  dateRangeLabel,
  dueIn,
  followerBandLabel,
  formatName,
  hostContractStatus,
  hostContractStep,
  lintPublicBrief,
  minorToWholeText,
  payUpToLabel,
  programErrorMessage,
  programMoney,
  programMoneyShort,
  shortDate,
  timelineWords,
  wholeCurrencyToMinor,
} from "../creatorProgramFormat";

// #3872 walkthrough: hosts never see raw values (minor units, band keys, ISO
// dates, status keys, server error text).
const NOW = new Date(2026, 9, 26, 12, 0, 0);

describe("creator program money", () => {
  it("formats minor units in the record's currency, whole amounts without cents", () => {
    expect(programMoney(30000, "USD")).toBe("$300");
    expect(programMoney(11880, "USD")).toBe("$118.80");
    expect(programMoney(12000000, "NGN")).toBe("₦120,000");
    expect(programMoney(null, "USD")).toBe("—");
  });

  it("abbreviates headline tiles", () => {
    expect(programMoneyShort(124000, "USD")).toBe("$1,240");
    expect(programMoneyShort(48600000, "NGN")).toBe("₦486k");
    expect(programMoneyShort(130000000, "NGN")).toBe("₦1.3M");
  });

  it("reads whole currency typed by a host into minor units", () => {
    expect(wholeCurrencyToMinor("$300", "USD")).toBe(30000);
    expect(wholeCurrencyToMinor("1,200", "NGN")).toBe(120000);
    expect(wholeCurrencyToMinor("", "USD")).toBeNull();
    expect(wholeCurrencyToMinor("0", "USD")).toBeNull();
    expect(minorToWholeText(30000, "USD")).toBe("300");
  });

  it("adds the 15% booking fee ($300 + $45)", () => {
    expect(bookingFeeMinor(30000)).toBe(4500);
    expect(bookingFeeMinor(12000000)).toBe(1800000);
    expect(bookingFeeMinor(0)).toBe(0);
  });
});

describe("creator program dates", () => {
  it("shows short dates instead of ISO strings", () => {
    expect(shortDate("2026-12-05", NOW)).toBe("Dec 5");
    expect(shortDate("2027-01-09", NOW)).toBe("Jan 9, 2027");
    expect(shortDate("", NOW)).toBe("");
  });

  it("shows ranges compactly", () => {
    expect(dateRangeLabel("2026-11-20", "2026-11-25", NOW)).toBe("Nov 20–25");
    expect(dateRangeLabel("2026-11-28", "2026-12-03", NOW)).toBe(
      "Nov 28 – Dec 3",
    );
    expect(dateRangeLabel("2026-11-20", "2026-11-20", NOW)).toBe("Nov 20");
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
  });

  it("describes deadlines in hours or days", () => {
    expect(
      dueIn(new Date(NOW.getTime() + 47 * 3_600_000).toISOString(), NOW),
    ).toBe("in 47 hours");
    expect(
      dueIn(new Date(NOW.getTime() + 72 * 3_600_000).toISOString(), NOW),
    ).toBe("in 3 days");
  });
});

describe("creator program audience and formats", () => {
  it("turns follower-band keys into words", () => {
    expect(followerBandLabel("10k_50k")).toBe("10k–50k");
    expect(followerBandLabel("100k_plus")).toBe("100k+");
    expect(followerBandLabel("under_1k")).toBe("Under 1k");
    expect(
      audienceLabel([
        { platform: "instagram", band: "10k_50k" },
        { platform: "tiktok", band: null },
      ]),
    ).toBe("Instagram 10k–50k");
  });

  it("names formats", () => {
    expect(formatName("night_out_30")).toBe("Night out in 30 seconds");
  });
});

describe("creator program pay", () => {
  it("says the gig's stored pay in its own currency, never a level", () => {
    expect(payUpToLabel(30000, "USD")).toBe("up to $300");
    expect(payUpToLabel(5000000, "NGN")).toContain("50,000");
    expect(payUpToLabel(5000000, "NGN")).toMatch(/^up to /);
    expect(payUpToLabel(30000, "USD")).not.toMatch(/level/i);
  });

  it("says nothing for a gig saved before pay existed", () => {
    expect(payUpToLabel(null, "USD")).toBeNull();
    expect(payUpToLabel(undefined, "USD")).toBeNull();
    expect(payUpToLabel(0, "USD")).toBeNull();
  });
});

describe("host contract words", () => {
  it("uses the host column of the states table", () => {
    expect(hostContractStatus("script_sent").label).toBe("Review the script");
    expect(hostContractStatus("released").label).toBe("Paid to the creator");
    expect(hostContractStatus("fix_requested").label).toBe(
      "Waiting for the fix",
    );
    expect(hostContractStatus("posts_verified").label).toBe("Posts verified");
    expect(hostContractStatus("mystery_state").label).toBe("In progress");
    expect(hostContractStep("script_sent")).toBe(3);
    expect(timelineWords("shoot_plan_confirmed")).toBe("Shoot time approved");
    expect(timelineWords("some_new_kind")).toBe("Some new kind");
  });
});

describe("brand-free brief check", () => {
  it("flags names, links and contacts live", () => {
    const hits = lintPublicBrief(
      "Come to Sky Lounge, see www.sky.com or @skylounge",
      { brandName: "Sky Lounge" },
    );
    expect(hits).toEqual(["url", "handle", "brand"]);
    expect(briefLintMessage(hits)).toBe(
      "Remove a link, a social handle and your brand name. Creators see this before they're hired, so keep it brand-free.",
    );
    expect(
      lintPublicBrief(
        "Film a lively rooftop night with the view and the dance floor.",
        { brandName: "Sky Lounge" },
      ),
    ).toEqual([]);
  });
});

describe("server errors", () => {
  it("maps codes to words and never shows raw server text", () => {
    expect(
      programErrorMessage(new Error("stale_contract_state:script_locked")),
    ).toBe(
      "This changed while you were looking. Pull to refresh and try again.",
    );
    expect(
      programErrorMessage({ ok: false, error: "provider_start_failed" }),
    ).toBe("Payments aren't available right now. Try again in a few minutes.");
    expect(
      programErrorMessage(
        new Error("Edge Function returned a non-2xx status code"),
        "Couldn't start payment.",
      ),
    ).toBe("Couldn't start payment.");
  });
});
