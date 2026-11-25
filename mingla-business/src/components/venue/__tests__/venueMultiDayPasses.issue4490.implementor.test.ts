/** #4490 spec 07 F — Host controls, guest words and door outcomes. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  emptyOptionDraft,
  multiDayPassSummary,
  optionIssues,
  optionPayload,
  shouldSaveEntryStepBeforeNavigation,
} from "../features/offers/offersModel";
import { checkInResultView } from "../features/checkin/venueCheckInResult";
import { mapScanOutcome } from "../../../services/venueOffersService";
import {
  entryOptionName,
  parseEntryBooking,
  parseEntryOfferDetail,
  passProgressLine,
} from "@mingla/brand-rendering/venueOffers/entryModel";

describe("multi-day entry passes", () => {
  it("writes N-in-M only when the Host switch is on and validates both bounds", () => {
    const flex = { ...emptyOptionDraft("10-Day Flex"), multiDay: true, passDays: 10, passWindowDays: 60 };
    expect(optionPayload(flex, 0)).toMatchObject({ passDays: 10, passWindowDays: 60 });
    expect(optionIssues(flex, 100).pass).toBeNull();
    expect(optionIssues({ ...flex, passWindowDays: 9 }, 100).pass).toBe(
      "Within must be at least Days, and no more than 365",
    );
    expect(optionPayload({ ...flex, multiDay: false }, 0)).not.toHaveProperty("passDays");
    expect(multiDayPassSummary(3, 3, true)).toBe("3 days in a row");
    expect(multiDayPassSummary(10, 60, true)).toBe("Any 10 days within 60 days from the start day");
  });

  it("keeps the approved switch and two bounded steppers in PriceOptionCard", () => {
    const source = readFileSync(join(__dirname, "..", "features/offers/PriceOptionCard.tsx"), "utf8");
    expect(source).toContain("Good for more than one day");
    expect(source).toContain('label="Days"');
    expect(source).toContain('label="Within"');
    expect(source).toContain("min={2}");
    expect(source).toContain("max={60}");
    expect(source).toContain("max={365}");
    expect(source).toContain('entryStyle !== "timed_session"');
  });

  it("saves a dirty price step before the host jumps to Review", () => {
    expect(shouldSaveEntryStepBeforeNavigation(true, "prices", "review")).toBe(true);
    expect(shouldSaveEntryStepBeforeNavigation(true, "review", "prices")).toBe(false);
    expect(shouldSaveEntryStepBeforeNavigation(false, "prices", "review")).toBe(false);

    const source = readFileSync(join(__dirname, "..", "features/offers/EntryEditor.tsx"), "utf8");
    expect(source).toContain("const navigateToStep = useCallback");
    expect(source).toContain("await runSave(step.id)");
    expect(source).toContain("void navigateToStep(i)");
    expect(source).toContain("onBack={stepIndex > 0 ? () => void navigateToStep(stepIndex - 1) : undefined}");
  });

  it("restates a multi-day option on Review before it is saved", () => {
    const source = readFileSync(join(__dirname, "..", "features/offers/EntryEditor.tsx"), "utf8");
    expect(source).toContain('...(o.multiDay ? [multiDayPassSummary(o.passDays, o.passWindowDays)] : [])');
  });

  it("labels the guest price and pass progress in plain words", () => {
    const offer = parseEntryOfferDetail({
      id: "offer-1",
      name: "Entry",
      currencyCode: "NGN",
      options: [{
        id: "option-1",
        name: "10-Day Flex",
        priceMinor: 500000,
        guestMin: 1,
        guestMax: 4,
        passDays: 10,
        passWindowDays: 60,
      }],
      venue: { name: "Kora" },
    });
    expect(entryOptionName(offer?.options[0] as NonNullable<typeof offer>["options"][number])).toBe(
      "10-Day Flex · any 10 days in 60",
    );

    const booking = parseEntryBooking({
      groupId: "group-1",
      state: "confirmed",
      currencyCode: "NGN",
      venue: { name: "Kora" },
      offer: { name: "Entry" },
      lines: [],
      passes: [{
        passId: "pass-1",
        status: "valid",
        admits: 1,
        admittedCount: 1,
        daysAllowed: 10,
        daysUsed: 3,
        validUntilLocalDate: "2027-01-16",
      }],
    });
    expect(passProgressLine(booking?.passes[0])).toBe("Day 3 of 10 · valid until Sat 16 Jan");
  });

  it("maps all-days-used and full-day door answers without exposing raw codes", () => {
    const base = {
      kind: "pass",
      pass: {
        passId: "pass-1",
        holderName: "Ada",
        offerName: "Flex",
        offerKind: "entry",
        admits: 1,
        admittedCount: 0,
        remaining: 1,
        daysAllowed: 10,
        daysUsed: 10,
        dayNumber: 10,
        dayLabel: "Valid 21 Nov–19 Jan",
      },
    };
    const used = checkInResultView(mapScanOutcome({ ...base, result: "days_used" }));
    expect(used.title).toBe("All days used");
    expect(used.body).toBe("All 10 days used.");
    expect(used.subject).toContain("Day 10 of 10");

    const full = checkInResultView(mapScanOutcome({ ...base, result: "day_full" }));
    expect(full.title).toBe("Today is full");
    expect(full.body).toBe("Today is full. This pass can be used on another valid day.");
    expect(JSON.stringify([used.title, used.subject, used.body, full.title, full.subject, full.body])).not.toMatch(
      /days_used|day_full/,
    );
    expect(checkInResultView(mapScanOutcome({ ...base, result: "wrong_day" })).body).toBe(
      "Valid 21 Nov–19 Jan",
    );
    expect(checkInResultView(mapScanOutcome({ ...base, result: "not_yet" })).body).toBe(
      "Valid 21 Nov–19 Jan. It hasn't started yet.",
    );
  });

  it("keeps the no-partial-refund warning and used-day cancellation guard on the pass page", () => {
    const source = readFileSync(join(__dirname, "..", "offers/VisitBooking.tsx"), "utf8");
    expect(source).toContain("Unused days aren&apos;t refunded.");
    expect(source).toContain("(pass?.daysUsed ?? 0) === 0");
  });
});
