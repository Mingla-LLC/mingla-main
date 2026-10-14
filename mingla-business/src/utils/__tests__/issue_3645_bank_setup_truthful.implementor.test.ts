/**
 * #3645 — bank setup opens on the host's chosen country, the payout country is
 * remembered, cancel wording says what the code does, an RSVP can go back to
 * draft, and an empty per-stop price means free.
 *
 * Every test executes the shipped function. Break the function and its test
 * fails: for example, restore the United Kingdom fallback in
 * `resolveBankSetupSeedCountry` and "no choice, no country" fails; let a stale
 * remembered pick win and "a pick that disagrees with the currency" fails;
 * make `cancelDoneToast` promise refunds when nothing is known and
 * "says nothing about refunds unless paid orders are known" fails.
 */

const mockUpdate = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: { from: (table: string) => mockUpdate(table) },
}));

import {
  resolveBankSetupSeedCountry,
  resolveSavedPayoutCountry,
} from "../bankConnectRail";
import {
  CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION,
  cancelDoneToast,
  cancelEventDialogDescription,
  cancelRsvpDescription,
  cancelWithSalesDescription,
  countPaidOrders,
  knownPaidOrderCount,
} from "../cancelEventCopy";
import {
  RSVP_UNPUBLISH_FAILED_COPY,
  RSVP_UNPUBLISH_HAS_COMMITMENTS_COPY,
  RSVP_UNPUBLISH_NOT_ALLOWED_COPY,
  RSVP_UNPUBLISH_STARTED_COPY,
  RSVP_UNPUBLISH_UNAVAILABLE_COPY,
  rsvpUnpublishFailureCopy,
} from "../rsvpUnpublishFailureCopy";
import {
  emptyStop,
  stopPriceEntryIsValid,
} from "../../components/experience/experienceWizardTypes";
import { rememberBrandPayoutCountry } from "../../services/brandPayoutCountryService";
import { mapBrandRowToUi, type BrandRow } from "../../services/brandMapping";

describe("#3645 — the country bank setup opens on", () => {
  const nothing = {
    countryHint: null,
    paymentProvider: "stripe",
    cardAccountCountry: null,
    defaultCurrency: null,
    addressCountryCode: null,
    payoutCountry: null,
  };

  it("no choice, no country: never the United Kingdom, never the address", () => {
    expect(resolveBankSetupSeedCountry(nothing)).toBeNull();
    for (const addressCountryCode of ["GB", "US", "FR", "NG", "ZZ", "", "  "]) {
      expect(
        resolveBankSetupSeedCountry({ ...nothing, addressCountryCode }),
      ).toBeNull();
    }
  });

  it("an explicit card-rail hint comes first", () => {
    expect(
      resolveBankSetupSeedCountry({
        ...nothing,
        countryHint: "ca",
        cardAccountCountry: "US",
        defaultCurrency: "USD",
        payoutCountry: "US",
      })?.countryCode,
    ).toBe("CA");
  });

  it("a hint cannot move a brand off the Nigerian rail, and a Nigeria hint cannot put one on it", () => {
    expect(
      resolveBankSetupSeedCountry({
        ...nothing,
        paymentProvider: "paystack",
        countryHint: "GB",
      }),
    ).toMatchObject({ provider: "paystack", countryCode: "NG", currency: "NGN" });
    expect(
      resolveBankSetupSeedCountry({ ...nothing, countryHint: "NG" }),
    ).toBeNull();
  });

  it("the payment account's country comes before the remembered pick and the currency", () => {
    expect(
      resolveBankSetupSeedCountry({
        ...nothing,
        cardAccountCountry: "FR",
        defaultCurrency: "EUR",
        payoutCountry: "IE",
      })?.countryCode,
    ).toBe("FR");
  });

  it("a euro brand that picked Ireland is Ireland · EUR on resume, whatever its address", () => {
    for (const addressCountryCode of [null, "DE", "FR", "GB", "NG"]) {
      expect(
        resolveSavedPayoutCountry({
          ...nothing,
          defaultCurrency: "EUR",
          payoutCountry: "IE",
          addressCountryCode,
        }),
      ).toMatchObject({ countryCode: "IE", displayName: "Ireland", currency: "EUR" });
    }
  });

  it("a pick that disagrees with the brand's currency is not believed", () => {
    expect(
      resolveSavedPayoutCountry({
        ...nothing,
        defaultCurrency: "USD",
        payoutCountry: "IE",
      })?.countryCode,
    ).toBe("US");
    // No currency at all: the pick alone names nothing.
    expect(
      resolveSavedPayoutCountry({ ...nothing, payoutCountry: "IE" }),
    ).toBeNull();
  });

  it("a remembered Nigeria never stands in for the Nigerian rail", () => {
    expect(
      resolveSavedPayoutCountry({
        ...nothing,
        defaultCurrency: "NGN",
        payoutCountry: "NG",
      }),
    ).toBeNull();
  });

  it("rows with no remembered pick keep the earlier derivation unchanged", () => {
    // One country uses the currency.
    expect(
      resolveSavedPayoutCountry({ ...nothing, defaultCurrency: "GBP" })?.countryCode,
    ).toBe("GB");
    // Several do: the address breaks the tie, or nothing does.
    expect(
      resolveSavedPayoutCountry({
        ...nothing,
        defaultCurrency: "EUR",
        addressCountryCode: "DE",
      })?.countryCode,
    ).toBe("DE");
    expect(
      resolveSavedPayoutCountry({ ...nothing, defaultCurrency: "EUR" }),
    ).toBeNull();
  });

  it("the brand row carries the column, and a row from before the migration reads as no pick", () => {
    const base = {
      id: "b1",
      account_id: "a1",
      name: "Harbour",
      slug: "harbour",
      description: null,
      profile_photo_url: null,
      contact_email: null,
      contact_phone: null,
      social_links: {},
      custom_links: [],
      display_attendee_count: true,
      tax_settings: {},
      default_currency: "EUR",
      stripe_connect_id: null,
      stripe_payouts_enabled: false,
      stripe_charges_enabled: false,
      address: null,
      cover_hue: 25,
      cover_media_url: null,
      cover_media_type: null,
      profile_photo_type: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      deleted_at: null,
    } as unknown as BrandRow;
    expect(mapBrandRowToUi({ ...base, payout_country: "IE" }, { role: "owner" }).payoutCountry)
      .toBe("IE");
    expect(mapBrandRowToUi(base, { role: "owner" }).payoutCountry).toBeNull();
    // Display-only: it is not the address country and not the VAT country.
    const mapped = mapBrandRowToUi({ ...base, payout_country: "IE" }, { role: "owner" });
    expect(mapped.countryCode).toBeUndefined();
    expect(mapped.paymentCountry).toBeUndefined();
  });
});

describe("#3645 — remembering the pick never fails the pick", () => {
  beforeEach(() => mockUpdate.mockReset());

  const chain = (result: unknown) => {
    const select = jest.fn(async () => result);
    const is = jest.fn(() => ({ select }));
    const eq = jest.fn(() => ({ is }));
    const update = jest.fn(() => ({ eq }));
    mockUpdate.mockReturnValue({ update });
    return { update, eq, is, select };
  };

  it("writes the code to brands.payout_country for that brand only", async () => {
    const calls = chain({ data: [{ id: "b1" }], error: null });
    await expect(rememberBrandPayoutCountry("b1", " ie ")).resolves.toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("brands");
    expect(calls.update).toHaveBeenCalledWith({ payout_country: "IE" });
    expect(calls.eq).toHaveBeenCalledWith("id", "b1");
    expect(calls.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("clears it with null", async () => {
    const calls = chain({ data: [{ id: "b1" }], error: null });
    await expect(rememberBrandPayoutCountry("b1", null)).resolves.toBe(true);
    expect(calls.update).toHaveBeenCalledWith({ payout_country: null });
  });

  it.each(["IRL", "I", "1E", "", "ie land"])(
    "sends nothing for %p, which is not a country code",
    async (bad) => {
      chain({ data: [], error: null });
      await expect(rememberBrandPayoutCountry("b1", bad)).resolves.toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it("a database without the column yet (app shipped before the migration) is a quiet false, never a throw", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    chain({
      data: null,
      error: { code: "PGRST204", message: "Could not find the 'payout_country' column" },
    });
    await expect(rememberBrandPayoutCountry("b1", "IE")).resolves.toBe(false);
    mockUpdate.mockImplementation(() => {
      throw new Error("network down");
    });
    await expect(rememberBrandPayoutCountry("b1", "IE")).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    // The warning never carries the brand id or a server message.
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("b1");
    }
    warn.mockRestore();
  });

  it("no row updated (not this user's brand) is false", async () => {
    chain({ data: [], error: null });
    await expect(rememberBrandPayoutCountry("b1", "IE")).resolves.toBe(false);
  });
});

describe("#3645 — cancelling something that has sold", () => {
  const paid = { status: "paid" };
  const partly = { status: "refunded_partial" };
  const refunded = { status: "refunded_full" };

  it("counts the orders the cancel queues: paid and partly refunded", () => {
    expect(countPaidOrders([paid, partly, refunded, { status: "pending" }])).toBe(2);
  });

  it("a count is known only when the orders read completed, and zero is not a count", () => {
    expect(knownPaidOrderCount("ready", [paid, paid])).toBe(2);
    expect(knownPaidOrderCount("ready", [refunded])).toBeNull();
    for (const status of ["loading", "error", "stale-error", "disabled", null, undefined]) {
      expect(knownPaidOrderCount(status, [paid])).toBeNull();
    }
  });

  it("says what the cancel does, with the real count, and never the internal wording", () => {
    expect(cancelWithSalesDescription(3)).toBe(
      "Sales stop straight away. The 3 paid orders are queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    expect(cancelWithSalesDescription(1)).toBe(
      "Sales stop straight away. The 1 paid order is queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    for (const unknown of [null, 0, -1]) {
      expect(cancelWithSalesDescription(unknown)).toBe(
        "Sales stop straight away. Any paid orders are queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
      );
    }
    for (const count of [null, 1, 12]) {
      const copy = cancelWithSalesDescription(count);
      expect(copy).not.toMatch(/B-cycle|wire up|email|automatically|notified/i);
    }
  });

  it("the nothing-sold copy from before still wins when nothing is known to be sold", () => {
    expect(cancelEventDialogDescription(true, cancelWithSalesDescription(4))).toBe(
      CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION,
    );
    expect(cancelEventDialogDescription(false, cancelWithSalesDescription(4))).toContain(
      "The 4 paid orders are queued",
    );
  });

  it("the toast says nothing about refunds unless paid orders are known to exist", () => {
    expect(cancelDoneToast(2)).toBe("Event cancelled. Refunds are with Mingla for review.");
    expect(cancelDoneToast(null)).toBe("Event cancelled.");
    expect(cancelDoneToast(0)).toBe("Event cancelled.");
    expect(cancelDoneToast(1, "Experience")).toBe(
      "Experience cancelled. Refunds are with Mingla for review.",
    );
    expect(cancelDoneToast(null, "RSVP")).toBe("RSVP cancelled.");
  });

  it("an RSVP never says 'nothing to refund' unless it is known that no guest chipped in", () => {
    expect(cancelRsvpDescription(null)).toBe(
      "Guests can no longer respond. Any chip-ins guests paid are queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    expect(cancelRsvpDescription(0)).toBe(
      "Guests can no longer respond. No guest has chipped in, so there is nothing to refund. You can't undo this.",
    );
    expect(cancelRsvpDescription(1)).toContain("The 1 chip-in a guest paid is queued for a full refund");
    expect(cancelRsvpDescription(5)).toContain("The 5 chip-ins guests paid are queued for a full refund");
    expect(cancelRsvpDescription(null)).not.toContain("nothing to refund");
  });
});

describe("#3645 — why an RSVP could not go back to draft", () => {
  it("guests have responded: plain words, and the way out", () => {
    for (const shape of [
      new Error("rsvp_unpublish_has_commitments"),
      { message: "rsvp_unpublish_has_commitments", code: "P0001" },
      "rsvp_unpublish_has_commitments",
    ]) {
      expect(rsvpUnpublishFailureCopy(shape)).toBe(RSVP_UNPUBLISH_HAS_COMMITMENTS_COPY);
    }
    expect(RSVP_UNPUBLISH_HAS_COMMITMENTS_COPY).toBe(
      "Guests have already responded, so this RSVP can't go back to draft. Cancel it instead.",
    );
  });

  it("each other refusal gets its own true sentence, never a raw code", () => {
    expect(rsvpUnpublishFailureCopy({ message: "rsvp_unpublish_not_future" })).toBe(
      RSVP_UNPUBLISH_STARTED_COPY,
    );
    expect(rsvpUnpublishFailureCopy({ message: "insufficient_event_permission" })).toBe(
      RSVP_UNPUBLISH_NOT_ALLOWED_COPY,
    );
    // The app reached a database that does not have the function yet.
    expect(
      rsvpUnpublishFailureCopy({
        code: "PGRST202",
        message: "Could not find the function public.business_unpublish_rsvp_to_draft(p_event_id) in the schema cache",
      }),
    ).toBe(RSVP_UNPUBLISH_UNAVAILABLE_COPY);
    for (const unknown of [null, undefined, {}, new Error(""), { message: "boom" }]) {
      expect(rsvpUnpublishFailureCopy(unknown)).toBe(RSVP_UNPUBLISH_FAILED_COPY);
    }
    for (const copy of [
      RSVP_UNPUBLISH_STARTED_COPY,
      RSVP_UNPUBLISH_NOT_ALLOWED_COPY,
      RSVP_UNPUBLISH_UNAVAILABLE_COPY,
      RSVP_UNPUBLISH_FAILED_COPY,
    ]) {
      expect(copy).not.toMatch(/_|PGRST|schema cache/);
    }
  });
});

describe("#3645 — an empty per-stop price means free", () => {
  it("a new stop starts with an empty price, not a typed 0.00", () => {
    expect(emptyStop().priceMajor).toBe("");
  });

  it("empty is valid (free), and so is what older drafts stored", () => {
    for (const ok of ["", "   ", "0", "0.00", "12", "12.5", "12.50", ".5", "7."]) {
      expect(stopPriceEntryIsValid(ok)).toBe(true);
    }
  });

  it("only something typed that is not an amount is refused", () => {
    for (const bad of ["abc", "-1", "1,50", "1.2.3", "£5", ".", "1e3", "5 "+"x"]) {
      expect(stopPriceEntryIsValid(bad)).toBe(false);
    }
  });
});
